import { useState, useEffect, useCallback } from "react";
import { sendMessageWithVision } from "../services/gemini";
import { executeCommand } from "../services/screenCapture";
import {
  saveConversation,
  getConversation,
  createConversation,
  addMessageToConversation,
  getCurrentConversationId,
  setCurrentConversationId,
} from "../services/storage";
import type { Message, Conversation, PendingCommandRequest } from "../types";

export function useChat(_screenshots: string[]) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pendingCommands, setPendingCommands] = useState<PendingCommandRequest[]>([]);

  const handleCommandRequest = useCallback((request: PendingCommandRequest) => {
    setPendingCommands((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === request.id);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = { ...updated[existingIndex], ...request };
        return updated;
      }
      return [...prev, request];
    });
  }, []);

  const loadCurrentConversation = useCallback(async () => {
    const conversationId = await getCurrentConversationId();
    if (conversationId) {
      const conv = await getConversation(conversationId);
      if (conv) {
        setConversation(conv);
        setMessages(conv.messages ?? []);
        return;
      }
    }
    const newConv = await createConversation("New Conversation");
    setConversation(newConv);
    setMessages([]);
    await setCurrentConversationId(newConv.id);
  }, []);

  useEffect(() => {
    void loadCurrentConversation();
  }, [loadCurrentConversation]);

  const persistMessages = useCallback(
    (updated: Message[]) => {
      if (!conversation) return;
      const updatedConv: Conversation = { ...conversation, messages: updated };
      setConversation(updatedConv);
      saveConversation(updatedConv);
    },
    [conversation]
  );

  const sendMessage = useCallback(
    async (content: string, fromMessageIndex?: number) => {
      if (!content.trim() || isLoading) return;

      // If fromMessageIndex is provided, truncate messages from that point
      let messagesToUse = messages;
      if (fromMessageIndex !== undefined && fromMessageIndex >= 0) {
        messagesToUse = messages.slice(0, fromMessageIndex);
        setMessages(messagesToUse);
      }

      setIsLoading(true);
      setStatusMessage("Thinking...");

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: content.trim(),
        timestamp: Date.now(),
        screenshots: _screenshots.length > 0 ? [..._screenshots] : undefined,
      };

      setMessages((prev) => [...prev, userMessage]);

      try {
        const stream = await sendMessageWithVision(
          [...messagesToUse, userMessage],
          _screenshots,
          setStatusMessage,
          handleCommandRequest
        );

        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let assistantContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Fix TypeScript error by using proper type assertion for the stream value
          const chunk = decoder.decode(value as unknown as AllowSharedBufferSource);
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  assistantContent += parsed.content;
                  setStreamingContent(assistantContent);
                }
              } catch (e) {
                // Ignore JSON parse errors
              }
            }
          }
        }

        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: assistantContent.trim(),
          timestamp: Date.now(),
          screenshots: _screenshots.length > 0 ? [..._screenshots] : undefined,
        };

        setMessages((prev) => [...prev, assistantMessage]);

        if (conversation) {
          await addMessageToConversation(conversation.id, userMessage);
          await addMessageToConversation(conversation.id, assistantMessage);
        }
      } catch (error: any) {
        console.error("Error sending message:", error);
        const errorMessage: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Error: ${error.message || "Failed to get response"}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
        setStreamingContent("");
        setStatusMessage(null);
      }
    },
    [messages, _screenshots, conversation, isLoading, handleCommandRequest]
  );

  const createNewConversation = useCallback(async () => {
    const newConv = await createConversation("New Conversation");
    setConversation(newConv);
    setMessages([]);
    await setCurrentConversationId(newConv.id);
  }, []);

  const updateMessage = useCallback(
    (messageId: string, newContent: string) => {
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === messageId ? { ...m, content: newContent } : m
        );
        persistMessages(updated);
        return updated;
      });
    },
    [persistMessages]
  );

  const clearChat = useCallback(async () => {
    setMessages([]);
    if (conversation) {
      const updatedConv: Conversation = { ...conversation, messages: [] };
      setConversation(updatedConv);
      saveConversation(updatedConv);
    }
  }, [conversation]);

  const approveCommandRequest = useCallback(
    async (requestId: string) => {
      const request = pendingCommands.find((item) => item.id === requestId);
      if (!request || request.status === "executed" || request.status === "executing") {
        return;
      }

      setPendingCommands((prev) =>
        prev.map((item) =>
          item.id === requestId ? { ...item, status: "executing", error: undefined } : item
        )
      );

      try {
        const result = await executeCommand(request.command, request.args || []);
        setPendingCommands((prev) =>
          prev.map((item) =>
            item.id === requestId
              ? { ...item, status: "executed", result, error: result.error || undefined }
              : item
          )
        );

        await sendMessage("Command executed successfully. What would you like to do next?");
        setPendingCommands((prev) => prev.filter((item) => item.id !== requestId));
      } catch (error: any) {
        const errorMessage = error?.message || "Command execution failed";
        setPendingCommands((prev) =>
          prev.map((item) =>
            item.id === requestId ? { ...item, status: "executed", error: errorMessage } : item
          )
        );
        await sendMessage(`Command execution failed: ${errorMessage}. Please try a different approach.`);
        setPendingCommands((prev) => prev.filter((item) => item.id !== requestId));
      }
    },
    [pendingCommands, sendMessage]
  );

  const denyCommandRequest = useCallback(
    async (requestId: string) => {
      const request = pendingCommands.find((item) => item.id === requestId);
      if (!request || request.status === "executed" || request.status === "denied") {
        return;
      }

      setPendingCommands((prev) =>
        prev.map((item) =>
          item.id === requestId ? { ...item, status: "denied", error: undefined } : item
        )
      );

      await sendMessage("Command was denied for safety reasons. Please try a different approach.");
      setPendingCommands((prev) => prev.filter((item) => item.id !== requestId));
    },
    [pendingCommands, sendMessage]
  );

  return {
    conversation,
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
  };
}
