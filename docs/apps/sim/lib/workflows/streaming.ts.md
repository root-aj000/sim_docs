```typescript
import { createLogger } from '@/lib/logs/console/logger'
import { encodeSSE } from '@/lib/utils'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('WorkflowStreaming')

export interface StreamingConfig {
  selectedOutputs?: string[]
  isSecureMode?: boolean
  workflowTriggerType?: 'api' | 'chat'
  onStream?: (streamingExec: {
    stream: ReadableStream
    execution?: { blockId?: string }
  }) => Promise<void>
}

export interface StreamingResponseOptions {
  requestId: string
  workflow: { id: string; userId: string; workspaceId?: string | null; isDeployed?: boolean }
  input: any
  executingUserId: string
  streamConfig: StreamingConfig
  createFilteredResult: (result: ExecutionResult) => any
  executionId?: string
}

export async function createStreamingResponse(
  options: StreamingResponseOptions
): Promise<ReadableStream> {
  const {
    requestId,
    workflow,
    input,
    executingUserId,
    streamConfig,
    createFilteredResult,
    executionId,
  } = options

  const { executeWorkflow, createFilteredResult: defaultFilteredResult } = await import(
    '@/app/api/workflows/[id]/execute/route'
  )
  const filterResultFn = createFilteredResult || defaultFilteredResult

  return new ReadableStream({
    async start(controller) {
      try {
        const streamedContent = new Map<string, string>()
        const processedOutputs = new Set<string>()
        const streamCompletionTimes = new Map<string, number>()

        const sendChunk = (blockId: string, content: string) => {
          const separator = processedOutputs.size > 0 ? '\n\n' : ''
          controller.enqueue(encodeSSE({ blockId, chunk: separator + content }))
          processedOutputs.add(blockId)
        }

        const onStreamCallback = async (streamingExec: {
          stream: ReadableStream
          execution?: { blockId?: string }
        }) => {
          const blockId = streamingExec.execution?.blockId || 'unknown'
          const reader = streamingExec.stream.getReader()
          const decoder = new TextDecoder()
          let isFirstChunk = true

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) {
                // Record when this stream completed
                streamCompletionTimes.set(blockId, Date.now())
                break
              }

              const textChunk = decoder.decode(value, { stream: true })
              streamedContent.set(blockId, (streamedContent.get(blockId) || '') + textChunk)

              if (isFirstChunk) {
                sendChunk(blockId, textChunk)
                isFirstChunk = false
              } else {
                controller.enqueue(encodeSSE({ blockId, chunk: textChunk }))
              }
            }
          } catch (streamError) {
            logger.error(`[${requestId}] Error reading agent stream:`, streamError)
            controller.enqueue(
              encodeSSE({
                event: 'stream_error',
                blockId,
                error: streamError instanceof Error ? streamError.message : 'Stream reading error',
              })
            )
          }
        }

        const onBlockCompleteCallback = async (blockId: string, output: any) => {
          if (!streamConfig.selectedOutputs?.length) return

          const { extractBlockIdFromOutputId, extractPathFromOutputId, traverseObjectPath } =
            await import('@/lib/response-format')

          const matchingOutputs = streamConfig.selectedOutputs.filter(
            (outputId) => extractBlockIdFromOutputId(outputId) === blockId
          )

          if (!matchingOutputs.length) return

          for (const outputId of matchingOutputs) {
            const path = extractPathFromOutputId(outputId, blockId)

            let outputValue = traverseObjectPath(output, path)
            if (outputValue === undefined && output.response) {
              outputValue = traverseObjectPath(output.response, path)
            }

            if (outputValue !== undefined) {
              const formattedOutput =
                typeof outputValue === 'string' ? outputValue : JSON.stringify(outputValue, null, 2)
              sendChunk(blockId, formattedOutput)
            }
          }
        }

        const result = await executeWorkflow(
          workflow,
          requestId,
          input,
          executingUserId,
          {
            enabled: true,
            selectedOutputs: streamConfig.selectedOutputs,
            isSecureMode: streamConfig.isSecureMode,
            workflowTriggerType: streamConfig.workflowTriggerType,
            onStream: onStreamCallback,
            onBlockComplete: onBlockCompleteCallback,
            skipLoggingComplete: true, // We'll complete logging after tokenization
          },
          executionId
        )

        if (result.logs && streamedContent.size > 0) {
          result.logs = result.logs.map((log: any) => {
            if (streamedContent.has(log.blockId)) {
              const content = streamedContent.get(log.blockId)

              // Update timing to reflect actual stream completion
              if (streamCompletionTimes.has(log.blockId)) {
                const completionTime = streamCompletionTimes.get(log.blockId)!
                const startTime = new Date(log.startedAt).getTime()
                log.endedAt = new Date(completionTime).toISOString()
                log.durationMs = completionTime - startTime
              }

              if (log.output && content) {
                return { ...log, output: { ...log.output, content } }
              }
            }
            return log
          })

          const { processStreamingBlockLogs } = await import('@/lib/tokenization')
          processStreamingBlockLogs(result.logs, streamedContent)
        }

        // Complete the logging session with updated trace spans that include cost data
        if (result._streamingMetadata?.loggingSession) {
          const { buildTraceSpans } = await import('@/lib/logs/execution/trace-spans/trace-spans')
          const { traceSpans, totalDuration } = buildTraceSpans(result)

          await result._streamingMetadata.loggingSession.safeComplete({
            endedAt: new Date().toISOString(),
            totalDurationMs: totalDuration || 0,
            finalOutput: result.output || {},
            traceSpans: (traceSpans || []) as any,
            workflowInput: result._streamingMetadata.processedInput,
          })

          result._streamingMetadata = undefined
        }

        // Create a minimal result with only selected outputs
        const minimalResult = {
          success: result.success,
          error: result.error,
          output: {} as any,
        }

        if (streamConfig.selectedOutputs?.length && result.output) {
          const { extractBlockIdFromOutputId, extractPathFromOutputId, traverseObjectPath } =
            await import('@/lib/response-format')

          for (const outputId of streamConfig.selectedOutputs) {
            const blockId = extractBlockIdFromOutputId(outputId)
            const path = extractPathFromOutputId(outputId, blockId)

            if (result.logs) {
              const blockLog = result.logs.find((log: any) => log.blockId === blockId)
              if (blockLog?.output) {
                let value = traverseObjectPath(blockLog.output, path)
                if (value === undefined && blockLog.output.response) {
                  value = traverseObjectPath(blockLog.output.response, path)
                }
                if (value !== undefined) {
                  const dangerousKeys = ['__proto__', 'constructor', 'prototype']
                  if (dangerousKeys.includes(blockId) || dangerousKeys.includes(path)) {
                    logger.warn(
                      `[${requestId}] Blocked potentially dangerous property assignment`,
                      {
                        blockId,
                        path,
                      }
                    )
                    continue
                  }

                  if (!minimalResult.output[blockId]) {
                    minimalResult.output[blockId] = Object.create(null)
                  }
                  minimalResult.output[blockId][path] = value
                }
              }
            }
          }
        } else if (!streamConfig.selectedOutputs?.length) {
          minimalResult.output = result.output
        }

        controller.enqueue(encodeSSE({ event: 'final', data: minimalResult }))
        controller.enqueue(encodeSSE('[DONE]'))
        controller.close()
      } catch (error: any) {
        logger.error(`[${requestId}] Stream error:`, error)
        controller.enqueue(
          encodeSSE({ event: 'error', error: error.message || 'Stream processing error' })
        )
        controller.close()
      }
    },
  })
}
```

### Purpose of this File

This TypeScript file defines a function `createStreamingResponse` that creates a `ReadableStream` for streaming the execution of a workflow. The stream emits server-sent events (SSE) representing the progress and output of the workflow execution. This allows clients to receive real-time updates as the workflow runs, improving the user experience. The file handles configuration for the stream, execution of the workflow, filtering outputs, and error handling.

### Simplification of Complex Logic

The code handles the complexity of workflow execution streaming by:

1.  **Abstraction:**  Encapsulating the streaming logic within the `createStreamingResponse` function.  The caller only needs to provide the `StreamingResponseOptions` and receives a `ReadableStream` in return.
2.  **Modularity:**  Delegating specific tasks to other modules such as workflow execution (via `@/app/api/workflows/[id]/execute/route`), encoding SSE messages (`@/lib/utils`), and response formatting (`@/lib/response-format`).  This makes the code easier to understand and maintain.
3.  **Event-driven approach:** Using callbacks (`onStream`, `onBlockComplete`) to handle asynchronous events during workflow execution. This prevents blocking the main execution thread and allows for non-linear processing.
4.  **Error Handling:** Using `try...catch` blocks to gracefully handle potential errors during streaming and workflow execution, providing informative error messages to the client via SSE events.

### Code Explanation

**1. Imports:**

```typescript
import { createLogger } from '@/lib/logs/console/logger'
import { encodeSSE } from '@/lib/utils'
import type { ExecutionResult } from '@/executor/types'
```

*   `createLogger`: Imports a function to create a logger instance for logging messages. It is assumed that `@/lib/logs/console/logger` exports a function for creating loggers.
*   `encodeSSE`: Imports a function to encode data into the Server-Sent Events (SSE) format.  This format is used to send real-time updates from the server to the client over a single HTTP connection.
*   `ExecutionResult`: Imports a type definition for the result of a workflow execution.

**2. Logger Instance:**

```typescript
const logger = createLogger('WorkflowStreaming')
```

*   Creates a logger instance named 'WorkflowStreaming' using the `createLogger` function. This logger will be used to log messages related to the workflow streaming process.

**3. `StreamingConfig` Interface:**

```typescript
export interface StreamingConfig {
  selectedOutputs?: string[]
  isSecureMode?: boolean
  workflowTriggerType?: 'api' | 'chat'
  onStream?: (streamingExec: {
    stream: ReadableStream
    execution?: { blockId?: string }
  }) => Promise<void>
}
```

*   Defines an interface `StreamingConfig` to configure the streaming behavior.
    *   `selectedOutputs`: An optional array of strings representing the output IDs to be streamed. If provided, only the specified outputs will be sent to the client.
    *   `isSecureMode`: An optional boolean indicating whether the workflow should be executed in secure mode.
    *   `workflowTriggerType`: An optional string indicating how the workflow was triggered (either 'api' or 'chat').
    *   `onStream`: An optional callback function that will be called when a stream is available for a block.  It receives a `ReadableStream` and an optional `execution` object containing the block ID.

**4. `StreamingResponseOptions` Interface:**

```typescript
export interface StreamingResponseOptions {
  requestId: string
  workflow: { id: string; userId: string; workspaceId?: string | null; isDeployed?: boolean }
  input: any
  executingUserId: string
  streamConfig: StreamingConfig
  createFilteredResult: (result: ExecutionResult) => any
  executionId?: string
}
```

*   Defines an interface `StreamingResponseOptions` to encapsulate the options required to create the streaming response.
    *   `requestId`: A unique identifier for the request.
    *   `workflow`: An object containing information about the workflow to be executed, including its ID, user ID, workspace ID (optional), and deployment status (optional).
    *   `input`: The input data for the workflow execution.
    *   `executingUserId`: The ID of the user executing the workflow.
    *   `streamConfig`: The `StreamingConfig` object defined above.
    *   `createFilteredResult`: A function that takes an `ExecutionResult` and returns a filtered version of the result. This allows you to customize the data sent to the client.
    *   `executionId`: An optional ID for the execution (likely for referencing an existing execution).

**5. `createStreamingResponse` Function:**

```typescript
export async function createStreamingResponse(
  options: StreamingResponseOptions
): Promise<ReadableStream> {
  // ... function body ...
}
```

*   Defines the `createStreamingResponse` function, which is an asynchronous function that takes a `StreamingResponseOptions` object as input and returns a `Promise` that resolves to a `ReadableStream`. This is the main function of this file.

**6. Destructuring Options:**

```typescript
  const {
    requestId,
    workflow,
    input,
    executingUserId,
    streamConfig,
    createFilteredResult,
    executionId,
  } = options
```

*   Destructures the `options` object into its individual properties for easier access.

**7. Dynamic Import of Workflow Execution Logic:**

```typescript
  const { executeWorkflow, createFilteredResult: defaultFilteredResult } = await import(
    '@/app/api/workflows/[id]/execute/route'
  )
  const filterResultFn = createFilteredResult || defaultFilteredResult
```

*   Dynamically imports the `executeWorkflow` function and `defaultFilteredResult` from the specified module. Dynamic imports are used to load modules on demand, which can improve performance.
*   Assigns `createFilteredResult` to `filterResultFn` or `defaultFilteredResult` if `createFilteredResult` is not provided, providing a fallback mechanism.

**8. Creating the `ReadableStream`:**

```typescript
  return new ReadableStream({
    async start(controller) {
      // ... stream logic ...
    },
  })
```

*   Creates a new `ReadableStream`. The `ReadableStream` constructor takes an object with a `start` method.
*   The `start` method is an asynchronous function that will be called when the stream is created. It receives a `controller` object, which is used to manage the stream.

**9. Initializing Stream Variables:**

```typescript
      try {
        const streamedContent = new Map<string, string>()
        const processedOutputs = new Set<string>()
        const streamCompletionTimes = new Map<string, number>()
```

*   Initializes three data structures within the `start` method's `try` block:
    *   `streamedContent`: A `Map` to store the streamed content for each block, keyed by the block ID.
    *   `processedOutputs`: A `Set` to keep track of the block IDs that have already been processed and sent to the client. This prevents duplicate sends.
    *   `streamCompletionTimes`: A `Map` to record the completion timestamps of each stream.

**10. `sendChunk` Function:**

```typescript
        const sendChunk = (blockId: string, content: string) => {
          const separator = processedOutputs.size > 0 ? '\n\n' : ''
          controller.enqueue(encodeSSE({ blockId, chunk: separator + content }))
          processedOutputs.add(blockId)
        }
```

*   Defines a function `sendChunk` to encapsulate the logic for sending data chunks to the client via SSE.
    *   It takes the block ID and the content to be sent as input.
    *   It adds a separator (`\n\n`) between chunks if there are already processed outputs.
    *   It encodes the data into SSE format using the `encodeSSE` function.
    *   It enqueues the encoded data into the stream using `controller.enqueue`.
    *   It adds the block ID to the `processedOutputs` set to indicate that this block has been processed.

**11. `onStreamCallback` Function:**

```typescript
        const onStreamCallback = async (streamingExec: {
          stream: ReadableStream
          execution?: { blockId?: string }
        }) => {
          const blockId = streamingExec.execution?.blockId || 'unknown'
          const reader = streamingExec.stream.getReader()
          const decoder = new TextDecoder()
          let isFirstChunk = true

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) {
                // Record when this stream completed
                streamCompletionTimes.set(blockId, Date.now())
                break
              }

              const textChunk = decoder.decode(value, { stream: true })
              streamedContent.set(blockId, (streamedContent.get(blockId) || '') + textChunk)

              if (isFirstChunk) {
                sendChunk(blockId, textChunk)
                isFirstChunk = false
              } else {
                controller.enqueue(encodeSSE({ blockId, chunk: textChunk }))
              }
            }
          } catch (streamError) {
            logger.error(`[${requestId}] Error reading agent stream:`, streamError)
            controller.enqueue(
              encodeSSE({
                event: 'stream_error',
                blockId,
                error: streamError instanceof Error ? streamError.message : 'Stream reading error',
              })
            )
          }
        }
```

*   Defines an asynchronous function `onStreamCallback` to handle streams from individual blocks.
    *   It receives a `streamingExec` object, containing the block's `ReadableStream` and optional execution details.
    *   It extracts the block ID from the `streamingExec` object, defaulting to 'unknown' if not provided.
    *   It gets a reader from the `ReadableStream` to read the data.
    *   It creates a `TextDecoder` to decode the stream data into text.
    *   It uses a `while` loop to read the stream until it is done.
    *   Inside the loop:
        *   It reads a chunk of data from the stream using `reader.read()`.
        *   If `done` is true, it means the stream has ended, sets the completion time, and breaks out of the loop.
        *   It decodes the data chunk into text using `decoder.decode()`.
        *   It appends the text chunk to the `streamedContent` map for the corresponding block ID.
        *   If it's the first chunk, it calls `sendChunk` to send the chunk to the client.
        *   For subsequent chunks, it directly enqueues the encoded chunk to the controller.
    *   If an error occurs during stream reading, it logs the error and sends an SSE event with an error message to the client.

**12. `onBlockCompleteCallback` Function:**

```typescript
        const onBlockCompleteCallback = async (blockId: string, output: any) => {
          if (!streamConfig.selectedOutputs?.length) return

          const { extractBlockIdFromOutputId, extractPathFromOutputId, traverseObjectPath } =
            await import('@/lib/response-format')

          const matchingOutputs = streamConfig.selectedOutputs.filter(
            (outputId) => extractBlockIdFromOutputId(outputId) === blockId
          )

          if (!matchingOutputs.length) return

          for (const outputId of matchingOutputs) {
            const path = extractPathFromOutputId(outputId, blockId)

            let outputValue = traverseObjectPath(output, path)
            if (outputValue === undefined && output.response) {
              outputValue = traverseObjectPath(output.response, path)
            }

            if (outputValue !== undefined) {
              const formattedOutput =
                typeof outputValue === 'string' ? outputValue : JSON.stringify(outputValue, null, 2)
              sendChunk(blockId, formattedOutput)
            }
          }
        }
```

*   Defines an asynchronous function `onBlockCompleteCallback` to handle the completion of a block's execution.  This is particularly important for selected outputs that may not be streamed.
    *   It receives the block ID and the output data as input.
    *   If `streamConfig.selectedOutputs` is not defined or empty, it returns early, skipping the processing.
    *   It dynamically imports functions from `@/lib/response-format` for extracting the block ID and path from the output ID, and for traversing object paths.
    *   It filters the `streamConfig.selectedOutputs` array to find the output IDs that match the current block ID.
    *   If no matching output IDs are found, it returns early.
    *   It iterates through the matching output IDs.
        *   For each output ID, it extracts the path.
        *   It uses `traverseObjectPath` to retrieve the value at the specified path in the output data. It also attempts to traverse `output.response` if the initial traversal returns `undefined`.
        *   If the value is not undefined, it formats it as a string (either directly or by stringifying it using `JSON.stringify`) and sends it as a chunk using `sendChunk`.

**13. Executing the Workflow:**

```typescript
        const result = await executeWorkflow(
          workflow,
          requestId,
          input,
          executingUserId,
          {
            enabled: true,
            selectedOutputs: streamConfig.selectedOutputs,
            isSecureMode: streamConfig.isSecureMode,
            workflowTriggerType: streamConfig.workflowTriggerType,
            onStream: onStreamCallback,
            onBlockComplete: onBlockCompleteCallback,
            skipLoggingComplete: true, // We'll complete logging after tokenization
          },
          executionId
        )
```

*   Calls the `executeWorkflow` function with the provided parameters.  This is where the actual workflow execution happens.
*   The `executeWorkflow` function receives:
    *   The `workflow` object.
    *   The `requestId`.
    *   The `input` data.
    *   The `executingUserId`.
    *   An options object that configures the workflow execution, including:
        *   `enabled`: Whether streaming is enabled.
        *   `selectedOutputs`: The array of selected output IDs.
        *   `isSecureMode`: Whether secure mode is enabled.
        *   `workflowTriggerType`: The type of workflow trigger.
        *   `onStream`: The `onStreamCallback` function.
        *   `onBlockComplete`: The `onBlockCompleteCallback` function.
        *   `skipLoggingComplete`: A flag to indicate that logging completion should be skipped (handled later in the function).
    *   The `executionId` (optional).
*   The `await` keyword ensures that the workflow execution completes before proceeding.

**14. Updating Logs with Streamed Content:**

```typescript
        if (result.logs && streamedContent.size > 0) {
          result.logs = result.logs.map((log: any) => {
            if (streamedContent.has(log.blockId)) {
              const content = streamedContent.get(log.blockId)

              // Update timing to reflect actual stream completion
              if (streamCompletionTimes.has(log.blockId)) {
                const completionTime = streamCompletionTimes.get(log.blockId)!
                const startTime = new Date(log.startedAt).getTime()
                log.endedAt = new Date(completionTime).toISOString()
                log.durationMs = completionTime - startTime
              }

              if (log.output && content) {
                return { ...log, output: { ...log.output, content } }
              }
            }
            return log
          })

          const { processStreamingBlockLogs } = await import('@/lib/tokenization')
          processStreamingBlockLogs(result.logs, streamedContent)
        }
```

*   This section post-processes the logs after the workflow execution, specifically for cases where streaming occurred.
    *   It checks if `result.logs` exists and if there's streamed content.
    *   It maps over the `result.logs` array.
        *   If a log entry corresponds to a block ID for which there's streamed content:
            *   It retrieves the streamed content from `streamedContent`.
            *   It updates the log entry's `output` property with the streamed content.
			*   It updates the log entry's `endedAt` and `durationMs` to reflect the actual stream completion time, if available in `streamCompletionTimes`.
    *   It dynamically imports and calls the `processStreamingBlockLogs` function from `@/lib/tokenization` to further process the logs and apply tokenization if necessary.

**15. Completing the Logging Session:**

```typescript
        // Complete the logging session with updated trace spans that include cost data
        if (result._streamingMetadata?.loggingSession) {
          const { buildTraceSpans } = await import('@/lib/logs/execution/trace-spans/trace-spans')
          const { traceSpans, totalDuration } = buildTraceSpans(result)

          await result._streamingMetadata.loggingSession.safeComplete({
            endedAt: new Date().toISOString(),
            totalDurationMs: totalDuration || 0,
            finalOutput: result.output || {},
            traceSpans: (traceSpans || []) as any,
            workflowInput: result._streamingMetadata.processedInput,
          })

          result._streamingMetadata = undefined
        }
```

*   This section handles the completion of a logging session associated with the workflow execution, especially for capturing cost data and trace spans.
    *   It checks if `result._streamingMetadata?.loggingSession` exists. This implies that a logging session was started before or during the `executeWorkflow` call.
    *   It dynamically imports `buildTraceSpans` from `@/lib/logs/execution/trace-spans/trace-spans` to construct trace spans based on the workflow result.
    *   It calls `buildTraceSpans` to generate trace spans and calculate the total duration of the workflow execution.
    *   It calls `safeComplete` on the `loggingSession` object, providing the following information:
        *   `endedAt`: The timestamp when the workflow execution completed.
        *   `totalDurationMs`: The total duration of the workflow execution in milliseconds.
        *   `finalOutput`: The final output of the workflow.
        *   `traceSpans`: The generated trace spans.
        *   `workflowInput`: The processed input of the workflow
    *   It sets `result._streamingMetadata` to `undefined` to release the metadata and prevent memory leaks.

**16. Creating a Minimal Result:**

```typescript
        // Create a minimal result with only selected outputs
        const minimalResult = {
          success: result.success,
          error: result.error,
          output: {} as any,
        }
```

*   Creates a minimal result object containing only the `success`, `error`, and a potentially filtered `output`.

**17. Filtering Outputs based on `selectedOutputs`:**

```typescript
        if (streamConfig.selectedOutputs?.length && result.output) {
          const { extractBlockIdFromOutputId, extractPathFromOutputId, traverseObjectPath } =
            await import('@/lib/response-format')

          for (const outputId of streamConfig.selectedOutputs) {
            const blockId = extractBlockIdFromOutputId(outputId)
            const path = extractPathFromOutputId(outputId, blockId)

            if (result.logs) {
              const blockLog = result.logs.find((log: any) => log.blockId === blockId)
              if (blockLog?.output) {
                let value = traverseObjectPath(blockLog.output, path)
                if (value === undefined && blockLog.output.response) {
                  value = traverseObjectPath(blockLog.output.response, path)
                }
                if (value !== undefined) {
                  const dangerousKeys = ['__proto__', 'constructor', 'prototype']
                  if (dangerousKeys.includes(blockId) || dangerousKeys.includes(path)) {
                    logger.warn(
                      `[${requestId}] Blocked potentially dangerous property assignment`,
                      {
                        blockId,
                        path,
                      }
                    )
                    continue
                  }

                  if (!minimalResult.output[blockId]) {
                    minimalResult.output[blockId] = Object.create(null)
                  }
                  minimalResult.output[blockId][path] = value
                }
              }
            }
          }
        } else if (!streamConfig.selectedOutputs?.length) {
          minimalResult.output = result.output
        }
```

*   This section filters the workflow output based on the `selectedOutputs` configuration.
    *   If `streamConfig.selectedOutputs` is defined, not empty, and the `result` has output:
        *   It dynamically imports functions from `@/lib/response-format` to extract the block ID and path from the output ID and to traverse object paths.
        *   It iterates through the `streamConfig.selectedOutputs` array.
            *   For each output ID, it extracts the block ID and the path.
            *   It finds the corresponding block log in the `result.logs` array.
            *   If a block log exists and has output:
                *   It uses `traverseObjectPath` to retrieve the value at the specified path in the block log's output.  It also checks the `response` property if the first traversal returns `undefined`.
                *   If the value is not undefined, it assigns it to the corresponding path in the `minimalResult.output` object.
                *   It includes a security check to prevent potentially dangerous property assignments to `__proto__`, `constructor`, or `prototype`.
    *   If `streamConfig.selectedOutputs` is empty, it copies the entire `result.output` to `minimalResult.output`.

**18. Sending the Final Result and Closing the Stream:**

```typescript
        controller.enqueue(encodeSSE({ event: 'final', data: minimalResult }))
        controller.enqueue(encodeSSE('[DONE]'))
        controller.close()
```

*   Sends the final result to the client as an SSE event with the event type "final" and the `minimalResult` data.
*   Sends a special SSE message "[DONE]" to indicate the end of the stream.
*   Closes the stream using `controller.close()`.

**19. Error Handling:**

```typescript
      } catch (error: any) {
        logger.error(`[${requestId}] Stream error:`, error)
        controller.enqueue(
          encodeSSE({ event: 'error', error: error.message || 'Stream processing error' })
        )
        controller.close()
      }
```

*   Catches any errors that occur during stream processing.
*   Logs the error using the `logger`.
*   Sends an SSE event with the event type "error" and an error message to the client.
*   Closes the stream using `controller.close()`.
