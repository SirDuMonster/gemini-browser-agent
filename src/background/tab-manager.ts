/**
 * Tab Manager - Autonomous Roaming Phase 1
 * Centralized tab management for multi-tab agent operations
 */

import type { TabState } from '../shared/types';
import { TAB_MANAGEMENT, debugLog, debugError } from '../shared/constants';

class TabManager {
  private managedTabs: Map<number, TabState> = new Map();
  private onTabRemovedCallback: ((tabId: number) => void) | null = null;

  /**
   * Set callback for when tabs are removed (for site data cleanup)
   */
  setOnTabRemovedCallback(callback: (tabId: number) => void): void {
    this.onTabRemovedCallback = callback;
  }

  /**
   * Open a new tab with the given URL
   */
  async openTab(url: string, purpose?: string): Promise<number> {
    // Check tab limit
    if (this.managedTabs.size >= TAB_MANAGEMENT.MAX_TABS) {
      throw new Error(`Tab limit reached (${TAB_MANAGEMENT.MAX_TABS}). Close a tab first.`);
    }

    // Validate URL
    if (!this.isValidUrl(url)) {
      throw new Error(`Invalid URL: ${url}`);
    }

    try {
      const tab = await chrome.tabs.create({ url, active: true });

      if (!tab.id) {
        throw new Error('Failed to create tab - no ID returned');
      }

      // Wait for tab to load
      await this.waitForTabLoad(tab.id);

      const tabState: TabState = {
        id: tab.id,
        url: tab.url || url,
        title: tab.title || 'New Tab',
        purpose,
        createdAt: new Date(),
        isAgentOpened: true,
      };

      this.managedTabs.set(tab.id, tabState);
      debugLog('TabManager', `Opened tab ${tab.id}: ${url} (${purpose || 'no purpose'})`);

      return tab.id;
    } catch (error) {
      debugError('TabManager', 'Failed to open tab:', error);
      throw error;
    }
  }

  /**
   * Close a tab by ID
   */
  async closeTab(tabId: number): Promise<void> {
    try {
      await chrome.tabs.remove(tabId);
      this.managedTabs.delete(tabId);
      this.onTabRemovedCallback?.(tabId);
      debugLog('TabManager', `Closed tab ${tabId}`);
    } catch (error) {
      // Tab might already be closed
      this.managedTabs.delete(tabId);
      this.onTabRemovedCallback?.(tabId);
      debugError('TabManager', `Failed to close tab ${tabId}:`, error);
    }
  }

  /**
   * Switch to (activate) a tab by ID
   */
  async switchTo(tabId: number): Promise<void> {
    try {
      await chrome.tabs.update(tabId, { active: true });

      // Also focus the window containing this tab
      const tab = await chrome.tabs.get(tabId);
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }

      // Wait for tab to be ready
      await this.delay(TAB_MANAGEMENT.TAB_SWITCH_DELAY_MS);
      debugLog('TabManager', `Switched to tab ${tabId}`);
    } catch (error) {
      debugError('TabManager', `Failed to switch to tab ${tabId}:`, error);
      throw error;
    }
  }

  /**
   * Get state of a specific tab
   */
  getTabState(tabId: number): TabState | null {
    return this.managedTabs.get(tabId) || null;
  }

  /**
   * Get all managed tabs
   */
  getAllTabs(): TabState[] {
    return Array.from(this.managedTabs.values());
  }

  /**
   * Track an existing tab (user's initial tab)
   */
  trackTab(tabId: number, url: string, title: string): void {
    if (!this.managedTabs.has(tabId)) {
      this.managedTabs.set(tabId, {
        id: tabId,
        url,
        title,
        purpose: 'Initial tab',
        createdAt: new Date(),
        isAgentOpened: false,
      });
      debugLog('TabManager', `Now tracking tab ${tabId}: ${url}`);
    }
  }

  /**
   * Update tab info (URL/title may change during navigation)
   */
  updateTabInfo(tabId: number, url?: string, title?: string): void {
    const state = this.managedTabs.get(tabId);
    if (state) {
      if (url) state.url = url;
      if (title) state.title = title;
    }
  }

  /**
   * Clean up all agent-opened tabs
   */
  async cleanup(): Promise<void> {
    if (!TAB_MANAGEMENT.AUTO_CLEANUP_ON_SESSION_END) {
      debugLog('TabManager', 'Auto-cleanup disabled, skipping');
      return;
    }

    // L2 Fix: Single iteration instead of Array.from().filter()
    const agentTabs: TabState[] = [];
    for (const tab of this.managedTabs.values()) {
      if (tab.isAgentOpened) {
        agentTabs.push(tab);
      }
    }

    debugLog('TabManager', `Cleaning up ${agentTabs.length} agent-opened tabs`);

    // Notify callback for each tab being removed
    for (const tab of agentTabs) {
      try {
        await chrome.tabs.remove(tab.id);
        this.onTabRemovedCallback?.(tab.id);
        debugLog('TabManager', `Cleaned up tab ${tab.id}`);
      } catch {
        // Tab might already be closed, still notify
        this.onTabRemovedCallback?.(tab.id);
      }
    }

    this.managedTabs.clear();
  }

  /**
   * Get number of managed tabs
   */
  getTabCount(): number {
    return this.managedTabs.size;
  }

  /**
   * Check if tab limit is reached
   */
  isAtLimit(): boolean {
    return this.managedTabs.size >= TAB_MANAGEMENT.MAX_TABS;
  }

  /**
   * Remove a tab from tracking (when closed externally)
   */
  untrackTab(tabId: number): void {
    this.managedTabs.delete(tabId);
    this.onTabRemovedCallback?.(tabId);
  }

  // ============ Private Helpers ============

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  private async waitForTabLoad(tabId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('Tab load timeout'));
      }, 30000);

      const listener = (
        updatedTabId: number,
        changeInfo: chrome.tabs.TabChangeInfo
      ) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          // Additional delay for JavaScript to execute
          setTimeout(resolve, TAB_MANAGEMENT.TAB_OPEN_DELAY_MS);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const tabManager = new TabManager();
