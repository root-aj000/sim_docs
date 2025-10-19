```typescript
import OpenAI from 'openai'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import type { StreamingExecution } from '@/executor/types'
import type { ModelsObject } from '@/providers/ollama/types'
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
import { useProvidersStore } from '@/stores/providers/store'
import { executeTool } from '@/tools'

// Create a logger instance specifically for the Ollama provider.  This allows for easy filtering of logs related to this provider.
const logger = createLogger('OllamaProvider')

// Retrieve the Ollama host URL from environment variables.  If not found, default to 'http://localhost:11434'.  This allows configuring the Ollama server's location.
const OLLAMA_HOST = env.OLLAMA_URL || 'http://localhost:11434'

/**
 * Helper function to convert an Ollama stream to a standard ReadableStream
 * and collect completion metrics
 *
 * This function bridges the gap between Ollama's streaming format and the standard ReadableStream used by other parts of the application.
 * It also accumulates the complete content and usage data from the stream.
 */
function createReadableStreamFromOllamaStream(
  ollamaStream: any,
  onComplete?: (content: string, usage?: any) => void
): ReadableStream {
  // Accumulates the complete content from the stream chunks.
  let fullContent = ''
  // Stores the usage data (e.g., token counts) received in the final chunk of the stream.
  let usageData: any = null

  // Creates a new ReadableStream to provide a standardized stream interface.
  return new ReadableStream({
    // The `start` method is called when the stream is initialized.  It sets up the asynchronous iteration over the Ollama stream.
    async start(controller) {
      try {
        // Iterate over each chunk of data received from the Ollama stream.  The `for await...of` loop handles asynchronous iteration.
        for await (const chunk of ollamaStream) {
          // Check for usage data in the final chunk.  The Ollama API includes usage information in a special `usage` property of the last chunk.
          if (chunk.usage) {
            usageData = chunk.usage
          }

          // Extract the content from the chunk.  Ollama returns the content within the `choices` array, under `delta.content`. If the `delta.content` field isn't present, then return an empty string.
          const content = chunk.choices[0]?.delta?.content || ''
          // If the chunk contains content, append it to `fullContent` and enqueue it to the stream controller.
          if (content) {
            fullContent += content
            // Encode the content as UTF-8 and enqueue it to the stream controller.
            controller.enqueue(new TextEncoder().encode(content))
          }
        }

        // Once the stream is complete, call the completion callback with the final content and usage data.
        if (onComplete) {
          onComplete(fullContent, usageData)
        }

        // Close the stream, signaling that no more data will be sent.
        controller.close()
      } catch (error) {
        // If an error occurs during stream processing, report it to the stream controller.
        controller.error(error)
      }
    },
  })
}

// Define the Ollama provider configuration.  This object encapsulates all the information and functionality needed to interact with the Ollama server.
export const ollamaProvider: ProviderConfig = {
  // Unique identifier for the provider.
  id: 'ollama',
  // Human-readable name of the provider.
  name: 'Ollama',
  // A brief description of the provider's purpose.
  description: 'Local Ollama server for LLM inference',
  // Version number of the provider.
  version: '1.0.0',
  // Array of supported models.  This will be populated dynamically during initialization.
  models: [], // Will be populated dynamically
  // Default model to use if none is specified in the request.
  defaultModel: '',

  // `initialize` method: Fetches available models from the Ollama server.
  async initialize() {
    // Check if the code is running in a browser environment.  If so, skip initialization to prevent CORS issues.
    if (typeof window !== 'undefined') {
      logger.info('Skipping Ollama initialization on client side to avoid CORS issues')
      return
    }

    try {
      // Make a request to the Ollama API to retrieve the list of available models.
      const response = await fetch(`${OLLAMA_HOST}/api/tags`)
      // If the response is not successful, log a warning and disable the provider.
      if (!response.ok) {
        // Update the provider store with an empty array of models for 'ollama'.
        useProvidersStore.getState().setModels('ollama', [])
        logger.warn('Ollama service is not available. The provider will be disabled.')
        return
      }
      // Parse the response as JSON.  The expected format is an object with a `models` property, which is an array of model objects.
      const data = (await response.json()) as ModelsObject
      // Extract the model names from the response and update the `models` property of the provider configuration.
      this.models = data.models.map((model) => model.name)
      // Update the provider store with the list of available models for 'ollama'.
      useProvidersStore.getState().setModels('ollama', this.models)
    } catch (error) {
      // If an error occurs during initialization, log a warning and disable the provider.
      logger.warn('Ollama model instantiation failed. The provider will be disabled.', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  },

  // `executeRequest` method: Executes a request to the Ollama server.
  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    // Log the details of the incoming request for debugging purposes.
    logger.info('Preparing Ollama request', {
      model: request.model,
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      stream: !!request.stream,
    })

    // Create Ollama client using OpenAI-compatible API.  This leverages the OpenAI client library to interact with the Ollama server, which exposes an OpenAI-compatible API.
    const ollama = new OpenAI({
      // Use a dummy API key, as Ollama does not require one.
      apiKey: 'empty',
      // Set the base URL to the Ollama server's address.
      baseURL: `${OLLAMA_HOST}/v1`,
    })

    // Start with an empty array for all messages
    const allMessages = []

    // Add system prompt if present
    if (request.systemPrompt) {
      allMessages.push({
        role: 'system',
        content: request.systemPrompt,
      })
    }

    // Add context if present
    if (request.context) {
      allMessages.push({
        role: 'user',
        content: request.context,
      })
    }

    // Add remaining messages
    if (request.messages) {
      allMessages.push(...request.messages)
    }

    // Transform tools to OpenAI format if provided
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

    // Build the request payload
    const payload: any = {
      model: request.model,
      messages: allMessages,
    }

    // Add optional parameters
    if (request.temperature !== undefined) payload.temperature = request.temperature
    if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

    // Add response format for structured output if specified
    if (request.responseFormat) {
      // Use OpenAI's JSON schema format (Ollama supports this)
      payload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: request.responseFormat.name || 'response_schema',
          schema: request.responseFormat.schema || request.responseFormat,
          strict: request.responseFormat.strict !== false,
        },
      }

      logger.info('Added JSON schema response format to Ollama request')
    }

    // Handle tools and tool usage control
    let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

    // If tools are provided, prepare them for use with the LLM.
    if (tools?.length) {
      // Prepare tools with usage control.  This function filters the tools based on the model's capabilities and user settings.
      preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'ollama')
      // Extract the filtered tools and the tool choice strategy from the prepared tools.
      const { tools: filteredTools, toolChoice } = preparedTools

      // If there are filtered tools and a tool choice strategy, add them to the payload.
      if (filteredTools?.length && toolChoice) {
        // Add the filtered tools to the payload.
        payload.tools = filteredTools
        // Ollama supports 'auto' but not forced tool selection - convert 'force' to 'auto'.
        payload.tool_choice = typeof toolChoice === 'string' ? toolChoice : 'auto'

        logger.info('Ollama request configuration:', {
          toolCount: filteredTools.length,
          toolChoice: payload.tool_choice,
          model: request.model,
        })
      }
    }

    // Start execution timer for the entire provider execution
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      // Check if we can stream directly (no tools required)
      if (request.stream && (!tools || tools.length === 0)) {
        logger.info('Using streaming response for Ollama request')

        // Create a streaming request with token usage tracking
        const streamResponse = await ollama.chat.completions.create({
          ...payload,
          stream: true,
          stream_options: { include_usage: true },
        })

        // Start collecting token usage from the stream
        const tokenUsage = {
          prompt: 0,
          completion: 0,
          total: 0,
        }

        // Create a StreamingExecution response with a callback to update content and tokens
        const streamingResult = {
          stream: createReadableStreamFromOllamaStream(streamResponse, (content, usage) => {
            // Update the execution data with the final content and token usage
            streamingResult.execution.output.content = content

            // Clean up the response content
            if (content) {
              streamingResult.execution.output.content = content
                .replace(/```json\n?|\n?```/g, '')
                .trim()
            }

            // Update the timing information with the actual completion time
            const streamEndTime = Date.now()
            const streamEndTimeISO = new Date(streamEndTime).toISOString()

            if (streamingResult.execution.output.providerTiming) {
              streamingResult.execution.output.providerTiming.endTime = streamEndTimeISO
              streamingResult.execution.output.providerTiming.duration =
                streamEndTime - providerStartTime

              // Update the time segment as well
              if (streamingResult.execution.output.providerTiming.timeSegments?.[0]) {
                streamingResult.execution.output.providerTiming.timeSegments[0].endTime =
                  streamEndTime
                streamingResult.execution.output.providerTiming.timeSegments[0].duration =
                  streamEndTime - providerStartTime
              }
            }

            // Update token usage if available from the stream
            if (usage) {
              const newTokens = {
                prompt: usage.prompt_tokens || tokenUsage.prompt,
                completion: usage.completion_tokens || tokenUsage.completion,
                total: usage.total_tokens || tokenUsage.total,
              }

              streamingResult.execution.output.tokens = newTokens
            }
          }),
          execution: {
            success: true,
            output: {
              content: '', // Will be filled by the stream completion callback
              model: request.model,
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
            },
            logs: [], // No block logs for direct streaming
            metadata: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
            },
          },
        } as StreamingExecution

        // Return the streaming execution object
        return streamingResult as StreamingExecution
      }

      // Make the initial API request
      const initialCallTime = Date.now()

      // Track the original tool_choice for forced tool tracking
      const originalToolChoice = payload.tool_choice

      // Track forced tools and their usage
      const forcedTools = preparedTools?.forcedTools || []
      let usedForcedTools: string[] = []

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
            'ollama',
            forcedTools,
            usedForcedTools
          )
          hasUsedForcedTool = result.hasUsedForcedTool
          usedForcedTools = result.usedForcedTools
        }
      }

      let currentResponse = await ollama.chat.completions.create(payload)
      const firstResponseTime = Date.now() - initialCallTime

      let content = currentResponse.choices[0]?.message?.content || ''

      // Clean up the response content if it exists
      if (content) {
        content = content.replace(/```json\n?|\n?```/g, '')
        content = content.trim()
      }

      // Collect token information
      const tokens = {
        prompt: currentResponse.usage?.prompt_tokens || 0,
        completion: currentResponse.usage?.completion_tokens || 0,
        total: currentResponse.usage?.total_tokens || 0,
      }
      const toolCalls = []
      const toolResults = []
      const currentMessages = [...allMessages]
      let iterationCount = 0
      const MAX_ITERATIONS = 10 // Prevent infinite loops

      // Track time spent in model vs tools
      let modelTime = firstResponseTime
      let toolsTime = 0

      // Track if a forced tool has been used
      let hasUsedForcedTool = false

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

      // Check if a forced tool was used in the first response
      checkForForcedToolUsage(currentResponse, originalToolChoice)

      while (iterationCount < MAX_ITERATIONS) {
        // Check for tool calls
        const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls
        if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
          break
        }

        logger.info(
          `Processing ${toolCallsInResponse.length} tool calls (iteration ${iterationCount + 1}/${MAX_ITERATIONS})`
        )

        // Track time for tool calls in this batch
        const toolsStartTime = Date.now()

        // Process each tool call
        for (const toolCall of toolCallsInResponse) {
          try {
            const toolName = toolCall.function.name
            const toolArgs = JSON.parse(toolCall.function.arguments)

            // Get the tool from the tools registry
            const tool = request.tools?.find((t) => t.id === toolName)
            if (!tool) continue

            // Execute the tool
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
            logger.error('Error processing tool call:', {
              error,
              toolName: toolCall?.function?.name,
            })
          }
        }

        // Calculate tool call time for this iteration
        const thisToolsTime = Date.now() - toolsStartTime
        toolsTime += thisToolsTime

        // Make the next request with updated messages
        const nextPayload = {
          ...payload,
          messages: currentMessages,
        }

        // Update tool_choice based on which forced tools have been used
        if (typeof originalToolChoice === 'object' && hasUsedForcedTool && forcedTools.length > 0) {
          // If we have remaining forced tools, get the next one to force
          const remainingTools = forcedTools.filter((tool) => !usedForcedTools.includes(tool))

          if (remainingTools.length > 0) {
            // Ollama doesn't support forced tool selection, so we keep using 'auto'
            nextPayload.tool_choice = 'auto'
            logger.info(`Ollama doesn't support forced tools, using auto for: ${remainingTools[0]}`)
          } else {
            // All forced tools have been used, continue with auto
            nextPayload.tool_choice = 'auto'
            logger.info('All forced tools have been used, continuing with auto tool_choice')
          }
        }

        // Time the next model call
        const nextModelStartTime = Date.now()

        // Make the next request
        currentResponse = await ollama.chat.completions.create(nextPayload)

        // Check if any forced tools were used in this response
        checkForForcedToolUsage(currentResponse, nextPayload.tool_choice)

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

        // Update content if we have a text response
        if (currentResponse.choices[0]?.message?.content) {
          content = currentResponse.choices[0].message.content
          // Clean up the response content
          content = content.replace(/```json\n?|\n?```/g, '')
          content = content.trim()
        }

        // Update token counts
        if (currentResponse.usage) {
          tokens.prompt += currentResponse.usage.prompt_tokens || 0
          tokens.completion += currentResponse.usage.completion_tokens || 0
          tokens.total += currentResponse.usage.total_tokens || 0
        }

        iterationCount++
      }

      // After all tool processing complete, if streaming was requested and we have messages, use streaming for the final response
      if (request.stream && iterationCount > 0) {
        logger.info('Using streaming for final response after tool calls')

        const streamingPayload = {
          ...payload,
          messages: currentMessages,
          tool_choice: 'auto', // Always use 'auto' for the streaming response after tool calls
          stream: true,
          stream_options: { include_usage: true },
        }

        const streamResponse = await ollama.chat.completions.create(streamingPayload)

        // Create the StreamingExecution object with all collected data
        const streamingResult = {
          stream: createReadableStreamFromOllamaStream(streamResponse, (content, usage) => {
            // Update the execution data with the final content and token usage
            streamingResult.execution.output.content = content

            // Clean up the response content
            if (content) {
              streamingResult.execution.output.content = content
                .replace(/```json\n?|\n?```/g, '')
                .trim()
            }

            // Update token usage if available from the stream
            if (usage) {
              const newTokens = {
                prompt: usage.prompt_tokens || tokens.prompt,
                completion: usage.completion_tokens || tokens.completion,
                total: usage.total_tokens || tokens.total,
              }

              streamingResult.execution.output.tokens = newTokens
            }
          }),
          execution: {
            success: true,
            output: {
              content: '', // Will be filled by the callback
              model: request.model,
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
            },
            logs: [], // No block logs at provider level
            metadata: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
            },
          },
        } as StreamingExecution

        // Return the streaming execution object
        return streamingResult as StreamingExecution
      }

      // Calculate overall timing
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

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

      logger.error('Error in Ollama request:', {
        error,
        duration: totalDuration,
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

### Purpose of this file:

This file defines a `ProviderConfig` for integrating with an Ollama language model server. It handles tasks such as:

1.  **Initialization:**  Fetches the list of available models from the Ollama server on startup.
2.  **Request Execution:**  Takes a `ProviderRequest` object, translates it into a format compatible with the Ollama API, sends the request, and processes the response.
3.  **Streaming Support:**  Handles streaming responses from Ollama, converting them into standard `ReadableStream` objects.
4.  **Tool Calling:** Implements the logic for using tools (functions) with the language model, including preparing tool execution, calling tools, and incorporating tool results into the conversation.
5.  **Error Handling:** Gracefully handles errors during the entire process.
6.  **Telemetry:** Tracks timing and token usage for performance analysis.
7.  **Response Formatting:** Formats the LLM response for structured output when specified in the request.

### Simplifications and Key Logic Explanations:

*   **`createReadableStreamFromOllamaStream`**:  This function is crucial for handling streaming responses.  It takes the raw stream from the Ollama API, converts it into a standard JavaScript `ReadableStream`, and accumulates the complete response content. It also extracts usage information (token counts) from the final chunk of the stream.  This makes it easier to work with streaming data in other parts of the application.
*   **`ollamaProvider.initialize`**:  This function initializes the provider by fetching the list of available models from the Ollama server. It's important because it ensures that the application knows which models are available before making requests. The client-side check is to prevent CORS errors.
*   **`ollamaProvider.executeRequest`**: This is the core function where the main logic lives.  It orchestrates the entire process of sending a request to the Ollama server and processing the response.
    *   It constructs the request payload, including messages, system prompt, and tool definitions.
    *   It handles optional parameters like temperature and max tokens.
    *   It prepares the tools if there are any.
    *   It makes the API call to Ollama.
    *   **Conditional Streaming/Non-Streaming**: If the request is a streaming request *and* there are no tools, then the code uses the streaming API directly. If tools are present, it first makes a non-streaming request and then, after tool calls are completed, initiates a streaming request for the final response. This is a key performance optimization.
    *   **Tool Handling Logic**: The `while` loop handles tool calls. If the LLM returns tool calls, the code extracts them, executes each tool, and adds the results back into the conversation history for the LLM to use in subsequent iterations. This loop continues until the LLM no longer requests tool calls, until `MAX_ITERATIONS` is reached (to prevent infinite loops).
    *   **Timing Information**: The code meticulously tracks the time spent in different parts of the process (model calls, tool calls) to provide detailed performance metrics.
    *   **Forced Tool Usage:** The code tracks whether forced tools have been used to ensure proper execution.
    *   **Error Handling**: The code includes a `try...catch` block to handle errors that may occur during the request execution. The catch block adds timing information to the error object.
*   **Response Processing**: The code extracts the response content, token usage, and tool call information from the API response and formats it into a `ProviderResponse` or `StreamingExecution` object, which is then returned to the caller.

### Code Explanation (Line by Line):

```typescript
import OpenAI from 'openai'
// Imports the OpenAI library.  This is used for interacting with the Ollama server, which emulates the OpenAI API.
import { env } from '@/lib/env'
// Imports the `env` object from a local module.  This likely provides access to environment variables.
import { createLogger } from '@/lib/logs/console/logger'
// Imports the `createLogger` function from a local module.  This is used for creating a logger instance.
import type { StreamingExecution } from '@/executor/types'
// Imports the `StreamingExecution` type from a local module.  This represents the result of a streaming request.
import type { ModelsObject } from '@/providers/ollama/types'
// Imports the `ModelsObject` type from a local module.  This defines the structure of the data returned by the Ollama API when listing available models.
import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'
// Imports various types related to provider configuration and requests/responses.
import {
  prepareToolExecution,
  prepareToolsWithUsageControl,
  trackForcedToolUsage,
} from '@/providers/utils'
// Imports utility functions for handling tools, including preparing tool execution and filtering tools based on usage control settings.
import { useProvidersStore } from '@/stores/providers/store'
// Imports a store for managing providers. This store likely holds the list of available providers and their models.
import { executeTool } from '@/tools'
// Imports the `executeTool` function. This function actually calls an external tool.

// Create a logger instance specifically for the Ollama provider.  This allows for easy filtering of logs related to this provider.
const logger = createLogger('OllamaProvider')

// Retrieve the Ollama host URL from environment variables.  If not found, default to 'http://localhost:11434'.  This allows configuring the Ollama server's location.
const OLLAMA_HOST = env.OLLAMA_URL || 'http://localhost:11434'

/**
 * Helper function to convert an Ollama stream to a standard ReadableStream
 * and collect completion metrics
 *
 * This function bridges the gap between Ollama's streaming format and the standard ReadableStream used by other parts of the application.
 * It also accumulates the complete content and usage data from the stream.
 */
function createReadableStreamFromOllamaStream(
  ollamaStream: any,
  onComplete?: (content: string, usage?: any) => void
): ReadableStream {
  // Accumulates the complete content from the stream chunks.
  let fullContent = ''
  // Stores the usage data (e.g., token counts) received in the final chunk of the stream.
  let usageData: any = null

  // Creates a new ReadableStream to provide a standardized stream interface.
  return new ReadableStream({
    // The `start` method is called when the stream is initialized.  It sets up the asynchronous iteration over the Ollama stream.
    async start(controller) {
      try {
        // Iterate over each chunk of data received from the Ollama stream.  The `for await...of` loop handles asynchronous iteration.
        for await (const chunk of ollamaStream) {
          // Check for usage data in the final chunk.  The Ollama API includes usage information in a special `usage` property of the last chunk.
          if (chunk.usage) {
            usageData = chunk.usage
          }

          // Extract the content from the chunk.  Ollama returns the content within the `choices` array, under `delta.content`. If the `delta.content` field isn't present, then return an empty string.
          const content = chunk.choices[0]?.delta?.content || ''
          // If the chunk contains content, append it to `fullContent` and enqueue it to the stream controller.
          if (content) {
            fullContent += content
            // Encode the content as UTF-8 and enqueue it to the stream controller.
            controller.enqueue(new TextEncoder().encode(content))
          }
        }

        // Once the stream is complete, call the completion callback with the final content and usage data.
        if (onComplete) {
          onComplete(fullContent, usageData)
        }

        // Close the stream, signaling that no more data will be sent.
        controller.close()
      } catch (error) {
        // If an error occurs during stream processing, report it to the stream controller.
        controller.error(error)
      }
    },
  })
}

// Define the Ollama provider configuration.  This object encapsulates all the information and functionality needed to interact with the Ollama server.
export const ollamaProvider: ProviderConfig = {
  // Unique identifier for the provider.
  id: 'ollama',
  // Human-readable name of the provider.
  name: 'Ollama',
  // A brief description of the provider's purpose.
  description: 'Local Ollama server for LLM inference',
  // Version number of the provider.
  version: '1.0.0',
  // Array of supported models.  This will be populated dynamically during initialization.
  models: [], // Will be populated dynamically
  // Default model to use if none is specified in the request.
  defaultModel: '',

  // `initialize` method: Fetches available models from the Ollama server.
  async initialize() {
    // Check if the code is running in a browser environment.  If so, skip initialization to prevent CORS issues.
    if (typeof window !== 'undefined') {
      logger.info('Skipping Ollama initialization on client side to avoid CORS issues')
      return
    }

    try {
      // Make a request to the Ollama API to retrieve the list of available models.
      const