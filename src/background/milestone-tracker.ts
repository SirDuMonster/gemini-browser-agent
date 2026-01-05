import type { ComputerUseAction, ActionRecord, PageContext } from '../shared/types';
import { debugLog } from '../shared/constants';

/**
 * Milestone Tracker - Converts low-level actions into high-level milestones
 *
 * Instead of showing "mouse_move", "left_click", "type", we show:
 * - "Opened Gmail"
 * - "Set receiver address"
 * - "Wrote email"
 */

interface Milestone {
  description: string;
  timestamp: number;
}

interface PendingMilestone {
  type: 'navigation' | 'form_fill' | 'compose_email' | 'search' | 'click_element' | 'generic';
  actions: ComputerUseAction[];
  context: {
    url?: string;
    previousUrl?: string;
    targetElement?: string;
  };
}

export class MilestoneTracker {
  private pendingMilestone: PendingMilestone | null = null;
  private lastUrl: string = '';
  private milestones: Milestone[] = [];

  /**
   * Process an action and return a milestone if one was completed
   */
  trackAction(
    action: ComputerUseAction,
    actionRecord: ActionRecord,
    context: PageContext
  ): string | null {
    const { url } = context;

    // Detect URL changes (navigation milestones)
    if (url !== this.lastUrl && this.lastUrl !== '') {
      const milestone = this.detectNavigationMilestone(this.lastUrl, url);
      this.lastUrl = url;

      if (milestone) {
        return this.completeMilestone(milestone);
      }
    }

    this.lastUrl = url;

    // Track action in pending milestone
    if (!this.pendingMilestone) {
      this.pendingMilestone = {
        type: 'generic',
        actions: [],
        context: { url },
      };
    }

    this.pendingMilestone.actions.push(action);

    // Check if we completed a milestone
    const milestone = this.detectMilestoneFromActions(this.pendingMilestone, context, actionRecord);

    if (milestone) {
      this.pendingMilestone = null; // Reset for next milestone
      return this.completeMilestone(milestone);
    }

    return null;
  }

  /**
   * Detect navigation milestones (page changes)
   */
  private detectNavigationMilestone(fromUrl: string, toUrl: string): string | null {
    try {
      const fromDomain = new URL(fromUrl).hostname;
      const toDomain = new URL(toUrl).hostname;

      // Gmail navigation
      if (toDomain.includes('mail.google.com')) {
        if (toUrl.includes('#inbox?compose=')) {
          return 'Opened email composer';
        }
        if (toUrl.includes('#inbox')) {
          return 'Opened Gmail inbox';
        }
        return 'Navigated to Gmail';
      }

      // Google navigation
      if (toDomain.includes('google.com') && !toDomain.includes('mail')) {
        return 'Navigated to Google';
      }

      // Generic navigation
      if (fromDomain !== toDomain) {
        return `Navigated to ${this.getDomainName(toDomain)}`;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Detect milestones from action sequences
   */
  private detectMilestoneFromActions(
    pending: PendingMilestone,
    context: PageContext,
    lastActionRecord: ActionRecord
  ): string | null {
    const actions = pending.actions;
    const { url } = context;
    const thinking = lastActionRecord.plannedAction?.description || '';

    // Need at least 2 actions for a sequence
    if (actions.length < 2) {
      return null;
    }

    const lastAction = actions[actions.length - 1];
    const secondLastAction = actions[actions.length - 2];

    // Gmail compose email milestones
    if (url.includes('mail.google.com')) {
      // Recipient field filled
      if (
        lastAction.action === 'type' &&
        thinking.toLowerCase().includes('recipient')
      ) {
        return 'Set recipient address';
      }

      // Subject filled
      // L6 Fix: Multi-language support - Polish keywords alongside English
      if (
        lastAction.action === 'type' &&
        (thinking.toLowerCase().includes('subject') || thinking.toLowerCase().includes('temat'))
      ) {
        return 'Added email subject';
      }

      // Email body filled
      if (
        lastAction.action === 'type' &&
        (thinking.toLowerCase().includes('body') ||
         thinking.toLowerCase().includes('message') ||
         thinking.toLowerCase().includes('wiadomość'))
      ) {
        return 'Wrote email content';
      }

      // Clicked compose button
      if (
        secondLastAction.action === 'mouse_move' &&
        lastAction.action === 'left_click' &&
        (thinking.toLowerCase().includes('compose') || thinking.toLowerCase().includes('utwórz'))
      ) {
        return 'Started composing email';
      }
    }

    // Search actions
    if (
      lastAction.action === 'type' &&
      (thinking.toLowerCase().includes('search') ||
       thinking.toLowerCase().includes('query') ||
       thinking.toLowerCase().includes('szukaj'))
    ) {
      return `Searched for: "${lastAction.text}"`;
    }

    // Button/link clicks (generic)
    if (
      secondLastAction.action === 'mouse_move' &&
      lastAction.action === 'left_click'
    ) {
      // Extract element description from thinking
      const clickMatch = thinking.match(/(click|kliknąć|open|otwórz).*?['"]([^'"]+)['"]/i);
      if (clickMatch && clickMatch[2]) {
        return `Clicked on "${clickMatch[2]}"`;
      }

      // Generic click
      if (thinking.length > 0 && !thinking.toLowerCase().includes('focus')) {
        // Shorten thinking to first sentence
        const firstSentence = thinking.split('.')[0];
        if (firstSentence.length > 5 && firstSentence.length < 60) {
          return firstSentence;
        }
      }
    }

    // Form field filled
    if (
      lastAction.action === 'type' &&
      actions.length >= 3 &&
      secondLastAction.action === 'left_click'
    ) {
      // Don't create milestone for every field, only major ones
      // (already handled above for email fields)
    }

    return null;
  }

  /**
   * Complete a milestone and log it
   */
  private completeMilestone(description: string): string {
    const milestone: Milestone = {
      description,
      timestamp: Date.now(),
    };

    this.milestones.push(milestone);
    debugLog('MilestoneTracker', 'Milestone completed', { description });

    return description;
  }

  /**
   * Get friendly domain name
   */
  private getDomainName(hostname: string): string {
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      return parts[parts.length - 2];
    }
    return hostname;
  }

  /**
   * Get all milestones
   */
  getMilestones(): Milestone[] {
    return this.milestones;
  }

  /**
   * Reset tracker for new task
   */
  reset(): void {
    this.pendingMilestone = null;
    this.lastUrl = '';
    this.milestones = [];
  }
}

/**
 * Singleton instance
 */
export const milestoneTracker = new MilestoneTracker();
