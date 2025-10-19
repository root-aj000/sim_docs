```typescript
/**
 * Utility functions for tokenization
 */

import { createLogger } from '@/lib/logs/console/logger'
import {
  LLM_BLOCK_TYPES,
  MAX_PREVIEW_LENGTH,
  TOKENIZATION_CONFIG,
} from '@/lib/tokenization/constants'
import { createTokenizationError } from '@/lib/tokenization/errors'
import type { ProviderTokenizationConfig, TokenUsage } from '@/lib/tokenization/types'
import { getProviderFromModel } from '@/providers/utils'

const logger = createLogger('TokenizationUtils')

/**
 * Gets tokenization configuration for a specific provider
 */
export function getProviderConfig(providerId: string): ProviderTokenizationConfig {
  const config =
    TOKENIZATION_CONFIG.providers[providerId as keyof typeof TOKENIZATION_CONFIG.providers]

  if (!config) {
    logger.debug(`No specific config for provider ${providerId}, using fallback`, { providerId })
    return TOKENIZATION_CONFIG.fallback
  }

  return config
}

/**
 * Extracts provider ID from model name
 */
export function getProviderForTokenization(model: string): string {
  try {
    return getProviderFromModel(model)
  } catch (error) {
    logger.warn(`Failed to get provider for model ${model}, using default`, {
      model,
      error: error instanceof Error ? error.message : String(error),
    })
    return TOKENIZATION_CONFIG.defaults.provider
  }
}

/**
 * Checks if a block type should be tokenized
 */
export function isTokenizableBlockType(blockType?: string): boolean {
  if (!blockType) return false
  return LLM_BLOCK_TYPES.includes(blockType as any)
}

/**
 * Checks if tokens/cost data is meaningful (non-zero)
 */
export function hasRealTokenData(tokens?: TokenUsage): boolean {
  if (!tokens) return false
  return tokens.total > 0 || tokens.prompt > 0 || tokens.completion > 0
}

/**
 * Checks if cost data is meaningful (non-zero)
 */
export function hasRealCostData(cost?: {
  total?: number
  input?: number
  output?: number
}): boolean {
  if (!cost) return false
  return (cost.total || 0) > 0 || (cost.input || 0) > 0 || (cost.output || 0) > 0
}

/**
 * Safely extracts text content from various input formats
 */
export function extractTextContent(input: unknown): string {
  if (typeof input === 'string') {
    return input.trim()
  }

  if (input && typeof input === 'object') {
    try {
      return JSON.stringify(input)
    } catch (error) {
      logger.warn('Failed to stringify input object', {
        inputType: typeof input,
        error: error instanceof Error ? error.message : String(error),
      })
      return ''
    }
  }

  return String(input || '')
}

/**
 * Creates a preview of text for logging (truncated)
 */
export function createTextPreview(text: string): string {
  if (text.length <= MAX_PREVIEW_LENGTH) {
    return text
  }
  return `${text.substring(0, MAX_PREVIEW_LENGTH)}...`
}

/**
 * Validates tokenization input
 */
export function validateTokenizationInput(
  model: string,
  inputText: string,
  outputText: string
): void {
  if (!model?.trim()) {
    throw createTokenizationError('INVALID_MODEL', 'Model is required for tokenization', { model })
  }

  if (!inputText?.trim() && !outputText?.trim()) {
    throw createTokenizationError(
      'MISSING_TEXT',
      'Either input text or output text must be provided',
      {
        inputLength: inputText?.length || 0,
        outputLength: outputText?.length || 0,
      }
    )
  }
}

/**
 * Formats token count for display
 */
export function formatTokenCount(count: number): string {
  if (count === 0) return '0'
  if (count < 1000) return count.toString()
  if (count < 1000000) return `${(count / 1000).toFixed(1)}K`
  return `${(count / 1000000).toFixed(1)}M`
}

/**
 * Logs tokenization operation details
 */
export function logTokenizationDetails(
  operation: string,
  details: {
    blockId?: string
    blockType?: string
    model?: string
    provider?: string
    inputLength?: number
    outputLength?: number
    tokens?: TokenUsage
    cost?: { input?: number; output?: number; total?: number }
    method?: string
  }
): void {
  logger.info(`${operation}`, {
    blockId: details.blockId,
    blockType: details.blockType,
    model: details.model,
    provider: details.provider,
    inputLength: details.inputLength,
    outputLength: details.outputLength,
    tokens: details.tokens,
    cost: details.cost,
    method: details.method,
  })
}
```

### Detailed Explanation

**Purpose of this file:**

This TypeScript file provides a suite of utility functions specifically designed to assist with the process of tokenizing text for use with Large Language Models (LLMs). Tokenization is the process of breaking down text into smaller units (tokens) that LLMs can understand and process.  These utilities handle tasks such as:

- Retrieving tokenization configurations for different LLM providers.
- Identifying the provider associated with a specific LLM model.
- Validating input data before tokenization.
- Extracting text content from various data types.
- Formatting token counts for display.
- Logging tokenization details for debugging and monitoring.
- Checking for meaningful token and cost data.

**Imports:**

- `createLogger` from `'@/lib/logs/console/logger'`: Imports a function to create a logger instance for logging information, warnings, and errors. This is crucial for debugging and monitoring the tokenization process.
- `LLM_BLOCK_TYPES, MAX_PREVIEW_LENGTH, TOKENIZATION_CONFIG` from `'@/lib/tokenization/constants'`: Imports constants related to tokenization, such as allowed block types, maximum preview length for text, and tokenization configurations for different providers.
- `createTokenizationError` from `'@/lib/tokenization/errors'`: Imports a function to create custom error objects specific to tokenization issues.
- `ProviderTokenizationConfig, TokenUsage` from `'@/lib/tokenization/types'`: Imports type definitions for tokenization configuration and token usage data.  These types provide structure and clarity to the data being handled.
- `getProviderFromModel` from `'@/providers/utils'`: Imports a function to extract the provider ID from a given LLM model name.

**Logger Initialization:**

- `const logger = createLogger('TokenizationUtils')`: Creates a logger instance named `TokenizationUtils`.  All log messages generated by functions in this file will be prefixed with this name, making it easier to identify the source of the logs.

**Function: `getProviderConfig`**

```typescript
export function getProviderConfig(providerId: string): ProviderTokenizationConfig {
  const config =
    TOKENIZATION_CONFIG.providers[providerId as keyof typeof TOKENIZATION_CONFIG.providers]

  if (!config) {
    logger.debug(`No specific config for provider ${providerId}, using fallback`, { providerId })
    return TOKENIZATION_CONFIG.fallback
  }

  return config
}
```

- **Purpose:** Retrieves the tokenization configuration for a specific LLM provider.  Each provider might have different rules or settings for how text is tokenized, and this function ensures the correct configuration is used.
- **Parameters:**
  - `providerId: string`: The ID of the LLM provider (e.g., "openai", "anthropic").
- **Logic:**
  1. `const config = TOKENIZATION_CONFIG.providers[providerId as keyof typeof TOKENIZATION_CONFIG.providers]`:  This line attempts to retrieve the configuration from the `TOKENIZATION_CONFIG.providers` object using the `providerId`.  The `as keyof typeof TOKENIZATION_CONFIG.providers` part is a TypeScript type assertion that ensures the `providerId` is a valid key within the `TOKENIZATION_CONFIG.providers` object.  This prevents potential type errors.
  2. `if (!config)`: Checks if a configuration was found for the given `providerId`.
  3. `logger.debug(\`No specific config for provider ${providerId}, using fallback\`, { providerId })`: If no configuration is found, a debug message is logged indicating that the fallback configuration will be used.  Debug logs are useful for developers but are typically disabled in production environments.
  4. `return TOKENIZATION_CONFIG.fallback`:  Returns the default or fallback tokenization configuration.
  5. `return config`: If a configuration was found, it is returned.
- **Return Value:** `ProviderTokenizationConfig`: The tokenization configuration object for the specified provider.

**Function: `getProviderForTokenization`**

```typescript
export function getProviderForTokenization(model: string): string {
  try {
    return getProviderFromModel(model)
  } catch (error) {
    logger.warn(`Failed to get provider for model ${model}, using default`, {
      model,
      error: error instanceof Error ? error.message : String(error),
    })
    return TOKENIZATION_CONFIG.defaults.provider
  }
}
```

- **Purpose:** Extracts the LLM provider ID from a given model name.  This is useful when you only have the model name and need to determine which provider's tokenization rules to use.
- **Parameters:**
  - `model: string`: The name of the LLM model (e.g., "gpt-3.5-turbo", "claude-v1").
- **Logic:**
  1. `try...catch`:  Uses a `try...catch` block to handle potential errors during provider extraction.
  2. `return getProviderFromModel(model)`: Attempts to get the provider ID using the `getProviderFromModel` function.
  3. `catch (error)`: If `getProviderFromModel` throws an error (e.g., the model name is not recognized), the `catch` block is executed.
  4. `logger.warn(\`Failed to get provider for model ${model}, using default\`, { model, error: error instanceof Error ? error.message : String(error) })`: A warning message is logged indicating that the provider could not be determined and the default provider will be used. The error message is also logged for debugging.
  5. `return TOKENIZATION_CONFIG.defaults.provider`: Returns the default provider ID.
- **Return Value:** `string`: The provider ID (e.g., "openai") or the default provider ID if extraction fails.

**Function: `isTokenizableBlockType`**

```typescript
export function isTokenizableBlockType(blockType?: string): boolean {
  if (!blockType) return false
  return LLM_BLOCK_TYPES.includes(blockType as any)
}
```

- **Purpose:** Checks if a given block type should be tokenized.  This allows you to selectively tokenize different parts of your data based on their type.
- **Parameters:**
  - `blockType?: string`: The type of the block (e.g., "code", "text", "metadata"). It is optional, indicated by the `?`.
- **Logic:**
  1. `if (!blockType) return false`: If the `blockType` is null or undefined, it returns `false` because there is no type to check.
  2. `return LLM_BLOCK_TYPES.includes(blockType as any)`: Checks if the `blockType` is present in the `LLM_BLOCK_TYPES` array (defined in the constants file). The `as any` is used to bypass TypeScript's strict type checking, but it's generally better to ensure `LLM_BLOCK_TYPES` is properly typed to avoid needing this.
- **Return Value:** `boolean`: `true` if the block type should be tokenized, `false` otherwise.

**Function: `hasRealTokenData`**

```typescript
export function hasRealTokenData(tokens?: TokenUsage): boolean {
  if (!tokens) return false
  return tokens.total > 0 || tokens.prompt > 0 || tokens.completion > 0
}
```

- **Purpose:** Determines if a `TokenUsage` object contains meaningful (non-zero) token data. This is useful for avoiding calculations or displays with empty token data.
- **Parameters:**
  - `tokens?: TokenUsage`: An optional `TokenUsage` object, which likely contains properties like `total`, `prompt`, and `completion` representing token counts.
- **Logic:**
  1. `if (!tokens) return false`: If the `tokens` object is null or undefined, it returns `false`.
  2. `return tokens.total > 0 || tokens.prompt > 0 || tokens.completion > 0`: Checks if any of the token count properties (`total`, `prompt`, `completion`) are greater than 0. If at least one is, it returns `true`; otherwise, it returns `false`.
- **Return Value:** `boolean`: `true` if the token data is meaningful, `false` otherwise.

**Function: `hasRealCostData`**

```typescript
export function hasRealCostData(cost?: {
  total?: number
  input?: number
  output?: number
}): boolean {
  if (!cost) return false
  return (cost.total || 0) > 0 || (cost.input || 0) > 0 || (cost.output || 0) > 0
}
```

- **Purpose:** Determines if a cost object contains meaningful (non-zero) cost data.  Similar to `hasRealTokenData`, this prevents calculations or displays with empty cost data.
- **Parameters:**
  - `cost?: { total?: number; input?: number; output?: number }`: An optional object containing cost information, with properties `total`, `input`, and `output`.
- **Logic:**
  1. `if (!cost) return false`:  If the `cost` object is null or undefined, return `false`.
  2. `return (cost.total || 0) > 0 || (cost.input || 0) > 0 || (cost.output || 0) > 0`: This line checks if any of the cost values are greater than 0. The `|| 0` part uses the "or" operator to default a potentially undefined `cost` property to zero to prevent errors.
- **Return Value:** `boolean`: `true` if the cost data is meaningful, `false` otherwise.

**Function: `extractTextContent`**

```typescript
export function extractTextContent(input: unknown): string {
  if (typeof input === 'string') {
    return input.trim()
  }

  if (input && typeof input === 'object') {
    try {
      return JSON.stringify(input)
    } catch (error) {
      logger.warn('Failed to stringify input object', {
        inputType: typeof input,
        error: error instanceof Error ? error.message : String(error),
      })
      return ''
    }
  }

  return String(input || '')
}
```

- **Purpose:** Safely extracts text content from various input types.  This function is designed to handle different data formats that might be passed as input, ensuring a consistent string representation.
- **Parameters:**
  - `input: unknown`: The input data, which can be of any type (`unknown`).
- **Logic:**
  1. `if (typeof input === 'string') { return input.trim() }`: If the input is a string, it trims any leading/trailing whitespace and returns the trimmed string.
  2. `if (input && typeof input === 'object')`: If the input is an object, the code attempts to convert it to a JSON string.
  3. `try...catch`: A `try...catch` block is used to handle potential errors during JSON stringification (e.g., if the object contains circular references).
  4. `return JSON.stringify(input)`: Attempts to convert the object into a JSON string.
  5. `logger.warn('Failed to stringify input object', { inputType: typeof input, error: error instanceof Error ? error.message : String(error) })`: If the `JSON.stringify` call fails, a warning message is logged with the type of the input and the error message.
  6. `return ''`: If JSON stringification fails, an empty string is returned.
  7. `return String(input || '')`: If the input is not a string or an object, this line converts the input to a string using `String(input)`.  The `|| ''` ensures that if `input` is null or undefined, an empty string is used instead.
- **Return Value:** `string`: The extracted text content as a string.

**Function: `createTextPreview`**

```typescript
export function createTextPreview(text: string): string {
  if (text.length <= MAX_PREVIEW_LENGTH) {
    return text
  }
  return `${text.substring(0, MAX_PREVIEW_LENGTH)}...`
}
```

- **Purpose:** Creates a truncated preview of a given text string for logging purposes.  This is useful for avoiding excessively long log messages when dealing with potentially large text inputs.
- **Parameters:**
  - `text: string`: The text string to create a preview of.
- **Logic:**
  1. `if (text.length <= MAX_PREVIEW_LENGTH) { return text }`: If the length of the text is less than or equal to `MAX_PREVIEW_LENGTH`, the entire text is returned.
  2. `return \`${text.substring(0, MAX_PREVIEW_LENGTH)}...\``: If the text is longer than `MAX_PREVIEW_LENGTH`, the function returns a substring of the text up to `MAX_PREVIEW_LENGTH` characters, followed by "...".
- **Return Value:** `string`: The truncated text preview.

**Function: `validateTokenizationInput`**

```typescript
export function validateTokenizationInput(
  model: string,
  inputText: string,
  outputText: string
): void {
  if (!model?.trim()) {
    throw createTokenizationError('INVALID_MODEL', 'Model is required for tokenization', { model })
  }

  if (!inputText?.trim() && !outputText?.trim()) {
    throw createTokenizationError(
      'MISSING_TEXT',
      'Either input text or output text must be provided',
      {
        inputLength: inputText?.length || 0,
        outputLength: outputText?.length || 0,
      }
    )
  }
}
```

- **Purpose:** Validates the input parameters required for tokenization.  This function ensures that the essential data needed for tokenization is present and valid, preventing errors later in the process.
- **Parameters:**
  - `model: string`: The name of the LLM model.
  - `inputText: string`: The input text to be tokenized.
  - `outputText: string`: The output text generated by the LLM.
- **Logic:**
  1. `if (!model?.trim())`: Checks if the `model` string is null, undefined, or consists only of whitespace. The `?.` is the optional chaining operator, which prevents errors if `model` is null or undefined. The `trim()` method removes leading and trailing whitespace.
  2. `throw createTokenizationError('INVALID_MODEL', 'Model is required for tokenization', { model })`: If the model is invalid, a `TokenizationError` with the code `INVALID_MODEL` is thrown.
  3. `if (!inputText?.trim() && !outputText?.trim())`: Checks if both the `inputText` and `outputText` are null, undefined, or consist only of whitespace.
  4. `throw createTokenizationError('MISSING_TEXT', 'Either input text or output text must be provided', { inputLength: inputText?.length || 0, outputLength: outputText?.length || 0 })`: If neither input nor output text is provided, a `TokenizationError` with the code `MISSING_TEXT` is thrown. The error includes the lengths of the input and output texts for debugging.
- **Return Value:** `void`: The function does not return a value. It either completes successfully or throws an error.

**Function: `formatTokenCount`**

```typescript
export function formatTokenCount(count: number): string {
  if (count === 0) return '0'
  if (count < 1000) return count.toString()
  if (count < 1000000) return `${(count / 1000).toFixed(1)}K`
  return `${(count / 1000000).toFixed(1)}M`
}
```

- **Purpose:** Formats a token count for display, using abbreviations like "K" for thousands and "M" for millions.  This improves readability when displaying large token counts.
- **Parameters:**
  - `count: number`: The token count to format.
- **Logic:**
  1. `if (count === 0) return '0'`: If the count is 0, return "0".
  2. `if (count < 1000) return count.toString()`: If the count is less than 1000, return the count as a string.
  3. `if (count < 1000000) return \`${(count / 1000).toFixed(1)}K\``: If the count is less than 1,000,000, divide it by 1000, format it to one decimal place, and append "K" (for thousands).
  4. `return \`${(count / 1000000).toFixed(1)}M\``: If the count is 1,000,000 or greater, divide it by 1,000,000, format it to one decimal place, and append "M" (for millions).
- **Return Value:** `string`: The formatted token count.

**Function: `logTokenizationDetails`**

```typescript
export function logTokenizationDetails(
  operation: string,
  details: {
    blockId?: string
    blockType?: string
    model?: string
    provider?: string
    inputLength?: number
    outputLength?: number
    tokens?: TokenUsage
    cost?: { input?: number; output?: number; total?: number }
    method?: string
  }
): void {
  logger.info(`${operation}`, {
    blockId: details.blockId,
    blockType: details.blockType,
    model: details.model,
    provider: details.provider,
    inputLength: details.inputLength,
    outputLength: details.outputLength,
    tokens: details.tokens,
    cost: details.cost,
    method: details.method,
  })
}
```

- **Purpose:** Logs detailed information about a tokenization operation.  This is crucial for debugging, monitoring, and analyzing tokenization processes.
- **Parameters:**
  - `operation: string`: A string describing the tokenization operation being performed (e.g., "Tokenizing input", "Estimating token count").
  - `details: { ... }`: An object containing details about the tokenization operation, including block ID, block type, model, provider, input/output lengths, token usage, cost, and method used. All properties are optional.
- **Logic:**
  1. `logger.info(\`${operation}\`, { ...details })`: Logs an information message using the logger.  The `operation` string is used as the main message, and the `details` object is passed as metadata, allowing you to view the specific values of each property in the log.
- **Return Value:** `void`: The function does not return a value.

**Summary:**

This file provides a comprehensive set of utility functions for managing and processing tokenization data for LLMs.  It handles configuration retrieval, input validation, data extraction, formatting, and logging, making it a valuable component for any application that interacts with LLMs and needs to track token usage and costs. The use of TypeScript types and a logger enhances code maintainability and debuggability.
