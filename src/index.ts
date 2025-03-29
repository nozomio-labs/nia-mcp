#!/usr/bin/env node

// ES Module imports with .js extensions (required for Node.js ES modules)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import colors from "colors";
const { green, red, yellow } = colors;
import express from "express";
import { Request, Response, NextFunction } from "express";
import cors from "cors";
import { fileURLToPath } from "url";
// Custom tool timeout (can be adjusted as needed, default is already 5 minutes in server config)
const TOOL_TIMEOUT_MS = parseInt(process.env.TOOL_TIMEOUT_MS || "300000", 10); // 5 minutes default

// Nia API constants
const NIA_API_BASE = "https://api.trynia.ai";
const USER_AGENT = "nia-mcp/1.0";

// Global variables
let globalApiKey: string;
let debugMode = false;

// Helper function for making requests to Nia's OpenAI-compatible API
async function fetchContextFromNia(query: string, apiKey: string): Promise<{ content: string; sources?: string[]; statusCode?: number } | null> {
  // Note: Nia's API doesn't use /v1/ prefix like OpenAI
  const url = `${NIA_API_BASE}/chat/completions`;
  const headers = {
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`
  };

  // Add retry logic
  const maxRetries = 3;
  const maxTimeoutRetries = 5; // More retries specifically for timeout errors
  let retryCount = 0;
  let timeoutRetryCount = 0;
  let lastError: any = null;

  while (retryCount < maxRetries || timeoutRetryCount < maxTimeoutRetries) {
    try {
      // Fix #2: Add system message and enhanced query
      const enhancedQuery = query.toLowerCase().includes("repo") ||
                          query.toLowerCase().includes("repository") ||
                          query.toLowerCase().includes("what") ||
                          query.toLowerCase().includes("how") ?
                          `${query} - Please provide detailed information about the repository's purpose, architecture, and key components.` :
                          query;

      const systemMessage = "You are an expert software engineer analyzing code repositories. Provide detailed, accurate insights about the codebase. Include specific details from the context. If information is available in the context, focus on that rather than making general statements. For repository overviews, explain the main purpose, key components, and architecture.";

      console.error(`Sending request to ${url} for query: ${enhancedQuery.substring(0, 50)}... (Attempt ${retryCount + 1}/${maxRetries}, Timeout retries: ${timeoutRetryCount}/${maxTimeoutRetries})`);

      // Create a manual abort controller for redundancy
      const controller = new AbortController();
      // Set a standard timeout as a fallback (some Node.js versions have issues with AbortSignal.timeout)
      const timeoutId = setTimeout(() => controller.abort(), 180000); // Increased timeout to 3 minutes

      try {
        // Use both the AbortSignal.timeout and our manual controller
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [
              {
                role: "system",
                content: systemMessage
              },
              {
                role: "user",
                content: enhancedQuery
              }
            ],
            stream: true,  // Enable streaming to match Nia API's behavior - CRITICAL FIX
            max_tokens: 1000  // Limit token count to prevent long responses
          }),
          signal: controller.signal
        });

        // Clear the timeout since we got a response
        clearTimeout(timeoutId);

        // Log response status
        console.error(`Response status: ${response.status}`);
        console.error(`Response content-type: ${response.headers.get('content-type')}`);

        if (!response.ok) {
          console.error(`Error response: ${response.status}`);
          return { content: "", statusCode: response.status };
        }

        const contentType = response.headers.get('content-type');
        
        // Check if we received an SSE stream (which is expected when stream=true)
        if (contentType && contentType.includes('text/event-stream')) {
          console.error("Processing SSE stream response");
          
          // Read and process the SSE stream
          const textResponse = await response.text();
          let fullContent = "";
          const sources: string[] = [];
          
          // Split the response into SSE events
          const events = textResponse.split('\n\n');
          console.error(`Received ${events.length} SSE events`);
          
          for (const event of events) {
            // Skip empty events
            if (!event.trim()) continue;
            
            // Handle [DONE] marker
            if (event.includes('data: [DONE]')) {
              console.error('Received SSE [DONE] marker');
              continue;
            }
            
            // Process data events
            if (event.startsWith('data: ')) {
              try {
                // Extract the JSON string
                const jsonStr = event.substring(6).trim();
                // Skip empty data events
                if (!jsonStr) continue;
                
                // Parse the JSON
                const jsonObj = JSON.parse(jsonStr);
                
                // Handle different SSE formats
                // Format 1: OpenAI compatible delta format
                if (jsonObj.choices?.[0]?.delta?.content) {
                  fullContent += jsonObj.choices[0].delta.content;
                }
                // Format 2: Complete message format
                else if (jsonObj.choices?.[0]?.message?.content) {
                  fullContent += jsonObj.choices[0].message.content;
                }
                // Format 3: Raw content format (fallback)
                else if (jsonObj.content) {
                  fullContent += jsonObj.content;
                }
              } catch (e) {
                console.error(`Error parsing SSE event: ${e instanceof Error ? e.message : String(e)}`);
                // Continue processing other chunks even if one fails
              }
            }
          }
          
          // Extract sources from the full content
          const sourceMatch = fullContent.match(/\*\*Sources:\*\*\n((?:- `[^`]+`\n?)+)/);
          if (sourceMatch) {
            const sourceText = sourceMatch[1];
            const sourceRegex = /- `([^`]+)`/g;
            let match;
            while ((match = sourceRegex.exec(sourceText)) !== null) {
              sources.push(match[1]);
            }
          }
          
          console.error(`Successfully processed SSE stream with ${sources.length} sources`);
          console.error(`Content length: ${fullContent.length} characters`);
          
          return {
            content: fullContent,
            sources: sources
          };
        }
        
        // Fallback to JSON handling for non-SSE responses
        try {
          const data = await response.json();
          console.error("Received JSON response data");

          if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error("Invalid JSON response format");
            return { content: "Error: Invalid response format from API", statusCode: 500 };
          }

          const content = data.choices[0].message.content;

          // Quick extract of sources if they exist
          const sources = [];
          const sourceMatch = content.match(/\*\*Sources:\*\*\n((?:- `[^`]+`\n?)+)/);
          if (sourceMatch) {
            const sourceText = sourceMatch[1];
            const sourceRegex = /- `([^`]+)`/g;
            let match;
            while ((match = sourceRegex.exec(sourceText)) !== null) {
              sources.push(match[1]);
            }
          }

          console.error(`Successfully processed JSON response with ${sources.length} sources`);
          return {
            content: content,
            sources: sources
          };
        } catch (jsonError) {
          console.error("Error parsing response as JSON:", jsonError);
          
          // Last resort - try to handle as plain text
          const textResponse = await response.text();
          return {
            content: textResponse.substring(0, 2000),
            sources: []
          };
        }
      } finally {
        // Make sure we always clear the timeout
        clearTimeout(timeoutId);
      }
    } catch (error: unknown) {
      // Check if this is a timeout error
      const isTimeout = error instanceof Error && 
        (error.name === 'TimeoutError' || error.name === 'AbortError' || 
         error.message.includes('timeout') || error.message.includes('abort'));
      
      if (isTimeout) {
        timeoutRetryCount++;
        console.error(`Timeout error (timeout retry ${timeoutRetryCount}/${maxTimeoutRetries}):`, error);
        
        if (timeoutRetryCount < maxTimeoutRetries) {
          // Use a different backoff strategy for timeouts - shorter waits but more attempts
          const backoffMs = 1000 * timeoutRetryCount;
          console.error(`Retrying timeout in ${backoffMs/1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }
      } else {
        // For non-timeout errors, use standard retry logic
        lastError = error;
        retryCount++;
        
        console.error(`Error making Nia request (attempt ${retryCount}/${maxRetries}):`, error);
        
        if (retryCount < maxRetries) {
          // Exponential backoff: wait 2^retryCount seconds before retrying
          const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 10000);
          console.error(`Retrying in ${backoffMs/1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
      
      // Exit the loop if we've exceeded all retry attempts
      if (retryCount >= maxRetries && timeoutRetryCount >= maxTimeoutRetries) {
        break;
      }
    }
  }
  
  // All retries failed
  if (timeoutRetryCount >= maxTimeoutRetries) {
    console.error(`All ${timeoutRetryCount} timeout retries failed`);
    return { content: `Request timed out after ${timeoutRetryCount} attempts. The Nia API might be experiencing high load or the query is too complex.`, statusCode: 408 };
  } else {
    console.error(`All ${retryCount} retries failed`);
    return { content: `Error communicating with Nia API after ${retryCount} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`, statusCode: 500 };
  }
}

// Parse command line arguments
function parseArgs(args: string[]): {
  apiKey: string;
  transport: "stdio" | "sse";
  port: number;
} {
  const options: {
    apiKey?: string;
    transport?: "stdio" | "sse";
    port?: number;
    debug?: boolean;
  } = {};

  args.forEach((arg) => {
    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=");
      if (key === "api-key") {
        options.apiKey = value;
      } else if (key === "transport") {
        if (value !== "stdio" && value !== "sse") {
          throw new Error(`Invalid transport: ${value}. Accepted values: stdio, sse`);
        }
        options.transport = value;
      } else if (key === "port") {
        const port = parseInt(value, 10);
        if (isNaN(port)) {
          throw new Error(`Invalid port: ${value}. Port must be a number.`);
        }
        options.port = port;
      } else if (key === "debug") {
        options.debug = value === "true";
      }
    }
  });

  const apiKey = options.apiKey || process.env.NIA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Nia API key not provided. Please either pass it as --api-key=YOUR_KEY or set the NIA_API_KEY environment variable."
    );
  }

  debugMode = options.debug || false;
  const transport = (options.transport || process.env.TRANSPORT || "stdio") as "stdio" | "sse";
  const port = options.port || parseInt(process.env.PORT || "3000", 10);

  return { apiKey, transport, port };
}

// Start the server
async function main() {
  try {
    const { apiKey, transport, port } = parseArgs(process.argv.slice(2));
    globalApiKey = apiKey;

    // Print startup banner
    console.error(green("\n┌─────────────────────────────────────────────────────┐"));
    console.error(green("│                  Nia MCP Server                     │"));
    console.error(green("└─────────────────────────────────────────────────────┘\n"));
    console.error(green(`Version: 1.0.0`));
    console.error(green(`Transport: ${transport}`));
    if (transport === "sse") {
      console.error(green(`Port: ${port}`));
    }
    console.error(green(`Debug mode: ${debugMode ? "enabled" : "disabled"}`));
    console.error(green(`API endpoint: ${NIA_API_BASE}\n`));
    console.error(green(`Tool timeout: ${TOOL_TIMEOUT_MS}ms\n`));

    // Create server instance with improved settings
    const server = new McpServer({
      name: "nia-mcp",
      version: "1.0.0",
      requestTimeout: TOOL_TIMEOUT_MS  // Server-level request timeout (already 5 minutes)
    });

    // Define lookup tool with a higher timeout
    server.tool(
      `lookup_codebase_context`,
      "Look up context from a codebase indexed in Nia, retrieving relevant code snippets based on user queries.",
      {
        user_query: z.string().describe("A user's query about code, used to get relevant codebase context from the Nia-indexed repository associated with your API key."),
      },
      async ({ user_query }) => {
        const startTime = Date.now();
        
        if (debugMode) {
          console.error(`[${new Date().toISOString()}] Looking up context for query: ${user_query}`);
        }

        try {
          // Add progress indicator for long-running requests
          const progressInterval = setInterval(() => {
            const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
            if (debugMode) {
              console.error(`[${new Date().toISOString()}] Request in progress... (${elapsedSec}s elapsed)`);
            }
          }, 5000);

          try {
            // Use a custom timeout Promise.race for this specific tool
            const fetchPromise = fetchContextFromNia(user_query, globalApiKey);
            const timeoutPromise = new Promise<null>((_, reject) => 
              setTimeout(() => reject(new Error(`Operation timed out after ${TOOL_TIMEOUT_MS/1000} seconds`)), TOOL_TIMEOUT_MS)
            );
            
            // Use Promise.race and handle potential errors
            const result = await Promise.race([fetchPromise, timeoutPromise]);

            // Clear the progress indicator
            clearInterval(progressInterval);

            if (!result) {
              return {
                content: [
                  {
                    type: "text",
                    text: "Failed to retrieve context from Nia API",
                  },
                ],
              };
            }

            if (result.statusCode === 403 || result.statusCode === 401) {
              return {
                content: [
                  {
                    type: "text",
                    text: "Authentication error. Please make sure you're using a valid API key from your Nia account.",
                  },
                ],
              };
            }

            if (result.statusCode === 402) {
              return {
                content: [
                  {
                    type: "text",
                    text: "Error, you have exceeded your quota. Please upgrade to a Pro plan for unlimited usage.",
                  },
                ],
              };
            }

            if (result.statusCode) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Failed to retrieve context from Nia API: HTTP error ${result.statusCode}`,
                  },
                ],
              };
            }

            // Calculate some stats for logging
            const responseTime = Date.now() - startTime;
            const contentLength = result.content.length;
            const sourceCount = result.sources?.length || 0;
            
            if (debugMode) {
              console.error(`[${new Date().toISOString()}] Request completed in ${responseTime}ms, content length: ${contentLength} chars, sources: ${sourceCount}`);
            }

            // Format the response with optimized delivery for quick client-side display
            let responseText = `Context for "${user_query}":\n\n`;
            
            // For very long content, trim and add a note
            const maxResponseLength = 10000; // Characters
            let trimmedContent = result.content;
            if (result.content.length > maxResponseLength) {
              // Find a good break point at a paragraph
              const breakPoint = result.content.lastIndexOf("\n\n", maxResponseLength);
              if (breakPoint > maxResponseLength * 0.75) {
                trimmedContent = result.content.substring(0, breakPoint) + 
                  "\n\n[Content trimmed for display. The original response was " + 
                  result.content.length + " characters long.]";
              } else {
                trimmedContent = result.content.substring(0, maxResponseLength) + 
                  "...\n\n[Content trimmed for display. The original response was " + 
                  result.content.length + " characters long.]";
              }
            }
            
            responseText += trimmedContent;
            
            // Add sources if they exist
            if (result.sources && result.sources.length > 0) {
              responseText += "\n\nSources:\n" + result.sources.map(src => `- ${src}`).join('\n');
            }

            return {
              content: [{ type: "text", text: responseText }],
            };
          } finally {
            clearInterval(progressInterval);
          }
        } catch (error) {
          console.error(`[${new Date().toISOString()}] Error in lookup_codebase_context tool:`, error);
          return {
            content: [
              {
                type: "text",
                text: `An error occurred while processing your request: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    );

    if (transport === "stdio") {
      // Use stdio transport
      const stdioTransport = new StdioServerTransport();
      await server.connect(stdioTransport);
      console.error(green("✅ Nia MCP Server running on stdio"));
      console.error(green("   Ready to receive requests"));
    } else if (transport === "sse") {
      // Use SSE transport with Express
      const app = express();
      let sseTransport: SSEServerTransport | null = null;

      // Add CORS support for dev environments
      app.use(cors({
        origin: "*",
        methods: ["GET", "POST"],
        allowedHeaders: ["Content-Type", "Authorization"]
      }));
      
      // Utility functions to work around TypeScript errors
      const safeGet = (path: string, handler: (req: Request, res: Response) => void) => {
        app.get(path, (req, res) => handler(req as Request, res as Response));
      };
      
      const safePost = (path: string, handler: (req: Request, res: Response) => void) => {
        app.post(path, (req, res) => handler(req as Request, res as Response));
      };

      // Add a simple status endpoint
      safeGet("/", (req: Request, res: Response) => {
        res.send(`
          <html>
            <head><title>Nia MCP Server</title></head>
            <body>
              <h1>Nia MCP Server</h1>
              <p>Status: Running</p>
              <p>Connect to /sse to establish SSE connection</p>
              <p>Send messages to /messages</p>
            </body>
          </html>
        `);
      });

      // Improved SSE endpoint with better error handling
      safeGet("/sse", (req: Request, res: Response) => {
        try {
          // Close any existing connection
          if (sseTransport) {
            console.error(yellow("⚠️ Closing existing SSE connection"));
            try {
              // Attempt to gracefully close the previous connection
              sseTransport = null;
            } catch (e) {
              console.error("Error closing previous SSE connection:", e);
            }
          }
          
          // Get the transport type from query parameters (for compatibility with MCP Inspector)
          const transportType = req.query.transportType as string | undefined;
          if (transportType && transportType !== 'sse') {
            console.error(red(`❌ Error: Invalid transport type requested: ${transportType}`));
            console.error(yellow("   The MCP Inspector may be trying to use an incompatible transport."));
            console.error(yellow("   Try running the Inspector with: npx @modelcontextprotocol/inspector --transport=sse node dist/index.js"));
            return res.status(400).send(`Invalid transport type: ${transportType}`);
          }
          
          // Set up headers for SSE
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");
          
          // Create new transport
          sseTransport = new SSEServerTransport("/messages", res);
          server.connect(sseTransport);
          console.error(green(`✅ SSE connection established`));
          
          // Handle client disconnect
          req.on("close", () => {
            console.error(yellow("⚠️ SSE connection closed by client"));
            sseTransport = null;
          });
        } catch (error) {
          console.error(red(`❌ Error in SSE connection: ${error instanceof Error ? error.message : String(error)}`));
          res.status(500).send(`SSE connection error: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

      // Improved message handling with better error reporting
      safePost("/messages", (req: Request, res: Response) => {
        if (sseTransport) {
          try {
            sseTransport.handlePostMessage(req, res);
          } catch (error) {
            console.error("Error handling message:", error);
            res.status(500).send({
              error: "Internal server error",
              message: error instanceof Error ? error.message : String(error)
            });
          }
        } else {
          console.error(red("❌ Error: Received message but no SSE connection is established"));
          res.status(400).send({
            error: "No SSE connection established",
            message: "Connect to /sse before sending messages"
          });
        }
      });

      // Add a health check endpoint
      safeGet("/health", (req: Request, res: Response) => {
        res.status(200).json({
          status: "ok",
          version: "1.0.0",
          transport: "sse",
          connection: sseTransport ? "established" : "none"
        });
      });

      // Start listening
      app.listen(port, () => {
        console.error(green(`✅ Nia MCP Server running on SSE at http://localhost:${port}`));
        console.error(green(`   - Connect to /sse to establish SSE connection`));
        console.error(green(`   - Send messages to /messages`));
        console.error(green(`   - Health check at /health`));
      });
    }

    console.error(green("\nServer is ready to process requests!\n"));
  } catch (error) {
    console.error(red("\n🚨 Error initializing Nia MCP server:\n"));
    console.error(yellow(`   ${error instanceof Error ? error.message : String(error)}\n`));
    process.exit(1);
  }
}

// Run the main function directly
main();