import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { ChatMessage, AgentSession, UIMessage, AgentSettings } from '../../shared/types';
import { SettingsPanel } from './SettingsPanel';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../../shared/constants';

/**
 * Parse markdown-like formatting to React elements
 * Supports: **bold**, *italic*, `code`, ~~strikethrough~~, [links](url), headers, lists
 */
function formatMessage(text: string): React.ReactNode {
  if (!text) return null;

  // Split by newlines first to handle block elements
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];

  let inCodeBlock = false;
  let codeBlockContent: string[] = [];

  lines.forEach((line, lineIndex) => {
    // Handle code blocks (```)
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        elements.push(
          <pre key={`code-${lineIndex}`} className="code-block">
            <code>{codeBlockContent.join('\n')}</code>
          </pre>
        );
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        // Start code block
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      return;
    }

    // Handle headers
    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const content = formatInlineText(headerMatch[2]);
      const Tag = `h${level + 2}` as keyof JSX.IntrinsicElements; // h3, h4, h5
      elements.push(<Tag key={`h-${lineIndex}`} className="message-header">{content}</Tag>);
      return;
    }

    // Handle unordered lists
    const listMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (listMatch) {
      const indent = listMatch[1].length;
      const content = formatInlineText(listMatch[2]);
      elements.push(
        <div key={`li-${lineIndex}`} className="list-item" style={{ marginLeft: indent * 8 }}>
          <span className="list-bullet">•</span> {content}
        </div>
      );
      return;
    }

    // Handle numbered lists
    const numListMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (numListMatch) {
      const indent = numListMatch[1].length;
      const num = numListMatch[2];
      const content = formatInlineText(numListMatch[3]);
      elements.push(
        <div key={`oli-${lineIndex}`} className="list-item" style={{ marginLeft: indent * 8 }}>
          <span className="list-number">{num}.</span> {content}
        </div>
      );
      return;
    }

    // Handle blockquotes
    if (line.startsWith('>')) {
      const content = formatInlineText(line.slice(1).trim());
      elements.push(
        <blockquote key={`bq-${lineIndex}`} className="blockquote">{content}</blockquote>
      );
      return;
    }

    // Handle horizontal rules
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={`hr-${lineIndex}`} className="horizontal-rule" />);
      return;
    }

    // Regular paragraph with inline formatting
    if (line.trim()) {
      elements.push(
        <p key={`p-${lineIndex}`} className="message-paragraph">{formatInlineText(line)}</p>
      );
    } else if (lineIndex > 0 && lineIndex < lines.length - 1) {
      // Empty line creates spacing
      elements.push(<div key={`sp-${lineIndex}`} className="paragraph-spacing" />);
    }
  });

  // Close any unclosed code block
  if (inCodeBlock && codeBlockContent.length > 0) {
    elements.push(
      <pre key="code-end" className="code-block">
        <code>{codeBlockContent.join('\n')}</code>
      </pre>
    );
  }

  return <>{elements}</>;
}

/**
 * Format inline text (bold, italic, code, links, etc.)
 */
function formatInlineText(text: string): React.ReactNode {
  if (!text) return null;

  // Regex patterns for inline formatting
  const patterns = [
    { regex: /\*\*(.+?)\*\*/g, wrapper: (content: string, key: string) => <strong key={key}>{content}</strong> },
    { regex: /__(.+?)__/g, wrapper: (content: string, key: string) => <strong key={key}>{content}</strong> },
    { regex: /\*(.+?)\*/g, wrapper: (content: string, key: string) => <em key={key}>{content}</em> },
    { regex: /_(.+?)_/g, wrapper: (content: string, key: string) => <em key={key}>{content}</em> },
    { regex: /~~(.+?)~~/g, wrapper: (content: string, key: string) => <del key={key}>{content}</del> },
    { regex: /`([^`]+)`/g, wrapper: (content: string, key: string) => <code key={key} className="inline-code">{content}</code> },
    { regex: /\[([^\]]+)\]\(([^)]+)\)/g, wrapper: (content: string, key: string, url?: string) => (
      <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="message-link">{content}</a>
    )},
  ];

  // Process text with all patterns
  let elements: React.ReactNode[] = [text];
  let keyCounter = 0;

  patterns.forEach(({ regex, wrapper }) => {
    const newElements: React.ReactNode[] = [];

    elements.forEach((element) => {
      if (typeof element !== 'string') {
        newElements.push(element);
        return;
      }

      let lastIndex = 0;
      let match;
      const str = element;
      regex.lastIndex = 0;

      while ((match = regex.exec(str)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
          newElements.push(str.slice(lastIndex, match.index));
        }

        // Add formatted element
        const content = match[1];
        const url = match[2]; // For links
        newElements.push(wrapper(content, `fmt-${keyCounter++}`, url));

        lastIndex = match.index + match[0].length;
      }

      // Add remaining text
      if (lastIndex < str.length) {
        newElements.push(str.slice(lastIndex));
      }
    });

    elements = newElements;
  });

  return <>{elements}</>;
}

interface ChatInterfaceProps {
  session: AgentSession | null;
  onStartTask: (request: string) => void;
  onStopTask: () => void;
}

// Simple suggestion prompts
const SUGGESTIONS = [
  'Search Google for...',
  'Click on the login button',
  'Fill out this form',
  'Go to youtube.com',
];

/**
 * ChatInterface - Gemini 2.0 Pro Style UI
 */
export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  session,
  onStartTask,
  onStopTask,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [currentStep, setCurrentStep] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // C3 Fix: Use useCallback for message handlers to prevent memory leaks
  // M17 Fix: Use counter for unique IDs instead of Date.now + random
  const messageIdRef = useRef(0);

  const addSystemMessage = useCallback((content: string) => {
    const id = `msg_${++messageIdRef.current}`;
    setMessages(prev => [...prev, {
      id,
      role: 'system',
      content,
      timestamp: new Date(),
    }]);
  }, []);

  const addAssistantMessage = useCallback((content: string) => {
    const id = `msg_${++messageIdRef.current}`;
    setMessages(prev => [...prev, {
      id,
      role: 'assistant',
      content,
      timestamp: new Date(),
    }]);
  }, []);

  // H14 Fix: Load settings only on mount, not on every toggle
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
        if (result[STORAGE_KEYS.SETTINGS]) {
          setSettings(result[STORAGE_KEYS.SETTINGS]);
        }
      } catch (err) {
        console.error('Failed to load settings', err);
      }
    };
    loadSettings();
  }, []); // Only load on mount

  // Reload settings when settings panel closes (user may have changed them)
  useEffect(() => {
    if (!showSettings) {
      // Panel just closed, reload settings
      const reloadSettings = async () => {
        try {
          const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
          if (result[STORAGE_KEYS.SETTINGS]) {
            setSettings(result[STORAGE_KEYS.SETTINGS]);
          }
        } catch (err) {
          console.error('Failed to reload settings', err);
        }
      };
      reloadSettings();
    }
  }, [showSettings]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // C3 Fix: Use useCallback to prevent listener recreation on every render
  const showThinkingRef = useRef(settings.showThinkingProcess);
  showThinkingRef.current = settings.showThinkingProcess;

  useEffect(() => {
    const messageListener = (message: UIMessage) => {
      switch (message.type) {
        case 'PROGRESS_UPDATE':
          // Only show thinking process if enabled in settings
          if (showThinkingRef.current) {
            setCurrentStep(message.description);
            addSystemMessage(`Step ${message.step}: ${message.description}`);
          }
          break;
        case 'TASK_COMPLETE':
          addAssistantMessage(message.summary);
          setCurrentStep('');
          break;
        case 'TASK_ERROR':
          addSystemMessage(`Error: ${message.error}`);
          setCurrentStep('');
          break;
        case 'CLARIFICATION_NEEDED':
          addAssistantMessage(`I need clarification: ${message.question}`);
          setCurrentStep('');
          break;
        case 'MILESTONE_COMPLETED':
          addSystemMessage(`✓ ${message.description}`);
          break;
        case 'ACTION_EXECUTED':
          break;
        case 'AGENT_MESSAGE':
          addAssistantMessage(message.text);
          break;
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => chrome.runtime.onMessage.removeListener(messageListener);
  }, [addSystemMessage, addAssistantMessage]); // Stable dependencies now

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    setMessages(prev => [...prev, {
      id: `msg_${Date.now()}_${Math.random()}`,
      role: 'user',
      content: inputValue,
      timestamp: new Date(),
    }]);

    onStartTask(inputValue);
    setInputValue('');
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInputValue(suggestion);
    inputRef.current?.focus();
  };

  const handleStop = () => {
    onStopTask();
    addSystemMessage('Task stopped by user');
  };

  const isRunning = session !== null && ['planning', 'executing', 'verifying'].includes(session.status);

  return (
    <div className="chat-interface">
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {/* Header */}
      <div className="chat-header">
        <div className="header-title">Gemini</div>
        <div className="header-actions">
          {session && (
            <div className={`status-badge status-${session.status}`}>
              {session.status}
            </div>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="settings-icon-button"
            title="Settings"
          >
            ⚙
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="welcome-message">
            <div className="welcome-header">
              <div className="welcome-icon">✦</div>
              <h3>Hello!</h3>
              <p>How can I help you today?</p>
            </div>
            <div className="welcome-suggestions">
              {SUGGESTIONS.map((suggestion, index) => (
                <button
                  key={index}
                  className="suggestion-chip"
                  onClick={() => handleSuggestionClick(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(message => (
            <div key={message.id} className={`message message-${message.role}`}>
              <div className="message-content">
                <div className="message-text">{formatMessage(message.content)}</div>
              </div>
            </div>
          ))
        )}

        {/* Typing indicator */}
        {isRunning && currentStep && (
          <div className="message message-system">
            <div className="message-content">
              <div className="message-text typing">
                {currentStep}
                <span className="typing-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-input-container">
        {isRunning && (
          <button
            type="button"
            className="stop-button"
            onClick={handleStop}
            aria-label="Stop current task"
          >
            Stop Task
          </button>
        )}

        <form onSubmit={handleSubmit} className="chat-form" aria-label="Chat input form">
          <input
            ref={inputRef}
            type="text"
            className="chat-input"
            placeholder={isRunning ? "Task is running..." : "Ask me anything..."}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isRunning}
            aria-label="Message input"
          />
          <button
            type="submit"
            className="send-button"
            disabled={!inputValue.trim() || isRunning}
            aria-label="Send message"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
};
