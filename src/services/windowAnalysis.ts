import { currentModel } from "./gemini";

/**
 * Window Analysis Result
 * Contains structured metadata and detailed narrative description
 */
export interface WindowAnalysis {
  // Structured fields
  windowType: string; // e.g., "code_editor", "browser", "terminal", "document"
  application: string; // e.g., "Cursor", "VS Code", "Chrome"
  contentType: string; // e.g., "TypeScript code", "React component", "documentation"
  language?: string; // Programming language if code editor
  filePath?: string; // Extracted from window title if available
  uiElements: string[]; // e.g., ["sidebar", "editor", "terminal", "status bar"]
  visibleFeatures: string[]; // e.g., ["syntax highlighting", "line numbers", "git indicators"]
  context: {
    isEditing: boolean;
    hasErrors: boolean;
    hasWarnings: boolean;
    isTerminal: boolean;
    isBrowser: boolean;
  };
  
  // Detailed narrative
  detailedDescription: string; // Rich, contextual description for AI tutor
}

interface CacheEntry {
  analysis: WindowAnalysis;
  timestamp: number;
}

// In-memory cache with LRU eviction
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 50;

/**
 * Generate cache key from window metadata and image hash
 */
function getCacheKey(
  windowTitle: string,
  processName: string,
  imageHash: string
): string {
  return `${windowTitle}|${processName}|${imageHash.substring(0, 16)}`;
}

/**
 * Clean expired entries from cache
 */
function cleanExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      cache.delete(key);
    }
  }
}

/**
 * Evict oldest entry if cache is full (LRU)
 */
function evictIfNeeded(): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    // Find oldest entry
    let oldestKey: string | null = null;
    let oldestTime = Date.now();
    
    for (const [key, entry] of cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }
}

/**
 * Analyze window capture using Gemini Vision API
 * Combines image and OCR text for comprehensive analysis
 */
async function performAnalysis(
  imageBase64: string,
  ocrText: string | null,
  windowTitle: string,
  processName: string
): Promise<WindowAnalysis> {
  if (!currentModel) {
    throw new Error("Gemini model not initialized");
  }

  // Clean base64 string (remove data URI prefix if present)
  let cleanBase64 = imageBase64;
  if (cleanBase64.includes(',')) {
    cleanBase64 = cleanBase64.split(',')[1];
  }

  const analysisPrompt = `You are a window analysis agent. Analyze this window capture (image + OCR text) and provide a comprehensive analysis.

CRITICAL: Use ONLY what is visible in the image and OCR text. DO NOT make assumptions or infer information that isn't explicitly shown.

WINDOW METADATA:
- Window Title: ${windowTitle}
- Process Name: ${processName}
${ocrText ? `- OCR Text Extracted: ${ocrText.length} characters\n\nOCR TEXT:\n${ocrText.substring(0, 4000)}${ocrText.length > 4000 ? '...' : ''}` : '- OCR Text: Not available'}

ANALYSIS TASK:
1. Analyze BOTH the image and OCR text together (if OCR is available)
2. Extract structured metadata about the window based ONLY on what is visible
3. Generate a detailed narrative description that provides rich context

IMPORTANT RULES:
- For container/service names, use ONLY the exact names shown in the OCR text or image
- DO NOT infer or guess container names (e.g., don't assume "kryptit_redis_1" if only "kryptit" is shown)
- DO NOT use information from previous context or conversations
- If you see a container named "infra", use "infra" - don't assume it's part of a service stack
- For lists (containers, files, etc.), list ONLY what is explicitly visible

For the structured analysis, identify:
- Window type (code_editor, browser, terminal, document, etc.)
- Application name
- Content type (what kind of content is visible)
- Programming language (if code editor)
- File path (if extractable from window title or content)
- UI elements visible (sidebar, editor, terminal, status bar, etc.)
- Visible features (syntax highlighting, line numbers, git indicators, etc.)
- Context flags (isEditing, hasErrors, hasWarnings, isTerminal, isBrowser)

For the detailed narrative, provide:
- A comprehensive description of what the window is showing (based ONLY on visible content)
- What the user appears to be working on
- Key visual elements and their purpose
- Any notable patterns, errors, or features
- Context that would help an AI tutor understand the user's situation
- IMPORTANT: When describing containers/services/files, use ONLY the exact names visible in OCR/image

Respond in this exact JSON format (no markdown, just valid JSON):
{
  "windowType": "code_editor|browser|terminal|document|other",
  "application": "application name",
  "contentType": "description of content",
  "language": "programming language or null",
  "filePath": "file path if extractable or null",
  "uiElements": ["list", "of", "ui", "elements"],
  "visibleFeatures": ["list", "of", "features"],
  "context": {
    "isEditing": true/false,
    "hasErrors": true/false,
    "hasWarnings": true/false,
    "isTerminal": true/false,
    "isBrowser": true/false
  },
  "detailedDescription": "comprehensive narrative description (2-5 sentences) that provides rich context for understanding what the window shows and what the user is doing"
}

Be specific and accurate. Use the OCR text for precise content extraction, and use the image for visual context, layout, colors, and elements OCR might miss.`;

  try {
    const result = await currentModel.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: analysisPrompt },
            {
              inlineData: {
                data: cleanBase64,
                mimeType: "image/png",
              },
            },
          ],
        },
      ],
    });

    const responseText = result.response.text();
    
    // Try to extract JSON from the response (might be wrapped in markdown)
    let jsonText = responseText.trim();
    
    // Remove markdown code blocks if present
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    }
    
    // Try to find JSON object in the response
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    const analysis = JSON.parse(jsonText) as WindowAnalysis;
    
    // Validate and set defaults
    return {
      windowType: analysis.windowType || "unknown",
      application: analysis.application || processName || "unknown",
      contentType: analysis.contentType || "unknown",
      language: analysis.language || undefined,
      filePath: analysis.filePath || undefined,
      uiElements: analysis.uiElements || [],
      visibleFeatures: analysis.visibleFeatures || [],
      context: {
        isEditing: analysis.context?.isEditing ?? false,
        hasErrors: analysis.context?.hasErrors ?? false,
        hasWarnings: analysis.context?.hasWarnings ?? false,
        isTerminal: analysis.context?.isTerminal ?? false,
        isBrowser: analysis.context?.isBrowser ?? false,
      },
      detailedDescription: analysis.detailedDescription || "Unable to generate detailed description",
    };
  } catch (error) {
    console.error("[windowAnalysis] Failed to analyze window:", error);
    throw error;
  }
}

/**
 * Analyze window capture with caching
 * Returns structured metadata and detailed narrative description
 */
export async function analyzeWindowCapture(
  imageBase64: string,
  ocrText: string | null,
  windowTitle: string,
  processName: string,
  imageHash: string
): Promise<WindowAnalysis | null> {
  try {
    // Clean expired entries
    cleanExpiredEntries();
    
    // Check cache
    const cacheKey = getCacheKey(windowTitle, processName, imageHash);
    const cached = cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[windowAnalysis] Cache hit for: ${windowTitle}`);
      return cached.analysis;
    }
    
    // Cache miss - perform analysis
    console.log(`[windowAnalysis] Cache miss, analyzing window: ${windowTitle}`);
    
    // Evict if needed before adding new entry
    evictIfNeeded();
    
    const analysis = await performAnalysis(
      imageBase64,
      ocrText,
      windowTitle,
      processName
    );
    
    // Store in cache
    cache.set(cacheKey, {
      analysis,
      timestamp: Date.now(),
    });
    
    console.log(`[windowAnalysis] Analysis complete:`, {
      windowType: analysis.windowType,
      application: analysis.application,
      contentType: analysis.contentType,
      descriptionLength: analysis.detailedDescription.length,
    });
    
    return analysis;
  } catch (error) {
    console.error("[windowAnalysis] Analysis failed:", error);
    // Return null on error - don't break the capture flow
    return null;
  }
}

/**
 * Clear the analysis cache (useful for testing or manual cache management)
 */
export function clearAnalysisCache(): void {
  cache.clear();
  console.log("[windowAnalysis] Cache cleared");
}

/**
 * Get cache statistics (useful for debugging)
 */
export function getCacheStats(): { size: number; maxSize: number } {
  return {
    size: cache.size,
    maxSize: MAX_CACHE_SIZE,
  };
}

