```typescript
import path from 'path'

// Defines the maximum allowed file size for uploaded documents in bytes (100MB).
export const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB

// Defines a list of supported document extensions. Using `as const` creates a tuple type,
// ensuring that the array cannot be modified and its elements are treated as literal types.
export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  'pdf',
  'csv',
  'doc',
  'docx',
  'txt',
  'md',
  'xlsx',
  'xls',
  'ppt',
  'pptx',
  'html',
  'htm',
  'json',
  'yaml',
  'yml',
] as const

// Creates a type `SupportedDocumentExtension` by extracting the union of string literal types from
// the `SUPPORTED_DOCUMENT_EXTENSIONS` array. This ensures type safety when working with file extensions.
export type SupportedDocumentExtension = (typeof SUPPORTED_DOCUMENT_EXTENSIONS)[number]

// Defines a mapping between supported document extensions and their corresponding MIME types.
// Each extension is associated with an array of possible MIME types.  This is used to validate files.
export const SUPPORTED_MIME_TYPES: Record<SupportedDocumentExtension, string[]> = {
  pdf: ['application/pdf', 'application/x-pdf'],
  csv: ['text/csv', 'application/csv', 'text/comma-separated-values'],
  doc: ['application/msword', 'application/doc', 'application/vnd.ms-word'],
  docx: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream',
  ],
  txt: ['text/plain', 'text/x-plain', 'application/txt'],
  md: ['text/markdown', 'text/x-markdown', 'text/plain', 'application/markdown'],
  xlsx: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
  ],
  xls: [
    'application/vnd.ms-excel',
    'application/excel',
    'application/x-excel',
    'application/x-msexcel',
  ],
  ppt: ['application/vnd.ms-powerpoint', 'application/powerpoint', 'application/x-mspowerpoint'],
  pptx: [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/octet-stream',
  ],
  html: ['text/html', 'application/xhtml+xml'],
  htm: ['text/html', 'application/xhtml+xml'],
  json: ['application/json', 'text/json', 'application/x-json'],
  yaml: ['text/yaml', 'text/x-yaml', 'application/yaml', 'application/x-yaml'],
  yml: ['text/yaml', 'text/x-yaml', 'application/yaml', 'application/x-yaml'],
}

// Creates an array of all supported MIME types by extracting the values (arrays of MIME types) from
// `SUPPORTED_MIME_TYPES` and then flattening the resulting array of arrays into a single array.
export const ACCEPTED_FILE_TYPES = Object.values(SUPPORTED_MIME_TYPES).flat()

// Creates an array of accepted file extensions by mapping over the `SUPPORTED_DOCUMENT_EXTENSIONS` array
// and prepending a dot (".") to each extension.
export const ACCEPTED_FILE_EXTENSIONS = SUPPORTED_DOCUMENT_EXTENSIONS.map((ext) => `.${ext}`)

// Creates a comma-separated string of all accepted file types (MIME types and extensions). This string
// can be used in the `accept` attribute of an HTML input element to restrict the types of files that the user can select.
export const ACCEPT_ATTRIBUTE = [...ACCEPTED_FILE_TYPES, ...ACCEPTED_FILE_EXTENSIONS].join(',')

// Defines an interface for file validation error objects. This interface specifies the `code` (either
// `UNSUPPORTED_FILE_TYPE` or `MIME_TYPE_MISMATCH`), a `message` describing the error, and an array of
// `supportedTypes` to guide the user on allowed types.
export interface FileValidationError {
  code: 'UNSUPPORTED_FILE_TYPE' | 'MIME_TYPE_MISMATCH'
  message: string
  supportedTypes: string[]
}

/**
 * Validates if a file type is supported for document processing.  It checks both the extension and the mime type
 * @param fileName The name of the file being validated.
 * @param mimeType The MIME type of the file being validated.
 * @returns A `FileValidationError` object if the file type is not supported, or `null` if the file type is valid.
 */
export function validateFileType(fileName: string, mimeType: string): FileValidationError | null {
  // Extracts the file extension from the file name, converts it to lowercase, and removes the leading dot.
  const extension = path.extname(fileName).toLowerCase().substring(1) as SupportedDocumentExtension

  // Checks if the extracted extension is included in the list of supported document extensions.
  if (!SUPPORTED_DOCUMENT_EXTENSIONS.includes(extension)) {
    // If the extension is not supported, returns a `FileValidationError` object indicating that the file type is not supported.
    return {
      code: 'UNSUPPORTED_FILE_TYPE',
      message: `Unsupported file type: ${extension}. Supported types are: ${SUPPORTED_DOCUMENT_EXTENSIONS.join(', ')}`,
      supportedTypes: [...SUPPORTED_DOCUMENT_EXTENSIONS],
    }
  }

  // Retrieves the array of allowed MIME types for the extracted extension from the `SUPPORTED_MIME_TYPES` object.
  const allowedMimeTypes = SUPPORTED_MIME_TYPES[extension]
  // Checks if the provided MIME type is included in the array of allowed MIME types for the extension.
  if (!allowedMimeTypes.includes(mimeType)) {
    // If the MIME type is not allowed, returns a `FileValidationError` object indicating a MIME type mismatch.
    return {
      code: 'MIME_TYPE_MISMATCH',
      message: `MIME type ${mimeType} does not match file extension ${extension}. Expected: ${allowedMimeTypes.join(', ')}`,
      supportedTypes: allowedMimeTypes,
    }
  }

  // If the extension is supported and the MIME type matches, returns `null` to indicate that the file is valid.
  return null
}

/**
 * Checks if a given file extension is supported.
 * @param extension The file extension to check (e.g., "pdf", "docx").
 * @returns `true` if the extension is supported, `false` otherwise.  It also serves as a type predicate.
 */
export function isSupportedExtension(extension: string): extension is SupportedDocumentExtension {
  // Converts the extension to lowercase and checks if it exists in the `SUPPORTED_DOCUMENT_EXTENSIONS` array.
  return SUPPORTED_DOCUMENT_EXTENSIONS.includes(
    extension.toLowerCase() as SupportedDocumentExtension
  )
}

/**
 * Gets the supported MIME types for a given file extension.
 * @param extension The file extension to get MIME types for (e.g., "pdf", "docx").
 * @returns An array of supported MIME types for the given extension.  Returns an empty array if the extension isn't supported.
 */
export function getSupportedMimeTypes(extension: string): string[] {
  // Checks if the provided extension is a supported extension using the `isSupportedExtension` function.
  if (isSupportedExtension(extension)) {
    // If the extension is supported, retrieves the corresponding array of MIME types from the `SUPPORTED_MIME_TYPES` object.
    return SUPPORTED_MIME_TYPES[extension as SupportedDocumentExtension]
  }
  // If the extension is not supported, returns an empty array.
  return []
}
```

**Purpose of this file:**

This TypeScript file defines constants, types, and functions related to validating and handling supported document file types.  It's designed to ensure that an application only processes files of specific, pre-approved formats, enhancing security and preventing unexpected behavior. The code manages:

1.  **Allowed File Types:**  Defines which document extensions and MIME types are acceptable.
2.  **File Size Limit:** Establishes a maximum size for uploaded files.
3.  **Validation:** Provides functions to check if a file's extension and MIME type are supported.
4.  **Type Safety:**  Uses TypeScript's type system to ensure correct handling of file extensions and MIME types.

**Simplifying Complex Logic:**

*   **`as const`:** This tells TypeScript to infer the narrowest possible types for the `SUPPORTED_DOCUMENT_EXTENSIONS` array.  Without it, the elements would just be inferred as `string`, losing the specific literal types (`"pdf"`, `"docx"`, etc.). This is crucial for type safety when using these extensions elsewhere in the code.

*   **`Record<...>`:** The `Record` type is used to create a mapping between `SupportedDocumentExtension` and an array of strings. This makes the `SUPPORTED_MIME_TYPES` object strongly typed and easy to look up by extension.

*   **Type Predicate:** `isSupportedExtension` is a type predicate. This means that when it returns `true`, TypeScript knows that the `extension` parameter is of type `SupportedDocumentExtension`. This is used in `getSupportedMimeTypes` to safely access the `SUPPORTED_MIME_TYPES` object.

**Line-by-line explanation:**

*   **`import path from 'path'`:** Imports the `path` module, which provides utilities for working with file and directory paths.

*   **`export const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB`:** Defines a constant `MAX_FILE_SIZE` representing the maximum allowed file size in bytes (100MB). `export` makes it accessible from other modules.

*   **`export const SUPPORTED_DOCUMENT_EXTENSIONS = [...] as const`:** Defines a constant array `SUPPORTED_DOCUMENT_EXTENSIONS` containing the supported file extensions. The `as const` assertion makes it a read-only tuple, ensuring type safety.

*   **`export type SupportedDocumentExtension = (typeof SUPPORTED_DOCUMENT_EXTENSIONS)[number]`:** Creates a type `SupportedDocumentExtension` that is a union of all the string literal types in the `SUPPORTED_DOCUMENT_EXTENSIONS` array (e.g., `"pdf" | "csv" | ...`).

*   **`export const SUPPORTED_MIME_TYPES: Record<SupportedDocumentExtension, string[]> = { ... }`:** Defines a constant object `SUPPORTED_MIME_TYPES` that maps each supported file extension to an array of its corresponding MIME types.  The `Record` type enforces type safety, ensuring that keys are `SupportedDocumentExtension` and values are `string[]`.

*   **`export const ACCEPTED_FILE_TYPES = Object.values(SUPPORTED_MIME_TYPES).flat()`:**  Extracts all the MIME type arrays from `SUPPORTED_MIME_TYPES` using `Object.values()`, then flattens the resulting array of arrays into a single array of MIME types.

*   **`export const ACCEPTED_FILE_EXTENSIONS = SUPPORTED_DOCUMENT_EXTENSIONS.map((ext) => \`.\${ext}\`)`:**  Creates an array of accepted file extensions by adding a dot (`.`) prefix to each extension in the `SUPPORTED_DOCUMENT_EXTENSIONS` array.

*   **`export const ACCEPT_ATTRIBUTE = [...ACCEPTED_FILE_TYPES, ...ACCEPTED_FILE_EXTENSIONS].join(',')`:**  Combines the `ACCEPTED_FILE_TYPES` and `ACCEPTED_FILE_EXTENSIONS` arrays into a single array and then joins the elements into a comma-separated string. This string can be used as the value of the `accept` attribute in an HTML `<input type="file">` element.

*   **`export interface FileValidationError { ... }`:** Defines an interface `FileValidationError` to represent validation errors. It includes a `code` indicating the type of error, a `message` describing the error, and `supportedTypes` listing the allowed file types.

*   **`export function validateFileType(fileName: string, mimeType: string): FileValidationError | null { ... }`:**  Validates a file based on its name and MIME type.
    *   It extracts the file extension from the filename.
    *   It checks if the extension is in the `SUPPORTED_DOCUMENT_EXTENSIONS` list.  If not, it returns an `UNSUPPORTED_FILE_TYPE` error.
    *   It retrieves the allowed MIME types for the extension from `SUPPORTED_MIME_TYPES`.
    *   It checks if the provided MIME type is in the allowed MIME types list. If not, it returns a `MIME_TYPE_MISMATCH` error.
    *   If both checks pass, it returns `null`, indicating that the file is valid.

*   **`export function isSupportedExtension(extension: string): extension is SupportedDocumentExtension { ... }`:** Checks if the provided `extension` is a supported extension. The `extension is SupportedDocumentExtension` part is a *type predicate*.  It tells TypeScript that if the function returns `true`, then the `extension` argument is definitely of type `SupportedDocumentExtension`.

*   **`export function getSupportedMimeTypes(extension: string): string[] { ... }`:** Retrieves the supported MIME types for a given extension.
    *   It uses `isSupportedExtension` to check if the extension is supported.
    *   If supported, it retrieves the corresponding MIME types from `SUPPORTED_MIME_TYPES`.
    *   If not supported, it returns an empty array.
