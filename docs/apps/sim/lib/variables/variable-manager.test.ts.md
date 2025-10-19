```typescript
import { describe, expect, it } from 'vitest'
import { VariableManager } from '@/lib/variables/variable-manager'

describe('VariableManager', () => {
  describe('parseInputForStorage', () => {
    it.concurrent('should handle plain type variables', () => {
      expect(VariableManager.parseInputForStorage('hello world', 'plain')).toBe('hello world')
      expect(VariableManager.parseInputForStorage('123', 'plain')).toBe('123')
      expect(VariableManager.parseInputForStorage('true', 'plain')).toBe('true')
      expect(VariableManager.parseInputForStorage('{"foo":"bar"}', 'plain')).toBe('{"foo":"bar"}')
    })

    it.concurrent('should handle string type variables', () => {
      expect(VariableManager.parseInputForStorage('hello world', 'string')).toBe('hello world')
      expect(VariableManager.parseInputForStorage('"hello world"', 'string')).toBe('hello world')
      expect(VariableManager.parseInputForStorage("'hello world'", 'string')).toBe('hello world')
    })

    it.concurrent('should handle number type variables', () => {
      expect(VariableManager.parseInputForStorage('42', 'number')).toBe(42)
      expect(VariableManager.parseInputForStorage('-3.14', 'number')).toBe(-3.14)
      expect(VariableManager.parseInputForStorage('"42"', 'number')).toBe(42)
      expect(VariableManager.parseInputForStorage('not a number', 'number')).toBe(0)
    })

    it.concurrent('should handle boolean type variables', () => {
      expect(VariableManager.parseInputForStorage('true', 'boolean')).toBe(true)
      expect(VariableManager.parseInputForStorage('false', 'boolean')).toBe(false)
      expect(VariableManager.parseInputForStorage('1', 'boolean')).toBe(true)
      expect(VariableManager.parseInputForStorage('0', 'boolean')).toBe(false)
      expect(VariableManager.parseInputForStorage('"true"', 'boolean')).toBe(true)
      expect(VariableManager.parseInputForStorage("'false'", 'boolean')).toBe(false)
    })

    it.concurrent('should handle object type variables', () => {
      expect(VariableManager.parseInputForStorage('{"foo":"bar"}', 'object')).toEqual({
        foo: 'bar',
      })
      expect(VariableManager.parseInputForStorage('invalid json', 'object')).toEqual({})
      expect(VariableManager.parseInputForStorage('42', 'object')).toEqual({ value: '42' })
    })

    it.concurrent('should handle array type variables', () => {
      expect(VariableManager.parseInputForStorage('[1,2,3]', 'array')).toEqual([1, 2, 3])
      expect(VariableManager.parseInputForStorage('invalid json', 'array')).toEqual([])
      expect(VariableManager.parseInputForStorage('42', 'array')).toEqual(['42'])
    })

    it.concurrent('should handle empty values', () => {
      expect(VariableManager.parseInputForStorage('', 'string')).toBe('')
      expect(VariableManager.parseInputForStorage('', 'number')).toBe('')
      expect(VariableManager.parseInputForStorage(null as any, 'boolean')).toBe('')
      expect(VariableManager.parseInputForStorage(undefined as any, 'object')).toBe('')
    })
  })

  describe('formatForEditor', () => {
    it.concurrent('should format plain type variables for editor', () => {
      expect(VariableManager.formatForEditor('hello world', 'plain')).toBe('hello world')
      expect(VariableManager.formatForEditor(42, 'plain')).toBe('42')
      expect(VariableManager.formatForEditor(true, 'plain')).toBe('true')
    })

    it.concurrent('should format string type variables for editor', () => {
      expect(VariableManager.formatForEditor('hello world', 'string')).toBe('hello world')
      expect(VariableManager.formatForEditor(42, 'string')).toBe('42')
      expect(VariableManager.formatForEditor(true, 'string')).toBe('true')
    })

    it.concurrent('should format number type variables for editor', () => {
      expect(VariableManager.formatForEditor(42, 'number')).toBe('42')
      expect(VariableManager.formatForEditor('42', 'number')).toBe('42')
      expect(VariableManager.formatForEditor('not a number', 'number')).toBe('0')
    })

    it.concurrent('should format boolean type variables for editor', () => {
      expect(VariableManager.formatForEditor(true, 'boolean')).toBe('true')
      expect(VariableManager.formatForEditor(false, 'boolean')).toBe('false')
      expect(VariableManager.formatForEditor('true', 'boolean')).toBe('true')
      expect(VariableManager.formatForEditor('anything else', 'boolean')).toBe('true')
    })

    it.concurrent('should format object type variables for editor', () => {
      expect(VariableManager.formatForEditor({ foo: 'bar' }, 'object')).toBe('{\n  "foo": "bar"\n}')
      expect(VariableManager.formatForEditor('{"foo":"bar"}', 'object')).toBe(
        '{\n  "foo": "bar"\n}'
      )
      expect(VariableManager.formatForEditor('invalid json', 'object')).toEqual(
        '{\n  "value": "invalid json"\n}'
      )
    })

    it.concurrent('should format array type variables for editor', () => {
      expect(VariableManager.formatForEditor([1, 2, 3], 'array')).toBe('[\n  1,\n  2,\n  3\n]')
      expect(VariableManager.formatForEditor('[1,2,3]', 'array')).toBe('[\n  1,\n  2,\n  3\n]')
      expect(VariableManager.formatForEditor('invalid json', 'array')).toEqual(
        '[\n  "invalid json"\n]'
      )
    })

    it.concurrent('should handle empty values', () => {
      expect(VariableManager.formatForEditor(null, 'string')).toBe('')
      expect(VariableManager.formatForEditor(undefined, 'number')).toBe('')
    })
  })

  describe('resolveForExecution', () => {
    it.concurrent('should resolve plain type variables for execution', () => {
      expect(VariableManager.resolveForExecution('hello world', 'plain')).toBe('hello world')
      expect(VariableManager.resolveForExecution(42, 'plain')).toBe('42')
      expect(VariableManager.resolveForExecution(true, 'plain')).toBe('true')
    })

    it.concurrent('should resolve string type variables for execution', () => {
      expect(VariableManager.resolveForExecution('hello world', 'string')).toBe('hello world')
      expect(VariableManager.resolveForExecution(42, 'string')).toBe('42')
      expect(VariableManager.resolveForExecution(true, 'string')).toBe('true')
    })

    it.concurrent('should resolve number type variables for execution', () => {
      expect(VariableManager.resolveForExecution(42, 'number')).toBe(42)
      expect(VariableManager.resolveForExecution('42', 'number')).toBe(42)
      expect(VariableManager.resolveForExecution('not a number', 'number')).toBe(0)
    })

    it.concurrent('should resolve boolean type variables for execution', () => {
      expect(VariableManager.resolveForExecution(true, 'boolean')).toBe(true)
      expect(VariableManager.resolveForExecution(false, 'boolean')).toBe(false)
      expect(VariableManager.resolveForExecution('true', 'boolean')).toBe(true)
      expect(VariableManager.resolveForExecution('false', 'boolean')).toBe(false)
      expect(VariableManager.resolveForExecution('1', 'boolean')).toBe(true)
      expect(VariableManager.resolveForExecution('0', 'boolean')).toBe(false)
    })

    it.concurrent('should resolve object type variables for execution', () => {
      expect(VariableManager.resolveForExecution({ foo: 'bar' }, 'object')).toEqual({ foo: 'bar' })
      expect(VariableManager.resolveForExecution('{"foo":"bar"}', 'object')).toEqual({ foo: 'bar' })
      expect(VariableManager.resolveForExecution('invalid json', 'object')).toEqual({})
    })

    it.concurrent('should resolve array type variables for execution', () => {
      expect(VariableManager.resolveForExecution([1, 2, 3], 'array')).toEqual([1, 2, 3])
      expect(VariableManager.resolveForExecution('[1,2,3]', 'array')).toEqual([1, 2, 3])
      expect(VariableManager.resolveForExecution('invalid json', 'array')).toEqual([])
    })

    it.concurrent('should handle null and undefined', () => {
      expect(VariableManager.resolveForExecution(null, 'string')).toBe(null)
      expect(VariableManager.resolveForExecution(undefined, 'number')).toBe(undefined)
    })
  })

  describe('formatForTemplateInterpolation', () => {
    it.concurrent('should format plain type variables for interpolation', () => {
      expect(VariableManager.formatForTemplateInterpolation('hello world', 'plain')).toBe(
        'hello world'
      )
      expect(VariableManager.formatForTemplateInterpolation(42, 'plain')).toBe('42')
      expect(VariableManager.formatForTemplateInterpolation(true, 'plain')).toBe('true')
    })

    it.concurrent('should format string type variables for interpolation', () => {
      expect(VariableManager.formatForTemplateInterpolation('hello world', 'string')).toBe(
        'hello world'
      )
      expect(VariableManager.formatForTemplateInterpolation(42, 'string')).toBe('42')
      expect(VariableManager.formatForTemplateInterpolation(true, 'string')).toBe('true')
    })

    it.concurrent('should format object type variables for interpolation', () => {
      expect(VariableManager.formatForTemplateInterpolation({ foo: 'bar' }, 'object')).toBe(
        '{"foo":"bar"}'
      )
      expect(VariableManager.formatForTemplateInterpolation('{"foo":"bar"}', 'object')).toBe(
        '{"foo":"bar"}'
      )
    })

    it.concurrent('should handle empty values', () => {
      expect(VariableManager.formatForTemplateInterpolation(null, 'string')).toBe('')
      expect(VariableManager.formatForTemplateInterpolation(undefined, 'number')).toBe('')
    })
  })

  describe('formatForCodeContext', () => {
    it.concurrent('should format plain type variables for code context', () => {
      expect(VariableManager.formatForCodeContext('hello world', 'plain')).toBe('hello world')
      expect(VariableManager.formatForCodeContext(42, 'plain')).toBe('42')
      expect(VariableManager.formatForCodeContext(true, 'plain')).toBe('true')
    })

    it.concurrent('should format string type variables for code context', () => {
      expect(VariableManager.formatForCodeContext('hello world', 'string')).toBe('"hello world"')
      expect(VariableManager.formatForCodeContext(42, 'string')).toBe('42')
      expect(VariableManager.formatForCodeContext(true, 'string')).toBe('true')
    })

    it.concurrent('should format number type variables for code context', () => {
      expect(VariableManager.formatForCodeContext(42, 'number')).toBe('42')
      expect(VariableManager.formatForCodeContext('42', 'number')).toBe('42')
    })

    it.concurrent('should format boolean type variables for code context', () => {
      expect(VariableManager.formatForCodeContext(true, 'boolean')).toBe('true')
      expect(VariableManager.formatForCodeContext(false, 'boolean')).toBe('false')
    })

    it.concurrent('should format object and array types for code context', () => {
      expect(VariableManager.formatForCodeContext({ foo: 'bar' }, 'object')).toBe('{"foo":"bar"}')
      expect(VariableManager.formatForCodeContext([1, 2, 3], 'array')).toBe('[1,2,3]')
    })

    it.concurrent('should handle null and undefined', () => {
      expect(VariableManager.formatForCodeContext(null, 'string')).toBe('null')
      expect(VariableManager.formatForCodeContext(undefined, 'number')).toBe('undefined')
    })
  })
})
```

### Purpose of this file

This file contains unit tests for the `VariableManager` class, specifically focusing on its methods for:

1.  `parseInputForStorage`:  Parses and converts raw input strings into appropriate data types for storage, based on the specified variable type.
2.  `formatForEditor`: Formats stored variable values into strings suitable for display and editing in a user interface.
3.  `resolveForExecution`:  Converts stored values into data types suitable for runtime execution or usage within an application.
4. `formatForTemplateInterpolation`: Formats the variable for usage with template strings, like JavaScript template literals.
5. `formatForCodeContext`: Formats the variable to be valid for the code context, as in, if the code expects a string it returns a string and so on.

The tests ensure that the `VariableManager` handles various data types correctly (string, number, boolean, object, array, plain) and that conversions are performed as expected for each specific use case.

### Simplifying Complex Logic

The `VariableManager` likely contains logic to handle different data types and perform conversions between them. This test file simplifies demonstrating that logic by breaking it down into smaller, isolated test cases.  Each `it.concurrent` block focuses on a specific scenario, making it easier to understand the expected behavior of the `VariableManager` under different conditions.

The tests cover positive cases (valid input, correct conversion), edge cases (empty strings, null/undefined values), and error handling (invalid JSON for objects/arrays, non-numeric strings for numbers).

### Explanation of each line of code

```typescript
import { describe, expect, it } from 'vitest'
```

*   **`import { describe, expect, it } from 'vitest'`**:  This line imports the necessary testing functions from the `vitest` testing framework.
    *   `describe`:  Used to group related tests together (creates a test suite).
    *   `it`: Defines an individual test case (specifies what is being tested).
    *   `expect`:  Used to make assertions about the expected outcome of a test.

```typescript
import { VariableManager } from '@/lib/variables/variable-manager'
```

*   **`import { VariableManager } from '@/lib/variables/variable-manager'`**:  This line imports the `VariableManager` class from its module.  The `@/` alias likely refers to the project's root directory, and the path indicates that the `VariableManager` is located in a `lib/variables` folder.

```typescript
describe('VariableManager', () => {
```

*   **`describe('VariableManager', () => {`**: This line begins a test suite for the `VariableManager` class. All tests related to `VariableManager` will be grouped within this block.

```typescript
  describe('parseInputForStorage', () => {
```

*   **`describe('parseInputForStorage', () => {`**:  This line begins a nested test suite, specifically for the `parseInputForStorage` method of the `VariableManager` class.

```typescript
    it.concurrent('should handle plain type variables', () => {
```

*   **`it.concurrent('should handle plain type variables', () => {`**:  This line defines an individual test case within the `parseInputForStorage` suite. `it.concurrent` means that the test can run concurrently with other tests to improve performance. The string "should handle plain type variables" is a descriptive name for the test.

```typescript
      expect(VariableManager.parseInputForStorage('hello world', 'plain')).toBe('hello world')
      expect(VariableManager.parseInputForStorage('123', 'plain')).toBe('123')
      expect(VariableManager.parseInputForStorage('true', 'plain')).toBe('true')
      expect(VariableManager.parseInputForStorage('{"foo":"bar"}', 'plain')).toBe('{"foo":"bar"}')
    })
```

*   **`expect(VariableManager.parseInputForStorage('hello world', 'plain')).toBe('hello world')`**: This line is the core of the test.
    *   `VariableManager.parseInputForStorage('hello world', 'plain')`:  This calls the `parseInputForStorage` method of the `VariableManager` class, passing in the string `'hello world'` as the input value and `'plain'` as the variable type.
    *   `expect(...)`: This uses `vitest`'s `expect` function to create an assertion.
    *   `.toBe('hello world')`: This is the assertion itself.  It checks that the value returned by `parseInputForStorage` is strictly equal (using `===`) to the string `'hello world'`.
*   The next three lines perform similar tests with different input values, all with the 'plain' type.  These tests check that `parseInputForStorage` simply returns the input value unchanged when the type is 'plain'.

```typescript
    it.concurrent('should handle string type variables', () => {
      expect(VariableManager.parseInputForStorage('hello world', 'string')).toBe('hello world')
      expect(VariableManager.parseInputForStorage('"hello world"', 'string')).toBe('hello world')
      expect(VariableManager.parseInputForStorage("'hello world'", 'string')).toBe('hello world')
    })
```

*   This test case checks that the `parseInputForStorage` function correctly handles string type variables by trimming single and double quotes from the input.

```typescript
    it.concurrent('should handle number type variables', () => {
      expect(VariableManager.parseInputForStorage('42', 'number')).toBe(42)
      expect(VariableManager.parseInputForStorage('-3.14', 'number')).toBe(-3.14)
      expect(VariableManager.parseInputForStorage('"42"', 'number')).toBe(42)
      expect(VariableManager.parseInputForStorage('not a number', 'number')).toBe(0)
    })
```

*   This test case verifies that the `parseInputForStorage` function correctly converts string representations of numbers to their numeric equivalents when the type is specified as 'number'. It also checks that non-numeric input results in a default value of 0.

```typescript
    it.concurrent('should handle boolean type variables', () => {
      expect(VariableManager.parseInputForStorage('true', 'boolean')).toBe(true)
      expect(VariableManager.parseInputForStorage('false', 'boolean')).toBe(false)
      expect(VariableManager.parseInputForStorage('1', 'boolean')).toBe(true)
      expect(VariableManager.parseInputForStorage('0', 'boolean')).toBe(false)
      expect(VariableManager.parseInputForStorage('"true"', 'boolean')).toBe(true)
      expect(VariableManager.parseInputForStorage("'false'", 'boolean')).toBe(false)
    })
```

*   This test case validates that the `parseInputForStorage` correctly handles boolean type variables. It verifies that string values like 'true', 'false', '1', and '0' are converted to their corresponding boolean values when the type is set to 'boolean'.

```typescript
    it.concurrent('should handle object type variables', () => {
      expect(VariableManager.parseInputForStorage('{"foo":"bar"}', 'object')).toEqual({
        foo: 'bar',
      })
      expect(VariableManager.parseInputForStorage('invalid json', 'object')).toEqual({})
      expect(VariableManager.parseInputForStorage('42', 'object')).toEqual({ value: '42' })
    })
```

*   This test case confirms that the `parseInputForStorage` function correctly parses JSON strings into JavaScript objects when the type is 'object'. It checks that valid JSON is parsed correctly and that invalid JSON results in an empty object. Also, it checks to see if a non-JSON type value is wrapped into an object and assigned to the `value` property.

```typescript
    it.concurrent('should handle array type variables', () => {
      expect(VariableManager.parseInputForStorage('[1,2,3]', 'array')).toEqual([1, 2, 3])
      expect(VariableManager.parseInputForStorage('invalid json', 'array')).toEqual([])
      expect(VariableManager.parseInputForStorage('42', 'array')).toEqual(['42'])
    })
```

*   This test case verifies that the `parseInputForStorage` function properly parses JSON arrays into JavaScript arrays when the type is 'array'. It tests both valid JSON arrays and invalid JSON, ensuring that invalid JSON results in an empty array. It also tests to see if a non-JSON type value is wrapped into an array.

```typescript
    it.concurrent('should handle empty values', () => {
      expect(VariableManager.parseInputForStorage('', 'string')).toBe('')
      expect(VariableManager.parseInputForStorage('', 'number')).toBe('')
      expect(VariableManager.parseInputForStorage(null as any, 'boolean')).toBe('')
      expect(VariableManager.parseInputForStorage(undefined as any, 'object')).toBe('')
    })
```

*   This test case checks how the `parseInputForStorage` function handles empty or null/undefined input values for different variable types. It asserts that empty strings are returned for 'string' and 'number' types, and empty strings for `null` boolean and `undefined` object types.

```typescript
  })

  describe('formatForEditor', () => {
    // ... similar tests for formatForEditor
  })

  describe('resolveForExecution', () => {
    // ... similar tests for resolveForExecution
  })

  describe('formatForTemplateInterpolation', () => {
    // ... similar tests for formatForTemplateInterpolation
  })

  describe('formatForCodeContext', () => {
    // ... similar tests for formatForCodeContext
  })
})
```

*   The remaining `describe` blocks follow a similar structure, testing the `formatForEditor`, `resolveForExecution`, `formatForTemplateInterpolation` and `formatForCodeContext` methods with various input values and types.  The tests assert that these methods correctly format or convert the input into the expected output based on the variable type.

### Summary

In summary, this file is a comprehensive set of unit tests that thoroughly validates the behavior of the `VariableManager` class.  It ensures that the class correctly handles different data types and performs the necessary conversions and formatting for storage, editor display, and runtime execution, template interpolation and code context.  The tests cover a wide range of scenarios, including positive cases, edge cases, and error handling, making the `VariableManager` more robust and reliable. The tests use `vitest`, a testing framework, and its `describe`, `it`, and `expect` functions to structure and assert the correctness of the `VariableManager`'s methods.
