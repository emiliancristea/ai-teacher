import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  CaptureResult,
  ProcessEvent,
  SystemContext,
  WindowCaptureResult,
  WindowInfo,
  CommandResult,
} from "../types";
import { analyzeWindowCapture } from "./windowAnalysis";

export async function captureScreen(): Promise<CaptureResult> {
  return await invoke<CaptureResult>("capture_screen");
}

export async function getActiveWindow(): Promise<string> {
  return await invoke<string>("get_active_window");
}

export async function startMonitoring(): Promise<void> {
  return await invoke("start_monitoring");
}

export async function stopMonitoring(): Promise<void> {
  return await invoke("stop_monitoring");
}

export async function getCaptureInterval(): Promise<number> {
  return await invoke<number>("get_capture_interval");
}

export async function setCaptureInterval(interval: number): Promise<void> {
  return await invoke("set_capture_interval", { interval });
}

export function listenToScreenChanges(
  callback: (result: CaptureResult) => void
): Promise<() => void> {
  return listen<CaptureResult>("screen-changed", (event) => {
    callback(event.payload);
  });
}

export function listenToProcessEvents(
  callback: (event: ProcessEvent) => void
): Promise<() => void> {
  return listen<ProcessEvent>("process-event", (event) => {
    callback(event.payload);
  });
}

export async function getSystemContext(): Promise<SystemContext> {
  return await invoke<SystemContext>("get_system_context");
}

/**
 * Capture a specific window by process name or window title
 */
export async function captureWindow(options?: {
  processName?: string;
  windowTitle?: string;
}): Promise<WindowCaptureResult> {
  const params: {
    process_name?: string;
    window_title?: string;
  } = {};
  
  if (options?.processName !== undefined && options?.processName !== null) {
    params.process_name = options.processName;
  }
  if (options?.windowTitle !== undefined && options?.windowTitle !== null) {
    params.window_title = options.windowTitle;
  }
  
  return await invoke<WindowCaptureResult>("capture_window", { options: params });
}

/**
 * Capture a window and extract text using OCR
 */
export async function captureWindowWithOCR(options?: {
  processName?: string;
  windowTitle?: string;
}): Promise<WindowCaptureResult> {
  // Build the params object for the struct
  const params: {
    process_name?: string;
    window_title?: string;
  } = {};
  
  if (options?.processName !== undefined && options?.processName !== null) {
    params.process_name = options.processName;
  }
  if (options?.windowTitle !== undefined && options?.windowTitle !== null) {
    params.window_title = options.windowTitle;
  }
  
  console.log(`[screenCapture] Invoking capture_window_with_ocr with options:`, JSON.stringify(params));
  
  // Tauri deserializes the object directly into the struct parameter
  const result = await invoke<WindowCaptureResult>("capture_window_with_ocr", { options: params });
  
  // Perform window analysis with caching
  // This runs automatically but doesn't block if it fails
  try {
    console.log(`[screenCapture] Starting window analysis...`);
    const analysis = await analyzeWindowCapture(
      result.image_base64,
      result.ocr_text || null,
      result.window_title,
      result.process_name,
      result.hash
    );
    
    if (analysis) {
      result.analysis = analysis;
      console.log(`[screenCapture] Window analysis completed:`, {
        windowType: analysis.windowType,
        application: analysis.application,
        hasDescription: !!analysis.detailedDescription,
      });
    } else {
      console.log(`[screenCapture] Window analysis returned null (may have failed)`);
    }
  } catch (error) {
    // Don't fail the capture if analysis fails
    console.error(`[screenCapture] Window analysis failed:`, error);
    result.analysis = null;
  }
  
  return result;
}

/**
 * List all windows matching a process name or window title
 */
export async function listWindowsByProcess(options?: {
  processName?: string;
  windowTitle?: string;
}): Promise<WindowInfo[]> {
  const params: {
    process_name?: string;
    window_title?: string;
  } = {};
  
  if (options?.processName !== undefined && options?.processName !== null) {
    params.process_name = options.processName;
  }
  if (options?.windowTitle !== undefined && options?.windowTitle !== null) {
    params.window_title = options.windowTitle;
  }
  
  return await invoke<WindowInfo[]>("list_windows_by_process", { options: params });
}

/**
 * Extract text from an image using OCR
 */
export async function extractTextFromImage(imageBase64: string): Promise<string> {
  return await invoke<string>("extract_text_from_image", {
    image_base64: imageBase64,
  });
}

/**
 * Execute a terminal command
 */
export async function executeCommand(command: string, args: string[] = []): Promise<CommandResult> {
  return await invoke<CommandResult>("execute_command", { command, args });
}

