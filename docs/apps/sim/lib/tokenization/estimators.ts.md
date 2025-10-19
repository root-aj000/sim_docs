Okay, let's break down this TypeScript file piece by piece.

**Purpose of this file:**

The primary purpose of this file is to provide accurate and estimated token counting and management functionalities, which are crucial for interacting with Large Language Models (LLMs) like those offered by OpenAI, Anthropic, and Google.  These models often have limits on the number of tokens that can be processed in a single request, and exceeding these limits can lead to errors or increased costs.  This file provides tools for:

1.  **Accurate Token Counting:**  Using the `tiktoken` library (provided by OpenAI) for precise token counts that match what OpenAI's API will use.
2.  **Token Estimation:** Providing fast, heuristic-based token estimations for different providers (OpenAI, Anthropic, Google, and a generic fallback).  This is useful when a quick estimate is sufficient and the overhead of accurate counting isn't desired.
3.  **Text Truncation:**  Safely truncating text to fit within specified token limits.
4.  **Batching:**  Splitting a large array of texts into smaller batches, ensuring each batch stays within a token limit.
5.  **Caching:**  Caching the `tiktoken` encodings to avoid repeatedly loading them, improving performance.

**Overall Structure:**

The file is organized into several functions, each responsible for a specific task related to token management. It uses a combination of accurate counting (using `tiktoken`) and estimation (using provider-specific heuristics) to provide flexibility and performance.  It also includes utility functions for batching and truncation to help manage text within token limits.

**Line-by-line explanation:**

```typescript
/**
 * Token estimation and accurate counting functions for different providers
 */
```

*   This is a JSDoc comment that describes the file's overall purpose.

```typescript
import { encodingForModel, type Tiktoken } from 'js-tiktoken'
import { createLogger } from '@/lib/logs/console/logger'
import { MIN_TEXT_LENGTH_FOR_ESTIMATION, TOKENIZATION_CONFIG } from '@/lib/tokenization/constants'
import type { TokenEstimate } from '@/lib/tokenization/types'
import { getProviderConfig } from '@/lib/tokenization/utils'
```

*   These lines import necessary modules and types:
    *   `js-tiktoken`:  The core library for accurate token counting, especially for OpenAI models.  `encodingForModel` retrieves the appropriate encoding for a given model, and `Tiktoken` is a type representing the encoding object.
    *   `@/lib/logs/console/logger`:  A custom logger for logging messages (warnings, errors, info) within the application.  The `@/` alias likely refers to the project's root directory.
    *   `@/lib/tokenization/constants`:  Constants related to tokenization, such as `MIN_TEXT_LENGTH_FOR_ESTIMATION` (the minimum text length required before attempting estimation) and possibly default provider settings.
    *   `@/lib/tokenization/types`:  Type definitions, including `TokenEstimate`, which likely describes the structure of the token estimation results (count, confidence, provider, method).
    *   `@/lib/tokenization/utils`:  Utility functions for tokenization, such as `getProviderConfig`, which retrieves the configuration for a specific provider (e.g., OpenAI, Anthropic).

```typescript
const logger = createLogger('TokenizationEstimators')
```

*   Creates an instance of the logger, specifically for this module, using the name 'TokenizationEstimators'. This helps in identifying the source of log messages.

```typescript
const encodingCache = new Map<string, Tiktoken>()
```

*   Declares a `Map` called `encodingCache`.  This map stores `Tiktoken` encoding instances, keyed by the model name (string).  This is a caching mechanism to improve performance by avoiding redundant encoding creation.

```typescript
/**
 * Get or create a cached encoding for a model
 */
function getEncoding(modelName: string): Tiktoken {
  if (encodingCache.has(modelName)) {
    return encodingCache.get(modelName)!
  }

  try {
    const encoding = encodingForModel(modelName as Parameters<typeof encodingForModel>[0])
    encodingCache.set(modelName, encoding)
    return encoding
  } catch (error) {
    logger.warn(`Failed to get encoding for model ${modelName}, falling back to cl100k_base`)
    const encoding = encodingForModel('gpt-4')
    encodingCache.set(modelName, encoding)
    return encoding
  }
}
```

*   `getEncoding(modelName: string): Tiktoken`:  This function retrieves a `Tiktoken` encoding for a given `modelName`.  It first checks the `encodingCache`. If the encoding is already cached, it returns it. Otherwise, it attempts to create a new encoding using `encodingForModel` from the `js-tiktoken` library.

    *   `encodingCache.has(modelName)`: Checks if the encoding for `modelName` exists in the cache.
    *   `encodingCache.get(modelName)!`:  Retrieves the encoding from the cache. The `!` is a non-null assertion operator, telling TypeScript that the value will definitely be there (since we checked with `has` first).
    *   `encodingForModel(modelName as Parameters<typeof encodingForModel>[0])`: Creates a new `Tiktoken` encoding using the `encodingForModel` function. The type assertion `as Parameters<typeof encodingForModel>[0]` ensures that the `modelName` is of the correct type that `encodingForModel` accepts.
    *   `encodingCache.set(modelName, encoding)`: Stores the newly created encoding in the cache.
    *   `try...catch`: Handles potential errors during encoding creation. If an error occurs (e.g., the model name is invalid), it logs a warning and falls back to using the encoding for 'gpt-4' model.
    * The fallback to 'gpt-4' ensures that the application continues to function even if the specified model's encoding cannot be loaded.

```typescript
if (typeof process !== 'undefined') {
  process.on('beforeExit', () => {
    clearEncodingCache()
  })
}
```

*   This code block ensures that the `clearEncodingCache` function is called before the Node.js process exits. This is important for releasing resources and preventing memory leaks, especially if the `Tiktoken` encodings consume a significant amount of memory. This is only executed when the code is running in a Node.js environment (or an environment that emulates the `process` object).

```typescript
/**
 * Get accurate token count for text using tiktoken
 * This is the exact count OpenAI's API will use
 */
export function getAccurateTokenCount(text: string, modelName = 'text-embedding-3-small'): number {
  if (!text || text.length === 0) {
    return 0
  }

  try {
    const encoding = getEncoding(modelName)
    const tokens = encoding.encode(text)
    return tokens.length
  } catch (error) {
    logger.error('Error counting tokens with tiktoken:', error)
    return Math.ceil(text.length / 4)
  }
}
```

*   `getAccurateTokenCount(text: string, modelName = 'text-embedding-3-small'): number`:  This function accurately counts the number of tokens in a given `text` string using the `tiktoken` library. It defaults to the `text-embedding-3-small` model.

    *   `if (!text || text.length === 0)`: Handles the case where the input `text` is empty or null/undefined. Returns 0 in these cases.
    *   `const encoding = getEncoding(modelName)`: Retrieves the `Tiktoken` encoding for the specified `modelName` (using the caching mechanism).
    *   `const tokens = encoding.encode(text)`: Encodes the `text` into an array of token IDs using the retrieved encoding.  This is where the actual tokenization happens.
    *   `return tokens.length`: Returns the number of tokens in the encoded array.
    *   `try...catch`: Handles potential errors during token encoding. If an error occurs, it logs an error message and falls back to a simple character-based estimation (dividing the text length by 4 and rounding up). This fallback ensures the function still returns a value even if `tiktoken` fails.  The character-based estimation is a very rough approximation.

```typescript
/**
 * Truncate text to a maximum token count
 * Useful for handling texts that exceed model limits
 */
export function truncateToTokenLimit(
  text: string,
  maxTokens: number,
  modelName = 'text-embedding-3-small'
): string {
  if (!text || maxTokens <= 0) {
    return ''
  }

  try {
    const encoding = getEncoding(modelName)
    const tokens = encoding.encode(text)

    if (tokens.length <= maxTokens) {
      return text
    }

    const truncatedTokens = tokens.slice(0, maxTokens)
    const truncatedText = encoding.decode(truncatedTokens)

    logger.warn(
      `Truncated text from ${tokens.length} to ${maxTokens} tokens (${text.length} to ${truncatedText.length} chars)`
    )

    return truncatedText
  } catch (error) {
    logger.error('Error truncating text:', error)
    const maxChars = maxTokens * 4
    return text.slice(0, maxChars)
  }
}
```

*   `truncateToTokenLimit(text: string, maxTokens: number, modelName = 'text-embedding-3-small'): string`:  This function truncates a given `text` string to a maximum token count (`maxTokens`).

    *   `if (!text || maxTokens <= 0)`: Handles edge cases where the input text is empty or the maximum token count is invalid.  Returns an empty string in these cases.
    *   `const encoding = getEncoding(modelName)`: Retrieves the `Tiktoken` encoding.
    *   `const tokens = encoding.encode(text)`: Encodes the text into tokens.
    *   `if (tokens.length <= maxTokens)`: If the text is already within the token limit, it returns the original text.
    *   `const truncatedTokens = tokens.slice(0, maxTokens)`:  If the text exceeds the limit, it truncates the token array to the `maxTokens`.
    *   `const truncatedText = encoding.decode(truncatedTokens)`: Decodes the truncated token array back into a string. This ensures that the truncated text is a valid string and doesn't end in the middle of a token.
    *   `logger.warn(...)`: Logs a warning message indicating the truncation that occurred.
    *   `try...catch`: Handles potential errors during encoding or decoding.  If an error occurs, it falls back to truncating the text based on character count (multiplying `maxTokens` by 4 to get an approximate character limit). This fallback is less accurate but ensures the function still returns a truncated string.

```typescript
/**
 * Get token count for multiple texts (for batching decisions)
 * Returns array of token counts in same order as input
 */
export function getTokenCountsForBatch(
  texts: string[],
  modelName = 'text-embedding-3-small'
): number[] {
  return texts.map((text) => getAccurateTokenCount(text, modelName))
}
```

*   `getTokenCountsForBatch(texts: string[], modelName = 'text-embedding-3-small'): number[]`:  This function takes an array of text strings (`texts`) and returns an array of corresponding token counts, using `getAccurateTokenCount` for each text.  It uses the `map` function for concise implementation.

```typescript
/**
 * Calculate total tokens across multiple texts
 */
export function getTotalTokenCount(texts: string[], modelName = 'text-embedding-3-small'): number {
  return texts.reduce((total, text) => total + getAccurateTokenCount(text, modelName), 0)
}
```

*   `getTotalTokenCount(texts: string[], modelName = 'text-embedding-3-small'): number`:  This function calculates the total number of tokens across an array of text strings (`texts`).  It uses the `reduce` function to accumulate the token counts (obtained using `getAccurateTokenCount`) into a single total.

```typescript
/**
 * Batch texts by token count to stay within API limits
 * Returns array of batches where each batch's total tokens <= maxTokensPerBatch
 */
export function batchByTokenLimit(
  texts: string[],
  maxTokensPerBatch: number,
  modelName = 'text-embedding-3-small'
): string[][] {
  const batches: string[][] = []
  let currentBatch: string[] = []
  let currentTokenCount = 0

  for (const text of texts) {
    const tokenCount = getAccurateTokenCount(text, modelName)

    if (tokenCount > maxTokensPerBatch) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch)
        currentBatch = []
        currentTokenCount = 0
      }

      const truncated = truncateToTokenLimit(text, maxTokensPerBatch, modelName)
      batches.push([truncated])
      continue
    }

    if (currentBatch.length > 0 && currentTokenCount + tokenCount > maxTokensPerBatch) {
      batches.push(currentBatch)
      currentBatch = [text]
      currentTokenCount = tokenCount
    } else {
      currentBatch.push(text)
      currentTokenCount += tokenCount
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  return batches
}
```

*   `batchByTokenLimit(texts: string[], maxTokensPerBatch: number, modelName = 'text-embedding-3-small'): string[][]`:  This is a crucial function that batches an array of texts (`texts`) into smaller arrays (batches), ensuring that each batch's total token count does not exceed `maxTokensPerBatch`. This is essential for staying within API limits.

    *   `const batches: string[][] = []`:  Initializes an empty array to store the resulting batches.  Each batch will be an array of strings.
    *   `let currentBatch: string[] = []`: Initializes an empty array to hold the texts for the current batch being built.
    *   `let currentTokenCount = 0`: Initializes a variable to track the total token count of the current batch.
    *   `for (const text of texts)`:  Iterates through each text in the input array.
    *   `const tokenCount = getAccurateTokenCount(text, modelName)`: Gets the accurate token count for the current text.
    *   `if (tokenCount > maxTokensPerBatch)`:  Handles the case where a single text exceeds the `maxTokensPerBatch`.
        *   `if (currentBatch.length > 0)`: If there are any texts in the current batch, push it to the `batches` array, and reset the current batch.
        *   `const truncated = truncateToTokenLimit(text, maxTokensPerBatch, modelName)`: Truncates the text to fit within the limit.
        *   `batches.push([truncated])`: Pushes the truncated text as a single-element batch.
        *   `continue`: Proceeds to the next text in the input array.
    *   `if (currentBatch.length > 0 && currentTokenCount + tokenCount > maxTokensPerBatch)`:  Checks if adding the current text to the current batch would exceed the token limit.
        *   `batches.push(currentBatch)`: If it would exceed the limit, push the current batch to the `batches` array.
        *   `currentBatch = [text]`: Start a new batch with the current text.
        *   `currentTokenCount = tokenCount`: Reset the token count to the token count of the current text.
    *   `else`: If adding the text to the current batch would not exceed the limit.
        *   `currentBatch.push(text)`: Add the text to the current batch.
        *   `currentTokenCount += tokenCount`: Update the current token count.
    *   `if (currentBatch.length > 0)`: After processing all texts, if there are any remaining texts in the `currentBatch`, push it to the `batches` array.
    *   `return batches`: Returns the array of batches.

```typescript
/**
 * Clean up cached encodings (call when shutting down)
 */
export function clearEncodingCache(): void {
  encodingCache.clear()
  logger.info('Cleared tiktoken encoding cache')
}
```

*   `clearEncodingCache(): void`:  This function clears the `encodingCache`, releasing the cached `Tiktoken` encoding objects. It's important to call this function when the application shuts down to free up memory.

```typescript
/**
 * Estimates token count for text using provider-specific heuristics
 */
export function estimateTokenCount(text: string, providerId?: string): TokenEstimate {
  if (!text || text.length < MIN_TEXT_LENGTH_FOR_ESTIMATION) {
    return {
      count: 0,
      confidence: 'high',
      provider: providerId || 'unknown',
      method: 'fallback',
    }
  }

  const effectiveProviderId = providerId || TOKENIZATION_CONFIG.defaults.provider
  const config = getProviderConfig(effectiveProviderId)

  let estimatedTokens: number

  switch (effectiveProviderId) {
    case 'openai':
    case 'azure-openai':
      estimatedTokens = estimateOpenAITokens(text)
      break
    case 'anthropic':
      estimatedTokens = estimateAnthropicTokens(text)
      break
    case 'google':
      estimatedTokens = estimateGoogleTokens(text)
      break
    default:
      estimatedTokens = estimateGenericTokens(text, config.avgCharsPerToken)
  }

  return {
    count: Math.max(1, Math.round(estimatedTokens)),
    confidence: config.confidence,
    provider: effectiveProviderId,
    method: 'heuristic',
  }
}
```

*   `estimateTokenCount(text: string, providerId?: string): TokenEstimate`: This function estimates the token count for a given `text` string using provider-specific heuristics.  It takes an optional `providerId` to specify which provider's estimation method to use.  If `providerId` is not provided, it defaults to the value defined in `TOKENIZATION_CONFIG.defaults.provider`.

    *   `if (!text || text.length < MIN_TEXT_LENGTH_FOR_ESTIMATION)`: If the input `text` is empty or shorter than `MIN_TEXT_LENGTH_FOR_ESTIMATION`, it returns a default `TokenEstimate` with a count of 0 and high confidence, using 'unknown' as provider.
    *   `const effectiveProviderId = providerId || TOKENIZATION_CONFIG.defaults.provider`: Determines the provider ID to use, defaulting to the configured default provider if none is provided.
    *   `const config = getProviderConfig(effectiveProviderId)`: Retrieves the provider-specific configuration using `getProviderConfig`. This configuration likely includes parameters like the confidence level of the estimation.
    *   `switch (effectiveProviderId)`:  A `switch` statement determines which estimation method to use based on the `effectiveProviderId`.
        *   `case 'openai': case 'azure-openai'`: Uses `estimateOpenAITokens` for OpenAI and Azure OpenAI.
        *   `case 'anthropic'`: Uses `estimateAnthropicTokens` for Anthropic.
        *   `case 'google'`: Uses `estimateGoogleTokens` for Google.
        *   `default`: Uses `estimateGenericTokens` with the provider's average characters per token for other providers.
    *   `return { ... }`: Returns a `TokenEstimate` object containing the estimated token count, the confidence level from the provider configuration, the provider ID, and the method ('heuristic').
    *   `Math.max(1, Math.round(estimatedTokens))`: Ensures that the estimated token count is at least 1.

```typescript
/**
 * OpenAI-specific token estimation using BPE characteristics
 */
function estimateOpenAITokens(text: string): number {
  const words = text.trim().split(/\s+/)
  let tokenCount = 0

  for (const word of words) {
    if (word.length === 0) continue

    if (word.length <= 4) {
      tokenCount += 1
    } else if (word.length <= 8) {
      tokenCount += Math.ceil(word.length / 4.5)
    } else {
      tokenCount += Math.ceil(word.length / 4)
    }

    const punctuationCount = (word.match(/[.,!?;:"'()[\]{}<>]/g) || []).length
    tokenCount += punctuationCount * 0.5
  }

  const newlineCount = (text.match(/\n/g) || []).length
  tokenCount += newlineCount * 0.5

  return tokenCount
}
```

*   `estimateOpenAITokens(text: string): number`: This function estimates the token count for OpenAI models based on the length of words, punctuation, and newlines in the text.

    *   `const words = text.trim().split(/\s+/)`: Splits the text into an array of words, trimming leading/trailing whitespace and using one or more whitespace characters as the delimiter.
    *   `let tokenCount = 0`: Initializes a variable to store the estimated token count.
    *   `for (const word of words)`: Iterates through each word in the `words` array.
    *   `if (word.length === 0) continue`: Skips empty words.
    *   The `if/else if/else` block adjusts the token count based on word length, approximating how OpenAI's BPE tokenization works. Shorter words tend to be a single token, while longer words are broken into multiple tokens.
    *   `const punctuationCount = (word.match(/[.,!?;:"'()[\]{}<>]/g) || []).length`: Counts punctuation characters in each word.
    *   `tokenCount += punctuationCount * 0.5`: Adds 0.5 tokens for each punctuation mark.
    *   `const newlineCount = (text.match(/\n/g) || []).length`: Counts the number of newline characters in the text.
    *   `tokenCount += newlineCount * 0.5`: Adds 0.5 tokens for each newline.

```typescript
/**
 * Anthropic Claude-specific token estimation
 */
function estimateAnthropicTokens(text: string): number {
  const words = text.trim().split(/\s+/)
  let tokenCount = 0

  for (const word of words) {
    if (word.length === 0) continue

    if (word.length <= 4) {
      tokenCount += 1
    } else if (word.length <= 8) {
      tokenCount += Math.ceil(word.length / 5)
    } else {
      tokenCount += Math.ceil(word.length / 4.5)
    }
  }

  const newlineCount = (text.match(/\n/g) || []).length
  tokenCount += newlineCount * 0.3

  return tokenCount
}
```

*   `estimateAnthropicTokens(text: string): number`: This function estimates the token count for Anthropic's Claude model, using a similar approach to `estimateOpenAITokens` but with slightly different parameters for word length and newline handling.

```typescript
/**
 * Google Gemini-specific token estimation
 */
function estimateGoogleTokens(text: string): number {
  const words = text.trim().split(/\s+/)
  let tokenCount = 0

  for (const word of words) {
    if (word.length === 0) continue

    if (word.length <= 5) {
      tokenCount += 1
    } else if (word.length <= 10) {
      tokenCount += Math.ceil(word.length / 6)
    } else {
      tokenCount += Math.ceil(word.length / 5)
    }
  }

  return tokenCount
}
```

*   `estimateGoogleTokens(text: string): number`: This function estimates the token count for Google's Gemini model, using a similar approach to `estimateOpenAITokens` but with slightly different parameters for word length.

```typescript
/**
 * Generic token estimation fallback
 */
function estimateGenericTokens(text: string, avgCharsPerToken: number): number {
  const charCount = text.trim().length
  return Math.ceil(charCount / avgCharsPerToken)
}
```

*   `estimateGenericTokens(text: string, avgCharsPerToken: number): number`: This function provides a generic token estimation based on the average number of characters per token.

    *   `const charCount = text.trim().length`: Gets the number of characters in the text after trimming whitespace.
    *   `return Math.ceil(charCount / avgCharsPerToken)`: Divides the character count by the average characters per token and rounds up to the nearest integer.

```typescript
/**
 * Estimates tokens for input content including context
 */
export function estimateInputTokens(
  systemPrompt?: string,
  context?: string,
  messages?: Array<{ role: string; content: string }>,
  providerId?: string
): TokenEstimate {
  let totalText = ''

  if (systemPrompt) {
    totalText += `${systemPrompt}\n`
  }

  if (context) {
    totalText += `${context}\n`
  }

  if (messages) {
    for (const message of messages) {
      totalText += `${message.role}: ${message.content}\n`
    }
  }

  return estimateTokenCount(totalText, providerId)
}
```

*   `estimateInputTokens(systemPrompt?: string, context?: string, messages?: Array<{ role: string; content: string }>, providerId?: string): TokenEstimate`: This function estimates the total number of tokens for the input content to an LLM, including the system prompt, context, and messages.

    *   It concatenates all the input components into a single string (`totalText`).
    *   It then calls `estimateTokenCount` to estimate the tokens in the combined text, using the provided `providerId`.

```typescript
/**
 * Estimates tokens for output content
 */
export function estimateOutputTokens(content: string, providerId?: string): TokenEstimate {
  return estimateTokenCount(content, providerId)
}
```

*   `estimateOutputTokens(content: string, providerId?: string): TokenEstimate`: This function estimates the number of tokens for the output content (the LLM's response).

    *   It simply calls `estimateTokenCount` to estimate the tokens in the `content` string, using the provided `providerId`.

**Simplifying Complex Logic:**

*   **Caching:** The `encodingCache` dramatically simplifies the loading and reuse of token encodings.  Without it, the `encodingForModel` function would be called repeatedly, which could be slow.
*   **Provider-Specific Estimation:**  The `switch` statement in `estimateTokenCount` cleanly separates the estimation logic for different providers.  This makes it easy to add or modify estimation methods for new providers.
*   **Fallback Mechanisms:** The use of `try...catch` blocks with fallback estimations (e.g., character-based estimation in `getAccurateTokenCount` and `truncateToTokenLimit`) makes the code more robust and prevents it from crashing when errors occur.
*   **Helper Functions:**  Functions like `getTokenCountsForBatch` and `getTotalTokenCount` provide simple, reusable abstractions for common token counting tasks.  `batchByTokenLimit` encapsulates the complex logic of batching texts while respecting token limits.
*   **Default Parameters:** The use of default parameters for `modelName` and `providerId` makes the functions easier to use in common cases.

**In summary,** this file provides a comprehensive set of tools for managing tokens when working with LLMs. It balances accuracy (using `tiktoken`) with performance (using caching and estimation) and provides utility functions for batching and truncation, which are crucial for building reliable and cost-effective applications that use LLMs. The code is well-structured, easy to understand, and includes error handling and fallback mechanisms to ensure robustness.
