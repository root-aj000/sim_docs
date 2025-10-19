```typescript
/**
 * Streaming-specific tokenization helpers
 */

import { createLogger } from '@/lib/logs/console/logger'
import { calculateStreamingCost } from '@/lib/tokenization/calculators'
import { TOKENIZATION_CONFIG } from '@/lib/tokenization/constants'
import {
  extractTextContent,
  hasRealCostData,
  hasRealTokenData,
  isTokenizableBlockType,
  logTokenizationDetails,
} from '@/lib/tokenization/utils'
import type { BlockLog } from '@/executor/types'

const logger = createLogger('StreamingTokenization')

/**
 * Processes a block log and adds tokenization data if needed
 */
export function processStreamingBlockLog(log: BlockLog, streamedContent: string): boolean {
  // Check if this block should be tokenized
  if (!isTokenizableBlockType(log.blockType)) {
    return false
  }

  // Check if we already have meaningful token/cost data
  if (hasRealTokenData(log.output?.tokens) && hasRealCostData(log.output?.cost)) {
    return false
  }

  // Check if we have content to tokenize
  if (!streamedContent?.trim()) {
    return false
  }

  try {
    // Determine model to use
    const model = getModelForBlock(log)

    // Prepare input text from log
    const inputText = extractTextContent(log.input)

    // Calculate streaming cost
    const result = calculateStreamingCost(
      model,
      inputText,
      streamedContent,
      log.input?.systemPrompt,
      log.input?.context,
      log.input?.messages
    )

    // Update the log output with tokenization data
    if (!log.output) {
      log.output = {}
    }

    log.output.tokens = result.tokens
    log.output.cost = result.cost
    log.output.model = result.model

    logTokenizationDetails(`Streaming tokenization completed for ${log.blockType}`, {
      blockId: log.blockId,
      blockType: log.blockType,
      model: result.model,
      provider: result.provider,
      inputLength: inputText.length,
      outputLength: streamedContent.length,
      tokens: result.tokens,
      cost: result.cost,
      method: result.method,
    })

    return true
  } catch (error) {
    logger.error(`Streaming tokenization failed for block ${log.blockId}`, {
      blockType: log.blockType,
      error: error instanceof Error ? error.message : String(error),
      contentLength: streamedContent?.length || 0,
    })

    // Don't throw - graceful degradation
    return false
  }
}

/**
 * Determines the appropriate model for a block
 */
function getModelForBlock(log: BlockLog): string {
  // Try to get model from output first
  if (log.output?.model?.trim()) {
    return log.output.model
  }

  // Try to get model from input
  if (log.input?.model?.trim()) {
    return log.input.model
  }

  // Use block type specific defaults
  const blockType = log.blockType
  if (blockType === 'agent' || blockType === 'router' || blockType === 'evaluator') {
    return TOKENIZATION_CONFIG.defaults.model
  }

  // Final fallback
  return TOKENIZATION_CONFIG.defaults.model
}

/**
 * Processes multiple block logs for streaming tokenization
 */
export function processStreamingBlockLogs(
  logs: BlockLog[],
  streamedContentMap: Map<string, string>
): number {
  let processedCount = 0

  for (const log of logs) {
    const content = streamedContentMap.get(log.blockId)
    if (content && processStreamingBlockLog(log, content)) {
      processedCount++
    }
  }

  logger.info(`Streaming tokenization summary`, {
    totalLogs: logs.length,
    processedBlocks: processedCount,
    streamedBlocks: streamedContentMap.size,
  })

  return processedCount
}
```

### Purpose of this file

This TypeScript file provides helper functions for tokenizing streaming content within a larger application. It focuses on processing block logs, determining the cost of generating streamed content, and associating that cost with the corresponding log entries. The main goal is to accurately track token usage and associated costs for streaming outputs, enabling better resource management and cost analysis. The tokenization is done on a block-by-block basis during streaming.

### Explanation of each line of code

**Imports:**

*   `import { createLogger } from '@/lib/logs/console/logger'`: Imports a function to create a logger instance, enabling logging of events and errors within this module.  The logger is likely configured to output to the console or another logging destination.
*   `import { calculateStreamingCost } from '@/lib/tokenization/calculators'`: Imports a function that calculates the token count and cost for streamed content, considering factors like the model used, input text, and any system prompts or context.
*   `import { TOKENIZATION_CONFIG } from '@/lib/tokenization/constants'`: Imports a configuration object that likely holds default values and settings related to tokenization, such as the default model to use.
*   `import { extractTextContent, hasRealCostData, hasRealTokenData, isTokenizableBlockType, logTokenizationDetails } from '@/lib/tokenization/utils'`: Imports utility functions:
    *   `extractTextContent`: Extracts relevant text content from a log input.
    *   `hasRealCostData`: Checks if a log already contains meaningful cost data.
    *   `hasRealTokenData`: Checks if a log already contains meaningful token data.
    *   `isTokenizableBlockType`: Determines if a given block type should be tokenized.
    *   `logTokenizationDetails`: Logs detailed information about the tokenization process.
*   `import type { BlockLog } from '@/executor/types'`: Imports the `BlockLog` type definition, representing a log entry for a processing block. This helps ensure type safety when working with block logs.

**Logger Initialization:**

*   `const logger = createLogger('StreamingTokenization')`: Creates a logger instance specifically for this module, tagged as 'StreamingTokenization'. This allows for easy filtering and identification of logs originating from this file.

**`processStreamingBlockLog` function:**

This function is the core of the module, responsible for processing a single block log and adding tokenization data if necessary.

*   `export function processStreamingBlockLog(log: BlockLog, streamedContent: string): boolean {`: Defines the function, accepting a `BlockLog` object and the `streamedContent` (the text generated during streaming) as input. It returns a boolean indicating whether tokenization was successful.
*   `if (!isTokenizableBlockType(log.blockType)) { return false }`:  Checks if the `blockType` associated with the log should be tokenized.  If not (e.g., it's a block type that doesn't generate text output), the function returns `false` immediately.  This avoids unnecessary processing.
*   `if (hasRealTokenData(log.output?.tokens) && hasRealCostData(log.output?.cost)) { return false }`:  Checks if the log already has valid token and cost data. If so, it assumes tokenization has already been done and returns `false`.  The optional chaining (`?.`) prevents errors if `log.output` is null or undefined. "Real" token/cost data likely means the values are not zero or default placeholders.
*   `if (!streamedContent?.trim()) { return false }`: Checks if the `streamedContent` is empty or only contains whitespace. If it's empty, there's nothing to tokenize, so the function returns `false`. The `.trim()` method removes leading/trailing whitespace.  The optional chaining protects against null/undefined `streamedContent`.
*   `try { ... } catch (error) { ... }`: A `try...catch` block handles potential errors during the tokenization process. This ensures that errors during tokenization for one block don't crash the entire application.
*   `const model = getModelForBlock(log)`: Calls `getModelForBlock` to determine the appropriate language model to use for tokenization, based on the block log's information.
*   `const inputText = extractTextContent(log.input)`: Extracts the relevant input text from the log's input data using the `extractTextContent` utility function.
*   `const result = calculateStreamingCost(model, inputText, streamedContent, log.input?.systemPrompt, log.input?.context, log.input?.messages)`: Calls the `calculateStreamingCost` function to perform the actual tokenization and cost calculation. It passes the determined model, input text, streamed content, and potentially system prompts, context, or messages from the input.
*   `if (!log.output) { log.output = {} }`: If the log doesn't have an output object yet, create one.
*   `log.output.tokens = result.tokens; log.output.cost = result.cost; log.output.model = result.model`: Updates the `log.output` object with the token count, cost, and model used for tokenization.
*   `logTokenizationDetails(...)`: Calls the `logTokenizationDetails` function to log detailed information about the completed tokenization process. This is useful for debugging and monitoring.
*   `return true`: Returns `true` to indicate that the tokenization process was successful.
*   `catch (error) { ... }`: Catches any errors that occur during the `try` block.
*   `logger.error(...)`: Logs the error, including the block ID, block type, and error message.
*   `return false`: Returns `false` to indicate that the tokenization process failed.  Critically, the error is caught and handled, and the process continues; this is graceful degradation.

**`getModelForBlock` function:**

This function determines which language model to use for tokenizing a specific block.

*   `function getModelForBlock(log: BlockLog): string {`: Defines the function, accepting a `BlockLog` object as input and returning the name of the language model to use (a string).
*   `if (log.output?.model?.trim()) { return log.output.model }`: Checks if a model is already specified in the `log.output`. If so, it uses that model. This allows for overriding the default model on a per-block basis. The `.trim()` call handles cases where the model string has leading or trailing whitespace.
*   `if (log.input?.model?.trim()) { return log.input.model }`: If no model is specified in the output, it checks the `log.input` for a model.
*   `const blockType = log.blockType; if (blockType === 'agent' || blockType === 'router' || blockType === 'evaluator') { return TOKENIZATION_CONFIG.defaults.model }`: If no model is specified in the input or output, it checks the `blockType`. If the block type is 'agent', 'router', or 'evaluator', it uses the default model from the `TOKENIZATION_CONFIG`. This provides block-type-specific defaults.
*   `return TOKENIZATION_CONFIG.defaults.model`: If no model is specified in the input, output, or block type, it uses the default model from the `TOKENIZATION_CONFIG`. This is a final fallback to ensure that a model is always selected.

**`processStreamingBlockLogs` function:**

This function processes multiple block logs.

*   `export function processStreamingBlockLogs(logs: BlockLog[], streamedContentMap: Map<string, string>): number {`: Defines the function, accepting an array of `BlockLog` objects and a `Map` that maps block IDs to their corresponding streamed content. It returns the number of logs that were successfully processed.
*   `let processedCount = 0`: Initializes a counter to track the number of successfully processed logs.
*   `for (const log of logs) { ... }`: Iterates over each log in the `logs` array.
*   `const content = streamedContentMap.get(log.blockId); if (content && processStreamingBlockLog(log, content)) { processedCount++ }`: Retrieves the streamed content for the current log's `blockId` from the `streamedContentMap`. If content exists and `processStreamingBlockLog` returns `true` (indicating successful processing), it increments the `processedCount`.
*   `logger.info(...)`: Logs a summary of the tokenization process, including the total number of logs, the number of processed blocks, and the number of streamed blocks (the size of the `streamedContentMap`).
*   `return processedCount`: Returns the number of logs that were successfully processed.

**Simplification and Key Concepts:**

*   **Tokenization Pipeline:** This code represents a crucial step in a tokenization pipeline for streaming content. It fetches data, determines the model to use, calculates costs, and stores results, offering a clear flow.
*   **Error Handling:** The `try...catch` block provides robust error handling, preventing failures in one block from cascading and halting the entire process.
*   **Configuration-Driven:** The use of `TOKENIZATION_CONFIG` allows for easy customization of default settings and models, enhancing flexibility.
*   **Modularity:** The code is well-modularized, with specific functions handling distinct tasks (e.g., `getModelForBlock`, `calculateStreamingCost`), promoting maintainability and reusability.
*   **Efficiency:** The initial checks (`isTokenizableBlockType`, `hasRealTokenData`, `streamedContent?.trim()`) avoid unnecessary processing, optimizing performance.
*   **Streaming Context:** The code specifically addresses the nuances of streaming tokenization, where content is generated incrementally.

In summary, this file provides a well-structured and robust solution for tokenizing streaming content, handling errors gracefully, and logging details for analysis and debugging.  It is designed to be integrated into a larger system that manages block logs and streaming outputs.
