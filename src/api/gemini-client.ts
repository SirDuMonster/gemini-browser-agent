import type {
  PlannerRequest,
  ComputerUseAction,
  MultiSiteContext,
  PageContext,
  ActionRecord,
} from '../shared/types';

// H11 Fix: Define proper response interface for Google AI API
interface GoogleAIResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: {
          name: string;
          args: Record<string, unknown>;
        };
      }>;
    };
    finishReason?: string;
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }>;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
}
import {
  GOOGLE_AI_API_KEY,
  GOOGLE_AI_BASE_URL,
  GEMINI_MODEL,
  GEMINI_MODEL_STABLE,
  API_CONFIG,
  STORAGE_KEYS,
  debugLog,
  debugError,
} from '../shared/constants';

/**
 * Gemini Client for Unified Planning + Execution
 * Uses Google AI API (not OpenRouter)
 */
export class GeminiClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || GOOGLE_AI_API_KEY;
    this.baseUrl = GOOGLE_AI_BASE_URL;
    this.model = GEMINI_MODEL;
  }

  /**
   * Validate API key (P0 - Issue #1)
   */
  private validateApiKey(): void {
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error('API key is not configured. Please set your Google AI API key in settings.');
    }

    if (this.apiKey.length < 30) {
      throw new Error('Invalid API key format. Please check your Google AI API key in settings.');
    }
  }

  /**
   * Load API key from storage
   * L9 Note: This method is intentionally kept for lazy-loading API key
   * when the client is created before settings are available
   */
  async loadApiKeyFromStorage(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
      if (result[STORAGE_KEYS.SETTINGS]?.googleAiApiKey) {
        this.apiKey = result[STORAGE_KEYS.SETTINGS].googleAiApiKey;
        debugLog('GeminiClient', 'API key loaded from storage');
      }
    } catch (error) {
      debugError('GeminiClient', 'Failed to load API key from storage', error);
    }
  }

  /**
   * Plan AND execute in one call
   * Gemini returns both the plan and the specific action with coordinates
   * Includes retry logic with model fallback (P2 - Issues #9, #14)
   */
  async planAndExecute(request: PlannerRequest): Promise<{
    thinking: string;
    nextAction: ComputerUseAction | null;
    status: 'in_progress' | 'done' | 'error' | 'needs_clarification';
    confidence: number;
  }> {
    debugLog('GeminiClient', 'Planning and executing...', {
      userRequest: request.userRequest,
      url: request.context.url,
    });

    // Validate API key before proceeding
    this.validateApiKey();

    let lastError: Error | null = null;
    const maxAttempts = 2; // Try preview model, then stable model

    // Reset to preview model at start of each request (don't persist fallback)
    this.model = GEMINI_MODEL;
    let usingStableModel = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Use stable model on second attempt
        if (attempt === 2 && !usingStableModel) {
          debugLog('GeminiClient', 'Falling back to stable model');
          usingStableModel = true;
          this.model = GEMINI_MODEL_STABLE;
        }

        const response = await this.callGoogleAI(request);
        return this.parseResponse(response);
      } catch (error) {
        lastError = error as Error;
        debugError('GeminiClient', `Attempt ${attempt} failed`, error);

        // Check if it's a model-specific error
        const errorMessage = (error as Error).message.toLowerCase();
        if (errorMessage.includes('not found') || errorMessage.includes('model') || errorMessage.includes('404')) {
          if (attempt < maxAttempts) {
            debugLog('GeminiClient', 'Model error detected, will try stable model');
            continue;
          }
        }

        // For other errors, don't retry
        if (!errorMessage.includes('quota') && !errorMessage.includes('rate limit') && !errorMessage.includes('timeout')) {
          throw error;
        }

        // Wait before retry (exponential backoff)
        if (attempt < maxAttempts) {
          const delayMs = 1000 * Math.pow(2, attempt - 1);
          debugLog('GeminiClient', `Waiting ${delayMs}ms before retry`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    throw lastError || new Error('Failed to plan and execute after all attempts');
  }

  /**
   * Call Google AI API
   * H11 Fix: Use proper return type instead of Promise<any>
   */
  private async callGoogleAI(request: PlannerRequest & { multiSiteContext?: MultiSiteContext }): Promise<GoogleAIResponse> {
    const { userRequest, context, actionHistory, memoryContext, multiSiteContext } = request;

    // Build prompt content (includes memory context from Phase 2 and multi-site context from Phase 5)
    const prompt = this.buildPrompt(userRequest, context, actionHistory, memoryContext, multiSiteContext);

    // Build request body (Google AI format)
    const requestBody = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/png',
                // C5 Fix: Validate base64 format before splitting
                data: (() => {
                  const parts = context.screenshot.split(',');
                  if (parts.length < 2 || !parts[1]) {
                    throw new Error('Invalid screenshot format: expected data URL with base64 content');
                  }
                  return parts[1];
                })(),
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: API_CONFIG.GEMINI.temperature,
        maxOutputTokens: API_CONFIG.GEMINI.maxTokens,
      },
      tools: [this.getComputerUseTool(context.viewport)],
      // Force Gemini to ALWAYS use function calling (not just return text)
      tool_config: {
        function_calling_config: {
          mode: 'ANY', // Forces model to use a function call
        },
      },
    };

    // Call API
    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_CONFIG.GEMINI.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();

        // Parse error for better handling (P2 - Issue #9)
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please wait and try again.');
        } else if (response.status === 403) {
          throw new Error('API key is invalid or access is denied. Please check your API key.');
        } else if (response.status === 404) {
          throw new Error(`Model ${this.model} not found. Will try fallback model.`);
        } else if (response.status === 400) {
          // Parse the error text for specific issues
          const lowerError = errorText.toLowerCase();
          if (lowerError.includes('safety')) {
            throw new Error('Content was blocked by safety filters.');
          } else if (lowerError.includes('token')) {
            throw new Error('Request exceeds maximum token limit. Try reducing screenshot quality.');
          }
        }

        throw new Error(`Google AI API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();

      // Check for API-level errors in response
      if (data.error) {
        throw new Error(`API Error: ${data.error.message || JSON.stringify(data.error)}`);
      }

      return data;
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Google AI API request timed out');
      }
      throw error;
    }
  }

  /**
   * Build prompt combining planning and execution instructions
   * H10 Fix: Use proper types instead of any
   */
  private buildPrompt(
    userRequest: string,
    context: PageContext,
    actionHistory: ActionRecord[],
    memoryContext?: string, // Autonomous Roaming Phase 2
    multiSiteContext?: MultiSiteContext // Autonomous Roaming Phase 5
  ): string {
    let prompt = `You are a browser automation agent using Gemini 3 Flash.

# User Request
${userRequest}
${memoryContext ? `
# Session Memory
${memoryContext}
` : ''}${multiSiteContext ? this.buildMultiSiteSection(multiSiteContext) : ''}
# Current Page
URL: ${context.url}
Title: ${context.title}
Viewport: ${context.viewport.width}x${context.viewport.height}

# Interactive Elements
${context.domSnapshot.interactiveElements.map((el, idx) =>
  `${idx + 1}. ${el.tagName}${el.type ? `[type=${el.type}]` : ''}: "${el.text || el.placeholder || ''}"
   Position: (${el.bounds.x}, ${el.bounds.y})
   Size: ${el.bounds.width}x${el.bounds.height}`
).join('\n')}

${actionHistory.length > 0 ? `# Previous Actions\n${actionHistory.map((a, idx) =>
  `${idx + 1}. ${a.plannedAction?.type || 'unknown'}: ${a.plannedAction?.description || 'N/A'} - ${a.success ? '✓' : '✗'}`
).join('\n')}` : ''}

# Your Task
1. Analyze the screenshot and page context
2. Determine the NEXT SINGLE ACTION to accomplish the user's request
3. Return a JSON response with:
   - thinking: Your reasoning process
   - action: The specific Computer Use action to execute
   - status: 'in_progress', 'done', 'error', or 'needs_clarification'
   - confidence: 0.0 to 1.0

# Action Format
Use the computer function to execute actions:

## Mouse & Keyboard
- mouse_move: Move to coordinates [x, y]
- left_click: Click at current position
- type: Type text into focused input
- key: Press keyboard key (e.g., "Return", "Tab")
- screenshot: Capture current screen (for verification only)

## Tab Management (Autonomous Roaming)
- open_tab: Open new tab with URL (params: url, purpose)
- close_tab: Close a tab (params: tabId - optional, closes current if omitted)
- switch_tab: Switch to a different tab (params: tabId)

## Navigation
- scroll: Scroll page (params: direction="up"|"down", amount=pixels)
- go_back: Navigate back in browser history
- go_forward: Navigate forward in browser history
- refresh: Reload current page

## Utility
- wait: Wait for milliseconds (params: duration - max 10000)
- extract_text: Extract text from page (params: selector - optional CSS selector)

## Communication
- message: Send a chat message to the user in the sidebar
  Use this to:
  - Explain what you're doing: "I'm searching for information about..."
  - Share findings: "I found that the price is $99..."
  - Ask questions: "Which product would you like me to compare?"
  - Provide summaries: "Here's what I found: ..."
  - Report completion: "I've completed the task. Here are the results..."
  Parameters: text (the message to display to user)

## File Generation
- generate_file: Create and download a file
  **ONLY use when user EXPLICITLY asks for a file** (e.g., "save to .txt", "create a PDF", "download as document")
  NEVER generate files autonomously - only when user requests it!
  Parameters:
  - fileType: "txt" | "html" | "xml" | "json" | "csv" | "md" | "docx" | "xlsx" | "pdf"
  - filename: Name for the file (extension added automatically)
  - content: Object with file content:
    * For text files (txt, html, xml, json, csv, md): { text: "content here" }
    * For Word docs (docx): { document: { title?, paragraphs: [{text, heading?, bold?, italic?}], tables?: [{headers, rows}] } } OR { text: "simple text" }
    * For Excel (xlsx): { spreadsheet: { sheetName?, headers?, rows: [[cell1, cell2], ...] } } OR { text: "CSV-like text" }
    * For PDF: { pdf: { title?, content: [{type: "text"|"heading"|"table", text?, level?, tableData?}] } } OR { text: "simple text" }

# File Generation Rules - IMPORTANT
- ONLY generate files when user EXPLICITLY requests: "save to file", "create .txt", "download as PDF", "make a document", etc.
- Polish equivalents: "zapisz do pliku", "wygeneruj .txt", "stwórz plik", "pobierz jako PDF", "zrób dokument"
- If user just asks for information/summary WITHOUT mentioning a file, present results in your "thinking" - do NOT download anything
- Examples (English):
  * "Find info about X" → Present findings in thinking, NO file
  * "Find info about X and save to .txt" → Find info, THEN generate_file
  * "Make a summary" → Present summary in thinking, NO file
  * "Make a summary in a .txt file" → Create summary, THEN generate_file
- Examples (Polish):
  * "Znajdź informacje o X" → Present findings in thinking, NO file
  * "Znajdź informacje o X, wygeneruj .txt" → Find info, THEN generate_file with { text: "summary content" }
  * "Zrób podsumowanie" → Present summary in thinking, NO file
  * "Zrób podsumowanie biografii, wygeneruj .txt" → Create summary, THEN generate_file with txt content

# Task Execution - DO NOT SHORTCUT
When asked to CREATE something (summary, analysis, report, etc.), you must:
1. Find the SOURCE MATERIAL first (the original content)
2. Read and understand the source
3. Then create your own output from it

CRITICAL: Do NOT search for pre-made versions of what you're asked to create!
- "Find X biography and make a summary" → Search "X biography", find article, READ it, THEN create summary
  - WRONG: Searching "X biography summary" (this finds someone else's summary)
  - CORRECT: Search "X biography", click Wikipedia/article, read content, generate_file with YOUR summary
- "Research Y and write a report" → Find sources about Y, gather info, THEN write report
  - WRONG: Searching "Y report" or "Y analysis"
  - CORRECT: Search "Y", visit relevant pages, extract facts, generate_file with YOUR report
- "Find reviews and summarize" → Find the actual reviews, THEN summarize them
  - WRONG: Searching "product reviews summary"
  - CORRECT: Search "product reviews", read multiple reviews, generate_file with YOUR summary

The user is asking YOU to do the intellectual work, not find someone else's pre-made work.

# Important Rules
1. For click/type actions, FIRST call mouse_move to move to the element
2. Then call left_click to focus/click
3. Then call type or key as needed
4. Calculate coordinates from element position and size (use center point)
5. Return ONE action at a time
6. NEVER say "done" until ALL promised actions are ACTUALLY EXECUTED
7. Your "thinking" describes what you WILL do next, not what you've already done
8. Use "message" action to communicate with the user

# CRITICAL: Avoid Loops!
- NEVER repeat the same action twice in a row if it didn't work
- If clicking a button doesn't work, use keyboard instead: key "Return" or key "Tab"
- After typing in a search field, ALWAYS press Return (key "Return") - don't look for buttons
- Check "Previous Actions" - if you see repeated failures, TRY A DIFFERENT APPROACH
- If stuck for 3+ similar actions, scroll or navigate elsewhere

# Search Best Practices
- After typing search query, immediately press Return (key action) - DON'T click search buttons
- If search results don't load, try: refresh, or open_tab with direct URL
- Wikipedia is reliable for biographies: open_tab "https://en.wikipedia.org/wiki/Person_Name"

# Communication with User
Use the "message" action to talk to the user like a chatbot:
- When starting: "I'm going to search for information about X..."
- When finding something: "I found the Wikipedia page. Let me read it..."
- When sharing results: "Here's what I found: [summary of findings]"
- When completing: "Done! I found that [key information]"
- When stuck or need input: "I found multiple results. Which one should I click?"

The user sees your messages in the sidebar. Keep them informed about what you're doing and share your findings!

# When to Ask for Clarification
Return status: "needs_clarification" when:
- The request is ambiguous (e.g., "find biography" - do they want info about the person or a book?)
- Multiple valid interpretations exist
- You need specific preferences (format, which result to choose, etc.)
- The requested action could have unintended consequences

Search Intent Guidelines:
- "Search for X" → Find INFORMATION about X, not products/books about X
- "Biography of person" → Find biographical FACTS, not biography books to buy
- "Make a summary of X" → Find X first, then YOU create the summary
- If unsure, ASK rather than guess wrong

# Example Response
{
  "thinking": "User wants to search. I see a search input at position (640, 300). I'll move the mouse there first.",
  "action": {
    "action": "mouse_move",
    "coordinate": [640, 300]
  },
  "status": "in_progress",
  "confidence": 0.9
}

Respond with JSON only.`;

    return prompt;
  }

  /**
   * Build multi-site section for prompt (Autonomous Roaming Phase 5)
   * Returns empty string if no meaningful multi-site context exists
   */
  private buildMultiSiteSection(ctx: MultiSiteContext): string {
    const hasMultipleTabs = ctx.openTabs.length > 1;
    const hasCorrelations = ctx.correlations.length > 0;
    const sitesWithData = Object.entries(ctx.siteIndex)
      .filter(([_, data]) => data.facts.length > 0);
    const hasSiteData = sitesWithData.length > 0;

    // Skip section entirely if no meaningful multi-site context
    if (!hasMultipleTabs && !hasCorrelations && !hasSiteData) {
      return '';
    }

    const parts: string[] = ['# Multi-Site Context'];

    // List open tabs (only if multiple)
    if (hasMultipleTabs) {
      parts.push('\n## Open Tabs');
      for (const tab of ctx.openTabs) {
        const isCurrent = tab.id === ctx.currentTabId ? ' [CURRENT]' : '';
        parts.push(`- Tab ${tab.id}: ${tab.domain}${isCurrent}`);
        if (tab.purpose) parts.push(`  Purpose: ${tab.purpose}`);
        const keyDataEntries = Object.keys(tab.keyData).length;
        if (keyDataEntries > 0) {
          parts.push(`  Data: ${JSON.stringify(tab.keyData)}`);
        }
      }
    }

    // Show correlations (data that appears across sites)
    if (hasCorrelations) {
      parts.push('\n## Cross-Site Data');
      for (const corr of ctx.correlations) {
        parts.push(`- ${corr.key}:`);
        for (const [tabId, value] of Object.entries(corr.values)) {
          parts.push(`  Tab ${tabId}: "${value}"`);
        }
      }
    }

    // Show site index summary
    if (hasSiteData) {
      parts.push('\n## Sites Visited');
      for (const [domain, data] of sitesWithData) {
        parts.push(`- ${domain}: ${data.facts.length} facts collected`);
      }
    }

    return parts.join('\n') + '\n';
  }

  /**
   * Define Computer Use tool (Google AI function calling format)
   * Autonomous Roaming Phase 1: Extended with tab management and navigation actions
   */
  private getComputerUseTool(_viewport: { width: number; height: number}) {
    return {
      functionDeclarations: [
        {
          name: 'computer',
          description: 'Control computer mouse, keyboard, tabs, and navigation to interact with the browser',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: [
                  // Mouse actions
                  'mouse_move',
                  'left_click',
                  'right_click',
                  'double_click',
                  'middle_click',
                  'left_click_drag',
                  // Input actions
                  'type',
                  'key',
                  // Screenshot
                  'screenshot',
                  'cursor_position',
                  // Tab management (Autonomous Roaming Phase 1)
                  'open_tab',
                  'close_tab',
                  'switch_tab',
                  // Navigation (Autonomous Roaming Phase 1)
                  'scroll',
                  'go_back',
                  'go_forward',
                  'refresh',
                  // Utility (Autonomous Roaming Phase 1)
                  'wait',
                  'extract_text',
                  // File generation (Phase 6)
                  'generate_file',
                  // Communication (Phase 7)
                  'message',
                ],
                description: 'The action to perform',
              },
              coordinate: {
                type: 'array',
                items: { type: 'number' },
                description: 'X,Y coordinates for mouse actions (e.g., [640, 480])',
              },
              text: {
                type: 'string',
                description: 'Text to type, key to press, or message to send to user',
              },
              // Tab management parameters
              url: {
                type: 'string',
                description: 'URL for open_tab action',
              },
              purpose: {
                type: 'string',
                description: 'Purpose/reason for opening tab (for open_tab action)',
              },
              tabId: {
                type: 'number',
                description: 'Tab ID for switch_tab or close_tab actions',
              },
              // Scroll parameters
              direction: {
                type: 'string',
                enum: ['up', 'down'],
                description: 'Scroll direction for scroll action',
              },
              amount: {
                type: 'number',
                description: 'Scroll amount in pixels (default: 300)',
              },
              // Wait parameters
              duration: {
                type: 'number',
                description: 'Duration in milliseconds for wait action (max: 10000)',
              },
              // Extract text parameters
              selector: {
                type: 'string',
                description: 'CSS selector for extract_text action (optional)',
              },
              // File generation parameters (Phase 6)
              fileType: {
                type: 'string',
                enum: ['txt', 'html', 'xml', 'json', 'csv', 'md', 'docx', 'xlsx', 'pdf'],
                description: 'Type of file to generate',
              },
              filename: {
                type: 'string',
                description: 'Name for the generated file (extension added automatically)',
              },
              content: {
                type: 'object',
                description: 'File content object - structure depends on fileType',
                properties: {
                  text: { type: 'string', description: 'Plain text content for text-based files' },
                  document: {
                    type: 'object',
                    description: 'Document structure for DOCX files',
                    properties: {
                      title: { type: 'string' },
                      paragraphs: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            text: { type: 'string' },
                            heading: { type: 'string', enum: ['h1', 'h2', 'h3'] },
                            bold: { type: 'boolean' },
                            italic: { type: 'boolean' },
                          },
                        },
                      },
                      tables: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            headers: { type: 'array', items: { type: 'string' } },
                            rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
                          },
                        },
                      },
                    },
                  },
                  spreadsheet: {
                    type: 'object',
                    description: 'Spreadsheet data for XLSX files',
                    properties: {
                      sheetName: { type: 'string' },
                      headers: { type: 'array', items: { type: 'string' } },
                      rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
                    },
                  },
                  pdf: {
                    type: 'object',
                    description: 'PDF content structure',
                    properties: {
                      title: { type: 'string' },
                      content: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            type: { type: 'string', enum: ['text', 'heading', 'table'] },
                            text: { type: 'string' },
                            level: { type: 'number' },
                            tableData: { type: 'object' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            required: ['action'],
          },
        },
      ],
    };
  }

  /**
   * Parse Google AI response (P2 - Issue #9)
   * Improved error handling for safety filters, blocked content, etc.
   * H12 Fix: Use proper types for response parameter
   */
  private parseResponse(response: GoogleAIResponse): { nextAction: ComputerUseAction | null; thinking: string; status: 'in_progress' | 'done' | 'error' | 'needs_clarification'; confidence: number } {
    // Check for safety ratings and blocked content
    const candidate = response.candidates?.[0];
    if (!candidate) {
      // Check if blocked due to safety
      if (response.promptFeedback?.blockReason) {
        throw new Error(`Content blocked: ${response.promptFeedback.blockReason}`);
      }
      throw new Error('No candidate in response. Content may have been filtered.');
    }

    // Check finish reason
    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
      if (candidate.finishReason === 'SAFETY') {
        throw new Error('Response blocked by safety filters.');
      } else if (candidate.finishReason === 'MAX_TOKENS') {
        throw new Error('Response exceeded maximum length. Try reducing screenshot quality.');
      } else if (candidate.finishReason === 'RECITATION') {
        throw new Error('Response blocked due to recitation concerns.');
      }
      debugLog('GeminiClient', `Unusual finish reason: ${candidate.finishReason}`);
    }

    const content = candidate.content;
    if (!content || !content.parts || content.parts.length === 0) {
      throw new Error('Empty response content');
    }

    // Check for function call
    if (content.parts[0].functionCall) {
      const functionCall = content.parts[0].functionCall;
      const args = functionCall.args as ComputerUseAction;

      // Generate descriptive thinking based on action type
      const thinking = this.generateActionDescription(args);

      return {
        thinking,
        nextAction: args,
        status: 'in_progress' as const,
        confidence: 0.8,
      };
    }

    // Check for text response (JSON)
    if (content.parts[0].text) {
      try {
        const text = content.parts[0].text.trim();
        const parsed = JSON.parse(text);
        const validStatuses = ['in_progress', 'done', 'error', 'needs_clarification'] as const;
        const parsedStatus = parsed.status && validStatuses.includes(parsed.status)
          ? parsed.status as typeof validStatuses[number]
          : 'in_progress' as const;
        return {
          thinking: parsed.thinking || '',
          nextAction: parsed.action || null,
          status: parsedStatus,
          confidence: parsed.confidence || 0.5,
        };
      } catch (e) {
        debugError('GeminiClient', 'Failed to parse JSON', {
          text: content.parts[0].text,
          error: e,
        });
        throw new Error(`Failed to parse JSON response: ${(e as Error).message}`);
      }
    }

    throw new Error('Invalid response format - no function call or text content');
  }

  /**
   * Generate human-readable description for function call actions
   */
  private generateActionDescription(action: ComputerUseAction): string {
    switch (action.action) {
      case 'mouse_move':
        return `Moving cursor to (${action.coordinate[0]}, ${action.coordinate[1]})`;
      case 'left_click':
        return 'Clicking element';
      case 'right_click':
        return 'Right-clicking element';
      case 'double_click':
        return 'Double-clicking element';
      case 'middle_click':
        return 'Middle-clicking element';
      case 'left_click_drag':
        return `Dragging to (${action.coordinate[0]}, ${action.coordinate[1]})`;
      case 'type': {
        const preview = action.text.length > 30 ? action.text.substring(0, 30) + '...' : action.text;
        return `Typing: "${preview}"`;
      }
      case 'key':
        return `Pressing key: ${action.text}`;
      case 'scroll':
        return `Scrolling ${action.direction}`;
      case 'screenshot':
        return 'Taking screenshot';
      case 'cursor_position':
        return 'Getting cursor position';
      case 'go_back':
        return 'Navigating back';
      case 'go_forward':
        return 'Navigating forward';
      case 'refresh':
        return 'Refreshing page';
      case 'open_tab':
        return `Opening new tab: ${action.url}`;
      case 'close_tab':
        return 'Closing tab';
      case 'switch_tab':
        return `Switching to tab ${action.tabId}`;
      case 'wait':
        return `Waiting ${action.duration}ms`;
      case 'extract_text':
        return 'Extracting page text';
      case 'generate_file':
        return `Generating ${action.fileType} file: ${action.filename}`;
      case 'message':
        return action.text;
      default:
        return `Executing: ${(action as any).action}`;
    }
  }

  /**
   * M28 Fix: Set API key with validation
   */
  setApiKey(apiKey: string): void {
    if (!apiKey || apiKey.trim() === '') {
      debugLog('GeminiClient', 'Warning: Setting empty API key');
    }
    this.apiKey = apiKey;
    debugLog('GeminiClient', 'API key updated');
  }

  /**
   * M27 Fix: Check if API key is configured
   */
  hasValidApiKey(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length >= 30);
  }

  getModel(): string {
    return this.model;
  }
}

export const geminiClient = new GeminiClient();
