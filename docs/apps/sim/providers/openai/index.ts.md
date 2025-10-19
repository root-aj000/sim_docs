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

const logger = createLogger('OpenAIProvider')

/**
 * Helper function to convert an OpenAI stream to a standard ReadableStream
 * and collect completion metrics
 */
function createReadableStreamFromOpenAIStream(
  openaiStream: any,
  onComplete?: (content: string, usage?: any) => void
): ReadableStream {
  let fullContent = ''
  let usageData: any = null

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of openaiStream) {
          // Check for usage data in the final chunk
          if (chunk.usage) {
            usageData = chunk.usage
          }

          const content = chunk.choices[0]?.delta?.content || ''
          if (content) {
            fullContent += content
            controller.enqueue(new TextEncoder().encode(content))
          }
        }

        // Once stream is complete, call the completion callback with the final content and usage
        if (onComplete) {
          onComplete(fullContent, usageData)
        }

        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

/**
 * OpenAI provider configuration
 */
export const openaiProvider: ProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  description: "OpenAI's GPT models",
  version: '1.0.0',
  models: getProviderModels('openai'),
  defaultModel: getProviderDefaultModel('openai'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    logger.info('Preparing OpenAI request', {
      model: request.model || 'gpt-4o',
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      stream: !!request.stream,
    })

    // API key is now handled server-side before this function is called
    const openai = new OpenAI({ apiKey: request.apiKey })

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
      model: request.model || 'gpt-4o',
      messages: allMessages,
    }

    // Add optional parameters
    if (request.temperature !== undefined) payload.temperature = request.temperature
    if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

    // Add GPT-5 specific parameters
    if (request.reasoningEffort !== undefined) payload.reasoning_effort = request.reasoningEffort
    if (request.verbosity !== undefined) payload.verbosity = request.verbosity

    // Add response format for structured output if specified
    if (request.responseFormat) {
      // Use OpenAI's JSON schema format
      payload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: request.responseFormat.name || 'response_schema',
          schema: request.responseFormat.schema || request.responseFormat,
          strict: request.responseFormat.strict !== false,
        },
      }

      logger.info('Added JSON schema response format to request')
    }

    // Handle tools and tool usage control
    let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

    if (tools?.length) {
      preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'openai')
      const { tools: filteredTools, toolChoice } = preparedTools

      if (filteredTools?.length && toolChoice) {
        payload.tools = filteredTools
        payload.tool_choice = toolChoice

        logger.info('OpenAI request configuration:', {
          toolCount: filteredTools.length,
          toolChoice:
            typeof toolChoice === 'string'
              ? toolChoice
              : toolChoice.type === 'function'
                ? `force:${toolChoice.function.name}`
                : toolChoice.type === 'tool'
                  ? `force:${toolChoice.name}`
                  : toolChoice.type === 'any'
                    ? `force:${toolChoice.any?.name || 'unknown'}`
                    : 'unknown',
          model: request.model || 'gpt-4o',
        })
      }
    }

    // Start execution timer for the entire provider execution
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      // Check if we can stream directly (no tools required)
      if (request.stream && (!tools || tools.length === 0)) {
        logger.info('Using streaming response for OpenAI request')

        // Create a streaming request with token usage tracking
        const streamResponse = await openai.chat.completions.create({
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

        let _streamContent = ''

        // Create a StreamingExecution response with a callback to update content and tokens
        const streamingResult = {
          stream: createReadableStreamFromOpenAIStream(streamResponse, (content, usage) => {
            // Update the execution data with the final content and token usage
            _streamContent = content
            streamingResult.execution.output.content = content

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
            // We don't need to estimate tokens here as logger.ts will handle that
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
              // Cost will be calculated in logger
            },
            logs: [], // No block logs for direct streaming
            metadata: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
            },
          },
        } as StreamingExecution

        // Return the streaming execution object with explicit casting
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
            'openai',
            forcedTools,
            usedForcedTools
          )
          hasUsedForcedTool = result.hasUsedForcedTool
          usedForcedTools = result.usedForcedTools
        }
      }

      let currentResponse = await openai.chat.completions.create(payload)
      const firstResponseTime = Date.now() - initialCallTime

      let content = currentResponse.choices[0]?.message?.content || ''
      // Collect token information but don't calculate costs - that will be done in logger.ts
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
            // Force the next tool
            nextPayload.tool_choice = {
              type: 'function',
              function: { name: remainingTools[0] },
            }
            logger.info(`Forcing next tool: ${remainingTools[0]}`)
          } else {
            // All forced tools have been used, switch to auto
            nextPayload.tool_choice = 'auto'
            logger.info('All forced tools have been used, switching to auto tool_choice')
          }
        }

        // Time the next model call
        const nextModelStartTime = Date.now()

        // Make the next request
        currentResponse = await openai.chat.completions.create(nextPayload)

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

        // When streaming after tool calls with forced tools, make sure tool_choice is set to 'auto'
        // This prevents OpenAI API from trying to force tool usage again in the final streaming response
        const streamingPayload = {
          ...payload,
          messages: currentMessages,
          tool_choice: 'auto', // Always use 'auto' for the streaming response after tool calls
          stream: true,
          stream_options: { include_usage: true },
        }

        const streamResponse = await openai.chat.completions.create(streamingPayload)

        // Create the StreamingExecution object with all collected data
        let _streamContent = ''

        const streamingResult = {
          stream: createReadableStreamFromOpenAIStream(streamResponse, (content, usage) => {
            // Update the execution data with the final content and token usage
            _streamContent = content
            streamingResult.execution.output.content = content

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
              // Cost will be calculated in logger
            },
            logs: [], // No block logs at provider level
            metadata: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
            },
          },
        } as StreamingExecution

        // Return the streaming execution object with explicit casting
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
        // We're not calculating cost here as it will be handled in logger.ts
      }
    } catch (error) {
      // Include timing information even for errors
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      logger.error('Error in OpenAI request:', {
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

### Purpose of this file

This file defines a `ProviderConfig` for the OpenAI language models, enabling integration with a larger system that can interact with multiple language model providers. The `openaiProvider` object encapsulates the configuration and logic required to:

1.  Communicate with the OpenAI API.
2.  Format requests according to OpenAI's specifications.
3.  Handle streaming and non-streaming responses.
4.  Process tool calls (function calling).
5.  Track timing and resource usage.
6.  Handle forced tool usage

### Explanation of each line of code

**Imports**

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
```

*   `import OpenAI from 'openai'`: Imports the OpenAI library for interacting with the OpenAI API.
*   `import { createLogger } from '@/lib/logs/console/logger'`: Imports a function to create a logger for debugging and monitoring.
*   `import type { StreamingExecution } from '@/executor/types'`: Imports a type definition for streaming executions, which are used when the language model generates output in a stream.
*   `import { getProviderDefaultModel, getProviderModels } from '@/providers/models'`: Imports functions to retrieve the default model and available models for the OpenAI provider.
*   `import type { ProviderConfig, ProviderRequest, ProviderResponse, TimeSegment } from '@/providers/types'`: Imports type definitions for provider configurations, requests, responses, and time segments for tracking execution time.
*   `import { prepareToolExecution, prepareToolsWithUsageControl, trackForcedToolUsage } from '@/providers/utils'`: Imports utility functions for preparing tool execution, managing tool usage control, and tracking the usage of forced tools.
*   `import { executeTool } from '@/tools'`: Imports a function to execute a tool.

**Logger Initialization**

```typescript
const logger = createLogger('OpenAIProvider')
```

*   `const logger = createLogger('OpenAIProvider')`: Creates a logger instance specifically for the OpenAI provider.  This allows for easy filtering and identification of logs related to this provider.

**`createReadableStreamFromOpenAIStream` Function**

```typescript
/**
 * Helper function to convert an OpenAI stream to a standard ReadableStream
 * and collect completion metrics
 */
function createReadableStreamFromOpenAIStream(
  openaiStream: any,
  onComplete?: (content: string, usage?: any) => void
): ReadableStream {
  let fullContent = ''
  let usageData: any = null

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of openaiStream) {
          // Check for usage data in the final chunk
          if (chunk.usage) {
            usageData = chunk.usage
          }

          const content = chunk.choices[0]?.delta?.content || ''
          if (content) {
            fullContent += content
            controller.enqueue(new TextEncoder().encode(content))
          }
        }

        // Once stream is complete, call the completion callback with the final content and usage
        if (onComplete) {
          onComplete(fullContent, usageData)
        }

        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}
```

This function is a crucial helper that transforms the OpenAI's specific stream format into a standard `ReadableStream` which is a browser/Node.js API for handling streaming data. It also accumulates the full content of the stream and tracks usage data (like token counts).

*   **`function createReadableStreamFromOpenAIStream(...)`**: Defines a function that accepts an OpenAI stream and an optional `onComplete` callback.
*   **`let fullContent = ''; let usageData: any = null;`**: Initializes variables to store the complete content received from the stream and any usage data provided by OpenAI.
*   **`return new ReadableStream({ ... })`**: Creates a new `ReadableStream`.
*   **`async start(controller) { ... }`**: The `start` method is called when the stream is initialized.  It receives a `controller` object that is used to manage the stream.
*   **`for await (const chunk of openaiStream) { ... }`**: Iterates over each chunk of data in the OpenAI stream.
*   **`if (chunk.usage) { usageData = chunk.usage; }`**: Extracts usage data (token counts, etc.) from the chunk if available.  OpenAI typically includes usage data in the final chunk of the stream.
*   **`const content = chunk.choices[0]?.delta?.content || '';`**: Extracts the content from the current chunk.  The structure `chunk.choices[0]?.delta?.content` is specific to the OpenAI streaming API.
*   **`if (content) { fullContent += content; controller.enqueue(new TextEncoder().encode(content)); }`**: If the chunk contains content, it's appended to `fullContent` and then encoded as UTF-8 and enqueued into the `ReadableStream` via the `controller`. `controller.enqueue` pushes the data to the consumer of the `ReadableStream`.
*   **`if (onComplete) { onComplete(fullContent, usageData); }`**: After the stream is complete, this calls the optional `onComplete` callback, providing the accumulated `fullContent` and the `usageData`.
*   **`controller.close();`**: Closes the `ReadableStream`, signaling that no more data will be sent.
*   **`catch (error) { controller.error(error); }`**: Catches any errors during stream processing and signals the error to the `ReadableStream`'s consumer.

**`openaiProvider` Configuration**

```typescript
/**
 * OpenAI provider configuration
 */
export const openaiProvider: ProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  description: "OpenAI's GPT models",
  version: '1.0.0',
  models: getProviderModels('openai'),
  defaultModel: getProviderDefaultModel('openai'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    // ... (rest of the code)
  },
}
```

This section defines the configuration object for the OpenAI provider.

*   **`export const openaiProvider: ProviderConfig = { ... }`**: Defines a constant `openaiProvider` that implements the `ProviderConfig` interface. This object is the main export of this file and is responsible for configuring and executing requests to OpenAI.
*   **`id: 'openai'`**:  A unique identifier for this provider.
*   **`name: 'OpenAI'`**: A human-readable name for the provider.
*   **`description: "OpenAI's GPT models"`**: A brief description of the provider.
*   **`version: '1.0.0'`**:  The version of this provider configuration.
*   **`models: getProviderModels('openai')`**: Retrieves the list of supported models for OpenAI using the `getProviderModels` helper function.  This function likely fetches this data from a configuration file or an external source.
*   **`defaultModel: getProviderDefaultModel('openai')`**: Retrieves the default model for OpenAI using the `getProviderDefaultModel` helper function.
*   **`executeRequest: async (request: ProviderRequest): Promise<ProviderResponse | StreamingExecution> => { ... }`**: Defines the core function that handles requests to the OpenAI API.  It takes a `ProviderRequest` as input and returns either a `ProviderResponse` (for non-streaming requests) or a `StreamingExecution` (for streaming requests).  This is an `async` function, meaning it can use `await` to handle asynchronous operations.

**`executeRequest` Function Body**

This is the most complex part of the code, handling the entire process of making requests to OpenAI, managing tools, and handling streaming/non-streaming responses.

**1. Logging Request Information**

```typescript
    logger.info('Preparing OpenAI request', {
      model: request.model || 'gpt-4o',
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      stream: !!request.stream,
    })
```

*   Logs the details of the incoming request for debugging and monitoring.  It includes information about the model being used, the presence of a system prompt, messages, tools, and whether streaming is enabled.

**2. OpenAI Client Initialization**

```typescript
    // API key is now handled server-side before this function is called
    const openai = new OpenAI({ apiKey: request.apiKey })
```

*   Creates an instance of the OpenAI client, configured with the API key from the `request` object.  The comment indicates that API key management happens outside this function, likely for security reasons.

**3. Message Preparation**

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

*   This section constructs the `messages` array that will be sent to the OpenAI API.  It handles the system prompt, context and the user messages. The messages need to be in a specific format for the OpenAI API.

**4. Tool Transformation**

```typescript
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
```

*   Transforms the tools provided in the request to the format expected by the OpenAI API.  Each tool is converted to a `function` type with a `name`, `description`, and `parameters`.

**5. Payload Construction**

```typescript
    // Build the request payload
    const payload: any = {
      model: request.model || 'gpt-4o',
      messages: allMessages,
    }

    // Add optional parameters
    if (request.temperature !== undefined) payload.temperature = request.temperature
    if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

    // Add GPT-5 specific parameters
    if (request.reasoningEffort !== undefined) payload.reasoning_effort = request.reasoningEffort
    if (request.verbosity !== undefined) payload.verbosity = request.verbosity

    // Add response format for structured output if specified
    if (request.responseFormat) {
      // Use OpenAI's JSON schema format
      payload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: request.responseFormat.name || 'response_schema',
          schema: request.responseFormat.schema || request.responseFormat,
          strict: request.responseFormat.strict !== false,
        },
      }

      logger.info('Added JSON schema response format to request')
    }
```

*   Builds the main payload for the OpenAI API request. It includes:
    *   `model`: The language model to use (defaults to `gpt-4o`).
    *   `messages`: The array of messages constructed earlier.
    *   `temperature`:  Controls the randomness of the output.
    *   `max_tokens`:  The maximum number of tokens to generate.
    *   `reasoning_effort`: Parameter specific to GPT-5
    *   `verbosity`: Parameter specific to GPT-5
    *   `response_format`: Specifies the desired format for the output, using OpenAI's JSON schema format for structured output.

**6. Tool Usage Control**

```typescript
    // Handle tools and tool usage control
    let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

    if (tools?.length) {
      preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'openai')
      const { tools: filteredTools, toolChoice } = preparedTools

      if (filteredTools?.length && toolChoice) {
        payload.tools = filteredTools
        payload.tool_choice = toolChoice

        logger.info('OpenAI request configuration:', {
          toolCount: filteredTools.length,
          toolChoice:
            typeof toolChoice === 'string'
              ? toolChoice
              : toolChoice.type === 'function'
                ? `force:${toolChoice.function.name}`
                : toolChoice.type === 'tool'
                  ? `force:${toolChoice.name}`
                  : toolChoice.type === 'any'
                    ? `force:${toolChoice.any?.name || 'unknown'}`
                    : 'unknown',
          model: request.model || 'gpt-4o',
        })
      }
    }
```

*   This section handles the preparation and configuration of tools for use with the OpenAI API.
    *   `prepareTools