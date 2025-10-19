Okay, I'll break down this TypeScript code for the `groqProvider`, explaining its purpose, simplifying complex logic, and detailing each line.

**Purpose of this file:**

This file defines a provider for interacting with the Groq AI platform.  It implements the `ProviderConfig` interface, which allows the application to use Groq's language models for tasks like generating text, processing tool calls, and handling both streaming and non-streaming responses. In essence, it's an adapter that translates the application's requests into a format that Groq's API understands and transforms Groq's responses into a format the application can readily use.

**Overall Structure:**

The code can be divided into these key sections:

1.  **Imports:**  Imports necessary modules and types from other files in the project and the `groq-sdk`.
2.  **Logger:**  Sets up a logger for debugging and monitoring.
3.  **`createReadableStreamFromGroqStream` Function:**  Converts a Groq-specific stream into a standard `ReadableStream` for use in browsers. This is crucial for streaming responses.
4.  **`groqProvider` Object:**  The main configuration object.  This object contains:
    *   Metadata:  `id`, `name`, `description`, `version`.
    *   Model information: `models`, `defaultModel` fetched using functions `getProviderModels` and `getProviderDefaultModel`.
    *   `executeRequest` Function: This is the core of the provider. It takes a `ProviderRequest` as input, interacts with the Groq API, handles tool calls, and returns a `ProviderResponse` or `StreamingExecution`.

**Line-by-line Explanation:**

```typescript
import { Groq } from 'groq-sdk'
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

const logger = createLogger('GroqProvider')
```

*   `import { Groq } from 'groq-sdk'`: Imports the `Groq` class from the `groq-sdk` package, which is the official Groq SDK for interacting with their API.
*   `import { createLogger } from '@/lib/logs/console/logger'`: Imports a `createLogger` function.  This function likely creates a logger instance configured for console output and is part of the application's logging system. The `@/` likely indicates the project's root directory.
*   `import type { StreamingExecution } from '@/executor/types'`: Imports the `StreamingExecution` type. This type defines the structure of a response when the provider is streaming data back to the client.
*   `import { getProviderDefaultModel, getProviderModels } from '@/providers/models'`: Imports two functions: `getProviderDefaultModel` and `getProviderModels`. These functions retrieve the available models and the default model for the Groq provider. They centralize model management.
*   `import type { ProviderConfig, ProviderRequest, ProviderResponse, TimeSegment } from '@/providers/types'`: Imports type definitions:
    *   `ProviderConfig`: Defines the structure of the provider configuration object (the `groqProvider` object in this file).
    *   `ProviderRequest`: Defines the structure of the request object that the `executeRequest` function receives. This includes the prompt, model, API key, and other settings.
    *   `ProviderResponse`: Defines the structure of a standard (non-streaming) response from the provider.
    *   `TimeSegment`: Defines a segment of time within the execution, used for performance tracking (e.g., model time, tool time).
*   `import { prepareToolExecution } from '@/providers/utils'`: Imports `prepareToolExecution` which presumably prepares tool parameters and execution context before a tool is executed.
*   `import { executeTool } from '@/tools'`: Imports the `executeTool` function, which is responsible for actually running a tool based on its name and arguments.
*   `const logger = createLogger('GroqProvider')`: Creates a logger instance named 'GroqProvider'.  This allows logging messages specifically for this provider, making debugging easier.

```typescript
/**
 * Helper to wrap Groq streaming into a browser-friendly ReadableStream
 * of raw assistant text chunks.
 */
function createReadableStreamFromGroqStream(groqStream: any): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of groqStream) {
          if (chunk.choices[0]?.delta?.content) {
            controller.enqueue(new TextEncoder().encode(chunk.choices[0].delta.content))
          }
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}
```

*   `/** ... */`:  A JSDoc comment explaining the purpose of the function.
*   `function createReadableStreamFromGroqStream(groqStream: any): ReadableStream`: Defines a function that takes a Groq-specific stream (`groqStream`) as input and returns a standard `ReadableStream`.  The `any` type for `groqStream` is not ideal and should be narrowed down if possible.
*   `return new ReadableStream({ ... })`: Creates a new `ReadableStream`.  `ReadableStream` is a browser API for handling streaming data.
*   `async start(controller) { ... }`: Defines the `start` method of the `ReadableStream`.  This method is called when the stream is initialized.  The `controller` object is used to manage the stream.
*   `try { ... } catch (err) { ... }`:  A standard `try...catch` block to handle potential errors during streaming.
*   `for await (const chunk of groqStream) { ... }`: Iterates asynchronously over the chunks of data received from the `groqStream`.  The `await` keyword ensures that each chunk is fully processed before moving to the next.
*   `if (chunk.choices[0]?.delta?.content) { ... }`: Checks if the current chunk contains content from the assistant.  The `?.` operator is the optional chaining operator, which prevents errors if any of the properties in the chain are null or undefined. The code expects the Groq stream to have choices, and each choice to have a delta, which has content.
*   `controller.enqueue(new TextEncoder().encode(chunk.choices[0].delta.content))`: Enqueues the content to the `ReadableStream`.  `new TextEncoder().encode()` converts the string content into a `Uint8Array`, which is the format required by `ReadableStream`.
*   `controller.close()`: Closes the stream, signaling that no more data will be sent.
*   `controller.error(err)`:  Signals an error in the stream, passing the error object to the consumer of the stream.

```typescript
export const groqProvider: ProviderConfig = {
  id: 'groq',
  name: 'Groq',
  description: "Groq's LLM models with high-performance inference",
  version: '1.0.0',
  models: getProviderModels('groq'),
  defaultModel: getProviderDefaultModel('groq'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Groq')
    }

    // Create Groq client
    const groq = new Groq({ apiKey: request.apiKey })

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

    // Transform tools to function format if provided
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
      model: (request.model || 'groq/meta-llama/llama-4-scout-17b-16e-instruct').replace(
        'groq/',
        ''
      ),
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

    // Handle tools and tool usage control
    if (tools?.length) {
      // Filter out any tools with usageControl='none', but ignore 'force' since Groq doesn't support it
      const filteredTools = tools.filter((tool) => {
        const toolId = tool.function?.name
        const toolConfig = request.tools?.find((t) => t.id === toolId)
        // Only filter out 'none', treat 'force' as 'auto'
        return toolConfig?.usageControl !== 'none'
      })

      if (filteredTools?.length) {
        payload.tools = filteredTools
        // Always use 'auto' for Groq, regardless of the tool_choice setting
        payload.tool_choice = 'auto'

        logger.info('Groq request configuration:', {
          toolCount: filteredTools.length,
          toolChoice: 'auto', // Groq always uses auto
          model: request.model || 'groq/meta-llama/llama-4-scout-17b-16e-instruct',
        })
      }
    }
```

*   `export const groqProvider: ProviderConfig = { ... }`:  Defines the main provider configuration object, which is exported to be used elsewhere in the application. It conforms to the `ProviderConfig` type.
*   `id: 'groq'`:  A unique identifier for the provider.
*   `name: 'Groq'`:  The human-readable name of the provider.
*   `description: "Groq's LLM models with high-performance inference"`: A brief description of the provider.
*   `version: '1.0.0'`:  The version of the provider.
*   `models: getProviderModels('groq')`:  Retrieves the available models for the Groq provider using the `getProviderModels` function.
*   `defaultModel: getProviderDefaultModel('groq')`: Retrieves the default model for the Groq provider using the `getProviderDefaultModel` function.
*   `executeRequest: async (request: ProviderRequest): Promise<ProviderResponse | StreamingExecution> => { ... }`: Defines the core function that handles requests to the Groq API. It takes a `ProviderRequest` and returns either a `ProviderResponse` (for non-streaming requests) or a `StreamingExecution` (for streaming requests).
*   `if (!request.apiKey) { throw new Error('API key is required for Groq') }`: Checks if an API key is provided in the request. If not, it throws an error.
*   `const groq = new Groq({ apiKey: request.apiKey })`: Creates a new instance of the `Groq` client, passing in the API key.
*   `const allMessages = []`: Initializes an empty array to store all messages for the Groq API request.  This will include system prompts, context, and user messages.
*   The following `if` blocks add messages to `allMessages`:
    *   `if (request.systemPrompt) { ... }`: Adds the system prompt (if provided) to the `allMessages` array.  The system prompt sets the overall behavior of the language model.
    *   `if (request.context) { ... }`: Adds the context (if provided) to the `allMessages` array. Context provides additional information that the model may need.
    *   `if (request.messages) { ... }`: Adds the remaining messages (if provided) to the `allMessages` array.  These are typically the user's questions or instructions.
*   The code transforms tools into function format:
    *   `const tools = request.tools?.length ? request.tools.map((tool) => ({ ... })) : undefined`: This block transforms tools if provided in the format that Groq's API expects (function calling).
    *   It maps over each tool and creates a new object with the `type` set to 'function' and a `function` object containing the tool's `name`, `description`, and `parameters`.
*   `const payload: any = { ... }`: Builds the request payload to send to the Groq API.  The `any` type here could be improved with a more specific type definition.
*   `model: (request.model || 'groq/meta-llama/llama-4-scout-17b-16e-instruct').replace('groq/', '')`: Sets the model to use. It defaults to `groq/meta-llama/llama-4-scout-17b-16e-instruct` if no model is specified in the request. It also removes the `groq/` prefix from the model name.
*   `messages: allMessages`:  Sets the `messages` in the payload to the `allMessages` array.
*   `if (request.temperature !== undefined) payload.temperature = request.temperature`: Sets the temperature (if provided) in the payload.  Temperature controls the randomness of the output.
*   `if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens`: Sets the maximum number of tokens to generate (if provided) in the payload.
*   `if (request.responseFormat) { ... }`: Handles structured output if specified
    *   `payload.response_format = { type: 'json_schema', schema: request.responseFormat.schema || request.responseFormat }`: Configures the response format for structured output (e.g., JSON).
*   The code handles tools and tool usage control:
    *   `if (tools?.length) { ... }`:  This block handles the use of tools, if any are provided.
    *   `const filteredTools = tools.filter((tool) => { ... })`: Filters out tools based on their `usageControl` setting. Tools with `usageControl: 'none'` are excluded.
    *   `payload.tools = filteredTools`: Sets the `tools` in the payload to the filtered list of tools.
    *   `payload.tool_choice = 'auto'`:  Sets the `tool_choice` to 'auto'. Groq ignores 'force'.
    *   `logger.info(...)`: Logs the Groq request configuration, including the number of tools, the tool choice, and the model.

```typescript
    // EARLY STREAMING: if caller requested streaming and there are no tools to execute,
    // we can directly stream the completion.
    if (request.stream && (!tools || tools.length === 0)) {
      logger.info('Using streaming response for Groq request (no tools)')

      // Start execution timer for the entire provider execution
      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      const streamResponse = await groq.chat.completions.create({
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
        stream: createReadableStreamFromGroqStream(streamResponse),
        execution: {
          success: true,
          output: {
            content: '', // Will be filled by streaming content in chat component
            model: request.model || 'groq/meta-llama/llama-4-scout-17b-16e-instruct',
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

*   `if (request.stream && (!tools || tools.length === 0)) { ... }`: This conditional block handles the case where streaming is requested and no tools are being used. This is an optimized path for simple streaming scenarios.
*   `logger.info('Using streaming response for Groq request (no tools)')`: Logs a message indicating that a streaming response is being used.
*   `const providerStartTime = Date.now()`: Records the start time of the provider execution.
*   `const providerStartTimeISO = new Date(providerStartTime).toISOString()`: Converts the start time to an ISO string format.
*   `const streamResponse = await groq.chat.completions.create({ ...payload, stream: true })`: Makes a request to the Groq API to create a streaming completion.
*   `const tokenUsage = { prompt: 0, completion: 0, total: 0 }`: Initializes an object to track token usage.  Since this is direct streaming, token usage is not available upfront.
*   `const streamingResult: StreamingExecution = { ... }`: Creates a `StreamingExecution` object to encapsulate the streaming response.
*   `stream: createReadableStreamFromGroqStream(streamResponse)`: Creates a `ReadableStream` from the Groq stream using the `createReadableStreamFromGroqStream` function.
*   The `execution` property contains information about the execution, including its success status, output, logs, and metadata. The `output.content` is initialized as an empty string because it will be filled in by the streaming content in the chat component.
*   `return streamingResult as StreamingExecution`: Returns the `StreamingExecution` object.

```typescript
    // Start execution timer for the entire provider execution
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      // Make the initial API request
      const initialCallTime = Date.now()

      let currentResponse = await groq.chat.completions.create(payload)
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

      try {
        while (iterationCount < MAX_ITERATIONS) {
          // Check for tool calls
          const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls
          if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
            break
          }

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
              logger.error('Error processing tool call:', { error })
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

          // Time the next model call
          const nextModelStartTime = Date.now()

          // Make the next request
          currentResponse = await groq.chat.completions.create(nextPayload)

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
      } catch (error) {
        logger.error('Error in Groq request:', { error })
      }
```

*   This section handles the core logic for interacting with the Groq API, including tool execution and iterative calls to the model.
*   `const providerStartTime = Date.now()`: Records the start time of the provider execution.
*   `const providerStartTimeISO = new Date(providerStartTime).toISOString()`: Converts the start time to an ISO string format.
*   `try { ... } catch (error) { ... }`: A `try...catch` block to handle errors during the Groq request.
*   `const initialCallTime = Date.now()`: Records the time before the initial API call.
*   `let currentResponse = await groq.chat.completions.create(payload)`: Makes the initial API request to Groq.
*   `const firstResponseTime = Date.now() - initialCallTime`: Calculates the time taken for the first response.
*   `let content = currentResponse.choices[0]?.message?.content || ''`: Extracts the content from the initial response.
*   `const tokens = { ... }`: Extracts the token usage from the initial response.
*   `const toolCalls = []`: Initializes an array to store tool call information.
*   `const toolResults = []`: Initializes an array to store the results of tool calls.
*   `const currentMessages = [...allMessages]`: Creates a copy of the `allMessages` array to keep track of the conversation history.
*   `let iterationCount = 0`: Initializes a counter for the number of iterations.
*   `const MAX_ITERATIONS = 10`: Defines a maximum number of iterations to prevent infinite loops.
*   `let modelTime = firstResponseTime`: Initializes a variable to track the time spent in the model.
*   `let toolsTime = 0`: Initializes a variable to track the time spent in tools.
*   `const timeSegments: TimeSegment[] = [ ... ]`: Initializes an array to track time segments for different parts of the execution (model, tools).
*   `while (iterationCount < MAX_ITERATIONS) { ... }`: A `while` loop that iterates as long as the number of iterations is less than the maximum. This loop handles tool calls and subsequent requests to the model.
*   `const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls`: Checks if the current response contains tool calls.
*   `if (!toolCallsInResponse || toolCallsInResponse.length === 0) { break }`: If there are no tool calls, the loop breaks.
*   `const toolsStartTime = Date.now()`: Records the start time for processing tool calls.
*   `for (const toolCall of toolCallsInResponse) { ... }`: A `for...of` loop that iterates over each tool call in the response.
*   `const toolName = toolCall.function.name`: Gets the name of the tool.
*   `const toolArgs = JSON.parse(toolCall.function.arguments)`: Parses the arguments for the tool.
*   `const tool = request.tools?.find((t) => t.id === toolName)`: Finds the tool definition in the request's tools array.
*   `if (!tool) continue`: If the tool is not found, the loop continues to the next tool call.
*   `const toolCallStartTime = Date.now()`: Records the start time of the tool call.
*   `const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)`: Prepares the tool execution by extracting relevant parameters.
*   `const result = await executeTool(toolName, executionParams, true)`: Executes the tool.
*   `const toolCallEndTime = Date.now()`: Records the end time of the tool call.
*   `const toolCallDuration = toolCallEndTime - toolCallStartTime`: Calculates the duration of the tool call.
*   `timeSegments.push({ ... })`: Adds a time segment for the tool call.
*   `let resultContent: any`: Declares a variable to store the result content.
*   `if (result.success) { ... } else { ... }`: Checks if the tool execution was successful. If so, the tool's output is used; otherwise, an error message is created.
*   `toolCalls.push({ ... })`: Adds information about the tool call to the `toolCalls` array.
*   `currentMessages.push({ ... })`: Adds the tool call and its result to the `currentMessages` array, which is used for the next request to the model.
*   `const thisToolsTime = Date.now() - toolsStartTime`: Calculates the time spent processing tool calls in this iteration.
*   `toolsTime += thisToolsTime`: Adds the time spent processing tool calls to the total tools time.
*   `const nextPayload = { ...payload, messages: currentMessages }`: Creates the payload for the next request to the model, including the updated conversation history.
*   `const nextModelStartTime = Date.now()`: Records the start time for the next model call.
*   `currentResponse = await groq.chat.completions.create(nextPayload)`: Makes the next request to the Groq API.
*   `const nextModelEndTime = Date.now()`: Records the end time for the next model call.
*   `const thisModelTime = nextModelEndTime - nextModelStartTime`: Calculates the time taken for the next model call.
*   `timeSegments.push({ ... })`: Adds a time segment for the model response.
*   `modelTime += thisModelTime`: Adds the time spent in the model to the total model time.
*   `if (currentResponse.choices[0]?.message?.content) { content = currentResponse.choices[0].message.content }`: Updates the content with the response from the model.
*   `if (currentResponse.usage) { ... }`: Updates the token counts with the usage from the model response.
*   `iterationCount++`: Increments the iteration counter.
*   The outer `catch` block logs any errors that occur during the Groq request.

```typescript
      // After all tool processing complete, if streaming was requested and we have messages, use streaming for the final response
      if (request.stream && iterationCount > 0) {
        logger.info('Using streaming for final Groq response after tool calls')

        // When streaming after tool calls with forced tools, make sure tool_choice is set to 'auto'
        // This prevents the API from trying to force tool usage again in the final streaming response
        const streamingPayload = {
          ...payload,
          messages: currentMessages,
          tool_choice: 'auto', // Always use 'auto' for the streaming response after tool calls
          stream: true,
        }

        const streamResponse = await groq.chat.completions.create(streamingPayload)

        // Create a StreamingExecution response with all collected data
        const streamingResult = {
          stream: createReadableStreamFromGroqStream(streamResponse),
          execution: {
            success: true,
            output: {
              content: '', // Will be filled by the callback
              model: request.model || 'groq/meta-llama/llama-4-scout-17b-16e-instruct',
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

      logger.error('Error in Groq request:', {
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

*   This `if` statement checks if streaming was requested AND tool processing occurred. If true, it streams the final response. This is to provide a streaming experience even when tool calls are involved, after the tool calls have completed.
*   `const streamingPayload = { ...payload, messages: currentMessages, tool_choice: 'auto', stream: true }`:  Creates a new payload for the streaming request.  Crucially, `tool_choice` is set to `auto` to prevent the API from trying to force tool usage again in the final streaming response.
*   The rest of this block constructs a `StreamingExecution` object, similar to the early streaming case.
*   If streaming wasn't requested or wasn't possible after tool calls:
    *   