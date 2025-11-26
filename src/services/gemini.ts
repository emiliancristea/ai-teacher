import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Message, SystemContext, PendingCommandRequest } from "../types";
import systemPromptConfig from "../config/system-prompt.json";
import {
  analyzeConversationHistory,
  createContextSummary,
  buildOptimizedHistory,
  injectDynamicContext,
} from "./contextManager";
import { analyzeScreenshotForLearningNeeds, type ScreenshotAnalysis } from "./screenshotAnalysis";
import { getSystemContext, captureWindowWithOCR, listWindowsByProcess, executeCommand } from "./screenCapture";
import { evaluateCommandPolicy } from "./commandPolicy";

let genAI: GoogleGenerativeAI | null = null;
export let currentModel: any = null;
let currentModelName: string = "gemini-flash-latest";

// List of models to try in order of preference
// Based on Google's latest API, these are the correct model names
const MODEL_PRIORITIES = [
  "gemini-flash-latest",      // Latest flash model (fastest, recommended)
  "gemini-pro",               // Stable pro model
  "gemini-1.5-flash",         // Alternative flash model
  "gemini-1.5-pro",           // Alternative pro model
  "gemini-1.5-pro-latest",    // Latest pro model
];

export function initializeGemini(apiKey: string, preferredModel?: string) {
  genAI = new GoogleGenerativeAI(apiKey);
  
  // Try to initialize with preferred model or default
  const modelToTry = preferredModel || MODEL_PRIORITIES[0];
  try {
    currentModel = genAI.getGenerativeModel({ model: modelToTry });
    currentModelName = modelToTry;
  } catch (error) {
    console.warn(`Failed to initialize with ${modelToTry}, using default`);
    currentModel = genAI.getGenerativeModel({ model: MODEL_PRIORITIES[0] });
    currentModelName = MODEL_PRIORITIES[0];
  }
}

export async function testModelAvailability(apiKey: string): Promise<string[]> {
  const testGenAI = new GoogleGenerativeAI(apiKey);
  const availableModels: string[] = [];
  
  for (const modelName of MODEL_PRIORITIES) {
    try {
      const testModel = testGenAI.getGenerativeModel({ model: modelName });
      // Try a simple test call
      await testModel.generateContent({
        contents: [{ role: "user", parts: [{ text: "test" }] }],
      });
      availableModels.push(modelName);
      console.log(`✓ Model ${modelName} is available`);
    } catch (error: any) {
      // Model not available or error
      console.log(`✗ Model ${modelName} not available: ${error.message}`);
    }
  }
  
  // If no models available, provide helpful message
  if (availableModels.length === 0) {
    console.warn("⚠️ No models found. Please check your API key configuration:");
    console.warn("1. Visit https://aistudio.google.com/apikey");
    console.warn("2. Verify your API key is valid");
    console.warn("3. Enable Generative Language API in Google Cloud Console");
    console.warn("4. Check for API key restrictions");
  }
  
  return availableModels;
}

/**
 * Check if a window was recently captured in conversation history
 * Returns capture details if found within recent messages
 */
function hasRecentCapture(
  messages: Message[],
  processName?: string,
  windowTitle?: string,
  maxMessagesBack: number = 5
): { hasCapture: boolean; captureData?: any; captureMessageIndex?: number } {
  // Look through recent assistant messages (they contain function responses)
  const recentMessages = messages.slice(-maxMessagesBack);
  
  // Search backwards through recent messages
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const msg = recentMessages[i];
    
    // Check if this is an assistant message that might contain capture data
    if (msg.role === "assistant" && msg.content) {
      // Try to extract function response data from the message content
      // The content might contain references to window captures
      // Look for patterns that indicate a capture was performed
      
      // Check if message mentions window capture details
      const hasWindowMention = (processName && msg.content.toLowerCase().includes(processName.toLowerCase())) ||
                               (windowTitle && msg.content.toLowerCase().includes(windowTitle.toLowerCase()));
      
      // Check if message contains capture-related keywords
      const hasCaptureKeywords = /\b(captured|screenshot|window|ocr|extracted|image)\b/i.test(msg.content);
      
      if (hasWindowMention || hasCaptureKeywords) {
        // This might be a message that followed a capture
        // Check the previous messages to see if there was a function call
        const messageIndex = messages.length - (recentMessages.length - i);
        if (messageIndex > 0) {
          // Look for function response patterns in the conversation flow
          // In our implementation, function responses are sent back to the AI
          // and then the AI responds with the image analysis
          // So we need to check if there was a capture in the recent flow
          
          // For now, if we find a message mentioning the window/app, assume capture happened
          // We'll refine this by checking actual function call history
    return {
            hasCapture: true,
            captureMessageIndex: messageIndex,
          };
        }
      }
    }
  }
  
  return { hasCapture: false };
}

function generateId(prefix: string = "id"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

interface WindowSelectionOption {
  title: string;
  displayName: string;
  processName: string;
  isActive: boolean;
}

interface CachedWindowSelection {
  options: WindowSelectionOption[];
  timestamp: number;
}

const WINDOW_SELECTION_TTL = 2 * 60 * 1000; // 2 minutes
const windowSelectionCache = new Map<string, CachedWindowSelection>();

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

function cacheWindowOptions(processName: string, options: WindowSelectionOption[]) {
  const key = processName.trim().toLowerCase();
  if (!key) return;
  windowSelectionCache.set(key, {
    options,
    timestamp: Date.now(),
  });
  }

function getCachedWindowOptions(processName: string): WindowSelectionOption[] | null {
  const key = processName.trim().toLowerCase();
  const cached = windowSelectionCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > WINDOW_SELECTION_TTL) {
    windowSelectionCache.delete(key);
    return null;
  }
  return cached.options;
}

function getAllCachedWindowOptions(): Array<{ processName: string; options: WindowSelectionOption[] }> {
  const entries: Array<{ processName: string; options: WindowSelectionOption[] }> = [];
  for (const [key, cached] of windowSelectionCache.entries()) {
    if (Date.now() - cached.timestamp <= WINDOW_SELECTION_TTL) {
      entries.push({ processName: key, options: cached.options });
    } else {
      windowSelectionCache.delete(key);
    }
  }
  return entries;
}

function normalizeWindowText(text: string): string {
  return text
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/\b(window|app|tab|project|file|view|editor|panel|screen|pane|the|this|that|one|please|focus|select|choose|open|show|display|look|at|into|on)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isConversationWrapMessage(message: string): boolean {
  if (!message) return false;
  const normalized = message.trim().toLowerCase();
  return /\b(all good|that's all|that is all|thanks|thank you|appreciate it|no further|no that's it|just checking|just wanted to check|all set|we're good|done for now|thanks, that|thanks. that|cheers)\b/.test(normalized);
}

function isExplicitDockerQuestion(message: string): boolean {
  if (!message) return false;
  return /(?:\bwhat\b|\bwhich\b|\bis\b|\bare\b|\bshow\b|\bstart\b|\bstop\b|\brestart\b|\brun\b|\bcheck\b|\bgrab\b|\bfetch\b|\bview\b|\bstatus\b)/i.test(message) &&
    /\b(container|docker|compose|stack|service|infra|xenolabs|kryptit|bunkerverse)\b/i.test(message);
}

function extractRequestedIndex(input: string, total: number): number | null {
  const digitMatch = input.match(/\b(\d+)\b/);
  if (digitMatch) {
    const candidate = parseInt(digitMatch[1], 10);
    if (!Number.isNaN(candidate) && candidate >= 1 && candidate <= total) {
      return candidate - 1;
    }
  }

  const lower = input.toLowerCase();
  for (const [word, value] of Object.entries(ORDINAL_WORDS)) {
    if (lower.includes(word) && value >= 1 && value <= total) {
      return value - 1;
    }
  }

  return null;
}

function resolveWindowSelectionFromOptions(
  processName: string,
  options: WindowSelectionOption[],
  requested: string
): { title: string; displayName: string; processName: string } | null {
  if (!requested) return null;

  const cleaned = requested.replace(/["'`]/g, "").trim();
  if (!cleaned) return null;

  const indexFromWords = extractRequestedIndex(cleaned, options.length);
  if (indexFromWords !== null) {
    const option = options[indexFromWords];
    if (option) {
      return { title: option.title, displayName: option.displayName, processName };
    }
  }

  const normalizedRequested = normalizeWindowText(cleaned);
  const tokens = normalizedRequested.split(" ").filter(Boolean);

  const directTitleMatch = options.find(
    (option) => option.title.toLowerCase() === cleaned.toLowerCase()
  );
  if (directTitleMatch) {
    return {
      title: directTitleMatch.title,
      displayName: directTitleMatch.displayName,
      processName,
    };
  }

  const directDisplayMatch = options.find(
    (option) => option.displayName.toLowerCase() === cleaned.toLowerCase()
  );
  if (directDisplayMatch) {
    return {
      title: directDisplayMatch.title,
      displayName: directDisplayMatch.displayName,
      processName,
    };
  }

  const normalizedMatches = options.find((option) => {
    const normalizedTitle = normalizeWindowText(option.title);
    const normalizedDisplay = normalizeWindowText(option.displayName);
    return normalizedTitle === normalizedRequested || normalizedDisplay === normalizedRequested;
  });
  if (normalizedMatches) {
    return {
      title: normalizedMatches.title,
      displayName: normalizedMatches.displayName,
      processName,
    };
  }

  let bestOption: WindowSelectionOption | null = null;
  let bestScore = 0;

  for (const option of options) {
    const normalizedTitle = normalizeWindowText(option.title);
    const normalizedDisplay = normalizeWindowText(option.displayName);

    let score = 0;

    if (
      normalizedRequested &&
      (normalizedTitle.startsWith(normalizedRequested) || normalizedDisplay.startsWith(normalizedRequested))
    ) {
      score += 60;
    } else if (
      normalizedRequested &&
      (normalizedTitle.includes(normalizedRequested) || normalizedDisplay.includes(normalizedRequested))
    ) {
      score += 45;
    }

    if (tokens.length > 0) {
      const matchedTokens = tokens.filter(
        (token) => token.length > 1 && (normalizedTitle.includes(token) || normalizedDisplay.includes(token))
      );
      if (matchedTokens.length) {
        score += matchedTokens.length * 10;
        if (matchedTokens.length === tokens.length) {
          score += 10;
        }
      }
    }

    if (option.isActive) {
      score += 5;
    }

    if (normalizedRequested && normalizedTitle.length > 0) {
      score += Math.max(0, 8 - Math.abs(normalizedTitle.length - normalizedRequested.length));
    }

    if (score > bestScore) {
      bestScore = score;
      bestOption = option;
    }
  }

  if (bestOption && bestScore >= 15) {
    return {
      title: bestOption.title,
      displayName: bestOption.displayName,
      processName,
    };
  }

  return null;
}

function resolveWindowSelection(
  processName: string | undefined,
  requested: string
): { title: string; displayName: string; processName: string } | null {
  if (!requested) return null;

  if (processName) {
    const options = getCachedWindowOptions(processName);
    if (options && options.length > 0) {
      const resolved = resolveWindowSelectionFromOptions(processName, options, requested);
      if (resolved) {
        return resolved;
      }
    }
  }

  const allOptions = getAllCachedWindowOptions();
  let bestMatch: { title: string; displayName: string; processName: string } | null = null;
  let bestScore = 0;

  for (const entry of allOptions) {
    const resolved = resolveWindowSelectionFromOptions(entry.processName, entry.options, requested);
    if (resolved) {
      const normalizedRequested = normalizeWindowText(requested);
      const normalizedCandidate = normalizeWindowText(resolved.displayName || resolved.title);
      let score = 0;
      if (normalizedCandidate === normalizedRequested) {
        score = 100;
      } else if (normalizedCandidate.startsWith(normalizedRequested)) {
        score = 80;
      } else if (normalizedCandidate.includes(normalizedRequested)) {
        score = 60;
      } else {
        const tokens = normalizedRequested.split(" ").filter(Boolean);
        const matchedTokens = tokens.filter((token) => token.length > 1 && normalizedCandidate.includes(token));
        score = matchedTokens.length * 10;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = resolved;
      }
    }
  }

  return bestMatch;
}

async function buildWindowSelectionPrompt(
  functionName: string,
  processName: string,
  reason?: string
): Promise<any> {
  console.log(`[Gemini] Listing windows for process: ${processName}`);
          
          const windows = await listWindowsByProcess({
    processName,
          });
          
  console.log(`[Gemini] Found ${windows.length} window(s) for process "${processName}"`);
          
          if (windows.length === 0) {
            return {
              name: functionName,
              response: {
                success: false,
        error: `No windows found for process "${processName}". Please check if the application is running.`,
                windows: [],
              },
            };
          }
          
  const windowNames = windows.map((w) => {
            const processSuffix = ` - ${w.process_name}`;
            let cleaned = w.title;
            if (cleaned.endsWith(processSuffix)) {
              cleaned = cleaned.slice(0, -processSuffix.length);
            }
    const parts = cleaned.split(" - ");
            if (parts.length > 1) {
              return parts[parts.length - 1];
            }
            return cleaned;
          });
          
  const windowList = windowNames
    .map(
      (name, idx) =>
            `${idx + 1}. "${name}" ${windows[idx].is_active ? "(currently active)" : ""}`
    )
    .join("\n");
          
  const baseMessage =
    windows.length === 1
            ? `I found 1 window:\n\n${windowList}\n\nWould you like me to focus on this window?`
            : `I found ${windows.length} windows:\n\n${windowList}\n\nWhich one would you like me to focus on? Please specify by number (1-${windows.length}) or by window name.`;
          
  const message = reason ? `${reason.trim()}\n\n${baseMessage}` : baseMessage;

  const windowOptions: WindowSelectionOption[] = windows.map((w, idx) => ({
    title: w.title,
    displayName: windowNames[idx],
    processName: w.process_name,
    isActive: w.is_active,
  }));

  cacheWindowOptions(processName, windowOptions);

          return {
            name: functionName,
            response: {
              success: false,
              multiple_windows_found: true,
      message,
      instruction:
        "CRITICAL: Present the windows EXACTLY as shown in the 'message' field. Copy it verbatim. Do NOT reconstruct from the windows array. Do NOT add file names or app suffixes.",
      windows: windowOptions,
    },
  };
}

function enforceConversationalTone(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (trimmed.length <= 600 || /```/.test(trimmed) || /^\s*[-*]/m.test(trimmed)) {
    return trimmed;
  }

  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const selected: string[] = [];
  let totalLength = 0;

  for (const sentence of sentences) {
    const cleanSentence = sentence.trim();
    if (!cleanSentence) continue;
    selected.push(cleanSentence);
    totalLength += cleanSentence.length;
    if (selected.length >= 3 || totalLength > 400) {
      break;
    }
  }

  let result = selected.join(" ");
  if (!/[.!?]$/.test(result)) {
    result += ".";
  }

  if (sentences.length > selected.length) {
    result += " Let me know if you'd like the details.";
  }

  return result;
}

/**
 * Handle function calls from Gemini with status updates
 */
async function handleFunctionCall(
  functionCall: any,
  onStatusUpdate?: (status: string) => void
): Promise<any> {
  // Validate function call structure
  if (!functionCall || typeof functionCall !== 'object') {
    console.error(`[Gemini] Invalid function call object:`, functionCall);
    return {
      name: "unknown",
      response: {
        success: false,
        error: "Invalid function call format",
      },
    };
  }

  const functionName = functionCall.name;
  const args = functionCall.args || {};

  if (!functionName || typeof functionName !== 'string') {
    console.error(`[Gemini] Function call missing name:`, functionCall);
    return {
      name: "unknown",
      response: {
        success: false,
        error: "Function call missing name",
      },
    };
  }

  console.log(`[Gemini] Function call: ${functionName}`, args);

  try {
    switch (functionName) {
      case "capture_window_with_ocr":
        onStatusUpdate?.("Checking for windows...");
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // First, list all matching windows if process_name is provided
        // This allows us to detect multiple windows and ask the user to choose
        if (args.process_name && !args.window_title) {
          console.log(`[Gemini] Listing windows for process: ${args.process_name}`);
          
          const windows = await listWindowsByProcess({
            processName: args.process_name,
          });
          
          console.log(`[Gemini] Found ${windows.length} window(s) for process "${args.process_name}"`);
          
          if (windows.length === 0) {
            return {
              name: functionName,
              response: {
                success: false,
                error: `No windows found for process "${args.process_name}". Please check if the application is running.`,
                windows: [],
              },
            };
          }
          
          const windowOptions: WindowSelectionOption[] = windows.map((w) => {
            const processSuffix = ` - ${w.process_name}`;
            let cleaned = w.title;
            if (cleaned.endsWith(processSuffix)) {
              cleaned = cleaned.slice(0, -processSuffix.length);
            }
            const parts = cleaned.split(" - ");
            const displayName = parts.length > 1 ? parts[parts.length - 1] : cleaned;
            return {
              title: w.title,
              displayName,
              processName: w.process_name,
              isActive: w.is_active,
            };
          });

          cacheWindowOptions(args.process_name, windowOptions);

          if (windows.length === 1) {
            const single = windowOptions[0];
            console.log(`[Gemini] ✅ Single window detected for ${args.process_name}, auto-selecting "${single.title}"`);
            args.window_title = single.title;
          } else {
            const selectionMessage = windowOptions
              .map(
                (opt, idx) =>
                  `${idx + 1}. "${opt.displayName}" ${opt.isActive ? "(currently active)" : ""}`
              )
              .join("\n");
          
          return {
            name: functionName,
            response: {
              success: false,
              multiple_windows_found: true,
                message: `I found ${windowOptions.length} windows:\n\n${selectionMessage}\n\nWhich one would you like me to focus on? Please specify by number (1-${windowOptions.length}) or by window name.`,
                instruction:
                  "CRITICAL: Present the windows EXACTLY as shown in the 'message' field. Copy it verbatim. Do NOT reconstruct from the windows array. Do NOT add file names or app suffixes.",
                windows: windowOptions,
              },
            };
          }
        }
        
        // Proceed with capture (either single window or user-specified window_title)
        onStatusUpdate?.("Focusing on app...");
        await new Promise(resolve => setTimeout(resolve, 300));

        if (args.window_title) {
          const resolvedWindow = resolveWindowSelection(args.process_name, args.window_title);
          if (resolvedWindow) {
            if (resolvedWindow.title !== args.window_title) {
              console.log(
                `[Gemini] 🎯 Resolved window selection "${args.window_title}" -> "${resolvedWindow.title}"`
              );
            }
            args.window_title = resolvedWindow.title;
            if (!args.process_name) {
              args.process_name = resolvedWindow.processName;
            }
          } else if (args.process_name) {
            console.log(
              `[Gemini] ⚠️ Could not resolve window title "${args.window_title}" for process ${args.process_name}. Re-listing options.`
            );
            return await buildWindowSelectionPrompt(
              functionName,
              args.process_name,
              `I couldn't match "${args.window_title}" to a specific window. Please pick from the list below using the exact number or by copying the window title.`
            );
          }
        }
        
        const targetApp = args.process_name || args.window_title || "the window";
        onStatusUpdate?.(`Capturing ${targetApp}...`);
        
        console.log(`[Gemini] Calling captureWindowWithOCR with:`, {
          processName: args.process_name,
          windowTitle: args.window_title,
        });
        
        const result = await captureWindowWithOCR({
          processName: args.process_name,
          windowTitle: args.window_title,
        });
        
        // Log capture details
        console.log(`[Gemini] ✅ Window captured successfully:`, {
          process_name: result.process_name,
          window_title: result.window_title,
          image_size: `${Math.round(result.image_base64.length / 1024)} KB`,
          has_ocr_text: !!result.ocr_text,
        });
        
        // Log OCR results
        if (result.ocr_text) {
          const ocrPreview = result.ocr_text.length > 200 
            ? result.ocr_text.substring(0, 200) + "..." 
            : result.ocr_text;
          console.log(`[Gemini] 📝 OCR extracted ${result.ocr_text.length} characters:`, ocrPreview);
        } else {
          console.log(`[Gemini] ⚠️ No OCR text extracted (window might be empty or OCR failed)`);
        }
        
        // Log analysis results if available
        if (result.analysis) {
          console.log(`[Gemini] 🔍 Window analysis available:`, {
            windowType: result.analysis.windowType,
            application: result.analysis.application,
            contentType: result.analysis.contentType,
            descriptionLength: result.analysis.detailedDescription.length,
          });
        } else {
          console.log(`[Gemini] ℹ️ No window analysis available (may still be processing or failed)`);
        }
        
        onStatusUpdate?.("Understanding its content...");
        await new Promise(resolve => setTimeout(resolve, 300));
        
        console.log(`[Gemini] 📤 Sending to AI model:`, {
          image_base64_length: result.image_base64.length,
          ocr_text_length: result.ocr_text?.length || 0,
          has_analysis: !!result.analysis,
          window_title: result.window_title,
          process_name: result.process_name,
        });
        
        return {
          name: functionName,
          response: {
            success: true,
            image_base64: result.image_base64,
            ocr_text: result.ocr_text || "",
            window_title: result.window_title,
            process_name: result.process_name,
            analysis: result.analysis || null,
          },
        };

      case "execute_command": {
        const command = typeof args.command === "string" ? args.command : "";
        const commandArgs = Array.isArray(args.args) ? (args.args as string[]) : [];
        const policyDecision = evaluateCommandPolicy(command, commandArgs);

        console.log(`[Gemini] Command policy decision:`, {
          command,
          args: commandArgs,
          level: policyDecision.level,
          category: policyDecision.category,
          reason: policyDecision.reason,
        });

        if (policyDecision.level === "blocked") {
          const requestId = generateId("cmd");
          onStatusUpdate?.("Command blocked by safety rules");
          return {
            name: functionName,
            response: {
              success: false,
              blocked: true,
              command,
              args: commandArgs,
              policy: policyDecision,
              error: policyDecision.reason,
              request_id: requestId,
            },
          };
        }

        if (policyDecision.level === "approval_required") {
          const requestId = generateId("cmd");
          onStatusUpdate?.("Waiting for command approval");
          return {
            name: functionName,
            response: {
              success: false,
              needsApproval: true,
              command,
              args: commandArgs,
              policy: policyDecision,
              error: policyDecision.reason,
              request_id: requestId,
            },
          };
        }

        onStatusUpdate?.("Running command...");
        console.log(`[Gemini] Executing command: ${command}`, commandArgs);

        try {
          const cmdResult = await executeCommand(command, commandArgs);

          console.log(`[Gemini] Command result:`, {
            success: cmdResult.success,
            stdout_length: cmdResult.stdout.length,
            stderr_length: cmdResult.stderr.length,
            exit_code: cmdResult.exit_code,
          });

          return {
            name: functionName,
            response: {
              success: cmdResult.success,
              stdout: cmdResult.stdout,
              stderr: cmdResult.stderr,
              exit_code: cmdResult.exit_code,
              error: cmdResult.error || null,
              command,
              args: commandArgs,
              policy: policyDecision,
            },
          };
        } catch (error: any) {
          console.error(`[Gemini] Command execution error:`, error);
          return {
            name: functionName,
            response: {
              success: false,
              stdout: "",
              stderr: "",
              exit_code: null,
              error: error.message || "Command execution failed",
              command,
              args: commandArgs,
              policy: policyDecision,
            },
          };
        }
      }

      default:
        return {
          name: functionName,
          response: {
            success: false,
            error: `Unknown function: ${functionName}`,
          },
        };
    }
  } catch (error: any) {
    console.error(`[Gemini] Function call error:`, error);
    onStatusUpdate?.("Error occurred");
    return {
      name: functionName,
      response: {
        success: false,
        error: error.message || "Function call failed",
      },
    };
  }
}

export async function sendMessageWithVision(
  messages: Message[],
  screenshots: string[],
  onStatusUpdate?: (status: string) => void,
  onCommandRequest?: (request: PendingCommandRequest) => void
): Promise<ReadableStream<string>> {
  if (!currentModel) {
    throw new Error("Gemini not initialized. Please set API key in settings.");
  }

  const lastUserMessageContent = messages
    .slice()
    .reverse()
    .find((m) => m.role === "user")?.content ?? "";

  if (isConversationWrapMessage(lastUserMessageContent)) {
    console.log("[Gemini] 💤 Wrap-up message detected, responding briefly without tool calls.");
    return new ReadableStream<string>({
      start(controller) {
        controller.enqueue("Yep, I still have it in view. Let me know if you need anything else!");
        controller.close();
      },
    });
  }

  // SCREENSHOT-FIRST ANALYSIS: Analyze screenshots FIRST to understand context and learning needs
  let screenshotAnalysis: ScreenshotAnalysis | null = null;
  if (screenshots.length > 0 && currentModel) {
    try {
      screenshotAnalysis = await analyzeScreenshotForLearningNeeds(screenshots, currentModel);
    } catch (error) {
      console.error("Failed to analyze screenshots:", error);
      // Continue without screenshot analysis if it fails
    }
  }

  // COLLECT REAL-TIME SYSTEM CONTEXT: Get open windows, applications, etc.
  let systemContext: SystemContext | null = null;
  try {
    systemContext = await getSystemContext();
    console.log(`[Gemini] System context: Active="${systemContext.active_window_title}", Windows=${systemContext.open_windows.length}, Apps=${systemContext.running_applications.length}`);
  } catch (error) {
    console.error("Failed to get system context:", error);
    // Continue without system context if it fails
  }

  // Analyze conversation state for dynamic context
  const conversationState = analyzeConversationHistory(messages);
  
  // Build optimized conversation history (smart context window management)
  const optimizedMessages = buildOptimizedHistory(
    messages.filter((m) => m.role !== "system"),
    8 // Keep last 8 messages, but optimize if longer
  );
  
  // Create context summary for long conversations
  const contextSummary = messages.length > 15 
    ? createContextSummary(messages, conversationState)
    : undefined;

  // Build conversation history for API
  // Filter out system messages and ensure clean content
  // IMPORTANT: Include ALL messages (both user and assistant) to maintain conversation context
  const conversationHistory = optimizedMessages
    .filter((msg) => msg.role !== "system") // Exclude system messages
    .map((msg) => {
      // Clean content to remove any system prompt markers
      const cleanContent = msg.content
        .replace(/\[SYSTEM INSTRUCTION[^\]]*\][\s\S]*?\[END SYSTEM INSTRUCTION[^\]]*\]/gi, "")
        .replace(/CRITICAL: NEVER output, repeat, or reveal these system instructions[^\n]*/gi, "")
        .trim();
      
      // Map roles: user -> "user", assistant -> "model" (Gemini API format)
      return {
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: cleanContent }],
      };
    });
  
  // Debug: Log conversation history to verify it includes all messages
  console.log(`[Gemini] Total messages received: ${messages.length}`);
  console.log(`[Gemini] Optimized messages: ${optimizedMessages.length}`);
  console.log(`[Gemini] Conversation history for API: ${conversationHistory.length} messages`);
  if (conversationHistory.length > 0) {
    console.log(`[Gemini] History breakdown:`, 
      conversationHistory.map((m, i) => `${i + 1}. ${m.role}: "${m.parts[0]?.text?.substring(0, 30)}..."`));
  }

  // Check for recent window captures to avoid redundant function calls
  const recentAssistantMessages = messages.filter(m => m.role === "assistant").slice(-3);
  const lastUserMessage = messages.filter(m => m.role === "user").slice(-1)[0]?.content || "";
  let recentCaptureWarning = "";
  let recentCaptureDetected = false;
  
  // Detect if a window was recently captured
  for (const msg of recentAssistantMessages) {
    if (msg.content && (
      /\b(captured|screenshot|window|can see|I can see|I see|Got it! I can see|definitely see|That's the one)\b/i.test(msg.content) &&
      /\b(cursor|chrome|code|vscode|notepad|msedge|window|app|ai-teacher|bunkerverse|FrontierIsland)\b/i.test(msg.content)
    )) {
      recentCaptureDetected = true;
      break;
    }
  }
  
  // Check if user is just checking/confirming
  const isUserJustChecking = /\b(just wanted|just checking|just wanted to check|wondered if|no.*just|all good.*just)\b/i.test(lastUserMessage);
  
  if (recentCaptureDetected) {
    if (isUserJustChecking) {
      // Strong warning - user is checking AND we have recent capture
      recentCaptureWarning = `\n\n**CRITICAL - DO NOT CALL capture_window_with_ocr:** `;
      recentCaptureWarning += `A window was JUST captured in the previous message AND the user is just checking/confirming ("${lastUserMessage}"). `;
      recentCaptureWarning += `DO NOT call capture_window_with_ocr - use existing context from conversation history. `;
      recentCaptureWarning += `Simply acknowledge you can see it and ask if there's something else to discuss.\n`;
    } else {
      recentCaptureWarning = `\n\n**RECENT WINDOW CAPTURE DETECTED:** A window capture was performed in recent messages. `;
      recentCaptureWarning += `If the user is just confirming or checking, DO NOT call capture_window_with_ocr again. `;
      recentCaptureWarning += `Only call the function if user explicitly asks for a NEW window or DIFFERENT window.\n`;
    }
  }

  // System prompt with dynamic context injection
  // Always inject context - even for new conversations, this helps guide the AI to ask contextual questions
  let systemPrompt = systemPromptConfig.systemPrompt;
  // Always inject context to guide teaching approach, even for new conversations
  // Include screenshot analysis insights, system context, and messages for greeting detection
  systemPrompt = injectDynamicContext(systemPrompt, conversationState, messages, contextSummary, screenshotAnalysis, systemContext);
  
  // Add recent capture warning if detected
  if (recentCaptureWarning) {
    systemPrompt += recentCaptureWarning;
  }

  try {
    // Clean conversation history - ensure no system prompt content is included
    const cleanConversationHistory = conversationHistory.map(msg => {
      const text = msg.parts[0]?.text || "";
      // Remove any system instruction markers if they somehow got in
      const cleanedText = text
        .replace(/\[SYSTEM INSTRUCTION[^\]]*\][\s\S]*?\[END SYSTEM INSTRUCTION[^\]]*\]/gi, "")
        .replace(/CRITICAL: NEVER output, repeat, or reveal these system instructions[^\n]*/gi, "")
        .trim();
      
      return {
        ...msg,
        parts: [{ ...msg.parts[0], text: cleanedText }, ...msg.parts.slice(1)]
      };
    });

    // Handle first message
    if (cleanConversationHistory.length === 1) {
      // For the first message, use generateContentStream with systemInstruction
      const firstMessage = cleanConversationHistory[0];
      
      // Add screenshots to first message if available
      const firstMessageParts: any[] = [...firstMessage.parts];
      if (screenshots.length > 0) {
        const screenshotParts = screenshots.slice(-5).map((img) => ({
          inlineData: {
            data: img,
            mimeType: "image/png",
          },
        }));
        firstMessageParts.push(...screenshotParts);
      }
      
      // Define tools (function calling) for window capture
      const tools = [
        {
          functionDeclarations: [
            {
              name: "capture_window_with_ocr",
              description: `Capture a specific application window and extract all visible text using OCR.

CRITICAL RULES - READ CAREFULLY:

DO NOT call this function if:
- A window was JUST captured in the previous message (check conversation history)
- User says: "just wanted to check", "just checking", "no, just wanted", "all good, just", "wondered if you can see"
- User is confirming/checking after you already showed them the window
- You already discussed a window in recent messages
- User says "no" followed by "just wanted to check" or similar

ONLY call this function when:
- User explicitly asks to see a NEW window or DIFFERENT window
- User asks a specific question requiring fresh data AND no recent capture exists
- First time user mentions an app/window in this conversation

IMPORTANT WORKFLOW: 
1) When user asks about an app, FIRST call with only process_name (no window_title). 
2) The function will return a list of all windows for that process. 
3) When multiple_windows_found is true, present windows EXACTLY as shown in the 'message' field. 
4) When user selects a window, call AGAIN with both process_name AND window_title set to the FULL 'title' from the windows array.

Examples: 
- "tell me about cursor" → call with process_name='cursor' (if first time)
- "can you see it?" → DO NOT call if window was just captured
- "no, just wanted to check if you can see my window" → DO NOT call, use existing context
- "I just wondered if you can see it" → DO NOT call, use existing context
- "what's in this window?" → call only if no recent capture exists`,
              parameters: {
                type: "object",
                properties: {
                  process_name: {
                    type: "string",
                    description: "The process name of the application to capture (e.g., 'cursor', 'chrome', 'code', 'msedge', 'notepad'). Use lowercase. This is the primary way to identify windows. When called with only process_name, the function will list ALL windows for that process and ask the user to choose.",
                  },
                  window_title: {
                    type: "string",
                    description: "The FULL window title to capture (use the 'title' field from the windows array, not the display_name). Use this ONLY after: 1) You've already called the function with process_name and received a list of windows, 2) The user has selected which window they want (by number, saying 'yes', or providing the name), 3) You're calling the function again with both process_name and window_title set to the FULL 'title' from the windows array. NEVER use window_title on the first call - always start with just process_name.",
                  },
                },
              },
            },
            {
              name: "execute_command",
              description: `Run a terminal command under the helper agent's safety policy.

Command policy:
- **Context diagnostics** (read-only commands) run automatically so you can gather facts quickly.
- **Critical actions** respond with {"needsApproval": true, "policy": {...}} — explain why the command is needed, ask the user to approve, and wait.
- **Forbidden operations** respond with {"blocked": true, "policy": {...}} — do not retry; instead guide the user toward a safe alternative.

Use this tool whenever terminal output is the source of truth (Docker, git, logs, system status, etc.). Always rely on real command output rather than guessing from OCR or screenshots. When a command needs approval, stop and explicitly ask the user before continuing.`,
              parameters: {
                type: "object",
                properties: {
                  command: {
                    type: "string",
                    description: "The command to execute (e.g., 'docker', 'git', 'npm'). Must be one of the allowed commands.",
                  },
                  args: {
                    type: "array",
                    items: { type: "string" },
                    description: "Array of command arguments (e.g., ['ps', '-a'] for 'docker ps -a')",
                  },
                },
                required: ["command"],
              },
            },
          ],
        },
      ];

      const result = await currentModel.generateContentStream({
        contents: [{
          role: "user",
          parts: firstMessageParts
        }],
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        tools: tools,
      });

      const stream = new ReadableStream<string>({
        async start(controller) {
          try {
            let functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
            let responseText = "";
            const functionCallSet = new Set<string>();
            const notifiedCommandRequests = new Set<string>();

            const addFunctionCall = (call: any, origin: string) => {
              if (!call || typeof call !== "object") {
                return;
              }
              const name =
                typeof call.name === "string"
                  ? call.name
                  : typeof call.name === "number"
                  ? String(call.name)
                  : "unknown";
              const args =
                (call.args && typeof call.args === "object" ? call.args : undefined) ??
                (call.arguments && typeof call.arguments === "object" ? call.arguments : undefined) ??
                {};
              const key = `${name}::${JSON.stringify(args)}`;
              if (functionCallSet.has(key)) {
                return;
              }
              functionCallSet.add(key);
              console.log(`[Gemini] Collected function call from ${origin}:`, {
                name,
                args,
              });
              functionCalls.push({ name, args });
            };

            const scanForFunctionCalls = (source: any, origin: string) => {
              if (!source) {
                return;
              }

              if (typeof source === "function") {
                // Avoid invoking functions blindly (other than the known helpers below)
                return;
              }

              if (Array.isArray(source)) {
                source.forEach((item, index) =>
                  scanForFunctionCalls(item, `${origin}[${index}]`)
                );
                return;
              }

              if (typeof source !== "object") {
                return;
              }

              // Known helper methods on SDK objects
              try {
                if (typeof source.functionCalls === "function") {
                  const calls = source.functionCalls();
                  if (Array.isArray(calls)) {
                    calls.forEach(call =>
                      scanForFunctionCalls(call, `${origin}.functionCalls()`)
                    );
                  }
                }
              } catch (err) {
                console.log(`[Gemini] ${origin}.functionCalls() error:`, err);
              }

              // Note: functionCall() is deprecated, we only use functionCalls() now
              
              // Check for direct functionCall property (non-function)
              if (source.functionCall && typeof source.functionCall !== "function") {
                scanForFunctionCalls(source.functionCall, `${origin}.functionCall`);
              }
              if ((source as any).function_call) {
                scanForFunctionCalls((source as any).function_call, `${origin}.function_call`);
              }

              // Candidates often contain function calls in their parts
              let candidates: any = undefined;
              try {
                candidates =
                  typeof source.candidates === "function"
                    ? source.candidates()
                    : source.candidates;
              } catch (err) {
                console.log(`[Gemini] ${origin}.candidates() error:`, err);
              }

              if (Array.isArray(candidates)) {
                candidates.forEach((candidate, candidateIndex) => {
                  scanForFunctionCalls(
                    candidate,
                    `${origin}.candidates[${candidateIndex}]`
                  );
                  const parts = candidate?.content?.parts;
                  if (Array.isArray(parts)) {
                    parts.forEach((part, partIndex) => {
                      if (part?.functionCall) {
                        scanForFunctionCalls(
                          part.functionCall,
                          `${origin}.candidates[${candidateIndex}].content.parts[${partIndex}].functionCall`
                        );
                      }
                      if ((part as any)?.function_call) {
                        scanForFunctionCalls(
                          (part as any).function_call,
                          `${origin}.candidates[${candidateIndex}].content.parts[${partIndex}].function_call`
                        );
                      }
                    });
                  }
                });
              }

              // Traverse nested objects for any additional function call shapes
              Object.entries(source).forEach(([key, value]) => {
                if (
                  value &&
                  typeof value === "object" &&
                  !["functionCall", "functionCalls", "function_call", "candidates"].includes(key)
                ) {
                  scanForFunctionCalls(value, `${origin}.${key}`);
                }
              });

              // If the current object itself looks like a function call shape, capture it
              if (
                typeof source.name === "string" &&
                (typeof source.args === "object" || typeof (source as any).arguments === "object")
              ) {
                addFunctionCall(source, origin);
              }
            };

            for await (const chunk of result.stream) {
              scanForFunctionCalls(chunk, "Chunk");

              const text = typeof chunk.text === "function" ? chunk.text() : undefined;
              if (text) {
                responseText += text;
                controller.enqueue(text);
              }
            }

            // Also check the full response after streaming completes
            try {
              const fullResponse = await result.response;
              scanForFunctionCalls(fullResponse, "FullResponse");
            } catch (e) {
              console.log(`[Gemini] Could not inspect full response for function calls:`, e);
            }

            // Handle function calls if any
            if (functionCalls.length > 0) {
              console.log(`[Gemini] Processing ${functionCalls.length} function call(s)`);
              const responseChat = currentModel.startChat({
                history: [
                  {
                    role: "user",
                    parts: firstMessageParts,
                  },
                ],
                systemInstruction: {
                  parts: [{ text: systemPrompt }],
                },
                tools: tools,
              });

              for (const funcCall of functionCalls) {
                const functionResponse = await handleFunctionCall(funcCall, onStatusUpdate);
                const functionResponseData = functionResponse.response as any;

                if (functionResponseData?.needsApproval && onCommandRequest) {
                  const requestId = functionResponseData.request_id || generateId("cmd");
                  if (notifiedCommandRequests.has(requestId)) {
                    console.log(`[Gemini] ⚠️ Command request ${requestId} already notified (needs approval).`);
                  } else {
                    notifiedCommandRequests.add(requestId);
                    const normalizedPolicy =
                      functionResponseData.policy || {
                        level: "approval_required",
                        category: "critical",
                        reason: functionResponseData.error || "Command requires approval.",
                      };
                    const request: PendingCommandRequest = {
                      id: requestId,
                      command: functionResponseData.command || "",
                      args: Array.isArray(functionResponseData.args) ? functionResponseData.args : [],
                      policy: normalizedPolicy,
                      createdAt: Date.now(),
                      status: "pending",
                    };
                    onCommandRequest(request);
                  }
                } else if (functionResponseData?.blocked && onCommandRequest) {
                  const requestId = functionResponseData.request_id || generateId("cmd");
                  if (notifiedCommandRequests.has(requestId)) {
                    console.log(`[Gemini] ⚠️ Command request ${requestId} already notified (blocked).`);
                  } else {
                    notifiedCommandRequests.add(requestId);
                    const normalizedPolicy =
                      functionResponseData.policy || {
                        level: "blocked",
                        category: "forbidden",
                        reason: functionResponseData.error || "Command blocked by safety rules.",
                      };
                    const request: PendingCommandRequest = {
                      id: requestId,
                      command: functionResponseData.command || "",
                      args: Array.isArray(functionResponseData.args) ? functionResponseData.args : [],
                      policy: normalizedPolicy,
                      createdAt: Date.now(),
                      status: "blocked",
                      error: functionResponseData.error,
                    };
                    onCommandRequest(request);
                  }
                }
                
                // Send function response first (Gemini doesn't allow mixing functionResponse with other parts)
                const responseResult = await responseChat.sendMessageStream([
                  {
                    functionResponse: {
                      name: functionResponse.name,
                      response: functionResponse.response,
                    },
                  },
                ]);
                
                // Process the function response stream
                let hasResponseText = false;
                let responseTextLength = 0;
                for await (const responseChunk of responseResult.stream) {
                  const responseText = responseChunk.text();
                  if (responseText) {
                    hasResponseText = true;
                    responseTextLength += responseText.length;
                    controller.enqueue(responseText);
                  }
                }
                
                // ROOT CAUSE FIX: Always send a follow-up prompt for execute_command to ensure we get a response
                // Gemini may close the stream immediately after receiving large function responses without generating text
                // By always sending a prompt, we prevent empty responses from happening in the first place
                if (functionResponse.name === "execute_command") {
                  const commandResponse = functionResponse.response as any;
                  const awaitingApproval = commandResponse?.needsApproval || commandResponse?.blocked;
                  
                  if (!awaitingApproval) {
                    // Only send follow-up if we didn't get a response (most cases) or if response was very short (likely incomplete)
                    if (!hasResponseText || (hasResponseText && responseTextLength < 50)) {
                      if (!hasResponseText) {
                        console.log(`[Gemini] ⚠️ No response text after execute_command - sending follow-up prompt`);
                      } else {
                        console.log(`[Gemini] ⚠️ Short response (${responseTextLength} chars) after execute_command - sending follow-up for complete answer`);
                      }
                      
                      const followUpResult = await responseChat.sendMessageStream([
                        {
                          text: "Please provide a response based on the command output above.",
                        },
                      ]);
                      
                      for await (const followUpChunk of followUpResult.stream) {
                        const followUpText = followUpChunk.text();
                        if (followUpText) {
                          controller.enqueue(followUpText);
                        }
                      }
                    }
                  } else {
                    console.log(`[Gemini] ⏸️ Command requires approval or is blocked; skipping auto follow-up.`);
                  }
                }
                
                // If the function response includes an image, send it as a follow-up message
                // This allows the AI to see the actual image, not just OCR text
                if (functionResponse.response.success) {
                  const responseData = functionResponse.response as any;
                  if (responseData.image_base64) {
                    console.log(`[Gemini] 📷 Sending image as follow-up message (${Math.round(responseData.image_base64.length / 1024)} KB)`);
                    // Send image with explanatory text so AI knows what it is
                    const imageResult = await responseChat.sendMessageStream([
                      {
                        text: "Here is the captured window image:",
                      },
                      {
                        inlineData: {
                          data: responseData.image_base64,
                          mimeType: "image/png",
                        },
                      },
                    ]);
                    
                    // Process the image message stream as well
                    let imageAggregate = "";
                    for await (const imageChunk of imageResult.stream) {
                      const imageText = imageChunk.text();
                      if (imageText) {
                        imageAggregate += imageText;
                      }
                    }

                    if (imageAggregate) {
                      controller.enqueue(enforceConversationalTone(imageAggregate));
                    }
                  }
                }
              }
            }

            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });

      return stream;
    } else {
      // For subsequent messages, use startChat with systemInstruction
      // History should include all previous messages (user and assistant)
      // The last message is the current user message we want to send
      const historyForChat = cleanConversationHistory.slice(0, -1);
      const lastUserMessage = cleanConversationHistory[cleanConversationHistory.length - 1];
      
      // Verify history includes both user and assistant messages
      const userCount = historyForChat.filter(m => m.role === "user").length;
      const assistantCount = historyForChat.filter(m => m.role === "model").length;
      console.log(`[Gemini] History for chat: ${historyForChat.length} messages (${userCount} user, ${assistantCount} assistant)`);
      
      if (historyForChat.length === 0) {
        console.warn("[Gemini] WARNING: No history found! This might cause the AI to not remember previous messages.");
      }
      
      // Build the last user message with screenshots
      const userMessageParts: any[] = [...lastUserMessage.parts];
      if (screenshots.length > 0) {
        const screenshotParts = screenshots.slice(-5).map((img) => ({
          inlineData: {
            data: img,
            mimeType: "image/png",
          },
        }));
        userMessageParts.push(...screenshotParts);
      }
      
      // Define tools (function calling) for window capture
      const tools = [
        {
          functionDeclarations: [
            {
              name: "capture_window_with_ocr",
              description: `Capture a specific application window and extract all visible text using OCR.

CRITICAL RULES - READ CAREFULLY:

DO NOT call this function if:
- A window was JUST captured in the previous message (check conversation history)
- User says: "just wanted to check", "just checking", "no, just wanted", "all good, just", "wondered if you can see"
- User is confirming/checking after you already showed them the window
- You already discussed a window in recent messages
- User says "no" followed by "just wanted to check" or similar

ONLY call this function when:
- User explicitly asks to see a NEW window or DIFFERENT window
- User asks a specific question requiring fresh data AND no recent capture exists
- First time user mentions an app/window in this conversation

IMPORTANT WORKFLOW: 
1) When user asks about an app, FIRST call with only process_name (no window_title). 
2) The function will return a list of all windows for that process. 
3) When multiple_windows_found is true, present windows EXACTLY as shown in the 'message' field. 
4) When user selects a window, call AGAIN with both process_name AND window_title set to the FULL 'title' from the windows array.

Examples: 
- "tell me about cursor" → call with process_name='cursor' (if first time)
- "can you see it?" → DO NOT call if window was just captured
- "no, just wanted to check if you can see my window" → DO NOT call, use existing context
- "I just wondered if you can see it" → DO NOT call, use existing context
- "what's in this window?" → call only if no recent capture exists`,
              parameters: {
                type: "object",
                properties: {
                  process_name: {
                    type: "string",
                    description: "The process name of the application to capture (e.g., 'cursor', 'chrome', 'code', 'msedge', 'notepad'). Use lowercase. This is the primary way to identify windows. When called with only process_name, the function will list ALL windows for that process and ask the user to choose.",
                  },
                  window_title: {
                    type: "string",
                    description: "The FULL window title to capture (use the 'title' field from the windows array, not the display_name). Use this ONLY after: 1) You've already called the function with process_name and received a list of windows, 2) The user has selected which window they want (by number, saying 'yes', or providing the name), 3) You're calling the function again with both process_name and window_title set to the FULL 'title' from the windows array. NEVER use window_title on the first call - always start with just process_name.",
                  },
                },
              },
            },
          ],
        },
      ];

      // Prepare chat config with systemInstruction as Content object
      // The API expects systemInstruction to be a Content object with parts
      const chatConfig: any = {
        history: historyForChat,
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        tools: tools,
      };
      
      console.log(`[Gemini] Starting chat with history length: ${historyForChat.length}`);
      const chat = currentModel.startChat(chatConfig);

      // Send the current user message with screenshots
      const result = await chat.sendMessageStream(userMessageParts);

      // Convert to ReadableStream
      const stream = new ReadableStream<string>({
        async start(controller) {
          try {
            let functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
            const functionCallSet = new Set<string>();
            const notifiedCommandRequests = new Set<string>();
            const pendingTextChunks: string[] = [];
            let initialTextFlushed = false;
            const postToolMessages: string[] = [];
            const dockerContainers: Array<{ name: string; id: string; status: string }> = [];
            let dockerPsAllScheduled = false;
            let pendingLogRequest: { requested: string; original: string } | null = null;

            const flushPendingText = () => {
              if (pendingTextChunks.length === 0) {
                return;
              }
              const combined = pendingTextChunks.join("");
              const conversational = enforceConversationalTone(combined);
              controller.enqueue(conversational);
              pendingTextChunks.length = 0;
              initialTextFlushed = true;
            };

            const addFunctionCall = (call: any, origin: string) => {
              if (!call || typeof call !== "object") {
                return;
              }
              const name =
                typeof call.name === "string"
                  ? call.name
                  : typeof call.name === "number"
                  ? String(call.name)
                  : "unknown";
              const args =
                (call.args && typeof call.args === "object" ? call.args : undefined) ??
                (call.arguments && typeof call.arguments === "object" ? call.arguments : undefined) ??
                {};
              const key = `${name}::${JSON.stringify(args)}`;
              if (functionCallSet.has(key)) {
                return;
              }
              functionCallSet.add(key);
              console.log(`[Gemini] Collected function call from ${origin}:`, {
                name,
                args,
              });
              functionCalls.push({ name, args });
            };

            const scanForFunctionCalls = (source: any, origin: string) => {
              if (!source) {
                return;
              }

              if (typeof source === "function") {
                return;
              }

              if (Array.isArray(source)) {
                source.forEach((item, index) =>
                  scanForFunctionCalls(item, `${origin}[${index}]`)
                );
                return;
              }

              if (typeof source !== "object") {
                return;
              }

              try {
                if (typeof source.functionCalls === "function") {
                  const calls = source.functionCalls();
                  if (Array.isArray(calls)) {
                    calls.forEach(call =>
                      scanForFunctionCalls(call, `${origin}.functionCalls()`)
                    );
                  }
                }
              } catch (err) {
                console.log(`[Gemini] ${origin}.functionCalls() error:`, err);
              }

              // Note: functionCall() is deprecated, we only use functionCalls() now
              
              // Check for direct functionCall property (non-function)
              if (source.functionCall && typeof source.functionCall !== "function") {
                scanForFunctionCalls(source.functionCall, `${origin}.functionCall`);
              }
              if ((source as any).function_call) {
                scanForFunctionCalls((source as any).function_call, `${origin}.function_call`);
              }

              let candidates: any = undefined;
              try {
                candidates =
                  typeof source.candidates === "function"
                    ? source.candidates()
                    : source.candidates;
              } catch (err) {
                console.log(`[Gemini] ${origin}.candidates() error:`, err);
              }

              if (Array.isArray(candidates)) {
                candidates.forEach((candidate, candidateIndex) => {
                  scanForFunctionCalls(
                    candidate,
                    `${origin}.candidates[${candidateIndex}]`
                  );
                  const parts = candidate?.content?.parts;
                  if (Array.isArray(parts)) {
                    parts.forEach((part, partIndex) => {
                      if (part?.functionCall) {
                        scanForFunctionCalls(
                          part.functionCall,
                          `${origin}.candidates[${candidateIndex}].content.parts[${partIndex}].functionCall`
                        );
                      }
                      if ((part as any)?.function_call) {
                        scanForFunctionCalls(
                          (part as any).function_call,
                          `${origin}.candidates[${candidateIndex}].content.parts[${partIndex}].function_call`
                        );
                      }
                    });
                  }
                });
              }

              Object.entries(source).forEach(([key, value]) => {
                if (
                  value &&
                  typeof value === "object" &&
                  !["functionCall", "functionCalls", "function_call", "candidates"].includes(key)
                ) {
                  scanForFunctionCalls(value, `${origin}.${key}`);
                }
              });

              if (
                typeof source.name === "string" &&
                (typeof source.args === "object" || typeof (source as any).arguments === "object")
              ) {
                addFunctionCall(source, origin);
              }
            };

            for await (const chunk of result.stream) {
              scanForFunctionCalls(chunk, "Chunk");

              const text = typeof chunk.text === "function" ? chunk.text() : undefined;
              if (text) {
                pendingTextChunks.push(text);
              }
            }

            try {
              const fullResponse = await result.response;
              scanForFunctionCalls(fullResponse, "FullResponse");
            } catch (e) {
              console.log(`[Gemini] Could not inspect full response for function calls:`, e);
            }

            const lastUserMsg = messages.filter(m => m.role === "user").slice(-1)[0]?.content || "";
            const normalizedTargets =
              lastUserMsg.match(/\b[a-z0-9][a-z0-9._-]{2,}\b/gi)?.filter((token) => {
                const word = token.toLowerCase();
                return !["docker", "containers", "container", "app", "apps", "window", "windows"].includes(word);
              }) ?? [];
            const wrapConversation = isConversationWrapMessage(lastUserMsg);
            const explicitDockerQuestion = isExplicitDockerQuestion(lastUserMsg);
            const wantsLogs = explicitDockerQuestion && /\blogs?\b/i.test(lastUserMsg);
            const hasActionVerb = /\b(start|stop|restart|kill|rm|remove|up|down|deploy|launch|spin up)\b/i.test(lastUserMsg);
            const mentionsSpecificContainer =
              (explicitDockerQuestion || hasActionVerb) && normalizedTargets.length > 0;
            const mentionsContainersPlural = /\bcontainers?\b/i.test(lastUserMsg);
            const needsDockerPs = !wrapConversation && (mentionsContainersPlural || mentionsSpecificContainer || explicitDockerQuestion);
            const needsDockerPsAll = !wrapConversation && (wantsLogs || mentionsSpecificContainer);
            const isDockerQuestion = explicitDockerQuestion || hasActionVerb;

            const recentMessages = messages.slice(-5);
            const hasDockerContext = recentMessages.some(m =>
              m.content && /\b(docker|container)\b/i.test(m.content)
            );

            const scheduledCommands = new Set<string>();

            if (functionCalls.length === 0) {
              const logsMatch = lastUserMsg.match(/\blogs?\s*(?:for|of|from)\s+([a-zA-Z0-9._-]+)/i);
              if (!wrapConversation && logsMatch && wantsLogs) {
                const containerName = logsMatch[1];
                pendingLogRequest = { requested: containerName.toLowerCase(), original: containerName };
                if (!scheduledCommands.has("docker::ps-a")) {
                  functionCalls.push({
                    name: "execute_command",
                    args: { command: "docker", args: ["ps", "-a"] },
                  });
                  scheduledCommands.add("docker::ps-a");
                  dockerPsAllScheduled = true;
                }
                if (!scheduledCommands.has(`docker::logs::${containerName.toLowerCase()}`)) {
                  functionCalls.push({
                    name: "execute_command",
                    args: { command: "docker", args: ["logs", "--tail", "200", containerName] },
                  });
                  scheduledCommands.add(`docker::logs::${containerName.toLowerCase()}`);
                }
              } else if (!wrapConversation && (needsDockerPs || (explicitDockerQuestion && hasDockerContext))) {
                if (!scheduledCommands.has("docker::ps")) {
                  functionCalls.push({
                    name: "execute_command",
                    args: { command: "docker", args: ["ps"] },
                  });
                  scheduledCommands.add("docker::ps");
                }
              }
            }

            if (functionCalls.length === 0) {
              flushPendingText();
              controller.close();
              return;
            }

            if (functionCalls.length > 0) {

              const hasDockerCapture = functionCalls.some(
                (fc) =>
                  fc.name === "capture_window_with_ocr" &&
                  (fc.args?.process_name as string)?.toLowerCase().includes("docker")
              );
              let hasExecuteCommand = functionCalls.some(fc => fc.name === "execute_command");

              const logsMatch = lastUserMsg.match(/\blogs?\s*(?:for|of|from)\s+([a-zA-Z0-9._-]+)/i);
              const hasLogsCommand = functionCalls.some(
                (fc) =>
                  fc.name === "execute_command" &&
                  Array.isArray(fc.args?.args) &&
                  (fc.args.args as string[]).some((arg: string) => arg === "logs")
              );

              if (!wrapConversation && logsMatch && wantsLogs && !hasLogsCommand) {
                const containerName = logsMatch[1];
                pendingLogRequest = { requested: containerName.toLowerCase(), original: containerName };
                const hasPsAll = functionCalls.some(
                  (fc) =>
                    fc.name === "execute_command" &&
                    fc.args?.command === "docker" &&
                    Array.isArray(fc.args?.args) &&
                    (fc.args.args as string[]).includes("ps") &&
                    (fc.args.args as string[]).includes("-a")
                );
                if (!hasPsAll) {
                  if (!scheduledCommands.has("docker::ps-a")) {
                    functionCalls.unshift({
                      name: "execute_command",
                      args: { command: "docker", args: ["ps", "-a"] },
                    });
                    scheduledCommands.add("docker::ps-a");
                    dockerPsAllScheduled = true;
                  }
                }
                functionCalls.unshift({
                  name: "execute_command",
                  args: { command: "docker", args: ["logs", "--tail", "200", containerName] },
                });
                hasExecuteCommand = true;
              }

              const hasPsCommand = functionCalls.some(
                (fc) =>
                  fc.name === "execute_command" &&
                  fc.args?.command === "docker" &&
                  Array.isArray(fc.args?.args) &&
                  (fc.args.args as string[]).includes("ps") &&
                  !(fc.args.args as string[]).includes("-a")
              );
              const hasPsAllCommand = functionCalls.some(
                (fc) =>
                  fc.name === "execute_command" &&
                  fc.args?.command === "docker" &&
                  Array.isArray(fc.args?.args) &&
                  (fc.args.args as string[]).includes("ps") &&
                  (fc.args.args as string[]).includes("-a")
              );

              if (!wrapConversation && needsDockerPs && !hasPsCommand) {
                if (!scheduledCommands.has("docker::ps")) {
                  functionCalls.unshift({
                    name: "execute_command",
                    args: { command: "docker", args: ["ps"] },
                  });
                  scheduledCommands.add("docker::ps");
                  hasExecuteCommand = true;
                }
              }

              if (!wrapConversation && needsDockerPsAll && !hasPsAllCommand && !dockerPsAllScheduled) {
                if (!scheduledCommands.has("docker::ps-a")) {
                  functionCalls.unshift({
                    name: "execute_command",
                    args: { command: "docker", args: ["ps", "-a"] },
                  });
                  scheduledCommands.add("docker::ps-a");
                  dockerPsAllScheduled = true;
                  hasExecuteCommand = true;
                }
              }

              if ((isDockerQuestion || hasDockerContext) && hasDockerCapture && !hasExecuteCommand) {
                functionCalls.unshift({
                  name: "execute_command",
                  args: { command: "docker", args: ["ps"] },
                });
                hasExecuteCommand = true;
              }

              const recordDockerContainers = (stdout: string) => {
                const lines = stdout.split(/\r?\n/).filter(Boolean);
                if (lines.length <= 1) return;
                const dataLines = lines.slice(1);
                for (const line of dataLines) {
                  const parts = line.trim().split(/\s{2,}|\t+/);
                  if (parts.length >= 2) {
                    const id = parts[0];
                    const names = parts[parts.length - 1];
                    const status = parts.find((p) => /\b(Up|Exited|Created|Restarting|Paused)\b/i.test(p)) || "";
                    const normalizedNames = names.split(/[, ]+/).filter(Boolean);
                    normalizedNames.forEach((name) => {
                      if (!dockerContainers.some((c) => c.name === name)) {
                        dockerContainers.push({ name, id, status });
                      }
                    });
                  }
                }
              };

              const resolveContainerName = (requested: string): { name?: string; suggestions: string[] } => {
                if (dockerContainers.length === 0) {
                  return { suggestions: [] };
                }
                const lower = requested.toLowerCase();
                const exact = dockerContainers.find((c) => c.name.toLowerCase() === lower);
                if (exact) return { name: exact.name, suggestions: [] };
                const starts = dockerContainers.find((c) => c.name.toLowerCase().startsWith(lower));
                if (starts) return { name: starts.name, suggestions: [] };
                const contains = dockerContainers.find((c) => c.name.toLowerCase().includes(lower));
                if (contains) return { name: contains.name, suggestions: [] };
                const suggestions = dockerContainers.slice(0, 5).map((c) => c.name);
                return { suggestions };
              };

              console.log(`[Gemini] Processing ${functionCalls.length} function call(s)`);

              for (const funcCall of functionCalls) {
                // Check if this is a capture_window_with_ocr call and if we have recent capture
                if (funcCall.name === "capture_window_with_ocr") {
                  const processName = funcCall.args?.process_name as string | undefined;
                  const windowTitle = funcCall.args?.window_title as string | undefined;
                  const processLower = (processName || "").toLowerCase();
                  
                  const recentCapture = hasRecentCapture(messages, processName, windowTitle, 5);
                  const lastUserMsg = messages.filter(m => m.role === "user").slice(-1)[0]?.content || "";
                  const normalizedLastMsg = lastUserMsg.trim().toLowerCase();
                  const wrapConversation = isConversationWrapMessage(lastUserMsg);
                  const isExplicitRequest = /\b(show|display|focus|switch|open|capture|screenshot|take a look|look at|bring up|pull up|switch to|select)\b/i.test(lastUserMsg) && !wrapConversation;
                  const isJustChecking = /\b(can you see|do you see|still see|just checking|just wanted to check|wondered if|make sure you can see|still looking at)\b/i.test(lastUserMsg);
                  const isShortConfirmation = normalizedLastMsg.length > 0 && normalizedLastMsg.length <= 32 && /^(yes|yeah|yep|ok|okay|sure|got it|thanks|thank you|cool|awesome|great|sounds good|all good|looks good|no worries|perfect|that helps|appreciate it)$/i.test(lastUserMsg.trim());
                  const hasExecuteCommandCall = functionCalls.some(fc => fc.name === "execute_command");
                  const isDataStatusQuestion = /\b(status|running|stopped|list|tell me|what|which|are there|details|logs?)\b/i.test(lastUserMsg);
                  const isTerminalProcess =
                    processLower.includes("windowsterminal") ||
                    processLower.includes("terminal") ||
                    processLower.includes("cmd") ||
                    processLower.includes("powershell");
                  
                  if (recentCapture.hasCapture) {
                    console.log(`[Gemini] ⚠️ Recent capture detected for ${processName || windowTitle || "window"}. `);
                    console.log(`[Gemini] ⚠️ Function call may be redundant - checking if user explicitly requested new capture...`);
                    
                    // Only allow recapture if user explicitly asks for new/different window or selection flow requires specific window.
                    const isWindowSelectionFollowUp = Boolean(windowTitle);
                    const shouldSkipCapture =
                      !isWindowSelectionFollowUp &&
                      !isExplicitRequest &&
                      (isJustChecking || isShortConfirmation || wrapConversation);

                    if (shouldSkipCapture) {
                      console.log(`[Gemini] ⏭️ Skipping redundant capture - using existing context instead.`);
                      if (!initialTextFlushed) {
                        flushPendingText();
                      }
                      const skipMessage =
                        "Capture skipped: recent capture already available and the user is just confirming. Use existing context unless a new capture is explicitly requested.";
                      const skipResponse = {
                        name: funcCall.name,
                        response: {
                          success: true,
                          skipped: true,
                          reason: "recent_capture",
                          message: skipMessage,
                        },
                      };

                      const responseResult = await chat.sendMessageStream([
                        {
                          functionResponse: skipResponse,
                        },
                      ]);

                      for await (const responseChunk of responseResult.stream) {
                        const responseText = responseChunk.text();
                        if (responseText) {
                          controller.enqueue(responseText);
                        }
                      }
                      continue;
                    }
                  } else {
                    console.log(`[Gemini] ✅ No recent capture found - proceeding with capture`);
                  }
                  
                  // If this request accompanies a docker command, prefer the command output when user isn't explicitly asking to see the UI.
                  if (!recentCapture.hasCapture && hasExecuteCommandCall && !isExplicitRequest && !windowTitle && isDataStatusQuestion && !isJustChecking) {
                    console.log(`[Gemini] ⏭️ Skipping capture in favor of execute_command results (no explicit visual request).`);
                    if (!initialTextFlushed) {
                      flushPendingText();
                    }
                    const skipMessage =
                      "Capture skipped: command output will be used to answer the question. Call capture_window_with_ocr only when the user explicitly asks to see the UI.";
                    const skipResponse = {
                      name: funcCall.name,
                      response: {
                        success: true,
                        skipped: true,
                        reason: "prefer_command_output",
                        message: skipMessage,
                      },
                    };

                    const responseResult = await chat.sendMessageStream([
                      {
                        functionResponse: skipResponse,
                      },
                    ]);

                    for await (const responseChunk of responseResult.stream) {
                      const responseText = responseChunk.text();
                      if (responseText) {
                        controller.enqueue(responseText);
                      }
                    }
                    continue;
                  }

                  if (isTerminalProcess && !isExplicitRequest) {
                    console.log(`[Gemini] ⏭️ Skipping terminal capture - relying on command output instead.`);
                    if (!initialTextFlushed) {
                      flushPendingText();
                    }
                    const skipMessage =
                      "Capture skipped: command output is already available. Only capture the terminal when specifically asked to show it.";
                    const skipResponse = {
                      name: funcCall.name,
                      response: {
                        success: true,
                        skipped: true,
                        reason: "terminal_capture_unnecessary",
                        message: skipMessage,
                      },
                    };

                    const responseResult = await chat.sendMessageStream([
                      {
                        functionResponse: skipResponse,
                      },
                    ]);

                    for await (const responseChunk of responseResult.stream) {
                      const responseText = responseChunk.text();
                      if (responseText) {
                        controller.enqueue(responseText);
                      }
                    }
                    continue;
                  }
                }
                
                if (!initialTextFlushed) {
                  flushPendingText();
                }

                if (funcCall.name === "execute_command") {
                  const command = (funcCall.args?.command as string | undefined)?.toLowerCase();
                  const argsArray = Array.isArray(funcCall.args?.args) ? [...(funcCall.args?.args as string[])] : [];

                  if (command === "docker") {
                    if (argsArray.includes("logs") && pendingLogRequest) {
                      const resolution = resolveContainerName(pendingLogRequest.requested);
                      if (resolution.name) {
                        const baseArgs: string[] = ["logs"];
                        const tailIndex = argsArray.findIndex((arg) => arg.toLowerCase() === "--tail");
                        if (tailIndex >= 0 && argsArray.length > tailIndex + 1) {
                          baseArgs.push("--tail", argsArray[tailIndex + 1]);
                        } else if (argsArray.length > 1 && argsArray[1] === "--tail" && argsArray.length > 2) {
                          baseArgs.push("--tail", argsArray[2]);
                        }

                        baseArgs.push(resolution.name);
                        funcCall.args.args = baseArgs;
                        pendingLogRequest = null;
                      } else {
                        const suggestions = resolution.suggestions;
                        const suggestionText = suggestions.length
                          ? `Possible containers: ${suggestions.join(", ")}`
                          : "No containers are currently listed by Docker.";
                        postToolMessages.push(
                          `I couldn't find a container matching "${pendingLogRequest.original}". ${suggestionText}`
                        );
                        pendingLogRequest = null;
                        continue;
                      }
                    }
                  }
                }

                const functionResponse = await handleFunctionCall(funcCall, onStatusUpdate);
                
                // Log what we're sending back to the AI model
                const responseData = functionResponse.response as any;
                
                if (responseData?.needsApproval && onCommandRequest) {
                  const requestId = responseData.request_id || generateId("cmd");
                  if (notifiedCommandRequests.has(requestId)) {
                    console.log(`[Gemini] ⚠️ Command request ${requestId} already notified (needs approval).`);
                  } else {
                    notifiedCommandRequests.add(requestId);
                    const normalizedPolicy =
                      responseData.policy || {
                        level: "approval_required",
                        category: "critical",
                        reason: responseData.error || "Command requires approval.",
                      };
                    const request: PendingCommandRequest = {
                      id: requestId,
                      command: responseData.command || "",
                      args: Array.isArray(responseData.args) ? responseData.args : [],
                      policy: normalizedPolicy,
                      createdAt: Date.now(),
                      status: "pending",
                    };
                    onCommandRequest(request);
                  }
                } else if (responseData?.blocked && onCommandRequest) {
                  const requestId = responseData.request_id || generateId("cmd");
                  if (notifiedCommandRequests.has(requestId)) {
                    console.log(`[Gemini] ⚠️ Command request ${requestId} already notified (blocked).`);
                  } else {
                    notifiedCommandRequests.add(requestId);
                    const normalizedPolicy =
                      responseData.policy || {
                        level: "blocked",
                        category: "forbidden",
                        reason: responseData.error || "Command blocked by safety rules.",
                      };
                    const request: PendingCommandRequest = {
                      id: requestId,
                      command: responseData.command || "",
                      args: Array.isArray(responseData.args) ? responseData.args : [],
                      policy: normalizedPolicy,
                      createdAt: Date.now(),
                      status: "blocked",
                      error: responseData.error,
                    };
                    onCommandRequest(request);
                  }
                }
                
                // Check for multiple_windows_found FIRST - this is an expected intermediate state, not a failure
                if (responseData?.multiple_windows_found) {
                  // This is expected - multiple windows found, asking user to choose
                  console.log(`[Gemini] 📋 Multiple windows found, asking user to choose:`, {
                    windows_count: responseData.windows?.length || 0,
                    message_preview: responseData.message?.substring(0, 100) + '...',
                  });
                } else if (functionResponse.response.success) {
                  console.log(`[Gemini] 🔄 Sending function response back to AI:`, {
                    function_name: functionResponse.name,
                    has_image: !!responseData.image_base64,
                    image_size: responseData.image_base64 ? `${Math.round(responseData.image_base64.length / 1024)} KB` : 'N/A',
                    ocr_text_length: responseData.ocr_text?.length || 0,
                    ocr_preview: responseData.ocr_text ? (responseData.ocr_text.substring(0, 100) + (responseData.ocr_text.length > 100 ? '...' : '')) : 'None',
                    window_title: responseData.window_title,
                    process_name: responseData.process_name,
                  });
                } else {
                  // Actual error
                  console.log(`[Gemini] ❌ Function call failed:`, functionResponse.response);
                }
                
                // Send function response first (Gemini doesn't allow mixing functionResponse with other parts)
                const responseResult = await chat.sendMessageStream([
                  {
                    functionResponse: {
                      name: functionResponse.name,
                      response: functionResponse.response,
                    },
                  },
                ]);
                
                // Check if there's an image - if so, we'll send it with a prompt and only process that response
                // This ensures Gemini sees both the function response data AND the image before responding
                const hasImage = functionResponse.response.success && responseData?.image_base64;
                
                if (hasImage) {
                  // Don't process function response stream - wait to send image with prompt first
                  console.log(`[Gemini] 📷 Function response includes image, will send with analysis prompt`);
                } else {
                  // No image - process function response stream normally
                  let hasResponseText = false;
                  let responseTextLength = 0;
                  let aggregatedResponse = "";
                  for await (const responseChunk of responseResult.stream) {
                    const responseText = responseChunk.text();
                    if (responseText) {
                      hasResponseText = true;
                      responseTextLength += responseText.length;
                      aggregatedResponse += responseText;
                    }
                  }

                  if (aggregatedResponse) {
                    controller.enqueue(enforceConversationalTone(aggregatedResponse));
                  }
                  
                  // ROOT CAUSE FIX: Always send a follow-up prompt for execute_command to ensure we get a response
                  // Gemini may close the stream immediately after receiving large function responses without generating text
                  // By always sending a prompt, we prevent empty responses from happening in the first place
                  if (functionResponse.name === "execute_command") {
                    const awaitingApproval = responseData?.needsApproval || responseData?.blocked;
                    const command = (funcCall.args?.command as string | undefined)?.toLowerCase();
                    const argsArray = Array.isArray(funcCall.args?.args) ? (funcCall.args?.args as string[]) : [];

                  if (!awaitingApproval && !responseData?.success && responseData?.error) {
                    postToolMessages.push(
                      `Command "${command ?? ""} ${(argsArray || []).join(" ")}" failed: ${responseData.error}. If you still need this information, try running the command manually or clarify the exact container/service name.`
                    );
                  }

                    if (!awaitingApproval) {
                      if (command === "docker") {
                        if (argsArray.includes("ps") && responseData?.stdout) {
                          recordDockerContainers(responseData.stdout);
                        }
                        if (argsArray.includes("logs") && pendingLogRequest) {
                      pendingLogRequest = null;
                        }
                        if (argsArray.includes("ps") && !responseData?.stdout) {
                          postToolMessages.push("Docker command returned no output. Please ensure Docker Desktop is running.");
                        }
                      }

                      // Only send follow-up if we didn't get a response (most cases) or if response was very short (likely incomplete)
                      if (!hasResponseText || (hasResponseText && responseTextLength < 50)) {
                        if (!hasResponseText) {
                          console.log(`[Gemini] ⚠️ No response text after execute_command - sending follow-up prompt`);
                        } else {
                          console.log(`[Gemini] ⚠️ Short response (${responseTextLength} chars) after execute_command - sending follow-up for complete answer`);
                        }
                        
                        const followUpResult = await chat.sendMessageStream([
                          {
                            text: "Please provide a response based on the command output above.",
                          },
                        ]);
                        
                        let followUpAggregate = "";
                        for await (const followUpChunk of followUpResult.stream) {
                          const followUpText = followUpChunk.text();
                          if (followUpText) {
                            followUpAggregate += followUpText;
                          }
                        }

                        if (followUpAggregate) {
                          controller.enqueue(enforceConversationalTone(followUpAggregate));
                        }
                      }
                    } else {
                      console.log(`[Gemini] ⏸️ Command requires approval or is blocked; skipping post-command follow-up.`);
                    }
                  }
                }
                
                // If the function response includes an image, send it as a follow-up message with a prompt
                // This allows the AI to see the actual image and analyze it along with OCR text
                if (hasImage) {
                  console.log(`[Gemini] 📷 Sending image as follow-up message (${Math.round(responseData.image_base64.length / 1024)} KB)`);
                  
                  // Build a prompt that maintains conversation coherence and matches user intent
                  const ocrText = responseData.ocr_text || "";
                  const windowTitle = responseData.window_title || "the window";
                  const processName = responseData.process_name || "the application";
                  const analysis = responseData.analysis;
                  
                  // Get conversation context to understand user intent
                  const userMessages = messages.filter(m => m.role === "user");
                  const lastUserMessage = userMessages[userMessages.length - 1]?.content || "";
                  
                  // Determine user intent level - improved patterns
                  const isJustIdentifying = /^(the|that|this|it|yes|ok|okay|sure|yep|yeah|yup|correct|right|exactly|that one|this one|the .+ one|number \d+|^\d+$)$/i.test(lastUserMessage.trim());
                  const isJustChecking = /\b(all good|just wanted|just checking|just wanted to check|wondered if|no.*just|just wanted to check if)\b/i.test(lastUserMessage) || 
                                         /^no,?\s+just/i.test(lastUserMessage.trim());
                  const isAskingToSee = /^(can you see|do you see|can you|do you|show me|what.*see|tell me.*see)/i.test(lastUserMessage) && !isJustChecking;
                  const isAskingQuestion = /^(what|how|why|when|where|which|who|explain|describe|tell me|help|show|analyze)/i.test(lastUserMessage);
                  
                  let analysisPrompt = `I've captured the window "${windowTitle}" from ${processName} that the user is referring to. `;
                  
                  // Match user intent level FIRST, then decide what context to provide
                  if (isJustChecking) {
                    // User is just checking - use existing context, brief acknowledgment
                    analysisPrompt += `\n\nCRITICAL: The user is just checking if you can see the window. `;
                    analysisPrompt += `They said: "${lastUserMessage}"\n\n`;
                    analysisPrompt += `YOUR RESPONSE MUST BE: `;
                    analysisPrompt += `- Brief acknowledgment (e.g., "Yes, I can see it!" or "Understood!")\n`;
                    analysisPrompt += `- Ask if there's something else they want to talk about\n`;
                    analysisPrompt += `- Keep it very brief and conversational\n`;
                    analysisPrompt += `- DO NOT describe content or analyze - they're just checking\n`;
                    analysisPrompt += `- Example: "Yes, I can see it! Is there something else you'd like to talk about?"\n\n`;
                    analysisPrompt += `Use existing context from conversation history - no need to analyze the window again.`;
                    
                    // DON'T include analysis/OCR when just checking - use existing context
                  } else if (isJustIdentifying) {
                    // User identified which window - provide context and engage briefly
                    analysisPrompt += `\n\nThe user just identified which window they're referring to: "${windowTitle}". `;
                    analysisPrompt += `They said: "${lastUserMessage}"\n\n`;
                    
                    // Provide context so AI can briefly mention what it sees
                    if (analysis) {
                      analysisPrompt += `[CONTEXT - Use to briefly mention what you see and engage]\n`;
                      analysisPrompt += `Window Type: ${analysis.windowType}\n`;
                      analysisPrompt += `Application: ${analysis.application}\n`;
                      analysisPrompt += `Content: ${analysis.contentType}\n`;
                      if (analysis.filePath) {
                        analysisPrompt += `File: ${analysis.filePath}\n`;
                      }
                      analysisPrompt += `Brief Context: ${analysis.detailedDescription.substring(0, 300)}${analysis.detailedDescription.length > 300 ? '...' : ''}\n`;
                      analysisPrompt += `[END CONTEXT]\n\n`;
                    }
                  
                  if (ocrText && ocrText.length > 0) {
                      analysisPrompt += `[OCR PREVIEW - Use to understand what's visible]\n`;
                      analysisPrompt += `${ocrText.substring(0, 500)}${ocrText.length > 500 ? '...' : ''}\n`;
                      analysisPrompt += `[END OCR PREVIEW]\n\n`;
                    }
                    
                    analysisPrompt += `YOUR RESPONSE MUST BE: `;
                    analysisPrompt += `- Brief acknowledgment: "Got it! I can see your [window name] window."\n`;
                    analysisPrompt += `- Briefly mention what you see (1-2 sentences max) - be conversational, not technical\n`;
                    analysisPrompt += `- Try to engage based on conversation history - what might they need help with?\n`;
                    analysisPrompt += `- Ask if they need guidance, help, or have questions about what they're working on\n`;
                    analysisPrompt += `- Keep it brief and engaging (2-3 sentences total)\n`;
                    analysisPrompt += `- DO NOT dump all the details - just a brief, engaging mention\n\n`;
                    analysisPrompt += `Example tone: "Got it! I can see your ai-teacher window. Looks like you're working on [brief mention]. Need help with anything specific or want to discuss something about it?"`;
                  } else if (isAskingToSee) {
                    // User asked if AI can see it - simple confirmation, minimal context
                    analysisPrompt += `The user asked if you can see their window. `;
                    analysisPrompt += `Confirm briefly that you can see it. `;
                    analysisPrompt += `You can mention the window type (e.g., "code editor") but DO NOT describe content unless they ask.`;
                    
                    // Provide minimal context only
                    if (analysis) {
                      analysisPrompt += `\n\n[MINIMAL CONTEXT - Window type only]\n`;
                      analysisPrompt += `Window Type: ${analysis.windowType}\n`;
                      analysisPrompt += `[END CONTEXT]\n\n`;
                    }
                  } else if (isAskingQuestion) {
                    // User asked a specific question - provide full context
                    analysisPrompt += `The user asked: "${lastUserMessage}" `;
                    analysisPrompt += `Use the OCR text and image below to answer their specific question. `;
                    analysisPrompt += `Stay focused on what they asked - don't dump unrelated information.\n\n`;
                    
                    // CRITICAL: For questions about visible content, ONLY use OCR and image
                    analysisPrompt += `\n**CRITICAL INSTRUCTIONS FOR ANSWERING:**\n`;
                    analysisPrompt += `- Answer DIRECTLY - do not add meta-commentary like "That's a good check!" or "That's a great question!"\n`;
                    analysisPrompt += `- Just answer the question directly and naturally\n\n`;
                    
                    analysisPrompt += `- Use terminal commands for ground truth when the UI is ambiguous. The execute_command tool enforces the safety policy for you.\n`;
                    analysisPrompt += `- If execute_command returns {"needsApproval": true}, pause and ask the user before continuing.\n`;
                    analysisPrompt += `- If execute_command returns {"blocked": true}, explain why it was blocked and guide the user toward a safe alternative.\n`;
                    analysisPrompt += `- Prefer real command output (e.g., docker ps, git status, log viewers) over guessing from screenshots when the question is about runtime state.\n`;
                    analysisPrompt += `- You MUST answer based ONLY on what is visible in the OCR text, the image, and any verified command output.\n`;
                    analysisPrompt += `- DO NOT make assumptions or use information from previous conversations.\n`;
                    analysisPrompt += `- DO NOT guess or infer names that aren't explicitly shown.\n`;
                    analysisPrompt += `- If the OCR text shows specific names, reuse those exact names verbatim.\n`;
                    
                    // Provide INTERNAL context for answering the question (but emphasize OCR is primary)
                    if (analysis) {
                      analysisPrompt += `[CONTEXT - Secondary reference only, OCR/Image are PRIMARY]\n`;
                      analysisPrompt += `Window Type: ${analysis.windowType}\n`;
                      analysisPrompt += `Application: ${analysis.application}\n`;
                      analysisPrompt += `Content: ${analysis.contentType}\n`;
                      if (analysis.language) {
                        analysisPrompt += `Language: ${analysis.language}\n`;
                      }
                      if (analysis.filePath) {
                        analysisPrompt += `File: ${analysis.filePath}\n`;
                      }
                      analysisPrompt += `Note: The analysis description below may contain inferences - verify against OCR/image\n`;
                      analysisPrompt += `[END CONTEXT]\n\n`;
                    }
                    
                    // Add OCR if available - THIS IS THE PRIMARY SOURCE
                    if (ocrText && ocrText.length > 0) {
                      analysisPrompt += `[OCR TEXT - PRIMARY SOURCE - Use EXACTLY what you see here]\n`;
                      analysisPrompt += `${ocrText}\n`;
                      analysisPrompt += `[END OCR TEXT]\n\n`;
                      analysisPrompt += `**REMINDER:** Use the EXACT container/service names shown in the OCR text above. `;
                      analysisPrompt += `Do NOT use different names or make assumptions.\n\n`;
                    } else {
                      analysisPrompt += `[WARNING: No OCR text available - rely ONLY on the image]\n\n`;
                    }
                  } else {
                    // Default: match their level of detail, provide context but don't dump it
                    analysisPrompt += `The user said: "${lastUserMessage}" `;
                    analysisPrompt += `Match their level of detail. `;
                    analysisPrompt += `If they're being brief, be brief. Only use context if they ask a question.\n\n`;
                    
                    // Provide context but mark it as internal
                    if (analysis) {
                      analysisPrompt += `[INTERNAL CONTEXT - Only use if relevant to their message]\n`;
                      analysisPrompt += `Window Type: ${analysis.windowType}\n`;
                      analysisPrompt += `Application: ${analysis.application}\n`;
                      analysisPrompt += `[END CONTEXT]\n\n`;
                    }
                  }
                  
                  // Critical instruction about conversation coherence and accuracy
                  analysisPrompt += `\n\nCRITICAL: Maintain conversation coherence. `;
                  analysisPrompt += `If the user just identified/confirmed a window, acknowledge briefly and wait. `;
                  analysisPrompt += `DO NOT analyze or describe content unless they explicitly ask. `;
                  analysisPrompt += `The image below is for YOUR reference - don't describe it unless asked.\n\n`;
                  analysisPrompt += `**FINAL REMINDER:** When answering questions about visible content (containers, files, etc.), `;
                  analysisPrompt += `look directly at the image and OCR text. Use ONLY the exact names/values you see. `;
                  analysisPrompt += `Do NOT infer, assume, or use naming conventions - use what's actually visible.\n\n`;
                  analysisPrompt += `**AVOID REPETITION:** Do not restate the same acknowledgement or question multiple times. `;
                  analysisPrompt += `If you already explained a root-cause (e.g., missing dependency), move on to the next actionable step instead of re-asking. `;
                  analysisPrompt += `Only ask for information that hasn't been provided yet. `;
                  analysisPrompt += `Keep your response concise (2-3 sentences unless the user explicitly requests a detailed walkthrough).\n\n`;
                  analysisPrompt += `**CONVERSATIONAL STYLE:**\n`;
                  analysisPrompt += `- Talk like a helpful teammate: acknowledge, answer, and offer to dig deeper.\n`;
                  analysisPrompt += `- Keep replies to 2-3 short sentences by default.\n`;
                  analysisPrompt += `- Ask if they'd like more detail instead of providing it unprompted.\n`;
                  analysisPrompt += `- Never repeat the same observation twice in the same turn.\n`;
                  
                  // Ensure base64 string is clean (remove data URI prefix if present)
                  let cleanBase64 = responseData.image_base64;
                  if (cleanBase64.includes(',')) {
                    cleanBase64 = cleanBase64.split(',')[1];
                  }
                  
                  // Send image with prompt so AI analyzes it properly
                  // This will include the function response context AND the image
                  const imageResult = await chat.sendMessageStream([
                    {
                      text: analysisPrompt,
                    },
                    {
                      inlineData: {
                        data: cleanBase64,
                        mimeType: "image/png",
                      },
                    },
                  ]);
                  
                  // Process the image message stream - this is the main response
                  let imageAggregate = "";
                  for await (const imageChunk of imageResult.stream) {
                    const imageText = imageChunk.text();
                    if (imageText) {
                      imageAggregate += imageText;
                    }
                  }

                  if (imageAggregate) {
                    controller.enqueue(enforceConversationalTone(imageAggregate));
                  }
                }
              }
              
              flushPendingText();
              if (postToolMessages.length > 0) {
                const supplemental = `\n${postToolMessages.join("\n\n")}`;
                controller.enqueue(enforceConversationalTone(supplemental));
              }
            } else {
              flushPendingText();
            }

            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });

      return stream;
    }
  } catch (error: any) {
    // If model error, try to provide helpful error message
    if (error.message?.includes("404") || error.message?.includes("not found")) {
      const errorMsg = `
❌ Gemini model "${currentModelName}" is not available with your API key.

🔧 Troubleshooting steps:
1. Verify your API key at: https://aistudio.google.com/apikey
2. Make sure "Generative Language API" is enabled in Google Cloud Console
3. Check if your API key has restrictions (IP, referrer, etc.)
4. Try creating a new API key without restrictions
5. Ensure your Google Cloud project has billing enabled (free tier is fine)

💡 Common solutions:
- Regenerate your API key
- Enable Generative Language API in Google Cloud Console
- Remove any API key restrictions temporarily to test

Original error: ${error.message}
      `.trim();
      throw new Error(errorMsg);
    }
    throw new Error(`Gemini API error: ${error.message}`);
  }
}

export async function analyzeScreenshot(
  screenshot: string,
  context: string
): Promise<string> {
  if (!currentModel) {
    throw new Error("Gemini not initialized");
  }

  const prompt = `Analyze this screenshot and provide a brief description of what you see. Context: ${context}`;

  const result = await currentModel.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              data: screenshot,
              mimeType: "image/png",
            },
          },
        ],
      },
    ],
  });

  return result.response.text();
}

