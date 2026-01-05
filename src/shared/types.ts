// ============ Core Types ============

export interface AgentSession {
  id: string;
  startedAt: Date;
  userRequest: string;
  status: 'planning' | 'executing' | 'verifying' | 'completed' | 'error';
  actions: ActionRecord[];
  currentContext: PageContext | null;
  // Tab management (Autonomous Roaming Phase 1)
  targetTabId?: number; // Current working tab (can change during task)
  initialTabId?: number; // Tab where task started (never changes)
  managedTabIds: number[]; // All tabs opened by agent
}

// ============ Tab State (Autonomous Roaming Phase 1) ============

export interface TabState {
  id: number;
  url: string;
  title: string;
  purpose?: string; // Why the agent opened this tab
  createdAt: Date;
  isAgentOpened: boolean; // true if agent opened, false if user's existing tab
}

export interface PageContext {
  url: string;
  title: string;
  screenshot: string; // base64
  domSnapshot: DOMSnapshot;
  viewport: { width: number; height: number };
  timestamp: Date;
}

export interface DOMSnapshot {
  accessibilityTree: AccessibilityNode[];
  interactiveElements: InteractiveElement[];
  forms: FormInfo[];
  links: LinkInfo[];
}

export interface AccessibilityNode {
  role: string;
  name: string;
  description?: string;
  bounds: BoundingBox;
  children?: AccessibilityNode[];
}

export interface InteractiveElement {
  id: string;
  tagName: string;
  type?: string;
  text: string;
  placeholder?: string;
  bounds: BoundingBox;
  selector: string;
  isVisible: boolean;
  isEnabled: boolean;
}

export interface FormInfo {
  id: string;
  action: string;
  method: string;
  fields: InteractiveElement[];
}

export interface LinkInfo {
  text: string;
  href: string;
  bounds: BoundingBox;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ============ Planner Types (Gemini) ============

export interface PlannerRequest {
  userRequest: string;
  context: PageContext;
  actionHistory: ActionRecord[];
  maxActions?: number;
  memoryContext?: string; // Compact memory summary for AI (Autonomous Roaming Phase 2)
  multiSiteContext?: MultiSiteContext; // Cross-site context (Autonomous Roaming Phase 5)
}

/**
 * M10 Fix: Document status values.
 * Note: 'continue' means keep executing, maps to 'in_progress' in UI/internal code.
 */
export interface PlannerResponse {
  thinking: string;
  nextAction: ComputerUseAction | null;
  expectedOutcome: string;
  /** 'continue' = keep executing (shown as 'in_progress' internally), 'done' = task complete */
  status: 'continue' | 'done' | 'error' | 'needs_clarification';
  clarificationQuestion?: string;
  confidenceScore: number;
}

export interface PlannedAction {
  type: ActionType;
  description: string;
  target?: {
    description: string;
    hint?: string;
  };
  value?: string;
  waitAfter?: number;
}

/**
 * High-level action type for planning.
 * M9 Fix: Documented relationship with ComputerUseAction.
 * Note: ActionType is used for high-level planning descriptions,
 * while ComputerUseAction represents the actual low-level browser actions.
 */
export type ActionType =
  | 'click'
  | 'type'
  | 'scroll'
  | 'navigate'
  | 'select'
  | 'hover'
  | 'wait'
  | 'screenshot'
  | 'extract_data'
  | 'go_back'
  | 'go_forward'
  | 'refresh'
  | 'new_tab'
  | 'close_tab'
  | 'switch_tab';

// ============ Computer Use Action Types ============

/**
 * Low-level computer use action for execution.
 * Maps to specific browser operations.
 */
export type ComputerUseAction =
  // Mouse actions
  | { action: 'mouse_move'; coordinate: [number, number] }
  | { action: 'left_click' }
  | { action: 'left_click_drag'; coordinate: [number, number] }
  | { action: 'right_click' }
  | { action: 'double_click' }
  | { action: 'middle_click' }
  // Input actions
  | { action: 'key'; text: string }
  | { action: 'type'; text: string }
  // Screenshot/cursor
  | { action: 'screenshot' }
  | { action: 'cursor_position' }
  // Tab management (Autonomous Roaming Phase 1)
  | { action: 'open_tab'; url: string; purpose?: string }
  | { action: 'close_tab'; tabId?: number }
  | { action: 'switch_tab'; tabId: number }
  // Navigation (Autonomous Roaming Phase 1)
  | { action: 'scroll'; direction: 'up' | 'down'; amount?: number }
  | { action: 'go_back' }
  | { action: 'go_forward' }
  | { action: 'refresh' }
  // Utility (Autonomous Roaming Phase 1)
  | { action: 'wait'; duration: number }
  | { action: 'extract_text'; selector?: string }
  // File generation (Phase 6)
  | {
      action: 'generate_file';
      fileType: FileGenerationType;
      filename: string;
      content: FileContent;
    }
  // Chat communication (Phase 7)
  | { action: 'message'; text: string };

// ============ File Generation Types (Phase 6) ============

export type FileGenerationType =
  | 'txt'
  | 'html'
  | 'xml'
  | 'json'
  | 'csv'
  | 'md'
  | 'docx'
  | 'xlsx'
  | 'pdf';

export interface FileContent {
  // For simple text-based files (txt, html, xml, json, csv, md)
  text?: string;

  // For structured documents (docx)
  document?: {
    title?: string;
    paragraphs?: Array<{
      text: string;
      heading?: 'h1' | 'h2' | 'h3';
      bold?: boolean;
      italic?: boolean;
    }>;
    tables?: Array<{
      headers: string[];
      rows: string[][];
    }>;
  };

  // For spreadsheets (xlsx)
  spreadsheet?: {
    sheetName?: string;
    headers?: string[];
    rows?: (string | number)[][];
  };

  // For PDF
  pdf?: {
    title?: string;
    content: Array<{
      type: 'text' | 'heading' | 'table';
      text?: string;
      level?: 1 | 2 | 3;
      tableData?: {
        headers: string[];
        rows: string[][];
      };
    }>;
  };
}

// ============ Action Records ============

/**
 * Record of an executed action
 * L8 Fix: Document nullable fields
 */
export interface ActionRecord {
  id: string;
  timestamp: Date;
  plannedAction: PlannedAction;
  /** The actual action that was executed. Undefined if action failed before execution. */
  executedAction?: ComputerUseAction;
  beforeScreenshot: string;
  /** Screenshot after action. Undefined if capture failed or action errored. */
  afterScreenshot?: string;
  success: boolean;
  /** Error message if action failed. Undefined on success. */
  error?: string;
  duration: number;
  /** Verification result. Undefined if verification was skipped. */
  verification?: VerificationResult;
}

// ============ User-Facing Types ============

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  attachments?: {
    type: 'screenshot' | 'extracted_data';
    data: string;
  }[];
}

export interface TaskProgress {
  sessionId: string;
  totalSteps: number;
  completedSteps: number;
  currentStep: string;
  status: AgentSession['status'];
}

// ============ Settings ============

export interface AgentSettings {
  googleAiApiKey: string;

  // Behavior
  maxActionsPerTask: number;
  actionDelayMs: number;
  screenshotQuality: 'low' | 'medium' | 'high' | 'adaptive';

  // Safety
  requireConfirmationFor: ActionType[];
  blockedDomains: string[];

  // UI
  showThinkingProcess: boolean;
  showActionHighlights: boolean;
  theme: 'light' | 'dark' | 'system';
  debugMode: boolean;
}

// ============ Message Types ============

export type BackgroundMessage =
  | { type: 'START_TASK'; userRequest: string }
  | { type: 'STOP_TASK' }
  | { type: 'GET_STATUS' }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<AgentSettings> }
  | { type: 'FORCE_CLEAR' }
  | { type: 'CONTENT_SCRIPT_READY' }
  | { type: 'PAGE_CHANGED' };

export type ContentMessage =
  | { type: 'GET_CONTEXT' }
  | { type: 'PERFORM_ACTION'; action: ComputerUseAction }
  | { type: 'HIGHLIGHT_ELEMENT'; selector: string }
  | { type: 'CLEAR_HIGHLIGHTS' }
  | { type: 'TAKE_SCREENSHOT' };

/**
 * Content Script Response Types - matches what content script returns
 */
export type ContentResponse =
  | {
      // GET_CONTEXT response
      domSnapshot: DOMSnapshot;
      viewport: { width: number; height: number };
    }
  | {
      // PERFORM_ACTION response
      success: true;
      cursorPosition: { x: number; y: number };
    }
  | {
      // HIGHLIGHT_ELEMENT / CLEAR_HIGHLIGHTS response
      success: true;
    }
  | {
      // Error response (any message can return this)
      error: string;
    };

export type UIMessage =
  | { type: 'STATUS_UPDATE'; status: AgentSession['status']; session: AgentSession | null }
  | { type: 'PROGRESS_UPDATE'; step: number; description: string }
  | { type: 'TASK_COMPLETE'; summary: string }
  | { type: 'TASK_ERROR'; error: string }
  | { type: 'CLARIFICATION_NEEDED'; question: string }
  | { type: 'ACTION_EXECUTED'; action: ActionRecord }
  | { type: 'MILESTONE_COMPLETED'; description: string }
  | { type: 'AGENT_MESSAGE'; text: string }; // Chat message from agent to user

// ============ Memory Types (Autonomous Roaming Phase 2) ============

export interface GoalNode {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  parentId?: string; // For sub-goals
  createdAt: Date;
  completedAt?: Date;
}

export interface Fact {
  key: string; // e.g., "target_email", "search_query"
  value: string; // The extracted/remembered value
  source: string; // URL or action that produced this
  sourceTabId?: number; // Which tab discovered this (Autonomous Roaming Phase 5)
  sourceDomain?: string; // Domain for easier grouping (Autonomous Roaming Phase 5)
  timestamp: Date;
  confidence: number; // 0.0 - 1.0
}

export interface FailedStrategy {
  description: string; // What was attempted
  reason: string; // Why it failed
  context: string; // URL/page where it failed
  timestamp: Date;
}

export interface AgentMemory {
  goals: GoalNode[];
  facts: Fact[];
  visitedUrls: string[];
  failedStrategies: FailedStrategy[];
  sessionStartedAt: Date;
}

// ============ Verification Types (Autonomous Roaming Phase 3) ============

export interface VerificationResult {
  success: boolean;
  confidence: number; // 0.0 - 1.0
  evidence: string; // What changed/didn't change
  failureReason?: string; // Why verification failed
  suggestedRetry?: RetryStrategy;
}

export interface RetryStrategy {
  action: ComputerUseAction;
  reason: string; // Why this retry might work
  confidence: number; // Likelihood of success
}

export type VerificationMethod =
  | 'url_change' // Check if URL changed
  | 'dom_change' // Check if DOM elements changed
  | 'element_appeared' // Check if specific element appeared
  | 'element_gone' // Check if element disappeared
  | 'text_change' // Check if text content changed
  | 'input_filled'; // Check if input has value

// ============ Error Recovery Types (Autonomous Roaming Phase 4) ============

export type StuckReason =
  | 'repeated_failure' // Same action failing multiple times
  | 'no_progress' // URL and DOM unchanged for N actions
  | 'verification_loop' // Verification keeps failing
  | 'modal_blocking' // Modal/popup blocking interaction
  | 'page_unresponsive'; // Content script not responding

export interface StuckState {
  isStuck: boolean;
  reason?: StuckReason;
  severity: 'low' | 'medium' | 'high';
  consecutiveFailures: number;
  actionsSinceProgress: number;
  details?: string;
}

export type EscapeStrategy =
  | 'dismiss_modal' // Press Escape to dismiss modal
  | 'go_back' // Navigate back
  | 'close_tab' // Close current tab, return to initial
  | 'refresh' // Refresh page
  | 'scroll_away' // Scroll to different area
  | 'wait_longer' // Wait for page to stabilize
  | 'abort_task'; // Give up gracefully

export interface RecoveryAction {
  strategy: EscapeStrategy;
  action: ComputerUseAction;
  reason: string;
  confidence: number;
}

// ============ Multi-Site Types (Autonomous Roaming Phase 5) ============

export interface TabContextSnapshot {
  tabId: number;
  url: string;
  title: string;
  domain: string;
  capturedAt: Date;
  keyData: Record<string, string>; // Extracted key-value pairs from this tab
}

export interface SiteData {
  domain: string;
  tabIds: number[]; // Which tabs have visited this domain
  facts: string[]; // Fact keys from this domain
  lastVisited: Date;
  visitCount: number;
}

export interface CrossSiteCorrelation {
  key: string; // e.g., "product_name", "company_name"
  values: Record<number, string>; // tabId → value (using Record for JSON serialization)
  domains: string[]; // Which domains have this data
  confidence: number;
}

export interface MultiSiteContext {
  openTabs: Array<{
    id: number;
    url: string;
    domain: string;
    purpose?: string;
    keyData: Record<string, string>;
  }>;
  siteIndex: Record<string, SiteData>;
  correlations: CrossSiteCorrelation[];
  currentTabId: number;
}
