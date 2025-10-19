Okay, here's a comprehensive breakdown of the provided TypeScript code, designed for clarity and understanding:

**Purpose of this File**

This file defines a provider for interacting with the Azure OpenAI service.  It encapsulates the logic for:

1.  **Configuring the Connection:** Setting up the connection to Azure OpenAI using API keys, endpoints, and API versions.
2.  **Formatting Requests:** Transforming a generic provider request into the specific format expected by the Azure OpenAI API.  This includes handling system prompts, context, messages, tools, and response formats.
3.  **Executing Requests:** Sending the formatted request to Azure OpenAI and receiving the response.  This includes both standard completion requests and streaming requests.
4.  **Tool Calling:** Managing tool calls.  It handles invoking tools based on the model's requests, and then incorporating the results back into the conversation with the model.
5.  **Tracking and Logging:** Monitoring token usage, timing information, and errors, and logging these details for debugging and analysis.
6.  **Streaming Support:** Handles streaming responses from Azure OpenAI, converting them into a standard `ReadableStream` for consumption by other parts of the application.
7. **Forced Tools:** Manages the process of forcing the model to use specific tools in sequence.

**Simplifying Complex Logic**

The complexity arises primarily from handling tool calls and streaming. Here's how the code tries to manage this:

*   **Helper Functions:** The `createReadableStreamFromAzureOpenAIStream` function abstracts away the details of how to process a stream from Azure OpenAI.
*   **Clear Variable Names:** The code uses descriptive variable names (e.g., `allMessages`, `deploymentName`, `preparedTools`) to make the logic easier to follow.
*   **Conditional Logic:**  `if` statements are used to handle different scenarios, such as whether streaming is enabled, whether tools are being used, and whether forced tools are required.
*   **Error Handling:** `try...catch` blocks are used to gracefully handle potential errors during API calls and tool execution.
*   **Logging:** Logging statements are strategically placed to provide insights into the execution flow and potential issues.
* **Iterative Tool Calls:** The `while` loop with `MAX_ITERATIONS` prevents infinite loops when the model repeatedly requests tool calls.
* **Type Safety:** Using TypeScript types extensively (e.g., `ProviderRequest`, `ProviderResponse`, `StreamingExecution`, `TimeSegment`) ensures type safety and reduces errors.
* **Modularity:** Utilizing functions from other files (`@/lib/env`, `@/lib/logs/console/logger`, `@/providers/models`, `@/providers/utils`, `@/tools`) promotes code reuse and maintainability.

**Line-by-Line Explanation**

```typescript
import { AzureOpenAI } from 'openai'
import { env } from '@/lib/env'
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

const logger = createLogger('AzureOpenAIProvider')
```

*   **`import ... from ...`:**  These lines import necessary modules and types from other files.
    *   `AzureOpenAI` is the OpenAI client for Azure.
    *   `env` is a module to access environment variables.
    *   `createLogger` is a function to create a logger instance.
    *   `StreamingExecution` is a type definition for streaming execution results.
    *   `getProviderDefaultModel`, `getProviderModels` are functions for retrieving default and available models for the provider.
    *   `ProviderConfig`, `ProviderRequest`, `ProviderResponse`, `TimeSegment` are type definitions for provider configuration, requests, responses, and time segments.
    *   `prepareToolExecution`, `prepareToolsWithUsageControl`, `trackForcedToolUsage` are functions for preparing and managing tool usage.
    *   `executeTool` is a function to execute a specific tool.
*   **`const logger = createLogger('AzureOpenAIProvider')`:** Creates a logger instance specifically for this provider, making it easier to filter logs.

```typescript
/**
 * Helper function to convert an Azure OpenAI stream to a standard ReadableStream
 * and collect completion metrics
 */
function createReadableStreamFromAzureOpenAIStream(
  azureOpenAIStream: any,
  onComplete?: (content: string, usage?: any) => void
): ReadableStream {
  let fullContent = ''
  let usageData: any = null

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of azureOpenAIStream) {
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

*   **`createReadableStreamFromAzureOpenAIStream` Function:**
    *   Takes an Azure OpenAI stream (`azureOpenAIStream`) and an optional `onComplete` callback as input.
    *   The `onComplete` callback is called when the stream finishes, providing the full content and usage data.
    *   It initializes `fullContent` to store the complete text and `usageData` to store usage information.
    *   It creates a standard `ReadableStream` from the Azure OpenAI stream.  This allows other parts of the application to consume the stream in a standard way.
    *   The `start` method of the `ReadableStream` is an `async` function that processes each chunk of the Azure OpenAI stream.
    *   Inside the loop:
        *   It extracts the `content` from the `chunk`. The `chunk.choices[0]?.delta?.content || ''` safely accesses the content, handling cases where the chunk might not have a `choices` array or `delta` property.
        *   If there is content, it's appended to `fullContent` and encoded using `TextEncoder` before being enqueued into the `ReadableStream`.
        *   It checks the final chunk for usage data to get token counts.
    *   After the loop (when the stream is complete):
        *   It calls the `onComplete` callback (if provided) with the accumulated `fullContent` and `usageData`.
        *   It closes the `ReadableStream`.
    *   Error handling: It catches any errors during stream processing and reports them to the `ReadableStream` controller.

```typescript
/**
 * Azure OpenAI provider configuration
 */
export const azureOpenAIProvider: ProviderConfig = {
  id: 'azure-openai',
  name: 'Azure OpenAI',
  description: 'Microsoft Azure OpenAI Service models',
  version: '1.0.0',
  models: getProviderModels('azure-openai'),
  defaultModel: getProviderDefaultModel('azure-openai'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    logger.info('Preparing Azure OpenAI request', {
      model: request.model || 'azure/gpt-4o',
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      stream: !!request.stream,
    })

    // Extract Azure-specific configuration from request or environment
    // Priority: request parameters > environment variables
    const azureEndpoint = request.azureEndpoint || env.AZURE_OPENAI_ENDPOINT
    const azureApiVersion =
      request.azureApiVersion || env.AZURE_OPENAI_API_VERSION || '2024-07-01-preview'

    if (!azureEndpoint) {
      throw new Error(
        'Azure OpenAI endpoint is required. Please provide it via azureEndpoint parameter or AZURE_OPENAI_ENDPOINT environment variable.'
      )
    }

    // API key is now handled server-side before this function is called
    const azureOpenAI = new AzureOpenAI({
      apiKey: request.apiKey,
      apiVersion: azureApiVersion,
      endpoint: azureEndpoint,
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

    // Transform tools to Azure OpenAI format if provided
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

    // Build the request payload - use deployment name instead of model name
    const deploymentName = (request.model || 'azure/gpt-4o').replace('azure/', '')
    const payload: any = {
      model: deploymentName, // Azure OpenAI uses deployment name
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
      // Use Azure OpenAI's JSON schema format
      payload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: request.responseFormat.name || 'response_schema',
          schema: request.responseFormat.schema || request.responseFormat,
          strict: request.responseFormat.strict !== false,
        },
      }

      logger.info('Added JSON schema response format to Azure OpenAI request')
    }

    // Handle tools and tool usage control
    let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

    if (tools?.length) {
      preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'azure-openai')
      const { tools: filteredTools, toolChoice } = preparedTools

      if (filteredTools?.length && toolChoice) {
        payload.tools = filteredTools
        payload.tool_choice = toolChoice

        logger.info('Azure OpenAI request configuration:', {
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
          model: deploymentName,
        })
      }
    }
```

*   **`azureOpenAIProvider: ProviderConfig = { ... }`:** This defines the configuration object for the Azure OpenAI provider.
    *   `id`, `name`, `description`, `version`: Basic metadata about the provider.
    *   `models`, `defaultModel`: References to functions (imported earlier) that retrieve the available models and the default model for this provider.
    *   `executeRequest: async (request: ProviderRequest): Promise<ProviderResponse | StreamingExecution> => { ... }`: This is the core function that executes a request to Azure OpenAI. It takes a `ProviderRequest` object as input and returns a `ProviderResponse` or a `StreamingExecution` promise.
        *   The `executeRequest` function is marked as `async` because it makes asynchronous API calls.
        *   The `Promise<ProviderResponse | StreamingExecution>` indicates that the function will return a promise that resolves to either a standard provider response or a streaming execution object.
        *   `logger.info(...)`: Logs information about the incoming request, including the model, the presence of a system prompt, messages, tools, and streaming.
        *   **Configuration Extraction:**
            *   `const azureEndpoint = request.azureEndpoint || env.AZURE_OPENAI_ENDPOINT`: Determines the Azure OpenAI endpoint, prioritizing the `azureEndpoint` from the `request` if provided, otherwise using the environment variable `AZURE_OPENAI_ENDPOINT`.
            *   `const azureApiVersion = request.azureApiVersion || env.AZURE_OPENAI_API_VERSION || '2024-07-01-preview'`: Determines the Azure OpenAI API version, prioritizing the `azureApiVersion` from the `request` if provided, otherwise using the environment variable `AZURE_OPENAI_API_VERSION`, and falling back to a default value if neither is available.
            *   It throws an error if `azureEndpoint` is not provided, as it's a mandatory configuration.
        *   **AzureOpenAI Client Initialization:**
            *   `const azureOpenAI = new AzureOpenAI({ apiKey: request.apiKey, apiVersion: azureApiVersion, endpoint: azureEndpoint })`: Creates an instance of the `AzureOpenAI` client, using the extracted configuration values.  **Important:**  The `apiKey` is assumed to be already handled server-side.
        *   **Message Construction:**
            *   `const allMessages = []`: Initializes an empty array to hold all messages for the request.
            *   `if (request.systemPrompt) { ... }`: Adds the system prompt (if provided) to the `allMessages` array with the role "system".
            *   `if (request.context) { ... }`: Adds the context (if provided) to the `allMessages` array with the role "user".
            *   `if (request.messages) { ... }`: Adds the remaining messages (if provided) to the `allMessages` array.
        *   **Tool Transformation:**
            *   `const tools = request.tools?.length ? ... : undefined`: Transforms the tools (if provided) from the generic format to the Azure OpenAI specific format.
                *   The `map` function iterates through the `request.tools` array.
                *   For each tool, it creates an object with `type: 'function'` and a `function` property that includes the tool's `name` (from `tool.id`), `description`, and `parameters`.
        *   **Payload Construction:**
            *   `const deploymentName = (request.model || 'azure/gpt-4o').replace('azure/', '')`:  Gets the deployment name from the `request.model` (or uses a default). Azure OpenAI uses deployment names instead of model names, so it removes the "azure/" prefix if present.
            *   `const payload: any = { model: deploymentName, messages: allMessages }`: Creates the base payload for the Azure OpenAI API request.
            *   It adds optional parameters like `temperature` and `max_tokens` to the `payload` if they are provided in the `request`.
            *  It adds GPT-5 specific parameters like `reasoning_effort` and `verbosity` to the `payload` if they are provided in the `request`.
            *   **Response Format:**
                *   `if (request.responseFormat) { ... }`: Handles the response format (if specified). It configures the payload to use Azure OpenAI's JSON schema format.
        *   **Tool Handling:**
            *   `let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null`: Declares a variable to store the prepared tools and their usage control information.
            *   `if (tools?.length) { ... }`: If tools are provided, it calls `prepareToolsWithUsageControl` to prepare the tools and control their usage.
            *   `const { tools: filteredTools, toolChoice } = preparedTools`: Extracts the filtered tools and the tool choice from the `preparedTools` object.
            *   `if (filteredTools?.length && toolChoice) { ... }`: If there are filtered tools and a tool choice is specified, it adds them to the `payload`.

```typescript
    // Start execution timer for the entire provider execution
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      // Check if we can stream directly (no tools required)
      if (request.stream && (!tools || tools.length === 0)) {
        logger.info('Using streaming response for Azure OpenAI request')

        // Create a streaming request with token usage tracking
        const streamResponse = await azureOpenAI.chat.completions.create({
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
          stream: createReadableStreamFromAzureOpenAIStream(streamResponse, (content, usage) => {
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
            'azure-openai',
            forcedTools,
            usedForcedTools
          )
          hasUsedForcedTool = result.hasUsedForcedTool
          usedForcedTools = result.usedForcedTools
        }
      }

      let currentResponse = await azureOpenAI.chat.completions.create(payload)
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
```

*   **Timing:**
    *   `const providerStartTime = Date.now()`: Records the start time of the provider execution.
    *   `const providerStartTimeISO = new Date(providerStartTime).toISOString()`: Converts the start time to ISO string format.
*   **Try/Catch Block:**
    *   `try { ... } catch (error) { ... }`: Wraps the core logic in a try/catch block to handle potential errors.
*   **Direct Streaming (No Tools):**
    *   `if (request.stream && (!tools || tools.length === 0)) { ... }`: Checks if streaming is enabled and there are no tools. If both conditions are true, it proceeds with direct streaming.
        *   `logger.info('Using streaming response for Azure OpenAI request')`: Logs that a streaming response is being used.
        *   `const streamResponse = await azureOpenAI.chat.completions.create({ ...payload, stream: true, stream_options: { include_usage: true } })`: Makes a streaming request to Azure OpenAI, including the `stream` option and `stream_options` to include usage data.
        *   `const tokenUsage = { prompt: 0, completion: 0, total: 0 }`: Initializes an object to track token usage.
        *   `const streamingResult = { ... } as StreamingExecution`: Creates a `StreamingExecution` object that will be returned.
            *   `stream`: Sets the `stream` property to the result of calling `createReadableStreamFromAzureOpenAIStream`, which converts the Azure OpenAI stream to a standard `ReadableStream`.
            *   `execution`: Sets the `execution` property to an object that contains information about the execution, including success status, output, tokens, provider timing, logs, and metadata.
        *   The `createReadableStreamFromAzureOpenAIStream` function will be invoked and take the chunks of the streamed response to construct a readable stream.
*   **Non-Streaming or Tool-Using Logic:**
    *   `const initialCallTime = Date.now()`: Records the time of the initial API call.
    *   `const originalToolChoice = payload.tool_choice`:  Stores the original `tool_choice` from the payload.
    *   `const forcedTools = preparedTools?.forcedTools || []`: Gets the list of forced tools from the `preparedTools` object.
    *   `let usedForcedTools: string[] = []`: Initializes an array to track which forced tools have been used.
    *   `const checkForForcedToolUsage = (response: any, toolChoice: string | { type: string; function?: { name: string }; name?: string; any?: any }) => { ... }`: Defines a helper function to check if a forced tool was used in the response.
    *   `let currentResponse = await azureOpenAI.chat.completions.create(payload)`: Makes the initial API request to Azure OpenAI.
    *   `const firstResponseTime = Date.now() - initialCallTime`: Calculates the time it took to get the first response.
    *   `let content = currentResponse.choices[0]?.message?.content || ''`: Extracts the content from the response.
    *   `const tokens = { prompt: currentResponse.usage?.prompt_tokens || 0, completion: currentResponse.usage?.completion_tokens || 0, total: currentResponse.usage?.total_tokens || 0 }`: Extracts token usage information from the response.
    *   `const toolCalls = []`: Initializes an array to store information about tool calls.
    *   `const toolResults = []`: Initializes an array to store the results of tool calls.
    *   `const currentMessages = [...allMessages]`: Creates a copy of the `allMessages` array to store the current conversation history.
    *   `let iterationCount = 0`: Initializes a counter to track the number of iterations.
    *   `const MAX_ITERATIONS = 10`: Sets the maximum number of iterations to prevent infinite loops.
    *   `let modelTime = firstResponseTime`: Initializes a variable to track the time spent in the model.
    *   `let toolsTime = 0`: Initializes a variable to track the time spent in tool execution.
    *   `let hasUsedForcedTool = false`: Initializes a variable to track if a forced tool has been used.
    *   `const timeSegments: TimeSegment[] = [ ... ]`: Initializes an array to track the time spent in each segment of the process (model calls and tool calls).
    *   `checkForForcedToolUsage(currentResponse, originalToolChoice)`: Checks if a forced tool was used in the first response.

```typescript
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
        currentResponse = await azureOpenAI.chat.completions.create(nextPayload)

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
```

*   **Tool Calling Loop:**
    *   `while (iterationCount < MAX_ITERATIONS) { ... }`: This loop continues as long as the model requests tool calls and the maximum number of iterations has not been reached.  This prevents infinite loops if the model gets stuck in a tool-calling cycle.
        *   `const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls`: Checks if the current response contains tool calls.
        *   `if (!toolCallsInResponse || toolCallsInResponse.length === 0) { break }`: If there are no tool calls, the loop breaks.
        *   `logger.info(...)`: Logs information about the tool calls being processed.
        *   `const toolsStartTime = Date.now()`: Records the start time of the tool calls.
        *   `for (const toolCall of toolCallsInResponse) { ... }`: This loop iterates through each tool call in the response.
            *   `try { ... } catch (error) { ... }`: A try/catch block is used to handle potential errors during tool execution.
            *   `const toolName = toolCall.function.name`: Gets the name of the tool to be called.
            *   `const toolArgs = JSON.parse(toolCall.function.arguments)`: Parses the arguments for the tool.
            *   `const tool = request.tools?.find((t) => t.id === toolName)`: Finds the tool in the request's list of tools.
            *   `if (!tool) continue`: If the tool is not found, the loop continues to the next tool call.
            *   `const toolCallStartTime = Date.now()`: Records the start time of the tool call.
            *   `const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)`: Prepares the tool execution by extracting the tool parameters and execution parameters.
            *   `const result = await executeTool(toolName, executionParams, true)`: Executes the tool.
            *   `const toolCallEndTime = Date.now()`: Records the end time of the tool call.
            *   `const toolCallDuration = toolCallEndTime - toolCallStartTime`: Calculates the duration of the tool call.
            *   `timeSegments.push(...)`: Adds a time segment for the tool call.
            *   `let resultContent: any`: Declares a variable to store the result content of the tool call.
            *   `if (result.success) { ... } else { ... }`: Checks if the tool execution was