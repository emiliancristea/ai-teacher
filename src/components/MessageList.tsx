import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { marked } from "marked";
import type { Message } from "../types";

interface MessageListProps {
  messages: Message[];
  streamingContent?: string;
  isLoading?: boolean;
  statusMessage?: string | null;
  onEditMessage?: (messageId: string, newContent: string, messageIndex: number) => void;
  onUpdateMessage?: (messageId: string, newContent: string) => void;
  onRegenerate?: (messageIndex: number) => void;
}

export function MessageList({ messages, streamingContent, isLoading, statusMessage, onEditMessage, onUpdateMessage, onRegenerate }: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  useEffect(() => {
    if (editingMessageId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
      // Auto-resize on mount
      editInputRef.current.style.height = 'auto';
      editInputRef.current.style.height = `${editInputRef.current.scrollHeight}px`;
    }
  }, [editingMessageId]);

  useEffect(() => {
    if (editInputRef.current) {
      // Auto-resize when content changes
      editInputRef.current.style.height = 'auto';
      editInputRef.current.style.height = `${editInputRef.current.scrollHeight}px`;
    }
  }, [editingContent]);

  const handleMessageClick = (message: Message) => {
    if (message.role === "user" && !streamingContent && !isLoading) {
      setEditingMessageId(message.id);
      setEditingContent(message.content);
    }
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditingContent(e.target.value);
    // Auto-resize
    if (editInputRef.current) {
      editInputRef.current.style.height = 'auto';
      editInputRef.current.style.height = `${editInputRef.current.scrollHeight}px`;
    }
  };

  const handleEditKeyPress = (e: KeyboardEvent<HTMLTextAreaElement>, messageId: string, messageIndex: number) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit(messageId, messageIndex);
    } else if (e.key === "Escape") {
      setEditingMessageId(null);
      setEditingContent("");
    }
  };

  const handleSaveEdit = (messageId: string, messageIndex: number) => {
    if (onEditMessage && editingContent.trim()) {
      onEditMessage(messageId, editingContent.trim(), messageIndex);
      setEditingMessageId(null);
      setEditingContent("");
    }
  };

  const handleBlur = (messageId: string) => {
    if (onUpdateMessage && editingContent.trim()) {
      onUpdateMessage(messageId, editingContent.trim());
    }
    setEditingMessageId(null);
    setEditingContent("");
  };

  const handleCopyMessage = async (content: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(content);
      // You could add a toast notification here if desired
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleRegenerate = (messageIndex: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRegenerate && !isLoading) {
      onRegenerate(messageIndex);
    }
  };

  const renderMarkdown = (content: string) => {
    const html = marked(content, {
      breaks: true,
      gfm: true,
    });

    return (
      <div
        dangerouslySetInnerHTML={{ __html: html }}
        className="markdown-content"
      />
    );
  };

  return (
    <div className="message-list">
      {messages.length === 0 && !streamingContent && !isLoading && (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M24 4L4 12L24 20L44 12L24 4Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4 28L24 36L44 28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4 20L24 28L44 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h2>Start a conversation</h2>
          <p>Ask me anything, and I'll help guide you through it!</p>
        </div>
      )}
      {messages.map((message, index) => (
        <div
          key={message.id}
          className={`message message-${message.role} ${editingMessageId === message.id ? 'editing' : ''}`}
          onClick={() => handleMessageClick(message)}
        >
          <div className="message-avatar">
            {message.role === "assistant" ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 2L2 6L10 10L18 6L10 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 14L10 18L18 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 10L10 14L18 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 10C12.7614 10 15 7.76142 15 5C15 2.23858 12.7614 0 10 0C7.23858 0 5 2.23858 5 5C5 7.76142 7.23858 10 10 10Z" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M2.5 18.75C2.5 15.2982 5.79822 12.5 10 12.5C14.2018 12.5 17.5 15.2982 17.5 18.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            )}
          </div>
          <div className="message-wrapper">
            <div className="message-content">
              {editingMessageId === message.id && message.role === "user" ? (
                <textarea
                  ref={editInputRef}
                  className="message-edit-input"
                  value={editingContent}
                  onChange={handleContentChange}
                  onKeyDown={(e) => handleEditKeyPress(e, message.id, index)}
                  onBlur={() => handleBlur(message.id)}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : message.role === "assistant" ? (
                renderMarkdown(message.content)
              ) : (
                <p>{message.content}</p>
              )}
            </div>
            <div className={`message-timestamp ${message.role === "assistant" ? "message-timestamp-assistant" : ""}`}>
              <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              {message.role === "assistant" && (
                <div className="message-actions">
                  <button
                    className="regenerate-button"
                    onClick={(e) => handleRegenerate(index, e)}
                    title="Regenerate message"
                    aria-label="Regenerate message"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M13.65 2.35C12.2 0.9 10.2 0 8 0C3.58 0 0 3.58 0 8C0 12.42 3.58 16 8 16C11.73 16 14.84 13.45 15.73 10H13.65C12.83 12.33 10.61 14 8 14C4.69 14 2 11.31 2 8C2 4.69 4.69 2 8 2C9.66 2 11.14 2.69 12.22 3.78L9 7H16V0L13.65 2.35Z" fill="currentColor"/>
                    </svg>
                  </button>
                  <button
                    className="copy-button"
                    onClick={(e) => handleCopyMessage(message.content, e)}
                    title="Copy message"
                    aria-label="Copy message"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M5.5 3.5V1.5C5.5 1.22386 5.72386 1 6 1H10.5C10.7761 1 11 1.22386 11 1.5V3.5H13.5C13.7761 3.5 14 3.72386 14 4V13.5C14 13.7761 13.7761 14 13.5 14H6.5C6.22386 14 6 13.7761 6 13.5V11H3.5C3.22386 11 3 10.7761 3 10.5V2.5C3 2.22386 3.22386 2 3.5 2H5.5V3.5ZM6.5 3.5H10V2H6.5V3.5ZM7 4.5V13H13V4.5H7ZM4 3V10H6V4.5C6 4.22386 6.22386 4 6.5 4H10.5V3H4Z" fill="currentColor"/>
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
      {statusMessage && (
        <div className="message message-assistant">
          <div className="message-avatar">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 2L2 6L10 10L18 6L10 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 14L10 18L18 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 10L10 14L18 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="message-wrapper">
            <div className="message-content">
              <div className="status-message">
                {statusMessage}
                <span className="status-indicator">▋</span>
              </div>
            </div>
          </div>
        </div>
      )}
      {streamingContent && (
        <div className="message message-assistant">
          <div className="message-avatar">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 2L2 6L10 10L18 6L10 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 14L10 18L18 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 10L10 14L18 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="message-wrapper">
            <div className="message-content">
              {renderMarkdown(streamingContent)}
              <span className="streaming-indicator">▋</span>
            </div>
            <div className="message-timestamp">Streaming...</div>
          </div>
        </div>
      )}
      {isLoading && !streamingContent && !statusMessage && (
        <div className="message message-assistant">
          <div className="message-avatar">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 2L2 6L10 10L18 6L10 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 14L10 18L18 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 10L10 14L18 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="message-wrapper">
            <div className="message-content">
              <div className="thinking-dots">
                <span className="thinking-dot"></span>
                <span className="thinking-dot"></span>
                <span className="thinking-dot"></span>
              </div>
            </div>
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

