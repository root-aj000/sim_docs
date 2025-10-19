```typescript
import { normalizeBlockName } from '@/stores/workflows/utils'

// Define a set of prefixes that indicate system-level references.
// This is used to differentiate between references to user-defined blocks and system-defined constructs.
export const SYSTEM_REFERENCE_PREFIXES = new Set(['start', 'loop', 'parallel', 'variable'])

// Define a regular expression that matches invalid characters within a reference segment.
// This helps in validating the structure of a reference and preventing errors.
const INVALID_REFERENCE_CHARS = /[+*/=<>!]/

/**
 * Checks if a given string segment is likely a valid reference.
 * A reference segment is expected to be enclosed in angle brackets (< and >) and follow specific rules.
 *
 * @param {string} segment - The string segment to check.
 * @returns {boolean} - True if the segment is likely a valid reference, false otherwise.
 */
export function isLikelyReferenceSegment(segment: string): boolean {
  // Quick check: Must start with "<" and end with ">". If not, it's not a reference.
  if (!segment.startsWith('<') || !segment.endsWith('>')) {
    return false
  }

  // Extract the content inside the angle brackets.
  const inner = segment.slice(1, -1)

  // Disallow references that start with a space
  if (inner.startsWith(' ')) {
    return false
  }

  // Disallow references that only consist of comparison/assignment operators with whitespace
  if (inner.match(/^\s*[<>=!]+\s*$/) || inner.match(/\s[<>=!]+\s/)) {
    return false
  }

  // Disallow references that start with comparison/assignment operators and whitespace
  if (inner.match(/^[<>=!]+\s/)) {
    return false
  }

  // Handle references containing a dot ('.'), which separates the prefix and suffix
  if (inner.includes('.')) {
    const dotIndex = inner.indexOf('.')
    const beforeDot = inner.substring(0, dotIndex)
    const afterDot = inner.substring(dotIndex + 1)

    // The part after the dot cannot contain spaces
    if (afterDot.includes(' ')) {
      return false
    }

    // The parts before and after the dot cannot contain invalid characters
    if (INVALID_REFERENCE_CHARS.test(beforeDot) || INVALID_REFERENCE_CHARS.test(afterDot)) {
      return false
    }
  } else if (INVALID_REFERENCE_CHARS.test(inner) || inner.match(/^\d/) || inner.match(/\s\d/)) {
    // If there's no dot, the entire inner content:
    // 1. Cannot contain invalid characters.
    // 2. Cannot start with a digit.
    // 3. Cannot contain a space followed by a digit.
    return false
  }

  // If all checks pass, it's likely a valid reference segment.
  return true
}

/**
 * Extracts reference prefixes from a given string.
 * It identifies segments enclosed in angle brackets that are likely references and extracts their prefixes.
 *
 * @param {string} value - The string to extract prefixes from.
 * @returns {Array<{ raw: string; prefix: string }>} - An array of objects, each containing the raw reference string and its normalized prefix.
 */
export function extractReferencePrefixes(value: string): Array<{ raw: string; prefix: string }> {
  // Handle null or non-string input by returning an empty array.
  if (!value || typeof value !== 'string') {
    return []
  }

  // Find all segments enclosed in angle brackets.
  const matches = value.match(/<[^>]+>/g)

  // If no matches are found, return an empty array.
  if (!matches) {
    return []
  }

  // Initialize an array to store the extracted references.
  const references: Array<{ raw: string; prefix: string }> = []

  // Iterate over the found matches.
  for (const match of matches) {
    // Check if the current match is likely a valid reference segment.
    if (!isLikelyReferenceSegment(match)) {
      continue // Skip to the next match if it's not a valid reference.
    }

    // Extract the content inside the angle brackets.
    const inner = match.slice(1, -1)

    // Split the inner content by the first dot ('.') to get the raw prefix.
    const [rawPrefix] = inner.split('.')

    // If there's no prefix (e.g., "<.>"), skip to the next match.
    if (!rawPrefix) {
      continue
    }

    // Normalize the raw prefix using the 'normalizeBlockName' function.
    const normalized = normalizeBlockName(rawPrefix)

    // Add the raw reference and its normalized prefix to the 'references' array.
    references.push({ raw: match, prefix: normalized })
  }

  // Return the array of extracted references.
  return references
}
```

**Explanation:**

**Purpose of this file:**

This file provides utility functions for identifying and extracting reference prefixes from strings.  These references are assumed to be within a specific format, enclosed in angle brackets (`<` and `>`), and used within a workflow system. The core functionalities are:

1.  `isLikelyReferenceSegment`: Determines whether a given string segment is likely a valid reference based on its format and content.
2.  `extractReferencePrefixes`: Extracts all reference prefixes from a given string, validates them using `isLikelyReferenceSegment`, normalizes the extracted prefixes, and returns them in a structured format.

These functions are likely used to parse and process strings that represent workflows or expressions containing references to other parts of the workflow, such as variables, blocks, or system components.

**Detailed Breakdown:**

1.  **Imports:**

    ```typescript
    import { normalizeBlockName } from '@/stores/workflows/utils'
    ```

    *   Imports the `normalizeBlockName` function from a specific utility file within the project. This function is responsible for normalizing block names, likely converting them to a standard format (e.g., lowercase, removing special characters). It's crucial for ensuring consistency and accurate matching of references.

2.  **`SYSTEM_REFERENCE_PREFIXES`:**

    ```typescript
    export const SYSTEM_REFERENCE_PREFIXES = new Set(['start', 'loop', 'parallel', 'variable'])
    ```

    *   Defines a constant `SYSTEM_REFERENCE_PREFIXES` as a `Set` of strings.
    *   This set contains prefixes that identify references to system-level components (e.g., 'start', 'loop', 'parallel', 'variable').
    *   Using a `Set` provides efficient lookups (using `has()` method).
    *   This likely allows differentiating between references to user-defined components and those built into the system.

3.  **`INVALID_REFERENCE_CHARS`:**

    ```typescript
    const INVALID_REFERENCE_CHARS = /[+*/=<>!]/
    ```

    *   Defines a constant regular expression `INVALID_REFERENCE_CHARS`.
    *   This regex matches characters that are considered invalid within a reference segment.  These characters are likely operators that could cause ambiguity or security issues if allowed directly within reference names.

4.  **`isLikelyReferenceSegment(segment: string): boolean`:**

    *   This function takes a string `segment` as input and returns `true` if the segment is likely a valid reference, `false` otherwise.
    *   **Initial Checks:**
        *   `if (!segment.startsWith('<') || !segment.endsWith('>')) { return false }`:  Quickly checks if the segment starts with `<` and ends with `>`.  If not, it cannot be a reference.

    *   **Inner Content Extraction:**
        *   `const inner = segment.slice(1, -1)`: Extracts the content between the angle brackets.

    *   **Whitespace and Operator Checks:**
        *   `if (inner.startsWith(' ')) { return false }`: Prevents references starting with a space.
        *   `if (inner.match(/^\s*[<>=!]+\s*$/) || inner.match(/\s[<>=!]+\s/)) { return false }`: Prevents references that *only* contain comparison operators and whitespace.
        *   `if (inner.match(/^[<>=!]+\s/)) { return false }`: Prevents references that *start* with comparison operators.

    *   **Dot-Separated Prefix and Suffix Handling:**
        *   `if (inner.includes('.')) { ... }`:  Handles cases where the reference contains a dot ('.'). This likely separates a prefix from a suffix (e.g., `<block.variable>`).
        *   `const dotIndex = inner.indexOf('.')`: Finds the index of the dot.
        *   `const beforeDot = inner.substring(0, dotIndex)`: Extracts the part before the dot.
        *   `const afterDot = inner.substring(dotIndex + 1)`: Extracts the part after the dot.
        *   `if (afterDot.includes(' ')) { return false }`: After the dot, disallows whitespace.
        *   `if (INVALID_REFERENCE_CHARS.test(beforeDot) || INVALID_REFERENCE_CHARS.test(afterDot)) { return false }`: Prevents invalid characters in either the prefix or suffix.

    *   **No-Dot Handling:**
        *   `else if (INVALID_REFERENCE_CHARS.test(inner) || inner.match(/^\d/) || inner.match(/\s\d/)) { return false }`: If there's no dot, the entire inner content cannot:
            *   Contain invalid characters.
            *   Start with a digit.
            *   Contain a space followed by a digit.
    *   **Return `true`:** If all checks pass, the segment is considered a likely reference.

5.  **`extractReferencePrefixes(value: string): Array<{ raw: string; prefix: string }>`:**

    *   This function takes a string `value` as input and extracts all likely reference prefixes from it.  It returns an array of objects, where each object has the `raw` (original reference string) and `prefix` (normalized prefix) properties.
    *   **Input Validation:**
        *   `if (!value || typeof value !== 'string') { return [] }`: Handles cases where the input is null, undefined, or not a string. Returns an empty array to avoid errors.

    *   **Find All Potential References:**
        *   `const matches = value.match(/<[^>]+>/g)`: Uses a regular expression to find all substrings that match the `<...>` pattern. The `g` flag ensures that *all* occurrences are found, not just the first.
        *   `if (!matches) { return [] }`: If no matches are found, it means there are no potential references in the input string, so it returns an empty array.

    *   **Iterate and Validate:**
        *   `const references: Array<{ raw: string; prefix: string }> = []`: Initializes an empty array to store the extracted references.
        *   `for (const match of matches) { ... }`: Loops through each potential reference found in the `matches` array.
        *   `if (!isLikelyReferenceSegment(match)) { continue }`: Calls `isLikelyReferenceSegment` to validate the current match. If it's not a valid reference, the loop continues to the next match.
        *   `const inner = match.slice(1, -1)`: Extracts the content inside the angle brackets.
        *   `const [rawPrefix] = inner.split('.')`: Splits the inner content by the first dot ('.') to extract the raw prefix. The `[rawPrefix]` syntax uses destructuring assignment to get only the first element of the resulting array (the part before the dot).
        *   `if (!rawPrefix) { continue }`: If there's no prefix (e.g., if the inner content is just "."), the loop continues.
        *   `const normalized = normalizeBlockName(rawPrefix)`: Normalizes the raw prefix using the `normalizeBlockName` function (imported earlier).  This ensures consistency in reference names.
        *   `references.push({ raw: match, prefix: normalized })`: Creates an object containing the `raw` (original reference string) and the `prefix` (normalized prefix) and adds it to the `references` array.

    *   **Return Result:**
        *   `return references`: Returns the `references` array, which now contains all the extracted and validated reference prefixes.

**Summary & Key Concepts:**

*   **Reference Identification:** The code focuses on identifying and extracting strings that are likely to be references within a workflow or similar system.  These references are expected to follow a specific syntax (`<...>`).
*   **Validation:** The `isLikelyReferenceSegment` function performs extensive validation to ensure that the identified segments are valid references and don't contain potentially harmful or ambiguous content.
*   **Normalization:**  The `normalizeBlockName` function (imported from another file) is used to standardize the extracted prefixes, making them consistent for later processing or lookup.
*   **Error Handling:** The code includes checks for null or invalid input and handles cases where no references are found.
*   **Data Structure:** The `extractReferencePrefixes` function returns an array of objects, providing both the original reference string and its normalized prefix.  This makes it easy to use the extracted information in subsequent steps.
*   **Regular Expressions:** Regular expressions are used extensively for pattern matching, making the code concise and efficient for identifying and validating reference segments.
*   **Modularity:** The code is well-structured and uses separate functions for different tasks (validation, extraction, normalization), making it easier to understand, maintain, and test.
