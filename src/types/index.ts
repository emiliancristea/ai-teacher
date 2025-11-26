import type { WindowAnalysis } from "../services/windowAnalysis";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  screenshots?: string[]; // base64 image data
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface CaptureResult {
  image_base64: string;
  hash: string;
  timestamp: number;
}

export interface Settings {
  geminiApiKey: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  captureInterval: number; // seconds
  theme: "light" | "dark";
  screenCaptureEnabled: boolean;
  voice?: string;
}

export interface ProcessEvent {
  event_type: string;
  process_name: string;
  timestamp: number;
}

export interface WindowInfo {
  title: string;
  process_name: string;
  is_active: boolean;
}

export interface SystemContext {
  active_window: string;
  active_window_title: string;
  open_windows: WindowInfo[];
  running_applications: string[];
  timestamp: number;
}

export interface WindowCaptureResult {
  image_base64: string;
  hash: string;
  timestamp: number;
  ocr_text?: string | null;
  window_title: string;
  process_name: string;
  analysis?: WindowAnalysis | null;
}

export type CommandApprovalLevel = "auto" | "approval_required" | "blocked";

export interface CommandPolicyDecision {
  level: CommandApprovalLevel;
  reason: string;
  category: "context" | "critical" | "forbidden";
  suggestedConfirmation?: string;
  notes?: string;
}

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  error: string | null;
}

export interface PendingCommandRequest {
  id: string;
  command: string;
  args: string[];
  policy: CommandPolicyDecision;
  createdAt: number;
  status: "pending" | "executing" | "executed" | "denied" | "blocked";
  result?: CommandResult;
  error?: string;
}

