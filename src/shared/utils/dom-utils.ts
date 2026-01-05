import type { BoundingBox } from '../types';
import { debugLog } from '../constants';

/**
 * DOM utility functions for element selection and manipulation
 */

/**
 * Check if element is visible on screen
 */
export function isElementVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  // Check display and visibility
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  // Check if element has size
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }

  // Check if element is in viewport (at least partially)
  const isInViewport =
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0;

  return isInViewport;
}

/**
 * Check if element is interactive (can be clicked, typed into, etc.)
 */
export function isInteractiveElement(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();

  // Form elements
  if (['input', 'button', 'select', 'textarea', 'a'].includes(tagName)) {
    return true;
  }

  // Elements with click handlers or tab index
  if (
    element.hasAttribute('onclick') ||
    element.hasAttribute('tabindex') ||
    element.getAttribute('role') === 'button'
  ) {
    return true;
  }

  return false;
}

/**
 * Get element bounding box
 */
export function getElementBounds(element: Element): BoundingBox {
  const rect = element.getBoundingClientRect();

  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/**
 * Get element center coordinates
 */
export function getElementCenter(element: Element): { x: number; y: number } {
  const bounds = getElementBounds(element);

  return {
    x: bounds.x + Math.floor(bounds.width / 2),
    y: bounds.y + Math.floor(bounds.height / 2),
  };
}

/**
 * Get unique CSS selector for an element
 * M16 Fix: Use more stable selector strategy with data attributes and stable classes
 */
export function getUniqueSelector(element: Element): string {
  // If element has ID, use it (most stable)
  if (element.id && !element.id.match(/^[0-9]|:|_/)) {
    // Ensure ID is valid CSS selector and not dynamically generated
    return `#${CSS.escape(element.id)}`;
  }

  // Check for data-testid or other stable attributes
  const stableAttrs = ['data-testid', 'data-id', 'name', 'data-automation-id'];
  for (const attr of stableAttrs) {
    const value = element.getAttribute(attr);
    if (value) {
      return `[${attr}="${CSS.escape(value)}"]`;
    }
  }

  // Build path from element to root
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    // Add stable classes (filter out dynamic ones)
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/)
        .filter(c => c.length > 0 && !c.match(/^[a-z]{1,3}-[a-zA-Z0-9]+$/)); // Filter hash-like classes
      if (classes.length > 0) {
        // Use only first 2 stable classes
        selector += `.${classes.slice(0, 2).map(c => CSS.escape(c)).join('.')}`;
      }
    }

    // Add nth-child if needed for uniqueness
    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children);
      const index = siblings.indexOf(current);
      // Store tagName to avoid null assertion in filter callback
      const currentTagName = current.tagName;
      if (siblings.filter(s => s.tagName === currentTagName).length > 1) {
        selector += `:nth-child(${index + 1})`;
      }
    }

    path.unshift(selector);

    current = current.parentElement;
  }

  return path.join(' > ');
}

/**
 * Get element by selector
 */
export function getElementBySelector(selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch (error) {
    debugLog('DOMUtils', 'Invalid selector', { selector, error });
    return null;
  }
}

/**
 * Get element at coordinates (what would be clicked)
 */
export function getElementAtPoint(x: number, y: number): Element | null {
  return document.elementFromPoint(x, y);
}

/**
 * Get text content of element (cleaned)
 * L16 Fix: Add try-catch for safety
 */
export function getElementText(element: Element): string {
  try {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value;
    }

    if (element instanceof HTMLElement) {
      // Check for placeholder
      if (element.hasAttribute('placeholder')) {
        return element.getAttribute('placeholder') || '';
      }

      // Check for aria-label
      if (element.hasAttribute('aria-label')) {
        return element.getAttribute('aria-label') || '';
      }

      // Get inner text
      return (element.innerText || element.textContent || '').trim();
    }

    return '';
  } catch (error) {
    // L16 Fix: Safely return empty string on any error
    return '';
  }
}

/**
 * Check if element is enabled (can be interacted with)
 */
export function isElementEnabled(element: Element): boolean {
  if (element instanceof HTMLInputElement ||
      element instanceof HTMLButtonElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement) {
    return !element.disabled;
  }

  // Check aria-disabled
  if (element.getAttribute('aria-disabled') === 'true') {
    return false;
  }

  return true;
}

/**
 * Scroll element into view
 * L11 Fix: Add fallback for older browsers
 */
export function scrollIntoView(element: Element, behavior: ScrollBehavior = 'smooth'): void {
  try {
    element.scrollIntoView({
      behavior,
      block: 'center',
      inline: 'center',
    });
  } catch {
    // Fallback for browsers that don't support options
    element.scrollIntoView(true);
  }
}

/**
 * Get all interactive elements in document
 */
export function getAllInteractiveElements(): Element[] {
  const selectors = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[onclick]',
    '[role="button"]',
    '[tabindex]',
  ];

  const elements: Element[] = [];
  const seen = new Set<Element>();

  for (const selector of selectors) {
    const found = document.querySelectorAll(selector);
    found.forEach(el => {
      if (!seen.has(el) && isElementVisible(el) && isElementEnabled(el)) {
        elements.push(el);
        seen.add(el);
      }
    });
  }

  return elements;
}

/**
 * Get all form elements in document
 */
export function getAllForms(): HTMLFormElement[] {
  return Array.from(document.querySelectorAll('form'));
}

/**
 * Get all links in document
 */
export function getAllLinks(): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll('a[href]')).filter(
    link => isElementVisible(link)
  ) as HTMLAnchorElement[];
}

/**
 * Get viewport dimensions
 */
export function getViewportSize(): { width: number; height: number } {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

/**
 * Wait for element to appear
 * M30 Fix: Add AbortSignal support for cleanup
 */
export function waitForElement(
  selector: string,
  timeoutMs: number = 5000,
  signal?: AbortSignal
): Promise<Element> {
  return new Promise((resolve, reject) => {
    // M30 Fix: Check if already aborted
    if (signal?.aborted) {
      reject(new Error('waitForElement aborted'));
      return;
    }

    const element = getElementBySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    let observer: MutationObserver | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };

    // M30 Fix: Listen for abort signal
    const abortHandler = () => {
      cleanup();
      reject(new Error('waitForElement aborted'));
    };
    signal?.addEventListener('abort', abortHandler, { once: true });

    observer = new MutationObserver(() => {
      const element = getElementBySelector(selector);
      if (element) {
        cleanup();
        signal?.removeEventListener('abort', abortHandler);
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    timeout = setTimeout(() => {
      cleanup();
      signal?.removeEventListener('abort', abortHandler);
      reject(new Error(`Element ${selector} not found within ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

/**
 * Simulate human-like typing delay
 * ULTRA SPEED: Near-instant typing
 */
export function getTypingDelay(): number {
  // 0-3ms per character (near instant)
  return Math.random() * 3;
}

/**
 * Check if element is a form input
 */
export function isFormInput(element: Element): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  );
}
