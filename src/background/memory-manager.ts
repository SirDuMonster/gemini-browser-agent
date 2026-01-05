/**
 * Memory Manager - Autonomous Roaming Phase 2
 * Manages goals, facts, visited URLs, and failed strategies
 */

import type { AgentMemory, GoalNode, Fact, FailedStrategy } from '../shared/types';
import { MEMORY_CONFIG, debugLog, debugError } from '../shared/constants';
import { getMemory, saveMemory, clearMemory } from '../shared/utils/storage-utils';

class MemoryManager {
  private memory: AgentMemory;
  private updateCount: number = 0;

  constructor() {
    this.memory = this.createEmptyMemory();
  }

  /**
   * Create empty memory structure
   */
  private createEmptyMemory(): AgentMemory {
    return {
      goals: [],
      facts: [],
      visitedUrls: [],
      failedStrategies: [],
      sessionStartedAt: new Date(),
    };
  }

  /**
   * Initialize from storage
   */
  async initialize(): Promise<void> {
    try {
      const stored = await getMemory();
      if (stored) {
        this.memory = stored;
        debugLog('MemoryManager', 'Memory loaded from storage', {
          goals: this.memory.goals.length,
          facts: this.memory.facts.length,
        });
      } else {
        this.memory = this.createEmptyMemory();
        debugLog('MemoryManager', 'Initialized with empty memory');
      }
    } catch (error) {
      debugError('MemoryManager', 'Failed to initialize', error);
      this.memory = this.createEmptyMemory();
    }
  }

  // ============ Goal Management ============

  /**
   * Add a goal (optionally as sub-goal of parent)
   */
  addGoal(description: string, parentId?: string): string {
    const id = `goal_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const goal: GoalNode = {
      id,
      description,
      status: parentId ? 'pending' : 'in_progress', // Primary goal starts in_progress
      parentId,
      createdAt: new Date(),
    };

    // Enforce limit
    if (this.memory.goals.length >= MEMORY_CONFIG.MAX_GOALS) {
      // Remove oldest completed goals first
      const completed = this.memory.goals.filter(g => g.status === 'completed');
      if (completed.length > 0) {
        this.memory.goals = this.memory.goals.filter(g => g.id !== completed[0].id);
      } else {
        // Remove oldest goal
        this.memory.goals.shift();
      }
    }

    this.memory.goals.push(goal);
    // M5 Fix: Explicit void for intentional fire-and-forget async
    void this.persistIfNeeded();

    debugLog('MemoryManager', 'Goal added', { id, description, parentId });
    return id;
  }

  /**
   * Update goal status
   */
  updateGoalStatus(goalId: string, status: GoalNode['status']): void {
    const goal = this.memory.goals.find(g => g.id === goalId);
    if (goal) {
      goal.status = status;
      if (status === 'completed' || status === 'failed') {
        goal.completedAt = new Date();
      }
      // M5 Fix: Explicit void for intentional fire-and-forget async
      void this.persistIfNeeded();
      debugLog('MemoryManager', 'Goal status updated', { goalId, status });
    }
  }

  /**
   * Get all active (non-completed/failed) goals
   */
  getActiveGoals(): GoalNode[] {
    return this.memory.goals.filter(g =>
      g.status === 'pending' || g.status === 'in_progress'
    );
  }

  /**
   * Get full goal tree
   */
  getGoalTree(): GoalNode[] {
    return [...this.memory.goals];
  }

  /**
   * Get primary goal (first goal without parent)
   */
  getPrimaryGoal(): GoalNode | undefined {
    return this.memory.goals.find(g => !g.parentId);
  }

  // ============ Fact Management ============

  /**
   * Add or update a fact
   */
  addFact(key: string, value: string, source: string, confidence: number = 0.8): void {
    // Check if fact already exists
    const existingIndex = this.memory.facts.findIndex(f => f.key === key);

    const fact: Fact = {
      key,
      value,
      source,
      timestamp: new Date(),
      confidence,
    };

    if (existingIndex >= 0) {
      // Update existing fact if new one has higher confidence
      if (confidence >= this.memory.facts[existingIndex].confidence) {
        this.memory.facts[existingIndex] = fact;
        debugLog('MemoryManager', 'Fact updated', { key, value });
      }
    } else {
      // Enforce limit
      if (this.memory.facts.length >= MEMORY_CONFIG.MAX_FACTS) {
        // Remove oldest fact with lowest confidence
        const sorted = [...this.memory.facts].sort((a, b) => a.confidence - b.confidence);
        this.memory.facts = this.memory.facts.filter(f => f.key !== sorted[0].key);
      }

      this.memory.facts.push(fact);
      debugLog('MemoryManager', 'Fact added', { key, value });
    }

    // M5 Fix: Explicit void for intentional fire-and-forget async
    void this.persistIfNeeded();
  }

  /**
   * Get a specific fact
   */
  getFact(key: string): Fact | undefined {
    return this.memory.facts.find(f => f.key === key);
  }

  /**
   * Get all facts
   */
  getAllFacts(): Fact[] {
    return [...this.memory.facts];
  }

  // ============ Tab-Aware Fact Management (Autonomous Roaming Phase 5) ============

  /**
   * Add a fact with tab tracking
   */
  addFactFromTab(
    key: string,
    value: string,
    source: string,
    tabId: number,
    confidence: number = 0.8
  ): void {
    // M4 Fix: Validate tab ID
    if (!tabId || tabId <= 0) {
      debugLog('MemoryManager', 'Invalid tab ID, skipping fact', { key, tabId });
      return;
    }
    const domain = this.extractDomain(source);

    // Check if fact already exists
    const existingIndex = this.memory.facts.findIndex(f => f.key === key);

    const fact: Fact = {
      key,
      value,
      source,
      sourceTabId: tabId,
      sourceDomain: domain,
      timestamp: new Date(),
      confidence,
    };

    if (existingIndex >= 0) {
      // Update existing fact if new one has higher confidence
      if (confidence >= this.memory.facts[existingIndex].confidence) {
        this.memory.facts[existingIndex] = fact;
        debugLog('MemoryManager', 'Fact updated from tab', { key, value, tabId });
      }
    } else {
      // Enforce limit
      if (this.memory.facts.length >= MEMORY_CONFIG.MAX_FACTS) {
        // Remove oldest fact with lowest confidence
        const sorted = [...this.memory.facts].sort((a, b) => a.confidence - b.confidence);
        this.memory.facts = this.memory.facts.filter(f => f.key !== sorted[0].key);
      }

      this.memory.facts.push(fact);
      debugLog('MemoryManager', 'Fact added from tab', { key, value, tabId, domain });
    }

    // M5 Fix: Explicit void for intentional fire-and-forget async
    void this.persistIfNeeded();
  }

  /**
   * Get facts from a specific tab
   */
  getFactsByTab(tabId: number): Fact[] {
    return this.memory.facts.filter(f => f.sourceTabId === tabId);
  }

  /**
   * Get facts from a specific domain
   */
  getFactsByDomain(domain: string): Fact[] {
    return this.memory.facts.filter(f => f.sourceDomain === domain);
  }

  /**
   * Get facts that exist across multiple tabs (for comparison)
   */
  getCorrelatedFacts(): Map<string, Fact[]> {
    const byKey = new Map<string, Fact[]>();

    for (const fact of this.memory.facts) {
      if (!byKey.has(fact.key)) {
        byKey.set(fact.key, []);
      }
      byKey.get(fact.key)!.push(fact);
    }

    // Return only keys with facts from multiple sources
    return new Map(
      [...byKey.entries()].filter(([_, facts]) => {
        const tabs = new Set(facts.map(f => f.sourceTabId).filter(id => id !== undefined));
        return tabs.size > 1;
      })
    );
  }

  /**
   * Extract domain from URL (helper)
   */
  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  // ============ URL Tracking ============

  /**
   * Record a URL visit
   */
  recordVisit(url: string): void {
    // Extract domain for cleaner tracking
    try {
      const domain = new URL(url).hostname;

      // Don't duplicate consecutive visits to same domain
      if (this.memory.visitedUrls[this.memory.visitedUrls.length - 1] === domain) {
        return;
      }

      // Enforce limit
      if (this.memory.visitedUrls.length >= MEMORY_CONFIG.MAX_VISITED_URLS) {
        this.memory.visitedUrls.shift();
      }

      this.memory.visitedUrls.push(domain);
      this.persistIfNeeded();

      debugLog('MemoryManager', 'URL visit recorded', { domain });
    } catch {
      // Invalid URL, ignore
    }
  }

  /**
   * Check if URL has been visited
   */
  hasVisited(url: string): boolean {
    try {
      const domain = new URL(url).hostname;
      return this.memory.visitedUrls.includes(domain);
    } catch {
      return false;
    }
  }

  /**
   * Get visited URLs
   */
  getVisitedUrls(): string[] {
    return [...this.memory.visitedUrls];
  }

  // ============ Failed Strategy Tracking ============

  /**
   * Record a failed strategy
   */
  recordFailure(description: string, reason: string, context: string): void {
    // Enforce limit
    if (this.memory.failedStrategies.length >= MEMORY_CONFIG.MAX_FAILED_STRATEGIES) {
      this.memory.failedStrategies.shift();
    }

    const failure: FailedStrategy = {
      description,
      reason,
      context,
      timestamp: new Date(),
    };

    this.memory.failedStrategies.push(failure);
    this.persistIfNeeded();

    debugLog('MemoryManager', 'Failure recorded', { description, reason });
  }

  /**
   * Get failed strategies
   */
  getFailedStrategies(): FailedStrategy[] {
    return [...this.memory.failedStrategies];
  }

  // ============ AI Context Generation ============

  /**
   * Generate compact memory summary for Gemini prompt
   */
  summarizeForPrompt(): string {
    const parts: string[] = [];

    // Goals section
    const activeGoals = this.getActiveGoals();
    const primaryGoal = this.getPrimaryGoal();

    if (primaryGoal || activeGoals.length > 0) {
      parts.push('GOALS:');

      if (primaryGoal) {
        const statusIcon = this.getStatusIcon(primaryGoal.status);
        parts.push(`- ${statusIcon} ${primaryGoal.description}`);

        // Show sub-goals
        const subGoals = this.memory.goals.filter(g => g.parentId === primaryGoal.id);
        for (const sub of subGoals.slice(0, 5)) { // Limit to 5 sub-goals
          const subIcon = this.getStatusIcon(sub.status);
          parts.push(`  - ${subIcon} ${sub.description}`);
        }
      }
    }

    // Facts section
    if (this.memory.facts.length > 0) {
      parts.push('');
      parts.push('KNOWN FACTS:');
      // Show most confident facts first, limit to 10
      const sortedFacts = [...this.memory.facts]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 10);

      for (const fact of sortedFacts) {
        const confidenceLabel = fact.confidence >= 0.9 ? 'high' : fact.confidence >= 0.7 ? 'med' : 'low';
        parts.push(`- ${fact.key}: "${fact.value}" (${confidenceLabel})`);
      }
    }

    // Visited URLs section
    if (this.memory.visitedUrls.length > 0) {
      parts.push('');
      // Show last 5 visited domains
      const recentUrls = this.memory.visitedUrls.slice(-5);
      parts.push(`VISITED: ${recentUrls.join(' → ')}`);
    }

    // Failed strategies section
    if (this.memory.failedStrategies.length > 0) {
      parts.push('');
      parts.push('AVOID (failed before):');
      // Show last 3 failures
      const recentFailures = this.memory.failedStrategies.slice(-3);
      for (const failure of recentFailures) {
        parts.push(`- ${failure.description}: ${failure.reason}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Get status icon for goal
   */
  private getStatusIcon(status: GoalNode['status']): string {
    switch (status) {
      case 'completed': return '[done]';
      case 'in_progress': return '[...]';
      case 'failed': return '[X]';
      default: return '[ ]';
    }
  }

  // ============ Lifecycle ============

  /**
   * Clear all memory
   */
  async clear(): Promise<void> {
    this.memory = this.createEmptyMemory();
    this.updateCount = 0;
    await clearMemory();
    debugLog('MemoryManager', 'Memory cleared');
  }

  /**
   * Persist to storage if enough updates have accumulated
   */
  private async persistIfNeeded(): Promise<void> {
    this.updateCount++;

    if (this.updateCount >= MEMORY_CONFIG.PERSIST_AFTER_UPDATES) {
      try {
        await saveMemory(this.memory);
        this.updateCount = 0;
      } catch (error) {
        debugError('MemoryManager', 'Failed to persist memory', error);
      }
    }
  }

  /**
   * Force save to storage
   */
  async forceSave(): Promise<void> {
    try {
      await saveMemory(this.memory);
      this.updateCount = 0;
      debugLog('MemoryManager', 'Memory force saved');
    } catch (error) {
      debugError('MemoryManager', 'Failed to force save memory', error);
    }
  }

  /**
   * Get raw memory (for debugging)
   */
  getMemory(): AgentMemory {
    return { ...this.memory };
  }
}

// Export singleton instance
export const memoryManager = new MemoryManager();
