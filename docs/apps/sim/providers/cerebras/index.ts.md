```typescript
import { Cerebras } from '@cerebras/cerebras_cloud_sdk'
import { createLogger } from '@/lib/logs/console/logger'
import type { StreamingExecution } from '@/executor/types'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'
import { prepareToolExecution } from '@/providers/utils'
import { executeTool } from '@/tools'

const logger = createLogger('CerebrasProvider')

/**
 * Helper to convert a Cerebras streaming response (async iterable) into a ReadableStream.
 * Enqueues only the model's text delta chunks as UTF-8 encoded bytes.
 */
function createReadableStreamFromCerebrasStream(
  cerebrasStream: AsyncIterable<any>
): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of cerebrasStream) {
          // Expecting delta content similar to OpenAI: chunk.choices[0]?.delta?.content
          const content = chunk.choices?.[0]?.delta?.content || ''
          if (content) {
            controller.enqueue(new TextEncoder().encode(content))
          }
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

export const cerebrasProvider: ProviderConfig = {
  id: 'cerebras',
  name: 'Cerebras',
  description: 'Cerebras Cloud LLMs',
  version: '1.0.0',
  models: getProviderModels('cerebras'),
  defaultModel: getProviderDefaultModel('cerebras'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Cerebras')
    }

    // Start execution timer for the entire provider execution
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      const client = new Cerebras({
        apiKey: request.apiKey,
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

      // Transform tools to Cerebras format if provided
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
        model: (request.model || 'cerebras/llama-3.3-70b').replace('cerebras/', ''),
        messages: allMessages,
      }

      // Add optional parameters
      if (request.temperature !== undefined) payload.temperature = request.temperature
      if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

      // Add response format for structured output if specified
      if (request.responseFormat) {
        payload.response_format = {
          type: 'json_schema',
          schema: request.responseFormat.schema || request.responseFormat,
        }
      }

      // Add tools if provided
      if (tools?.length) {
        // Filter out any tools with usageControl='none', treat 'force' as 'auto' since Cerebras only supports 'auto'
        const filteredTools = tools.filter((tool) => {
          const toolId = tool.function?.name
          const toolConfig = request.tools?.find((t) => t.id === toolId)
          // Only filter out tools with usageControl='none'
          return toolConfig?.usageControl !== 'none'
        })

        if (filteredTools?.length) {
          payload.tools = filteredTools
          // Always use 'auto' for Cerebras, explicitly converting any 'force' usageControl to 'auto'
          payload.tool_choice = 'auto'

          logger.info('Cerebras request configuration:', {
            toolCount: filteredTools.length,
            toolChoice: 'auto', // Cerebras always uses auto, 'force' is treated as 'auto'
            model: request.model,
          })
        } else if (tools.length > 0 && filteredTools.length === 0) {
          // Handle case where all tools are filtered out
          logger.info(`All tools have usageControl='none', removing tools from request`)
        }
      }

      // EARLY STREAMING: if streaming requested and no tools to execute, stream directly
      if (request.stream && (!tools || tools.length === 0)) {
        logger.info('Using streaming response for Cerebras request (no tools)')
        const streamResponse: any = await client.chat.completions.create({
          ...payload,
          stream: true,
        })

        // Start collecting token usage
        const tokenUsage = {
          prompt: 0,
          completion: 0,
          total: 0,
        }

        // Create a StreamingExecution response with a readable stream
        const streamingResult = {
          stream: createReadableStreamFromCerebrasStream(streamResponse),
          execution: {
            success: true,
            output: {
              content: '', // Will be filled by streaming content in chat component
              model: request.model || 'cerebras/llama-3.3-70b',
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

      // Make the initial API request
      const initialCallTime = Date.now()

      let currentResponse = (await client.chat.completions.create(payload)) as CerebrasResponse
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
      const MAX_ITERATIONS = 10 // Prevent infinite loops

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

      // Keep track of processed tool calls to avoid duplicates
      const processedToolCallIds = new Set()
      // Keep track of tool call signatures to detect repeats
      const toolCallSignatures = new Set()

      try {
        while (iterationCount < MAX_ITERATIONS) {
          // Check for tool calls
          const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls

          // Break if no tool calls
          if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
            if (currentResponse.choices[0]?.message?.content) {
              content = currentResponse.choices[0].message.content
            }
            break
          }

          // Track time for tool calls in this batch
          const toolsStartTime = Date.now()

          // Process each tool call
          let processedAnyToolCall = false
          let hasRepeatedToolCalls = false

          for (const toolCall of toolCallsInResponse) {
            // Skip if we've already processed this tool call
            if (processedToolCallIds.has(toolCall.id)) {
              continue
            }

            // Create a signature for this tool call to detect repeats
            const toolCallSignature = `${toolCall.function.name}-${toolCall.function.arguments}`
            if (toolCallSignatures.has(toolCallSignature)) {
              hasRepeatedToolCalls = true
              continue
            }

            try {
              processedToolCallIds.add(toolCall.id)
              toolCallSignatures.add(toolCallSignature)
              processedAnyToolCall = true

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
              logger.error('Error processing tool call:', { error })
            }
          }

          // Calculate tool call time for this iteration
          const thisToolsTime = Date.now() - toolsStartTime
          toolsTime += thisToolsTime

          // After processing tool calls, get a final response
          if (processedAnyToolCall || hasRepeatedToolCalls) {
            // Time the next model call
            const nextModelStartTime = Date.now()

            // Make the final request
            const finalPayload = {
              ...payload,
              messages: currentMessages,
            }

            // Use tool_choice: 'none' for the final response to avoid an infinite loop
            finalPayload.tool_choice = 'none'

            const finalResponse = (await client.chat.completions.create(
              finalPayload
            )) as CerebrasResponse

            const nextModelEndTime = Date.now()
            const thisModelTime = nextModelEndTime - nextModelStartTime

            // Add to time segments
            timeSegments.push({
              type: 'model',
              name: 'Final response',
              startTime: nextModelStartTime,
              endTime: nextModelEndTime,
              duration: thisModelTime,
            })

            // Add to model time
            modelTime += thisModelTime

            if (finalResponse.choices[0]?.message?.content) {
              content = finalResponse.choices[0].message.content
            }

            // Update final token counts
            if (finalResponse.usage) {
              tokens.prompt += finalResponse.usage.prompt_tokens || 0
              tokens.completion += finalResponse.usage.completion_tokens || 0
              tokens.total += finalResponse.usage.total_tokens || 0
            }

            break
          }

          // Only continue if we haven't processed any tool calls and haven't seen repeats
          if (!processedAnyToolCall && !hasRepeatedToolCalls) {
            // Make the next request with updated messages
            const nextPayload = {
              ...payload,
              messages: currentMessages,
            }

            // Time the next model call
            const nextModelStartTime = Date.now()

            // Make the next request
            currentResponse = (await client.chat.completions.create(
              nextPayload
            )) as CerebrasResponse

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

            // Update token counts
            if (currentResponse.usage) {
              tokens.prompt += currentResponse.usage.prompt_tokens || 0
              tokens.completion += currentResponse.usage.completion_tokens || 0
              tokens.total += currentResponse.usage.total_tokens || 0
            }

            iterationCount++
          }
        }
      } catch (error) {
        logger.error('Error in Cerebras tool processing:', { error })
      }

      // Calculate overall timing
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      // POST-TOOL-STREAMING: stream after tool calls if requested
      if (request.stream && iterationCount > 0) {
        logger.info('Using streaming for final Cerebras response after tool calls')

        // When streaming after tool calls with forced tools, make sure tool_choice is set to 'auto'
        // This prevents the API from trying to force tool usage again in the final streaming response
        const streamingPayload = {
          ...payload,
          messages: currentMessages,
          tool_choice: 'auto', // Always use 'auto' for the streaming response after tool calls
          stream: true,
        }

        const streamResponse: any = await client.chat.completions.create(streamingPayload)

        // Create a StreamingExecution response with all collected data
        const streamingResult = {
          stream: createReadableStreamFromCerebrasStream(streamResponse),
          execution: {
            success: true,
            output: {
              content: '', // Will be filled by the callback
              model: request.model || 'cerebras/llama-3.3-70b',
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

      logger.error('Error in Cerebras request:', {
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

## Detailed Explanation

This TypeScript file defines a `ProviderConfig` for integrating with Cerebras Cloud LLMs.  It handles making requests to the Cerebras API, processing responses (including streaming and tool calls), and formatting the output for use within a larger application.

**Purpose of this file:**

The primary purpose of this file is to provide a standardized interface for interacting with the Cerebras Cloud LLM service.  It encapsulates all the Cerebras-specific logic, allowing other parts of the application to use Cerebras models without needing to know the details of the Cerebras API. It handles:

1.  **Configuration:** Defines the provider's ID, name, description, supported models, and default model.
2.  **Request Execution:**  Takes a `ProviderRequest` object, constructs the appropriate API call to Cerebras, and handles the response.  This includes:
    *   Authentication (API key).
    *   Message formatting.
    *   Tool integration (calling external tools and incorporating their results into the conversation).
    *   Streaming responses.
    *   Error handling.
    *   Timing and cost estimation.
3.  **Response Formatting:**  Formats the Cerebras response into a standardized `ProviderResponse` or `StreamingExecution` object that can be easily consumed by the application.

**Simplifying Complex Logic:**

The code addresses complexity through:

*   **Abstraction:**  The `cerebrasProvider` object hides the intricacies of the Cerebras API behind a simple `executeRequest` function.
*   **Modularity:**  The code is broken down into smaller, well-defined functions, such as `createReadableStreamFromCerebrasStream`, `prepareToolExecution`, and `executeTool`, making it easier to understand and maintain.
*   **Clear Error Handling:** The `try...catch` blocks with logging provide robust error handling and prevent the application from crashing due to API issues.
*   **Iterative Tool Calling:** The `while` loop handles scenarios where the LLM needs to call multiple tools in sequence, making the system more powerful.  It also includes loop protection (`MAX_ITERATIONS`) to avoid infinite loops.
*   **Streaming Support:**  Handles both initial and post-tool-call streaming, providing a more responsive user experience.
*   **Timing and Cost Tracking:**  Detailed timing information is tracked for each step of the process, allowing for performance analysis and cost estimation.

**Line-by-line explanation:**

```typescript
import { Cerebras } from '@cerebras/cerebras_cloud_sdk'
```

*   Imports the `Cerebras` class from the `@cerebras/cerebras_cloud_sdk` package. This class is the main interface for interacting with the Cerebras Cloud API.

```typescript
import { createLogger } from '@/lib/logs/console/logger'
```

*   Imports the `createLogger` function from a local module (`@/lib/logs/console/logger`). This function is used to create a logger instance for logging messages related to the Cerebras provider.

```typescript
import type { StreamingExecution } from '@/executor/types'
```

*   Imports the `StreamingExecution` type from a local module (`@/executor/types`). This type likely defines the structure of a streaming execution result, which is used when the Cerebras API returns a stream of data.

```typescript
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
```

*   Imports `getProviderDefaultModel` and `getProviderModels` functions.  These functions, presumably from a local module, retrieve the default model and the list of supported models for the 'cerebras' provider.

```typescript
import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'
```

*   Imports type definitions for `ProviderConfig`, `ProviderRequest`, `ProviderResponse`, and `TimeSegment`.  These types define the structure of the provider configuration, incoming request, outgoing response, and timing segments used within the provider.

```typescript
import { prepareToolExecution } from '@/providers/utils'
```

*   Imports the `prepareToolExecution` function, which likely handles preparing the input and parameters for a tool execution based on the tool's definition and the request context.

```typescript
import { executeTool } from '@/tools'
```

*   Imports the `executeTool` function, which is responsible for actually executing a tool.

```typescript
const logger = createLogger('CerebrasProvider')
```

*   Creates a logger instance named 'CerebrasProvider' using the `createLogger` function. This logger will be used to log messages specific to this provider.

```typescript
/**
 * Helper to convert a Cerebras streaming response (async iterable) into a ReadableStream.
 * Enqueues only the model's text delta chunks as UTF-8 encoded bytes.
 */
function createReadableStreamFromCerebrasStream(
  cerebrasStream: AsyncIterable<any>
): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of cerebrasStream) {
          // Expecting delta content similar to OpenAI: chunk.choices[0]?.delta?.content
          const content = chunk.choices?.[0]?.delta?.content || ''
          if (content) {
            controller.enqueue(new TextEncoder().encode(content))
          }
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}
```

*   Defines a function `createReadableStreamFromCerebrasStream` that converts an asynchronous iterable (the Cerebras streaming response) into a `ReadableStream`.  This allows the streaming response to be easily consumed by a client.
    *   It iterates over the chunks in the `cerebrasStream`.
    *   It extracts the text delta (`chunk.choices?.[0]?.delta?.content || ''`) from each chunk. This line anticipates the structure of the response from the Cerebras API and safely accesses the nested properties using optional chaining (`?.`) to handle cases where some properties might be missing.  It defaults to an empty string if the content is not found.
    *   If the `content` is not empty, it encodes it as UTF-8 using `new TextEncoder().encode(content)` and enqueues it into the `ReadableStream`'s controller.
    *   The `try...catch` block handles potential errors during streaming.

```typescript
export const cerebrasProvider: ProviderConfig = {
```

*   Defines the `cerebrasProvider` object, which implements the `ProviderConfig` interface. This is the main configuration object for the Cerebras provider.

```typescript
  id: 'cerebras',
  name: 'Cerebras',
  description: 'Cerebras Cloud LLMs',
  version: '1.0.0',
  models: getProviderModels('cerebras'),
  defaultModel: getProviderDefaultModel('cerebras'),
```

*   Specifies basic provider metadata:
    *   `id`: A unique identifier for the provider.
    *   `name`: The human-readable name of the provider.
    *   `description`: A short description of the provider.
    *   `version`: The version of the provider integration.
    *   `models`:  The list of supported models, retrieved using the `getProviderModels` function.
    *   `defaultModel`: The default model to use, retrieved using the `getProviderDefaultModel` function.

```typescript
  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
```

*   Defines the `executeRequest` function, which is the core logic for handling requests to the Cerebras API. It takes a `ProviderRequest` object as input and returns either a `ProviderResponse` or a `StreamingExecution` object.
*   The `async` keyword indicates that this function is asynchronous and returns a Promise.

```typescript
    if (!request.apiKey) {
      throw new Error('API key is required for Cerebras')
    }
```

*   Checks if the `apiKey` is provided in the `request`. If not, it throws an error, as the API key is required for authentication.

```typescript
    // Start execution timer for the entire provider execution
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()
```

*   Records the start time of the provider execution for timing purposes.  The time is stored in both milliseconds since epoch (`providerStartTime`) and ISO string format (`providerStartTimeISO`).

```typescript
    try {
```

*   Starts a `try...catch` block to handle potential errors during the API request and response processing.

```typescript
      const client = new Cerebras({
        apiKey: request.apiKey,
      })
```

*   Creates a new instance of the `Cerebras` client, passing the API key from the request. This client will be used to make API calls to Cerebras.

```typescript
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
```

*   Constructs the message history for the LLM. It starts with an empty array and adds the system prompt, context, and user messages from the `request`, if they are present.  This prepares the messages in the format expected by the Cerebras API.

```typescript
      // Transform tools to Cerebras format if provided
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
```

*   Transforms the tools provided in the `request` to the format expected by the Cerebras API. If `request.tools` exists and has a length greater than zero, it maps each tool object to a new object with the `type` set to 'function' and a nested `function` object containing the tool's `name`, `description`, and `parameters`.  If no tools are provided, the `tools` variable is set to `undefined`.

```typescript
      // Build the request payload
      const payload: any = {
        model: (request.model || 'cerebras/llama-3.3-70b').replace('cerebras/', ''),
        messages: allMessages,
      }
```

*   Constructs the payload for the Cerebras API request.
    *   `model`:  Uses the model specified in the `request`, or defaults to 'cerebras/llama-3.3-70b'. It also removes the `cerebras/` prefix.
    *   `messages`:  The message history constructed earlier.

```typescript
      // Add optional parameters
      if (request.temperature !== undefined) payload.temperature = request.temperature
      if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

      // Add response format for structured output if specified
      if (request.responseFormat) {
        payload.response_format = {
          type: 'json_schema',
          schema: request.responseFormat.schema || request.responseFormat,
        }
      }
```

*   Adds optional parameters to the payload, such as `temperature` and `maxTokens`, if they are provided in the `request`. Also handles the `responseFormat` for structured JSON output.

```typescript
      // Add tools if provided
      if (tools?.length) {
        // Filter out any tools with usageControl='none', treat 'force' as 'auto' since Cerebras only supports 'auto'
        const filteredTools = tools.filter((tool) => {
          const toolId = tool.function?.name
          const toolConfig = request.tools?.find((t) => t.id === toolId)
          // Only filter out tools with usageControl='none'
          return toolConfig?.usageControl !== 'none'
        })

        if (filteredTools?.length) {
          payload.tools = filteredTools
          // Always use 'auto' for Cerebras, explicitly converting any 'force' usageControl to 'auto'
          payload.tool_choice = 'auto'

          logger.info('Cerebras request configuration:', {
            toolCount: filteredTools.length,
            toolChoice: 'auto', // Cerebras always uses auto, 'force' is treated as 'auto'
            model: request.model,
          })
        } else if (tools.length > 0 && filteredTools.length === 0) {
          // Handle case where all tools are filtered out
          logger.info(`All tools have usageControl='none', removing tools from request`)
        }
      }
```

*   Handles the integration of tools:
    *   Filters tools based on their `usageControl` property.  Tools with `usageControl='none'` are filtered out.
    *   Sets the `tool_choice` parameter to `'auto'` for Cerebras since Cerebras only support auto tool choice.
    *   Logs the Cerebras request configuration.
    *   Handles the case where all tools are filtered out, logging an informative message.

```typescript
      // EARLY STREAMING: if streaming requested and no tools to execute, stream directly
      if (request.stream && (!tools || tools.length === 0)) {
        logger.info('Using streaming response for Cerebras request (no tools)')
        const streamResponse: any = await client.chat.completions.create({
          ...payload,
          stream: true,
        })

        // Start collecting token usage
        const tokenUsage = {
          prompt: 0,
          completion: 0,
          total: 0,
        }

        // Create a StreamingExecution response with a readable stream
        const streamingResult = {
          stream: createReadableStreamFromCerebrasStream(streamResponse),
          execution: {
            success: true,
            output: {
              content: '', // Will be filled by streaming content in chat component
              model: request.model || 'cerebras/llama-3.3-70b',
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
```

*   Handles the case where streaming is requested and no tools are being used. This is an "early streaming" scenario, where the response is streamed directly from the Cerebras API.
    *   It makes an API call to Cerebras with the `stream` option set to `true`.
    *   It creates a `StreamingExecution` object, which contains the `ReadableStream` (created using `createReadableStreamFromCerebrasStream`), execution metadata, and an initial empty output object.

```typescript
      // Make the initial API request
      const initialCallTime = Date.now()

      let currentResponse = (await client.chat.completions.create(payload)) as CerebrasResponse
      const firstResponseTime = Date.now() - initialCallTime

      let content = currentResponse.choices[0]?.message?.content || ''
      const tokens = {
        prompt: currentResponse.usage?.prompt_tokens || 0,
        completion: currentResponse.usage?.completion_tokens || 0,
        total: currentResponse.usage?.total_tokens || 0,
      }
      const toolCalls = []
      const toolResults = []
      const currentMessages = [...all