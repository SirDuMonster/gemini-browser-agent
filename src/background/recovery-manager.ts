/**
 * Recovery Manager - Autonomous Roaming Phase 4
 * Detects stuck states and suggests escape strategies
 */

import type {
  ComputerUseAction,
  ActionRecord,
  PageContext,
  StuckState,
  RecoveryAction,
} from '../shared/types';
import { ERROR_RECOVERY, debugLog } from '../shared/constants';

class RecoveryManager {
  private consecutiveFailures: number = 0;
  private lastSuccessfulUrl: string = '';
  private lastSuccessfulDomHash: string = '';
  private actionsSinceProgress: number = 0;
  private recoveryAttempts: number = 0;
  private lastActionTypes: string[] = [];

  /**
   * Check if agent is stuck
   */
  checkStuckState(
    recentActions: ActionRecord[],
    currentContext: PageContext
  ): StuckState {
    // Check for repeated failures
    const repeatedFailure = this.checkRepeatedFailures(recentActions);
    if (repeatedFailure.isStuck) return repeatedFailure;

    // Check for no progress
    const noProgress = this.checkNoProgress(currentContext);
    if (noProgress.isStuck) return noProgress;

    // Check for verification loop
    const verificationLoop = this.checkVerificationLoop(recentActions);
    if (verificationLoop.isStuck) return verificationLoop;

    return {
      isStuck: false,
      severity: 'low',
      consecutiveFailures: this.consecutiveFailures,
      actionsSinceProgress: this.actionsSinceProgress,
    };
  }

  /**
   * Suggest recovery action based on stuck state
   */
  suggestRecovery(
    stuckState: StuckState,
    _context: PageContext,
    hasOtherTabs: boolean
  ): RecoveryAction | null {
    if (!stuckState.isStuck) return null;

    if (this.recoveryAttempts >= ERROR_RECOVERY.MAX_RECOVERY_ATTEMPTS) {
      return {
        strategy: 'abort_task',
        action: { action: 'screenshot' }, // Capture final state
        reason: 'Max recovery attempts reached, aborting task',
        confidence: 1.0,
      };
    }

    this.recoveryAttempts++;

    switch (stuckState.reason) {
      case 'modal_blocking':
        return this.createDismissModalAction();

      case 'repeated_failure':
        return this.createEscapeAction(stuckState, hasOtherTabs);

      case 'no_progress':
        return this.createProgressAction();

      case 'verification_loop':
        return this.createVerificationRecovery();

      case 'page_unresponsive':
        return {
          strategy: 'refresh',
          action: { action: 'refresh' },
          reason: 'Page unresponsive, refreshing',
          confidence: 0.7,
        };

      default:
        return {
          strategy: 'go_back',
          action: { action: 'go_back' },
          reason: 'Unknown stuck state, going back',
          confidence: 0.5,
        };
    }
  }

  /**
   * Record action result for tracking
   */
  recordActionResult(
    success: boolean,
    action: ComputerUseAction,
    context: PageContext
  ): void {
    if (success) {
      this.consecutiveFailures = 0;
      this.checkAndUpdateProgress(context);
    } else {
      this.consecutiveFailures++;
      this.actionsSinceProgress++;
    }

    this.lastActionTypes.push(action.action);
    if (this.lastActionTypes.length > 10) {
      this.lastActionTypes.shift();
    }
  }

  /**
   * Reset recovery state (on task start/end)
   */
  reset(): void {
    this.consecutiveFailures = 0;
    this.lastSuccessfulUrl = '';
    this.lastSuccessfulDomHash = '';
    this.actionsSinceProgress = 0;
    this.recoveryAttempts = 0;
    this.lastActionTypes = [];
    debugLog('RecoveryManager', 'State reset');
  }

  /**
   * Get current recovery stats (for debugging)
   */
  getStats(): {
    consecutiveFailures: number;
    actionsSinceProgress: number;
    recoveryAttempts: number;
  } {
    return {
      consecutiveFailures: this.consecutiveFailures,
      actionsSinceProgress: this.actionsSinceProgress,
      recoveryAttempts: this.recoveryAttempts,
    };
  }

  // ============ Private Detection Methods ============

  /**
   * Check for repeated failures on same action type
   */
  private checkRepeatedFailures(actions: ActionRecord[]): StuckState {
    const recentActions = actions.slice(-ERROR_RECOVERY.MAX_CONSECUTIVE_FAILURES);

    if (recentActions.length < ERROR_RECOVERY.MAX_CONSECUTIVE_FAILURES) {
      return this.createNotStuckState();
    }

    // Check if all recent actions failed
    const allFailed = recentActions.every(a => !a.success);
    if (!allFailed) {
      return this.createNotStuckState();
    }

    // Check if same action type repeated
    const actionTypes = recentActions.map(a => a.executedAction?.action);
    const sameType = actionTypes.every(t => t === actionTypes[0]);

    if (sameType) {
      return {
        isStuck: true,
        reason: 'repeated_failure',
        severity: 'high',
        consecutiveFailures: recentActions.length,
        actionsSinceProgress: this.actionsSinceProgress,
        details: `Action "${actionTypes[0]}" failed ${recentActions.length} times`,
      };
    }

    return this.createNotStuckState();
  }

  /**
   * Check for no progress (same URL and DOM for too long)
   */
  private checkNoProgress(context: PageContext): StuckState {
    const currentHash = this.hashDomState(context);

    if (this.actionsSinceProgress >= ERROR_RECOVERY.MAX_ACTIONS_WITHOUT_PROGRESS) {
      // Check if URL and DOM are same as last success
      const sameUrl = context.url === this.lastSuccessfulUrl;
      const sameDom = currentHash === this.lastSuccessfulDomHash;

      if (sameUrl && sameDom) {
        return {
          isStuck: true,
          reason: 'no_progress',
          severity: 'medium',
          consecutiveFailures: this.consecutiveFailures,
          actionsSinceProgress: this.actionsSinceProgress,
          details: `No visible changes in ${this.actionsSinceProgress} actions`,
        };
      }
    }

    return this.createNotStuckState();
  }

  /**
   * Check for verification loop
   */
  private checkVerificationLoop(actions: ActionRecord[]): StuckState {
    const recentActions = actions.slice(-ERROR_RECOVERY.MAX_VERIFICATION_FAILURES);

    // Count verification failures
    const verificationFailures = recentActions.filter(
      a => a.verification && !a.verification.success
    ).length;

    if (verificationFailures >= ERROR_RECOVERY.MAX_VERIFICATION_FAILURES) {
      return {
        isStuck: true,
        reason: 'verification_loop',
        severity: 'medium',
        consecutiveFailures: this.consecutiveFailures,
        actionsSinceProgress: this.actionsSinceProgress,
        details: `Verification failed ${verificationFailures} times in last ${recentActions.length} actions`,
      };
    }

    return this.createNotStuckState();
  }

  /**
   * Create a "not stuck" state response
   */
  private createNotStuckState(): StuckState {
    return {
      isStuck: false,
      severity: 'low',
      consecutiveFailures: this.consecutiveFailures,
      actionsSinceProgress: this.actionsSinceProgress,
    };
  }

  // ============ Private Recovery Action Creators ============

  /**
   * Create action to dismiss modal (press Escape)
   */
  private createDismissModalAction(): RecoveryAction {
    return {
      strategy: 'dismiss_modal',
      action: { action: 'key', text: 'Escape' },
      reason: 'Modal detected, pressing Escape to dismiss',
      confidence: 0.8,
    };
  }

  /**
   * Create escape action based on severity and attempts
   */
  private createEscapeAction(
    state: StuckState,
    hasOtherTabs: boolean
  ): RecoveryAction {
    // Escalating escape strategies based on severity and attempts
    if (state.severity === 'high' && this.recoveryAttempts > 1) {
      if (hasOtherTabs) {
        return {
          strategy: 'close_tab',
          action: { action: 'close_tab' },
          reason: 'Repeated failures, closing problematic tab',
          confidence: 0.7,
        };
      }
      return {
        strategy: 'go_back',
        action: { action: 'go_back' },
        reason: 'Repeated failures, navigating back',
        confidence: 0.6,
      };
    }

    // First attempt: try scrolling away
    if (this.recoveryAttempts === 1) {
      return {
        strategy: 'scroll_away',
        action: { action: 'scroll', direction: 'down', amount: 500 },
        reason: 'Trying different area of page',
        confidence: 0.5,
      };
    }

    // Second attempt: refresh
    return {
      strategy: 'refresh',
      action: { action: 'refresh' },
      reason: 'Refreshing page to reset state',
      confidence: 0.6,
    };
  }

  /**
   * Create action to make progress (scroll to find new content)
   */
  private createProgressAction(): RecoveryAction {
    return {
      strategy: 'scroll_away',
      action: { action: 'scroll', direction: 'down', amount: 300 },
      reason: 'No progress detected, scrolling to find new elements',
      confidence: 0.6,
    };
  }

  /**
   * Create action to recover from verification loop
   */
  private createVerificationRecovery(): RecoveryAction {
    return {
      strategy: 'wait_longer',
      action: { action: 'wait', duration: 2000 },
      reason: 'Verification loop detected, waiting for stability',
      confidence: 0.7,
    };
  }

  // ============ Private Helper Methods ============

  /**
   * Check if progress was made and update tracking
   */
  private checkAndUpdateProgress(context: PageContext): void {
    const currentHash = this.hashDomState(context);
    const urlChanged = context.url !== this.lastSuccessfulUrl;
    const domChanged = currentHash !== this.lastSuccessfulDomHash;

    if (urlChanged || domChanged) {
      // Progress made - reset counters including recovery attempts
      this.actionsSinceProgress = 0;
      this.recoveryAttempts = 0; // Reset recovery attempts when progress is made
      this.lastSuccessfulUrl = context.url;
      this.lastSuccessfulDomHash = currentHash;
      debugLog('RecoveryManager', 'Progress detected', {
        urlChanged,
        domChanged,
      });
    } else {
      this.actionsSinceProgress++;
    }
  }

  /**
   * Create simple hash of DOM state for comparison
   * L7 Fix: More efficient hashing using numeric hash
   */
  private hashDomState(context: PageContext): string {
    const elements = context.domSnapshot.interactiveElements;
    // Use simple numeric hash instead of string concatenation
    let hash = elements.length;
    const sample = elements.slice(0, 10);
    for (const el of sample) {
      // Simple string hash
      for (let i = 0; i < el.selector.length && i < 20; i++) {
        hash = ((hash << 5) - hash + el.selector.charCodeAt(i)) | 0;
      }
    }
    return `${elements.length}:${hash}`;
  }
}

// Export singleton instance
export const recoveryManager = new RecoveryManager();
