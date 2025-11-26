/**
 * Screenshot Analysis Result
 * Contains insights extracted from analyzing the student's screen
 */
export interface ScreenshotAnalysis {
  whatWorkingOn: string; // What the student is currently working on
  subject?: string; // Detected subject/topic (programming language, math, etc.)
  confusionLevel: "none" | "low" | "medium" | "high"; // Level of confusion detected
  confusionIndicators: string[]; // Specific indicators (error messages, blank screen, etc.)
  learningNeeds: string[]; // What the student might need help learning
  suggestions: string[]; // Proactive teaching suggestions
  isStuck: boolean; // Whether student appears stuck
  progressLevel: "starting" | "in_progress" | "stuck" | "completed"; // Current progress state
}

/**
 * Analyzes screenshots to detect learning needs, confusion patterns, and teaching opportunities
 * This is called FIRST before processing messages to understand context
 */
export async function analyzeScreenshotForLearningNeeds(
  screenshots: string[],
  model: any // Gemini model instance
): Promise<ScreenshotAnalysis | null> {
  if (!model || screenshots.length === 0) {
    return null;
  }

  // Use the most recent screenshot for analysis
  const latestScreenshot = screenshots[screenshots.length - 1];

  const analysisPrompt = `You are analyzing a student's screen to understand what they're working on and detect learning needs. 

Analyze this screenshot and provide a structured assessment. Look for:

1. **What they're working on**: Code editor, document, website, math problem, etc.
2. **Subject/Topic**: Programming language, subject matter (math, science, etc.)
3. **Confusion indicators**: 
   - Error messages or warnings
   - Blank/empty screens
   - Repeated failed attempts
   - Cursor blinking in one place for a while
   - Multiple browser tabs with similar searches
4. **Learning needs**: What concepts or skills they might need help with
5. **Progress state**: Are they starting something new, making progress, stuck, or completed?

Respond in this exact JSON format (no markdown, just valid JSON):
{
  "whatWorkingOn": "brief description of what's visible",
  "subject": "detected subject or null",
  "confusionLevel": "none|low|medium|high",
  "confusionIndicators": ["list", "of", "indicators"],
  "learningNeeds": ["what", "they", "might", "need"],
  "suggestions": ["proactive", "teaching", "suggestions"],
  "isStuck": true/false,
  "progressLevel": "starting|in_progress|stuck|completed"
}

Be specific and actionable. If you can't determine something, use null or empty arrays.`;

  try {
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: analysisPrompt },
            {
              inlineData: {
                data: latestScreenshot,
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

    const analysis = JSON.parse(jsonText) as ScreenshotAnalysis;
    
    // Validate and set defaults
    return {
      whatWorkingOn: analysis.whatWorkingOn || "Unknown",
      subject: analysis.subject || undefined,
      confusionLevel: analysis.confusionLevel || "none",
      confusionIndicators: analysis.confusionIndicators || [],
      learningNeeds: analysis.learningNeeds || [],
      suggestions: analysis.suggestions || [],
      isStuck: analysis.isStuck || false,
      progressLevel: analysis.progressLevel || "in_progress",
    };
  } catch (error) {
    console.error("Failed to analyze screenshot:", error);
    // Return a basic analysis on error
    return {
      whatWorkingOn: "Unable to analyze screen",
      confusionLevel: "none",
      confusionIndicators: [],
      learningNeeds: [],
      suggestions: [],
      isStuck: false,
      progressLevel: "in_progress",
    };
  }
}

