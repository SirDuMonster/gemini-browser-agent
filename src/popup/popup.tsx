import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChatInterface } from './components/ChatInterface';
import { useAgentController } from './hooks/useAgentController';
import { debugError } from '../shared/constants';

/**
 * Main Popup Component
 * Uses shared useAgentController hook to avoid code duplication
 */
const Popup: React.FC = () => {
  const { session, loading, error, loadStatus, handleStartTask, handleStopTask } = useAgentController(2000);

  // Loading state
  if (loading) {
    return (
      <div className="popup-container">
        <div className="loading-screen">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="popup-container">
        <div className="error-screen">
          <div className="error-icon">⚠️</div>
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
    <div className="popup-container">
      <ChatInterface
        session={session}
        onStartTask={handleStartTask}
        onStopTask={handleStopTask}
      />
    </div>
  );
};

/**
 * Initialize React app
 */
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
} else {
  debugError('Popup', 'Root element not found', new Error('DOM element #root not found'));
}
