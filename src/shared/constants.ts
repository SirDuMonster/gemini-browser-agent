import type { ActionType, AgentSettings } from './types';

// ============ Google AI Configuration ============

/**
 * L17 Note: API key is intentionally empty by default for security.
 * Users must configure their own API key in the extension settings.
 * This prevents accidental exposure of API keys in source control.
 */
export const GOOGLE_AI_API_KEY = '';
export const GOOGLE_AI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// Model names for Google AI
export const GEMINI_MODEL = 'gemini-3-flash-preview'; // Gemini 3 Flash (preview version)
export const GEMINI_MODEL_STABLE = 'gemini-3-flash'; // Fallback to stable version

// ============ Debug Configuration ============

// DEBUG mode - set to true for development/troubleshooting
export const DEBUG = false;
export const LOG_PREFIX = '[GCA]';

export function debugLog(category: string, ...args: any[]) {
  if (DEBUG) {
    console.log(`${LOG_PREFIX} [${category}]`, ...args);
  }
}

export function debugError(category: string, ...args: any[]) {
  if (DEBUG) {
    console.error(`${LOG_PREFIX} [${category}]`, ...args);
  }
}

// ============ Safety Configuration ============

export const SENSITIVE_ACTIONS: ActionType[] = [
  'navigate',
];

export const BLOCKED_DOMAIN_PATTERNS = [
  'bank',
  'banking',
  'paypal',
  'venmo',
  'cash.app',
  'crypto',
  'blockchain',
  '.gov',
  'irs.',
  'medical',
  'healthcare',
  'hospital',
];

export const SENSITIVE_KEYWORDS = [
  'password',
  'credit card',
  'ssn',
  'social security',
  'bank account',
  'routing number',
  'cvv',
  'pin',
];

// ============ Default Settings ============

// ULTRA SPEED: Maximum performance settings
export const DEFAULT_SETTINGS: AgentSettings = {
  googleAiApiKey: '', // User must configure API key in settings

  maxActionsPerTask: 150, // More actions allowed
  actionDelayMs: 50, // ULTRA SPEED: 50ms between actions
  screenshotQuality: 'low', // Lower quality = faster transfer

  requireConfirmationFor: SENSITIVE_ACTIONS,
  blockedDomains: BLOCKED_DOMAIN_PATTERNS,

  showThinkingProcess: true,
  showActionHighlights: true,
  theme: 'dark',
  debugMode: true,
};

// ============ Screenshot Configuration ============

export const SCREENSHOT_CONFIG = {
  low: { quality: 0.5, maxWidth: 1024, maxHeight: 768 },
  medium: { quality: 0.7, maxWidth: 1920, maxHeight: 1080 },
  high: { quality: 0.9, maxWidth: 2560, maxHeight: 1440 },
  adaptive: { quality: 0.75, maxWidth: 1920, maxHeight: 1080 }, // Will adjust based on page complexity
};

// ============ API Configuration ============

export const API_CONFIG = {
  GEMINI: {
    maxTokens: 8192,
    temperature: 0.7,
    timeout: 30000, // 30s
  },
};

// ============ Timeouts and Limits ============
// M29 Fix: Centralized timeout constants for consistency

export const TIMEOUTS = {
  PAGE_LOAD_MS: 10000, // 10 seconds
  ACTION_MS: 5000, // 5 seconds
  CONTENT_SCRIPT_COMM_MS: 5000, // 5 seconds for content script communication
  TAB_LOAD_MS: 30000, // 30 seconds for tab load
} as const;

// Legacy exports for backwards compatibility
export const PAGE_LOAD_TIMEOUT = TIMEOUTS.PAGE_LOAD_MS;
export const ACTION_TIMEOUT = TIMEOUTS.ACTION_MS;
export const MAX_RETRY_ATTEMPTS = 3;
export const RATE_LIMIT_DELAY = 1000; // 1 second between API calls

// ============ Storage Keys ============

export const STORAGE_KEYS = {
  SETTINGS: 'agent_settings',
  SESSION: 'agent_session',
  API_KEYS: 'api_keys',
  ACTION_HISTORY: 'action_history',
  MEMORY: 'agent_memory', // Autonomous Roaming Phase 2
} as const;

// ============ UI Constants ============

export const COLORS = {
  primary: '#6366f1',
  secondary: '#8b5cf6',
  success: '#10b981',
  error: '#ef4444',
  warning: '#f59e0b',
} as const;

// ============ Screenshot Retention (P0 - Issue #2) ============

export const SCREENSHOT_RETENTION = {
  MAX_SCREENSHOTS_IN_MEMORY: 5,
  CLEAR_ON_SESSION_END: true,
  SCREENSHOT_PLACEHOLDER: '[CLEARED - Privacy Protection]',
} as const;

// ============ Rate Limiting (P1 - Issue #4) ============
// ULTRA SPEED: Near-zero delays

export const RATE_LIMITING = {
  MIN_DELAY_BETWEEN_API_CALLS_MS: 0, // No delay between API calls
  MAX_API_CALLS_PER_MINUTE: 300, // 300 calls per minute (5/sec)
  RATE_LIMIT_WINDOW_MS: 60000, // 1 minute window
} as const;

// ============ Input Validation (P1 - Issue #7) ============

export const INPUT_VALIDATION = {
  MAX_REQUEST_LENGTH: 2000,
  MIN_REQUEST_LENGTH: 3,
  FORBIDDEN_PATTERNS: [
    /ignore\s+previous\s+instructions/i,
    /system\s*:/i,
    /assistant\s*:/i,
    /\[INST\]/i,
    /\[\/INST\]/i,
    /<\|im_start\|>/i,
    /<\|im_end\|>/i,
  ],
} as const;

// ============ Coordinate Validation (P2 - Issues #8, #16) ============
// ULTRA SPEED: Minimal stability checks

export const COORDINATE_VALIDATION = {
  MAX_ELEMENT_SHIFT_PX: 50, // Maximum allowed element movement
  STABILITY_CHECK_DELAY_MS: 0, // No delay between stability checks
  STABILITY_CHECK_ATTEMPTS: 1, // Single check only
  MIN_COORDINATE_VALUE: 0, // Minimum coordinate value
} as const;

// ============ DOM Analysis (P3 - Issue #19) ============
// SPEED OPTIMIZED: Reduced limits for faster analysis

export const DOM_ANALYSIS = {
  MIN_INTERACTIVE_SIZE_PX: 10, // Minimum size (was 5px) - filters more tiny elements
  MAX_INTERACTIVE_ELEMENTS: 50, // Maximum elements (was 100) - faster processing
  MAX_LINKS_TO_ANALYZE: 25, // Maximum links (was 50) - faster processing
} as const;

// ============ Action Delays (SSS Optimization) ============
// ULTRA SPEED: Near-zero delays for maximum speed

export const ACTION_DELAYS = {
  MOUSE_MOVE_MS: 0, // No delay after mouse move
  AFTER_CLICK_MS: 5, // Minimal delay after click
  AFTER_SCROLL_MS: 5, // Minimal delay after scrolling
  AFTER_KEY_MS: 0, // No delay between key events
  DRAG_MOUSE_DOWN_MS: 0, // No delay after mouse down
  DRAG_STEP_MS: 0, // No delay between drag steps
  FOCUS_ELEMENT_MS: 5, // Minimal delay after focusing
} as const;

// ============ Service Worker Delays (SSS Optimization) ============
// ULTRA SPEED: Minimal waits

export const SERVICE_WORKER_DELAYS = {
  CONTENT_SCRIPT_INIT_MS: 50, // Minimal wait after injecting content script
  PAGE_STABLE_MS: 50, // Minimal delay for page stabilization
} as const;

// ============ Tab Management (Autonomous Roaming Phase 1) ============
// ULTRA SPEED: Minimal tab operation delays

export const TAB_MANAGEMENT = {
  MAX_TABS: 10, // Maximum tabs agent can have open
  AUTO_CLEANUP_ON_SESSION_END: true, // Close agent-opened tabs when task completes
  DEFAULT_SCROLL_AMOUNT: 300, // Pixels to scroll per scroll action
  MAX_WAIT_DURATION_MS: 3000, // Maximum wait duration (3s)
  TAB_SWITCH_DELAY_MS: 50, // Minimal delay after switching tabs
  TAB_OPEN_DELAY_MS: 100, // Minimal delay after opening new tab
} as const;

// ============ Memory Management (Autonomous Roaming Phase 2) ============

export const MEMORY_CONFIG = {
  MAX_GOALS: 20, // Maximum goals in stack
  MAX_FACTS: 50, // Maximum facts to store
  MAX_VISITED_URLS: 100, // URL history limit
  MAX_FAILED_STRATEGIES: 20, // Failed attempts to remember
  PERSIST_AFTER_UPDATES: 3, // Save to storage every N updates
} as const;

// ============ Verification (Autonomous Roaming Phase 3) ============

export const VERIFICATION_CONFIG = {
  ENABLED: true, // Toggle verification on/off
  MIN_CONFIDENCE_TO_PASS: 0.7, // Minimum confidence to accept action as successful
  MAX_VERIFICATION_RETRIES: 2, // Extra retries after verification failure
  URL_CHANGE_EXPECTED_ACTIONS: ['left_click', 'open_tab', 'go_back', 'go_forward', 'key'] as const,
  DOM_CHANGE_EXPECTED_ACTIONS: ['left_click', 'type', 'key', 'scroll', 'refresh'] as const,
  SKIP_VERIFICATION_ACTIONS: ['mouse_move', 'screenshot', 'cursor_position', 'wait'] as const,
} as const;

// ============ Error Recovery (Autonomous Roaming Phase 4) ============
// ULTRA SPEED: Fast recovery

export const ERROR_RECOVERY = {
  // Stuck detection thresholds
  MAX_CONSECUTIVE_FAILURES: 3, // After 3 failures on same action type
  MAX_ACTIONS_WITHOUT_PROGRESS: 5, // If URL/DOM unchanged for 5 actions
  MAX_VERIFICATION_FAILURES: 3, // Verification loop threshold

  // Recovery behavior
  ENABLE_AUTO_RECOVERY: true, // Toggle automatic recovery
  MAX_RECOVERY_ATTEMPTS: 3, // Max escape attempts before abort
  RECOVERY_COOLDOWN_MS: 100, // Minimal wait between recovery attempts

  // Modal detection patterns (common modal indicators)
  MODAL_SELECTORS: [
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-modal="true"]',
    '.modal',
    '.popup',
    '.overlay',
    '[class*="modal"]',
    '[class*="dialog"]',
  ] as const,

  // Elements that often block interaction
  BLOCKING_ELEMENT_SELECTORS: [
    '.cookie-banner',
    '.cookie-consent',
    '[class*="cookie"]',
    '[class*="consent"]',
    '[class*="gdpr"]',
    '.newsletter-popup',
    '[class*="subscribe"]',
  ] as const,
} as const;

// ============ Multi-Site Tasks (Autonomous Roaming Phase 5) ============

export const MULTI_SITE_CONFIG = {
  // Context storage limits
  MAX_CONTEXTS_PER_TAB: 3, // Keep last 3 contexts per tab
  MAX_KEY_DATA_ENTRIES: 20, // Max key-value pairs per tab

  // Site tracking
  TRACK_CROSS_SITE_PATTERNS: true, // Enable correlation detection
  MIN_CORRELATION_CONFIDENCE: 0.6, // Minimum confidence for correlations

  // Prompt enhancement
  INCLUDE_ALL_TABS_IN_PROMPT: true, // Show all open tabs to AI
  MAX_TABS_IN_PROMPT: 5, // Limit tabs in prompt for context size
} as const;

// ============ File Generation (Phase 6) ============

export const FILE_GENERATION_CONFIG = {
  // Supported file types
  TEXT_BASED_TYPES: ['txt', 'html', 'xml', 'json', 'csv', 'md'] as const,
  BINARY_TYPES: ['docx', 'xlsx', 'pdf'] as const,

  // Size limits
  MAX_CONTENT_LENGTH: 1000000, // 1MB max content size
  MAX_FILENAME_LENGTH: 255, // Max filename length

  // Download settings
  DOWNLOAD_FOLDER: 'GeminiAgent', // Subfolder in Downloads
  PROMPT_FOR_LOCATION: false, // Don't prompt, use default location

  // PDF defaults
  PDF_DEFAULTS: {
    pageSize: 'A4',
    fontSize: 12,
    headingFontSize: 18,
    margin: 40,
  },

  // DOCX defaults
  DOCX_DEFAULTS: {
    fontSize: 24, // in half-points (24 = 12pt)
    headingFontSize: 32,
  },

  // XLSX defaults
  XLSX_DEFAULTS: {
    defaultSheetName: 'Sheet1',
    columnWidth: 15,
  },
} as const;
