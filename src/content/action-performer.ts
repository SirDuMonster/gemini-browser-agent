import type { ComputerUseAction } from '../shared/types';
import { debugLog, debugError, COORDINATE_VALIDATION, ACTION_DELAYS, TAB_MANAGEMENT } from '../shared/constants';
import {
  getElementAtPoint,
  scrollIntoView,
  getTypingDelay,
  isFormInput,
} from '../shared/utils/dom-utils';

/**
 * Action Performer - Executes Computer Use actions on the page
 */

/**
 * Perform a Computer Use action
 */
export async function performAction(action: ComputerUseAction): Promise<void> {
  debugLog('ActionPerformer', 'Performing action', { action: action.action });

  try {
    switch (action.action) {
      case 'mouse_move':
        await mouseMove(action.coordinate);
        break;

      case 'left_click':
        await leftClick();
        break;

      case 'left_click_drag':
        await leftClickDrag(action.coordinate);
        break;

      case 'right_click':
        await rightClick();
        break;

      case 'double_click':
        await doubleClick();
        break;

      case 'middle_click':
        await middleClick();
        break;

      case 'key':
        await pressKey(action.text);
        break;

      case 'type':
        await typeText(action.text);
        break;

      case 'screenshot':
        // Screenshot is handled by background script
        debugLog('ActionPerformer', 'Screenshot action - handled by background');
        break;

      case 'cursor_position':
        debugLog('ActionPerformer', 'Cursor position', { cursor: currentCursor });
        break;

      // ============ Navigation Actions (Autonomous Roaming Phase 1) ============

      case 'scroll':
        await scrollPage(action.direction, action.amount);
        break;

      case 'go_back':
        window.history.back();
        await delay(ACTION_DELAYS.AFTER_CLICK_MS); // SPEED: Use configurable delay
        break;

      case 'go_forward':
        window.history.forward();
        await delay(ACTION_DELAYS.AFTER_CLICK_MS); // SPEED: Use configurable delay
        break;

      case 'refresh':
        window.location.reload();
        break;

      // ============ Utility Actions (Autonomous Roaming Phase 1) ============

      case 'wait':
        await performWait(action.duration);
        break;

      case 'extract_text':
        // Return value is handled specially - we just log here
        const extractedText = extractText(action.selector);
        debugLog('ActionPerformer', 'Extracted text', {
          selector: action.selector,
          length: extractedText.length
        });
        break;

      // ============ Tab Actions (handled by background script) ============

      case 'open_tab':
      case 'close_tab':
      case 'switch_tab':
        // These are handled by background script, not content script
        debugLog('ActionPerformer', 'Tab action - delegated to background', { action: action.action });
        break;

      default:
        throw new Error(`Unknown action: ${(action as any).action}`);
    }

    debugLog('ActionPerformer', 'Action completed successfully');
  } catch (error) {
    debugError('ActionPerformer', 'Action failed', error);
    throw error;
  }
}

// ============ Cursor State ============

let currentCursor = { x: 0, y: 0 };

// ============ Coordinate Stability (P2 - Issue #8) ============

/**
 * Wait for element at coordinates to stabilize
 * Prevents clicking on elements that are still shifting/animating
 */
async function waitForElementStability(x: number, y: number): Promise<Element> {
  const { MAX_ELEMENT_SHIFT_PX, STABILITY_CHECK_DELAY_MS, STABILITY_CHECK_ATTEMPTS } = COORDINATE_VALIDATION;

  let previousElement: Element | null = null;
  let previousBounds: DOMRect | null = null;

  for (let i = 0; i < STABILITY_CHECK_ATTEMPTS; i++) {
    const element = getElementAtPoint(x, y);

    if (!element) {
      if (i === STABILITY_CHECK_ATTEMPTS - 1) {
        throw new Error(`No element found at (${x}, ${y}) after ${STABILITY_CHECK_ATTEMPTS} stability checks`);
      }
      await delay(STABILITY_CHECK_DELAY_MS);
      continue;
    }

    const bounds = element.getBoundingClientRect();

    // Check if element is stable (not shifting)
    if (previousElement && previousBounds) {
      const xShift = Math.abs(bounds.x - previousBounds.x);
      const yShift = Math.abs(bounds.y - previousBounds.y);

      if (xShift <= MAX_ELEMENT_SHIFT_PX && yShift <= MAX_ELEMENT_SHIFT_PX) {
        debugLog('ActionPerformer', 'Element stable', { xShift, yShift, attempt: i + 1 });
        return element;
      }

      debugLog('ActionPerformer', 'Element still shifting', { xShift, yShift, attempt: i + 1 });
    }

    previousElement = element;
    previousBounds = bounds;
    await delay(STABILITY_CHECK_DELAY_MS);
  }

  throw new Error(`Element at (${x}, ${y}) did not stabilize after ${STABILITY_CHECK_ATTEMPTS} attempts`);
}

// ============ Coordinate Validation (P2 - Issue #16) ============

/**
 * Validate coordinates are within viewport bounds
 */
function validateCoordinates(x: number, y: number): void {
  const { MIN_COORDINATE_VALUE } = COORDINATE_VALIDATION;

  // Check minimum bounds
  if (x < MIN_COORDINATE_VALUE || y < MIN_COORDINATE_VALUE) {
    throw new Error(`Invalid coordinates: (${x}, ${y}) - coordinates must be non-negative`);
  }

  // Check viewport bounds
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  if (x > viewportWidth || y > viewportHeight) {
    throw new Error(`Coordinates (${x}, ${y}) outside viewport bounds (${viewportWidth}x${viewportHeight})`);
  }

  debugLog('ActionPerformer', 'Coordinates validated', { x, y, viewport: { viewportWidth, viewportHeight } });
}

/**
 * Move mouse to coordinates
 */
async function mouseMove(coordinate: [number, number]): Promise<void> {
  const [x, y] = coordinate;

  // P2 - Issue #16: Validate coordinates first
  validateCoordinates(x, y);

  debugLog('ActionPerformer', 'Moving mouse', { from: currentCursor, to: { x, y } });

  // Update cursor position
  currentCursor = { x, y };

  // Visual feedback: move a cursor element if needed
  // For now, we just update state. Could add visual cursor later.

  // Small delay to simulate mouse movement
  await delay(ACTION_DELAYS.MOUSE_MOVE_MS);
}

/**
 * Perform left click at current cursor position
 * Fixed: Added proper mousedown/mouseup sequence and buttons property
 */
async function leftClick(): Promise<void> {
  const { x, y } = currentCursor;

  debugLog('ActionPerformer', 'Left clicking', { x, y });

  // P2 - Issue #8: Wait for element to stabilize before clicking
  const element = await waitForElementStability(x, y);

  debugLog('ActionPerformer', 'Clicking element', {
    tag: element.tagName,
    id: element.id,
    class: element.className,
  });

  // Scroll into view if needed
  if (element instanceof HTMLElement) {
    scrollIntoView(element, 'auto');
    await delay(ACTION_DELAYS.AFTER_SCROLL_MS);
  }

  // Also trigger focus for form elements BEFORE click
  if (element instanceof HTMLElement) {
    element.focus();
  }

  // Full click sequence: mousedown -> mouseup -> click
  const mouseEventOptions = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 1,
  };

  // Dispatch mousedown
  const mouseDownEvent = new MouseEvent('mousedown', mouseEventOptions);
  element.dispatchEvent(mouseDownEvent);

  await delay(10); // Small delay between events

  // Dispatch mouseup
  const mouseUpEvent = new MouseEvent('mouseup', {
    ...mouseEventOptions,
    buttons: 0, // No buttons pressed after release
  });
  element.dispatchEvent(mouseUpEvent);

  // Dispatch click
  const clickEvent = new MouseEvent('click', mouseEventOptions);
  element.dispatchEvent(clickEvent);

  // For links, try to actually navigate
  if (element instanceof HTMLAnchorElement && element.href) {
    debugLog('ActionPerformer', 'Link detected, attempting navigation', { href: element.href });
    // Try native click as well
    element.click();
  }

  // For buttons, try native click
  if (element instanceof HTMLButtonElement) {
    debugLog('ActionPerformer', 'Button detected, using native click');
    element.click();
  }

  // Small delay after click
  await delay(ACTION_DELAYS.AFTER_CLICK_MS);
}

/**
 * Perform right click at current cursor position
 * C4 Fix: Added coordinate validation
 */
async function rightClick(): Promise<void> {
  const { x, y } = currentCursor;

  // C4 Fix: Validate coordinates before clicking
  validateCoordinates(x, y);

  debugLog('ActionPerformer', 'Right clicking', { x, y });

  const element = getElementAtPoint(x, y);

  if (!element) {
    throw new Error(`No element found at (${x}, ${y})`);
  }

  const contextMenuEvent = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
  });

  element.dispatchEvent(contextMenuEvent);

  await delay(ACTION_DELAYS.AFTER_CLICK_MS);
}

/**
 * Perform double click at current cursor position
 * C4 Fix: Added coordinate validation
 */
async function doubleClick(): Promise<void> {
  const { x, y } = currentCursor;

  // C4 Fix: Validate coordinates before clicking
  validateCoordinates(x, y);

  debugLog('ActionPerformer', 'Double clicking', { x, y });

  const element = getElementAtPoint(x, y);

  if (!element) {
    throw new Error(`No element found at (${x}, ${y})`);
  }

  const dblClickEvent = new MouseEvent('dblclick', {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
  });

  element.dispatchEvent(dblClickEvent);

  await delay(ACTION_DELAYS.AFTER_CLICK_MS);
}

/**
 * Perform middle click (not commonly used in web)
 */
async function middleClick(): Promise<void> {
  const { x, y } = currentCursor;
  // C4 Fix: Validate coordinates before clicking
  validateCoordinates(x, y);

  debugLog('ActionPerformer', 'Middle clicking', { x, y });

  const element = getElementAtPoint(x, y);

  if (!element) {
    throw new Error(`No element found at (${x}, ${y})`);
  }

  const middleClickEvent = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: window,
    button: 1, // Middle button
    clientX: x,
    clientY: y,
  });

  element.dispatchEvent(middleClickEvent);

  await delay(ACTION_DELAYS.AFTER_CLICK_MS);
}

/**
 * Click and drag to coordinates
 */
async function leftClickDrag(coordinate: [number, number]): Promise<void> {
  const startX = currentCursor.x;
  const startY = currentCursor.y;
  const [endX, endY] = coordinate;

  // H8 Fix: Validate both start and end coordinates
  validateCoordinates(startX, startY);
  validateCoordinates(endX, endY);

  debugLog('ActionPerformer', 'Dragging', {
    from: { x: startX, y: startY },
    to: { x: endX, y: endY },
  });

  const startElement = getElementAtPoint(startX, startY);

  if (!startElement) {
    throw new Error(`No element found at start position (${startX}, ${startY})`);
  }

  // Mouse down at start
  const mouseDownEvent = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: startX,
    clientY: startY,
  });

  startElement.dispatchEvent(mouseDownEvent);

  await delay(ACTION_DELAYS.DRAG_MOUSE_DOWN_MS);

  // Simulate drag with mouse move events
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const x = startX + ((endX - startX) * i) / steps;
    const y = startY + ((endY - startY) * i) / steps;

    const mouseMoveEvent = new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
    });

    document.dispatchEvent(mouseMoveEvent);

    await delay(ACTION_DELAYS.DRAG_STEP_MS);
  }

  // Mouse up at end
  const endElement = getElementAtPoint(endX, endY);

  const mouseUpEvent = new MouseEvent('mouseup', {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: endX,
    clientY: endY,
  });

  if (endElement) {
    endElement.dispatchEvent(mouseUpEvent);
  } else {
    document.dispatchEvent(mouseUpEvent);
  }

  // Update cursor position
  currentCursor = { x: endX, y: endY };

  await delay(ACTION_DELAYS.AFTER_CLICK_MS);
}

// ============ Platform-Specific Keyboard Shortcuts (P2 - Issue #15) ============

/**
 * Detect current platform
 */
function getPlatform(): 'mac' | 'windows' | 'linux' {
  const platform = navigator.platform.toLowerCase();

  if (platform.includes('mac')) {
    return 'mac';
  } else if (platform.includes('win')) {
    return 'windows';
  } else {
    return 'linux';
  }
}

/**
 * Map key to platform-specific modifiers
 */
function mapKeyForPlatform(key: string): { key: string; modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } } {
  const platform = getPlatform();
  const modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {};

  // Handle common shortcuts
  const shortcuts: Record<string, Record<string, any>> = {
    'copy': {
      mac: { key: 'c', metaKey: true },
      windows: { key: 'c', ctrlKey: true },
      linux: { key: 'c', ctrlKey: true },
    },
    'paste': {
      mac: { key: 'v', metaKey: true },
      windows: { key: 'v', ctrlKey: true },
      linux: { key: 'v', ctrlKey: true },
    },
    'selectAll': {
      mac: { key: 'a', metaKey: true },
      windows: { key: 'a', ctrlKey: true },
      linux: { key: 'a', ctrlKey: true },
    },
    'undo': {
      mac: { key: 'z', metaKey: true },
      windows: { key: 'z', ctrlKey: true },
      linux: { key: 'z', ctrlKey: true },
    },
    'redo': {
      mac: { key: 'z', metaKey: true, shiftKey: true },
      windows: { key: 'y', ctrlKey: true },
      linux: { key: 'y', ctrlKey: true },
    },
    'cut': {
      mac: { key: 'x', metaKey: true },
      windows: { key: 'x', ctrlKey: true },
      linux: { key: 'x', ctrlKey: true },
    },
    'save': {
      mac: { key: 's', metaKey: true },
      windows: { key: 's', ctrlKey: true },
      linux: { key: 's', ctrlKey: true },
    },
  };

  // Check if it's a known shortcut
  if (shortcuts[key] && shortcuts[key][platform]) {
    const shortcut = shortcuts[key][platform];
    const { key: shortcutKey, ...shortcutModifiers } = shortcut;
    return { key: shortcutKey, modifiers: shortcutModifiers };
  }

  // Otherwise return key as-is
  return { key, modifiers };
}

/**
 * Convert key value to physical key code
 * e.g., 'a' -> 'KeyA', 'Enter' -> 'Enter', ' ' -> 'Space'
 */
function keyToCode(key: string): string {
  // Single letter keys
  if (key.length === 1 && /^[a-zA-Z]$/.test(key)) {
    return `Key${key.toUpperCase()}`;
  }
  // Digit keys
  if (key.length === 1 && /^[0-9]$/.test(key)) {
    return `Digit${key}`;
  }
  // Space
  if (key === ' ') {
    return 'Space';
  }
  // Special keys that map directly
  const directMap: Record<string, string> = {
    'Enter': 'Enter',
    'Tab': 'Tab',
    'Escape': 'Escape',
    'Backspace': 'Backspace',
    'Delete': 'Delete',
    'ArrowUp': 'ArrowUp',
    'ArrowDown': 'ArrowDown',
    'ArrowLeft': 'ArrowLeft',
    'ArrowRight': 'ArrowRight',
    'Home': 'Home',
    'End': 'End',
    'PageUp': 'PageUp',
    'PageDown': 'PageDown',
    'Insert': 'Insert',
  };
  if (directMap[key]) {
    return directMap[key];
  }
  // F keys
  if (/^F\d{1,2}$/.test(key)) {
    return key;
  }
  // Default: return as-is
  return key;
}

/**
 * Press a keyboard key
 * P2 - Issue #15: Platform-aware keyboard shortcuts
 * Fixed: Added keypress event and form submission for Enter
 */
async function pressKey(key: string): Promise<void> {
  debugLog('ActionPerformer', 'Pressing key', { key });

  // Find active element
  const element = document.activeElement || document.body;

  // Map special keys
  const keyMap: Record<string, string> = {
    'Return': 'Enter',
    'Page_Down': 'PageDown',
    'Page_Up': 'PageUp',
  };

  const mappedKey = keyMap[key] || key;

  // Get platform-specific mapping
  const { key: finalKey, modifiers } = mapKeyForPlatform(mappedKey);

  debugLog('ActionPerformer', 'Mapped key for platform', {
    original: key,
    mapped: mappedKey,
    final: finalKey,
    modifiers,
    platform: getPlatform(),
    activeElement: element.tagName,
  });

  const keyEventOptions = {
    key: finalKey,
    code: keyToCode(finalKey),
    bubbles: true,
    cancelable: true,
    keyCode: getKeyCode(finalKey),
    which: getKeyCode(finalKey),
    ...modifiers,
  };

  // Dispatch keydown
  const keyDownEvent = new KeyboardEvent('keydown', keyEventOptions);
  const keyDownPrevented = !element.dispatchEvent(keyDownEvent);

  // Dispatch keypress (for character keys and Enter)
  if (!keyDownPrevented && (finalKey.length === 1 || finalKey === 'Enter')) {
    const keyPressEvent = new KeyboardEvent('keypress', keyEventOptions);
    element.dispatchEvent(keyPressEvent);
  }

  await delay(ACTION_DELAYS.AFTER_KEY_MS || 5);

  // Dispatch keyup
  const keyUpEvent = new KeyboardEvent('keyup', keyEventOptions);
  element.dispatchEvent(keyUpEvent);

  // Special handling for Enter key - submit forms or trigger search
  if (finalKey === 'Enter') {
    debugLog('ActionPerformer', 'Enter key pressed, checking for form submission');

    // If in an input field, try to submit the form
    if (element instanceof HTMLInputElement) {
      const form = element.form;
      if (form) {
        debugLog('ActionPerformer', 'Submitting form via requestSubmit');
        try {
          // requestSubmit triggers submit event handlers, submit() doesn't
          form.requestSubmit();
        } catch (e) {
          debugLog('ActionPerformer', 'requestSubmit failed, trying submit()', e);
          form.submit();
        }
      } else {
        // No form - might be a search input with custom JS handler
        // Dispatch change event to trigger any listeners
        debugLog('ActionPerformer', 'No form found, dispatching change event');
        element.dispatchEvent(new Event('change', { bubbles: true }));

        // Also try to find and click a nearby submit button
        const parent = element.closest('div, form, section');
        if (parent) {
          const submitButton = parent.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
          if (submitButton instanceof HTMLElement) {
            debugLog('ActionPerformer', 'Found submit button, clicking it');
            submitButton.click();
          }
        }
      }
    }
  }

  await delay(ACTION_DELAYS.AFTER_KEY_MS || 5);
}

/**
 * Get keyCode for a key (legacy but still used by some sites)
 */
function getKeyCode(key: string): number {
  const keyCodes: Record<string, number> = {
    'Enter': 13,
    'Tab': 9,
    'Escape': 27,
    'Backspace': 8,
    'Delete': 46,
    'ArrowUp': 38,
    'ArrowDown': 40,
    'ArrowLeft': 37,
    'ArrowRight': 39,
    'Home': 36,
    'End': 35,
    'PageUp': 33,
    'PageDown': 34,
    'Space': 32,
    ' ': 32,
  };

  if (keyCodes[key]) {
    return keyCodes[key];
  }

  // Single character - return char code
  if (key.length === 1) {
    return key.toUpperCase().charCodeAt(0);
  }

  return 0;
}

/**
 * Type text with human-like delays
 * Uses native value setter to bypass framework input handling (React, Vue, Angular)
 */
async function typeText(text: string): Promise<void> {
  debugLog('ActionPerformer', 'Typing text', { text, length: text.length });

  // Find the focused element
  let element = document.activeElement;

  // If no focused element or not an input, try to find one at cursor position
  if (!element || !isFormInput(element)) {
    const cursorElement = getElementAtPoint(currentCursor.x, currentCursor.y);
    if (cursorElement && isFormInput(cursorElement)) {
      element = cursorElement;
      if (element instanceof HTMLElement) {
        element.focus();
        await delay(ACTION_DELAYS.FOCUS_ELEMENT_MS);
      }
    }
  }

  if (!element || !isFormInput(element)) {
    // M18 Fix: Better error diagnostics
    const activeElementInfo = document.activeElement
      ? `activeElement: ${document.activeElement.tagName}${document.activeElement.id ? '#' + document.activeElement.id : ''}`
      : 'no activeElement';
    const cursorPos = `cursor: (${currentCursor.x}, ${currentCursor.y})`;
    throw new Error(`No input element focused for typing. ${activeElementInfo}, ${cursorPos}`);
  }

  // Get native value setter to bypass React/Vue/Angular controlled input handling
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    element instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype,
    'value'
  )?.set;

  // Type each character with delay
  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // For input/textarea elements, update value using native setter
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const currentValue = element.value;
      const newValue = currentValue + char;

      // Use native setter if available (bypasses React/Vue state tracking)
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(element, newValue);
      } else {
        element.value = newValue;
      }

      // Dispatch input event to notify the page of the change
      const inputEvent = new Event('input', {
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(inputEvent);

    } else if (element instanceof HTMLElement && element.isContentEditable) {
      // For contenteditable, use execCommand or insertText
      try {
        // Modern approach using InputEvent
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(char));
          range.collapse(false);
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (contentEditableError) {
        // L14 Fix: Log fallback usage for debugging
        debugLog('ActionPerformer', 'ContentEditable primary method failed, using keypress fallback', { char });
        const keyEvent = new KeyboardEvent('keypress', {
          key: char,
          bubbles: true,
          cancelable: true,
        });
        element.dispatchEvent(keyEvent);
      }
    }

    // Human-like delay between characters
    await delay(getTypingDelay());
  }

  debugLog('ActionPerformer', 'Typing complete');
}

/**
 * Helper: delay function
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get current cursor position (for debugging)
 */
export function getCursorPosition(): { x: number; y: number } {
  return { ...currentCursor };
}

/**
 * Reset cursor position
 */
export function resetCursor(): void {
  currentCursor = { x: 0, y: 0 };
}

// ============ Navigation Actions (Autonomous Roaming Phase 1) ============

/**
 * Scroll the page in a direction
 */
async function scrollPage(direction: 'up' | 'down', amount?: number): Promise<void> {
  const scrollAmount = amount || TAB_MANAGEMENT.DEFAULT_SCROLL_AMOUNT;
  const scrollY = direction === 'down' ? scrollAmount : -scrollAmount;

  debugLog('ActionPerformer', 'Scrolling page', { direction, amount: scrollAmount });

  window.scrollBy({
    top: scrollY,
    behavior: 'smooth'
  });

  await delay(ACTION_DELAYS.AFTER_SCROLL_MS);
}

// ============ Utility Actions (Autonomous Roaming Phase 1) ============

/**
 * Wait for a specified duration
 */
async function performWait(duration: number): Promise<void> {
  // Cap at maximum wait time for safety
  const safeDuration = Math.min(duration, TAB_MANAGEMENT.MAX_WAIT_DURATION_MS);

  debugLog('ActionPerformer', 'Waiting', { requestedMs: duration, actualMs: safeDuration });

  await delay(safeDuration);
}

/**
 * Extract text from the page or a specific element
 */
export function extractText(selector?: string): string {
  debugLog('ActionPerformer', 'Extracting text', { selector });

  if (selector) {
    const element = document.querySelector(selector);
    if (!element) {
      debugLog('ActionPerformer', 'Element not found for selector', { selector });
      return '';
    }
    return element.textContent?.trim() || '';
  }

  // Extract all visible text from body (limited to avoid huge payloads)
  const MAX_TEXT_LENGTH = 5000;
  const bodyText = document.body.innerText || '';

  return bodyText.substring(0, MAX_TEXT_LENGTH);
}
