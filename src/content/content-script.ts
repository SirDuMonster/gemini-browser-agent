import type { ContentMessage, ContentResponse, ComputerUseAction, DOMSnapshot } from '../shared/types';
import { debugLog, debugError } from '../shared/constants';
import { analyzePage } from './dom-analyzer';
import { performAction, getCursorPosition, resetCursor } from './action-performer';
import { getViewportSize } from '../shared/utils/dom-utils';

/**
 * Content Script - Main controller for page interaction
 * Runs on every page and communicates with service worker
 */

debugLog('ContentScript', 'Content script loaded', {
  url: window.location.href,
  title: document.title,
});

// ============ Message Listener ============

chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
  // M21 Fix: Add health check handler
  if ((message as { type: string }).type === 'PING') {
    sendResponse({ status: 'alive', url: window.location.href });
    return true;
  }

  debugLog('ContentScript', 'Message received', { type: message.type });

  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      debugError('ContentScript', 'Message handler error', error);
      sendResponse({ error: error.message });
    });

  // Return true to indicate async response
  return true;
});

/**
 * Handle messages from service worker
 * @returns ContentResponse with proper type safety
 */
async function handleMessage(message: ContentMessage): Promise<ContentResponse> {
  switch (message.type) {
    case 'GET_CONTEXT':
      return await handleGetContext();

    case 'PERFORM_ACTION':
      return await handlePerformAction(message.action);

    case 'HIGHLIGHT_ELEMENT':
      return await handleHighlightElement(message.selector);

    case 'CLEAR_HIGHLIGHTS':
      return await handleClearHighlights();

    // P3 - Issue #22: Removed unused TAKE_SCREENSHOT placeholder
    // Screenshots are handled by background script using chrome.tabs.captureVisibleTab

    default:
      throw new Error(`Unknown message type: ${(message as any).type}`);
  }
}

// ============ Message Handlers ============

/**
 * Get current page context (DOM snapshot + viewport)
 */
async function handleGetContext(): Promise<{ domSnapshot: DOMSnapshot; viewport: { width: number; height: number } }> {
  debugLog('ContentScript', 'Getting page context...');

  try {
    // Wait for page to be fully loaded
    if (document.readyState !== 'complete') {
      await waitForPageLoad();
    }

    // Analyze page
    const domSnapshot = analyzePage();
    const viewport = getViewportSize();

    debugLog('ContentScript', 'Context ready', {
      interactiveElements: domSnapshot.interactiveElements.length,
      forms: domSnapshot.forms.length,
      links: domSnapshot.links.length,
      viewport,
    });

    return {
      domSnapshot,
      viewport,
    };
  } catch (error) {
    debugError('ContentScript', 'Failed to get context', error);
    throw error;
  }
}

/**
 * Perform a Computer Use action
 */
async function handlePerformAction(action: ComputerUseAction): Promise<{ success: true; cursorPosition: { x: number; y: number } }> {
  debugLog('ContentScript', 'Performing action', { action: action.action });

  try {
    await performAction(action);

    return {
      success: true,
      cursorPosition: getCursorPosition(),
    };
  } catch (error) {
    debugError('ContentScript', 'Failed to perform action', error);
    throw error;
  }
}

/**
 * Highlight an element on the page (visual feedback)
 */
async function handleHighlightElement(selector: string): Promise<{ success: true }> {
  debugLog('ContentScript', 'Highlighting element', { selector });

  try {
    const element = document.querySelector(selector);

    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    highlightElement(element);

    return { success: true };
  } catch (error) {
    debugError('ContentScript', 'Failed to highlight element', error);
    throw error;
  }
}

/**
 * Clear all highlights
 */
async function handleClearHighlights(): Promise<{ success: true }> {
  debugLog('ContentScript', 'Clearing highlights');

  clearAllHighlights();

  return { success: true };
}

// ============ Highlighting ============

// M24 Fix: Use more unique class name to avoid CSS conflicts
const HIGHLIGHT_CLASS = '__gemini_chrome_agent_highlight_9f3x2k__';
const HIGHLIGHT_DURATION = 2000; // 2 seconds

/**
 * Add highlight to element
 */
function highlightElement(element: Element): void {
  // Remove existing highlights first
  clearAllHighlights();

  // Add highlight class
  element.classList.add(HIGHLIGHT_CLASS);

  // Auto-remove after duration
  setTimeout(() => {
    element.classList.remove(HIGHLIGHT_CLASS);
  }, HIGHLIGHT_DURATION);

  debugLog('ContentScript', 'Element highlighted', {
    tag: element.tagName,
    id: element.id,
  });
}

/**
 * Remove all highlights
 */
function clearAllHighlights(): void {
  const highlighted = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
  highlighted.forEach(el => el.classList.remove(HIGHLIGHT_CLASS));
}

// ============ Utilities ============

/**
 * Wait for page to fully load
 */
function waitForPageLoad(): Promise<void> {
  return new Promise((resolve) => {
    if (document.readyState === 'complete') {
      resolve();
      return;
    }

    window.addEventListener('load', () => {
      resolve();
    }, { once: true });
  });
}

/**
 * Detect page changes (for SPAs)
 * P1 - Issue #6: Fixed MutationObserver cleanup to prevent memory leak
 * H6: Fixed race condition with cleanup flag
 */
let lastUrl = window.location.href;
let pageObserver: MutationObserver | null = null;
let isObserverActive = false; // Track observer state to prevent race conditions

function detectPageChanges(): void {
  // Don't create multiple observers
  if (pageObserver || isObserverActive) {
    return;
  }

  // Guard against null document.body (can happen on empty pages or early script execution)
  if (!document.body) {
    debugLog('ContentScript', 'document.body not available, skipping MutationObserver');
    return;
  }

  isObserverActive = true;

  pageObserver = new MutationObserver(() => {
    // Safety check: Don't process if observer is being cleaned up
    if (!isObserverActive || !pageObserver) {
      return;
    }

    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;

      debugLog('ContentScript', 'Page navigation detected', { url: lastUrl });

      // Reset cursor position on navigation
      resetCursor();

      // Notify service worker (optional)
      chrome.runtime.sendMessage({
        type: 'PAGE_CHANGED',
        url: lastUrl,
      }).catch((error) => {
        // M25 Fix: Log instead of silently swallowing
        debugLog('ContentScript', 'PAGE_CHANGED notification failed (service worker may not be listening)', error?.message);
      });
    }
  });

  pageObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  debugLog('ContentScript', 'MutationObserver started');
}

/**
 * Cleanup MutationObserver to prevent memory leak (P1 - Issue #6)
 * H6: Thread-safe cleanup with flag check
 */
function cleanupObserver(): void {
  if (pageObserver) {
    debugLog('ContentScript', 'Disconnecting MutationObserver');

    // Set flag first to prevent race condition
    isObserverActive = false;

    // Then disconnect observer
    pageObserver.disconnect();
    pageObserver = null;

    debugLog('ContentScript', 'MutationObserver cleanup complete');
  }
}

// Start observing page changes
detectPageChanges();

// P1 - Issue #6: Cleanup on page unload
window.addEventListener('beforeunload', () => {
  cleanupObserver();
});

// P1 - Issue #6: Cleanup when page becomes hidden (e.g., tab switch, minimize)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cleanupObserver();
  } else {
    // Restart observer when page becomes visible again
    if (!pageObserver) {
      detectPageChanges();
    }
  }
});

// ============ Initialization ============

// Log when page is ready
if (document.readyState === 'complete') {
  debugLog('ContentScript', 'Page already loaded');
} else {
  window.addEventListener('load', () => {
    debugLog('ContentScript', 'Page loaded');
  });
}

// Notify service worker that content script is ready
chrome.runtime.sendMessage({
  type: 'CONTENT_SCRIPT_READY',
  url: window.location.href,
}).catch((error) => {
  // M25 Fix: Log instead of silently swallowing
  debugLog('ContentScript', 'CONTENT_SCRIPT_READY notification failed (service worker may not be listening)', error?.message);
});

debugLog('ContentScript', 'Content script initialization complete');
