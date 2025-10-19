```typescript
import { createLogger } from '@/lib/logs/console/logger'
import { uploadExecutionFile } from '@/lib/workflows/execution-file-storage'
import type { UserFile } from '@/executor/types'

const logger = createLogger('WebhookAttachmentProcessor')

export interface WebhookAttachment {
  name: string
  data: Buffer
  contentType: string
  size: number
}

/**
 * Processes webhook/trigger attachments and converts them to UserFile objects.
 * This enables triggers to include file attachments that get automatically stored
 * in the execution filesystem and made available as UserFile objects for workflow use.
 */
export class WebhookAttachmentProcessor {
  /**
   * Process attachments and upload them to execution storage
   */
  static async processAttachments(
    attachments: WebhookAttachment[],
    executionContext: {
      workspaceId: string
      workflowId: string
      executionId: string
      requestId: string
    }
  ): Promise<UserFile[]> {
    if (!attachments || attachments.length === 0) {
      return []
    }

    logger.info(
      `[${executionContext.requestId}] Processing ${attachments.length} attachments for execution ${executionContext.executionId}`
    )

    const processedFiles: UserFile[] = []

    for (const attachment of attachments) {
      try {
        const userFile = await WebhookAttachmentProcessor.processAttachment(
          attachment,
          executionContext
        )
        processedFiles.push(userFile)
      } catch (error) {
        logger.error(
          `[${executionContext.requestId}] Error processing attachment '${attachment.name}':`,
          error
        )
        // Continue with other attachments rather than failing the entire request
      }
    }

    logger.info(
      `[${executionContext.requestId}] Successfully processed ${processedFiles.length}/${attachments.length} attachments`
    )

    return processedFiles
  }

  /**
   * Process a single attachment and upload to execution storage
   */
  private static async processAttachment(
    attachment: WebhookAttachment,
    executionContext: {
      workspaceId: string
      workflowId: string
      executionId: string
      requestId: string
    }
  ): Promise<UserFile> {
    // Convert data to Buffer (handle both raw and serialized formats)
    let buffer: Buffer
    const data = attachment.data as any

    if (Buffer.isBuffer(data)) {
      // Raw Buffer (e.g., Teams in-memory processing)
      buffer = data
    } else if (
      data &&
      typeof data === 'object' &&
      data.type === 'Buffer' &&
      Array.isArray(data.data)
    ) {
      // Serialized Buffer (e.g., Gmail/Outlook after JSON roundtrip)
      buffer = Buffer.from(data.data)
    } else {
      throw new Error(`Attachment '${attachment.name}' data must be a Buffer or serialized Buffer`)
    }

    if (buffer.length === 0) {
      throw new Error(`Attachment '${attachment.name}' has zero bytes`)
    }

    logger.info(
      `[${executionContext.requestId}] Uploading attachment '${attachment.name}' (${attachment.size} bytes, ${attachment.contentType})`
    )

    // Upload to execution storage
    const userFile = await uploadExecutionFile(
      executionContext,
      buffer,
      attachment.name,
      attachment.contentType
    )

    logger.info(
      `[${executionContext.requestId}] Successfully stored attachment '${attachment.name}' with key: ${userFile.key}`
    )

    return userFile
  }
}
```

## Explanation:

This TypeScript code defines a utility class called `WebhookAttachmentProcessor` responsible for handling file attachments that come from webhooks or other trigger mechanisms within a workflow execution environment. It takes these attachments, which are typically sent along with webhook requests, and converts them into `UserFile` objects.  These `UserFile` objects can then be easily accessed and used within the workflow itself.

Here's a breakdown of each part of the code:

**1. Imports:**

```typescript
import { createLogger } from '@/lib/logs/console/logger'
import { uploadExecutionFile } from '@/lib/workflows/execution-file-storage'
import type { UserFile } from '@/executor/types'
```

*   `createLogger`: Imports a function to create a logger instance for this module.  This logger is used for debugging and monitoring the attachment processing.  The `@` symbol indicates that this path is likely configured through the TypeScript compiler options and refers to a base directory in the project.
*   `uploadExecutionFile`: Imports a function that handles the actual uploading of the attachment's data to a persistent storage location associated with the workflow execution.
*   `UserFile`: Imports a *type* definition for `UserFile`. This likely defines the structure of the object that represents a file stored within the workflow execution context (e.g., it might contain the file's key, name, size, and content type).

**2. Logger Instance:**

```typescript
const logger = createLogger('WebhookAttachmentProcessor')
```

*   Creates a logger instance using the imported `createLogger` function.  The string `'WebhookAttachmentProcessor'` is used as a category or label for the logger, making it easier to filter and identify log messages originating from this specific module.

**3. `WebhookAttachment` Interface:**

```typescript
export interface WebhookAttachment {
  name: string
  data: Buffer
  contentType: string
  size: number
}
```

*   Defines an interface that describes the structure of a webhook attachment object.  It specifies that each attachment has the following properties:
    *   `name`: The name of the file (e.g., "report.pdf").
    *   `data`: The actual file data, represented as a `Buffer`.  A `Buffer` is a Node.js class that represents a fixed-size chunk of memory and is commonly used to work with binary data.
    *   `contentType`: The MIME type of the file (e.g., "application/pdf").
    *   `size`:  The size of the file in bytes.

**4. `WebhookAttachmentProcessor` Class:**

```typescript
/**
 * Processes webhook/trigger attachments and converts them to UserFile objects.
 * This enables triggers to include file attachments that get automatically stored
 * in the execution filesystem and made available as UserFile objects for workflow use.
 */
export class WebhookAttachmentProcessor {
  // ... methods ...
}
```

*   Defines the `WebhookAttachmentProcessor` class.  The JSDoc comment clearly explains the purpose of this class: to handle webhook attachments and make them available as `UserFile` objects within a workflow.

**5. `processAttachments` Method:**

```typescript
  /**
   * Process attachments and upload them to execution storage
   */
  static async processAttachments(
    attachments: WebhookAttachment[],
    executionContext: {
      workspaceId: string
      workflowId: string
      executionId: string
      requestId: string
    }
  ): Promise<UserFile[]> {
    if (!attachments || attachments.length === 0) {
      return []
    }

    logger.info(
      `[${executionContext.requestId}] Processing ${attachments.length} attachments for execution ${executionContext.executionId}`
    )

    const processedFiles: UserFile[] = []

    for (const attachment of attachments) {
      try {
        const userFile = await WebhookAttachmentProcessor.processAttachment(
          attachment,
          executionContext
        )
        processedFiles.push(userFile)
      } catch (error) {
        logger.error(
          `[${executionContext.requestId}] Error processing attachment '${attachment.name}':`,
          error
        )
        // Continue with other attachments rather than failing the entire request
      }
    }

    logger.info(
      `[${executionContext.requestId}] Successfully processed ${processedFiles.length}/${attachments.length} attachments`
    )

    return processedFiles
  }
```

*   This is the main entry point for processing multiple attachments.
    *   It's a `static` method, meaning it can be called directly on the `WebhookAttachmentProcessor` class (e.g., `WebhookAttachmentProcessor.processAttachments(...)`) without needing to create an instance of the class.
    *   It's an `async` method, indicating that it performs asynchronous operations (like uploading files).
    *   **Parameters:**
        *   `attachments`:  An array of `WebhookAttachment` objects to process.
        *   `executionContext`:  An object containing context information about the workflow execution.  This includes:
            *   `workspaceId`:  The ID of the workspace the workflow belongs to.
            *   `workflowId`:  The ID of the workflow.
            *   `executionId`:  The ID of the specific workflow execution.
            *   `requestId`: A unique identifier for the incoming request, used for tracing logs.
    *   **Logic:**
        *   **Empty Check:** It first checks if the `attachments` array is empty or null. If so, it immediately returns an empty array, avoiding unnecessary processing.
        *   **Logging:** It logs an informational message indicating that it's starting to process the attachments, including the number of attachments and the execution ID.  The `requestId` is included in the log message for easier tracing.
        *   **Iteration and Error Handling:** It iterates through the `attachments` array using a `for...of` loop.  For each attachment:
            *   It calls the `WebhookAttachmentProcessor.processAttachment` method (described below) to process the individual attachment.
            *   It wraps the call to `processAttachment` in a `try...catch` block to handle potential errors during the processing of a single attachment. If an error occurs:
                *   It logs an error message, including the attachment's name and the error details.
                *   Critically, it *continues* to the next attachment in the loop.  This prevents a single failed attachment from stopping the entire process.  This is a good example of robust error handling.
        *   **Success Logging:** After processing all attachments (or encountering errors), it logs a summary message indicating how many attachments were successfully processed.
        *   **Return Value:** It returns an array of `UserFile` objects representing the successfully processed attachments.

**6. `processAttachment` Method:**

```typescript
  /**
   * Process a single attachment and upload to execution storage
   */
  private static async processAttachment(
    attachment: WebhookAttachment,
    executionContext: {
      workspaceId: string
      workflowId: string
      executionId: string
      requestId: string
    }
  ): Promise<UserFile> {
    // Convert data to Buffer (handle both raw and serialized formats)
    let buffer: Buffer
    const data = attachment.data as any

    if (Buffer.isBuffer(data)) {
      // Raw Buffer (e.g., Teams in-memory processing)
      buffer = data
    } else if (
      data &&
      typeof data === 'object' &&
      data.type === 'Buffer' &&
      Array.isArray(data.data)
    ) {
      // Serialized Buffer (e.g., Gmail/Outlook after JSON roundtrip)
      buffer = Buffer.from(data.data)
    } else {
      throw new Error(`Attachment '${attachment.name}' data must be a Buffer or serialized Buffer`)
    }

    if (buffer.length === 0) {
      throw new Error(`Attachment '${attachment.name}' has zero bytes`)
    }

    logger.info(
      `[${executionContext.requestId}] Uploading attachment '${attachment.name}' (${attachment.size} bytes, ${attachment.contentType})`
    )

    // Upload to execution storage
    const userFile = await uploadExecutionFile(
      executionContext,
      buffer,
      attachment.name,
      attachment.contentType
    )

    logger.info(
      `[${executionContext.requestId}] Successfully stored attachment '${attachment.name}' with key: ${userFile.key}`
    )

    return userFile
  }
```

*   This method is responsible for processing a *single* `WebhookAttachment`.
    *   It's a `private static` method, meaning it can only be called from within the `WebhookAttachmentProcessor` class and doesn't require an instance of the class.
    *   It's an `async` method.
    *   **Parameters:**
        *   `attachment`: The `WebhookAttachment` object to process.
        *   `executionContext`: The same execution context object as in `processAttachments`.
    *   **Logic:**
        *   **Buffer Conversion:**  This is the most complex part of the method. The code anticipates that the `attachment.data` might be in one of two formats:
            *   **Raw Buffer:**  The `data` property is already a `Buffer` object (e.g., when the attachment is directly available in memory, as might be the case with Microsoft Teams).
            *   **Serialized Buffer:**  The `data` property is a JavaScript object that *represents* a Buffer. This can happen when the attachment data has been serialized to JSON and then parsed back into a JavaScript object (e.g., when attachments come from Gmail or Outlook via webhooks).  The object has a `type` property equal to `"Buffer"` and a `data` property that is an array of numbers (representing the byte values).
            *   The code uses `Buffer.isBuffer(data)` to check if it's a raw Buffer.  If not, it checks if it's a serialized Buffer by inspecting the `type` and `data` properties.
            *   If the data is in the serialized format, `Buffer.from(data.data)` is used to reconstruct a `Buffer` object from the array of byte values.
            *   If the `data` property is in neither of the expected formats, the code throws an error.
        *   **Empty Buffer Check:** It checks if the resulting `buffer` has a length of zero. If so, it throws an error, as an empty file is not valid.
        *   **Logging:** It logs an informational message indicating that it's uploading the attachment, including its name, size, and content type.
        *   **Upload:** It calls the `uploadExecutionFile` function (imported at the top of the file) to upload the `buffer` to persistent storage.  It passes the `executionContext`, the `buffer`, the `attachment.name`, and the `attachment.contentType` to this function.
        *   **Success Logging:** After the upload is complete, it logs a success message, including the attachment's name and the key (likely a unique identifier) assigned to the file in storage.
        *   **Return Value:** It returns the `UserFile` object that `uploadExecutionFile` returns. This object represents the file that has been uploaded to the execution storage and contains information like the storage key.

## Simplifications and Key Takeaways:

*   **Simplified Logic:** The key simplification is the handling of different `Buffer` formats. The code explicitly checks for and handles both raw `Buffer` objects and serialized `Buffer` objects, preventing errors when dealing with attachments from different sources.
*   **Error Handling:**  The code includes robust error handling:
    *   It checks for invalid or empty data.
    *   It uses `try...catch` blocks to prevent individual attachment processing failures from crashing the entire process.
*   **Logging:** The use of logging throughout the code makes it easier to debug and monitor the attachment processing. The logs include contextual information like the `requestId`, execution ID, and attachment names.
*   **Clear Separation of Concerns:** The code is well-structured, with a clear separation of concerns. The `processAttachments` method handles the overall orchestration of processing multiple attachments, while the `processAttachment` method handles the processing of a single attachment. The `uploadExecutionFile` function handles the actual file upload.

In summary, this code provides a robust and well-documented solution for handling webhook attachments in a workflow execution environment. It handles different data formats, includes thorough error handling and logging, and is designed to be easily maintainable and extensible.
