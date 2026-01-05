# Autonomous Roaming Roadmap

**Goal:** Enable Gemini for Chrome to navigate freely across the browser, managing multiple tabs, executing complex multi-step tasks, and recovering from errors autonomously — similar to Claude for Chrome.

---

## Current State vs Target State

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CURRENT                          │  TARGET                            │
├───────────────────────────────────┼────────────────────────────────────┤
│  Single tab only                  │  Multi-tab management              │
│  Linear action sequence           │  Goal-driven planning              │
│  No self-verification             │  Action → Verify → Retry loop      │
│  Fixed action set                 │  Extended action palette           │
│  No memory across pages           │  Persistent session context        │
│  Manual error handling            │  Autonomous recovery               │
└───────────────────────────────────┴────────────────────────────────────┘
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AUTONOMOUS AGENT CORE                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────────────────┐  │
│   │   PLANNER   │────▶│  EXECUTOR   │────▶│    VERIFIER             │  │
│   │  (Gemini)   │     │  (Actions)  │     │  (Success Check)        │  │
│   └──────┬──────┘     └─────────────┘     └───────────┬─────────────┘  │
│          │                                            │                 │
│          │         ┌──────────────────────────────────┘                 │
│          │         ▼                                                    │
│   ┌──────▼─────────────────────────────────────────────────────────┐   │
│   │                    MEMORY MANAGER                               │   │
│   │  • Goal Stack     • Action History     • Tab Registry          │   │
│   │  • Page Cache     • Error Context      • User Preferences      │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                        TAB ORCHESTRATOR                                 │
│   • Open/Close tabs    • Switch context    • Track tab states          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Foundation (Week 1-2)

### 1.1 Tab Management System

**New File:** `src/background/tab-manager.ts`

```typescript
interface TabState {
  id: number;
  url: string;
  title: string;
  lastScreenshot?: string;
  purpose?: string; // Why agent opened this tab
}

class TabManager {
  async openTab(url: string, purpose: string): Promise<number>;
  async closeTab(tabId: number): Promise<void>;
  async switchTo(tabId: number): Promise<void>;
  async getTabState(tabId: number): Promise<TabState>;
  getAllTabs(): TabState[];
}
```

### 1.2 Extended Action Set

**Modify:** `src/shared/types.ts`

Add new action types:
```typescript
type ExtendedAction =
  | 'open_tab'        // Open new tab with URL
  | 'close_tab'       // Close current/specified tab
  | 'switch_tab'      // Switch to tab by index or pattern
  | 'scroll'          // Scroll direction/amount
  | 'wait'            // Wait for element/time
  | 'extract_text'    // Extract text from element
  | 'go_back'         // Browser back button
  | 'go_forward'      // Browser forward button
  | 'refresh'         // Refresh page
```

### 1.3 Remove Single-Tab Constraint

**Modify:** `src/background/service-worker.ts`

```diff
- if (!session.targetTabId) {
-   throw new Error('No target tab ID in session');
- }
+ // Allow agent to work across any tab
+ const activeTab = await tabManager.getActiveOrCreate();
```

---

## Phase 2: Memory & Context (Week 3-4)

### 2.1 Persistent Memory Store

**New File:** `src/background/memory-manager.ts`

```typescript
interface AgentMemory {
  goals: GoalNode[];          // Hierarchical goal tree
  facts: Fact[];              // Extracted information
  visitedUrls: string[];      // Navigation history
  failedStrategies: string[]; // What didn't work
}

class MemoryManager {
  addGoal(goal: string, parentId?: string): string;
  markGoalComplete(goalId: string): void;
  addFact(key: string, value: any, source: string): void;
  getFacts(): Fact[];
  getGoalTree(): GoalNode[];
  summarizeForPrompt(): string; // Compact memory for AI context
}
```

### 2.2 Goal-Oriented Planning

**Modify:** `src/api/gemini-client.ts`

Update prompt to include:
- Current goal stack
- Previously failed approaches
- Extracted facts from pages
- Tab registry context

---

## Phase 3: Self-Verification (Week 5-6)

### 3.1 Action Verification Loop

**New File:** `src/background/verifier.ts`

```typescript
interface VerificationResult {
  success: boolean;
  confidence: number;
  evidence: string;
  suggestedRetry?: ComputerUseAction;
}

class Verifier {
  async verify(
    action: ComputerUseAction,
    beforeContext: PageContext,
    afterContext: PageContext
  ): Promise<VerificationResult>;
}
```

### 3.2 Smart Retry Logic

When action fails:
1. Analyze what went wrong (element moved, page changed, etc.)
2. Try alternative approach (different selector, scroll first, etc.)
3. If repeated failure, escalate to user or skip

---

## Phase 4: Advanced Capabilities (Week 7-8)

### 4.1 Form Intelligence

- Auto-detect form fields and their types
- Fill forms from context/memory
- Handle multi-step forms (next page, accordions)

### 4.2 Data Extraction

- Extract tables as structured data
- Copy relevant text to memory
- Screenshot specific regions for reference

### 4.3 Error Recovery

```
Error Type          → Recovery Strategy
─────────────────────────────────────────────────────────
Element not found   → Scroll + retry, or use text search
Page loading        → Wait with exponential backoff
Rate limited        → Pause, notify user, resume
Domain blocked      → Switch strategy or ask user
Tab crashed         → Re-open and restore state
```

---

## Phase 5: Polish & Safety (Week 9-10)

### 5.1 Guardrails

- Maximum tabs to open (prevent tab explosion)
- Domain allowlist/blocklist per task
- Cost tracking for API calls
- Idle timeout detection

### 5.2 User Control

- Pause/resume at any point
- Step-through mode (manual approval per action)
- Edit goals mid-task
- View agent "thinking" in real-time

### 5.3 Performance

- Screenshot caching to reduce API calls
- Batch similar actions when possible
- Preload likely next tabs

---

## Implementation Priority Matrix

| Feature                  | Impact | Effort | Priority |
|--------------------------|--------|--------|----------|
| Tab management           | High   | Medium | P0       |
| Extended actions         | High   | Low    | P0       |
| Memory manager           | High   | High   | P1       |
| Verification loop        | Medium | Medium | P1       |
| Goal-oriented planning   | High   | High   | P1       |
| Form intelligence        | Medium | High   | P2       |
| Data extraction          | Medium | Medium | P2       |
| Error recovery           | High   | Medium | P1       |
| User controls            | Medium | Low    | P2       |

---

## Success Metrics

- [ ] Can complete a 10+ step task across 3+ tabs
- [ ] Recovers from at least 80% of common errors
- [ ] Maintains context after 20+ actions
- [ ] User intervention needed < 10% of tasks
- [ ] No runaway tab/action behavior

---

## Dependencies

### External
- Gemini 3 Flash vision API (already integrated)
- Chrome Extension APIs (tabs, scripting, storage)

### Internal (Complete First)
- Screenshot size enforcement ✓
- Coordinate validation ✓
- Session mutex ✓
- Rate limiting ✓ (already implemented)

---

*Last Updated: 2026-01-05*
*Status: Draft Roadmap*
