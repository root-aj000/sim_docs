Okay, let's break down this TypeScript code, its purpose, and simplify its logic for better understanding.

**Purpose of this file:**

This file defines a `googleProvider` object, which serves as an integration point for using Google's Gemini models within a larger system (likely an AI assistant or agent framework).  It handles:

1.  **Configuration:**  Specifies the provider's ID, name, description, supported models, and default model.
2.  **Request Execution:**  The core functionality is within the `executeRequest` function, which takes a generic `ProviderRequest` and translates it into a Gemini-specific API call. It handles:
    *   API key validation
    *   Message format conversion
    *   Tool (function calling) integration
    *   Streaming and non-streaming responses
    *   Error handling
    *   Structured output support
    *   Timing and logging
3.  **Data Conversion:**  Includes functions to convert generic messages and tool definitions into the formats expected by the Gemini API.  It also handles parsing the Gemini API responses back into a generic format.
4.  **Streaming Support**: Implements logic to handle streaming responses from Gemini, including parsing JSON objects from the stream and handling function calls.
5.  **Tool Execution**: Handles the execution of tools and incorporates the results back into the conversation with the LLM.

**Overall, this file acts as an adapter, allowing a generic AI system to interact with Google's Gemini models.**

**Simplifying Complex Logic:**

The most complex part of this code is the `executeRequest` function, especially the sections dealing with:

*   **Streaming:**  Parsing JSON from the stream and handling the potential for function calls mid-stream.
*   **Tool (Function Calling) Execution:**  The iterative process of calling tools and feeding the results back to the model.

Here's a breakdown of how the code could be simplified conceptually:

1.  **Separate Concerns:**  The `executeRequest` function is doing a lot. Consider breaking it down into smaller, more focused functions. For example:
    *   `prepareGeminiPayload(request)`:  Creates the Gemini-specific request payload based on the generic `ProviderRequest`.
    *   `handleGeminiResponse(response, request, startTime)`:  Processes the Gemini API response (both streaming and non-streaming), extracts content, handles tool calls, and returns the appropriate data.
    *   `executeToolAndGetResponse(toolName, toolArgs, request)`: Encapsulates the tool execution logic and the subsequent response preparation.

2.  **Simplify Streaming JSON Parsing:** The streaming JSON parsing logic is intricate.  Consider using a more robust streaming JSON parser library if performance allows. This would eliminate the need for manual brace counting and string checking.

3.  **Reduce Nesting:**  The code has several nested `try...catch` blocks and `if` statements.  Refactoring into smaller functions and using early returns can reduce nesting and improve readability.

4.  **Clearer Error Handling:**  Ensure that each `catch` block logs the error and provides some context about what went wrong. Consider creating custom error classes for different types of errors (e.g., `GeminiAPIError`, `ToolExecutionError`).

5.  **Use Constants:**  Magic strings (like API endpoints) should be defined as constants for better maintainability.

**Line-by-Line Explanation:**

```typescript
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

// Creates a logger instance for this module, using the name 'GoogleProvider'.
const logger = createLogger('GoogleProvider')

/**
 * Creates a ReadableStream from Google's Gemini stream response
 */
function createReadableStreamFromGeminiStream(response: Response): ReadableStream<Uint8Array> {
  // Obtains a reader from the response body, which is expected to be a stream.
  const reader = response.body?.getReader()
  // If the reader is not available (e.g., response body is null), throw an error.
  if (!reader) {
    throw new Error('Failed to get reader from response body')
  }

  // Creates a new ReadableStream to process the incoming data.
  return new ReadableStream({
    // The 'start' method is called when the stream starts.  It initializes the stream controller.
    async start(controller) {
      try {
        // Initialize an empty buffer to store the incoming data.
        let buffer = ''

        // Main loop to read data from the stream.
        while (true) {
          // Read data from the reader. 'done' indicates the end of the stream. 'value' contains the data.
          const { done, value } = await reader.read()
          // If the stream is finished ('done' is true), process any remaining data in the buffer and close the stream.
          if (done) {
            // Try to parse any remaining buffer as complete JSON
            if (buffer.trim()) {
              // Processing final buffer
              try {
                const data = JSON.parse(buffer.trim())
                const candidate = data.candidates?.[0]
                if (candidate?.content?.parts) {
                  // Check if this is a function call
                  const functionCall = extractFunctionCall(candidate)
                  if (functionCall) {
                    logger.debug(
                      'Function call detected in final buffer, ending stream to execute tool',
                      {
                        functionName: functionCall.name,
                      }
                    )
                    // Function calls should not be streamed - end the stream early
                    controller.close()
                    return
                  }
                  const content = extractTextContent(candidate)
                  if (content) {
                    controller.enqueue(new TextEncoder().encode(content))
                  }
                }
              } catch (e) {
                // Final buffer not valid JSON, checking if it contains JSON array
                // Try parsing as JSON array if it starts with [
                if (buffer.trim().startsWith('[')) {
                  try {
                    const dataArray = JSON.parse(buffer.trim())
                    if (Array.isArray(dataArray)) {
                      for (const item of dataArray) {
                        const candidate = item.candidates?.[0]
                        if (candidate?.content?.parts) {
                          // Check if this is a function call
                          const functionCall = extractFunctionCall(candidate)
                          if (functionCall) {
                            logger.debug(
                              'Function call detected in array item, ending stream to execute tool',
                              {
                                functionName: functionCall.name,
                              }
                            )
                            controller.close()
                            return
                          }
                          const content = extractTextContent(candidate)
                          if (content) {
                            controller.enqueue(new TextEncoder().encode(content))
                          }
                        }
                      }
                    }
                  } catch (arrayError) {
                    // Buffer is not valid JSON array
                  }
                }
              }
            }
            // Close the stream controller, signaling the end of the stream.
            controller.close()
            break
          }

          // Decode the received data (Uint8Array) into a string.
          const text = new TextDecoder().decode(value)
          // Append the decoded text to the buffer.
          buffer += text

          // Try to find complete JSON objects in buffer
          // Look for patterns like: {...}\n{...} or just a single {...}
          let searchIndex = 0
          while (searchIndex < buffer.length) {
            const openBrace = buffer.indexOf('{', searchIndex)
            if (openBrace === -1) break

            // Try to find the matching closing brace
            let braceCount = 0
            let inString = false
            let escaped = false
            let closeBrace = -1

            for (let i = openBrace; i < buffer.length; i++) {
              const char = buffer[i]

              if (!inString) {
                if (char === '"' && !escaped) {
                  inString = true
                } else if (char === '{') {
                  braceCount++
                } else if (char === '}') {
                  braceCount--
                  if (braceCount === 0) {
                    closeBrace = i
                    break
                  }
                }
              } else {
                if (char === '"' && !escaped) {
                  inString = false
                }
              }

              escaped = char === '\\' && !escaped
            }

            if (closeBrace !== -1) {
              // Found a complete JSON object
              const jsonStr = buffer.substring(openBrace, closeBrace + 1)

              try {
                const data = JSON.parse(jsonStr)
                // JSON parsed successfully from stream

                const candidate = data.candidates?.[0]

                // Handle specific finish reasons
                if (candidate?.finishReason === 'UNEXPECTED_TOOL_CALL') {
                  logger.warn('Gemini returned UNEXPECTED_TOOL_CALL in streaming mode', {
                    finishReason: candidate.finishReason,
                    hasContent: !!candidate?.content,
                    hasParts: !!candidate?.content?.parts,
                  })
                  // This indicates a configuration issue - tools might be improperly configured for streaming
                  continue
                }

                if (candidate?.content?.parts) {
                  // Check if this is a function call
                  const functionCall = extractFunctionCall(candidate)
                  if (functionCall) {
                    logger.debug(
                      'Function call detected in stream, ending stream to execute tool',
                      {
                        functionName: functionCall.name,
                      }
                    )
                    // Function calls should not be streamed - we need to end the stream
                    // and let the non-streaming tool execution flow handle this
                    controller.close()
                    return
                  }
                  const content = extractTextContent(candidate)
                  if (content) {
                    controller.enqueue(new TextEncoder().encode(content))
                  }
                }
              } catch (e) {
                logger.error('Error parsing JSON from stream', {
                  error: e instanceof Error ? e.message : String(e),
                  jsonPreview: jsonStr.substring(0, 200),
                })
              }

              // Remove processed JSON from buffer and continue searching
              buffer = buffer.substring(closeBrace + 1)
              searchIndex = 0
            } else {
              // No complete JSON object found, wait for more data
              break
            }
          }
        }
      } catch (e) {
        // Log any errors that occur during stream processing.
        logger.error('Error reading Google Gemini stream', {
          error: e instanceof Error ? e.message : String(e),
        })
        // Signal an error to the stream controller.
        controller.error(e)
      }
    },
    // The 'cancel' method is called when the stream is cancelled.
    async cancel() {
      // Cancel the underlying reader.
      await reader.cancel()
    },
  })
}

// Defines the configuration for the Google provider.
export const googleProvider: ProviderConfig = {
  // Unique identifier for the provider.
  id: 'google',
  // Human-readable name of the provider.
  name: 'Google',
  // Description of the provider.
  description: "Google's Gemini models",
  // Version of the provider integration.
  version: '1.0.0',
  // Fetches a list of supported models for the Google provider.
  models: getProviderModels('google'),
  // Fetches the default model for the Google provider.
  defaultModel: getProviderDefaultModel('google'),

  // The main function that executes a request to the provider.
  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    // Checks if the API key is provided in the request.
    if (!request.apiKey) {
      throw new Error('API key is required for Google Gemini')
    }

    // Logs information about the incoming request.
    logger.info('Preparing Google Gemini request', {
      model: request.model || 'gemini-2.5-pro',
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      streaming: !!request.stream,
    })

    // Start execution timer for the entire provider execution
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      // Convert messages to Gemini format
      const { contents, tools, systemInstruction } = convertToGeminiFormat(request)

      const requestedModel = request.model || 'gemini-2.5-pro'

      // Build request payload
      const payload: any = {
        contents,
        generationConfig: {},
      }

      // Add temperature if specified
      if (request.temperature !== undefined && request.temperature !== null) {
        payload.generationConfig.temperature = request.temperature
      }

      // Add max tokens if specified
      if (request.maxTokens !== undefined) {
        payload.generationConfig.maxOutputTokens = request.maxTokens
      }

      // Add system instruction if provided
      if (systemInstruction) {
        payload.systemInstruction = systemInstruction
      }

      // Add structured output format if requested (but not when tools are present)
      if (request.responseFormat && !tools?.length) {
        const responseFormatSchema = request.responseFormat.schema || request.responseFormat

        // Clean the schema using our helper function
        const cleanSchema = cleanSchemaForGemini(responseFormatSchema)

        // Use Gemini's native structured output approach
        payload.generationConfig.responseMimeType = 'application/json'
        payload.generationConfig.responseSchema = cleanSchema

        logger.info('Using Gemini native structured output format', {
          hasSchema: !!cleanSchema,
          mimeType: 'application/json',
        })
      } else if (request.responseFormat && tools?.length) {
        logger.warn(
          'Gemini does not support structured output (responseFormat) with function calling (tools). Structured output will be ignored.'
        )
      }

      // Handle tools and tool usage control
      let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

      if (tools?.length) {
        preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'google')
        const { tools: filteredTools, toolConfig } = preparedTools

        if (filteredTools?.length) {
          payload.tools = [
            {
              functionDeclarations: filteredTools,
            },
          ]

          // Add Google-specific tool configuration
          if (toolConfig) {
            payload.toolConfig = toolConfig
          }

          logger.info('Google Gemini request with tools:', {
            toolCount: filteredTools.length,
            model: requestedModel,
            tools: filteredTools.map((t) => t.name),
            hasToolConfig: !!toolConfig,
            toolConfig: toolConfig,
          })
        }
      }

      // Make the API request
      const initialCallTime = Date.now()

      // Disable streaming for initial requests when tools are present to avoid function calls in streams
      // Only enable streaming for the final response after tool execution
      const shouldStream = request.stream && !tools?.length

      // Use streamGenerateContent for streaming requests
      const endpoint = shouldStream
        ? `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:streamGenerateContent?key=${request.apiKey}`
        : `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent?key=${request.apiKey}`

      if (request.stream && tools?.length) {
        logger.info('Streaming disabled for initial request due to tools presence', {
          toolCount: tools.length,
          willStreamAfterTools: true,
        })
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const responseText = await response.text()
        logger.error('Gemini API error details:', {
          status: response.status,
          statusText: response.statusText,
          responseBody: responseText,
        })
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`)
      }

      const firstResponseTime = Date.now() - initialCallTime

      // Handle streaming response
      if (shouldStream) {
        logger.info('Handling Google Gemini streaming response')

        // Create a ReadableStream from the Google Gemini stream
        const stream = createReadableStreamFromGeminiStream(response)

        // Create an object that combines the stream with execution metadata
        const streamingExecution: StreamingExecution = {
          stream,
          execution: {
            success: true,
            output: {
              content: '',
              model: request.model,
              tokens: {
                prompt: 0,
                completion: 0,
                total: 0,
              },
              providerTiming: {
                startTime: providerStartTimeISO,
                endTime: new Date().toISOString(),
                duration: firstResponseTime,
                modelTime: firstResponseTime,
                toolsTime: 0,
                firstResponseTime,
                iterations: 1,
                timeSegments: [
                  {
                    type: 'model',
                    name: 'Initial streaming response',
                    startTime: initialCallTime,
                    endTime: initialCallTime + firstResponseTime,
                    duration: firstResponseTime,
                  },
                ],
                // Cost will be calculated in logger
              },
            },
            logs: [],
            metadata: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: firstResponseTime,
            },
            isStreaming: true,
          },
        }

        return streamingExecution
      }

      let geminiResponse = await response.json()

      // Check structured output format
      if (payload.generationConfig?.responseSchema) {
        const candidate = geminiResponse.candidates?.[0]
        if (candidate?.content?.parts?.[0]?.text) {
          const text = candidate.content.parts[0].text
          try {
            // Validate JSON structure
            JSON.parse(text)
            logger.info('Successfully received structured JSON output')
          } catch (_e) {
            logger.warn('Failed to parse structured output as JSON')
          }
        }
      }

      // Initialize response tracking variables
      let content = ''
      let tokens = {
        prompt: 0,
        completion: 0,
        total: 0,
      }
      const toolCalls = []
      const toolResults = []
      let iterationCount = 0
      const MAX_ITERATIONS = 10 // Prevent infinite loops

      // Track forced tools and their usage (similar to OpenAI pattern)
      const originalToolConfig = preparedTools?.toolConfig
      const forcedTools = preparedTools?.forcedTools || []
      let usedForcedTools: string[] = []
      let hasUsedForcedTool = false
      let currentToolConfig = originalToolConfig

      // Helper function to check for forced tool usage in responses
      const checkForForcedToolUsage = (functionCall: { name: string; args: any }) => {
        if (currentToolConfig && forcedTools.length > 0) {
          const toolCallsForTracking = [{ name: functionCall.name, arguments: functionCall.args }]
          const result = trackForcedToolUsage(
            toolCallsForTracking,
            currentToolConfig,
            logger,
            'google',
            forcedTools,
            usedForcedTools
          )
          hasUsedForcedTool = result.hasUsedForcedTool
          usedForcedTools = result.usedForcedTools

          if (result.nextToolConfig) {
            currentToolConfig = result.nextToolConfig
            logger.info('Updated tool config for next iteration', {
              hasNextToolConfig: !!currentToolConfig,
              usedForcedTools: usedForcedTools,
            })
          }
        }
      }

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
        // Extract content or function calls from initial response
        const candidate = geminiResponse.candidates?.[0]

        // Check if response contains function calls
        const functionCall = extractFunctionCall(candidate)

        if (functionCall) {
          logger.info(`Received function call from Gemini: ${functionCall.name}`)

          // Process function calls in a loop
          while (iterationCount < MAX_ITERATIONS) {
            // Get the latest function calls
            const latestResponse = geminiResponse.candidates?.[0]
            const latestFunctionCall = extractFunctionCall(latestResponse)

            if (!latestFunctionCall) {
              // No more function calls - extract final text content
              content = extractTextContent(latestResponse)
              break
            }

            logger.info(
              `Processing function call: ${latestFunctionCall.name} (iteration ${iterationCount + 1}/${MAX_ITERATIONS})`
            )

            // Track time for tool calls
            const toolsStartTime = Date.now()

            try {
              const toolName = latestFunctionCall.name
              const toolArgs = latestFunctionCall.args || {}

              // Get the tool from the tools registry
              const tool = request.tools?.find((t) => t.id === toolName)
              if (!tool) {
                logger.warn(`Tool ${toolName} not found in registry, skipping`)
                break
              }

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

              // Prepare for next request with simplified messages
              // Use simple format: original query + most recent function call + result
              const simplifiedMessages = [
                // Original user request - find the first user request
                ...(contents.filter((m) => m.role === 'user').length > 0
                  ? [contents.filter((m) => m.role === 'user')[0]]
                  : [contents[0]]),
                // Function call from model
                {
                  role: 'model',
                  parts: [
                    {
                      functionCall: {
                        name: latestFunctionCall.name,
                        args: latestFunctionCall.args,
                      },
                    },
                  ],
                },
                // Function response - but use USER role since Gemini only accepts user or model
                {
                  role: 'user',
                  parts: [
                    {
                      text: `Function ${latestFunctionCall.name} result: ${JSON.stringify(resultContent)}`,
                    },
                  ],
                },
              ]

              // Calculate tool call time
              const thisToolsTime = Date.now() - toolsStartTime
              toolsTime += thisToolsTime

              // Check for forced tool usage and update configuration
              checkForForcedToolUsage(latestFunctionCall)

              // Make the next request with updated messages
              const nextModelStartTime = Date.now()

              try {
                // Check if we should stream the final response after tool calls
                if (request.stream) {
                  // Create a payload for the streaming response after tool calls
                  const streamingPayload = {
                    ...payload,
                    contents: simplifiedMessages,
                  }

                  // Check if we should remove tools and enable structured output for final response
                  const allForcedToolsUsed =
                    forcedTools.length > 0 && usedForcedTools.length === forcedTools.length

                  if (allForcedToolsUsed && request.responseFormat) {
                    // All forced tools have been used, we can now remove tools and enable structured output
                    streamingPayload.tools = undefined
                    streamingPayload.toolConfig = undefined

                    // Add structured output format for final response
                    const responseFormatSchema =
                      request.responseFormat.schema || request.responseFormat
                    const cleanSchema = cleanSchemaForGemini(responseFormatSchema)

                    if (!streamingPayload.generationConfig) {
                      streamingPayload.generationConfig = {}
                    }
                    streamingPayload.generationConfig.responseMimeType = 'application/json'
                    streamingPayload.generationConfig.responseSchema = cleanSchema

                    logger.info('Using structured output for final response after tool execution')
                  } else {
                    // Use updated tool configuration if available, otherwise default to AUTO
                    if (currentToolConfig) {
                      streamingPayload.toolConfig = currentToolConfig
                    } else {
                      streamingPayload.toolConfig = { functionCallingConfig: { mode: 'AUTO' } }
                    }
                  }

                  // Check if we should handle this as a potential forced tool call
                  // First make a non-streaming request to see if we get a function call
                  const checkPayload = {
                    ...streamingPayload,
                    // Remove stream property to get non-streaming response
                  }
                  checkPayload.stream = undefined

                  const checkResponse = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent?key=${request.apiKey}`,
                    {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify(checkPayload),
                    }
                  )

                  if (!checkResponse.ok) {
                    const errorBody = await checkResponse.text()
                    logger.error('Error in Gemini check request:', {
                      status: checkResponse.status,
                      statusText: checkResponse.statusText,
                      responseBody: errorBody,
                    })
                    throw new Error(
                      `Gemini API check error: ${checkResponse.status} ${checkResponse.statusText}`
                    )
                  }

                  const checkResult = await checkResponse.json()
                  const checkCandidate = checkResult.candidates?.[0]
                  const checkFunctionCall = extractFunctionCall(checkCandidate)

                  if (checkFunctionCall) {
                    // We have a function call - handle it in non-streaming mode
                    logger.info(
                      'Function call detected in follow-up, handling in non-streaming mode',
                      {
                        functionName: checkFunctionCall.name,
                      }
                    )

                    // Update geminiResponse to continue the tool execution loop
                    geminiResponse = checkResult

                    // Update token counts if available
                    if (checkResult.usageMetadata) {
                      tokens.prompt += checkResult.usageMetadata.promptTokenCount || 0
                      tokens.completion += checkResult.usageMetadata.candidatesTokenCount || 0
                      tokens.total +=
                        (checkResult.usageMetadata.promptTokenCount || 0) +
                        (checkResult.usageMetadata.candidatesTokenCount || 0)
                    }

                    // Calculate timing for this model call
                    const nextModelEndTime = Date.now()
                    const thisModelTime = nextModelEndTime - nextModelStartTime
                    modelTime += thisModelTime

                    // Add to time segments
                    timeSegments.push({
                      type: 'model',
                      name: `Model response (iteration ${iterationCount + 1})`,
                      startTime: nextModelStartTime,
                      endTime: nextModelEndTime,
                      duration: thisModelTime,
                    })

                    // Continue the loop to handle the function call
                    iterationCount++
                    continue
                  }
                  // No function call - proceed with streaming
                  logger.info('No function call detected, proceeding with streaming response')

                  // Make the streaming request with streamGenerateContent endpoint
                  const streamingResponse = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:streamGenerateContent?key=${request.apiKey}`,
                    {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify(streamingPayload),
                    }
                  )

                  if (!streamingResponse.ok) {
                    const errorBody = await streamingResponse.text()
                    logger.error('Error in Gemini streaming follow-up request:', {
                      status: streamingResponse.status,
                      statusText: streamingResponse.statusText,
                      responseBody: errorBody,
                    })
                    throw new Error(
                      `Gemini API streaming error: ${streamingResponse.status} ${streamingResponse.statusText}`
                    )
                  }

                  // Create a stream from the response
                  const stream = createReadableStreamFromGeminiStream(streamingResponse)

                  // Calculate timing information
                  const nextModelEndTime = Date.now()
                  const thisModelTime = nextModelEndTime - nextModelStartTime
                  modelTime += thisModelTime

                  // Add to time segments
                  timeSegments.push({
                    type: 'model',
                    name: 'Final streaming response after tool calls',
                    startTime: nextModelStartTime,
                    endTime: nextModelEndTime,
                    duration: thisModelTime,
                  })

                  // Return a streaming execution with tool call information
                  const streamingExecution: StreamingExecution = {
                    stream,
                    execution: {
                      success: true,
                      output: {
                        content: '',
                        model: request.model,
                        tokens,
                        toolCalls:
                          toolCalls.length > 0
                            ? {
                                list: toolCalls,
                                count: toolCalls.length,
                              }
                            : undefined,
                        toolResults,
                        providerTiming: {
                          startTime: providerStartTimeISO,
                          endTime: new Date().toISOString(),
                          duration: Date.now() - providerStartTime,
                          modelTime,
                          toolsTime,
                          firstResponseTime,
                          iterations: iterationCount + 1,
                          timeSegments,
                        },
                        // Cost will be calculated in logger
                      },
                      logs: [],
                      metadata: {
                        startTime: providerStartTimeISO,
                        endTime: new Date().toISOString(),
                        duration: Date.now() - providerStartTime,
                      },
                      isStreaming: true,
                    },
                  }

                  return streamingExecution
                }

                // Make the next request for non-streaming response
                const nextPayload = {
                  ...payload,
                  contents: simplifiedMessages,
                }

                // Check if we should remove tools and enable structured output for final response
                const allForcedToolsUsed =
                  forcedTools.length > 0 && usedForcedTools.length === forcedTools.length

                if (allForcedToolsUsed && request.responseFormat) {
                  // All forced tools have been used, we can now remove tools and enable structured output
                  nextPayload.tools = undefined
                  nextPayload.toolConfig = undefined

                  // Add structured output format for final response
                  const responseFormatSchema =
                    request.responseFormat.schema || request.responseFormat
                  const cleanSchema = cleanSchemaForGemini(responseFormatSchema)

                  if (!nextPayload.generationConfig) {
                    nextPayload.generationConfig = {}
                  }
                  nextPayload.generationConfig.responseMimeType = 'application/json'
                  nextPayload.generationConfig.responseSchema = cleanSchema

                  logger.info(
                    'Using structured output for final non-streaming response after tool execution'
                  )
                } else {
                  // Add updated tool configuration if available
                  if (currentToolConfig) {
                    nextPayload.toolConfig = currentToolConfig
                  }
                }

                const nextResponse = await fetch(
                  `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent?key=${request.apiKey}`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(nextPayload),
                  }
                )

                if (!nextResponse.ok) {
                  const errorBody = await nextResponse.text()
                  logger.error('Error in Gemini follow-up request:', {
                    status: nextResponse.status,
                    statusText: nextResponse.statusText,
                    responseBody: errorBody,
                    iterationCount,
                  })
                  break
                }

                geminiResponse = await nextResponse.json()

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

                // Check if we need to continue or break
                const nextCandidate = geminiResponse.candidates?.[0]
                const nextFunctionCall = extractFunctionCall(nextCandidate)

                if (!nextFunctionCall) {
                  content = extractTextContent(nextCandidate)
                  break
                }

                iterationCount++
              } catch (error) {
                logger.error('Error in Gemini follow-up request:', {
                  error: error instanceof Error ? error.message : String(error),
                  iterationCount,
                })
                break
              }
            } catch (error) {
              logger.error('Error processing function call:', {
                error: error instanceof Error ? error.message : String(error),
                functionName: latestFunctionCall?.name || 'unknown',
              })
              break
            }
          }
        } else {
          // Regular text response
          content = extractTextContent(candidate)
        }
      } catch (error) {
        logger.error('Error processing Gemini response:', {
          error: error instanceof Error ? error.message : String(error),
          iterationCount,
        })

        // Don't rethrow, so