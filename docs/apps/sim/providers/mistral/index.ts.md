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

const logger = createLogger('MistralProvider')

function createReadableStreamFromMistralStream(
  mistralStream: any,
  onComplete?: (content: string, usage?: any) => void
): ReadableStream {
  let fullContent = ''
  let usageData: any = null

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of mistralStream) {
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
 * Mistral AI provider configuration
 */
export const mistralProvider: ProviderConfig = {
  id: 'mistral',
  name: 'Mistral AI',
  description: "Mistral AI's language models",
  version: '1.0.0',
  models: getProviderModels('mistral'),
  defaultModel: getProviderDefaultModel('mistral'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    logger.info('Preparing Mistral request', {
      model: request.model || 'mistral-large-latest',
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      stream: !!request.stream,
    })

    if (!request.apiKey) {
      throw new Error('API key is required for Mistral AI')
    }

    const mistral = new OpenAI({
      apiKey: request.apiKey,
      baseURL: 'https://api.mistral.ai/v1',
    })

    const allMessages = []

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

    const payload: any = {
      model: request.model || 'mistral-large-latest',
      messages: allMessages,
    }

    if (request.temperature !== undefined) payload.temperature = request.temperature
    if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

    if (request.responseFormat) {
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

    let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

    if (tools?.length) {
      preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'mistral')
      const { tools: filteredTools, toolChoice } = preparedTools

      if (filteredTools?.length && toolChoice) {
        payload.tools = filteredTools
        payload.tool_choice = toolChoice

        logger.info('Mistral request configuration:', {
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
          model: request.model || 'mistral-large-latest',
        })
      }
    }

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      if (request.stream && (!tools || tools.length === 0)) {
        logger.info('Using streaming response for Mistral request')

        const streamResponse = await mistral.chat.completions.create({
          ...payload,
          stream: true,
          stream_options: { include_usage: true },
        })

        const tokenUsage = {
          prompt: 0,
          completion: 0,
          total: 0,
        }

        let _streamContent = ''

        const streamingResult = {
          stream: createReadableStreamFromMistralStream(streamResponse, (content, usage) => {
            _streamContent = content
            streamingResult.execution.output.content = content

            const streamEndTime = Date.now()
            const streamEndTimeISO = new Date(streamEndTime).toISOString()

            if (streamingResult.execution.output.providerTiming) {
              streamingResult.execution.output.providerTiming.endTime = streamEndTimeISO
              streamingResult.execution.output.providerTiming.duration =
                streamEndTime - providerStartTime

              if (streamingResult.execution.output.providerTiming.timeSegments?.[0]) {
                streamingResult.execution.output.providerTiming.timeSegments[0].endTime =
                  streamEndTime
                streamingResult.execution.output.providerTiming.timeSegments[0].duration =
                  streamEndTime - providerStartTime
              }
            }

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
              content: '',
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

      const initialCallTime = Date.now()

      const originalToolChoice = payload.tool_choice

      const forcedTools = preparedTools?.forcedTools || []
      let usedForcedTools: string[] = []

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
            'mistral',
            forcedTools,
            usedForcedTools
          )
          hasUsedForcedTool = result.hasUsedForcedTool
          usedForcedTools = result.usedForcedTools
        }
      }

      let currentResponse = await mistral.chat.completions.create(payload)
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

      let modelTime = firstResponseTime
      let toolsTime = 0

      let hasUsedForcedTool = false

      const timeSegments: TimeSegment[] = [
        {
          type: 'model',
          name: 'Initial response',
          startTime: initialCallTime,
          endTime: initialCallTime + firstResponseTime,
          duration: firstResponseTime,
        },
      ]

      checkForForcedToolUsage(currentResponse, originalToolChoice)

      while (iterationCount < MAX_ITERATIONS) {
        const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls
        if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
          break
        }

        logger.info(
          `Processing ${toolCallsInResponse.length} tool calls (iteration ${iterationCount + 1}/${MAX_ITERATIONS})`
        )

        const toolsStartTime = Date.now()

        for (const toolCall of toolCallsInResponse) {
          try {
            const toolName = toolCall.function.name
            const toolArgs = JSON.parse(toolCall.function.arguments)

            const tool = request.tools?.find((t) => t.id === toolName)
            if (!tool) continue

            const toolCallStartTime = Date.now()

            const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)
            const result = await executeTool(toolName, executionParams, true)
            const toolCallEndTime = Date.now()
            const toolCallDuration = toolCallEndTime - toolCallStartTime

            timeSegments.push({
              type: 'tool',
              name: toolName,
              startTime: toolCallStartTime,
              endTime: toolCallEndTime,
              duration: toolCallDuration,
            })

            let resultContent: any
            if (result.success) {
              toolResults.push(result.output)
              resultContent = result.output
            } else {
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

        const thisToolsTime = Date.now() - toolsStartTime
        toolsTime += thisToolsTime

        const nextPayload = {
          ...payload,
          messages: currentMessages,
        }

        if (typeof originalToolChoice === 'object' && hasUsedForcedTool && forcedTools.length > 0) {
          const remainingTools = forcedTools.filter((tool) => !usedForcedTools.includes(tool))

          if (remainingTools.length > 0) {
            nextPayload.tool_choice = {
              type: 'function',
              function: { name: remainingTools[0] },
            }
            logger.info(`Forcing next tool: ${remainingTools[0]}`)
          } else {
            nextPayload.tool_choice = 'auto'
            logger.info('All forced tools have been used, switching to auto tool_choice')
          }
        }

        const nextModelStartTime = Date.now()

        currentResponse = await mistral.chat.completions.create(nextPayload)

        checkForForcedToolUsage(currentResponse, nextPayload.tool_choice)

        const nextModelEndTime = Date.now()
        const thisModelTime = nextModelEndTime - nextModelStartTime

        timeSegments.push({
          type: 'model',
          name: `Model response (iteration ${iterationCount + 1})`,
          startTime: nextModelStartTime,
          endTime: nextModelEndTime,
          duration: thisModelTime,
        })

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

      if (request.stream && iterationCount > 0) {
        logger.info('Using streaming for final response after tool calls')

        const streamingPayload = {
          ...payload,
          messages: currentMessages,
          tool_choice: 'auto',
          stream: true,
          stream_options: { include_usage: true },
        }

        const streamResponse = await mistral.chat.completions.create(streamingPayload)

        let _streamContent = ''

        const streamingResult = {
          stream: createReadableStreamFromMistralStream(streamResponse, (content, usage) => {
            _streamContent = content
            streamingResult.execution.output.content = content

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
              content: '',
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
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      logger.error('Error in Mistral request:', {
        error,
        duration: totalDuration,
      })

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

## Explanation of the Code:

This TypeScript code defines a provider configuration for interacting with the Mistral AI language models. It handles both standard requests and streaming responses, as well as integrates with tools to augment the capabilities of the language model. Let's break down each part:

**1. Imports:**

- `OpenAI from 'openai'`: Imports the OpenAI library, which is used to interact with the Mistral AI API (Mistral uses the OpenAI API spec).
- `createLogger from '@/lib/logs/console/logger'`: Imports a function to create a logger for debugging and monitoring.  This helps with logging information about the requests and responses.
- `StreamingExecution from '@/executor/types'`: Imports a type definition for streaming executions, which represents a response that is streamed back to the client.
- `getProviderDefaultModel, getProviderModels from '@/providers/models'`: Imports functions to retrieve the default model and a list of available models for the Mistral provider. This is likely pulling from some config where the supported models for Mistral are defined.
- `ProviderConfig, ProviderRequest, ProviderResponse, TimeSegment from '@/providers/types'`: Imports type definitions for provider configuration, request, response, and time segment data structures.  These are core types for defining how providers work within the larger system.
- `prepareToolExecution, prepareToolsWithUsageControl, trackForcedToolUsage from '@/providers/utils'`: Imports utility functions for handling tools. These functions are used to prepare tool execution parameters, manage tool usage, and track forced tool usage.
- `executeTool from '@/tools'`: Imports a function to execute a specific tool.

**2. Logger Initialization:**

- `const logger = createLogger('MistralProvider')`: Creates a logger instance specifically for the Mistral provider.  This allows for easy filtering of logs related to this provider.

**3. `createReadableStreamFromMistralStream` Function:**

This function transforms a Mistral AI stream (which might not be a standard `ReadableStream`) into a standard `ReadableStream` that can be easily consumed by other parts of the application. This is essential for handling streaming responses from Mistral.

- **Purpose:** Converts a Mistral-specific stream into a standard `ReadableStream`.
- **Parameters:**
  - `mistralStream`: The stream from the Mistral AI API. This is `any` because the type definition of the mistral stream isn't known at compile time
  - `onComplete`: An optional callback function that is called when the stream is finished. It receives the full content of the stream and any usage data (token counts).
- **Logic:**
  - `fullContent`: Accumulates the content received from the stream.
  - `usageData`: Stores any usage data received from the stream (e.g., token counts).
  - The function creates a new `ReadableStream` and defines its `start` method.
  - Inside the `start` method:
    - It iterates through the `mistralStream` using a `for await...of` loop.
    - For each `chunk` in the stream:
      - It extracts usage information, if available, and stores it in `usageData`.
      - It extracts the `content` from the chunk (specifically, `chunk.choices[0]?.delta?.content`). The `?.` operator is used for optional chaining, preventing errors if the properties are not present.
      - If `content` exists, it appends it to `fullContent` and enqueues it into the `controller` of the `ReadableStream` after encoding it with `TextEncoder`.
    - After the stream is complete:
      - It calls the `onComplete` callback with the `fullContent` and `usageData`.
      - It closes the `controller`, signaling the end of the stream.
    - Error handling is included in a `try...catch` block, which catches any errors during stream processing and reports them to the `controller`.

**4. `mistralProvider` Configuration:**

This is the main part of the code, defining the configuration for the Mistral AI provider.  It conforms to the `ProviderConfig` type.

- **`id`**:  A unique identifier for the provider ('mistral').
- **`name`**: The human-readable name of the provider ('Mistral AI').
- **`description`**: A brief description of the provider.
- **`version`**:  The version of the provider configuration.
- **`models`**:  A list of supported models for this provider, obtained using `getProviderModels('mistral')`.
- **`defaultModel`**: The default model to use if one is not explicitly specified in the request, obtained using `getProviderDefaultModel('mistral')`.
- **`executeRequest`**:  An `async` function that handles the execution of a request to the Mistral AI API.  This is the core logic of the provider.

**5. `executeRequest` Function Breakdown:**

This function takes a `ProviderRequest` as input and returns a `ProviderResponse` or a `StreamingExecution`. It orchestrates the entire process of sending a request to Mistral, handling the response (including streaming and tool calls), and returning the result.

- **Logging:**
  - `logger.info(...)`: Logs information about the incoming request, including the model, presence of system prompts, messages, tools, and streaming status. This is very helpful for debugging.

- **API Key Validation:**
  - `if (!request.apiKey) { throw new Error('API key is required for Mistral AI') }`: Checks if an API key is provided in the request. If not, it throws an error.

- **OpenAI Client Initialization:**
  - `const mistral = new OpenAI(...)`: Creates a new instance of the OpenAI client, configured with the API key and the Mistral AI API base URL.

- **Message Construction:**
  - The code constructs the `allMessages` array, which will be sent to the Mistral AI API. It includes the `systemPrompt` (if present), `context` (if present), and any `messages` from the request.
  - The messages are structured as objects with `role` (e.g., "system", "user") and `content`.

- **Tool Handling:**
  - The code transforms the `request.tools` into the format expected by the Mistral AI API.
  - `tools.map(tool => ({ type: 'function', function: { name: tool.id, description: tool.description, parameters: tool.parameters } }))`:  This maps the internal tool representation to Mistral's "function calling" format.
  - `prepareToolsWithUsageControl`: Uses the `prepareToolsWithUsageControl` function. This prepares the tools for usage, potentially filtering them and determining the appropriate `tool_choice` (whether to let the model choose automatically, force a specific tool, or disable tools).
  -  The `tool_choice` can be set to `auto`, a specific tool name, or an object that forces the model to use a tool.  This is crucial for controlling how tools are used.

- **Payload Construction:**
  - The code constructs the `payload` object, which will be sent as the body of the API request.  It includes:
    - `model`: The model to use.
    - `messages`: The constructed `allMessages` array.
  - It also adds optional parameters like `temperature` and `max_tokens` if they are present in the request.
  - If a `responseFormat` is specified, it's added to the payload as well, instructing the model to respond in a specific JSON schema.

- **Streaming Response Handling:**
  - `if (request.stream && (!tools || tools.length === 0))`: Checks if streaming is requested and if no tools are being used.  Streaming is handled differently when tools are involved.
  - If streaming is requested and no tools are used, it calls `mistral.chat.completions.create` with `stream: true`.
  - `createReadableStreamFromMistralStream`: The response stream is then passed to the `createReadableStreamFromMistralStream` function to convert it into a standard `ReadableStream`.
  - A `StreamingExecution` object is created, which contains the `ReadableStream` and metadata about the execution. The `onComplete` callback updates the `execution.output.content` and `execution.output.tokens`.

- **Non-Streaming Response and Tool Handling (Complex Logic):**

  - If streaming is *not* requested or *tools are used*, the code enters a more complex loop to handle potential tool calls.
  - **Iteration and Tool Execution:** The code iterates through a maximum of `MAX_ITERATIONS` (10).  In each iteration:
    - It checks if the response contains `tool_calls`. If not, the loop breaks.
    - It extracts the `tool_calls` from the response.
    - It iterates through each `toolCall`.
    - `executeTool`: It calls the `executeTool` function to execute the specified tool.
    - The results of the tool execution are added to the `currentMessages` array in the correct format (role: 'assistant' with the tool call, and role: 'tool' with the result).
    - **Time Tracking:** The code precisely tracks the time spent in different parts of the process (model response, tool execution) using `Date.now()`.  This timing information is crucial for performance analysis.
  - **Forced Tool Usage:** It implements logic to handle "forced tools." If the request specifies that certain tools *must* be used, the code ensures that they are called in the correct order.
  - **`trackForcedToolUsage` function:** This function is called to check the model's response against the `forcedTools` array. It determines if a forced tool has been used in the response.
  - **`checkForForcedToolUsage` function:** This function checks if the model has used a forced tool. If it has, it updates the `usedForcedTools` array.
  - **Dynamic Tool Choice:** It dynamically adjusts the `tool_choice` in subsequent requests based on whether forced tools have been used.  If there are remaining forced tools, it sets `tool_choice` to force the model to use the next one.  Once all forced tools have been used, it switches to `tool_choice: 'auto'`.
  - **Streaming Final Response After Tool Calls**: If streaming is requested *and* tools are used, the code calls `mistral.chat.completions.create` a second time, but in streaming mode. This is for the "final" response that comes *after* all the tool calls have been made.
  - **Final Response Construction:** After the loop completes (either by reaching `MAX_ITERATIONS` or because no more tool calls are present), the code constructs the final `ProviderResponse` object. This object includes the `content`, `model`, `tokens`, `toolCalls` (if any), and `timing` information.

- **Error Handling:**
  - The entire `executeRequest` function is wrapped in a `try...catch` block.
  - If any error occurs, the code logs the error and throws a new error with timing information attached.

**6. Return Value:**

- The `executeRequest` function returns either a `ProviderResponse` (for non-streaming requests) or a `StreamingExecution` (for streaming requests).

**In Summary:**

This code provides a robust and flexible integration with the Mistral AI API. It handles streaming, tool calls, and error handling, and it provides detailed logging and timing information. The complex tool handling logic allows for fine-grained control over how tools are used, including the ability to force the model to use specific tools in a particular order. The code is well-structured and uses TypeScript types extensively, which improves its readability and maintainability.
