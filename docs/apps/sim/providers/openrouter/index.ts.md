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

const logger = createLogger('OpenRouterProvider')

/**
 * Creates a ReadableStream from an OpenAI stream.
 *
 * This function takes an OpenAI stream and converts it into a standard ReadableStream
 * that can be used for streaming data to a client.  It also handles accumulating the
 * full content of the stream and optionally calls a callback function when the stream
 * is complete, providing the complete content and usage data.
 *
 * @param openaiStream - The OpenAI stream to convert.
 * @param onComplete - An optional callback function to call when the stream is complete.
 *                       It receives the full content and usage data as arguments.
 * @returns A ReadableStream that emits the content of the OpenAI stream.
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
          if (chunk.usage) {
            usageData = chunk.usage
          }

          const content = chunk.choices[0]?.delta?.content || ''
          if (content) {
            fullContent += content
            controller.enqueue(new TextEncoder().encode(content))
          }
        }

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
 * Configuration for the OpenRouter provider.
 *
 * This object defines the configuration for using OpenRouter as a provider for
 * language model requests. It includes the provider's ID, name, description,
 * version, supported models, default model, and the core function to execute
 * a request to the OpenRouter API.
 */
export const openRouterProvider: ProviderConfig = {
  id: 'openrouter',
  name: 'OpenRouter',
  description: 'Unified access to many models via OpenRouter',
  version: '1.0.0',
  models: getProviderModels('openrouter'),
  defaultModel: getProviderDefaultModel('openrouter'),

  /**
   * Executes a request to the OpenRouter API.
   *
   * This is the main function responsible for taking a ProviderRequest,
   * sending it to the OpenRouter API, and returning a ProviderResponse or
   * a StreamingExecution (for streaming responses).  It handles authentication,
   * request formatting, tool usage, and error handling.
   *
   * @param request - The ProviderRequest object containing the request details.
   * @returns A Promise that resolves to a ProviderResponse or StreamingExecution.
   */
  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    // Check if the API key is provided
    if (!request.apiKey) {
      throw new Error('API key is required for OpenRouter')
    }

    // Create an OpenAI client configured to use the OpenRouter API
    const client = new OpenAI({
      apiKey: request.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    })

    // Extract the requested model name, removing the "openrouter/" prefix if present
    const requestedModel = (request.model || '').replace(/^openrouter\//, '')

    // Log the request details for debugging purposes
    logger.info('Preparing OpenRouter request', {
      model: requestedModel,
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      stream: !!request.stream,
    })

    // Prepare the messages array. This array will be sent to OpenRouter.
    const allMessages = [] as any[]

    // Add the system prompt, if present
    if (request.systemPrompt) {
      allMessages.push({ role: 'system', content: request.systemPrompt })
    }

    // Add the context, if present
    if (request.context) {
      allMessages.push({ role: 'user', content: request.context })
    }

    // Add the messages, if present
    if (request.messages) {
      allMessages.push(...request.messages)
    }

    // Prepare the tools array.  This transforms the tools into the format expected by OpenAI.
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

    // Build the payload for the OpenAI API request
    const payload: any = {
      model: requestedModel,
      messages: allMessages,
    }

    // Add optional parameters to the payload (temperature, max_tokens)
    if (request.temperature !== undefined) payload.temperature = request.temperature
    if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

    // Add response format instructions if present
    if (request.responseFormat) {
      payload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: request.responseFormat.name || 'response_schema',
          schema: request.responseFormat.schema || request.responseFormat,
          strict: request.responseFormat.strict !== false,
        },
      }
    }

    // Prepare the tools for usage control and determine if there are active tools
    let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null
    let hasActiveTools = false
    if (tools?.length) {
      preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'openrouter')
      const { tools: filteredTools, toolChoice } = preparedTools
      if (filteredTools?.length && toolChoice) {
        payload.tools = filteredTools
        payload.tool_choice = toolChoice
        hasActiveTools = true
      }
    }

    // Record the start time of the provider request
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      // Handle streaming requests
      if (request.stream && (!tools || tools.length === 0 || !hasActiveTools)) {
        // Make a streaming request to the OpenAI API
        const streamResponse = await client.chat.completions.create({
          ...payload,
          stream: true,
          stream_options: { include_usage: true },
        })

        // Initialize token usage counters
        const tokenUsage = { prompt: 0, completion: 0, total: 0 }

        // Create a StreamingExecution object to handle the streaming response
        const streamingResult = {
          stream: createReadableStreamFromOpenAIStream(streamResponse, (content, usage) => {
            // Update the streamingResult with partial data as it streams in
            if (usage) {
              const newTokens = {
                prompt: usage.prompt_tokens || tokenUsage.prompt,
                completion: usage.completion_tokens || tokenUsage.completion,
                total: usage.total_tokens || tokenUsage.total,
              }
              streamingResult.execution.output.tokens = newTokens
            }
            streamingResult.execution.output.content = content
            const end = Date.now()
            const endISO = new Date(end).toISOString()
            if (streamingResult.execution.output.providerTiming) {
              streamingResult.execution.output.providerTiming.endTime = endISO
              streamingResult.execution.output.providerTiming.duration = end - providerStartTime
              if (streamingResult.execution.output.providerTiming.timeSegments?.[0]) {
                streamingResult.execution.output.providerTiming.timeSegments[0].endTime = end
                streamingResult.execution.output.providerTiming.timeSegments[0].duration =
                  end - providerStartTime
              }
            }
          }),
          execution: {
            success: true,
            output: {
              content: '',
              model: requestedModel,
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
            logs: [],
            metadata: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
            },
          },
        } as StreamingExecution

        // Return the StreamingExecution object
        return streamingResult as StreamingExecution
      }

      // Handle non-streaming requests

      const initialCallTime = Date.now() // Time before the initial API call
      const originalToolChoice = payload.tool_choice // Store the original tool choice for later
      const forcedTools = preparedTools?.forcedTools || [] // Get the list of forced tools
      let usedForcedTools: string[] = [] // Keep track of which forced tools have been used

      // Make the initial request to the OpenAI API
      let currentResponse = await client.chat.completions.create(payload)
      const firstResponseTime = Date.now() - initialCallTime // Time taken for the first response

      let content = currentResponse.choices[0]?.message?.content || '' // Get the content from the response
      const tokens = {
        prompt: currentResponse.usage?.prompt_tokens || 0,
        completion: currentResponse.usage?.completion_tokens || 0,
        total: currentResponse.usage?.total_tokens || 0,
      } // Get token usage from the response
      const toolCalls = [] as any[] // Array to store tool calls
      const toolResults = [] as any[] // Array to store tool results
      const currentMessages = [...allMessages] // Copy the messages for iterative calls
      let iterationCount = 0 // Counter for the number of iterations
      const MAX_ITERATIONS = 10 // Maximum number of iterations
      let modelTime = firstResponseTime // Total time spent in model calls
      let toolsTime = 0 // Total time spent in tool executions
      let hasUsedForcedTool = false // Flag to indicate if a forced tool has been used
      const timeSegments: TimeSegment[] = [
        {
          type: 'model',
          name: 'Initial response',
          startTime: initialCallTime,
          endTime: initialCallTime + firstResponseTime,
          duration: firstResponseTime,
        },
      ] // Array to store time segments

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
            'openrouter',
            forcedTools,
            usedForcedTools
          )
          hasUsedForcedTool = result.hasUsedForcedTool
          usedForcedTools = result.usedForcedTools
        }
      }

      checkForForcedToolUsage(currentResponse, originalToolChoice)

      // Iteratively call tools and the model until no more tool calls are present or the maximum number of iterations is reached
      while (iterationCount < MAX_ITERATIONS) {
        const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls // Get the tool calls from the response
        if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
          break // If no tool calls, break the loop
        }

        const toolsStartTime = Date.now() // Time before tool execution
        // Execute each tool call
        for (const toolCall of toolCallsInResponse) {
          try {
            const toolName = toolCall.function.name // Get the tool name
            const toolArgs = JSON.parse(toolCall.function.arguments) // Get the tool arguments
            const tool = request.tools?.find((t) => t.id === toolName) // Find the tool in the request
            if (!tool) continue // If the tool is not found, skip to the next tool call

            const toolCallStartTime = Date.now() // Time before the specific tool call
            const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request) // Prepare the tool execution
            const result = await executeTool(toolName, executionParams, true) // Execute the tool
            const toolCallEndTime = Date.now() // Time after the specific tool call
            const toolCallDuration = toolCallEndTime - toolCallStartTime // Calculate the duration of the tool call

            timeSegments.push({
              type: 'tool',
              name: toolName,
              startTime: toolCallStartTime,
              endTime: toolCallEndTime,
              duration: toolCallDuration,
            }) // Add tool time segment

            let resultContent: any
            if (result.success) {
              toolResults.push(result.output) // Add the tool result to the array
              resultContent = result.output
            } else {
              resultContent = {
                error: true,
                message: result.error || 'Tool execution failed',
                tool: toolName,
              }
            }

            // Store tool call information
            toolCalls.push({
              name: toolName,
              arguments: toolParams,
              startTime: new Date(toolCallStartTime).toISOString(),
              endTime: new Date(toolCallEndTime).toISOString(),
              duration: toolCallDuration,
              result: resultContent,
              success: result.success,
            })

            // Add the assistant message with the tool call to the current messages
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

            // Add the tool result to the current messages
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(resultContent),
            })
          } catch (error) {
            logger.error('Error processing tool call (OpenRouter):', {
              error: error instanceof Error ? error.message : String(error),
              toolName: toolCall?.function?.name,
            }) // Log any errors during tool execution
          }
        }

        const thisToolsTime = Date.now() - toolsStartTime // Calculate the time spent on tool execution
        toolsTime += thisToolsTime // Add it to the total tool time

        // Prepare the payload for the next model call
        const nextPayload: any = {
          ...payload,
          messages: currentMessages,
        }

        if (typeof originalToolChoice === 'object' && hasUsedForcedTool && forcedTools.length > 0) {
          const remainingTools = forcedTools.filter((tool) => !usedForcedTools.includes(tool))
          if (remainingTools.length > 0) {
            nextPayload.tool_choice = { type: 'function', function: { name: remainingTools[0] } }
          } else {
            nextPayload.tool_choice = 'auto'
          }
        }

        const nextModelStartTime = Date.now() // Time before the next model call
        currentResponse = await client.chat.completions.create(nextPayload) // Make the next model call
        checkForForcedToolUsage(currentResponse, nextPayload.tool_choice)
        const nextModelEndTime = Date.now() // Time after the next model call
        const thisModelTime = nextModelEndTime - nextModelStartTime // Calculate the time spent on the model call
        timeSegments.push({
          type: 'model',
          name: `Model response (iteration ${iterationCount + 1})`,
          startTime: nextModelStartTime,
          endTime: nextModelEndTime,
          duration: thisModelTime,
        }) // Add the model time segment
        modelTime += thisModelTime // Add it to the total model time
        if (currentResponse.choices[0]?.message?.content) {
          content = currentResponse.choices[0].message.content
        } // Update the content
        if (currentResponse.usage) {
          tokens.prompt += currentResponse.usage.prompt_tokens || 0
          tokens.completion += currentResponse.usage.completion_tokens || 0
          tokens.total += currentResponse.usage.total_tokens || 0
        } // Update the token usage
        iterationCount++ // Increment the iteration counter
      }

      if (request.stream && iterationCount > 0) {
        const streamingPayload = {
          ...payload,
          messages: currentMessages,
          tool_choice: 'auto',
          stream: true,
          stream_options: { include_usage: true },
        }

        const streamResponse = await client.chat.completions.create(streamingPayload)
        const streamingResult = {
          stream: createReadableStreamFromOpenAIStream(streamResponse, (content, usage) => {
            if (usage) {
              const newTokens = {
                prompt: usage.prompt_tokens || tokens.prompt,
                completion: usage.completion_tokens || tokens.completion,
                total: usage.total_tokens || tokens.total,
              }
              streamingResult.execution.output.tokens = newTokens
            }
            streamingResult.execution.output.content = content
          }),
          execution: {
            success: true,
            output: {
              content: '',
              model: requestedModel,
              tokens: { prompt: tokens.prompt, completion: tokens.completion, total: tokens.total },
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
            logs: [],
            metadata: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
            },
          },
        } as StreamingExecution

        return streamingResult as StreamingExecution
      }

      // Record the end time of the provider request
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      // Return the final response
      return {
        content,
        model: requestedModel,
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
      // Handle errors during the request
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime
      logger.error('Error in OpenRouter request:', {
        error: error instanceof Error ? error.message : String(error),
        duration: totalDuration,
      })
      const enhancedError = new Error(error instanceof Error ? error.message : String(error))
      // @ts-ignore
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

This file defines a `ProviderConfig` for integrating with the OpenRouter API. It allows an application to use various language models available through OpenRouter, handling authentication, request formatting, streaming, tool usage, and error handling.

### Simplification of complex logic:

1.  **Streaming Handling:** The `createReadableStreamFromOpenAIStream` function encapsulates the logic for converting the OpenAI stream format into a standard `ReadableStream`. This separates the stream processing from the main request execution logic.
2.  **Tool Handling:** The use of `prepareToolsWithUsageControl` and related utility functions (`prepareToolExecution`, `executeTool`, `trackForcedToolUsage`) extracts the complex logic of preparing tools, executing them, and managing their usage into separate, more manageable functions.
3.  **Iterative Tool Calls:** The `while` loop handles the iterative process of making tool calls and model requests, breaking it down into smaller, more readable steps.  The use of `currentMessages` and `nextPayload` helps to clearly manage the state of the conversation and the parameters for each request.
4.  **Timing:**  The careful use of `Date.now()` and ISO string conversions allows the easy extraction of timing insights in the platform.

### Explanation of each line of code:

**Imports:**

*   `import OpenAI from 'openai'`: Imports the OpenAI library, which is used to interact with the OpenRouter API.
*   `import { createLogger } from '@/lib/logs/console/logger'`: Imports a logging function to log information and errors.
*   `import type { StreamingExecution } from '@/executor/types'`: Imports a type definition for streaming execution results.
*   `import { getProviderDefaultModel, getProviderModels } from '@/providers/models'`: Imports functions to retrieve the default model and a list of available models for the OpenRouter provider.
*   `import type { ProviderConfig, ProviderRequest, ProviderResponse, TimeSegment } from '@/providers/types'`: Imports type definitions for provider configuration, request, and response.
*   `import { prepareToolExecution, prepareToolsWithUsageControl, trackForcedToolUsage } from '@/providers/utils'`: Imports utility functions for preparing tool execution, managing tool usage with control, and tracking forced tool usage.
*   `import { executeTool } from '@/tools'`: Imports a function to execute a specific tool.

**Logger:**

*   `const logger = createLogger('OpenRouterProvider')`: Creates a logger instance with the name 'OpenRouterProvider'.

**`createReadableStreamFromOpenAIStream` function:**

*   `function createReadableStreamFromOpenAIStream(openaiStream: any, onComplete?: (content: string, usage?: any) => void): ReadableStream {`: Defines a function that converts an OpenAI stream into a ReadableStream.  It accepts the OpenAI stream and an optional callback function to be executed upon completion.
*   `let fullContent = '';`: Initializes an empty string to accumulate the full content from the stream.
*   `let usageData: any = null;`: Initializes a variable to store usage data from the stream.
*   `return new ReadableStream({`: Creates a new ReadableStream.
*   `async start(controller) {`: Defines the `start` method of the ReadableStream, which is called when the stream is initialized.
*   `try {`: Starts a try block to catch any errors during stream processing.
*   `for await (const chunk of openaiStream) {`: Iterates over each chunk in the OpenAI stream.
*   `if (chunk.usage) { usageData = chunk.usage; }`: If the chunk contains usage data, it's stored in the `usageData` variable.
*   `const content = chunk.choices[0]?.delta?.content || '';`: Extracts the content from the chunk.
*   `if (content) {`: Checks if the content is not empty.
*   `fullContent += content;`: Appends the content to the `fullContent` string.
*   `controller.enqueue(new TextEncoder().encode(content));`: Enqueues the content to the ReadableStream controller after encoding it as UTF-8.
*   `}`: Closes the `if (content)` block.
*   `}`: Closes the `for await` loop.
*   `if (onComplete) { onComplete(fullContent, usageData); }`: If an `onComplete` callback is provided, it's called with the full content and usage data.
*   `controller.close();`: Closes the ReadableStream controller, signaling the end of the stream.
*   `} catch (error) {`: Catches any errors that occur during stream processing.
*   `controller.error(error);`: Sends the error to the ReadableStream controller.
*   `}`: Closes the `catch` block.
*   `},`: Closes the `start` method definition.
*   `});`: Closes the `new ReadableStream` definition.
*   `}`: Closes the `createReadableStreamFromOpenAIStream` function definition.

**`openRouterProvider` object:**

*   `export const openRouterProvider: ProviderConfig = {`: Defines and exports a constant object named `openRouterProvider` of type `ProviderConfig`.
*   `id: 'openrouter',`: Sets the ID of the provider to 'openrouter'.
*   `name: 'OpenRouter',`: Sets the name of the provider to 'OpenRouter'.
*   `description: 'Unified access to many models via OpenRouter',`: Sets the description of the provider.
*   `version: '1.0.0',`: Sets the version of the provider.
*   `models: getProviderModels('openrouter'),`: Retrieves the available models for the OpenRouter provider.
*   `defaultModel: getProviderDefaultModel('openrouter'),`: Retrieves the default model for the OpenRouter provider.

**`executeRequest` function:**

*   `executeRequest: async (request: ProviderRequest): Promise<ProviderResponse | StreamingExecution> => {`: Defines the `executeRequest` function, which handles requests to the OpenRouter API.
*   `if (!request.apiKey) { throw new Error('API key is required for OpenRouter'); }`: Checks if an API key is provided in the request. If not, it throws an error.
*   `const client = new OpenAI({ apiKey: request.apiKey, baseURL: 'https://openrouter.ai/api/v1', });`: Creates an OpenAI client instance with the provided API key and the OpenRouter base URL.
*   `const requestedModel = (request.model || '').replace(/^openrouter\//, '');`: Extracts the requested model name from the request and removes the "openrouter/" prefix.
*   `logger.info('Preparing OpenRouter request', { ... });`: Logs information about the request being prepared.
*   `const allMessages = [] as any[];`: Initializes an empty array to store all messages to be sent to the API.
*   `if (request.systemPrompt) { allMessages.push({ role: 'system', content: request.systemPrompt }); }`: Adds the system prompt to the messages array if provided.
*   `if (request.context) { allMessages.push({ role: 'user', content: request.context }); }`: Adds the context to the messages array if provided.
*   `if (request.messages) { allMessages.push(...request.messages); }`: Adds the messages to the messages array if provided.
*   `const tools = request.tools?.length ? request.tools.map((tool) => ({ ... })) : undefined;`: Transforms the provided tools into the format expected by the OpenAI API.
*   `const payload: any = { model: requestedModel, messages: allMessages, };`: Creates the payload object with the model and messages.
*   `if (request.temperature !== undefined) payload.temperature = request.temperature;`: Adds the temperature parameter to the payload if provided.
*   `if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens;`: Adds the `max_tokens` parameter to the payload if provided.
*   `if (request.responseFormat) { payload.response_format = { ... }; }`: Adds the response format parameter to the payload if provided.
*   `let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null`: Initializes a variable to hold the prepared tools.
*   `let hasActiveTools = false`: Initializes a variable to check if the request have active tools.
*   `if (tools?.length) { preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'openrouter')`: prepares tools.
*   `const { tools: filteredTools, toolChoice } = preparedTools`: destructures the tools and toolChoice from `preparedTools`
*   `if (filteredTools?.length && toolChoice) { payload.tools = filteredTools; payload.tool_choice = toolChoice; hasActiveTools = true }`: sets the payload `tools` and `tool_choice` if the request have tools.
*   `const providerStartTime = Date.now();`: Records the start time of the request.
*   `const providerStartTimeISO = new Date(providerStartTime).toISOString();`: Converts the start time to ISO string format.
*   `try {`: Starts a try block to catch any errors during the request.
*   `if (request.stream && (!tools || tools.length === 0 || !hasActiveTools)) { ... }`: Handles streaming requests. It checks if `request.stream` is `true` and there are no tools or the tools are not active.
*   `const streamResponse = await client.chat.completions.create({ ... });`: Makes a streaming request to the OpenAI API.
*   `const tokenUsage = { prompt: 0, completion: 0, total: 0 };`: Initializes the `tokenUsage` object to keep track of tokens.
*   `const streamingResult = { stream: createReadableStreamFromOpenAIStream(streamResponse, (content, usage) => { ... }), execution: { ... } } as StreamingExecution;`: Defines the `streamingResult` with the stream and execution details.
*   `return streamingResult as StreamingExecution;`: Returns the `streamingResult` as a `StreamingExecution`.
*   `const initialCallTime = Date.now();`: captures the initial call time
*   `const originalToolChoice = payload.tool_choice;`: captures the original tool choice.
*   `const forcedTools = preparedTools?.forcedTools || [];`: captures the forced tools if present in the preparedTools response.
*   `let usedForcedTools: string[] = [];`: defines an array of strings that represent the tools that have been used from the `forcedTools` array.
*   `let currentResponse = await client.chat.completions.create(payload);`: Sends the initial request to the OpenAI API.
*   `const firstResponseTime = Date.now() - initialCallTime;`: Calculates the time it took to get the first response
*   `let content = currentResponse.choices[0]?.message?.content || '';`: Extracts the content from the response.
*   `const tokens = { prompt: currentResponse.usage?.prompt_tokens || 0, completion: currentResponse.usage?.completion_tokens || 0, total: currentResponse.usage?.total_tokens || 0, };`: Extracts the token usage from the response.
*   `const toolCalls = [] as any[];`: Initializes an empty array to store tool calls.
*   `const toolResults = [] as any[];`: Initializes an empty array to store tool results.
*   `const currentMessages = [...allMessages];`: Creates a copy of the `allMessages` array to be used in iterative calls.
*   `let iterationCount = 0;`: Initializes a counter for the number of iterations.
*   `const MAX_ITERATIONS = 10;`: Sets the maximum number of iterations to prevent infinite loops.
*   `let modelTime = firstResponseTime;`: stores the initial call time in the `modelTime` variable.
*   `let toolsTime = 0;`: initializes the tools time to `0`
*   `let hasUsedForcedTool = false;`: initializes a boolean value to see if the request has used forced tools.
*   `const timeSegments: TimeSegment[] = [ { type: 'model', name: 'Initial response', startTime: initialCallTime, endTime: initialCallTime + firstResponseTime, duration: firstResponseTime, }, ];`: creates an array of `TimeSegment` to see the time that the request took.
*   `const checkForForcedToolUsage = ( response: any, toolChoice: string | { type: string; function?: { name: string }; name?: string; any?: any } ) => { ... }`: Defines the logic to check for forced tool usage.
*   `checkForForcedToolUsage(currentResponse, originalToolChoice);`: Calls the `checkForForcedToolUsage` function with `currentResponse` and `originalToolChoice` as the parameters.
*   `while (iterationCount < MAX_ITERATIONS) { ... }`: Iteratively calls tools and the model until no more tool calls are present or the maximum number of iterations is reached.
*   `const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls;`: Extracts the tool calls from the response.
*   `if (!toolCallsInResponse || toolCallsInResponse.length === 0) { break; }`: If no tool calls are present, breaks the loop.
*   `const toolsStartTime = Date.now();`: Records the time at the beginning of the tool executions.
*   `for (const toolCall of toolCallsInResponse) { ... }`: Iterates over each tool call in the response.
*   `const toolName = toolCall.function.name;`: Extracts the tool name from the tool call.
*   `const toolArgs = JSON.parse(toolCall.function.arguments);`: Extracts the tool arguments from the tool call and parses them as JSON.
*   `const tool = request.tools?.find((t) => t.id === toolName);`: Finds the tool in the request's tools array.
*   `if (!tool) continue;`: If the tool is not found, continues to the next iteration.
*   `const toolCallStartTime = Date.now();`: records the tool start time
*   `const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request);`: Prepares the tool execution parameters.
*   `const result = await executeTool(toolName, executionParams, true);`: Executes the tool.
*   `const toolCallEndTime = Date.now();`: records the tool end time
*   `const toolCallDuration = toolCallEndTime - toolCallStartTime;`: captures the tool duration time.
*   `timeSegments.push({ type: 'tool', name: toolName, startTime: toolCallStartTime, endTime: