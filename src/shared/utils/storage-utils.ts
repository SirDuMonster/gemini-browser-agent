import { STORAGE_KEYS, debugLog, debugError } from '../constants';
import type { AgentSettings, AgentSession, ActionRecord, AgentMemory } from '../types';
import { DEFAULT_SETTINGS } from '../constants';

/**
 * Storage utilities for Chrome extension storage
 */

/**
 * API Key Management
 * Uses STORAGE_KEYS.API_KEYS for consistency with other storage operations
 *
 * L10 Note: getApiKey, setApiKey, and hasApiKey are exported for use by:
 * - Settings panel for loading/saving API key
 * - Service worker for initialization
 * - GeminiClient for lazy API key loading
 */

export async function getApiKey(): Promise<string> {
  // Check new location first, then fallback to legacy location for migration
  const result = await chrome.storage.local.get([STORAGE_KEYS.API_KEYS, 'googleAiApiKey']);

  // If found in new location, return it
  if (result[STORAGE_KEYS.API_KEYS]) {
    return result[STORAGE_KEYS.API_KEYS];
  }

  // If found in legacy location, migrate it
  if (result.googleAiApiKey) {
    // H15 Fix: Only remove legacy key after confirmed save
    try {
      await setApiKey(result.googleAiApiKey);
      // Clean up legacy key only after successful migration
      await chrome.storage.local.remove('googleAiApiKey');
      debugLog('Storage', 'Migrated API key to new storage location');
    } catch (migrationError) {
      debugError('Storage', 'Failed to migrate API key, keeping legacy location', migrationError);
      // Return legacy key even if migration failed
    }
    return result.googleAiApiKey;
  }

  return '';
}

/**
 * M13 Fix: Add error handling to setApiKey
 */
export async function setApiKey(apiKey: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.API_KEYS]: apiKey });
  } catch (error) {
    debugError('Storage', 'Failed to save API key', error);
    throw error;
  }
}

export async function hasApiKey(): Promise<boolean> {
  const key = await getApiKey();
  return key.length > 0;
}

/**
 * Get agent settings from storage
 */
export async function getSettings(): Promise<AgentSettings> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);

    if (result[STORAGE_KEYS.SETTINGS]) {
      // Merge with defaults to ensure all fields exist
      return {
        ...DEFAULT_SETTINGS,
        ...result[STORAGE_KEYS.SETTINGS],
      };
    }

    // First time - save defaults
    await saveSettings(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  } catch (error) {
    debugError('Storage', 'Failed to get settings', error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Save agent settings to storage
 */
export async function saveSettings(settings: Partial<AgentSettings>): Promise<void> {
  try {
    // Get current settings from storage directly (avoid recursion)
    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    const current = result[STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS;

    const updated = {
      ...current,
      ...settings,
    };

    await chrome.storage.local.set({
      [STORAGE_KEYS.SETTINGS]: updated,
    });

    debugLog('Storage', 'Settings saved', updated);
  } catch (error) {
    debugError('Storage', 'Failed to save settings', error);
    throw error;
  }
}

/**
 * Get current session from storage
 */
export async function getSession(): Promise<AgentSession | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SESSION);
    return result[STORAGE_KEYS.SESSION] || null;
  } catch (error) {
    debugError('Storage', 'Failed to get session', error);
    return null;
  }
}

/**
 * Save session to storage
 */
export async function saveSession(session: AgentSession): Promise<void> {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.SESSION]: session,
    });

    debugLog('Storage', 'Session saved', {
      id: session.id,
      status: session.status,
      actions: session.actions.length,
    });
  } catch (error) {
    debugError('Storage', 'Failed to save session', error);
    throw error;
  }
}

/**
 * Clear current session
 */
export async function clearSession(): Promise<void> {
  try {
    await chrome.storage.local.remove(STORAGE_KEYS.SESSION);
    debugLog('Storage', 'Session cleared');
  } catch (error) {
    debugError('Storage', 'Failed to clear session', error);
    throw error;
  }
}

/**
 * Get action history
 * P3 - Issue #18: Fixed TypeScript any type
 */
export async function getActionHistory(): Promise<ActionRecord[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.ACTION_HISTORY);
    return result[STORAGE_KEYS.ACTION_HISTORY] || [];
  } catch (error) {
    debugError('Storage', 'Failed to get action history', error);
    return [];
  }
}

/**
 * Add action to history
 * P3 - Issue #18: Fixed TypeScript any type
 */
export async function addActionToHistory(action: ActionRecord): Promise<void> {
  try {
    const history = await getActionHistory();
    history.push(action);

    // Keep only last 100 actions
    const trimmed = history.slice(-100);

    await chrome.storage.local.set({
      [STORAGE_KEYS.ACTION_HISTORY]: trimmed,
    });

    debugLog('Storage', 'Action added to history', {
      total: trimmed.length,
    });
  } catch (error) {
    debugError('Storage', 'Failed to add action to history', error);
  }
}

/**
 * Clear action history
 */
export async function clearActionHistory(): Promise<void> {
  try {
    await chrome.storage.local.remove(STORAGE_KEYS.ACTION_HISTORY);
    debugLog('Storage', 'Action history cleared');
  } catch (error) {
    debugError('Storage', 'Failed to clear action history', error);
    throw error;
  }
}

/**
 * Get all storage data (for debugging)
 * M12 Fix: Use proper return type instead of Promise<any>
 */
export async function getAllStorageData(): Promise<Record<string, unknown>> {
  try {
    const data = await chrome.storage.local.get(null);
    return data;
  } catch (error) {
    debugError('Storage', 'Failed to get all storage data', error);
    return {};
  }
}

/**
 * Clear all storage data
 */
export async function clearAllStorage(): Promise<void> {
  try {
    await chrome.storage.local.clear();
    debugLog('Storage', 'All storage cleared');
  } catch (error) {
    debugError('Storage', 'Failed to clear all storage', error);
    throw error;
  }
}

// ============ Memory Storage (Autonomous Roaming Phase 2) ============

/**
 * Get agent memory from storage
 */
export async function getMemory(): Promise<AgentMemory | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MEMORY);
    return result[STORAGE_KEYS.MEMORY] || null;
  } catch (error) {
    debugError('Storage', 'Failed to get memory', error);
    return null;
  }
}

/**
 * Save agent memory to storage
 */
export async function saveMemory(memory: AgentMemory): Promise<void> {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.MEMORY]: memory,
    });

    debugLog('Storage', 'Memory saved', {
      goals: memory.goals.length,
      facts: memory.facts.length,
      visitedUrls: memory.visitedUrls.length,
    });
  } catch (error) {
    debugError('Storage', 'Failed to save memory', error);
    throw error;
  }
}

/**
 * Clear agent memory
 */
export async function clearMemory(): Promise<void> {
  try {
    await chrome.storage.local.remove(STORAGE_KEYS.MEMORY);
    debugLog('Storage', 'Memory cleared');
  } catch (error) {
    debugError('Storage', 'Failed to clear memory', error);
    throw error;
  }
}
