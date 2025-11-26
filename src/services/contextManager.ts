import type { Message, SystemContext, WindowInfo } from "../types";
import type { ScreenshotAnalysis } from "./screenshotAnalysis";

/**
 * Conversation State Tracking
 * Tracks learner progress, topics covered, and conversation context
 */
export interface ConversationState {
  topicsCovered: string[];
  currentTopic?: string;
  skillLevel: "beginner" | "intermediate" | "advanced";
  conceptsMastered: string[];
  conceptsStruggling: string[];
  learningPace: "slow" | "normal" | "fast";
  lastActivity?: number;
  sessionCount: number;
}

/**
 * Context Summary for long conversations
 */
export interface ContextSummary {
  summary: string;
  keyTopics: string[];
  currentFocus: string;
  learnerProfile: string;
}

/**
 * Analyzes conversation history to extract key information
 * Enhanced to detect learning needs, knowledge gaps, and teaching opportunities
 */
export function analyzeConversationHistory(messages: Message[]): ConversationState {
  const state: ConversationState = {
    topicsCovered: [],
    skillLevel: "beginner",
    conceptsMastered: [],
    conceptsStruggling: [],
    learningPace: "normal",
    sessionCount: 1,
  };

  if (messages.length === 0) {
    return state;
  }

  // Extract topics from messages (enhanced keyword extraction)
  const topicKeywords: Record<string, string[]> = {
    python: ["python", "function", "variable", "list", "dict", "class", "import", "def", "print", "return"],
    git: ["git", "commit", "branch", "merge", "repository", "push", "pull", "clone"],
    vscode: ["vscode", "vs code", "editor", "debug", "breakpoint", "extension", "terminal"],
    testing: ["test", "pytest", "unittest", "assert", "mock", "fixture"],
    docker: ["docker", "container", "image", "dockerfile", "compose"],
    web: ["html", "css", "javascript", "react", "api", "http", "server"],
    data: ["pandas", "numpy", "dataframe", "csv", "json"],
  };

  const allText = messages.map(m => m.content.toLowerCase()).join(" ");
  const userMessages = messages.filter(m => m.role === "user").map(m => m.content.toLowerCase()).join(" ");
  
  // Extract topics covered
  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some(keyword => allText.includes(keyword))) {
      if (!state.topicsCovered.includes(topic)) {
        state.topicsCovered.push(topic);
      }
    }
  }

  // Detect concepts they're struggling with (questions, confusion indicators, repeated mistakes)
  const struggleIndicators = [
    "don't understand", "confused", "stuck", "error", "doesn't work", 
    "why", "how do i", "help", "problem", "issue", "not working",
    "can't", "unable", "trouble", "difficult", "hard"
  ];
  
  const struggleMatches = struggleIndicators.filter(indicator => 
    userMessages.includes(indicator)
  );
  
  // Extract concepts they're asking about (likely struggling areas)
  const recentUserMessages = messages.filter(m => m.role === "user").slice(-5);
  recentUserMessages.forEach(msg => {
    const msgLower = msg.content.toLowerCase();
    // Look for questions about specific concepts
    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(keyword => msgLower.includes(keyword)) && 
          (msgLower.includes("?") || struggleIndicators.some(ind => msgLower.includes(ind)))) {
        if (!state.conceptsStruggling.includes(topic)) {
          state.conceptsStruggling.push(topic);
        }
      }
    }
  });

  // Detect concepts they've mastered (successful implementations, correct answers, confidence)
  const masteryIndicators = [
    "got it", "works", "perfect", "understood", "makes sense", 
    "thanks", "great", "awesome", "figured it out", "solved"
  ];
  
  const masteryMatches = masteryIndicators.filter(indicator => 
    userMessages.includes(indicator)
  );

  // Determine skill level based on message complexity and concepts used
  const hasAdvancedConcepts = allText.includes("class") || 
                              allText.includes("decorator") || 
                              allText.includes("async") ||
                              allText.includes("generator") ||
                              allText.includes("context manager") ||
                              allText.includes("metaclass") ||
                              allText.includes("inheritance");
  
  const hasIntermediateConcepts = allText.includes("function") || 
                                 allText.includes("import") ||
                                 allText.includes("module") ||
                                 allText.includes("list comprehension") ||
                                 allText.includes("dictionary") ||
                                 allText.includes("exception");

  if (hasAdvancedConcepts) {
    state.skillLevel = "advanced";
  } else if (hasIntermediateConcepts) {
    state.skillLevel = "intermediate";
  }

  // Estimate learning pace based on message frequency, response patterns, and complexity
  const timeSpan = messages.length > 1 
    ? messages[messages.length - 1].timestamp - messages[0].timestamp 
    : 0;
  const messagesPerMinute = timeSpan > 0 ? (messages.length / (timeSpan / 60000)) : 0;
  
  // Fast pace: many messages quickly, or complex concepts being grasped quickly
  if (messages.length > 15 && (messagesPerMinute > 2 || masteryMatches.length > struggleMatches.length)) {
    state.learningPace = "fast";
  } 
  // Slow pace: few messages, many questions, or lots of struggle indicators
  else if (messages.length < 5 || struggleMatches.length > masteryMatches.length * 2) {
    state.learningPace = "slow";
  }

  // Detect current topic from recent messages
  const recentMessages = messages.slice(-3);
  const recentText = recentMessages.map(m => m.content.toLowerCase()).join(" ");
  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some(keyword => recentText.includes(keyword))) {
      state.currentTopic = topic;
      break;
    }
  }

  // Detect if this is a new conversation (needs context gathering)
  if (messages.length <= 2 && userMessages.length < 50) {
    // Very new conversation - flag for context gathering
    state.sessionCount = 1;
  }

  return state;
}

/**
 * Creates a context summary for long conversations
 * This helps manage context window limits
 */
export function createContextSummary(
  messages: Message[],
  state: ConversationState
): ContextSummary {
  // Get recent messages (last 5)
  const recentMessages = messages.slice(-5);
  const recentText = recentMessages.map(m => m.content).join("\n");

  // Get older messages summary (if any)
  const olderMessages = messages.slice(0, -5);
  const olderSummary = olderMessages.length > 0
    ? `Previous conversation covered: ${state.topicsCovered.join(", ")}`
    : "";

  return {
    summary: olderSummary,
    keyTopics: state.topicsCovered,
    currentFocus: recentText.substring(0, 200) + "...",
    learnerProfile: `Skill level: ${state.skillLevel}, Pace: ${state.learningPace}, Topics: ${state.topicsCovered.join(", ")}`,
  };
}

/**
 * Builds optimized conversation history for API calls
 * Implements smart context window management
 */
export function buildOptimizedHistory(
  messages: Message[],
  maxMessages: number = 10
): Message[] {
  if (messages.length <= maxMessages) {
    // Even if under the limit, clean up screenshots from older messages (keep only last 2)
    return messages.map((msg, index) => {
      const isRecent = index >= messages.length - 2;
      return {
        ...msg,
        screenshots: isRecent ? msg.screenshots : undefined
      };
    });
  }

  // Always keep the first message (context) and last N messages
  const firstMessage = { ...messages[0], screenshots: undefined }; // Remove screenshots from first message
  const recentMessages: Message[] = messages.slice(-maxMessages + 1).map((msg: Message, index: number) => {
    // Only keep screenshots for the most recent 2 messages
    const isVeryRecent = index >= (messages.length - maxMessages + 1) - 2;
    return {
      ...msg,
      screenshots: isVeryRecent ? msg.screenshots : undefined
    };
  });
  
  return [firstMessage, ...recentMessages];
}

/**
 * Injects dynamic context into system prompt based on conversation state
 * Enhanced to guide proactive teaching and context gathering
 * Now includes screenshot analysis insights for proactive detection
 * Also includes real-time system context (open windows, applications, etc.)
 */
export function injectDynamicContext(
  baseSystemPrompt: string,
  state: ConversationState,
  messages: Message[],
  summary?: ContextSummary,
  screenshotAnalysis?: ScreenshotAnalysis | null,
  systemContext?: SystemContext | null
): string {
  let contextInjection = "\n\n---\n\n## **CURRENT CONVERSATION CONTEXT**\n\n**Keep responses concise:** 2-3 short paragraphs max. Be direct and engaging, not verbose.\n\n";
  
  // REAL-TIME SYSTEM CONTEXT (HIGH PRIORITY - what's happening on their system)
  if (systemContext) {
    contextInjection += `## **REAL-TIME SYSTEM CONTEXT**\n\n`;
    contextInjection += `**Currently Active:** ${systemContext.active_window_title || systemContext.active_window}\n`;
    contextInjection += `**Active Application:** ${systemContext.active_window}\n`;
    
    if (systemContext.open_windows.length > 0) {
      contextInjection += `**Open Windows (${systemContext.open_windows.length}):**\n`;
      // Show top 10 most relevant windows
      const relevantWindows = systemContext.open_windows
        .filter((w: WindowInfo) => w.title.trim().length > 0)
        .slice(0, 10);
      
      relevantWindows.forEach((window: WindowInfo, idx: number) => {
        const activeMarker = window.is_active ? " [ACTIVE]" : "";
        contextInjection += `  ${idx + 1}. "${window.title}" (${window.process_name})${activeMarker}\n`;
      });
      
      if (systemContext.open_windows.length > 10) {
        contextInjection += `  ... and ${systemContext.open_windows.length - 10} more windows\n`;
      }
    }
    
    if (systemContext.running_applications.length > 0) {
      contextInjection += `**Running Applications:** ${systemContext.running_applications.slice(0, 15).join(", ")}`;
      if (systemContext.running_applications.length > 15) {
        contextInjection += ` (and ${systemContext.running_applications.length - 15} more)`;
      }
      contextInjection += `\n`;
    }
    
    contextInjection += `\n**Window Capture:** Use capture_window_with_ocr() when users mention apps/windows. Process names: lowercase ("cursor", not "Cursor"). The function returns both image and OCR text - use both for accurate answers.\n\n`;
  }
  
  // SCREENSHOT ANALYSIS INSIGHTS (HIGHEST PRIORITY - analyzed FIRST)
  if (screenshotAnalysis) {
    contextInjection += `**Screen:** ${screenshotAnalysis.whatWorkingOn}`;
    if (screenshotAnalysis.subject) {
      contextInjection += ` (${screenshotAnalysis.subject})`;
    }
    contextInjection += `. Progress: ${screenshotAnalysis.progressLevel}`;
    if (screenshotAnalysis.confusionLevel !== "none" || screenshotAnalysis.isStuck) {
      contextInjection += `. May need help`;
    }
    contextInjection += `.\n\n`;
  }
  
  if (summary) {
    contextInjection += `**Previous Session Summary:** ${summary.summary}\n\n`;
    contextInjection += `**Learner Profile:** ${summary.learnerProfile}\n\n`;
  }
  
  contextInjection += `**Topics Covered:** ${state.topicsCovered.join(", ") || "None yet"}\n`;
  contextInjection += `**Current Skill Level:** ${state.skillLevel}\n`;
  contextInjection += `**Learning Pace:** ${state.learningPace}\n`;
  
  if (state.currentTopic) {
    contextInjection += `**Current Topic:** ${state.currentTopic}\n`;
  }
  
  // Add learning needs detection
  if (state.conceptsStruggling.length > 0) {
    contextInjection += `**Concepts Student is Struggling With:** ${state.conceptsStruggling.join(", ")}\n`;
    contextInjection += `**Teaching Priority:** Focus on reinforcing these concepts. Be patient, use different explanations, and check understanding frequently.\n`;
  }
  
  if (state.conceptsMastered.length > 0) {
    contextInjection += `**Concepts Student Has Mastered:** ${state.conceptsMastered.join(", ")}\n`;
    contextInjection += `**Teaching Opportunity:** Build on these strengths and use them as foundations for new concepts.\n`;
  }
  
  // Check if this is truly a new conversation (no previous messages) vs ongoing conversation
  const userMessages = messages.filter(m => m.role === "user");
  const assistantMessages = messages.filter(m => m.role === "assistant");
  const isTrulyNewConversation = messages.length <= 1; // Only first user message, no assistant response yet
  
  // Guide context gathering for new conversations - check for simple greetings
  if (isTrulyNewConversation && (state.topicsCovered.length === 0 || state.sessionCount === 1)) {
    // Check if the last message is just a simple greeting
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    const isSimpleGreeting = lastMessage && 
      lastMessage.role === "user" && 
      /^(hey|hi|hello|sup|what's up|hey there|hi there)$/i.test(lastMessage.content.trim());
    
    if (isSimpleGreeting) {
      // For simple greetings, be very minimal and natural
      contextInjection += `\n**IMPORTANT - SIMPLE GREETING DETECTED (FIRST MESSAGE):**\n`;
      contextInjection += `- The student just said "${lastMessage.content.trim()}" - a simple, casual greeting.\n`;
      contextInjection += `- **Respond naturally** with a warm, simple greeting back (like "Hey! How can I help?" or "Hi there! What's on your mind?").\n`;
      contextInjection += `- **DO NOT ask multiple questions** - that feels pushy and AI-like.\n`;
      contextInjection += `- **DO NOT mention specific subjects** (like programming, Python, etc.) unless they do.\n`;
      contextInjection += `- **DO NOT jump into assessment mode** - just greet warmly and wait for them to tell you what they want.\n`;
      contextInjection += `- **Keep it brief** - one short, friendly sentence is enough.\n`;
      contextInjection += `- **Match their casual energy** - be natural, not formal or directive.\n`;
    } else {
      // For non-greeting messages, provide normal guidance
      contextInjection += `\n**IMPORTANT - NEW CONVERSATION DETECTED:**\n`;
      contextInjection += `- This appears to be a new conversation or the student is new.\n`;
      
      // If we have screenshot analysis, use it to guide questions
      if (screenshotAnalysis) {
        contextInjection += `- **Use screenshot analysis above** to understand what they're working on.\n`;
        contextInjection += `- **Reference what you see** on their screen when asking questions.\n`;
        contextInjection += `- **Proactively suggest** based on detected learning needs.\n`;
      } else {
        contextInjection += `- **Ask ONE simple, open question** to understand what they want to learn.\n`;
        contextInjection += `- **Don't overwhelm** with multiple questions - keep it natural.\n`;
        contextInjection += `- **Wait for their response** before asking more.\n`;
      }
      contextInjection += `- **Be warm and engaging** - greet them like a real teacher would.\n`;
      contextInjection += `- **Don't assume** - let them tell you what they want to learn.\n`;
    }
  } else if (messages.length > 1) {
    // This is an ongoing conversation - be aware of repetition and context
    const lastMessage = messages[messages.length - 1];
    const isRepeatedGreeting = lastMessage && 
      lastMessage.role === "user" && 
      /^(hey|hi|hello|sup|what's up|hey there|hi there)$/i.test(lastMessage.content.trim()) &&
      userMessages.filter(m => /^(hey|hi|hello|sup|what's up|hey there|hi there)$/i.test(m.content.trim())).length > 1;
    
    if (isRepeatedGreeting) {
      contextInjection += `\n**IMPORTANT - REPEATED GREETING IN ONGOING CONVERSATION:**\n`;
      contextInjection += `- The student has said "${lastMessage.content.trim()}" multiple times in this conversation.\n`;
      contextInjection += `- **Be aware of the conversation history** - you've already greeted them ${assistantMessages.length} time(s).\n`;
      contextInjection += `- **Acknowledge the repetition naturally** - maybe they're testing, waiting, or unsure what to say.\n`;
      contextInjection += `- **Reference previous messages** - "I see you're back" or "Still here when you're ready" or similar.\n`;
      contextInjection += `- **Don't repeat the same greeting** - vary your response based on conversation history.\n`;
      contextInjection += `- **Be patient and natural** - they might be figuring out what they want to ask.\n`;
      contextInjection += `- **Keep it brief but contextual** - acknowledge you're aware this isn't the first exchange.\n`;
    }
  }
  
  contextInjection += "\n**Use this context to:**\n";
  contextInjection += "- Reference previous topics naturally\n";
  contextInjection += "- Build on what was already learned\n";
  contextInjection += "- Adapt complexity to current skill level\n";
  contextInjection += "- Address areas where the student is struggling\n";
  contextInjection += "- Maintain continuity across sessions\n";
  contextInjection += "- Detect knowledge gaps and proactively address them\n";
  contextInjection += "- Adjust teaching pace based on learning pace\n";
  
  if (screenshotAnalysis) {
    contextInjection += "- Reference what's visible on screen: \"I can see you're working on...\"\n";
    contextInjection += "- Proactively address confusion indicators\n";
    contextInjection += "- Suggest teaching based on detected learning needs\n";
  }
  
  return baseSystemPrompt + contextInjection;
}

