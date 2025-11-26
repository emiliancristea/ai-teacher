import { Store } from "@tauri-apps/plugin-store";
import type { Conversation, Message } from "../types";

// Initialize store - use Store.load() to create and load the store
let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load(".settings.dat");
  }
  return storeInstance;
}

const CONVERSATIONS_KEY = "conversations";
const CURRENT_CONVERSATION_KEY = "current_conversation_id";

export async function saveConversation(conversation: Conversation): Promise<void> {
  const store = await getStore();
  const conversations = await getConversations();
  const index = conversations.findIndex((c) => c.id === conversation.id);
  
  if (index >= 0) {
    conversations[index] = conversation;
  } else {
    conversations.push(conversation);
  }
  
  await store.set(CONVERSATIONS_KEY, conversations);
  await store.save();
}

export async function getConversations(): Promise<Conversation[]> {
  const store = await getStore();
  const conversations = await store.get<Conversation[]>(CONVERSATIONS_KEY);
  return conversations || [];
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const conversations = await getConversations();
  return conversations.find((c) => c.id === id) || null;
}

export async function deleteConversation(id: string): Promise<void> {
  const store = await getStore();
  const conversations = await getConversations();
  const filtered = conversations.filter((c) => c.id !== id);
  await store.set(CONVERSATIONS_KEY, filtered);
  await store.save();
}

export async function createConversation(title: string): Promise<Conversation> {
  const conversation: Conversation = {
    id: crypto.randomUUID(),
    title,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  await saveConversation(conversation);
  return conversation;
}

export async function addMessageToConversation(
  conversationId: string,
  message: Message
): Promise<void> {
  const conversation = await getConversation(conversationId);
  if (!conversation) {
    throw new Error("Conversation not found");
  }
  
  conversation.messages.push(message);
  conversation.updatedAt = Date.now();
  await saveConversation(conversation);
}

export async function getCurrentConversationId(): Promise<string | null> {
  const store = await getStore();
  return await store.get<string>(CURRENT_CONVERSATION_KEY) || null;
}

export async function setCurrentConversationId(id: string | null): Promise<void> {
  const store = await getStore();
  if (id) {
    await store.set(CURRENT_CONVERSATION_KEY, id);
  } else {
    await store.delete(CURRENT_CONVERSATION_KEY);
  }
  await store.save();
}

export async function exportConversation(id: string): Promise<string> {
  const conversation = await getConversation(id);
  if (!conversation) {
    throw new Error("Conversation not found");
  }
  return JSON.stringify(conversation, null, 2);
}

export async function importConversation(json: string): Promise<Conversation> {
  const conversation: Conversation = JSON.parse(json);
  conversation.id = crypto.randomUUID(); // Generate new ID
  conversation.createdAt = Date.now();
  conversation.updatedAt = Date.now();
  await saveConversation(conversation);
  return conversation;
}

