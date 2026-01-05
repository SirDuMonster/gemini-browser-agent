# Gemini Chrome Agent — Deep Code Audit Report

**Date:** 2026-01-03  
**Extension Version:** 0.1.0  
**Auditor:** Claude Opus 4.5

---

## Executive Summary

This is a comprehensive code audit of the **Gemini Chrome Agent** Chrome extension that integrates **Gemini 3 Pro** (for planning) and **Claude Sonnet 4.5** (for execution via Computer Use) through **OpenRouter API**.

```
┌──────────────────────────────────────────────────────────┐
│  AUDIT RESULTS                                           │
├──────────────────────────────────────────────────────────┤
│  🔴 CRITICAL ISSUES:       1                             │
│  🟠 SECURITY CONCERNS:     3                             │
│  🟡 POTENTIAL BUGS:        6                             │
│  🔵 CODE QUALITY ISSUES:   5                             │
│  ⚪ RECOMMENDATIONS:        8                             │
└──────────────────────────────────────────────────────────┘
```

---

## 🔴 CRITICAL ISSUES

### 1. Hardcoded API Key Exposed in Source Code

**File:** `src/shared/constants.ts` (Line 5)

```typescript
export const OPENROUTER_API_KEY = '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';
```

> ⚠️ **CAUTION:** The OpenRouter API key is **publicly visible** in the source code. If this repository is ever made public or the extension is distributed, this key will be compromised. Anyone with access to this extension can:
> - Use your API credits
> - Rack up charges on your OpenRouter account
> - Access your API usage history

**Impact:** HIGH — Financial exposure, API abuse

**Fix Required:** 
1. **Immediately rotate this API key** in OpenRouter dashboard
2. Store the API key in `chrome.storage.local` and require user input
3. Add a Settings UI for API key configuration
4. Add the key to `.gitignore` if using any `.env` file approach

---

## 🟠 SECURITY CONCERNS

### 1. Blocked Domain Check is Insufficient

**File:** `src/background/planner.ts` (Lines 181-199)

```typescript
async isBlockedDomain(url: string): Promise<boolean> {
  for (const pattern of settings.blockedDomains) {
    if (domain.includes(pattern.toLowerCase())) {
      return true;
    }
  }
  return false;
}
```

**Issue:** The check uses `includes()` which can be bypassed:
- Subdomains like `my.banking.example.com` might slip through
- The check happens **after** the page is already loaded

**Recommendation:** 
- Implement a proper domain matching algorithm
- Block actions proactively before context gathering
- Consider URL pattern matching for stricter control

---

### 2. Content Script Runs Without CSP Consideration

**File:** `src/manifest.json` (Lines 26-33)

```json
"content_scripts": [{
  "matches": ["<all_urls>"],
  "js": ["src/content/content-script.ts"],
  "run_at": "document_idle"
}]
```

**Issue:** Content script injects on ALL URLs with broad permissions. While necessary for the extension's function, this:
- Runs on every page including potentially malicious sites
- Could execute on pages with strict CSP which might cause errors
- Has access to DOM of all pages including sensitive ones

**Recommendation:**
- Consider adding a user-controllable allowlist/blocklist
- Add try-catch around all content script initialization
- Log when content script fails to inject

---

### 3. Sensitive Action Confirmation Not Implemented

**File:** `src/background/service-worker.ts` (Lines 238-241)

```typescript
// Check if action requires confirmation
if (await planner.requiresConfirmation(plannerResponse)) {
  // TODO: Implement user confirmation flow
  debugLog('AgentLoop', 'Action requires confirmation', { action: plannedAction.type });
}
```

**Issue:** The confirmation flow is stubbed but not implemented. Sensitive actions execute without user confirmation.

**Impact:** User might not be aware of sensitive actions being performed.

---

## 🟡 POTENTIAL BUGS

### 1. Mouse Click Coordinates May Be Stale

**File:** `src/content/action-performer.ts` (Lines 99-141)

```typescript
async function leftClick(): Promise<void> {
  const { x, y } = currentCursor;
  const element = getElementAtPoint(x, y);
  // ...
}
```

**Issue:** If the page content shifts (dynamic ads, lazy loading, animations) between `mouse_move` and `left_click`, the cursor coordinates may point to a different element than intended.

**Recommendation:**
- Re-validate coordinates against recent screenshot
- Add a short delay check if element has changed
- Consider Element-based clicking instead of coordinate-based

---

### 2. Model Names May Be Invalid or Outdated

**File:** `src/shared/constants.ts` (Lines 9-10)

```typescript
export const GEMINI_MODEL = 'google/gemini-3-pro-preview';
export const CLAUDE_MODEL = 'anthropic/claude-sonnet-4-5-20250929';
```

**Issue:** These model identifiers are speculative/preview names. OpenRouter model names may differ.

**Action Required:**
- Verify these exact model strings work with OpenRouter API
- Add fallback model handling
- Consider making models configurable in settings

---

### 3. Computer Use Tool Format May Be Incompatible

**File:** `src/api/anthropic-client.ts` (Lines 141-149)

```typescript
private getComputerUseTool(viewport: { width: number; height: number }) {
  return {
    type: 'computer_20241022',
    name: 'computer',
    display_width_px: viewport.width,
    display_height_px: viewport.height,
    display_number: 1,
  };
}
```

**Issue:** OpenRouter may not support the raw Anthropic Computer Use tool format directly.

**Recommendation:**
- Test with actual OpenRouter API to verify tool call format
- Add error handling for tool format mismatch

---

### 4. Screenshot Size Limits Not Enforced at API Level

**Files:** `src/api/gemini-client.ts`, `src/api/anthropic-client.ts`

**Issue:** While `screenshot-utils.ts` has adaptive quality, there's no validation before API call that the image is within limits (4MB for Gemini, 5MB for Claude).

**Recommendation:**
- Add size check before API call
- Log warning if screenshot exceeds recommended size

---

### 5. Missing Error Handling for Page Navigation

**File:** `src/background/executor.ts` (Lines 85-88)

```typescript
case 'go_back':
  actions.push({ action: 'key', text: 'Alt+Left' });
  return actions;
```

**Issue:** Using keyboard shortcuts for navigation may not work on:
- Pages that intercept `Alt+Left`
- Non-Windows operating systems
- Focus not on page content

**Recommendation:**
- Use `chrome.tabs.goBack()` API instead of keyboard simulation
- Same for `go_forward` using `chrome.tabs.goForward()`

---

### 6. MutationObserver May Cause Memory Leaks

**File:** `src/content/content-script.ts` (Lines 205-228)

```typescript
function detectPageChanges(): void {
  const observer = new MutationObserver(() => {
    // ...
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
detectPageChanges();
```

**Issue:** Observer is created but never disconnected on long-running pages.

**Recommendation:**
- Store observer reference
- Disconnect on page unload
- Add cleanup mechanism

---

## 🔵 CODE QUALITY ISSUES

### 1. Inconsistent Error Handling

Some errors throw, some return error objects, some log and continue across different modules.

**Recommendation:** Standardize error handling pattern across codebase.

---

### 2. TypeScript `any` Types in Several Places

**File:** `src/shared/utils/storage-utils.ts`

```typescript
export async function getActionHistory(): Promise<any[]>
export async function addActionToHistory(action: any): Promise<void>
```

**Recommendation:** Use proper types like `ActionRecord[]`.

---

### 3. Missing null/undefined Checks

**File:** `src/popup/popup.tsx` (Lines 31-49)

```typescript
const response = await chrome.runtime.sendMessage(message);
if (response.error) { // response could be undefined
```

**Recommendation:** Add null check: `if (!response || response.error)`

---

### 4. Unused Message Handler

**File:** `src/content/content-script.ts` (Lines 51-53)

```typescript
case 'TAKE_SCREENSHOT':
  // This is just a placeholder
  return { success: true };
```

---

### 5. Magic Numbers

**File:** `src/content/dom-analyzer.ts`

```typescript
if (bounds.width < 5 || bounds.height < 5) { // Magic number 5
interactive.slice(0, 100); // Magic number 100
```

**Recommendation:** Extract to named constants.

---

## ⚪ RECOMMENDATIONS

| # | Recommendation | Priority |
|---|----------------|----------|
| 1 | Add Settings UI Panel for API key input | P0 |
| 2 | Implement rate limiting for API calls | P1 |
| 3 | Add input validation for user requests | P1 |
| 4 | Implement action queue for race condition prevention | P2 |
| 5 | Add unit tests for critical logic | P2 |
| 6 | Use Chrome APIs for navigation (`goBack`, `goForward`) | P1 |
| 7 | Add opt-in telemetry/analytics | P3 |
| 8 | Consider action replay/undo feature | P3 |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        POPUP UI (React)                             │
│  ChatInterface.tsx - User input, status display, action history    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ chrome.runtime.sendMessage
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SERVICE WORKER (Background)                       │
│  service-worker.ts - Main orchestrator                              │
│  state-manager.ts - Session & action management                     │
│  planner.ts - Gemini wrapper                                        │
│  executor.ts - Claude wrapper                                       │
└──────────────┬─────────────────────────────────────┬────────────────┘
               │ OpenRouter API                      │ chrome.tabs.sendMessage
               ▼                                     ▼
┌─────────────────────────────┐  ┌────────────────────────────────────┐
│       OpenRouter API        │  │        CONTENT SCRIPT              │
│  • Gemini 3 Pro (Planning)  │  │  content-script.ts                 │
│  • Claude Sonnet 4.5        │  │  dom-analyzer.ts                   │
│    (Computer Use)           │  │  action-performer.ts               │
└─────────────────────────────┘  └────────────────────────────────────┘
```

---

## File-by-File Summary

| File | Lines | Status | Notes |
|------|-------|--------|-------|
| `manifest.json` | 72 | ✅ OK | MV3 compliant |
| `constants.ts` | 128 | 🔴 CRITICAL | Hardcoded API key |
| `types.ts` | 271 | ✅ OK | Well-typed |
| `gemini-client.ts` | 251 | 🟡 Needs testing | Model name unverified |
| `anthropic-client.ts` | 277 | 🟡 Needs testing | Computer Use format unverified |
| `service-worker.ts` | 538 | 🟠 TODO items | Confirmation flow incomplete |
| `planner.ts` | 215 | ✅ OK | Good validation |
| `executor.ts` | 196 | 🟡 Bug | Use Chrome APIs for nav |
| `content-script.ts` | 253 | 🟡 Bug | MutationObserver leak |
| `dom-analyzer.ts` | 423 | ✅ OK | Solid implementation |
| `action-performer.ts` | 422 | ✅ OK | Human-like typing |
| `storage-utils.ts` | 175 | ✅ OK | Clean storage handling |
| `popup.tsx` | 145 | ✅ OK | Proper React patterns |
| `planner-system.ts` | 114 | ✅ OK | Clear prompt engineering |
| `executor-system.ts` | 65 | ✅ OK | Good Computer Use guidance |

---

## Conclusion

The codebase is **well-structured** with clear separation of concerns and comprehensive TypeScript typing. The architecture follows Chrome extension best practices with proper MV3 compliance.

**Immediate Actions Required:**
1. 🔴 Rotate and secure the exposed API key
2. 🟠 Implement user confirmation flow for sensitive actions
3. 🟡 Test with actual OpenRouter API to verify model compatibility

**The extension is NOT production-ready** due to the API key exposure, but the code quality is solid for an MVP.

---

*Audit performed: 2026-01-03 by Claude Opus 4.5*
