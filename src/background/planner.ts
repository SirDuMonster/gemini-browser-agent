import type {
  PlannerRequest,
  PageContext,
  ActionRecord,
  ComputerUseAction,
} from '../shared/types';
import { geminiClient } from '../api/gemini-client';
import { debugLog, debugError } from '../shared/constants';
import { getSettings } from '../shared/utils/storage-utils';

/**
 * Planner - High-level wrapper for Gemini unified planning + execution
 */
export class Planner {
  /**
   * Plan AND execute next action in one call
   */
  async planAndExecute(
    userRequest: string,
    context: PageContext,
    actionHistory: ActionRecord[]
  ): Promise<{
    thinking: string;
    nextAction: ComputerUseAction | null;
    status: string;
    confidence: number;
  }> {
    debugLog('Planner', 'Planning and executing next action...', {
      userRequest: userRequest.substring(0, 50) + '...',
      url: context.url,
      historyLength: actionHistory.length,
    });

    try {
      // Load settings to get API key
      const settings = await getSettings();

      // Update API key if needed
      if (settings.googleAiApiKey) {
        geminiClient.setApiKey(settings.googleAiApiKey);
      }

      // Build request
      const request: PlannerRequest = {
        userRequest,
        context,
        actionHistory,
        maxActions: settings.maxActionsPerTask,
      };

      // Call Gemini API
      const response = await geminiClient.planAndExecute(request);

      debugLog('Planner', 'Planning and execution complete', {
        status: response.status,
        action: response.nextAction?.action,
        confidence: response.confidence,
      });

      // Log thinking process if enabled
      if (settings.showThinkingProcess && settings.debugMode) {
        debugLog('Planner:Thinking', response.thinking);
      }

      return response;
    } catch (error) {
      debugError('Planner', 'Planning/execution failed', error);

      // Return error response
      return {
        thinking: `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        nextAction: null,
        status: 'error',
        confidence: 0,
      };
    }
  }

  /**
   * Check if domain is blocked (P1 - Issue #3)
   * Fixed: Proper domain matching instead of permissive .includes()
   */
  async isBlockedDomain(url: string): Promise<boolean> {
    try {
      const settings = await getSettings();
      const domain = new URL(url).hostname.toLowerCase();

      // Check against blocked patterns
      for (const pattern of settings.blockedDomains) {
        if (this.matchesDomainPattern(domain, pattern.toLowerCase())) {
          debugLog('Planner', 'Domain blocked', { domain, pattern });
          return true;
        }
      }

      return false;
    } catch (error) {
      debugError('Planner', 'Error checking blocked domain', error);
      return false;
    }
  }

  /**
   * Match domain against pattern (P1 - Issue #3)
   * Supports:
   * - Exact match: "bank.com" matches "bank.com"
   * - Subdomain match: "bank" matches "*.bank.com" and "bank.com"
   * - TLD pattern: ".gov" matches "*.gov"
   * - Wildcard: "*.bank.com" matches "api.bank.com"
   */
  private matchesDomainPattern(domain: string, pattern: string): boolean {
    // TLD pattern (e.g., ".gov", ".mil")
    if (pattern.startsWith('.')) {
      return domain.endsWith(pattern);
    }

    // Exact domain match
    if (domain === pattern) {
      return true;
    }

    // Subdomain wildcard (e.g., "*.bank.com")
    // M7 Fix: Prevent ReDoS by limiting pattern length and complexity
    if (pattern.includes('*')) {
      if (pattern.length > 100) {
        debugLog('Planner', 'Pattern too long, skipping regex match', { pattern: pattern.substring(0, 50) });
        return false;
      }
      // Escape special regex chars except * which we convert to .*
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]*');
      const regex = new RegExp('^' + escaped + '$');
      return regex.test(domain);
    }

    // Pattern is a keyword - check if it's a full domain component
    // "bank" should match "bank.com", "api.bank.com", but NOT "snowbank.com"
    const parts = domain.split('.');
    for (let i = 0; i < parts.length; i++) {
      // Check if pattern matches this part exactly
      if (parts[i] === pattern) {
        return true;
      }
      // Check if remaining parts form the pattern
      // e.g., "bank.com" when pattern is "bank"
      if (i > 0 && parts.slice(i).join('.') === pattern) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get planner statistics
   */
  getStats() {
    return {
      model: geminiClient.getModel(),
    };
  }
}

/**
 * Singleton instance
 */
export const planner = new Planner();
