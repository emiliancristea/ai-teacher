import { useState, useEffect } from "react";
import { useChat } from "../hooks/useChat";
import { useScreenCapture } from "../hooks/useScreenCapture";
import { initializeGemini } from "../services/gemini";
import { startMonitoring, stopMonitoring } from "../services/screenCapture";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { Settings } from "./Settings";
import { invoke } from "@tauri-apps/api/core";
import type { Settings as SettingsType, Conversation, PendingCommandRequest } from "../types";

// Default API key - user must provide their own
const DEFAULT_API_KEY = "";

export function ChatInterface() {
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<SettingsType>({
    geminiApiKey: DEFAULT_API_KEY,
    captureInterval: 3,
    theme: "dark",
    screenCaptureEnabled: false, // Default to disabled to focus on chat first
  });
  const [apiKeySet, setApiKeySet] = useState(false);


  const { screenshotHistory, updateInterval } = useScreenCapture(settings.screenCaptureEnabled);
  const {
    messages,
    isLoading,
    streamingContent,
    statusMessage,
    sendMessage,
    createNewConversation,
    updateMessage,
    clearChat,
    loadCurrentConversation,
    pendingCommands,
    approveCommandRequest,
    denyCommandRequest,
  } = useChat(screenshotHistory);

  // Load settings and initialize
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const stored = localStorage.getItem("ai-teacher-settings");
        if (stored) {
          const parsed = JSON.parse(stored);
          // Ensure screenCaptureEnabled exists (for backward compatibility)
          if (parsed.screenCaptureEnabled === undefined) {
            parsed.screenCaptureEnabled = false;
          }
          setSettings(parsed);
          if (parsed.geminiApiKey) {
            initializeGemini(parsed.geminiApiKey);
            setApiKeySet(true);
            if (parsed.screenCaptureEnabled) {
              await startMonitoring();
            }
          }
        } else if (DEFAULT_API_KEY) {
          // Use default API key if no stored settings
          const defaultSettings: SettingsType = {
            geminiApiKey: DEFAULT_API_KEY,
            captureInterval: 3,
            theme: "dark",
            screenCaptureEnabled: false,
          };
          setSettings(defaultSettings);
          localStorage.setItem("ai-teacher-settings", JSON.stringify(defaultSettings));
          initializeGemini(DEFAULT_API_KEY);
          setApiKeySet(true);
          // Don't start monitoring by default - user can enable it in settings
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
      }
    };
    loadSettings();
  }, []);

  const handleClose = async () => {
    try {
      await invoke("close_window");
    } catch (error) {
      console.error("Failed to close window:", error);
    }
  };

  const handleMinimize = async () => {
    try {
      await invoke("minimize_window");
    } catch (error) {
      console.error("Failed to minimize window:", error);
    }
  };

  const handleSaveSettings = async (newSettings: SettingsType) => {
    setSettings(newSettings);
    localStorage.setItem("ai-teacher-settings", JSON.stringify(newSettings));
    if (newSettings.geminiApiKey) {
      initializeGemini(newSettings.geminiApiKey);
      setApiKeySet(true);
      // Start or stop monitoring based on setting
      if (newSettings.screenCaptureEnabled) {
        await startMonitoring();
      } else {
        await stopMonitoring();
      }
    }
    if (newSettings.captureInterval !== settings.captureInterval) {
      await updateInterval(newSettings.captureInterval);
    }
    setShowSettings(false);
  };

  const handleConversationSwitch = async (_conversation: Conversation) => {
    // Settings will handle setting the conversation ID
    // We just need to reload the conversation state
    await loadCurrentConversation();
  };

  if (!apiKeySet) {
    return (
      <div className="app-container">
        <div className="welcome-screen">
          <div className="welcome-icon">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M32 8L8 20L32 32L56 20L32 8Z" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M8 44L32 56L56 44" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M8 32L32 44L56 32" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1>AI Teacher</h1>
          <p>Welcome! Please configure your Gemini API key to get started.</p>
          <button onClick={() => setShowSettings(true)} className="welcome-button">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 11.25C10.2426 11.25 11.25 10.2426 11.25 9C11.25 7.75736 10.2426 6.75 9 6.75C7.75736 6.75 6.75 7.75736 6.75 9C6.75 10.2426 7.75736 11.25 9 11.25Z" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M14.625 9C14.625 9.15562 14.6175 9.31125 14.6025 9.465C14.58 9.705 14.625 9.9525 14.625 10.1925C14.625 10.4325 14.58 10.68 14.6025 10.92C14.6175 11.0737 14.625 11.2294 14.625 11.385C14.625 11.5425 14.6175 11.7 14.6025 11.8575C14.58 12.0975 14.625 12.345 14.625 12.585C14.625 12.825 14.58 13.0725 14.6025 13.3125C14.6175 13.47 14.625 13.6275 14.625 13.785C14.625 14.25 14.25 14.625 13.785 14.625C13.6275 14.625 13.47 14.6175 13.3125 14.6025C13.0725 14.58 12.825 14.625 12.585 14.625C12.345 14.625 12.0975 14.58 11.8575 14.6025C11.7 14.6175 11.5425 14.625 11.385 14.625C11.2294 14.625 11.0737 14.6175 10.92 14.6025C10.68 14.58 10.4325 14.625 10.1925 14.625C9.9525 14.625 9.705 14.58 9.465 14.6025C9.31125 14.6175 9.15562 14.625 9 14.625C8.84438 14.625 8.68875 14.6175 8.535 14.6025C8.295 14.58 8.0475 14.625 7.8075 14.625C7.5675 14.625 7.32 14.58 7.08 14.6025C6.9225 14.6175 6.765 14.625 6.6075 14.625C6.1425 14.625 5.7675 14.25 5.7675 13.785C5.7675 13.6275 5.775 13.47 5.79 13.3125C5.8125 13.0725 5.7675 12.825 5.7675 12.585C5.7675 12.345 5.8125 12.0975 5.79 11.8575C5.775 11.7 5.7675 11.5425 5.7675 11.385C5.7675 11.2294 5.775 11.0737 5.79 10.92C5.8125 10.68 5.7675 10.4325 5.7675 10.1925C5.7675 9.9525 5.8125 9.705 5.79 9.465C5.775 9.31125 5.7675 9.15562 5.7675 9C5.7675 8.84438 5.775 8.68875 5.79 8.535C5.8125 8.295 5.7675 8.0475 5.7675 7.8075C5.7675 7.5675 5.8125 7.32 5.79 7.08C5.775 6.9225 5.7675 6.765 5.7675 6.6075C5.7675 6.1425 6.1425 5.7675 6.6075 5.7675C6.765 5.7675 6.9225 5.775 7.08 5.79C7.32 5.8125 7.5675 5.7675 7.8075 5.7675C8.0475 5.7675 8.295 5.8125 8.535 5.79C8.68875 5.775 8.84438 5.7675 9 5.7675C9.15562 5.7675 9.31125 5.775 9.465 5.79C9.705 5.8125 9.9525 5.7675 10.1925 5.7675C10.4325 5.7675 10.68 5.8125 10.92 5.79C11.0737 5.775 11.2294 5.7675 11.385 5.7675C11.5425 5.7675 11.7 5.775 11.8575 5.79C12.0975 5.8125 12.345 5.7675 12.585 5.7675C12.825 5.7675 13.0725 5.8125 13.3125 5.79C13.47 5.775 13.6275 5.7675 13.785 5.7675C14.25 5.7675 14.625 6.1425 14.625 6.6075C14.625 6.765 14.6175 6.9225 14.6025 7.08C14.58 7.32 14.625 7.5675 14.625 7.8075C14.625 8.0475 14.58 8.295 14.6025 8.535C14.6175 8.68875 14.625 8.84438 14.625 9Z" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
            Open Settings
          </button>
          {showSettings && (
            <Settings
              settings={settings}
              onSave={handleSaveSettings}
              onClose={() => setShowSettings(false)}
              onConversationSwitch={handleConversationSwitch}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`app-container theme-${settings.theme}`}>
      <div className="header-wrapper">
        <div className="header-left-buttons">
          <button
            onClick={() => {}}
            className="header-history-button"
            title="History"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 3C5.68629 3 3 5.68629 3 9C3 12.3137 5.68629 15 9 15C12.3137 15 15 12.3137 15 9C15 5.68629 12.3137 3 9 3ZM9 13.5C6.51472 13.5 4.5 11.4853 4.5 9C4.5 6.51472 6.51472 4.5 9 4.5C11.4853 4.5 13.5 6.51472 13.5 9C13.5 11.4853 11.4853 13.5 9 13.5Z" fill="currentColor"/>
              <path d="M9 5.25V9L11.25 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button onClick={createNewConversation} className="header-new-chat-button" title="New Chat">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 3V15M3 9H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
          <button
            onClick={clearChat}
            className="header-clear-button"
            title="Clear Chat"
            disabled={messages.length === 0 || isLoading}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 4.5H15M6.75 4.5V3C6.75 2.58579 7.08579 2.25 7.5 2.25H10.5C10.9142 2.25 11.25 2.58579 11.25 3V4.5M4.5 4.5V15C4.5 15.4142 4.83579 15.75 5.25 15.75H12.75C13.1642 15.75 13.5 15.4142 13.5 15V4.5M7.5 8.25V12.75M10.5 8.25V12.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        
        <div className="chat-header" data-tauri-drag-region>
          <div className="chat-header-content">
            <div className="chat-header-title">
              <h1>AI Teacher</h1>
            </div>
            <p className="chat-header-subtitle">Your intelligent learning companion</p>
          </div>
        </div>

        <div className="header-right-buttons">
          <button
            onClick={() => setShowSettings(true)}
            className="header-settings-button"
            title="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M19.4 15C19.2669 15.3016 19.2272 15.6362 19.286 15.9606C19.3448 16.285 19.4995 16.5843 19.73 16.82L19.79 16.88C19.976 17.0657 20.1235 17.2863 20.2241 17.5291C20.3248 17.7719 20.3766 18.0322 20.3766 18.295C20.3766 18.5578 20.3248 18.8181 20.2241 19.0609C20.1235 19.3037 19.976 19.5243 19.79 19.71C19.6043 19.896 19.3837 20.0435 19.1409 20.1441C18.8981 20.2448 18.6378 20.2966 18.375 20.2966C18.1122 20.2966 17.8519 20.2448 17.6091 20.1441C17.3663 20.0435 17.1457 19.896 16.96 19.71L16.9 19.65C16.6643 19.4195 16.365 19.2648 16.0406 19.206C15.7162 19.1472 15.3816 19.1869 15.08 19.32C14.7842 19.4468 14.532 19.6572 14.3543 19.9255C14.1766 20.1938 14.0813 20.5082 14.08 20.83V21C14.08 21.5304 13.8693 22.0391 13.4942 22.4142C13.1191 22.7893 12.6104 23 12.08 23C11.5496 23 11.0409 22.7893 10.6658 22.4142C10.2907 22.0391 10.08 21.5304 10.08 21V20.91C10.0723 20.579 9.96512 20.258 9.77251 19.9887C9.5799 19.7194 9.31074 19.5143 9 19.4C8.69838 19.2669 8.36381 19.2272 8.03941 19.286C7.71502 19.3448 7.41568 19.4995 7.18 19.73L7.12 19.79C6.93425 19.976 6.71368 20.1235 6.47088 20.2241C6.22808 20.3248 5.96783 20.3766 5.705 20.3766C5.44217 20.3766 5.18192 20.3248 4.93912 20.2241C4.69632 20.1235 4.47575 19.976 4.29 19.79C4.10405 19.6043 3.95653 19.3837 3.85588 19.1409C3.75523 18.8981 3.70343 18.6378 3.70343 18.375C3.70343 18.1122 3.75523 17.8519 3.85588 17.6091C3.95653 17.3663 4.10405 17.1457 4.29 16.96L4.35 16.9C4.58054 16.6643 4.73519 16.365 4.794 16.0406C4.85282 15.7162 4.81312 15.3816 4.68 15.08C4.55324 14.7842 4.34276 14.532 4.07447 14.3543C3.80618 14.1766 3.49179 14.0813 3.17 14.08H3C2.46957 14.08 1.96086 13.8693 1.58579 13.4942C1.21071 13.1191 1 12.6104 1 12.08C1 11.5496 1.21071 11.0409 1.58579 10.6658C1.96086 10.2907 2.46957 10.08 3 10.08H3.09C3.42099 10.0723 3.742 9.96512 4.01131 9.77251C4.28062 9.5799 4.48568 9.31074 4.6 9C4.73312 8.69838 4.77282 8.36381 4.714 8.03941C4.65519 7.71502 4.50054 7.41568 4.27 7.18L4.21 7.12C4.02405 6.93425 3.87653 6.71368 3.77588 6.47088C3.67523 6.22808 3.62343 5.96783 3.62343 5.705C3.62343 5.44217 3.67523 5.18192 3.77588 4.93912C3.87653 4.69632 4.02405 4.47575 4.21 4.29C4.39575 4.10405 4.61632 3.95653 4.85912 3.85588C5.10192 3.75523 5.36217 3.70343 5.625 3.70343C5.88783 3.70343 6.14808 3.75523 6.39088 3.85588C6.63368 3.95653 6.85425 4.10405 7.04 4.29L7.1 4.35C7.33568 4.58054 7.63502 4.73519 7.95941 4.794C8.28381 4.85282 8.61838 4.81312 8.92 4.68H9C9.29577 4.55324 9.54802 4.34276 9.72569 4.07447C9.90337 3.80618 9.99872 3.49179 10 3.17V3C10 2.46957 10.2107 1.96086 10.5858 1.58579C10.9609 1.21071 11.4696 1 12 1C12.5304 1 13.0391 1.21071 13.4142 1.58579C13.7893 1.96086 14 2.46957 14 3V3.09C14.0013 3.41179 14.0966 3.72618 14.2743 3.99447C14.452 4.26276 14.7042 4.47324 15 4.6C15.3016 4.73312 15.6362 4.77282 15.9606 4.714C16.285 4.65519 16.5843 4.50054 16.82 4.27L16.88 4.21C17.0657 4.02405 17.2863 3.87653 17.5291 3.77588C17.7719 3.67523 18.0322 3.62343 18.295 3.62343C18.5578 3.62343 18.8181 3.67523 19.0609 3.77588C19.3037 3.87653 19.5243 4.02405 19.71 4.21C19.896 4.39575 20.0435 4.61632 20.1441 4.85912C20.2448 5.10192 20.2966 5.36217 20.2966 5.625C20.2966 5.88783 20.2448 6.14808 20.1441 6.39088C20.0435 6.63368 19.896 6.85425 19.71 7.04L19.65 7.1C19.4195 7.33568 19.2648 7.63502 19.206 7.95941C19.1472 8.28381 19.1869 8.61838 19.32 8.92V9C19.4468 9.29577 19.6572 9.54802 19.9255 9.72569C20.1938 9.90337 20.5082 9.99872 20.83 10H21C21.5304 10 22.0391 10.2107 22.4142 10.5858C22.7893 10.9609 23 11.4696 23 12C23 12.5304 22.7893 13.0391 22.4142 13.4142C22.0391 13.7893 21.5304 14 21 14H20.91C20.5882 14.0013 20.2738 14.0966 20.0055 14.2743C19.7372 14.452 19.5268 14.7042 19.4 15Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            onClick={handleMinimize}
            className="header-minimize-button"
            title="Minimize"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 9H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
          <button
            onClick={handleClose}
            className="header-close-button"
            title="Close"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="chat-content">
        {pendingCommands.length > 0 && (
          <div className="command-request-container">
            {pendingCommands.map((request: PendingCommandRequest) => {
              const commandLine = [request.command, ...(request.args || [])].filter(Boolean).join(" ");
              const stdoutPreview = request.result?.stdout
                ? `${request.result.stdout.slice(0, 200)}${request.result.stdout.length > 200 ? "…" : ""}`
                : "";
              const stderrPreview = request.result?.stderr
                ? `${request.result.stderr.slice(0, 200)}${request.result.stderr.length > 200 ? "…" : ""}`
                : "";
              
              return (
                <div key={request.id} className={`command-request-card status-${request.status}`}>
                  <div className="command-request-header">
                    <span className="command-label">Command</span>
                    <code className="command-inline">{commandLine || "unknown command"}</code>
                  </div>
                  <div className="command-request-body">
                    <p className="command-policy-reason">{request.policy.reason}</p>
                    {request.status === "pending" && (
                      <p className="command-policy-note">
                        Approval required before the agent can continue. No changes have been made yet.
                      </p>
                    )}
                    {request.status === "blocked" && (
                      <p className="command-policy-warning">
                        This command is blocked by safety rules. The agent will guide you through a manual alternative.
                      </p>
                    )}
                    {request.status === "executing" && (
                      <p className="command-policy-note">Running command…</p>
                    )}
                    {request.status === "executed" && (
                      <div className="command-output-preview">
                        <p className="command-policy-note">
                          Command finished. Output shared with the agent for follow-up.
                        </p>
                        <div className="output-section">
                          <span className="output-label">stdout</span>
                          <pre>{stdoutPreview || "(no output)"}</pre>
                        </div>
                        <div className="output-section">
                          <span className="output-label">stderr</span>
                          <pre>{stderrPreview || "(no output)"}</pre>
                        </div>
                      </div>
                    )}
                    {request.status === "denied" && (
                      <p className="command-policy-note">
                        Command denied. The agent will provide manual steps instead.
                      </p>
                    )}
                    {request.error && request.status !== "pending" && request.status !== "executing" && (
                      <p className="command-error-message">{request.error}</p>
                    )}
                  </div>
                  {request.status === "pending" && (
                    <div className="command-request-actions">
                      <button
                        className="command-approve-button"
                        disabled={isLoading}
                        onClick={() => approveCommandRequest(request.id)}
                      >
                        Allow
                      </button>
                      <button
                        className="command-deny-button"
                        disabled={isLoading}
                        onClick={() => denyCommandRequest(request.id)}
                      >
                        Deny
                      </button>
                    </div>
                  )}
                  {request.status === "blocked" && (
                    <div className="command-request-actions">
                      <button
                        className="command-deny-button"
                        onClick={() => denyCommandRequest(request.id)}
                        disabled={isLoading}
                      >
                        Acknowledge
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <MessageList 
          messages={messages} 
          streamingContent={streamingContent}
          isLoading={isLoading}
          statusMessage={statusMessage}
          onEditMessage={(_messageId, newContent, messageIndex) => {
            sendMessage(newContent, messageIndex);
          }}
          onUpdateMessage={updateMessage}
          onRegenerate={(messageIndex) => {
            // Find the assistant message and the user message before it
            const assistantMessage = messages[messageIndex];
            if (assistantMessage && assistantMessage.role === "assistant" && messageIndex > 0) {
              const userMessage = messages[messageIndex - 1];
              if (userMessage && userMessage.role === "user") {
                // Delete the assistant message and regenerate from the user message
                // The sendMessage function will truncate messages from messageIndex - 1
                sendMessage(userMessage.content, messageIndex - 1);
              }
            }
          }}
        />
        <MessageInput onSend={sendMessage} disabled={isLoading} />
      </div>

      {showSettings && (
        <Settings
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
          onConversationSwitch={handleConversationSwitch}
        />
      )}
    </div>
  );
}

