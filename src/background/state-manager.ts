import type {
  AgentSession,
  ActionRecord,
  PageContext,
  PlannedAction,
  ComputerUseAction,
} from '../shared/types';
import { debugLog, debugError, SCREENSHOT_RETENTION } from '../shared/constants';
import { getSession, saveSession, clearSession } from '../shared/utils/storage-utils';

/**
 * State Manager - Manages agent session state
 */
export class StateManager {
  private currentSession: AgentSession | null = null;

  /**
   * Initialize state manager (load from storage)
   */
  async initialize(): Promise<void> {
    try {
      this.currentSession = await getSession();

      if (this.currentSession) {
        debugLog('StateManager', 'Session loaded from storage', {
          id: this.currentSession.id,
          status: this.currentSession.status,
          actions: this.currentSession.actions.length,
        });
      } else {
        debugLog('StateManager', 'No active session');
      }
    } catch (error) {
      debugError('StateManager', 'Failed to initialize', error);
      this.currentSession = null;
    }
  }

  /**
   * Create a new session
   */
  async createSession(userRequest: string): Promise<AgentSession> {
    debugLog('StateManager', 'Creating new session', { userRequest });

    const session: AgentSession = {
      id: this.generateSessionId(),
      startedAt: new Date(),
      userRequest,
      status: 'planning',
      actions: [],
      currentContext: null,
      managedTabIds: [], // Autonomous Roaming Phase 1
    };

    this.currentSession = session;
    await saveSession(session);

    debugLog('StateManager', 'Session created', { id: session.id });

    return session;
  }

  /**
   * Get current session
   */
  getCurrentSession(): AgentSession | null {
    return this.currentSession;
  }

  /**
   * Update session status
   */
  async updateStatus(
    status: AgentSession['status']
  ): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    debugLog('StateManager', 'Updating session status', {
      from: this.currentSession.status,
      to: status,
    });

    this.currentSession.status = status;
    await saveSession(this.currentSession);
  }

  /**
   * Update current context
   */
  async updateContext(context: PageContext): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    debugLog('StateManager', 'Updating context', {
      url: context.url,
      title: context.title,
    });

    this.currentSession.currentContext = context;
    await saveSession(this.currentSession);
  }

  /**
   * Record a new action
   */
  async recordAction(
    plannedAction: PlannedAction,
    executedAction: ComputerUseAction | undefined,
    beforeScreenshot: string,
    afterScreenshot: string | undefined,
    success: boolean,
    error?: string,
    duration?: number
  ): Promise<ActionRecord> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    const action: ActionRecord = {
      id: this.generateActionId(),
      timestamp: new Date(),
      plannedAction,
      executedAction,
      beforeScreenshot,
      afterScreenshot,
      success,
      error,
      duration: duration || 0,
    };

    debugLog('StateManager', 'Recording action', {
      type: plannedAction.type,
      success,
      actionCount: this.currentSession.actions.length + 1,
    });

    this.currentSession.actions.push(action);

    // P0 - Issue #2: Screenshot retention limits
    // Clear old screenshots to prevent privacy issues and excessive memory usage
    this.clearOldScreenshots();

    await saveSession(this.currentSession);

    return action;
  }

  /**
   * Clear old screenshots beyond retention limit (P0 - Issue #2)
   */
  private clearOldScreenshots(): void {
    if (!this.currentSession) {
      return;
    }

    const actionsCount = this.currentSession.actions.length;
    if (actionsCount > SCREENSHOT_RETENTION.MAX_SCREENSHOTS_IN_MEMORY) {
      const clearUntil = actionsCount - SCREENSHOT_RETENTION.MAX_SCREENSHOTS_IN_MEMORY;

      debugLog('StateManager', 'Clearing old screenshots', {
        total: actionsCount,
        clearing: clearUntil,
        keeping: SCREENSHOT_RETENTION.MAX_SCREENSHOTS_IN_MEMORY,
      });

      for (let i = 0; i < clearUntil; i++) {
        if (this.currentSession.actions[i].beforeScreenshot !== SCREENSHOT_RETENTION.SCREENSHOT_PLACEHOLDER) {
          this.currentSession.actions[i].beforeScreenshot = SCREENSHOT_RETENTION.SCREENSHOT_PLACEHOLDER;
        }
        if (this.currentSession.actions[i].afterScreenshot) {
          this.currentSession.actions[i].afterScreenshot = SCREENSHOT_RETENTION.SCREENSHOT_PLACEHOLDER;
        }
      }
    }
  }

  /**
   * Get action history for current session
   */
  getActionHistory(): ActionRecord[] {
    if (!this.currentSession) {
      return [];
    }
    return this.currentSession.actions;
  }

  /**
   * End current session
   * P0 - Issue #2: Clear all screenshots on session end
   */
  async endSession(): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    debugLog('StateManager', 'Ending session', {
      id: this.currentSession.id,
      status: this.currentSession.status,
      totalActions: this.currentSession.actions.length,
    });

    // P0 - Issue #2: Clear all screenshots before ending session
    if (SCREENSHOT_RETENTION.CLEAR_ON_SESSION_END) {
      debugLog('StateManager', 'Clearing all screenshots on session end');
      this.currentSession.actions.forEach(action => {
        action.beforeScreenshot = SCREENSHOT_RETENTION.SCREENSHOT_PLACEHOLDER;
        action.afterScreenshot = SCREENSHOT_RETENTION.SCREENSHOT_PLACEHOLDER;
      });
      await saveSession(this.currentSession);
    }

    // Clear from memory and storage
    this.currentSession = null;
    await clearSession();
  }

  /**
   * Cancel current session
   */
  async cancelSession(): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    debugLog('StateManager', 'Canceling session', {
      id: this.currentSession.id,
    });

    this.currentSession.status = 'error';
    await saveSession(this.currentSession);

    this.currentSession = null;
    await clearSession();
  }

  /**
   * Check if a session is active
   */
  hasActiveSession(): boolean {
    if (!this.currentSession) {
      return false;
    }

    // Only consider sessions in active states as "active"
    const activeStatuses: AgentSession['status'][] = ['planning', 'executing', 'verifying'];
    return activeStatuses.includes(this.currentSession.status);
  }

  /**
   * Get session statistics
   */
  getSessionStats() {
    if (!this.currentSession) {
      return null;
    }

    const successfulActions = this.currentSession.actions.filter(a => a.success).length;
    const failedActions = this.currentSession.actions.filter(a => !a.success).length;
    const totalDuration = this.currentSession.actions.reduce((sum, a) => sum + a.duration, 0);

    return {
      sessionId: this.currentSession.id,
      status: this.currentSession.status,
      startedAt: this.currentSession.startedAt,
      totalActions: this.currentSession.actions.length,
      successfulActions,
      failedActions,
      totalDuration,
      averageDuration: this.currentSession.actions.length > 0
        ? totalDuration / this.currentSession.actions.length
        : 0,
    };
  }

  /**
   * Generate unique session ID
   * P3 - Issue #23: Fixed deprecated .substr() usage
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Generate unique action ID
   * P3 - Issue #23: Fixed deprecated .substr() usage
   */
  private generateActionId(): string {
    return `action_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

/**
 * Singleton instance
 */
export const stateManager = new StateManager();
