```typescript
/**
 * @fileOverview This file serves as a central export point for all modules related to tokenization within the application.
 *               It aggregates functions, constants, types, and error classes from different sub-modules within the
 *               `@/lib/tokenization` directory, providing a single, convenient entry point for accessing tokenization-related
 *               functionality throughout the codebase.  This promotes code reusability, improves organization, and simplifies imports.
 */

export {
  calculateStreamingCost,
  calculateTokenizationCost,
  createCostResultFromProviderData,
} from '@/lib/tokenization/calculators'

/**
 * Exports functions related to cost calculation.
 * `calculateStreamingCost`: Calculates the cost of streaming data based on token usage.
 * `calculateTokenizationCost`: Calculates the overall cost of tokenizing input.
 * `createCostResultFromProviderData`: Creates a cost result object using data from a provider.
 * These functions likely use token counts and pricing information specific to different LLM providers to determine the monetary cost associated with using their models.
 */

export { LLM_BLOCK_TYPES, TOKENIZATION_CONFIG } from '@/lib/tokenization/constants'

/**
 * Exports constants related to tokenization.
 * `LLM_BLOCK_TYPES`:  Likely defines the different types of blocks (e.g., text, code, image descriptions) that can be processed by the LLM. This enumeration might be used to conditionally apply specific tokenization rules or strategies based on the content type.
 * `TOKENIZATION_CONFIG`:  A configuration object containing settings and data relevant to tokenization.  This could include default token limits, provider-specific configurations (like tokens-per-dollar), and other global settings that affect how text is tokenized and costed.
 */

export { createTokenizationError, TokenizationError } from '@/lib/tokenization/errors'

/**
 * Exports error-related classes and functions.
 * `createTokenizationError`: A factory function to create `TokenizationError` instances.
 * `TokenizationError`: A custom error class specifically for handling errors that occur during the tokenization process.  This allows for more specific error handling and debugging related to tokenization.
 */

export {
  batchByTokenLimit,
  clearEncodingCache,
  estimateInputTokens,
  estimateOutputTokens,
  estimateTokenCount,
  getAccurateTokenCount,
  getTokenCountsForBatch,
  getTotalTokenCount,
  truncateToTokenLimit,
} from '@/lib/tokenization/estimators'

/**
 * Exports functions for estimating and accurately counting tokens.
 * `batchByTokenLimit`:  Splits a large input into smaller batches, ensuring that each batch's token count does not exceed a specified limit. This is important for avoiding errors when processing large texts with models that have input limits.
 * `clearEncodingCache`: Clears any cached tokenization encodings. This is helpful for ensuring that token counts are accurate after the tokenization configuration has changed, or for freeing up memory.
 * `estimateInputTokens`: Estimates the number of tokens in the input text.  This might use a faster, less accurate method for quick estimations.
 * `estimateOutputTokens`: Estimates the number of tokens that will be generated as output from the LLM.
 * `estimateTokenCount`: A general function that estimates the token count for a given text, possibly dispatching to different estimation functions based on context.
 * `getAccurateTokenCount`:  Calculates the token count using a more precise (and potentially slower) method. This is used when an accurate token count is crucial, such as for billing purposes.
 * `getTokenCountsForBatch`: Calculates the token counts for each item within a batch of text inputs.
 * `getTotalTokenCount`: Calculates the total token count for a collection of text inputs.
 * `truncateToTokenLimit`: Truncates the input text to fit within a specified token limit.  This is a common technique to prevent exceeding the maximum input length of an LLM.
 */

export { processStreamingBlockLog, processStreamingBlockLogs } from '@/lib/tokenization/streaming'

/**
 * Exports functions for processing streaming data and logs related to tokenization.
 * `processStreamingBlockLog`: Processes a single log entry for a streaming block of text. This could involve updating token counts, calculating costs, or other analysis.
 * `processStreamingBlockLogs`: Processes a collection of streaming block log entries, performing aggregated analysis or calculations.
 */

export type {
  CostBreakdown,
  ProviderTokenizationConfig,
  StreamingCostResult,
  TokenEstimate,
  TokenizationInput,
  TokenUsage,
} from '@/lib/tokenization/types'

/**
 * Exports TypeScript types related to tokenization.
 * `CostBreakdown`:  Defines the structure of an object that breaks down the cost of tokenization (e.g., input cost, output cost).
 * `ProviderTokenizationConfig`:  Defines the configuration settings specific to a particular LLM provider (e.g., model name, input price per token, output price per token).
 * `StreamingCostResult`: Defines the structure of an object containing the cost results for a streaming operation.
 * `TokenEstimate`:  Defines the structure of an estimated token count, potentially including confidence intervals or error margins.
 * `TokenizationInput`: Defines the structure of the input data for the tokenization process.  This might include the text to be tokenized, the LLM provider to use, and other relevant parameters.
 * `TokenUsage`: Defines the structure of an object representing token usage, including input tokens, output tokens, and potentially other related metrics.
 */

export {
  createTextPreview,
  extractTextContent,
  formatTokenCount,
  getProviderConfig,
  getProviderForTokenization,
  hasRealCostData,
  hasRealTokenData,
  isTokenizableBlockType,
  logTokenizationDetails,
  validateTokenizationInput,
} from '@/lib/tokenization/utils'

/**
 * Exports utility functions related to tokenization.
 * `createTextPreview`: Creates a shortened preview of the input text, useful for displaying summaries or previews in the UI.
 * `extractTextContent`: Extracts the relevant text content from a complex input structure (e.g., a document or a code file). This ensures that only the text that needs to be tokenized is processed.
 * `formatTokenCount`: Formats a token count for display purposes (e.g., adding commas, rounding, or adding units).
 * `getProviderConfig`: Retrieves the tokenization configuration for a specific LLM provider.
 * `getProviderForTokenization`: Determines the appropriate LLM provider to use for tokenization based on the input data and configuration.
 * `hasRealCostData`:  Checks if the cost data is valid and represents a real, non-zero cost.  This is used to avoid displaying or processing invalid cost information.
 * `hasRealTokenData`:  Checks if the token data is valid and represents a real, non-zero token count. Similar to `hasRealCostData`, this prevents the use of invalid token counts.
 * `isTokenizableBlockType`:  Determines whether a given block type is tokenizable.  This uses the `LLM_BLOCK_TYPES` constant to determine if a particular type of content should be processed for tokenization.
 * `logTokenizationDetails`: Logs detailed information about the tokenization process, including token counts, costs, and other relevant data.  This is useful for debugging and monitoring the tokenization process.
 * `validateTokenizationInput`: Validates the input data for the tokenization process, ensuring that it meets the required criteria.  This helps prevent errors and ensures that the tokenization process runs smoothly.
 */
```