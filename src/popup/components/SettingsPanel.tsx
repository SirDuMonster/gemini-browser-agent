import React, { useState, useEffect, useRef } from 'react';
import type { AgentSettings } from '../../shared/types';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../../shared/constants';
import { debugLog, debugError } from '../../shared/constants';

interface SettingsPanelProps {
  onClose: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // H9 Fix: Track timeout for cleanup
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // H9 Fix: Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
      if (result[STORAGE_KEYS.SETTINGS]) {
        setSettings(result[STORAGE_KEYS.SETTINGS]);
        debugLog('SettingsPanel', 'Settings loaded', result[STORAGE_KEYS.SETTINGS]);
      }
    } catch (err) {
      debugError('SettingsPanel', 'Failed to load settings', err);
      setError('Failed to load settings');
    }
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);

      // Validate API key
      if (!settings.googleAiApiKey || settings.googleAiApiKey.trim() === '') {
        setError('API key is required');
        setIsSaving(false);
        return;
      }

      if (settings.googleAiApiKey.length < 30) {
        setError('Invalid API key format');
        setIsSaving(false);
        return;
      }

      // Save to storage
      await chrome.storage.local.set({
        [STORAGE_KEYS.SETTINGS]: settings,
      });

      debugLog('SettingsPanel', 'Settings saved successfully');
      setSaveSuccess(true);

      // H9 Fix: Store timeout ref for cleanup
      saveTimeoutRef.current = setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 1000);
    } catch (err) {
      debugError('SettingsPanel', 'Failed to save settings', err);
      setError('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (confirm('Reset all settings to defaults? Your API key will be cleared.')) {
      setSettings(DEFAULT_SETTINGS);
      setError(null);
    }
  };

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        {/* Header */}
        <div className="settings-header">
          <h2>Settings</h2>
          <button onClick={onClose} className="close-button" aria-label="Close settings">×</button>
        </div>

        {/* Content */}
        <div className="settings-content">
          {/* API Configuration */}
          <section className="settings-section">
            <h3>API Configuration</h3>

            <div className="setting-item">
              <label htmlFor="apiKey">Google AI API Key *</label>
              <div className="api-key-input-group">
                <input
                  id="apiKey"
                  type={showApiKey ? 'text' : 'password'}
                  value={settings.googleAiApiKey}
                  onChange={(e) => setSettings({ ...settings, googleAiApiKey: e.target.value })}
                  placeholder="Enter your Google AI API key"
                  className="setting-input"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="toggle-visibility-button"
                  title={showApiKey ? 'Hide API key' : 'Show API key'}
                >
                  {showApiKey ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>
              <small className="setting-help">
                Get your API key from{' '}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google AI Studio
                </a>
              </small>
            </div>
          </section>

          {/* Behavior Settings */}
          <section className="settings-section">
            <h3>Behavior</h3>

            <div className="setting-item">
              <label htmlFor="maxActions">Max Actions Per Task</label>
              <input
                id="maxActions"
                type="number"
                min="5"
                max="200"
                value={settings.maxActionsPerTask}
                onChange={(e) => setSettings({ ...settings, maxActionsPerTask: parseInt(e.target.value) })}
                className="setting-input"
              />
              <small className="setting-help">
                Maximum number of actions the agent can perform per task (5-200)
              </small>
            </div>

            <div className="setting-item">
              <label htmlFor="actionDelay">Action Delay (ms)</label>
              <input
                id="actionDelay"
                type="number"
                min="100"
                max="5000"
                step="100"
                value={settings.actionDelayMs}
                onChange={(e) => setSettings({ ...settings, actionDelayMs: parseInt(e.target.value) })}
                className="setting-input"
              />
              <small className="setting-help">
                Delay between actions in milliseconds (100-5000)
              </small>
            </div>

            <div className="setting-item">
              <label htmlFor="screenshotQuality">Screenshot Quality</label>
              <select
                id="screenshotQuality"
                value={settings.screenshotQuality}
                onChange={(e) => setSettings({ ...settings, screenshotQuality: e.target.value as any })}
                className="setting-select"
              >
                <option value="low">Low (faster, smaller)</option>
                <option value="medium">Medium</option>
                <option value="high">High (slower, larger)</option>
                <option value="adaptive">Adaptive (recommended)</option>
              </select>
              <small className="setting-help">
                Screenshot quality affects processing speed and API costs
              </small>
            </div>
          </section>

          {/* UI Preferences */}
          <section className="settings-section">
            <h3>UI Preferences</h3>

            <div className="setting-item-checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={settings.showThinkingProcess}
                  onChange={(e) => setSettings({ ...settings, showThinkingProcess: e.target.checked })}
                />
                <span>Show thinking process</span>
              </label>
              <small className="setting-help">
                Display the agent's reasoning and planning steps
              </small>
            </div>

            <div className="setting-item-checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={settings.showActionHighlights}
                  onChange={(e) => setSettings({ ...settings, showActionHighlights: e.target.checked })}
                />
                <span>Show action highlights</span>
              </label>
              <small className="setting-help">
                Highlight elements before interacting with them
              </small>
            </div>

            <div className="setting-item-checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={settings.debugMode}
                  onChange={(e) => setSettings({ ...settings, debugMode: e.target.checked })}
                />
                <span>Debug mode</span>
              </label>
              <small className="setting-help">
                Enable verbose logging for troubleshooting
              </small>
            </div>
          </section>

          {/* Error Message */}
          {error && (
            <div className="settings-error">
              {error}
            </div>
          )}

          {/* Success Message */}
          {saveSuccess && (
            <div className="settings-success">
              Settings saved successfully!
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="settings-footer">
          <button
            onClick={handleReset}
            className="settings-button settings-button-secondary"
            disabled={isSaving}
          >
            Reset to Defaults
          </button>
          <div className="settings-footer-right">
            <button
              onClick={onClose}
              className="settings-button settings-button-secondary"
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="settings-button settings-button-primary"
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
