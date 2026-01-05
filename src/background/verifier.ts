/**
 * Verifier - Autonomous Roaming Phase 3
 * Verifies action success by comparing before/after states
 * Suggests smart retries when actions fail
 */

import type {
  ComputerUseAction,
  PageContext,
  DOMSnapshot,
  VerificationResult,
  RetryStrategy,
} from '../shared/types';
import { VERIFICATION_CONFIG, debugLog } from '../shared/constants';

class Verifier {
  /**
   * Main verification entry point
   * Compares before/after context to determine if action succeeded
   */
  async verify(
    action: ComputerUseAction,
    beforeContext: PageContext,
    afterContext: PageContext,
    _expectedOutcome?: string
  ): Promise<VerificationResult> {
    const actionType = action.action;

    // Skip verification for certain actions
    if (VERIFICATION_CONFIG.SKIP_VERIFICATION_ACTIONS.includes(actionType as any)) {
      return {
        success: true,
        confidence: 1.0,
        evidence: `Action '${actionType}' does not require verification`,
      };
    }

    debugLog('Verifier', 'Verifying action', { actionType });

    // Check URL changes
    const urlChange = this.checkUrlChange(beforeContext, afterContext);

    // Check DOM changes
    const domChanges = this.checkDomChanges(
      beforeContext.domSnapshot,
      afterContext.domSnapshot
    );

    // Determine verification result based on action type
    let result: VerificationResult;

    switch (actionType) {
      case 'left_click':
      case 'right_click':
      case 'double_click':
        result = this.verifyClickAction(action, urlChange, domChanges, afterContext);
        break;

      case 'type':
        result = this.verifyTypeAction(
          action as { action: 'type'; text: string },
          beforeContext.domSnapshot,
          afterContext.domSnapshot
        );
        break;

      case 'key':
        result = this.verifyKeyAction(
          action as { action: 'key'; text: string },
          urlChange,
          domChanges
        );
        break;

      case 'scroll':
        result = this.verifyScrollAction(
          action as { action: 'scroll'; direction: 'up' | 'down'; amount?: number },
          beforeContext.domSnapshot,
          afterContext.domSnapshot
        );
        break;

      case 'open_tab':
      case 'switch_tab':
      case 'close_tab':
        // Tab actions are verified by the tab manager
        result = {
          success: true,
          confidence: 0.9,
          evidence: `Tab action '${actionType}' executed`,
        };
        break;

      case 'go_back':
      case 'go_forward':
        result = this.verifyNavigationAction(urlChange);
        break;

      case 'refresh':
        result = this.verifyRefreshAction(domChanges);
        break;

      case 'extract_text':
        // Extract text is always successful if no error was thrown
        result = {
          success: true,
          confidence: 0.9,
          evidence: 'Text extraction completed',
        };
        break;

      default:
        result = {
          success: true,
          confidence: 0.5,
          evidence: `Unknown action type '${actionType}', assuming success`,
        };
    }

    // Add retry suggestion if verification failed
    if (!result.success && !result.suggestedRetry) {
      result.suggestedRetry = this.suggestRetry(
        action,
        result.failureReason || 'Unknown failure',
        afterContext
      );
    }

    debugLog('Verifier', 'Verification result', {
      success: result.success,
      confidence: result.confidence,
      evidence: result.evidence,
    });

    return result;
  }

  /**
   * Check if URL changed between before and after
   */
  private checkUrlChange(
    before: PageContext,
    after: PageContext
  ): { changed: boolean; from: string; to: string; sameHost: boolean } {
    try {
      const beforeUrl = new URL(before.url);
      const afterUrl = new URL(after.url);

      return {
        changed: before.url !== after.url,
        from: beforeUrl.hostname + beforeUrl.pathname,
        to: afterUrl.hostname + afterUrl.pathname,
        sameHost: beforeUrl.hostname === afterUrl.hostname,
      };
    } catch {
      return {
        changed: before.url !== after.url,
        from: before.url,
        to: after.url,
        sameHost: false,
      };
    }
  }

  /**
   * Check DOM changes between before and after
   */
  private checkDomChanges(
    before: DOMSnapshot,
    after: DOMSnapshot
  ): {
    elementsAdded: number;
    elementsRemoved: number;
    totalChange: number;
    textChanged: boolean;
  } {
    const beforeElements = before.interactiveElements.length;
    const afterElements = after.interactiveElements.length;

    // H5 Fix: Use content-based comparison instead of just selectors
    // Create maps of element signatures (selector + text content)
    const createSignature = (e: { selector: string; text: string }) => `${e.selector}::${e.text}`;
    const beforeSignatures = new Set(before.interactiveElements.map(createSignature));
    const afterSignatures = new Set(after.interactiveElements.map(createSignature));

    const added = [...afterSignatures].filter(s => !beforeSignatures.has(s)).length;
    const removed = [...beforeSignatures].filter(s => !afterSignatures.has(s)).length;

    // Check for text changes in interactive elements
    const textChanged = this.detectTextChanges(before, after);

    return {
      elementsAdded: added,
      elementsRemoved: removed,
      totalChange: Math.abs(afterElements - beforeElements) + added + removed,
      textChanged,
    };
  }

  /**
   * Detect if text content changed in interactive elements
   */
  private detectTextChanges(before: DOMSnapshot, after: DOMSnapshot): boolean {
    // Create map of selector -> text for before state
    const beforeTextMap = new Map<string, string>();
    for (const el of before.interactiveElements) {
      beforeTextMap.set(el.selector, el.text || '');
    }

    // Check if any element's text changed
    for (const el of after.interactiveElements) {
      const beforeText = beforeTextMap.get(el.selector);
      if (beforeText !== undefined && beforeText !== (el.text || '')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Verify click action succeeded
   */
  private verifyClickAction(
    _action: ComputerUseAction,
    urlChange: { changed: boolean; from: string; to: string },
    domChanges: { elementsAdded: number; elementsRemoved: number; totalChange: number; textChanged: boolean },
    _afterContext: PageContext
  ): VerificationResult {
    // Click can cause URL change (navigation) or DOM change (UI update)
    if (urlChange.changed) {
      return {
        success: true,
        confidence: 0.95,
        evidence: `Click caused navigation: ${urlChange.from} → ${urlChange.to}`,
      };
    }

    if (domChanges.totalChange > 0 || domChanges.textChanged) {
      return {
        success: true,
        confidence: 0.85,
        evidence: `Click caused DOM changes: +${domChanges.elementsAdded} -${domChanges.elementsRemoved} elements`,
      };
    }

    // No visible change - might be okay (e.g., clicking a checkbox) or might have failed
    return {
      success: false,
      confidence: 0.4,
      evidence: 'No visible change after click',
      failureReason: 'no change detected',
    };
  }

  /**
   * Verify type action filled input
   */
  private verifyTypeAction(
    action: { action: 'type'; text: string },
    before: DOMSnapshot,
    after: DOMSnapshot
  ): VerificationResult {
    const typedText = action.text;

    // Find input/textarea elements
    const afterInputs = after.interactiveElements.filter(
      e => e.tagName === 'INPUT' || e.tagName === 'TEXTAREA'
    );

    // Check if any input now contains the typed text
    const inputFilled = afterInputs.some(input => {
      const beforeInput = before.interactiveElements.find(
        b => b.selector === input.selector
      );
      const beforeText = beforeInput?.text || '';
      const afterText = input.text || '';

      // Check if text was added
      return afterText.includes(typedText) || afterText.length > beforeText.length;
    });

    if (inputFilled) {
      return {
        success: true,
        confidence: 0.9,
        evidence: `Input received text: "${typedText.substring(0, 20)}${typedText.length > 20 ? '...' : ''}"`,
      };
    }

    // Text changes might not be visible in DOM snapshot
    // (e.g., password fields, React controlled inputs)
    return {
      success: false,
      confidence: 0.5,
      evidence: 'Input value change not detected in DOM',
      failureReason: 'input not filled',
    };
  }

  /**
   * Verify key action
   */
  private verifyKeyAction(
    action: { action: 'key'; text: string },
    urlChange: { changed: boolean; from: string; to: string },
    domChanges: {
      elementsAdded: number;
      elementsRemoved: number;
      totalChange: number;
      textChanged: boolean;
    }
  ): VerificationResult {
    const key = action.text.toLowerCase();

    // Enter key often submits forms
    if (key === 'return' || key === 'enter') {
      if (urlChange.changed) {
        return {
          success: true,
          confidence: 0.95,
          evidence: `Enter key caused navigation: ${urlChange.from} → ${urlChange.to}`,
        };
      }
      if (domChanges.totalChange > 0 || domChanges.textChanged) {
        return {
          success: true,
          confidence: 0.8,
          evidence: 'Enter key caused DOM changes',
        };
      }
    }

    // Tab key for focus changes - hard to verify
    if (key === 'tab') {
      return {
        success: true,
        confidence: 0.7,
        evidence: 'Tab key pressed (focus change not verifiable)',
      };
    }

    // Escape key - often closes dialogs
    if (key === 'escape') {
      if (domChanges.elementsRemoved > 0) {
        return {
          success: true,
          confidence: 0.85,
          evidence: `Escape key removed ${domChanges.elementsRemoved} elements`,
        };
      }
    }

    // For other keys, assume success
    return {
      success: true,
      confidence: 0.6,
      evidence: `Key '${action.text}' pressed`,
    };
  }

  /**
   * Verify scroll action
   */
  private verifyScrollAction(
    action: { action: 'scroll'; direction: 'up' | 'down'; amount?: number },
    before: DOMSnapshot,
    after: DOMSnapshot
  ): VerificationResult {
    // Check if different elements are now visible
    const beforeSelectors = new Set(before.interactiveElements.map(e => e.selector));
    const afterSelectors = new Set(after.interactiveElements.map(e => e.selector));

    const newElements = [...afterSelectors].filter(s => !beforeSelectors.has(s));

    if (newElements.length > 0) {
      return {
        success: true,
        confidence: 0.9,
        evidence: `Scroll ${action.direction} revealed ${newElements.length} new elements`,
      };
    }

    // Scroll might not reveal new elements if at edge
    return {
      success: true,
      confidence: 0.6,
      evidence: `Scroll ${action.direction} executed (may have reached edge)`,
    };
  }

  /**
   * Verify navigation action (go_back, go_forward)
   */
  private verifyNavigationAction(urlChange: {
    changed: boolean;
    from: string;
    to: string;
  }): VerificationResult {
    if (urlChange.changed) {
      return {
        success: true,
        confidence: 0.95,
        evidence: `Navigation: ${urlChange.from} → ${urlChange.to}`,
      };
    }

    return {
      success: false,
      confidence: 0.3,
      evidence: 'URL did not change after navigation',
      failureReason: 'navigation had no effect',
    };
  }

  /**
   * Verify refresh action
   */
  private verifyRefreshAction(domChanges: {
    elementsAdded: number;
    elementsRemoved: number;
    totalChange: number;
    textChanged: boolean;
  }): VerificationResult {
    // Refresh should cause some DOM changes as page reloads
    // But totalChange might be 0 if page is identical
    return {
      success: true,
      confidence: 0.8,
      evidence: `Page refreshed (${domChanges.totalChange} element changes detected)`,
    };
  }

  /**
   * Suggest retry strategy based on failure reason
   */
  private suggestRetry(
    action: ComputerUseAction,
    failureReason: string,
    _context: PageContext
  ): RetryStrategy | undefined {
    const reason = failureReason.toLowerCase();

    // Element not found -> scroll to find it
    if (reason.includes('not found') || reason.includes('no element')) {
      return {
        action: { action: 'scroll', direction: 'down', amount: 300 },
        reason: 'Element may be below viewport, scrolling down',
        confidence: 0.6,
      };
    }

    // Page still loading -> wait
    if (reason.includes('shifting') || reason.includes('stabilize') || reason.includes('loading')) {
      return {
        action: { action: 'wait', duration: 1000 },
        reason: 'Page still loading, waiting for stability',
        confidence: 0.7,
      };
    }

    // Click had no effect -> retry the click
    if (action.action === 'left_click' && reason.includes('no change')) {
      return {
        action: { action: 'left_click' },
        reason: 'Retrying click - element may not have been focused',
        confidence: 0.5,
      };
    }

    // Type didn't fill input -> click to focus first
    if (action.action === 'type' && reason.includes('input')) {
      return {
        action: { action: 'left_click' },
        reason: 'Input may not be focused, clicking first',
        confidence: 0.7,
      };
    }

    // Navigation failed -> wait and retry
    if (reason.includes('navigation')) {
      return {
        action: { action: 'wait', duration: 500 },
        reason: 'Waiting for navigation to complete',
        confidence: 0.6,
      };
    }

    // No specific retry suggestion
    return undefined;
  }
}

// Export singleton instance
export const verifier = new Verifier();
