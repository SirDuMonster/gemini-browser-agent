import type {
  DOMSnapshot,
  InteractiveElement,
  FormInfo,
  LinkInfo,
  AccessibilityNode,
} from '../shared/types';
import {
  getAllInteractiveElements,
  getAllForms,
  getAllLinks,
  getElementBounds,
  getElementText,
  getUniqueSelector,
  isElementEnabled,
  isElementVisible,
} from '../shared/utils/dom-utils';
import { debugLog, DOM_ANALYSIS } from '../shared/constants';

/**
 * DOM Analyzer - Analyzes page structure and creates simplified representation
 */

/**
 * Analyze current page and create DOM snapshot
 */
export function analyzePage(): DOMSnapshot {
  debugLog('DOMAnalyzer', 'Starting page analysis...');

  const startTime = performance.now();

  // Analyze different aspects
  const interactiveElements = analyzeInteractiveElements();
  const forms = analyzeForms();
  const links = analyzeLinks();
  const accessibilityTree = buildAccessibilityTree();

  const duration = performance.now() - startTime;

  debugLog('DOMAnalyzer', 'Page analysis complete', {
    interactiveElements: interactiveElements.length,
    forms: forms.length,
    links: links.length,
    accessibilityNodes: countNodes(accessibilityTree),
    duration: `${duration.toFixed(2)}ms`,
  });

  return {
    interactiveElements,
    forms,
    links,
    accessibilityTree,
  };
}

/**
 * Analyze interactive elements
 */
function analyzeInteractiveElements(): InteractiveElement[] {
  const elements = getAllInteractiveElements();
  const interactive: InteractiveElement[] = [];

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];

    try {
      const bounds = getElementBounds(element);

      // Skip elements that are too small (likely hidden)
      // P3 - Issue #19: Extracted magic number to constant
      if (bounds.width < DOM_ANALYSIS.MIN_INTERACTIVE_SIZE_PX ||
          bounds.height < DOM_ANALYSIS.MIN_INTERACTIVE_SIZE_PX) {
        continue;
      }

      const interactiveEl: InteractiveElement = {
        id: element.id || `element_${i}`,
        tagName: element.tagName.toLowerCase(),
        type: element instanceof HTMLInputElement ? element.type : undefined,
        text: getElementText(element),
        placeholder: element instanceof HTMLInputElement ? element.placeholder : undefined,
        bounds,
        selector: getUniqueSelector(element),
        isVisible: isElementVisible(element),
        isEnabled: isElementEnabled(element),
      };

      interactive.push(interactiveEl);
    } catch (error) {
      // Skip elements that cause errors
      continue;
    }
  }

  // Sort by position (top to bottom, left to right)
  interactive.sort((a, b) => {
    if (Math.abs(a.bounds.y - b.bounds.y) > 50) {
      return a.bounds.y - b.bounds.y;
    }
    return a.bounds.x - b.bounds.x;
  });

  // P3 - Issue #19: Extracted magic number to constant
  // Limit to top N elements to avoid overwhelming the AI
  return interactive.slice(0, DOM_ANALYSIS.MAX_INTERACTIVE_ELEMENTS);
}

/**
 * Analyze forms on the page
 */
function analyzeForms(): FormInfo[] {
  const forms = getAllForms();
  const formInfos: FormInfo[] = [];

  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];

    if (!isElementVisible(form)) {
      continue;
    }

    const fields = Array.from(form.elements)
      .filter(el => isElementVisible(el))
      .map((el, idx) => {
        const bounds = getElementBounds(el);

        return {
          id: el.id || `form_${i}_field_${idx}`,
          tagName: el.tagName.toLowerCase(),
          type: el instanceof HTMLInputElement ? el.type : undefined,
          text: getElementText(el),
          placeholder: el instanceof HTMLInputElement ? el.placeholder : undefined,
          bounds,
          selector: getUniqueSelector(el),
          isVisible: isElementVisible(el),
          isEnabled: isElementEnabled(el),
        } as InteractiveElement;
      });

    formInfos.push({
      id: form.id || `form_${i}`,
      action: form.action,
      method: form.method,
      fields,
    });
  }

  return formInfos;
}

/**
 * Analyze links on the page
 */
function analyzeLinks(): LinkInfo[] {
  const links = getAllLinks();
  const linkInfos: LinkInfo[] = [];

  for (const link of links) {
    try {
      const text = getElementText(link);

      // Skip empty links
      if (!text && !link.href) {
        continue;
      }

      linkInfos.push({
        text: text || link.href,
        href: link.href,
        bounds: getElementBounds(link),
      });
    } catch (error) {
      continue;
    }
  }

  // P3 - Issue #19: Extracted magic number to constant
  // Limit to N most relevant links
  return linkInfos.slice(0, DOM_ANALYSIS.MAX_LINKS_TO_ANALYZE);
}

/**
 * Build simplified accessibility tree
 * M19 Fix: Reset node counter before building
 */
function buildAccessibilityTree(maxDepth: number = 3): AccessibilityNode[] {
  accessibilityNodeCount = 0; // Reset counter
  const root = document.body;
  return buildTreeRecursive(root, 0, maxDepth);
}

/**
 * Recursively build accessibility tree
 */
// M19 Fix: Add node limit to prevent performance issues on large pages
const MAX_ACCESSIBILITY_NODES = 200;
let accessibilityNodeCount = 0;

function buildTreeRecursive(
  element: Element,
  depth: number,
  maxDepth: number
): AccessibilityNode[] {
  if (depth >= maxDepth || accessibilityNodeCount >= MAX_ACCESSIBILITY_NODES) {
    return [];
  }

  const nodes: AccessibilityNode[] = [];

  for (const child of element.children) {
    // Skip non-visible elements
    if (!isElementVisible(child)) {
      continue;
    }

    // Skip script and style elements
    const tagName = child.tagName.toLowerCase();
    if (['script', 'style', 'noscript'].includes(tagName)) {
      continue;
    }

    const role = getRole(child);
    const name = getName(child);

    // Only include elements with meaningful roles or names
    if (!role && !name) {
      // Recurse into children
      const childNodes = buildTreeRecursive(child, depth, maxDepth);
      nodes.push(...childNodes);
      continue;
    }

    // M19 Fix: Increment node count
    accessibilityNodeCount++;
    if (accessibilityNodeCount >= MAX_ACCESSIBILITY_NODES) {
      break;
    }

    const node: AccessibilityNode = {
      role: role || tagName,
      name: name || '',
      description: getDescription(child),
      bounds: getElementBounds(child),
      children: buildTreeRecursive(child, depth + 1, maxDepth),
    };

    nodes.push(node);
  }

  return nodes;
}

/**
 * Get accessibility role
 */
function getRole(element: Element): string {
  // Explicit role attribute
  if (element.hasAttribute('role')) {
    return element.getAttribute('role') || '';
  }

  // Implicit roles based on tag
  const tagName = element.tagName.toLowerCase();

  const roleMap: Record<string, string> = {
    'button': 'button',
    'a': 'link',
    'input': 'textbox',
    'select': 'combobox',
    'textarea': 'textbox',
    'img': 'image',
    'nav': 'navigation',
    'header': 'banner',
    'footer': 'contentinfo',
    'main': 'main',
    'aside': 'complementary',
    'section': 'region',
    'article': 'article',
    'form': 'form',
    'table': 'table',
    'ul': 'list',
    'ol': 'list',
    'li': 'listitem',
    'h1': 'heading',
    'h2': 'heading',
    'h3': 'heading',
    'h4': 'heading',
    'h5': 'heading',
    'h6': 'heading',
  };

  return roleMap[tagName] || '';
}

/**
 * Get accessible name
 */
function getName(element: Element): string {
  // aria-label
  if (element.hasAttribute('aria-label')) {
    return element.getAttribute('aria-label') || '';
  }

  // aria-labelledby
  if (element.hasAttribute('aria-labelledby')) {
    const id = element.getAttribute('aria-labelledby');
    if (id) {
      const labelElement = document.getElementById(id);
      if (labelElement) {
        return getElementText(labelElement);
      }
    }
  }

  // Label for inputs
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) {
      return getElementText(label);
    }

    // Placeholder as fallback
    if (element.placeholder) {
      return element.placeholder;
    }
  }

  // Text content for buttons, links, headings
  const tagName = element.tagName.toLowerCase();
  if (['button', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
    return getElementText(element);
  }

  // Title attribute
  if (element.hasAttribute('title')) {
    return element.getAttribute('title') || '';
  }

  // Alt text for images
  if (element instanceof HTMLImageElement && element.alt) {
    return element.alt;
  }

  return '';
}

/**
 * Get accessible description
 */
function getDescription(element: Element): string | undefined {
  // aria-description
  if (element.hasAttribute('aria-description')) {
    return element.getAttribute('aria-description') || undefined;
  }

  // aria-describedby
  if (element.hasAttribute('aria-describedby')) {
    const id = element.getAttribute('aria-describedby');
    if (id) {
      const descElement = document.getElementById(id);
      if (descElement) {
        return getElementText(descElement);
      }
    }
  }

  return undefined;
}

/**
 * Count total nodes in tree
 */
function countNodes(nodes: AccessibilityNode[]): number {
  let count = nodes.length;
  for (const node of nodes) {
    if (node.children) {
      count += countNodes(node.children);
    }
  }
  return count;
}

/**
 * Find element by description (fuzzy match)
 */
export function findElementByDescription(description: string): Element | null {
  const lowerDesc = description.toLowerCase();
  const elements = getAllInteractiveElements();

  for (const element of elements) {
    const text = getElementText(element).toLowerCase();

    // Exact match
    if (text === lowerDesc) {
      return element;
    }

    // Contains match
    if (text.includes(lowerDesc) || lowerDesc.includes(text)) {
      return element;
    }
  }

  // Try accessibility tree
  const nodes = buildAccessibilityTree(5);
  const node = findNodeByName(nodes, lowerDesc);

  if (node) {
    // M31 Fix: Check if bounds are within viewport before using elementFromPoint
    const centerX = node.bounds.x + node.bounds.width / 2;
    const centerY = node.bounds.y + node.bounds.height / 2;

    // Only use elementFromPoint if within viewport
    if (centerX >= 0 && centerX <= window.innerWidth &&
        centerY >= 0 && centerY <= window.innerHeight) {
      const element = document.elementFromPoint(centerX, centerY);
      return element;
    }
  }

  return null;
}

/**
 * Find node by name in accessibility tree
 */
function findNodeByName(nodes: AccessibilityNode[], name: string): AccessibilityNode | null {
  for (const node of nodes) {
    if (node.name.toLowerCase().includes(name) || name.includes(node.name.toLowerCase())) {
      return node;
    }

    if (node.children) {
      const found = findNodeByName(node.children, name);
      if (found) {
        return found;
      }
    }
  }

  return null;
}
