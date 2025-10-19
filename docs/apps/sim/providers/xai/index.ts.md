```typescript
import OpenAI from 'openai'
import { createLogger } from '@/lib/logs/console/logger'
import type { StreamingExecution } from '@/executor/types'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'
import {
  prepareToolExecution,
  prepareToolsWithUsageControl,
  trackForcedToolUsage,
} from '@/providers/utils'
import { executeTool } from '@/tools'

const logger = createLogger('XAIProvider')

/**
 * Helper to wrap XAI (OpenAI-compatible) streaming into a browser-friendly
 * ReadableStream of raw assistant text chunks.
 */
function createReadableStreamFromXAIStream(xaiStream: any): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of xaiStream) {
          const content = chunk.choices[0]?.delta?.content || ''
          if (content) {
            controller.enqueue(new TextEncoder().encode(content))
          }
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}

export const xAIProvider: ProviderConfig = {
  id: 'xai',
  name: 'xAI',
  description: "xAI's Grok models",
  version: '1.0.0',
  models: getProviderModels('xai'),
  defaultModel: getProviderDefaultModel('xai'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for xAI')
    }

    const xai = new OpenAI({
      apiKey: request.apiKey,
      baseURL: 'https://api.x.ai/v1',
    })

    logger.info('XAI Provider - Initial request configuration:', {
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      model: request.model || 'grok-3-latest',
      streaming: !!request.stream,
    })

    const allMessages: any[] = []

    if (request.systemPrompt) {
      allMessages.push({
        role: 'system',
        content: request.systemPrompt,
      })
    }

    if (request.context) {
      allMessages.push({
        role: 'user',
        content: request.context,
      })
    }

    if (request.messages) {
      allMessages.push(...request.messages)
    }

    // Set up tools
    const tools = request.tools?.length
      ? request.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.id,
            description: tool.description,
            parameters: tool.parameters,
          },
        }))
      : undefined

    // Log tools and response format conflict detection
    if (tools?.length && request.responseFormat) {
      logger.warn(
        'XAI Provider - Detected both tools and response format. Using tools first, then response format for final response.'
      )
    }

    // Build the base request payload
    const basePayload: any = {
      model: request.model || 'grok-3-latest',
      messages: allMessages,
    }

    if (request.temperature !== undefined) basePayload.temperature = request.temperature
    if (request.maxTokens !== undefined) basePayload.max_tokens = request.maxTokens

    // Function to create response format configuration
    const createResponseFormatPayload = (messages: any[] = allMessages) => {
      const payload = {
        ...basePayload,
        messages,
      }

      if (request.responseFormat) {
        payload.response_format = {
          type: 'json_schema',
          json_schema: {
            name: request.responseFormat.name || 'structured_response',
            schema: request.responseFormat.schema || request.responseFormat,
            strict: request.responseFormat.strict !== false,
          },
        }
      }

      return payload
    }

    // Handle tools and tool usage control
    let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

    if (tools?.length) {
      preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'xai')
    }

    // EARLY STREAMING: if caller requested streaming and there are no tools to execute,
    // we can directly stream the completion with response format if needed
    if (request.stream && (!tools || tools.length === 0)) {
      logger.info('XAI Provider - Using direct streaming (no tools)')

      // Start execution timer for the entire provider execution
      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      // Use response format payload if needed, otherwise use base payload
      const streamingPayload = request.responseFormat
        ? createResponseFormatPayload()
        : { ...basePayload, stream: true }

      if (!request.responseFormat) {
        streamingPayload.stream = true
      } else {
        streamingPayload.stream = true
      }

      const streamResponse = await xai.chat.completions.create(streamingPayload)

      // Start collecting token usage
      const tokenUsage = {
        prompt: 0,
        completion: 0,
        total: 0,
      }

      // Create a StreamingExecution response with a readable stream
      const streamingResult = {
        stream: createReadableStreamFromXAIStream(streamResponse),
        execution: {
          success: true,
          output: {
            content: '', // Will be filled by streaming content in chat component
            model: request.model || 'grok-3-latest',
            tokens: tokenUsage,
            toolCalls: undefined,
            providerTiming: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
              timeSegments: [
                {
                  type: 'model',
                  name: 'Streaming response',
                  startTime: providerStartTime,
                  endTime: Date.now(),
                  duration: Date.now() - providerStartTime,
                },
              ],
            },
            // Estimate token cost
            cost: {
              total: 0.0,
              input: 0.0,
              output: 0.0,
            },
          },
          logs: [], // No block logs for direct streaming
          metadata: {
            startTime: providerStartTimeISO,
            endTime: new Date().toISOString(),
            duration: Date.now() - providerStartTime,
          },
          isStreaming: true,
        },
      }

      // Return the streaming execution object
      return streamingResult as StreamingExecution
    }

    // Start execution timer for the entire provider execution
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      // Make the initial API request
      const initialCallTime = Date.now()

      // For the initial request with tools, we NEVER include response_format
      // This is the key fix: tools and response_format cannot be used together with xAI
      const initialPayload = { ...basePayload }

      // Track the original tool_choice for forced tool tracking
      let originalToolChoice: any

      // Track forced tools and their usage
      const forcedTools = preparedTools?.forcedTools || []
      let usedForcedTools: string[] = []

      if (preparedTools?.tools?.length && preparedTools.toolChoice) {
        const { tools: filteredTools, toolChoice } = preparedTools
        initialPayload.tools = filteredTools
        initialPayload.tool_choice = toolChoice
        originalToolChoice = toolChoice
      } else if (request.responseFormat) {
        // Only add response format if there are no tools
        const responseFormatPayload = createResponseFormatPayload()
        Object.assign(initialPayload, responseFormatPayload)
      }

      let currentResponse = await xai.chat.completions.create(initialPayload)
      const firstResponseTime = Date.now() - initialCallTime

      let content = currentResponse.choices[0]?.message?.content || ''
      const tokens = {
        prompt: currentResponse.usage?.prompt_tokens || 0,
        completion: currentResponse.usage?.completion_tokens || 0,
        total: currentResponse.usage?.total_tokens || 0,
      }
      const toolCalls = []
      const toolResults = []
      const currentMessages = [...allMessages]
      let iterationCount = 0
      const MAX_ITERATIONS = 10

      // Track if a forced tool has been used
      let hasUsedForcedTool = false

      // Track time spent in model vs tools
      let modelTime = firstResponseTime
      let toolsTime = 0

      // Track each model and tool call segment with timestamps
      const timeSegments: TimeSegment[] = [
        {
          type: 'model',
          name: 'Initial response',
          startTime: initialCallTime,
          endTime: initialCallTime + firstResponseTime,
          duration: firstResponseTime,
        },
      ]

      // Helper function to check for forced tool usage in responses
      const checkForForcedToolUsage = (
        response: any,
        toolChoice: string | { type: string; function?: { name: string }; name?: string; any?: any }
      ) => {
        if (typeof toolChoice === 'object' && response.choices[0]?.message?.tool_calls) {
          const toolCallsResponse = response.choices[0].message.tool_calls
          const result = trackForcedToolUsage(
            toolCallsResponse,
            toolChoice,
            logger,
            'xai',
            forcedTools,
            usedForcedTools
          )
          hasUsedForcedTool = result.hasUsedForcedTool
          usedForcedTools = result.usedForcedTools
        }
      }

      // Check if a forced tool was used in the first response
      if (originalToolChoice) {
        checkForForcedToolUsage(currentResponse, originalToolChoice)
      }

      try {
        while (iterationCount < MAX_ITERATIONS) {
          // Check for tool calls
          const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls
          if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
            break
          }

          // Track time for tool calls in this batch
          const toolsStartTime = Date.now()

          for (const toolCall of toolCallsInResponse) {
            try {
              const toolName = toolCall.function.name
              const toolArgs = JSON.parse(toolCall.function.arguments)

              const tool = request.tools?.find((t) => t.id === toolName)
              if (!tool) {
                logger.warn('XAI Provider - Tool not found:', { toolName })
                continue
              }

              const toolCallStartTime = Date.now()

              const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)

              const result = await executeTool(toolName, executionParams, true)
              const toolCallEndTime = Date.now()
              const toolCallDuration = toolCallEndTime - toolCallStartTime

              // Add to time segments for both success and failure
              timeSegments.push({
                type: 'tool',
                name: toolName,
                startTime: toolCallStartTime,
                endTime: toolCallEndTime,
                duration: toolCallDuration,
              })

              // Prepare result content for the LLM
              let resultContent: any
              if (result.success) {
                toolResults.push(result.output)
                resultContent = result.output
              } else {
                // Include error information so LLM can respond appropriately
                resultContent = {
                  error: true,
                  message: result.error || 'Tool execution failed',
                  tool: toolName,
                }

                logger.warn('XAI Provider - Tool execution failed:', {
                  toolName,
                  error: result.error,
                })
              }

              toolCalls.push({
                name: toolName,
                arguments: toolParams,
                startTime: new Date(toolCallStartTime).toISOString(),
                endTime: new Date(toolCallEndTime).toISOString(),
                duration: toolCallDuration,
                result: resultContent,
                success: result.success,
              })

              // Add the tool call and result to messages (both success and failure)
              currentMessages.push({
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: toolCall.id,
                    type: 'function',
                    function: {
                      name: toolName,
                      arguments: toolCall.function.arguments,
                    },
                  },
                ],
              })

              currentMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(resultContent),
              })
            } catch (error) {
              logger.error('XAI Provider - Error processing tool call:', {
                error: error instanceof Error ? error.message : String(error),
                toolCall: toolCall.function.name,
              })
            }
          }

          // Calculate tool call time for this iteration
          const thisToolsTime = Date.now() - toolsStartTime
          toolsTime += thisToolsTime

          // After tool calls, create next payload based on whether we need more tools or final response
          let nextPayload: any

          // Update tool_choice based on which forced tools have been used
          if (
            typeof originalToolChoice === 'object' &&
            hasUsedForcedTool &&
            forcedTools.length > 0
          ) {
            // If we have remaining forced tools, get the next one to force
            const remainingTools = forcedTools.filter((tool) => !usedForcedTools.includes(tool))

            if (remainingTools.length > 0) {
              // Force the next tool - continue with tools, no response format
              nextPayload = {
                ...basePayload,
                messages: currentMessages,
                tools: preparedTools?.tools,
                tool_choice: {
                  type: 'function',
                  function: { name: remainingTools[0] },
                },
              }
            } else {
              // All forced tools have been used, check if we need response format for final response
              if (request.responseFormat) {
                nextPayload = createResponseFormatPayload(currentMessages)
              } else {
                nextPayload = {
                  ...basePayload,
                  messages: currentMessages,
                  tool_choice: 'auto',
                  tools: preparedTools?.tools,
                }
              }
            }
          } else {
            // Normal tool processing - check if this might be the final response
            if (request.responseFormat) {
              // Use response format for what might be the final response
              nextPayload = createResponseFormatPayload(currentMessages)
            } else {
              nextPayload = {
                ...basePayload,
                messages: currentMessages,
                tools: preparedTools?.tools,
                tool_choice: 'auto',
              }
            }
          }

          // Time the next model call
          const nextModelStartTime = Date.now()

          currentResponse = await xai.chat.completions.create(nextPayload)

          // Check if any forced tools were used in this response
          if (nextPayload.tool_choice && typeof nextPayload.tool_choice === 'object') {
            checkForForcedToolUsage(currentResponse, nextPayload.tool_choice)
          }

          const nextModelEndTime = Date.now()
          const thisModelTime = nextModelEndTime - nextModelStartTime

          // Add to time segments
          timeSegments.push({
            type: 'model',
            name: `Model response (iteration ${iterationCount + 1})`,
            startTime: nextModelStartTime,
            endTime: nextModelEndTime,
            duration: thisModelTime,
          })

          // Add to model time
          modelTime += thisModelTime

          if (currentResponse.choices[0]?.message?.content) {
            content = currentResponse.choices[0].message.content
          }

          if (currentResponse.usage) {
            tokens.prompt += currentResponse.usage.prompt_tokens || 0
            tokens.completion += currentResponse.usage.completion_tokens || 0
            tokens.total += currentResponse.usage.total_tokens || 0
          }

          iterationCount++
        }
      } catch (error) {
        logger.error('XAI Provider - Error in tool processing loop:', {
          error: error instanceof Error ? error.message : String(error),
          iterationCount,
        })
      }

      // After all tool processing complete, if streaming was requested and we have messages, use streaming for the final response
      if (request.stream && iterationCount > 0) {
        // For final streaming response, choose between tools (auto) or response_format (never both)
        let finalStreamingPayload: any

        if (request.responseFormat) {
          // Use response format, no tools
          finalStreamingPayload = {
            ...createResponseFormatPayload(currentMessages),
            stream: true,
          }
        } else {
          // Use tools with auto choice
          finalStreamingPayload = {
            ...basePayload,
            messages: currentMessages,
            tool_choice: 'auto',
            tools: preparedTools?.tools,
            stream: true,
          }
        }

        const streamResponse = await xai.chat.completions.create(finalStreamingPayload)

        // Create a StreamingExecution response with all collected data
        const streamingResult = {
          stream: createReadableStreamFromXAIStream(streamResponse),
          execution: {
            success: true,
            output: {
              content: '', // Will be filled by the callback
              model: request.model || 'grok-3-latest',
              tokens: {
                prompt: tokens.prompt,
                completion: tokens.completion,
                total: tokens.total,
              },
              toolCalls:
                toolCalls.length > 0
                  ? {
                      list: toolCalls,
                      count: toolCalls.length,
                    }
                  : undefined,
              providerTiming: {
                startTime: providerStartTimeISO,
                endTime: new Date().toISOString(),
                duration: Date.now() - providerStartTime,
                modelTime: modelTime,
                toolsTime: toolsTime,
                firstResponseTime: firstResponseTime,
                iterations: iterationCount + 1,
                timeSegments: timeSegments,
              },
              cost: {
                total: (tokens.total || 0) * 0.0001,
                input: (tokens.prompt || 0) * 0.0001,
                output: (tokens.completion || 0) * 0.0001,
              },
            },
            logs: [], // No block logs at provider level
            metadata: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
            },
            isStreaming: true,
          },
        }

        // Return the streaming execution object
        return streamingResult as StreamingExecution
      }

      // Calculate overall timing
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      logger.info('XAI Provider - Request completed:', {
        totalDuration,
        iterationCount: iterationCount + 1,
        toolCallCount: toolCalls.length,
        hasContent: !!content,
        contentLength: content?.length || 0,
      })

      return {
        content,
        model: request.model,
        tokens,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
        timing: {
          startTime: providerStartTimeISO,
          endTime: providerEndTimeISO,
          duration: totalDuration,
          modelTime: modelTime,
          toolsTime: toolsTime,
          firstResponseTime: firstResponseTime,
          iterations: iterationCount + 1,
          timeSegments: timeSegments,
        },
      }
    } catch (error) {
      // Include timing information even for errors
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      logger.error('XAI Provider - Request failed:', {
        error: error instanceof Error ? error.message : String(error),
        duration: totalDuration,
        hasTools: !!tools?.length,
        hasResponseFormat: !!request.responseFormat,
      })

      // Create a new error with timing information
      const enhancedError = new Error(error instanceof Error ? error.message : String(error))
      // @ts-ignore - Adding timing property to the error
      enhancedError.timing = {
        startTime: providerStartTimeISO,
        endTime: providerEndTimeISO,
        duration: totalDuration,
      }

      throw enhancedError
    }
  },
}
```

## Detailed Explanation of the `xAIProvider.ts` File

This file defines a provider configuration for interacting with xAI's Grok models (compatible with the OpenAI API).  It handles sending requests to the xAI API, managing tools, and formatting responses. The core functionality is encapsulated within the `xAIProvider` object.

**Purpose:**

The primary purpose of this file is to provide a standardized way to interact with xAI's Grok models within a larger application or system. It abstracts away the complexities of interacting directly with the xAI API, handling authentication, request formatting, tool execution, and response parsing.  It supports both standard request/response flows and streaming responses.  A key part of the purpose is handling the conflict between `tools` and `response_format` that the xAI API has, by prioritizing `tools` over `response_format` in the initial call.

**Key Concepts and Logic:**

1.  **Provider Configuration:** The `xAIProvider` object conforms to the `ProviderConfig` type, which likely defines a contract for how different LLM providers (e.g., OpenAI, Anthropic) should be integrated into the system. This configuration includes metadata (ID, name, description, version, models) and the crucial `executeRequest` function.

2.  **`executeRequest` Function:** This is the heart of the provider. It takes a `ProviderRequest` object (containing user input, system prompts, tools, etc.) and returns a `ProviderResponse` (a complete response) or a `StreamingExecution` (a streaming response).

3.  **OpenAI Compatibility:** The code leverages the `openai` npm package to interact with the xAI API.  The API is treated as OpenAI-compatible, with a different `baseURL`.

4.  **Request Preparation:** The code constructs the request payload for the xAI API, including:
    *   API key authentication.
    *   Combining system prompts, context, and user messages into a single `messages` array.
    *   Converting tool definitions into the format expected by the xAI API.
    *   Setting parameters like `model`, `temperature`, and `max_tokens`.
    *   Handling `response_format` requests.

5.  **Tool Handling:** The code carefully manages tools:
    *   It uses `prepareToolsWithUsageControl` to filter tools, manage forced tool usage, and create a `tool_choice` parameter if needed.
    *   It executes tools using `executeTool` and incorporates their results back into the conversation.
    *   It handles tool execution errors gracefully.
    *   It tracks the time spent in tools execution.

6.  **Streaming Support:** The code supports streaming responses from xAI:
    *   It uses `createReadableStreamFromXAIStream` to convert the xAI stream into a browser-friendly `ReadableStream`.
    *   It handles the case where streaming is requested *without* tools directly.
    *   If streaming is requested *with* tools, it streams only the final response after the tool orchestration loop completes.

7.  **Tool and Response Format Conflict Resolution:**  The xAI API does not support the simultaneous use of `tools` and `response_format`.  This code prioritizes using `tools` in the initial request. Only when the tool orchestration loop finishes does it then optionally use `response_format` on the final streamed response.

8.  **Forced Tool Usage:** The code implements a mechanism to *force* the LLM to use specific tools, iterating through a list of tools.

9.  **Timing and Logging:** The code includes extensive logging and timing information to help debug and monitor the provider's performance.  It tracks the time spent in model calls, tool executions, and the overall request.  The `timeSegments` array provides a detailed breakdown of the request's execution timeline.

10. **Error Handling:** The code includes comprehensive error handling to catch potential issues during the request processing.  It logs errors and includes timing information in the error object to help diagnose problems.

**Code Breakdown (Line by Line):**

```typescript
import OpenAI from 'openai'
// Imports the OpenAI library, which is used to interact with the xAI API (as xAI is OpenAI-compatible).

import { createLogger } from '@/lib/logs/console/logger'
// Imports a function to create a logger for logging information and errors.  The logger is likely configured to write to the console.

import type { StreamingExecution } from '@/executor/types'
// Imports the `StreamingExecution` type, which represents a streaming response from the provider.  The `type` keyword specifies this is a type import.

import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
// Imports functions to get the default model and available models for the xAI provider.  These functions likely read from a configuration file or database.

import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'
// Imports type definitions for `ProviderConfig`, `ProviderRequest`, `ProviderResponse`, and `TimeSegment`. These types define the structure of the provider configuration, requests, responses, and timing information.

import {
  prepareToolExecution,
  prepareToolsWithUsageControl,
  trackForcedToolUsage,
} from '@/providers/utils'
// Imports utility functions for tool handling:
//   - `prepareToolExecution`: Prepares tool parameters for execution.
//   - `prepareToolsWithUsageControl`: Filters tools, manages forced tool usage, and creates a `tool_choice` parameter.
//   - `trackForcedToolUsage`: Tracks which forced tools have been used.

import { executeTool } from '@/tools'
// Imports the `executeTool` function, which executes a tool given its name and parameters.

const logger = createLogger('XAIProvider')
// Creates a logger instance specifically for the xAI provider.  The string 'XAIProvider' is used as a prefix for log messages.

/**
 * Helper to wrap XAI (OpenAI-compatible) streaming into a browser-friendly
 * ReadableStream of raw assistant text chunks.
 */
function createReadableStreamFromXAIStream(xaiStream: any): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of xaiStream) {
          const content = chunk.choices[0]?.delta?.content || ''
          if (content) {
            controller.enqueue(new TextEncoder().encode(content))
          }
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}
// This function converts a stream from the xAI/OpenAI API (which might not be directly usable in a browser) into a standard `ReadableStream` that can be consumed by browser-based components.
// It iterates through the chunks of the stream, extracts the content, encodes it as text, and enqueues it into the `ReadableStream`.

export const xAIProvider: ProviderConfig = {
// Defines the `xAIProvider` object, which implements the `ProviderConfig` interface.  This is the main configuration object for the xAI provider.
  id: 'xai',
  // A unique identifier for the provider.
  name: 'xAI',
  // The human-readable name of the provider.
  description: "xAI's Grok models",
  // A brief description of the provider.
  version: '1.0.0',
  // The version of the provider configuration.
  models: getProviderModels('xai'),
  // The list of supported models for the xAI provider, obtained from the `getProviderModels` function.
  defaultModel: getProviderDefaultModel('xai'),
  // The default model to use for the xAI provider, obtained from the `getProviderDefaultModel` function.

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    // The main function that executes a request to the xAI provider. It takes a `ProviderRequest` as input and returns either a `ProviderResponse` or a `StreamingExecution`.
    if (!request.apiKey) {
      throw new Error('API key is required for xAI')
    }
    // Checks if an API key is provided in the request. If not, it throws an error.

    const xai = new OpenAI({
      apiKey: request.apiKey,
      baseURL: 'https://api.x.ai/v1',
    })
    // Creates an instance of the OpenAI client, configuring it with the API key and the base URL for the xAI API.

    logger.info('XAI Provider - Initial request configuration:', {
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      model: request.model || 'grok-3-latest',
      streaming: !!request.stream,
    })
    // Logs the initial configuration of the request, including whether tools are used, the tool count, whether a response format is specified, the model, and whether streaming is enabled.

    const allMessages: any[] = []
    // Initializes an array to hold all messages for the API request (system prompt, context, user messages).

    if (request.systemPrompt) {
      allMessages.push({
        role: 'system',
        content: request.systemPrompt,
      })
    }
    // If a system prompt is provided in the request, it is added to the `allMessages` array with the "system" role.

    if (request.context) {
      allMessages.push({
        role: 'user',
        content: request.context,
      })
    }
    // If context is provided in the request, it is added to the `allMessages` array with the "user" role.

    if (request.messages) {
      allMessages.push(...request.messages)
    }
    // If user messages are provided in the request, they are added to the `allMessages` array. The spread operator (`...`) is used to append all messages at once.

    // Set up tools
    const tools = request.tools?.length
      ? request.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.id,
            description: tool.description,
            parameters: tool.parameters,
          },
        }))
      : undefined
    // Converts the tool definitions from the `request` into the format expected by the OpenAI/xAI API. Each tool is transformed into an object with `type: 'function'` and a `function` property containing the tool's name, description, and parameters.

    // Log tools and response format conflict detection
    if (tools?.length && request.responseFormat) {
      logger.warn(
        'XAI Provider - Detected both tools and response format. Using tools first, then response format for final response.'
      )
    }
    // Logs a warning if both tools and a response format are specified, indicating that the tools will be used first and the response format will only be applied to the final response if possible.

    // Build the base request payload
    const basePayload: any = {
      model: request.model || 'grok-3-latest',
      messages: allMessages,
    }
    // Creates the base payload for the API request, including the model and the combined messages. If a model is not specified in the request, it defaults to 'grok-3-latest'.

    if (request.temperature !== undefined) basePayload.temperature = request.temperature
    if (request.maxTokens !== undefined) basePayload.max_tokens = request.maxTokens
    // Adds the temperature and max_tokens parameters to the base payload if they are provided in the request.

    // Function to create response format configuration
    const createResponseFormatPayload = (messages: any[] = allMessages) => {
      const payload = {
        ...basePayload,
        messages,
      }

      if (request.responseFormat) {
        payload.response_format = {
          type: 'json_schema',
          json_schema: {
            name: request.responseFormat.name || 'structured_response',
            schema: request.responseFormat.schema || request.responseFormat,
            strict: request.responseFormat.strict !== false,
          },
        }
      }

      return payload
    }
    // This function creates the `response_format` section of the payload, used to request the LLM to respond in a structured format.

    // Handle tools and tool usage control
    let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

    if (tools?.length) {
      preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'xai')
    }
    // Calls the `prepareToolsWithUsageControl` function to filter and prepare the tools for execution.

    // EARLY STREAMING: if caller requested streaming and there are no tools to execute,
    // we can directly stream the completion with response format if needed
    if (request.stream && (!tools || tools.length === 0)) {
      logger.info('XAI Provider - Using direct streaming (no tools)')

      // Start execution timer for the entire provider execution
      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      // Use response format payload if needed, otherwise use base payload
      const streamingPayload = request.responseFormat
        ? createResponseFormatPayload()
        : { ...basePayload, stream: true }

      if (!request.responseFormat) {
        streamingPayload.stream = true
      } else {
        streamingPayload.stream = true
      }

      const streamResponse = await xai.chat.completions.create(streamingPayload)

      // Start collecting token usage
      const tokenUsage = {
        prompt: 0,
        completion: 0,
        total: 0,
      }

      // Create a StreamingExecution response with a readable stream
      const streamingResult = {
        stream: createReadableStreamFromXAIStream(streamResponse),
        execution: {
          success: true,
          output: {
            content: '', // Will be filled by streaming content in chat component
            model: request.model || 'grok-3