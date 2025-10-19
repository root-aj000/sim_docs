```typescript
/**
 * Specialized storage client for workflow execution files
 * Uses dedicated S3 bucket: sim-execution-files
 * Directory structure: workspace_id/workflow_id/execution_id/filename
 */

import { createLogger } from '@/lib/logs/console/logger'
import {
  deleteFromBlob,
  downloadFromBlob,
  getPresignedUrlWithConfig as getBlobPresignedUrlWithConfig,
  uploadToBlob,
} from '@/lib/uploads/blob/blob-client'
import {
  deleteFromS3,
  downloadFromS3,
  getPresignedUrlWithConfig,
  uploadToS3,
} from '@/lib/uploads/s3/s3-client'
import {
  BLOB_EXECUTION_FILES_CONFIG,
  S3_EXECUTION_FILES_CONFIG,
  USE_BLOB_STORAGE,
  USE_S3_STORAGE,
} from '@/lib/uploads/setup'
import type { UserFile } from '@/executor/types'
import type { ExecutionContext } from './execution-files'
import { generateExecutionFileKey, generateFileId, getFileExpirationDate } from './execution-files'

const logger = createLogger('ExecutionFileStorage')

/**
 * Upload a file to execution-scoped storage
 */
export async function uploadExecutionFile(
  context: ExecutionContext,
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  isAsync?: boolean
): Promise<UserFile> {
  logger.info(`Uploading execution file: ${fileName} for execution ${context.executionId}`)
  logger.debug(`File upload context:`, {
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    executionId: context.executionId,
    fileName,
    bufferSize: fileBuffer.length,
  })

  // Generate execution-scoped storage key
  const storageKey = generateExecutionFileKey(context, fileName)
  const fileId = generateFileId()

  logger.info(`Generated storage key: "${storageKey}" for file: ${fileName}`)

  // Use 10-minute expiration for async executions, 5 minutes for sync
  const urlExpirationSeconds = isAsync ? 10 * 60 : 5 * 60

  try {
    let fileInfo: any
    let directUrl: string | undefined

    if (USE_S3_STORAGE) {
      // Upload to S3 execution files bucket with exact key (no timestamp prefix)
      logger.debug(
        `Uploading to S3 with key: ${storageKey}, bucket: ${S3_EXECUTION_FILES_CONFIG.bucket}`
      )
      fileInfo = await uploadToS3(
        fileBuffer,
        storageKey, // Use storageKey as fileName
        contentType,
        {
          bucket: S3_EXECUTION_FILES_CONFIG.bucket,
          region: S3_EXECUTION_FILES_CONFIG.region,
        },
        undefined, // size (will use buffer length)
        true // skipTimestampPrefix = true
      )

      logger.info(`S3 upload returned key: "${fileInfo.key}" for file: ${fileName}`)
      logger.info(`Original storage key was: "${storageKey}"`)
      logger.info(`Keys match: ${fileInfo.key === storageKey}`)

      // Generate presigned URL for execution (5 or 10 minutes)
      try {
        logger.info(
          `Generating presigned URL with key: "${fileInfo.key}" (expiration: ${urlExpirationSeconds / 60} minutes)`
        )
        directUrl = await getPresignedUrlWithConfig(
          fileInfo.key, // Use the actual uploaded key
          {
            bucket: S3_EXECUTION_FILES_CONFIG.bucket,
            region: S3_EXECUTION_FILES_CONFIG.region,
          },
          urlExpirationSeconds
        )
        logger.info(`Generated presigned URL: ${directUrl}`)
      } catch (error) {
        logger.warn(`Failed to generate S3 presigned URL for ${fileName}:`, error)
      }
    } else if (USE_BLOB_STORAGE) {
      // Upload to Azure Blob execution files container
      fileInfo = await uploadToBlob(fileBuffer, storageKey, contentType, {
        accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
        accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
        connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
        containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
      })

      // Generate presigned URL for execution (5 or 10 minutes)
      try {
        directUrl = await getBlobPresignedUrlWithConfig(
          fileInfo.key, // Use the actual uploaded key
          {
            accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
            accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
            connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
            containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
          },
          urlExpirationSeconds
        )
      } catch (error) {
        logger.warn(`Failed to generate Blob presigned URL for ${fileName}:`, error)
      }
    } else {
      throw new Error('No cloud storage configured for execution files')
    }

    const userFile: UserFile = {
      id: fileId,
      name: fileName,
      size: fileBuffer.length,
      type: contentType,
      url: directUrl || `/api/files/serve/${fileInfo.key}`, // Use presigned URL (5 or 10 min), fallback to serve path
      key: fileInfo.key, // Use the actual uploaded key from S3/Blob
      uploadedAt: new Date().toISOString(),
      expiresAt: getFileExpirationDate(),
    }

    logger.info(`Successfully uploaded execution file: ${fileName} (${fileBuffer.length} bytes)`)
    return userFile
  } catch (error) {
    logger.error(`Failed to upload execution file ${fileName}:`, error)
    throw new Error(
      `Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Download a file from execution-scoped storage
 */
export async function downloadExecutionFile(userFile: UserFile): Promise<Buffer> {
  logger.info(`Downloading execution file: ${userFile.name}`)

  try {
    let fileBuffer: Buffer

    if (USE_S3_STORAGE) {
      fileBuffer = await downloadFromS3(userFile.key, {
        bucket: S3_EXECUTION_FILES_CONFIG.bucket,
        region: S3_EXECUTION_FILES_CONFIG.region,
      })
    } else if (USE_BLOB_STORAGE) {
      fileBuffer = await downloadFromBlob(userFile.key, {
        accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
        accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
        connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
        containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
      })
    } else {
      throw new Error('No cloud storage configured for execution files')
    }

    logger.info(
      `Successfully downloaded execution file: ${userFile.name} (${fileBuffer.length} bytes)`
    )
    return fileBuffer
  } catch (error) {
    logger.error(`Failed to download execution file ${userFile.name}:`, error)
    throw new Error(
      `Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Generate a short-lived presigned URL for file download (5 minutes)
 */
export async function generateExecutionFileDownloadUrl(userFile: UserFile): Promise<string> {
  logger.info(`Generating download URL for execution file: ${userFile.name}`)
  logger.info(`File key: "${userFile.key}"`)
  logger.info(`S3 bucket: ${S3_EXECUTION_FILES_CONFIG.bucket}`)

  try {
    let downloadUrl: string

    if (USE_S3_STORAGE) {
      downloadUrl = await getPresignedUrlWithConfig(
        userFile.key,
        {
          bucket: S3_EXECUTION_FILES_CONFIG.bucket,
          region: S3_EXECUTION_FILES_CONFIG.region,
        },
        5 * 60 // 5 minutes
      )
    } else if (USE_BLOB_STORAGE) {
      downloadUrl = await getBlobPresignedUrlWithConfig(
        userFile.key,
        {
          accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
          accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
          connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
          containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
        },
        5 * 60 // 5 minutes
      )
    } else {
      throw new Error('No cloud storage configured for execution files')
    }

    logger.info(`Generated download URL for execution file: ${userFile.name}`)
    return downloadUrl
  } catch (error) {
    logger.error(`Failed to generate download URL for ${userFile.name}:`, error)
    throw new Error(
      `Failed to generate download URL: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Delete a file from execution-scoped storage
 */
export async function deleteExecutionFile(userFile: UserFile): Promise<void> {
  logger.info(`Deleting execution file: ${userFile.name}`)

  try {
    if (USE_S3_STORAGE) {
      await deleteFromS3(userFile.key, {
        bucket: S3_EXECUTION_FILES_CONFIG.bucket,
        region: S3_EXECUTION_FILES_CONFIG.region,
      })
    } else if (USE_BLOB_STORAGE) {
      await deleteFromBlob(userFile.key, {
        accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
        accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
        connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
        containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
      })
    } else {
      throw new Error('No cloud storage configured for execution files')
    }

    logger.info(`Successfully deleted execution file: ${userFile.name}`)
  } catch (error) {
    logger.error(`Failed to delete execution file ${userFile.name}:`, error)
    throw new Error(
      `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}
```

### Purpose of this file

This TypeScript file defines a module for managing workflow execution files. It provides functionalities for uploading, downloading, generating download URLs, and deleting files within the context of a workflow execution. The module abstracts away the underlying storage implementation (either S3 or Azure Blob Storage) and provides a consistent API for interacting with execution files.

### Simplification of Complex Logic

The code simplifies complex logic by:

1.  **Abstraction:** It hides the details of interacting with S3 or Azure Blob Storage behind a unified set of functions (`uploadExecutionFile`, `downloadExecutionFile`, `generateExecutionFileDownloadUrl`, `deleteExecutionFile`).
2.  **Configuration:** It uses configuration constants (`USE_S3_STORAGE`, `USE_BLOB_STORAGE`, `S3_EXECUTION_FILES_CONFIG`, `BLOB_EXECUTION_FILES_CONFIG`) to determine the storage provider and its settings, making it easy to switch between storage solutions.
3.  **Error Handling:** It includes comprehensive try-catch blocks to handle potential errors during file operations and provides informative error messages.
4.  **Logging:** It uses a logger (`createLogger`) to provide detailed information about file operations, which can be helpful for debugging and monitoring.
5.  **Conditional Logic:** It employs `if` statements to handle different storage providers, but it keeps the logic within each branch relatively simple and focused.
6.  **Presigned URLs:** The module generates presigned URLs for accessing files, which eliminates the need for clients to have direct access to the storage bucket.

### Line-by-Line Explanation

```typescript
/**
 * Specialized storage client for workflow execution files
 * Uses dedicated S3 bucket: sim-execution-files
 * Directory structure: workspace_id/workflow_id/execution_id/filename
 */
```

*   **Documentation:** This is a JSDoc-style comment that describes the purpose of the file. It indicates that this module is designed for managing files specifically related to workflow executions. It also specifies the expected directory structure for files stored in S3 (or similar storage).

```typescript
import { createLogger } from '@/lib/logs/console/logger'
```

*   **Import:** Imports the `createLogger` function from a logging library. This function is used to create a logger instance for this module, enabling logging of important events and errors.

```typescript
import {
  deleteFromBlob,
  downloadFromBlob,
  getPresignedUrlWithConfig as getBlobPresignedUrlWithConfig,
  uploadToBlob,
} from '@/lib/uploads/blob/blob-client'
```

*   **Import:** Imports functions for interacting with Azure Blob Storage.  `deleteFromBlob` deletes a blob, `downloadFromBlob` downloads a blob, `getPresignedUrlWithConfig` generates a presigned URL for a blob (renamed to `getBlobPresignedUrlWithConfig` to avoid naming conflicts), and `uploadToBlob` uploads a file to Blob storage. These functions are assumed to be defined in the specified path.

```typescript
import {
  deleteFromS3,
  downloadFromS3,
  getPresignedUrlWithConfig,
  uploadToS3,
} from '@/lib/uploads/s3/s3-client'
```

*   **Import:** Imports functions for interacting with Amazon S3. `deleteFromS3` deletes an S3 object, `downloadFromS3` downloads an S3 object, `getPresignedUrlWithConfig` generates a presigned URL for an S3 object, and `uploadToS3` uploads a file to S3.  These functions are assumed to be defined in the specified path.

```typescript
import {
  BLOB_EXECUTION_FILES_CONFIG,
  S3_EXECUTION_FILES_CONFIG,
  USE_BLOB_STORAGE,
  USE_S3_STORAGE,
} from '@/lib/uploads/setup'
```

*   **Import:** Imports configuration constants related to storage setup.
    *   `BLOB_EXECUTION_FILES_CONFIG`: Configuration object for Azure Blob Storage (account name, key, container name, etc.).
    *   `S3_EXECUTION_FILES_CONFIG`: Configuration object for Amazon S3 (bucket name, region, etc.).
    *   `USE_BLOB_STORAGE`: Boolean flag indicating whether to use Azure Blob Storage.
    *   `USE_S3_STORAGE`: Boolean flag indicating whether to use Amazon S3.

```typescript
import type { UserFile } from '@/executor/types'
import type { ExecutionContext } from './execution-files'
```

*   **Import:** Imports type definitions.
    *   `UserFile`:  An interface defining the structure of a user file object (id, name, size, type, URL, etc.).  This type is assumed to be defined in the specified path.
    *   `ExecutionContext`: An interface defining the context of a workflow execution (workspace ID, workflow ID, execution ID). This type is assumed to be defined in the specified path.

```typescript
import { generateExecutionFileKey, generateFileId, getFileExpirationDate } from './execution-files'
```

*   **Import:** Imports utility functions from a local file `./execution-files`.
    *   `generateExecutionFileKey`: Generates a unique key for storing a file in the storage system, based on the execution context and filename.
    *   `generateFileId`: Generates a unique ID for a file.
    *   `getFileExpirationDate`: Returns a date object representing the expiration time for a file.

```typescript
const logger = createLogger('ExecutionFileStorage')
```

*   **Logger Initialization:** Creates a logger instance named 'ExecutionFileStorage' using the imported `createLogger` function. This logger will be used to record events and errors within this module.

```typescript
/**
 * Upload a file to execution-scoped storage
 */
export async function uploadExecutionFile(
  context: ExecutionContext,
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  isAsync?: boolean
): Promise<UserFile> {
```

*   **Function Definition:** Defines an asynchronous function `uploadExecutionFile` that uploads a file to the execution-scoped storage.
    *   `context`: An `ExecutionContext` object providing information about the workflow execution.
    *   `fileBuffer`: A `Buffer` containing the file data to be uploaded.
    *   `fileName`: The name of the file.
    *   `contentType`: The MIME type of the file.
    *   `isAsync`: An optional boolean indicating whether the execution is asynchronous.  Defaults to `false` if not provided.
    *   `Promise<UserFile>`: Indicates that the function returns a promise that resolves to a `UserFile` object.

```typescript
  logger.info(`Uploading execution file: ${fileName} for execution ${context.executionId}`)
  logger.debug(`File upload context:`, {
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    executionId: context.executionId,
    fileName,
    bufferSize: fileBuffer.length,
  })
```

*   **Logging:** Logs information about the file upload, including the filename and execution ID.  A debug log includes the context of the execution as well as the file's buffer size.

```typescript
  // Generate execution-scoped storage key
  const storageKey = generateExecutionFileKey(context, fileName)
  const fileId = generateFileId()

  logger.info(`Generated storage key: "${storageKey}" for file: ${fileName}`)
```

*   **Key and ID Generation:** Generates a unique storage key and file ID for the file using the imported utility functions. The storage key is used as the unique identifier of the file within the storage system.

```typescript
  // Use 10-minute expiration for async executions, 5 minutes for sync
  const urlExpirationSeconds = isAsync ? 10 * 60 : 5 * 60
```

*   **Expiration Time:** Determines the expiration time for presigned URLs based on whether the execution is asynchronous. Asynchronous executions get a longer expiration time (10 minutes) than synchronous executions (5 minutes).

```typescript
  try {
    let fileInfo: any
    let directUrl: string | undefined
```

*   **Try Block and Variable Declaration:** Begins a `try` block to handle potential errors during the file upload process. Declares two variables: `fileInfo` to store information about the uploaded file (e.g., key, URL) and `directUrl` to store the presigned URL.

```typescript
    if (USE_S3_STORAGE) {
      // Upload to S3 execution files bucket with exact key (no timestamp prefix)
      logger.debug(
        `Uploading to S3 with key: ${storageKey}, bucket: ${S3_EXECUTION_FILES_CONFIG.bucket}`
      )
      fileInfo = await uploadToS3(
        fileBuffer,
        storageKey, // Use storageKey as fileName
        contentType,
        {
          bucket: S3_EXECUTION_FILES_CONFIG.bucket,
          region: S3_EXECUTION_FILES_CONFIG.region,
        },
        undefined, // size (will use buffer length)
        true // skipTimestampPrefix = true
      )
```

*   **S3 Upload:** If `USE_S3_STORAGE` is true, this block executes.
    *   It logs a debug message indicating that the file is being uploaded to S3, including the storage key and bucket name.
    *   It calls the `uploadToS3` function to upload the file to S3.
        *   `fileBuffer`: The file data.
        *   `storageKey`: The storage key to use as the file name in S3.
        *   `contentType`: The content type of the file.
        *   `{ bucket, region }`:  The S3 bucket and region from the configuration.
        *   `undefined`:  Allows `uploadToS3` to determine the size from the buffer.
        *    `true`:  This flag tells the `uploadToS3` function to skip prepending a timestamp to the file name. This is important for workflows that rely on knowing the exact key.
    *   The result of `uploadToS3` (which is assumed to be an object containing information about the uploaded file) is stored in the `fileInfo` variable.

```typescript
      logger.info(`S3 upload returned key: "${fileInfo.key}" for file: ${fileName}`)
      logger.info(`Original storage key was: "${storageKey}"`)
      logger.info(`Keys match: ${fileInfo.key === storageKey}`)
```

*   **S3 Key Verification:** Logs information about the key that S3 assigned to the uploaded file. It also compares the original storage key to the uploaded key to ensure they match. This is important because if the keys don't match, the rest of the application may not be able to locate the file.

```typescript
      // Generate presigned URL for execution (5 or 10 minutes)
      try {
        logger.info(
          `Generating presigned URL with key: "${fileInfo.key}" (expiration: ${urlExpirationSeconds / 60} minutes)`
        )
        directUrl = await getPresignedUrlWithConfig(
          fileInfo.key, // Use the actual uploaded key
          {
            bucket: S3_EXECUTION_FILES_CONFIG.bucket,
            region: S3_EXECUTION_FILES_CONFIG.region,
          },
          urlExpirationSeconds
        )
        logger.info(`Generated presigned URL: ${directUrl}`)
      } catch (error) {
        logger.warn(`Failed to generate S3 presigned URL for ${fileName}:`, error)
      }
```

*   **S3 Presigned URL Generation:** Generates a presigned URL for the uploaded file.
    *   It calls the `getPresignedUrlWithConfig` function to generate the URL.
        *   `fileInfo.key`: The key of the uploaded file in S3.
        *   `{ bucket, region }`: The S3 bucket and region from the configuration.
        *   `urlExpirationSeconds`: The expiration time for the URL (5 or 10 minutes).
    *   The generated URL is stored in the `directUrl` variable.
    *   A try/catch block handles potential errors during URL generation.

```typescript
    } else if (USE_BLOB_STORAGE) {
      // Upload to Azure Blob execution files container
      fileInfo = await uploadToBlob(fileBuffer, storageKey, contentType, {
        accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
        accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
        connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
        containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
      })

      // Generate presigned URL for execution (5 or 10 minutes)
      try {
        directUrl = await getBlobPresignedUrlWithConfig(
          fileInfo.key, // Use the actual uploaded key
          {
            accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
            accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
            connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
            containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
          },
          urlExpirationSeconds
        )
      } catch (error) {
        logger.warn(`Failed to generate Blob presigned URL for ${fileName}:`, error)
      }
```

*   **Azure Blob Storage Upload:** If `USE_BLOB_STORAGE` is true, this block executes.
    *   It calls the `uploadToBlob` function to upload the file to Azure Blob Storage.
        *   `fileBuffer`: The file data.
        *   `storageKey`: The storage key to use as the file name in Blob Storage.
        *   `contentType`: The content type of the file.
        *   `BLOB_EXECUTION_FILES_CONFIG`:  The Azure Blob Storage configuration.
    *   The result of `uploadToBlob` is stored in the `fileInfo` variable.
    *   It then generates a presigned URL for Azure Blob storage, similar to the S3 implementation.

```typescript
    } else {
      throw new Error('No cloud storage configured for execution files')
    }
```

*   **Error Handling:** If neither `USE_S3_STORAGE` nor `USE_BLOB_STORAGE` is true, it throws an error indicating that no cloud storage is configured.

```typescript
    const userFile: UserFile = {
      id: fileId,
      name: fileName,
      size: fileBuffer.length,
      type: contentType,
      url: directUrl || `/api/files/serve/${fileInfo.key}`, // Use presigned URL (5 or 10 min), fallback to serve path
      key: fileInfo.key, // Use the actual uploaded key from S3/Blob
      uploadedAt: new Date().toISOString(),
      expiresAt: getFileExpirationDate(),
    }
```

*   **UserFile Object Creation:** Creates a `UserFile` object with the file's metadata.
    *   `id`: The generated file ID.
    *   `name`: The original filename.
    *   `size`: The size of the file.
    *   `type`: The content type of the file.
    *   `url`: The presigned URL if available, otherwise a fallback URL to serve the file through the application.
    *   `key`: The actual key of the uploaded file in S3/Blob.
    *   `uploadedAt`: The current date and time in ISO string format.
    *   `expiresAt`: The expiration date of the file (obtained from `getFileExpirationDate`).

```typescript
    logger.info(`Successfully uploaded execution file: ${fileName} (${fileBuffer.length} bytes)`)
    return userFile
  } catch (error) {
    logger.error(`Failed to upload execution file ${fileName}:`, error)
    throw new Error(
      `Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}
```

*   **Success and Error Handling:**
    *   If the upload is successful, it logs an informational message and returns the `userFile` object.
    *   If any error occurs during the process, it logs an error message and re-throws a generic error.

```typescript
/**
 * Download a file from execution-scoped storage
 */
export async function downloadExecutionFile(userFile: UserFile): Promise<Buffer> {
  logger.info(`Downloading execution file: ${userFile.name}`)

  try {
    let fileBuffer: Buffer

    if (USE_S3_STORAGE) {
      fileBuffer = await downloadFromS3(userFile.key, {
        bucket: S3_EXECUTION_FILES_CONFIG.bucket,
        region: S3_EXECUTION_FILES_CONFIG.region,
      })
    } else if (USE_BLOB_STORAGE) {
      fileBuffer = await downloadFromBlob(userFile.key, {
        accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
        accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
        connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
        containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
      })
    } else {
      throw new Error('No cloud storage configured for execution files')
    }

    logger.info(
      `Successfully downloaded execution file: ${userFile.name} (${fileBuffer.length} bytes)`
    )
    return fileBuffer
  } catch (error) {
    logger.error(`Failed to download execution file ${userFile.name}:`, error)
    throw new Error(
      `Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}
```

*   **`downloadExecutionFile` Function:** Defines an asynchronous function `downloadExecutionFile` to download a file from the execution-scoped storage.
    *   It takes a `UserFile` object as input.
    *   It retrieves the file data from S3 or Azure Blob Storage based on the configuration.
    *   It returns a `Buffer` containing the file data.
    *   It includes error handling and logging.

```typescript
/**
 * Generate a short-lived presigned URL for file download (5 minutes)
 */
export async function generateExecutionFileDownloadUrl(userFile: UserFile): Promise<string> {
  logger.info(`Generating download URL for execution file: ${userFile.name}`)
  logger.info(`File key: "${userFile.key}"`)
  logger.info(`S3 bucket: ${S3_EXECUTION_FILES_CONFIG.bucket}`)

  try {
    let downloadUrl: string

    if (USE_S3_STORAGE) {
      downloadUrl = await getPresignedUrlWithConfig(
        userFile.key,
        {
          bucket: S3_EXECUTION_FILES_CONFIG.bucket,
          region: S3_EXECUTION_FILES_CONFIG.region,
        },
        5 * 60 // 5 minutes
      )
    } else if (USE_BLOB_STORAGE) {
      downloadUrl = await getBlobPresignedUrlWithConfig(
        userFile.key,
        {
          accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
          accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
          connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
          containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
        },
        5 * 60 // 5 minutes
      )
    } else {
      throw new Error('No cloud storage configured for execution files')
    }

    logger.info(`Generated download URL for execution file: ${userFile.name}`)
    return downloadUrl
  } catch (error) {
    logger.error(`Failed to generate download URL for ${userFile.name}:`, error)
    throw new Error(
      `Failed to generate download URL: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}
```

*   **`generateExecutionFileDownloadUrl` Function:** Defines an asynchronous function to generate a presigned URL for downloading a file.  The URL is valid for 5 minutes.
    *   It takes a `UserFile` object as input.
    *   It generates the URL using the appropriate `getPresignedUrlWithConfig` function based on the configured storage provider (S3 or Blob Storage).
    *   It includes error handling and logging.

```typescript
/**
 * Delete a file from execution-scoped storage
 */
export async function deleteExecutionFile(userFile: UserFile): Promise<void> {
  logger.info(`Deleting execution file: ${userFile.name}`)

  try {
    if (USE_S3_STORAGE) {
      await deleteFromS3(userFile.key, {
        bucket: S3_EXECUTION_FILES_CONFIG.bucket,
        region: S3_EXECUTION_FILES_CONFIG.region,
      })
    } else if (USE_BLOB_STORAGE) {
      await deleteFromBlob(userFile.key, {
        accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
        accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
        connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
        containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
      })
    } else {
      throw new Error('No cloud storage configured for execution files')
    }

    logger.info(`Successfully deleted execution file: ${userFile.name}`)
  } catch (error) {
    logger.error(`Failed to delete execution file ${userFile.name}:`, error)
    throw new Error(
      `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}
```

*   **`deleteExecutionFile` Function:** Defines an asynchronous function to delete a file from execution-scoped storage.
    *   It takes a `UserFile` object as input.
    *   It deletes the file using the appropriate `deleteFromS3` or `deleteFromBlob` function based on the configured storage provider.
    *   It includes error handling and logging.

In summary, this file provides a well-structured and documented module for managing workflow execution files, abstracting away the complexities of interacting with different cloud storage providers and providing a consistent API for file operations.  The use of configuration, logging, and error handling makes the module robust and easy to maintain.
