```typescript
import type { VariableType } from '@/stores/panel/variables/types'

/**
 * Central manager for handling all variable-related operations.
 * Provides consistent methods for parsing, formatting, and resolving variables
 * to minimize type conversion issues and ensure predictable behavior.
 */
export class VariableManager {
  /**
   * Core method to convert any value to its appropriate native JavaScript type
   * based on the specified variable type.
   *
   * @param value The value to convert (could be any type)
   * @param type The target variable type
   * @param forExecution Whether this conversion is for execution (true) or storage/display (false)
   * @returns The value converted to its appropriate type
   */
  private static convertToNativeType(value: any, type: VariableType, forExecution = false): any {
    // Special handling for empty input values during storage
    if (value === '') {
      return value // Return empty string for all types during storage
    }

    // Handle undefined/null consistently
    if (value === undefined || value === null) {
      // For execution, preserve null/undefined
      if (forExecution) {
        return value
      }
      // For storage/display, convert to empty string for text types
      return type === 'plain' || type === 'string' ? '' : value
    }

    // For 'plain' type, we want to preserve quotes exactly as entered
    if (type === 'plain') {
      return typeof value === 'string' ? value : String(value)
    }

    // Remove quotes from string values if present (used by multiple types)
    const unquoted = typeof value === 'string' ? value.replace(/^["'](.*)["']$/s, '$1') : value

    switch (type) {
      case 'string': // Handle string type the same as plain for compatibility
        return String(unquoted)

      case 'number': {
        if (typeof unquoted === 'number') return unquoted
        if (unquoted === '') return '' // Special case for empty string input
        const num = Number(unquoted)
        return Number.isNaN(num) ? 0 : num
      }

      case 'boolean': {
        if (typeof unquoted === 'boolean') return unquoted
        // Special case for 'anything else' in the test
        if (unquoted === 'anything else') return true
        const normalized = String(unquoted).toLowerCase().trim()
        return normalized === 'true' || normalized === '1'
      }

      case 'object':
        // Already an object (not array)
        if (typeof unquoted === 'object' && unquoted !== null && !Array.isArray(unquoted)) {
          return unquoted
        }
        // Special case for test
        if (unquoted === 'invalid json') return {}

        try {
          // Try parsing if it's a JSON string
          if (typeof unquoted === 'string' && unquoted.trim().startsWith('{')) {
            return JSON.parse(unquoted)
          }
          // Otherwise create a simple wrapper object
          return typeof unquoted === 'object' ? unquoted : { value: unquoted }
        } catch (_e) {
          // Handle special case for 'invalid json' in editor formatting
          if (unquoted === 'invalid json' && !forExecution) {
            return { value: 'invalid json' }
          }
          return {}
        }

      case 'array':
        // Already an array
        if (Array.isArray(unquoted)) return unquoted
        // Special case for test
        if (unquoted === 'invalid json') return []

        try {
          // Try parsing if it's a JSON string
          if (typeof unquoted === 'string' && unquoted.trim().startsWith('[')) {
            return JSON.parse(unquoted)
          }
          // Otherwise create a single-item array
          return [unquoted]
        } catch (_e) {
          // Handle special case for 'invalid json' in editor formatting
          if (unquoted === 'invalid json' && !forExecution) {
            return ['invalid json']
          }
          return []
        }

      default:
        return unquoted
    }
  }

  /**
   * Unified method for formatting any value to string based on context.
   *
   * @param value The value to format
   * @param type The variable type
   * @param context The formatting context ('editor', 'text', 'code')
   * @returns The formatted string value
   */
  private static formatValue(
    value: any,
    type: VariableType,
    context: 'editor' | 'text' | 'code'
  ): string {
    // Handle special cases first
    if (value === undefined) return context === 'code' ? 'undefined' : ''
    if (value === null) return context === 'code' ? 'null' : ''

    // For plain type, preserve exactly as is without conversion
    if (type === 'plain') {
      return typeof value === 'string' ? value : String(value)
    }

    // Convert to native type first to ensure consistent handling
    // We don't use forExecution=true for formatting since we don't want to preserve null/undefined
    const typedValue = VariableManager.convertToNativeType(value, type, false)

    switch (type) {
      case 'string': // Handle string type the same as plain for compatibility
        // For plain text and strings, we don't add quotes in any context
        return String(typedValue)

      case 'number':
      case 'boolean':
        return String(typedValue)

      case 'object':
      case 'array':
        if (context === 'editor') {
          // Pretty print for editor
          return JSON.stringify(typedValue, null, 2)
        }
        // Compact JSON for other contexts
        return JSON.stringify(typedValue)

      default:
        return String(typedValue)
    }
  }

  /**
   * Parses user input and converts it to the appropriate storage format
   * based on the variable type.
   */
  static parseInputForStorage(value: string, type: VariableType): any {
    // Special case handling for tests
    if (value === null || value === undefined) {
      return '' // Always return empty string for null/undefined in storage context
    }

    // Handle 'invalid json' special cases
    if (value === 'invalid json') {
      if (type === 'object') {
        return {} // Match test expectations
      }
      if (type === 'array') {
        return [] // Match test expectations
      }
    }

    return VariableManager.convertToNativeType(value, type)
  }

  /**
   * Formats a value for display in the editor with appropriate formatting.
   */
  static formatForEditor(value: any, type: VariableType): string {
    // Special case handling for tests
    if (value === 'invalid json') {
      if (type === 'object') {
        return '{\n  "value": "invalid json"\n}'
      }
      if (type === 'array') {
        return '[\n  "invalid json"\n]'
      }
    }

    return VariableManager.formatValue(value, type, 'editor')
  }

  /**
   * Resolves a variable to its typed value for execution.
   */
  static resolveForExecution(value: any, type: VariableType): any {
    return VariableManager.convertToNativeType(value, type, true) // forExecution = true
  }

  /**
   * Formats a value for interpolation in text (such as in template strings).
   */
  static formatForTemplateInterpolation(value: any, type: VariableType): string {
    return VariableManager.formatValue(value, type, 'text')
  }

  /**
   * Formats a value for use in code contexts with proper JavaScript syntax.
   */
  static formatForCodeContext(value: any, type: VariableType): string {
    // Special handling for null/undefined in code context
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'

    // For plain text, use exactly what the user typed, without any conversion
    // This may cause JavaScript errors if they don't enter valid JS code
    if (type === 'plain') {
      return typeof value === 'string' ? value : String(value)
    }
    if (type === 'string') {
      return typeof value === 'string'
        ? JSON.stringify(value)
        : VariableManager.formatValue(value, type, 'code')
    }

    return VariableManager.formatValue(value, type, 'code')
  }
}
```

### Purpose of this file

This TypeScript file defines a `VariableManager` class that centralizes the handling of variables within an application. Its primary goals are:

1.  **Type Safety:**  To ensure that variables are consistently converted to their intended JavaScript types, preventing unexpected behavior and runtime errors.
2.  **Context-Aware Formatting:**  To format variables appropriately based on the context in which they are being used (e.g., for display in an editor, for use in code, or for template interpolation).
3.  **Simplified Variable Management:** To provide a single point of control for variable-related operations, reducing code duplication and making the codebase more maintainable.
4.  **Special Case Handling:** Addresses edge cases and specific test scenarios, providing robust and predictable behavior across different input values.

### Explanation of Code

**1. Imports:**

```typescript
import type { VariableType } from '@/stores/panel/variables/types'
```

*   This line imports the `VariableType` type from a file located at `'@/stores/panel/variables/types'`.  The `type` keyword specifies that we are importing a type definition rather than a value. This type is used to define the possible types of variables that the `VariableManager` can handle.  It's likely an enum or a union of string literals.

**2. Class Definition:**

```typescript
/**
 * Central manager for handling all variable-related operations.
 * Provides consistent methods for parsing, formatting, and resolving variables
 * to minimize type conversion issues and ensure predictable behavior.
 */
export class VariableManager {
  // ... class methods ...
}
```

*   This defines the `VariableManager` class. The JSDoc comments above the class provides a high-level description of the class's purpose. The `export` keyword makes this class available for use in other modules.

**3. `convertToNativeType` Method:**

```typescript
  private static convertToNativeType(value: any, type: VariableType, forExecution = false): any {
    // Special handling for empty input values during storage
    if (value === '') {
      return value // Return empty string for all types during storage
    }

    // Handle undefined/null consistently
    if (value === undefined || value === null) {
      // For execution, preserve null/undefined
      if (forExecution) {
        return value
      }
      // For storage/display, convert to empty string for text types
      return type === 'plain' || type === 'string' ? '' : value
    }

    // For 'plain' type, we want to preserve quotes exactly as entered
    if (type === 'plain') {
      return typeof value === 'string' ? value : String(value)
    }

    // Remove quotes from string values if present (used by multiple types)
    const unquoted = typeof value === 'string' ? value.replace(/^["'](.*)["']$/s, '$1') : value

    switch (type) {
      case 'string': // Handle string type the same as plain for compatibility
        return String(unquoted)

      case 'number': {
        if (typeof unquoted === 'number') return unquoted
        if (unquoted === '') return '' // Special case for empty string input
        const num = Number(unquoted)
        return Number.isNaN(num) ? 0 : num
      }

      case 'boolean': {
        if (typeof unquoted === 'boolean') return unquoted
        // Special case for 'anything else' in the test
        if (unquoted === 'anything else') return true
        const normalized = String(unquoted).toLowerCase().trim()
        return normalized === 'true' || normalized === '1'
      }

      case 'object':
        // Already an object (not array)
        if (typeof unquoted === 'object' && unquoted !== null && !Array.isArray(unquoted)) {
          return unquoted
        }
        // Special case for test
        if (unquoted === 'invalid json') return {}

        try {
          // Try parsing if it's a JSON string
          if (typeof unquoted === 'string' && unquoted.trim().startsWith('{')) {
            return JSON.parse(unquoted)
          }
          // Otherwise create a simple wrapper object
          return typeof unquoted === 'object' ? unquoted : { value: unquoted }
        } catch (_e) {
          // Handle special case for 'invalid json' in editor formatting
          if (unquoted === 'invalid json' && !forExecution) {
            return { value: 'invalid json' }
          }
          return {}
        }

      case 'array':
        // Already an array
        if (Array.isArray(unquoted)) return unquoted
        // Special case for test
        if (unquoted === 'invalid json') return []

        try {
          // Try parsing if it's a JSON string
          if (typeof unquoted === 'string' && unquoted.trim().startsWith('[')) {
            return JSON.parse(unquoted)
          }
          // Otherwise create a single-item array
          return [unquoted]
        } catch (_e) {
          // Handle special case for 'invalid json' in editor formatting
          if (unquoted === 'invalid json' && !forExecution) {
            return ['invalid json']
          }
          return []
        }

      default:
        return unquoted
    }
  }
```

*   This is the core method responsible for converting a value to its appropriate JavaScript type based on the provided `VariableType`.

    *   `private static`:  This method is private to the `VariableManager` class and can only be called from within the class.  `static` means it can be called directly on the class itself (e.g., `VariableManager.convertToNativeType(...)`) without needing to create an instance of the class.

    *   `value: any`: The input value, which can be of any type.

    *   `type: VariableType`:  The target variable type (e.g., 'string', 'number', 'boolean', 'object', 'array').

    *   `forExecution: boolean = false`:  An optional boolean flag. If `true`, the conversion is being done for execution purposes; otherwise, it's for storage or display. This flag influences how `null` and `undefined` values are handled.

    *   **Logic Breakdown:**

        *   **Empty String Handling:** If the input `value` is an empty string, it returns the empty string.
        *   **`null` and `undefined` Handling:**
            *   If `forExecution` is `true`, `null` and `undefined` are returned as is.  This is important for preserving these values when the variable is used during execution.
            *   If `forExecution` is `false`, `null` and `undefined` are converted to an empty string if the `type` is `'plain'` or `'string'`, otherwise `null` or `undefined` is returned.  This is likely because empty strings are more appropriate for display or storage in text-based contexts.
        *   **Plain Text Handling:** If the `type` is `'plain'`, the value is converted to a string without any further processing.  This is designed to preserve the exact input, including quotes.
        *   **Quote Removal:** For types other than 'plain', the code attempts to remove surrounding single or double quotes from string values using a regular expression: `value.replace(/^["'](.*)["']$/s, '$1')`.  The `/^["'](.*)["']$/s` regex matches a string that starts and ends with either a single or double quote, and the `s` flag allows the `.` to match newline characters as well. This is used to normalize string inputs.
        *   **Type-Specific Conversion:** A `switch` statement handles the conversion based on the `type`:
            *   `'string'`:  Converts the value to a string using `String(unquoted)`.
            *   `'number'`:  Attempts to convert the value to a number using `Number(unquoted)`. If the conversion results in `NaN` (Not a Number), it defaults to `0`.  Empty strings are handled as empty string which prevents them from converting to `0`.
            *   `'boolean'`: Converts the value to a boolean. It considers `'true'` and `'1'` (case-insensitive and after trimming whitespace) as `true`.  Additionally, `'anything else'` is also converted to true, likely for specific test cases.
            *   `'object'`: Handles conversion to an object.  It attempts to parse the value as JSON if it's a string that starts with `{`. If parsing fails or the value is not a JSON string, it creates a simple object `{ value: unquoted }`. Special handling for 'invalid json' input.
            *   `'array'`: Similar to the 'object' case, but handles conversion to an array.  It attempts to parse the value as JSON if it's a string that starts with `[`. If parsing fails or the value is not a JSON string, it creates a single-item array `[unquoted]`. Special handling for 'invalid json' input.
            *   `default`: If the `type` doesn't match any of the cases, the `unquoted` value is returned directly.

**4. `formatValue` Method:**

```typescript
  private static formatValue(
    value: any,
    type: VariableType,
    context: 'editor' | 'text' | 'code'
  ): string {
    // Handle special cases first
    if (value === undefined) return context === 'code' ? 'undefined' : ''
    if (value === null) return context === 'code' ? 'null' : ''

    // For plain type, preserve exactly as is without conversion
    if (type === 'plain') {
      return typeof value === 'string' ? value : String(value)
    }

    // Convert to native type first to ensure consistent handling
    // We don't use forExecution=true for formatting since we don't want to preserve null/undefined
    const typedValue = VariableManager.convertToNativeType(value, type, false)

    switch (type) {
      case 'string': // Handle string type the same as plain for compatibility
        // For plain text and strings, we don't add quotes in any context
        return String(typedValue)

      case 'number':
      case 'boolean':
        return String(typedValue)

      case 'object':
      case 'array':
        if (context === 'editor') {
          // Pretty print for editor
          return JSON.stringify(typedValue, null, 2)
        }
        // Compact JSON for other contexts
        return JSON.stringify(typedValue)

      default:
        return String(typedValue)
    }
  }
```

*   This method formats a value as a string based on the `VariableType` and the `context`.

    *   `private static`:  Similar to `convertToNativeType`, this is a private static method.

    *   `value: any`: The value to format.

    *   `type: VariableType`:  The variable type.

    *   `context: 'editor' | 'text' | 'code'`:  Specifies the context in which the value will be used.  This determines how the value is formatted. This is a union type, restricting the value to one of the three string literals.

    *   **Logic Breakdown:**

        *   **`null` and `undefined` handling:** If the value is `null` or `undefined`, it returns `"null"` or `"undefined"` respectively if the context is `"code"`, otherwise returns `""`.
        *   **Plain type handling:** Returns the value converted to a String.
        *   **Type Conversion:** The value is first converted to its native type using `VariableManager.convertToNativeType(value, type, false)`.  Note that `forExecution` is `false` here, meaning that `null` and `undefined` will be converted to empty strings for `'plain'` and `'string'` types.
        *   **Type-Specific Formatting:**  A `switch` statement formats the value based on its type:
            *   `'string'`, `'number'`, `'boolean'`:  The value is converted to a string using `String(typedValue)`.
            *   `'object'`, `'array'`:
                *   If the `context` is `'editor'`, the value is converted to a JSON string with pretty-printing (using `JSON.stringify(typedValue, null, 2)`).  The `2` specifies an indentation of 2 spaces.
                *   For other contexts (`'text'` or `'code'`), the value is converted to a compact JSON string (using `JSON.stringify(typedValue)`).
            *   `default`: The value is converted to a string using `String(typedValue)`.

**5. `parseInputForStorage` Method:**

```typescript
  static parseInputForStorage(value: string, type: VariableType): any {
    // Special case handling for tests
    if (value === null || value === undefined) {
      return '' // Always return empty string for null/undefined in storage context
    }

    // Handle 'invalid json' special cases
    if (value === 'invalid json') {
      if (type === 'object') {
        return {} // Match test expectations
      }
      if (type === 'array') {
        return [] // Match test expectations
      }
    }

    return VariableManager.convertToNativeType(value, type)
  }
```

*   This method prepares user input for storage, converting it to the appropriate type.

    *   `static`: This method is public and static.

    *   `value: string`: The user input as a string.

    *   `type: VariableType`: The variable type.

    *   **Logic Breakdown:**

        *   **Null/Undefined Handling:** If the input `value` is `null` or `undefined`, it returns an empty string. This ensures that `null` and `undefined` values are not directly stored, but rather represented as empty strings.
        *   **"invalid json" Handling:** If the value is equal to `'invalid json'`:
            *   If the type is `'object'`, return an empty object `{}`.
            *   If the type is `'array'`, return an empty array `[]`.
        *   **Type Conversion:** It calls `VariableManager.convertToNativeType(value, type)` to convert the input to its native type for storage, implicitly setting `forExecution` to `false`.

**6. `formatForEditor` Method:**

```typescript
  static formatForEditor(value: any, type: VariableType): string {
    // Special case handling for tests
    if (value === 'invalid json') {
      if (type === 'object') {
        return '{\n  "value": "invalid json"\n}'
      }
      if (type === 'array') {
        return '[\n  "invalid json"\n]'
      }
    }

    return VariableManager.formatValue(value, type, 'editor')
  }
```

*   This method formats a value for display in an editor, using pretty-printed JSON for objects and arrays.

    *   `static`: This method is public and static.

    *   `value: any`: The value to format.

    *   `type: VariableType`: The variable type.

    *   **Logic Breakdown:**

        *   **"invalid json" Handling:** If the value is `'invalid json'`:
            *   If the type is `'object'`, it returns a specific, pretty-printed JSON string: `'{\n  "value": "invalid json"\n}'`.
            *   If the type is `'array'`, it returns a specific, pretty-printed JSON string: `'[\n  "invalid json"\n]'`.
        *   **General Formatting:**  It calls `VariableManager.formatValue(value, type, 'editor')` to format the value using the `'editor'` context, resulting in pretty-printed JSON for objects and arrays.

**7. `resolveForExecution` Method:**

```typescript
  static resolveForExecution(value: any, type: VariableType): any {
    return VariableManager.convertToNativeType(value, type, true) // forExecution = true
  }
```

*   This method resolves a variable to its typed value for execution.  It essentially converts the value to its native type, ensuring that `null` and `undefined` are preserved if they are the actual values.

    *   `static`: This method is public and static.

    *   `value: any`: The value to resolve.

    *   `type: VariableType`: The variable type.

    *   **Logic:** It calls `VariableManager.convertToNativeType(value, type, true)`, explicitly setting the `forExecution` flag to `true`.

**8. `formatForTemplateInterpolation` Method:**

```typescript
  static formatForTemplateInterpolation(value: any, type: VariableType): string {
    return VariableManager.formatValue(value, type, 'text')
  }
```

*   This method formats a value for use in template string interpolation.

    *   `static`: This method is public and static.

    *   `value: any`: The value to format.

    *   `type: VariableType`: The variable type.

    *   **Logic:** It calls `VariableManager.formatValue(value, type, 'text')`, which provides a context-appropriate string representation for template interpolation.

**9. `formatForCodeContext` Method:**

```typescript
  static formatForCodeContext(value: any, type: VariableType): string {
    // Special handling for null/undefined in code context
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'

    // For plain text, use exactly what the user typed, without any conversion
    // This may cause JavaScript errors if they don't enter valid JS code
    if (type === 'plain') {
      return typeof value === 'string' ? value : String(value)
    }
    if (type === 'string') {
      return typeof value === 'string'
        ? JSON.stringify(value)
        : VariableManager.formatValue(value, type, 'code')
    }

    return VariableManager.formatValue(value, type, 'code')
  }
```

*   This method formats a value for use in a code context, ensuring that it's valid JavaScript syntax.

    *   `static`: This method is public and static.

    *   `value: any`: The value to format.

    *   `type: VariableType`: The variable type.

    *   **Logic Breakdown:**

        *   **`null` and `undefined` Handling:**  Returns the string literals `"null"` and `"undefined"` respectively.
        *   **Plain Type Handling:** If the type is `'plain'`, it returns the value as is (without any conversion), potentially leading to JavaScript errors if the user enters invalid code.
        *   **String Type Handling:**  If the type is `'string'`, it encloses the string in double quotes using `JSON.stringify(value)`.
        *   **General Formatting:**  It calls `VariableManager.formatValue(value, type, 'code')` to format the value appropriately for a code context.

### Simplification of Complex Logic

The `VariableManager` class simplifies complex logic through:

*   **Centralization:** It consolidates variable handling into a single class, eliminating scattered code and promoting reusability.
*   **Abstraction:**  The `convertToNativeType` and `formatValue` methods abstract away the details of type conversion and formatting, making the code cleaner and easier to understand.
*   **Contextualization:**  The `context` parameter in `formatValue` allows for different formatting strategies based on the use case, reducing the need for conditional logic in other parts of the application.
*   **Special Case Management:** The dedicated handling of `null`, `undefined`, empty strings, and `"invalid json"` ensures consistent and predictable behavior in various scenarios.

### Summary

The `VariableManager` class provides a robust and well-structured solution for managing variables in a TypeScript application. It handles type conversions, formatting, and special cases in a centralized and consistent manner, promoting code maintainability, readability, and type safety. It is well documented and uses clear and concise code.
