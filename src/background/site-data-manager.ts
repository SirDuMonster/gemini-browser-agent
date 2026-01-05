/**
 * Site Data Manager - Autonomous Roaming Phase 5
 * Tracks context across tabs and enables cross-site workflows
 */

import type {
  PageContext,
  TabContextSnapshot,
  SiteData,
  CrossSiteCorrelation,
  MultiSiteContext,
} from '../shared/types';
import { MULTI_SITE_CONFIG, debugLog } from '../shared/constants';

class SiteDataManager {
  // Tab context storage: tabId → contexts (most recent last)
  private tabContexts: Map<number, TabContextSnapshot[]> = new Map();

  // Site index: domain → site data
  private siteIndex: Map<string, SiteData> = new Map();

  // Cross-site correlations
  private correlations: CrossSiteCorrelation[] = [];

  /**
   * Save context for a tab (called on each iteration)
   * Also records the site visit for the domain
   */
  saveTabContext(
    tabId: number,
    context: PageContext,
    keyData?: Record<string, string>
  ): void {
    const domain = this.extractDomain(context.url);

    const snapshot: TabContextSnapshot = {
      tabId,
      url: context.url,
      title: context.title,
      domain,
      capturedAt: new Date(),
      keyData: keyData || {},
    };

    // Get or create context array for this tab
    if (!this.tabContexts.has(tabId)) {
      this.tabContexts.set(tabId, []);
    }

    const contexts = this.tabContexts.get(tabId)!;
    contexts.push(snapshot);

    // Prune old contexts
    this.pruneOldContexts(tabId);

    // Also record site visit (avoids duplicate domain extraction in caller)
    this.recordSiteVisit(domain, tabId);

    debugLog('SiteDataManager', 'Saved tab context', {
      tabId,
      url: context.url,
      domain,
    });
  }

  /**
   * Get most recent context for a tab
   */
  getTabContext(tabId: number): TabContextSnapshot | null {
    const contexts = this.tabContexts.get(tabId);
    if (!contexts || contexts.length === 0) return null;
    return contexts[contexts.length - 1];
  }

  /**
   * Get all contexts for a tab
   */
  getTabContextHistory(tabId: number): TabContextSnapshot[] {
    return this.tabContexts.get(tabId) || [];
  }

  /**
   * Record key data extracted from a tab
   */
  recordKeyData(tabId: number, key: string, value: string): void {
    // Defensive: validate inputs
    if (typeof tabId !== 'number' || !key || typeof key !== 'string') {
      debugLog('SiteDataManager', 'Invalid recordKeyData input', { tabId, key });
      return;
    }

    const context = this.getTabContext(tabId);
    if (!context) {
      debugLog('SiteDataManager', 'No context found for tab', { tabId });
      return;
    }

    // Check if we're at the limit
    const keyCount = Object.keys(context.keyData).length;
    if (keyCount >= MULTI_SITE_CONFIG.MAX_KEY_DATA_ENTRIES && !(key in context.keyData)) {
      debugLog('SiteDataManager', 'Key data limit reached', { tabId, key });
      return;
    }

    context.keyData[key] = value;

    // Also add correlation if tracking is enabled
    if (MULTI_SITE_CONFIG.TRACK_CROSS_SITE_PATTERNS) {
      this.addCorrelation(key, tabId, value, context.domain);
    }

    debugLog('SiteDataManager', 'Recorded key data', { tabId, key, value });
  }

  /**
   * Get all key data for a tab
   */
  getKeyData(tabId: number): Record<string, string> {
    const context = this.getTabContext(tabId);
    return context?.keyData || {};
  }

  /**
   * Update site index when visiting a domain
   */
  recordSiteVisit(domain: string, tabId: number): void {
    const existing = this.siteIndex.get(domain);

    if (existing) {
      // Update existing entry
      if (!existing.tabIds.includes(tabId)) {
        existing.tabIds.push(tabId);
      }
      existing.lastVisited = new Date();
      existing.visitCount++;
    } else {
      // Create new entry
      this.siteIndex.set(domain, {
        domain,
        tabIds: [tabId],
        facts: [],
        lastVisited: new Date(),
        visitCount: 1,
      });
    }

    debugLog('SiteDataManager', 'Recorded site visit', { domain, tabId });
  }

  /**
   * Get data for a specific domain
   */
  getSiteData(domain: string): SiteData | null {
    return this.siteIndex.get(domain) || null;
  }

  /**
   * Record a fact key for a domain
   */
  recordFactForDomain(domain: string, factKey: string): void {
    const siteData = this.siteIndex.get(domain);
    if (siteData && !siteData.facts.includes(factKey)) {
      siteData.facts.push(factKey);
    }
  }

  /**
   * Add a cross-site correlation
   */
  addCorrelation(
    key: string,
    tabId: number,
    value: string,
    domain: string
  ): void {
    // Find existing correlation for this key
    let correlation = this.correlations.find(c => c.key === key);

    if (correlation) {
      // Update existing correlation
      correlation.values[tabId] = value;
      if (!correlation.domains.includes(domain)) {
        correlation.domains.push(domain);
      }
      // Increase confidence if same key appears across multiple tabs
      const tabCount = Object.keys(correlation.values).length;
      correlation.confidence = Math.min(0.9, 0.5 + tabCount * 0.1);
    } else {
      // Create new correlation
      correlation = {
        key,
        values: { [tabId]: value },
        domains: [domain],
        confidence: 0.5,
      };
      this.correlations.push(correlation);
    }

    debugLog('SiteDataManager', 'Updated correlation', {
      key,
      tabCount: Object.keys(correlation.values).length,
      confidence: correlation.confidence,
    });
  }

  /**
   * Get correlations that span multiple tabs
   */
  getActiveCorrelations(): CrossSiteCorrelation[] {
    return this.correlations.filter(c => {
      const tabCount = Object.keys(c.values).length;
      return tabCount > 1 && c.confidence >= MULTI_SITE_CONFIG.MIN_CORRELATION_CONFIDENCE;
    });
  }

  /**
   * Build multi-site context for AI prompt
   */
  buildMultiSiteContext(
    currentTabId: number,
    openTabs: Array<{ id: number; url: string; purpose?: string }>
  ): MultiSiteContext {
    // L4 Fix: Defensive check is intentional - openTabs can come from external sources
    // This prevents crashes if getAllTabs() returns unexpected data
    const validTabs = Array.isArray(openTabs) ? openTabs : [];

    // Build tab info with key data
    const tabsWithData = validTabs
      .slice(0, MULTI_SITE_CONFIG.MAX_TABS_IN_PROMPT)
      .filter(tab => tab && typeof tab.id === 'number' && typeof tab.url === 'string')
      .map(tab => {
        const keyData = this.getKeyData(tab.id);
        return {
          id: tab.id,
          url: tab.url,
          domain: this.extractDomain(tab.url),
          purpose: tab.purpose,
          keyData,
        };
      });

    // Build site index as plain object (deep copy to avoid mutation)
    const siteIndexObj: Record<string, SiteData> = {};
    for (const [domain, data] of this.siteIndex) {
      siteIndexObj[domain] = { ...data, tabIds: [...data.tabIds], facts: [...data.facts] };
    }

    // Get active correlations (deep copy)
    const activeCorrelations = this.getActiveCorrelations().map(c => ({
      ...c,
      values: { ...c.values },
      domains: [...c.domains],
    }));

    return {
      openTabs: tabsWithData,
      siteIndex: siteIndexObj,
      correlations: activeCorrelations,
      currentTabId,
    };
  }

  /**
   * Clear data for a closed tab
   */
  clearTab(tabId: number): void {
    this.tabContexts.delete(tabId);

    // Remove tab from site index entries and clean up empty sites
    const emptyDomains: string[] = [];
    for (const [domain, siteData] of this.siteIndex) {
      siteData.tabIds = siteData.tabIds.filter(id => id !== tabId);
      if (siteData.tabIds.length === 0) {
        emptyDomains.push(domain);
      }
    }
    // Remove sites with no remaining tabs
    for (const domain of emptyDomains) {
      this.siteIndex.delete(domain);
    }

    // Remove tab from correlations
    for (const correlation of this.correlations) {
      delete correlation.values[tabId];
    }

    // Clean up empty correlations
    this.correlations = this.correlations.filter(
      c => Object.keys(c.values).length > 0
    );

    debugLog('SiteDataManager', 'Cleared tab data', { tabId, removedSites: emptyDomains.length });
  }

  /**
   * Reset all data (on task end)
   */
  reset(): void {
    this.tabContexts.clear();
    this.siteIndex.clear();
    this.correlations = [];
    debugLog('SiteDataManager', 'State reset');
  }

  /**
   * Extract domain from URL
   */
  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  /**
   * Prune old contexts to stay within limit
   */
  private pruneOldContexts(tabId: number): void {
    const contexts = this.tabContexts.get(tabId);
    if (contexts && contexts.length > MULTI_SITE_CONFIG.MAX_CONTEXTS_PER_TAB) {
      // Keep only the most recent contexts
      const excess = contexts.length - MULTI_SITE_CONFIG.MAX_CONTEXTS_PER_TAB;
      contexts.splice(0, excess);
    }
  }
}

// Export singleton instance
export const siteDataManager = new SiteDataManager();
