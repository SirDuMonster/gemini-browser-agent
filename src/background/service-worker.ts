import type {
  BackgroundMessage,
  UIMessage,
  ContentMessage,
  ContentResponse,
  PageContext,
  PlannedAction,
  ComputerUseAction,
  AgentSession,
  VerificationResult,
} from '../shared/types';
import { debugLog, debugError, MAX_RETRY_ATTEMPTS, RATE_LIMITING, INPUT_VALIDATION, SERVICE_WORKER_DELAYS, TAB_MANAGEMENT, VERIFICATION_CONFIG, ERROR_RECOVERY } from '../shared/constants';
import { stateManager } from './state-manager';
import { planner } from './planner';
import { geminiClient } from '../api/gemini-client';
import { getSettings, saveSettings } from '../shared/utils/storage-utils';
import { captureWithAdaptiveQuality } from '../shared/utils/screenshot-utils';
import { milestoneTracker } from './milestone-tracker';
import { tabManager } from './tab-manager';
import { memoryManager } from './memory-manager';
import { verifier } from './verifier';
import { recoveryManager } from './recovery-manager';
import { siteDataManager } from './site-data-manager';
import { fileGenerator } from './file-generator';

/**
 * Service Worker - Main orchestrator for Gemini for Chrome
 */

// Set up cross-manager callbacks
tabManager.setOnTabRemovedCallback((tabId) => {
  siteDataManager.clearTab(tabId);
});

// ============ Message Deduplication (Phase 7 - Fix duplicate messages) ============

/**
 * Tracks recently sent messages to prevent duplicates
 */
class MessageDeduplicator {
  private recentMessages: Array<{ text: string; timestamp: number }> = [];
  private readonly MAX_MESSAGES = 5;
  private readonly EXPIRY_MS = 60000; // 1 minute
  private readonly SIMILARITY_THRESHOLD = 0.7; // 70% similar = duplicate

  /**
   * Check if a message is a duplicate and should be skipped
   */
  isDuplicate(text: string): boolean {
    this.cleanup();

    // Check against recent messages
    for (const msg of this.recentMessages) {
      if (this.calculateSimilarity(text, msg.text) >= this.SIMILARITY_THRESHOLD) {
        debugLog('MessageDeduplicator', 'Skipping duplicate message', {
          new: text.substring(0, 50),
          existing: msg.text.substring(0, 50),
        });
        return true;
      }
    }

    return false;
  }

  /**
   * Record a sent message
   */
  record(text: string): void {
    this.recentMessages.push({ text, timestamp: Date.now() });

    // Keep only last N messages
    if (this.recentMessages.length > this.MAX_MESSAGES) {
      this.recentMessages.shift();
    }
  }

  /**
   * Clear all tracked messages (call on task end)
   */
  reset(): void {
    this.recentMessages = [];
  }

  /**
   * Remove expired messages
   */
  private cleanup(): void {
    const now = Date.now();
    this.recentMessages = this.recentMessages.filter(
      msg => now - msg.timestamp < this.EXPIRY_MS
    );
  }

  /**
   * Calculate text similarity using Jaccard index with bigrams
   * L1 Fix: Improved similarity algorithm using bigrams instead of just words
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const getBigrams = (s: string): Set<string> => {
      const normalized = normalize(s);
      const bigrams = new Set<string>();
      for (let i = 0; i < normalized.length - 1; i++) {
        bigrams.add(normalized.slice(i, i + 2));
      }
      return bigrams;
    };

    const bigrams1 = getBigrams(text1);
    const bigrams2 = getBigrams(text2);

    if (bigrams1.size === 0 || bigrams2.size === 0) {
      return text1 === text2 ? 1 : 0;
    }

    // Jaccard index: intersection / union
    let intersection = 0;
    for (const bigram of bigrams1) {
      if (bigrams2.has(bigram)) intersection++;
    }

    const union = bigrams1.size + bigrams2.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }
}

const messageDeduplicator = new MessageDeduplicator();

// ============ Rate Limiter (P1 - Issue #4) ============

/**
 * Rate limiter to prevent API quota abuse
 * Enforces minimum delay between calls and maximum calls per minute
 */
class RateLimiter {
  private callTimestamps: number[] = [];

  /**
   * Wait if needed to respect rate limits
   * @returns Promise that resolves when it's safe to make a call
   */
  async waitIfNeeded(): Promise<void> {
    const now = Date.now();

    // Remove timestamps older than the rate limit window
    this.callTimestamps = this.callTimestamps.filter(
      timestamp => now - timestamp < RATE_LIMITING.RATE_LIMIT_WINDOW_MS
    );

    // Check if we've hit the per-minute limit
    if (this.callTimestamps.length >= RATE_LIMITING.MAX_API_CALLS_PER_MINUTE) {
      const oldestCall = this.callTimestamps[0];
      const waitTime = RATE_LIMITING.RATE_LIMIT_WINDOW_MS - (now - oldestCall);

      if (waitTime > 0) {
        debugLog('RateLimiter', `Rate limit reached. Waiting ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.waitIfNeeded(); // Recursive check after waiting
      }
    }

    // Check minimum delay since last call
    if (this.callTimestamps.length > 0) {
      const lastCall = this.callTimestamps[this.callTimestamps.length - 1];
      const timeSinceLastCall = now - lastCall;

      if (timeSinceLastCall < RATE_LIMITING.MIN_DELAY_BETWEEN_API_CALLS_MS) {
        const waitTime = RATE_LIMITING.MIN_DELAY_BETWEEN_API_CALLS_MS - timeSinceLastCall;
        debugLog('RateLimiter', `Minimum delay not met. Waiting ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // Record this call
    this.callTimestamps.push(Date.now());
  }

  /**
   * Get current rate limit stats
   */
  getStats() {
    const now = Date.now();
    const recentCalls = this.callTimestamps.filter(
      timestamp => now - timestamp < RATE_LIMITING.RATE_LIMIT_WINDOW_MS
    );

    return {
      callsInLastMinute: recentCalls.length,
      maxCallsPerMinute: RATE_LIMITING.MAX_API_CALLS_PER_MINUTE,
      minDelayMs: RATE_LIMITING.MIN_DELAY_BETWEEN_API_CALLS_MS,
    };
  }

  /**
   * H1 Fix: Reset rate limiter state (for cleanup)
   */
  reset(): void {
    this.callTimestamps = [];
  }
}

// Global rate limiter instance
const rateLimiter = new RateLimiter();

// ============ Session Mutex (P2 - Issue #10) ============

/**
 * Session mutex to prevent race conditions
 * Ensures only one session operation happens at a time
 */
class SessionMutex {
  private locked: boolean = false;
  // H2 Fix: Proper typing for queue of resolve functions
  private queue: Array<(value: void | PromiseLike<void>) => void> = [];

  /**
   * Acquire lock - waits if already locked
   */
  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    // Wait for lock to be released
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  /**
   * Release lock and process queue
   */
  release(): void {
    if (this.queue.length > 0) {
      const resolve = this.queue.shift();
      if (resolve) resolve();
    } else {
      this.locked = false;
    }
  }

  /**
   * Run function with mutex protection
   */
  async runWithLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Get lock status (for debugging)
   */
  isLocked(): boolean {
    return this.locked;
  }
}

// Global mutex instance
const sessionMutex = new SessionMutex();

// ============ Input Validation (P1 - Issue #7) ============

/**
 * Validate and sanitize user input to prevent prompt injection attacks
 */
function validateUserInput(input: string): void {
  // Check length
  if (!input || input.trim().length < INPUT_VALIDATION.MIN_REQUEST_LENGTH) {
    throw new Error(`Request is too short. Please provide at least ${INPUT_VALIDATION.MIN_REQUEST_LENGTH} characters.`);
  }

  if (input.length > INPUT_VALIDATION.MAX_REQUEST_LENGTH) {
    throw new Error(`Request is too long. Maximum ${INPUT_VALIDATION.MAX_REQUEST_LENGTH} characters allowed.`);
  }

  // Check for forbidden patterns (prompt injection attempts)
  for (const pattern of INPUT_VALIDATION.FORBIDDEN_PATTERNS) {
    if (pattern.test(input)) {
      throw new Error('Request contains forbidden content. Please rephrase your request.');
    }
  }

  debugLog('InputValidation', 'Input validated successfully', {
    length: input.length,
  });
}

// ============ Initialization ============

chrome.runtime.onInstalled.addListener(async (details) => {
  // C1 Fix: Use mutex to prevent race conditions during initialization
  await sessionMutex.runWithLock(async () => {
    debugLog('ServiceWorker', 'Extension installed/updated', details);

    // Initialize state manager
    await stateManager.initialize();

    // Initialize memory manager (Autonomous Roaming Phase 2)
    await memoryManager.initialize();

    // Initialize default settings
    await getSettings();

    // Clean up any sessions (old sessions should not persist across extension updates/reloads)
    const session = stateManager.getCurrentSession();
    if (session) {
      debugLog('ServiceWorker', 'Cleaning up old session after install/update', {
        status: session.status,
        id: session.id,
      });
      await stateManager.cancelSession();
    }

    debugLog('ServiceWorker', 'Initialization complete');
  });
});

chrome.runtime.onStartup.addListener(async () => {
  // C1 Fix: Use mutex to prevent race conditions during initialization
  await sessionMutex.runWithLock(async () => {
    debugLog('ServiceWorker', 'Browser startup');

    // Restore state
    await stateManager.initialize();

    // Initialize memory manager (Autonomous Roaming Phase 2)
    await memoryManager.initialize();

    // Clean up any sessions from previous runs (don't persist across browser restarts)
    const session = stateManager.getCurrentSession();
    if (session) {
      debugLog('ServiceWorker', 'Cleaning up old session from previous run', {
        status: session.status,
        id: session.id,
      });
      await stateManager.cancelSession();
      await memoryManager.clear(); // Also clear memory
    }
  });
});

// ============ Extension Icon Click Handler ============

chrome.action.onClicked.addListener(async (tab) => {
  debugLog('ServiceWorker', 'Extension icon clicked', { tabId: tab.id });

  // Open sidepanel
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    debugLog('ServiceWorker', 'Sidepanel opened');
  } catch (error) {
    debugError('ServiceWorker', 'Failed to open sidepanel', error);
  }
});

// ============ Message Handling ============

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  debugLog('ServiceWorker', 'Message received', { type: message.type, sender: sender.tab?.id });

  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      debugError('ServiceWorker', 'Message handler error', error);
      sendResponse({ error: error.message });
    });

  // Return true to indicate async response
  return true;
});

/**
 * Main message handler
 */
async function handleMessage(
  message: BackgroundMessage,
  _sender: chrome.runtime.MessageSender
): Promise<any> {
  switch (message.type) {
    case 'START_TASK':
      return await handleStartTask(message.userRequest);

    case 'STOP_TASK':
      return await handleStopTask();

    case 'GET_STATUS':
      return await handleGetStatus();

    case 'GET_SETTINGS':
      return await handleGetSettings();

    case 'UPDATE_SETTINGS':
      return await handleUpdateSettings(message.settings);

    case 'FORCE_CLEAR':
      // Emergency clear - always works
      debugLog('ServiceWorker', 'FORCE CLEAR - clearing all storage');
      await chrome.storage.local.clear();
      await stateManager.initialize();
      return { success: true };

    case 'CONTENT_SCRIPT_READY':
      // Content script loaded and ready - acknowledge
      debugLog('ServiceWorker', 'Content script ready');
      return { success: true };

    case 'PAGE_CHANGED':
      // Page navigation detected - acknowledge but don't need to do anything
      debugLog('ServiceWorker', 'Page changed notification received');
      return { success: true };

    default:
      throw new Error(`Unknown message type: ${(message as any).type}`);
  }
}

// ============ Task Handlers ============

/**
 * Start a new task
 * P2 - Issue #10: Protected by SessionMutex to prevent race conditions
 */
async function handleStartTask(userRequest: string): Promise<{ success: boolean; sessionId: string }> {
  return await sessionMutex.runWithLock(async () => {
    debugLog('ServiceWorker', 'Starting task (mutex acquired)', { userRequest });

    try {
      // P1 - Issue #7: Validate and sanitize user input
      validateUserInput(userRequest);

      // Check if there's already an active session
      if (stateManager.hasActiveSession()) {
        throw new Error('A task is already running. Please stop it first.');
      }

      // Get active tab and save it to session
      const activeTab = await getActiveTab();
      if (!activeTab?.id) {
        throw new Error('No active tab found. Please ensure you have a web page open.');
      }

      // Create new session with target tab
      const session = await stateManager.createSession(userRequest);
      session.targetTabId = activeTab.id;
      session.initialTabId = activeTab.id; // Track initial tab (Autonomous Roaming Phase 1)
      session.managedTabIds = []; // Initialize managed tabs array

      // Track the initial tab with TabManager
      tabManager.trackTab(activeTab.id, activeTab.url || '', activeTab.title || '');

      // Initialize memory for new task (Autonomous Roaming Phase 2)
      await memoryManager.clear();
      memoryManager.addGoal(userRequest); // Primary goal

      // Reset milestone tracker for new task
      milestoneTracker.reset();

      // Reset recovery manager for new task (Autonomous Roaming Phase 4)
      recoveryManager.reset();

      // Reset site data manager for new task (Autonomous Roaming Phase 5)
      siteDataManager.reset();

      // Reset message deduplicator for new task (Phase 7)
      messageDeduplicator.reset();

      debugLog('ServiceWorker', 'Task started on tab', { tabId: activeTab.id, url: activeTab.url });

      // Broadcast status update
      await broadcastStatusUpdate('planning', session);

      // Start agent loop (don't await - runs in background)
      // C2 Fix: Add guaranteed cleanup on agent loop failure
      runAgentLoop(session.id).catch(async (error) => {
        debugError('ServiceWorker', 'Agent loop failed', error);

        // Cleanup resources to prevent memory leaks and stuck state
        try {
          await tabManager.cleanup();
          await memoryManager.clear();
          recoveryManager.reset();
          siteDataManager.reset();
          messageDeduplicator.reset();
          rateLimiter.reset(); // H1 Fix: Reset rate limiter on cleanup
          await stateManager.cancelSession();
        } catch (cleanupError) {
          debugError('ServiceWorker', 'Cleanup after agent loop failure also failed', cleanupError);
        }

        broadcastTaskError(error.message);
      });

      return {
        success: true,
        sessionId: session.id,
      };
    } catch (error) {
      debugError('ServiceWorker', 'Failed to start task', error);
      throw error;
    }
  });
}

/**
 * Stop current task
 * P2 - Issue #10: Protected by SessionMutex to prevent race conditions
 */
async function handleStopTask(): Promise<{ success: boolean }> {
  return await sessionMutex.runWithLock(async () => {
    debugLog('ServiceWorker', 'Stopping task (mutex acquired)');

    try {
      // Cleanup agent-opened tabs (Autonomous Roaming Phase 1)
      if (TAB_MANAGEMENT.AUTO_CLEANUP_ON_SESSION_END) {
        await tabManager.cleanup();
      }

      // Clear memory (Autonomous Roaming Phase 2)
      await memoryManager.clear();

      // Reset recovery manager (Autonomous Roaming Phase 4)
      recoveryManager.reset();

      // Reset site data manager (Autonomous Roaming Phase 5)
      siteDataManager.reset();

      // Reset message deduplicator (Phase 7)
      messageDeduplicator.reset();

      // Force cancel - always works even if session is stuck
      await stateManager.cancelSession();
      await broadcastStatusUpdate('error', null);

      debugLog('ServiceWorker', 'Task stopped successfully');
      return { success: true };
    } catch (error) {
      debugError('ServiceWorker', 'Failed to stop task', error);
      // Even if error, try to clear session
      try {
        await tabManager.cleanup();
        await memoryManager.clear();
        await stateManager.cancelSession();
      } catch (e) {
        // Ignore
      }
      return { success: true }; // Always return success for stop
    }
  });
}

/**
 * Get current status
 */
async function handleGetStatus(): Promise<{
  session: AgentSession | null;
  stats: any;
}> {
  const session = stateManager.getCurrentSession();
  const stats = stateManager.getSessionStats();

  // Auto-cleanup stuck sessions - different timeouts based on status
  if (session && session.status !== 'completed') {
    const age = Date.now() - new Date(session.startedAt).getTime();

    // Error sessions: cleanup after 30 seconds
    if (session.status === 'error' && age > 30000) {
      debugLog('ServiceWorker', 'Auto-cleaning error session', { age: `${Math.floor(age/1000)}s` });
      await stateManager.cancelSession();
      return { session: null, stats };
    }

    // Active sessions: cleanup after 2 minutes (API calls can be slow)
    if (['planning', 'executing', 'verifying'].includes(session.status) && age > 120000) {
      debugLog('ServiceWorker', 'Auto-cleaning stuck active session', {
        status: session.status,
        age: `${Math.floor(age/1000)}s`
      });
      await stateManager.cancelSession();
      return { session: null, stats };
    }
  }

  return { session, stats };
}

/**
 * Get settings
 */
async function handleGetSettings() {
  return await getSettings();
}

/**
 * Update settings
 */
async function handleUpdateSettings(settings: any) {
  await saveSettings(settings);
  return { success: true };
}

// ============ Agent Loop ============

/**
 * Main agent loop - Planning → Executing → Verifying
 */
async function runAgentLoop(sessionId: string): Promise<void> {
  // P3 - Issue #21: Replaced console.log with debugLog
  debugLog('AgentLoop', 'Starting agent loop', { sessionId });

  let retryCount = 0;
  let consecutiveNoActionCount = 0; // Track iterations without actions
  const MAX_NO_ACTION_ITERATIONS = 3; // Max allowed iterations without actions

  debugLog('AgentLoop', 'Entering main loop...');

  while (true) {
    try {
      debugLog('AgentLoop', 'Loop iteration started');

      // Check if session is still active
      debugLog('AgentLoop', 'Getting current session...');
      const session = stateManager.getCurrentSession();
      debugLog('AgentLoop', 'Current session:', session ? { id: session.id, status: session.status } : 'null');

      if (!session || session.id !== sessionId) {
        debugLog('AgentLoop', 'Session ended, stopping loop');
        break;
      }

      // Check max actions limit
      debugLog('AgentLoop', 'Getting settings...');
      const settings = await getSettings();
      debugLog('AgentLoop', 'Settings loaded', { maxActions: settings.maxActionsPerTask, currentActions: session.actions.length });

      if (session.actions.length >= settings.maxActionsPerTask) {
        debugLog('AgentLoop', 'Max actions reached, stopping');
        await broadcastTaskComplete('Maximum actions limit reached');
        await stateManager.endSession();
        break;
      }

      // ===== STEP 1: Get Current Context =====
      debugLog('AgentLoop', 'Updating status to planning...');
      await stateManager.updateStatus('planning');
      await broadcastStatusUpdate('planning', session);

      // Ensure we have a target tab
      if (!session.targetTabId) {
        throw new Error('No target tab ID in session');
      }

      // Store validated targetTabId for type safety
      const targetTabId: number = session.targetTabId;

      debugLog('AgentLoop', 'Getting page context...');
      const context = await getCurrentPageContext(targetTabId);
      debugLog('AgentLoop', 'Page context received', { url: context.url });
      await stateManager.updateContext(context);

      // Track visited URL (Autonomous Roaming Phase 2)
      memoryManager.recordVisit(context.url);

      // Save tab context for multi-site tracking (Autonomous Roaming Phase 5)
      // Note: saveTabContext also records the site visit internally
      siteDataManager.saveTabContext(targetTabId, context);

      // Check if domain is blocked
      if (await planner.isBlockedDomain(context.url)) {
        throw new Error(`Domain blocked for safety: ${context.url}`);
      }

      // ===== STEP 2: Plan AND Execute with Gemini =====
      debugLog('AgentLoop', 'Planning and executing next action with Gemini...');

      // Load API key
      if (settings.googleAiApiKey) {
        geminiClient.setApiKey(settings.googleAiApiKey);
      }

      // P1 - Issue #4: Apply rate limiting before API call
      await rateLimiter.waitIfNeeded();

      // Get memory context for AI (Autonomous Roaming Phase 2)
      const memoryContext = memoryManager.summarizeForPrompt();

      // Build multi-site context (Autonomous Roaming Phase 5)
      const openTabs = tabManager.getAllTabs().map(tab => ({
        id: tab.id,
        url: tab.url,
        purpose: tab.purpose,
      }));
      const multiSiteContext = siteDataManager.buildMultiSiteContext(targetTabId, openTabs);

      // Gemini plans AND returns exact action in ONE call
      const response = await geminiClient.planAndExecute({
        userRequest: session.userRequest,
        context,
        actionHistory: session.actions,
        maxActions: settings.maxActionsPerTask,
        memoryContext, // Autonomous Roaming Phase 2
        multiSiteContext, // Autonomous Roaming Phase 5
      });

      debugLog('AgentLoop', 'Gemini response received', {
        status: response.status,
        action: response.nextAction?.action,
        confidence: response.confidence,
      });

      // Check status
      if (response.status === 'done') {
        // ===== FILE DELIVERY CHECK =====
        // Detect if user EXPLICITLY requested a file (not just "make a summary")
        // Must mention specific file format or "file"/"document" keyword
        // Multi-language support: English + Polish
        const explicitFilePatterns = /\b(save|create|generate|make|write|export|download|zapisz|utwórz|wygeneruj|stwórz|wyeksportuj|pobierz|zrób).{0,20}(\.txt|\.pdf|\.docx|\.xlsx|\.csv|\.html|\.xml|\.md|\.json)\b/i;
        const fileKeywordPatterns = /\b(save|create|generate|make|write|export|download|zapisz|utwórz|wygeneruj|stwórz|wyeksportuj|pobierz|zrób).{0,15}(to |as |into |do |jako |w )?(a )?(file|document|plik|dokument)\b/i;
        const formatMentioned = /\b(txt|pdf|docx|xlsx|excel|word|csv|html|xml)( file| plik)?\b/i;
        const fileRequestedInTask = explicitFilePatterns.test(session.userRequest) ||
                                     fileKeywordPatterns.test(session.userRequest) ||
                                     formatMentioned.test(session.userRequest);

        // Check if generate_file was already executed in this session
        const fileWasGenerated = session.actions.some(
          a => a.executedAction && 'action' in a.executedAction && a.executedAction.action === 'generate_file'
        );

        // Check if current response includes a generate_file action (about to be executed)
        const fileInCurrentAction = response.nextAction?.action === 'generate_file';

        // If file was requested but not generated AND not about to be generated, force continuation
        if (fileRequestedInTask && !fileWasGenerated && !fileInCurrentAction) {
          debugLog('AgentLoop', 'File was requested but not generated - forcing continuation');

          // Override the response to force file generation
          response.status = 'in_progress';
          response.nextAction = null;

          // Add a memory note to remind the agent
          memoryManager.recordFailure(
            'Attempted to complete without generating requested file',
            'Must execute generate_file action before marking task as done',
            context.url
          );

          // Continue the loop - don't break
        } else {
          // If there's a generate_file action pending, execute it first before completing
          if (fileInCurrentAction && response.nextAction) {
            debugLog('AgentLoop', 'Executing final generate_file before completing');
            try {
              await performActionInTab(targetTabId, response.nextAction);
              debugLog('AgentLoop', 'File generated successfully');
            } catch (err) {
              debugError('AgentLoop', 'Failed to generate file', err);
            }
          }

          debugLog('AgentLoop', 'Task completed');

          // Cleanup agent-opened tabs (Autonomous Roaming Phase 1)
          if (TAB_MANAGEMENT.AUTO_CLEANUP_ON_SESSION_END) {
            await tabManager.cleanup();
          }

          // Clear memory (Autonomous Roaming Phase 2)
          await memoryManager.clear();

          // Reset recovery manager (Autonomous Roaming Phase 4)
          recoveryManager.reset();

          // Reset site data manager (Autonomous Roaming Phase 5)
          siteDataManager.reset();

          // Check if the task completion message would be a duplicate
          // Use the deduplicator to check similarity with recently sent messages
          const isDuplicateCompletion = messageDeduplicator.isDuplicate(response.thinking);

          // Only broadcast thinking if it's not a duplicate of a recent message
          if (isDuplicateCompletion) {
            await broadcastTaskComplete('Task completed.');
          } else {
            await broadcastTaskComplete(response.thinking);
          }

          // Reset message deduplicator (Phase 7)
          messageDeduplicator.reset();
          await stateManager.endSession();
          break;
        }
      }

      if (response.status === 'error') {
        debugLog('AgentLoop', 'Gemini reported error');
        await broadcastTaskError(response.thinking);
        await stateManager.updateStatus('error');
        break;
      }

      if (response.status === 'needs_clarification') {
        await broadcastClarificationNeeded(response.thinking);
        await stateManager.updateStatus('error');
        break;
      }

      if (!response.nextAction) {
        // If we forced continuation (e.g., file not generated), continue loop to call Gemini again
        if (response.status === 'in_progress') {
          consecutiveNoActionCount++;
          debugLog('AgentLoop', `No action but in_progress - iteration ${consecutiveNoActionCount}/${MAX_NO_ACTION_ITERATIONS}`);

          if (consecutiveNoActionCount >= MAX_NO_ACTION_ITERATIONS) {
            debugLog('AgentLoop', 'Too many iterations without action - forcing error');
            throw new Error('Gemini is not returning actions. Check if tool_config is working.');
          }

          continue;
        }
        throw new Error('No action returned from Gemini');
      }

      // Reset counter when we get an action
      consecutiveNoActionCount = 0;

      const nextAction = response.nextAction;

      // ===== STEP 3: Execute Action =====
      await stateManager.updateStatus('executing');
      await broadcastStatusUpdate('executing', session);
      await broadcastProgressUpdate(session.actions.length + 1, response.thinking);

      debugLog('AgentLoop', 'Executing action...', {
        action: nextAction.action,
        thinking: response.thinking,
      });

      const startTime = Date.now();
      const beforeScreenshot = context.screenshot;

      let executedAction: ComputerUseAction | undefined;
      let success = false;
      let error: string | undefined;

      try {
        // Execute the action directly (no executor needed!)
        await performActionInTab(targetTabId, nextAction);
        executedAction = nextAction;
        success = true;

        // Wait for page to stabilize
        await waitForPageStable(settings.actionDelayMs);

        // Reset retry count on success
        retryCount = 0;
      } catch (execError) {
        error = execError instanceof Error ? execError.message : 'Unknown error';
        success = false;

        debugError('AgentLoop', 'Action execution failed', execError);

        // Record failure in memory (Autonomous Roaming Phase 2)
        memoryManager.recordFailure(
          `${nextAction.action}`,
          error,
          context.url
        );

        // Increment retry count
        retryCount++;

        if (retryCount >= MAX_RETRY_ATTEMPTS) {
          throw new Error(`Action failed after ${MAX_RETRY_ATTEMPTS} attempts: ${error}`);
        }

        // Continue to next iteration to retry
        debugLog('AgentLoop', `Retrying (${retryCount}/${MAX_RETRY_ATTEMPTS})...`);
      }

      const duration = Date.now() - startTime;

      // ===== STEP 4: Capture After State (combined with verification context) =====
      // Capture full context once and reuse for both recording and verification
      // This avoids hitting Chrome's screenshot rate limit
      let afterContext: PageContext | undefined;
      let afterScreenshot: string | undefined;

      try {
        afterContext = await getCurrentPageContext(targetTabId);
        afterScreenshot = afterContext.screenshot;
      } catch (error) {
        debugError('AgentLoop', 'Failed to capture after context', error);
      }

      // ===== STEP 5: Record Action =====
      // Create a PlannedAction from the response for recording purposes
      const plannedAction: PlannedAction = {
        type: nextAction.action as any,
        description: response.thinking,
      };

      const actionRecord = await stateManager.recordAction(
        plannedAction,
        executedAction,
        beforeScreenshot,
        afterScreenshot,
        success,
        error,
        duration
      );

      // Track milestone only if action succeeded
      if (success && executedAction) {
        const milestone = milestoneTracker.trackAction(executedAction, actionRecord, context);
        if (milestone) {
          await broadcastMilestone(milestone);
        }
      }

      // If action failed, continue to retry
      if (!success) {
        continue;
      }

      // ===== STEP 6: Verify Action (Autonomous Roaming Phase 3) =====
      await stateManager.updateStatus('verifying');

      let verification: VerificationResult | undefined;

      if (VERIFICATION_CONFIG.ENABLED &&
          !VERIFICATION_CONFIG.SKIP_VERIFICATION_ACTIONS.includes(nextAction.action as any) &&
          afterContext) {

        // Reuse the after context captured in step 4 (no additional screenshot needed)
        // Verify the action succeeded
        verification = await verifier.verify(
          nextAction,
          context,       // before
          afterContext,  // after (reused from step 4)
          response.thinking
        );

        debugLog('AgentLoop', 'Verification result', {
          success: verification.success,
          confidence: verification.confidence,
          evidence: verification.evidence,
        });

        // Update action record with verification result
        if (actionRecord) {
          actionRecord.verification = verification;
        }

        // Handle verification failure with retry
        if (!verification.success && verification.confidence < VERIFICATION_CONFIG.MIN_CONFIDENCE_TO_PASS) {
          if (verification.suggestedRetry && retryCount < VERIFICATION_CONFIG.MAX_VERIFICATION_RETRIES) {
            debugLog('AgentLoop', 'Verification failed, trying suggested retry', {
              reason: verification.failureReason,
              retry: verification.suggestedRetry.reason,
            });

            // Record the failure in memory
            memoryManager.recordFailure(
              `${nextAction.action} verification failed`,
              verification.failureReason || 'Unknown',
              context.url
            );

            retryCount++;
            // Note: The suggested retry will be handled in the next iteration
            // For now, we continue with the loop which will get fresh AI guidance
          }
        }
      }

      debugLog('AgentLoop', 'Action completed', {
        type: plannedAction.type,
        duration: `${duration}ms`,
        verified: verification?.success ?? 'skipped',
      });

      // ===== STEP 7: Check for Stuck State (Autonomous Roaming Phase 4) =====
      if (ERROR_RECOVERY.ENABLE_AUTO_RECOVERY) {
        // Record result for tracking
        recoveryManager.recordActionResult(success, nextAction, context);

        // Check if stuck
        const stuckState = recoveryManager.checkStuckState(
          session.actions.slice(-10), // Last 10 actions
          context
        );

        if (stuckState.isStuck) {
          debugLog('AgentLoop', 'Stuck state detected', {
            reason: stuckState.reason,
            severity: stuckState.severity,
            details: stuckState.details,
          });

          // Get recovery suggestion
          const hasOtherTabs = session.managedTabIds.length > 0;
          const recovery = recoveryManager.suggestRecovery(
            stuckState,
            context,
            hasOtherTabs
          );

          if (recovery) {
            if (recovery.strategy === 'abort_task') {
              // Graceful abort
              debugLog('AgentLoop', 'Aborting task due to unrecoverable stuck state');
              await broadcastTaskError(
                `Task stuck: ${stuckState.reason}. ${recovery.reason}`
              );
              await stateManager.updateStatus('error');
              recoveryManager.reset();
              break;
            }

            // Execute recovery action
            debugLog('AgentLoop', 'Executing recovery action', {
              strategy: recovery.strategy,
              reason: recovery.reason,
            });

            try {
              await performActionInTab(targetTabId, recovery.action);
              await waitForPageStable(ERROR_RECOVERY.RECOVERY_COOLDOWN_MS);
            } catch (recoveryError) {
              debugError('AgentLoop', 'Recovery action failed', recoveryError);
            }

            // Continue to next iteration with fresh context
            continue;
          }
        }
      }

    } catch (error) {
      debugError('AgentLoop', 'Agent loop error', error);
      await broadcastTaskError(error instanceof Error ? error.message : 'Unknown error');
      await stateManager.updateStatus('error');
      break;
    }
  }

  debugLog('AgentLoop', 'Agent loop ended');
}

// ============ Helper Functions ============

/**
 * Send message to tab with timeout and retry
 * @returns ContentResponse with proper type safety
 */
async function sendMessageToTab(tabId: number, message: ContentMessage, timeoutMs: number = 5000): Promise<ContentResponse> {
  // Create timeout promise
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('Content script communication timeout'));
    }, timeoutMs);
  });

  try {
    debugLog('ServiceWorker', 'Sending message to tab', { tabId, type: message.type });

    // Race between the message send and timeout
    const response = await Promise.race([
      chrome.tabs.sendMessage(tabId, message),
      timeoutPromise
    ]);

    debugLog('ServiceWorker', 'Received response from tab', { tabId });
    return response;
  } catch (error) {
    debugError('ServiceWorker', 'Failed to send message to tab', error);

    // Try to inject content script and retry once
    debugLog('ServiceWorker', 'Attempting to inject content script...');
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/content-script.js']
      });

      // Wait a bit for script to initialize
      await new Promise(r => setTimeout(r, SERVICE_WORKER_DELAYS.CONTENT_SCRIPT_INIT_MS));

      // Create new timeout for retry
      const retryTimeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Content script communication timeout on retry'));
        }, timeoutMs);
      });

      // Retry message with timeout
      debugLog('ServiceWorker', 'Retrying message after injection...');
      const retryResponse = await Promise.race([
        chrome.tabs.sendMessage(tabId, message),
        retryTimeoutPromise
      ]);
      return retryResponse;
    } catch (retryError) {
      debugError('ServiceWorker', 'Failed to inject or retry', retryError);
      throw new Error('Could not communicate with page. Try refreshing the page.');
    }
  }
}

/**
 * Get current page context from target tab
 */
async function getCurrentPageContext(tabId: number): Promise<PageContext> {
  debugLog('ServiceWorker', 'Getting page context...', { tabId });

  // Get tab info
  const tab = await chrome.tabs.get(tabId);

  // Check if tab URL is accessible
  // Chrome's New Tab page looks like Google but is actually chrome://newtab/ which extensions cannot access
  const blockedPrefixes = ['chrome://', 'chrome-search://', 'devtools://', 'chrome-extension://', 'edge://', 'about:'];
  const isBlocked = !tab.url || blockedPrefixes.some(prefix => tab.url!.startsWith(prefix));

  if (isBlocked) {
    // Provide specific guidance for New Tab page (common user confusion)
    const isNewTab = !tab.url || tab.url.includes('newtab') || tab.url === 'chrome://new-tab-page/';
    if (isNewTab) {
      throw new Error('Cannot access the New Tab page. It looks like Google but is a protected Chrome page. Please navigate to an actual website (e.g., type google.com in the address bar and press Enter).');
    }
    throw new Error(`Cannot access this tab. Please navigate to a regular webpage (http:// or https://). Current URL: ${tab.url || 'unknown'}`);
  }

  // Capture screenshot
  debugLog('ServiceWorker', 'Capturing screenshot...');
  const screenshot = await captureWithAdaptiveQuality(tabId);
  debugLog('ServiceWorker', 'Screenshot captured', { size: screenshot.length });

  // Get DOM context from content script
  debugLog('ServiceWorker', 'Getting DOM context from content script...');
  const message: ContentMessage = { type: 'GET_CONTEXT' };
  const response = await sendMessageToTab(tabId, message, 10000);

  // Type guard: check if response is GET_CONTEXT response
  if (!('domSnapshot' in response) || !('viewport' in response)) {
    throw new Error('Invalid response from GET_CONTEXT: missing domSnapshot or viewport');
  }

  const context: PageContext = {
    url: tab.url || '',
    title: tab.title || '',
    screenshot,
    domSnapshot: response.domSnapshot,
    viewport: response.viewport,
    timestamp: new Date(),
  };

  debugLog('ServiceWorker', 'Page context ready', {
    url: context.url,
    interactiveElements: context.domSnapshot.interactiveElements.length,
  });

  return context;
}

/**
 * Perform Computer Use action in target tab via content script
 * Autonomous Roaming Phase 1: Tab actions are handled directly in service worker
 */
async function performActionInTab(tabId: number, action: ComputerUseAction): Promise<void> {
  debugLog('ServiceWorker', 'Performing action in tab', { tabId, action: action.action });

  // Handle tab actions directly in service worker (Autonomous Roaming Phase 1)
  if (action.action === 'open_tab') {
    const session = stateManager.getCurrentSession();
    if (!session) {
      throw new Error('No active session');
    }

    // Check tab limit
    if (tabManager.isAtLimit()) {
      throw new Error(`Tab limit reached (${TAB_MANAGEMENT.MAX_TABS}). Close a tab first.`);
    }

    const newTabId = await tabManager.openTab(action.url, action.purpose);
    session.managedTabIds.push(newTabId);
    session.targetTabId = newTabId; // Switch to new tab

    debugLog('ServiceWorker', 'Opened new tab', { newTabId, url: action.url });
    return;
  }

  if (action.action === 'close_tab') {
    const session = stateManager.getCurrentSession();
    if (!session) {
      throw new Error('No active session');
    }

    const tabToClose = action.tabId || session.targetTabId;
    if (!tabToClose) {
      throw new Error('No tab to close');
    }

    // Clear site data for this tab (Autonomous Roaming Phase 5)
    siteDataManager.clearTab(tabToClose);

    await tabManager.closeTab(tabToClose);
    session.managedTabIds = session.managedTabIds.filter(id => id !== tabToClose);

    // If we closed the current tab, switch back to initial tab
    if (tabToClose === session.targetTabId) {
      session.targetTabId = session.initialTabId;
      if (session.initialTabId) {
        await tabManager.switchTo(session.initialTabId);
      }
    }

    debugLog('ServiceWorker', 'Closed tab', { tabToClose });
    return;
  }

  if (action.action === 'switch_tab') {
    const session = stateManager.getCurrentSession();
    if (!session) {
      throw new Error('No active session');
    }

    await tabManager.switchTo(action.tabId);
    session.targetTabId = action.tabId;

    debugLog('ServiceWorker', 'Switched to tab', { tabId: action.tabId });
    return;
  }

  // Handle file generation (Phase 6)
  if (action.action === 'generate_file') {
    debugLog('ServiceWorker', 'Generating file', {
      fileType: action.fileType,
      filename: action.filename,
    });

    const result = await fileGenerator.generateAndDownload(
      action.fileType,
      action.filename,
      action.content
    );

    if (!result.success) {
      throw new Error(`File generation failed: ${result.error}`);
    }

    debugLog('ServiceWorker', 'File generated successfully', {
      downloadId: result.downloadId,
    });
    return;
  }

  // Handle message action - send chat message to UI (Phase 7)
  if (action.action === 'message') {
    // Check for duplicate/similar messages
    if (messageDeduplicator.isDuplicate(action.text)) {
      debugLog('ServiceWorker', 'Skipping duplicate message', { text: action.text.substring(0, 50) });
      return;
    }

    debugLog('ServiceWorker', 'Sending message to user', { text: action.text });

    // Record the message for deduplication
    messageDeduplicator.record(action.text);

    // Send message to UI
    chrome.runtime.sendMessage({
      type: 'AGENT_MESSAGE',
      text: action.text,
    } as UIMessage).catch(() => {
      // UI might not be listening
    });

    return;
  }

  // For all other actions, send to content script
  const message: ContentMessage = {
    type: 'PERFORM_ACTION',
    action,
  };

  await sendMessageToTab(tabId, message, 10000);
  debugLog('ServiceWorker', 'Action performed successfully');
}

/**
 * Get active tab
 */
async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

/**
 * Wait for page to stabilize after action
 */
async function waitForPageStable(delayMs: number = SERVICE_WORKER_DELAYS.PAGE_STABLE_MS): Promise<void> {
  debugLog('ServiceWorker', `Waiting ${delayMs}ms for page to stabilize...`);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

// ============ Broadcasting ============

/**
 * Broadcast status update to all UI listeners
 */
async function broadcastStatusUpdate(
  status: AgentSession['status'],
  session: AgentSession | null
): Promise<void> {
  const message: UIMessage = {
    type: 'STATUS_UPDATE',
    status,
    session,
  };

  await chrome.runtime.sendMessage(message).catch(() => {
    // Ignore if no listeners
  });
}

/**
 * Broadcast progress update
 */
async function broadcastProgressUpdate(step: number, description: string): Promise<void> {
  const message: UIMessage = {
    type: 'PROGRESS_UPDATE',
    step,
    description,
  };

  await chrome.runtime.sendMessage(message).catch(() => {});
}

/**
 * Broadcast task complete
 */
async function broadcastTaskComplete(summary: string): Promise<void> {
  const message: UIMessage = {
    type: 'TASK_COMPLETE',
    summary,
  };

  await chrome.runtime.sendMessage(message).catch(() => {});
}

/**
 * Broadcast task error
 */
async function broadcastTaskError(error: string): Promise<void> {
  const message: UIMessage = {
    type: 'TASK_ERROR',
    error,
  };

  await chrome.runtime.sendMessage(message).catch(() => {});
}

/**
 * Broadcast clarification needed
 */
async function broadcastClarificationNeeded(question: string): Promise<void> {
  const message: UIMessage = {
    type: 'CLARIFICATION_NEEDED',
    question,
  };

  await chrome.runtime.sendMessage(message).catch(() => {});
}

/**
 * Broadcast milestone completed
 */
async function broadcastMilestone(description: string): Promise<void> {
  const message: UIMessage = {
    type: 'MILESTONE_COMPLETED',
    description,
  };

  await chrome.runtime.sendMessage(message).catch(() => {});
}

debugLog('ServiceWorker', 'Service worker loaded');
