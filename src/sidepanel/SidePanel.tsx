import React from 'react';
import { ChatInterface } from '../popup/components/ChatInterface';
import { useAgentController } from '../popup/hooks/useAgentController';

/**
 * Side Panel Component
 * Uses shared useAgentController hook to avoid code duplication
 */
export const SidePanel: React.FC = () => {
  const { session, loading, error, loadStatus, handleStartTask, handleStopTask } = useAgentController(2000);

  if (loading) {
    return (
      <div className="sidepanel-container">
        <div className="loading-screen">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sidepanel-container">
        <div className="error-screen">
          <h3>Connection Error</h3>
          <p>{error}</p>
          <button onClick={loadStatus} className="retry-button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sidepanel-container">
      <ChatInterface
        session={session}
        onStartTask={handleStartTask}
        onStopTask={handleStopTask}
      />
    </div>
  );
};
