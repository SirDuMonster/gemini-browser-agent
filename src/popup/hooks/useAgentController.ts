import { useState, useEffect, useCallback, useRef } from 'react';
import type { AgentSession, BackgroundMessage } from '../../shared/types';
import { debugError } from '../../shared/constants';

/**
 * Shared hook for controlling agent sessions
 * Used by both popup and sidepanel to avoid code duplication
 *
 * @param pollingInterval - Interval in ms for status polling (default: 500ms)
 * @returns Agent controller state and actions
 */
// SPEED OPTIMIZED: Faster polling for responsive UI
export function useAgentController(pollingInterval: number = 500) {
  const [session, setSession] = useState<AgentSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // H6 Fix: Track in-flight requests to prevent concurrent polling
  const isLoadingRef = useRef(false);

  /**
   * Load current status from service worker
   */
  const loadStatus = useCallback(async () => {
    // H6 Fix: Skip if request already in-flight
    if (isLoadingRef.current) {
      return;
    }
    isLoadingRef.current = true;

    try {
      const message: BackgroundMessage = { type: 'GET_STATUS' };
      const response = await chrome.runtime.sendMessage(message);

      // Check for null response
      if (!response) {
        setError('No response from service worker');
        setLoading(false);
        return;
      }

      if (response.error) {
        setError(response.error);
      } else {
        setSession(response.session);
        setError(null);
      }

      setLoading(false);
    } catch (err) {
      debugError('AgentController', 'Failed to load status', err);
      setError('Failed to connect to service worker');
      setLoading(false);
    } finally {
      // H6 Fix: Always clear in-flight flag
      isLoadingRef.current = false;
    }
  }, []);

  /**
   * Start a new task
   */
  const handleStartTask = useCallback(async (userRequest: string) => {
    try {
      setError(null);

      const message: BackgroundMessage = {
        type: 'START_TASK',
        userRequest,
      };

      const response = await chrome.runtime.sendMessage(message);

      // Check for null response
      if (!response) {
        setError('No response from service worker');
        return;
      }

      if (response.error) {
        setError(response.error);
      } else {
        // Status will be updated via polling
        loadStatus();
      }
    } catch (err) {
      debugError('AgentController', 'Failed to start task', err);
      setError('Failed to start task');
    }
  }, [loadStatus]);

  /**
   * Stop current task
   */
  const handleStopTask = useCallback(async () => {
    // M20 Fix: Clear stale error at start of action
    setError(null);
    try {
      const message: BackgroundMessage = { type: 'STOP_TASK' };
      const response = await chrome.runtime.sendMessage(message);

      // Check for null response
      if (!response) {
        setError('No response from service worker');
        return;
      }

      if (response.error) {
        setError(response.error);
      } else {
        loadStatus();
      }
    } catch (err) {
      debugError('AgentController', 'Failed to stop task', err);
      setError('Failed to stop task');
    }
  }, [loadStatus]);

  // Load initial status on mount
  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Poll for status updates
  useEffect(() => {
    const interval = setInterval(() => {
      loadStatus();
    }, pollingInterval);

    return () => clearInterval(interval);
  }, [loadStatus, pollingInterval]);

  return {
    session,
    loading,
    error,
    loadStatus,
    handleStartTask,
    handleStopTask,
  };
}
