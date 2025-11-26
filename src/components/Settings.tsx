import { useState, useEffect, useRef } from "react";
import {
  getConversations,
  deleteConversation,
  exportConversation,
  getConversation,
  setCurrentConversationId,
} from "../services/storage";
import type { Settings, Conversation } from "../types";

interface SettingsProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onClose: () => void;
  onConversationSwitch?: (conversation: Conversation) => void;
}

export function Settings({ settings, onSave, onClose, onConversationSwitch }: SettingsProps) {
  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showConversations, setShowConversations] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showAnthropicApiKey, setShowAnthropicApiKey] = useState(false);
  const [showOpenaiApiKey, setShowOpenaiApiKey] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<"gemini" | "anthropic" | "openai">("gemini");
  const [voiceDropdownOpen, setVoiceDropdownOpen] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideAnthropicTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideOpenaiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceDropdownRef = useRef<HTMLDivElement>(null);

  const scheduleHideApiKey = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    hideTimeoutRef.current = setTimeout(() => {
      setShowApiKey(false);
    }, 2000); // 2 second delay
  };

  const cancelHideApiKey = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };

  const scheduleHideAnthropicApiKey = () => {
    if (hideAnthropicTimeoutRef.current) {
      clearTimeout(hideAnthropicTimeoutRef.current);
    }
    hideAnthropicTimeoutRef.current = setTimeout(() => {
      setShowAnthropicApiKey(false);
    }, 2000);
  };

  const cancelHideAnthropicApiKey = () => {
    if (hideAnthropicTimeoutRef.current) {
      clearTimeout(hideAnthropicTimeoutRef.current);
      hideAnthropicTimeoutRef.current = null;
    }
  };

  const scheduleHideOpenaiApiKey = () => {
    if (hideOpenaiTimeoutRef.current) {
      clearTimeout(hideOpenaiTimeoutRef.current);
    }
    hideOpenaiTimeoutRef.current = setTimeout(() => {
      setShowOpenaiApiKey(false);
    }, 2000);
  };

  const cancelHideOpenaiApiKey = () => {
    if (hideOpenaiTimeoutRef.current) {
      clearTimeout(hideOpenaiTimeoutRef.current);
      hideOpenaiTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      if (hideAnthropicTimeoutRef.current) {
        clearTimeout(hideAnthropicTimeoutRef.current);
      }
      if (hideOpenaiTimeoutRef.current) {
        clearTimeout(hideOpenaiTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (voiceDropdownRef.current && !voiceDropdownRef.current.contains(event.target as Node)) {
        setVoiceDropdownOpen(false);
      }
    };

    if (voiceDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [voiceDropdownOpen]);

  const handleToggleApiKey = () => {
    setShowApiKey(!showApiKey);
    cancelHideApiKey();
    if (!showApiKey) {
      scheduleHideApiKey();
    }
  };

  const handleToggleAnthropicApiKey = () => {
    setShowAnthropicApiKey(!showAnthropicApiKey);
    cancelHideAnthropicApiKey();
    if (!showAnthropicApiKey) {
      scheduleHideAnthropicApiKey();
    }
  };

  const handleToggleOpenaiApiKey = () => {
    setShowOpenaiApiKey(!showOpenaiApiKey);
    cancelHideOpenaiApiKey();
    if (!showOpenaiApiKey) {
      scheduleHideOpenaiApiKey();
    }
  };

  const loadConversations = async () => {
    const convs = await getConversations();
    setConversations(convs);
    setShowConversations(true);
  };

  const handleDeleteConversation = async (id: string) => {
    if (confirm("Are you sure you want to delete this conversation?")) {
      await deleteConversation(id);
      await loadConversations();
    }
  };

  const handleExportConversation = async (id: string) => {
    try {
      const json = await exportConversation(id);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `conversation-${id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert("Failed to export conversation");
    }
  };

  const handleSwitchConversation = async (id: string) => {
    try {
      const conversation = await getConversation(id);
      if (conversation) {
        await setCurrentConversationId(id);
        if (onConversationSwitch) {
          onConversationSwitch(conversation);
        }
        onClose(); // Close settings after switching
      }
    } catch (error) {
      alert("Failed to switch conversation");
    }
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <div className="settings-header-content">
            <h2>Settings</h2>
            <div className="settings-header-spacer"></div>
            <p className="settings-subtitle">Configure your AI Teacher preferences</p>
          </div>
          <button onClick={onClose} className="close-button" aria-label="Close settings">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        <div className="settings-content">
          <div className="settings-group">
            <div className="settings-section">
              <label className="settings-label">
                <div className="label-header-with-title">
                  <span className="settings-group-title-inline">API Configuration</span>
                  <div className="label-header-spacer"></div>
                  <span 
                    className={`provider-option ${selectedProvider === "gemini" ? "active" : ""}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSelectedProvider("gemini");
                      setShowAnthropicApiKey(false);
                      setShowOpenaiApiKey(false);
                      cancelHideAnthropicApiKey();
                      cancelHideOpenaiApiKey();
                    }}
                  >
                    Gemini
                  </span>
                  <div className="label-header-spacer"></div>
                  <span 
                    className={`provider-option ${selectedProvider === "anthropic" ? "active" : ""}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSelectedProvider("anthropic");
                      setShowApiKey(false);
                      setShowOpenaiApiKey(false);
                      cancelHideApiKey();
                      cancelHideOpenaiApiKey();
                    }}
                  >
                    Anthropic
                  </span>
                  <div className="label-header-spacer"></div>
                  <span 
                    className={`provider-option ${selectedProvider === "openai" ? "active" : ""}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSelectedProvider("openai");
                      setShowApiKey(false);
                      setShowAnthropicApiKey(false);
                      cancelHideApiKey();
                      cancelHideAnthropicApiKey();
                    }}
                  >
                    Open AI
                  </span>
                </div>
                {selectedProvider === "gemini" && (
                  <div 
                    className="password-input-container"
                    onMouseLeave={scheduleHideApiKey}
                    onMouseEnter={cancelHideApiKey}
                  >
                    <input
                      type={showApiKey ? "text" : "password"}
                      className="settings-input"
                      value={localSettings.geminiApiKey || ""}
                      onChange={(e) =>
                        setLocalSettings({ ...localSettings, geminiApiKey: e.target.value })
                      }
                      onBlur={scheduleHideApiKey}
                      onFocus={cancelHideApiKey}
                      placeholder="Enter your Gemini API key"
                    />
                    <button
                      type="button"
                      className="password-toggle-button"
                      onClick={handleToggleApiKey}
                      aria-label={showApiKey ? "Hide API key" : "Show API key"}
                    >
                      {showApiKey ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </button>
                  </div>
                )}
                {selectedProvider === "anthropic" && (
                  <div 
                    className="password-input-container"
                    onMouseLeave={scheduleHideAnthropicApiKey}
                    onMouseEnter={cancelHideAnthropicApiKey}
                  >
                    <input
                      type={showAnthropicApiKey ? "text" : "password"}
                      className="settings-input"
                      value={localSettings.anthropicApiKey || ""}
                      onChange={(e) =>
                        setLocalSettings({ ...localSettings, anthropicApiKey: e.target.value })
                      }
                      onBlur={scheduleHideAnthropicApiKey}
                      onFocus={cancelHideAnthropicApiKey}
                      placeholder="Enter your Anthropic API key"
                    />
                    <button
                      type="button"
                      className="password-toggle-button"
                      onClick={handleToggleAnthropicApiKey}
                      aria-label={showAnthropicApiKey ? "Hide API key" : "Show API key"}
                    >
                      {showAnthropicApiKey ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </button>
                  </div>
                )}
                {selectedProvider === "openai" && (
                  <div 
                    className="password-input-container"
                    onMouseLeave={scheduleHideOpenaiApiKey}
                    onMouseEnter={cancelHideOpenaiApiKey}
                  >
                    <input
                      type={showOpenaiApiKey ? "text" : "password"}
                      className="settings-input"
                      value={localSettings.openaiApiKey || ""}
                      onChange={(e) =>
                        setLocalSettings({ ...localSettings, openaiApiKey: e.target.value })
                      }
                      onBlur={scheduleHideOpenaiApiKey}
                      onFocus={cancelHideOpenaiApiKey}
                      placeholder="Enter your OpenAI API key"
                    />
                    <button
                      type="button"
                      className="password-toggle-button"
                      onClick={handleToggleOpenaiApiKey}
                      aria-label={showOpenaiApiKey ? "Hide API key" : "Show API key"}
                    >
                      {showOpenaiApiKey ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </button>
                  </div>
                )}
              </label>
            </div>
          </div>

          <div className="settings-group">
            <div className="settings-section">
              <label className="settings-label">
                <div className="label-header">
                  <div className="label-header-left">
                    <span className="label-text">Screen Capture</span>
                    <div className="label-header-spacer"></div>
                    <span className="label-description">Capture screen for context-aware guidance</span>
                  </div>
                  <div className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={localSettings.screenCaptureEnabled}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          screenCaptureEnabled: e.target.checked,
                        })
                      }
                    />
                    <span className="toggle-slider"></span>
                  </div>
                </div>
              </label>
            </div>

            <div className="settings-section">
              <label className="settings-label">
                <div className="label-header">
                  <div className="label-header-left">
                    <span className="label-text">Voice</span>
                    <div className="label-header-spacer"></div>
                    <span className="label-description">Select the voice for the AI teacher</span>
                  </div>
                  <div className="voice-dropdown-container" ref={voiceDropdownRef}>
                    <div 
                      className="voice-dropdown-trigger"
                      onClick={() => setVoiceDropdownOpen(!voiceDropdownOpen)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="voice-icon">
                        <path d="M12 1C8.13 1 5 4.13 5 8C5 10.38 6.19 12.47 8 13.74V21C8 21.55 8.45 22 9 22H15C15.55 22 16 21.55 16 21V13.74C17.81 12.47 19 10.38 19 8C19 4.13 15.87 1 12 1Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M9 12V21M15 12V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                      <span className="voice-selected">{localSettings.voice || "Zephyr"}</span>
                      <svg 
                        width="12" 
                        height="12" 
                        viewBox="0 0 12 8" 
                        fill="none" 
                        xmlns="http://www.w3.org/2000/svg" 
                        className={`voice-chevron ${voiceDropdownOpen ? "open" : ""}`}
                      >
                        <path d="M1 1L6 6L11 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    {voiceDropdownOpen && (
                      <div className="voice-dropdown-menu">
                      {[
                        { value: "Zephyr", name: "Zephyr", description: "Bright, Higher pitch" },
                        { value: "Puck", name: "Puck", description: "Upbeat, Middle pitch" },
                        { value: "Charon", name: "Charon", description: "Informative, Lower pitch" },
                        { value: "Kore", name: "Kore", description: "Firm, Middle pitch" },
                        { value: "Fenrir", name: "Fenrir", description: "Excitable, Lower middle pitch" },
                      ].map((voice) => (
                        <div
                          key={voice.value}
                          className={`voice-option ${localSettings.voice === voice.value ? "selected" : ""}`}
                          onClick={() => {
                            setLocalSettings({ ...localSettings, voice: voice.value });
                            setVoiceDropdownOpen(false);
                          }}
                        >
                          <button
                            type="button"
                            className="voice-play-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              // TODO: Implement voice preview playback
                            }}
                            aria-label={`Preview ${voice.name} voice`}
                          >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
                              <path d="M6 5L11 8L6 11V5Z" fill="currentColor"/>
                            </svg>
                          </button>
                          <div className="voice-option-content">
                            <span className="voice-option-name">{voice.name}</span>
                            <span className="voice-option-description">{voice.description}</span>
                          </div>
                        </div>
                      ))}
                      </div>
                    )}
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div className="settings-group">
            <h3 className="settings-group-title">Data Management</h3>
            <div className="settings-section">
              <div className="data-management-header">
                <button 
                  onClick={loadConversations} 
                  className="settings-secondary-button"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  Manage Conversations
                </button>
                <div className="settings-actions">
                  <button onClick={onClose} className="settings-cancel-button">
                    Cancel
                  </button>
                  <button onClick={() => onSave(localSettings)} className="settings-save-button">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M13 4L6 11L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Save
                  </button>
                </div>
              </div>
              {showConversations && (
                <div className="conversations-list">
                  {conversations.length === 0 ? (
                    <div className="conversations-empty">
                      <p>No conversations yet</p>
                    </div>
                  ) : (
                    conversations.map((conv) => (
                      <div key={conv.id} className="conversation-item">
                        <div className="conversation-info">
                          <strong className="conversation-title">{conv.title}</strong>
                          <span className="conversation-meta">
                            {new Date(conv.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="conversation-actions">
                          <button
                            className="conversation-action-btn primary"
                            onClick={() => handleSwitchConversation(conv.id)}
                            title="Load conversation"
                          >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M3 7L11 7M8 4L11 7L8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            Load
                          </button>
                          <button
                            className="conversation-action-btn"
                            onClick={() => handleExportConversation(conv.id)}
                            title="Export conversation"
                          >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M7 9V1M7 9L4 6M7 9L10 6M2 11H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            Export
                          </button>
                          <button
                            className="conversation-action-btn danger"
                            onClick={() => handleDeleteConversation(conv.id)}
                            title="Delete conversation"
                          >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M3.5 3.5L10.5 10.5M3.5 10.5L10.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                            </svg>
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

