```typescript
import { createLogger } from '@/lib/logs/console/logger'
import type { CustomBlobConfig } from '@/lib/uploads/blob/blob-client'
import type { CustomS3Config } from '@/lib/uploads/s3/s3-client'
import { USE_BLOB_STORAGE, USE_S3_STORAGE } from '@/lib/uploads/setup'

const logger = createLogger('StorageClient')

// Client-safe type definitions
export type FileInfo = {
  path: string
  key: string
  name: string
  size: number
  type: string
}

export type CustomStorageConfig = {
  // S3 config
  bucket?: string
  region?: string
  // Blob config
  containerName?: string
  accountName?: string
  accountKey?: string
  connectionString?: string
}

/**
 * Upload a file to the configured storage provider
 * @param file Buffer containing file data
 * @param fileName Original file name
 * @param contentType MIME type of the file
 * @param size File size in bytes (optional, will use buffer length if not provided)
 * @returns Object with file information
 */
export async function uploadFile(
  file: Buffer,
  fileName: string,
  contentType: string,
  size?: number
): Promise<FileInfo>

/**
 * Upload a file to the configured storage provider with custom configuration
 * @param file Buffer containing file data
 * @param fileName Original file name
 * @param contentType MIME type of the file
 * @param customConfig Custom storage configuration
 * @param size File size in bytes (optional, will use buffer length if not provided)
 * @returns Object with file information
 */
export async function uploadFile(
  file: Buffer,
  fileName: string,
  contentType: string,
  customConfig: CustomStorageConfig,
  size?: number
): Promise<FileInfo>

export async function uploadFile(
  file: Buffer,
  fileName: string,
  contentType: string,
  configOrSize?: CustomStorageConfig | number,
  size?: number
): Promise<FileInfo> {
  if (USE_BLOB_STORAGE) {
    logger.info(`Uploading file to Azure Blob Storage: ${fileName}`)
    const { uploadToBlob } = await import('@/lib/uploads/blob/blob-client')
    if (typeof configOrSize === 'object') {
      const blobConfig: CustomBlobConfig = {
        containerName: configOrSize.containerName!,
        accountName: configOrSize.accountName!,
        accountKey: configOrSize.accountKey,
        connectionString: configOrSize.connectionString,
      }
      return uploadToBlob(file, fileName, contentType, blobConfig, size)
    }
    return uploadToBlob(file, fileName, contentType, configOrSize)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Uploading file to S3: ${fileName}`)
    const { uploadToS3 } = await import('@/lib/uploads/s3/s3-client')
    if (typeof configOrSize === 'object') {
      const s3Config: CustomS3Config = {
        bucket: configOrSize.bucket!,
        region: configOrSize.region!,
      }
      return uploadToS3(file, fileName, contentType, s3Config, size)
    }
    return uploadToS3(file, fileName, contentType, configOrSize)
  }

  throw new Error(
    'No storage provider configured. Set Azure credentials (AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY) or configure AWS credentials for S3.'
  )
}

/**
 * Download a file from the configured storage provider
 * @param key File key/name
 * @returns File buffer
 */
export async function downloadFile(key: string): Promise<Buffer>

/**
 * Download a file from the configured storage provider with custom configuration
 * @param key File key/name
 * @param customConfig Custom storage configuration
 * @returns File buffer
 */
export async function downloadFile(key: string, customConfig: CustomStorageConfig): Promise<Buffer>

export async function downloadFile(
  key: string,
  customConfig?: CustomStorageConfig
): Promise<Buffer> {
  if (USE_BLOB_STORAGE) {
    logger.info(`Downloading file from Azure Blob Storage: ${key}`)
    const { downloadFromBlob } = await import('@/lib/uploads/blob/blob-client')
    if (customConfig) {
      const blobConfig: CustomBlobConfig = {
        containerName: customConfig.containerName!,
        accountName: customConfig.accountName!,
        accountKey: customConfig.accountKey,
        connectionString: customConfig.connectionString,
      }
      return downloadFromBlob(key, blobConfig)
    }
    return downloadFromBlob(key)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Downloading file from S3: ${key}`)
    const { downloadFromS3 } = await import('@/lib/uploads/s3/s3-client')
    if (customConfig) {
      const s3Config: CustomS3Config = {
        bucket: customConfig.bucket!,
        region: customConfig.region!,
      }
      return downloadFromS3(key, s3Config)
    }
    return downloadFromS3(key)
  }

  throw new Error(
    'No storage provider configured. Set Azure credentials (AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY) or configure AWS credentials for S3.'
  )
}

/**
 * Delete a file from the configured storage provider
 * @param key File key/name
 */
export async function deleteFile(key: string): Promise<void> {
  if (USE_BLOB_STORAGE) {
    logger.info(`Deleting file from Azure Blob Storage: ${key}`)
    const { deleteFromBlob } = await import('@/lib/uploads/blob/blob-client')
    return deleteFromBlob(key)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Deleting file from S3: ${key}`)
    const { deleteFromS3 } = await import('@/lib/uploads/s3/s3-client')
    return deleteFromS3(key)
  }

  throw new Error(
    'No storage provider configured. Set Azure credentials (AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY) or configure AWS credentials for S3.'
  )
}

/**
 * Generate a presigned URL for direct file access
 * @param key File key/name
 * @param expiresIn Time in seconds until URL expires
 * @returns Presigned URL
 */
export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  if (USE_BLOB_STORAGE) {
    logger.info(`Generating presigned URL for Azure Blob Storage: ${key}`)
    const { getPresignedUrl: getBlobPresignedUrl } = await import('@/lib/uploads/blob/blob-client')
    return getBlobPresignedUrl(key, expiresIn)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Generating presigned URL for S3: ${key}`)
    const { getPresignedUrl: getS3PresignedUrl } = await import('@/lib/uploads/s3/s3-client')
    return getS3PresignedUrl(key, expiresIn)
  }

  throw new Error(
    'No storage provider configured. Set Azure credentials (AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY) or configure AWS credentials for S3.'
  )
}

/**
 * Generate a presigned URL for direct file access with custom configuration
 * @param key File key/name
 * @param customConfig Custom storage configuration
 * @param expiresIn Time in seconds until URL expires
 * @returns Presigned URL
 */
export async function getPresignedUrlWithConfig(
  key: string,
  customConfig: CustomStorageConfig,
  expiresIn = 3600
): Promise<string> {
  if (USE_BLOB_STORAGE) {
    logger.info(`Generating presigned URL for Azure Blob Storage with custom config: ${key}`)
    const { getPresignedUrlWithConfig: getBlobPresignedUrlWithConfig } = await import(
      '@/lib/uploads/blob/blob-client'
    )
    // Convert CustomStorageConfig to CustomBlobConfig
    const blobConfig: CustomBlobConfig = {
      containerName: customConfig.containerName!,
      accountName: customConfig.accountName!,
      accountKey: customConfig.accountKey,
      connectionString: customConfig.connectionString,
    }
    return getBlobPresignedUrlWithConfig(key, blobConfig, expiresIn)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Generating presigned URL for S3 with custom config: ${key}`)
    const { getPresignedUrlWithConfig: getS3PresignedUrlWithConfig } = await import(
      '@/lib/uploads/s3/s3-client'
    )
    // Convert CustomStorageConfig to CustomS3Config
    const s3Config: CustomS3Config = {
      bucket: customConfig.bucket!,
      region: customConfig.region!,
    }
    return getS3PresignedUrlWithConfig(key, s3Config, expiresIn)
  }

  throw new Error(
    'No storage provider configured. Set Azure credentials (AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY) or configure AWS credentials for S3.'
  )
}

/**
 * Get the current storage provider name
 */
export function getStorageProvider(): 'blob' | 's3' | 'local' {
  if (USE_BLOB_STORAGE) return 'blob'
  if (USE_S3_STORAGE) return 's3'
  return 'local'
}

/**
 * Check if we're using cloud storage (either S3 or Blob)
 */
export function isUsingCloudStorage(): boolean {
  return USE_BLOB_STORAGE || USE_S3_STORAGE
}

/**
 * Get the appropriate serve path prefix based on storage provider
 */
export function getServePathPrefix(): string {
  if (USE_BLOB_STORAGE) return '/api/files/serve/blob/'
  if (USE_S3_STORAGE) return '/api/files/serve/s3/'
  return '/api/files/serve/'
}
```

## Purpose of this file

This TypeScript file, `index.ts`, acts as a unified interface for interacting with different cloud storage providers, specifically Azure Blob Storage and Amazon S3. It provides a set of functions to upload, download, delete files, and generate pre-signed URLs, abstracting away the underlying storage implementation details.  The file intelligently chooses the appropriate storage client (Blob or S3) based on the configuration flags `USE_BLOB_STORAGE` and `USE_S3_STORAGE`.  It offers functions with and without custom configurations for more flexibility. If neither of the flags is set, the system throws an error, indicating that no storage provider is configured. Also, there are some helper functions to return the current storage provider name, check if cloud storage is in use and get the serve path prefix.

## Explanation of each line of code

1.  **Imports:**

```typescript
import { createLogger } from '@/lib/logs/console/logger'
import type { CustomBlobConfig } from '@/lib/uploads/blob/blob-client'
import type { CustomS3Config } from '@/lib/uploads/s3/s3-client'
import { USE_BLOB_STORAGE, USE_S3_STORAGE } from '@/lib/uploads/setup'
```

*   `createLogger`: Imports a function to create a logger instance for logging events related to storage operations. The `@` symbol likely indicates a path alias configured in the project.
*   `CustomBlobConfig`: Imports a type definition for custom Blob Storage configurations, such as container name, account name, and credentials.
*   `CustomS3Config`: Imports a type definition for custom S3 configurations, such as bucket name and region.
*   `USE_BLOB_STORAGE`, `USE_S3_STORAGE`: Imports boolean constants that determine which storage provider is active. These constants are likely defined in a separate configuration file.

2.  **Logger Initialization:**

```typescript
const logger = createLogger('StorageClient')
```

*   Creates a logger instance named "StorageClient" using the imported `createLogger` function. This logger will be used to record information about storage operations.

3.  **`FileInfo` Type Definition:**

```typescript
export type FileInfo = {
  path: string
  key: string
  name: string
  size: number
  type: string
}
```

*   Defines a type `FileInfo` representing the structure of file information returned by upload operations.
    *   `path`: The full path or URL where the file is stored.
    *   `key`:  A unique identifier for the file within the storage system.
    *   `name`: The original name of the file.
    *   `size`: The size of the file in bytes.
    *   `type`: The MIME type of the file (e.g., "image/jpeg").

4.  **`CustomStorageConfig` Type Definition:**

```typescript
export type CustomStorageConfig = {
  // S3 config
  bucket?: string
  region?: string
  // Blob config
  containerName?: string
  accountName?: string
  accountKey?: string
  connectionString?: string
}
```

*   Defines a type `CustomStorageConfig` representing a generic configuration object that can hold either Blob Storage or S3 specific settings.  The properties are optional, indicated by the `?`, as only the relevant settings for the chosen storage provider are required.
    *   `bucket`: (S3) The name of the S3 bucket.
    *   `region`: (S3) The AWS region where the bucket is located.
    *   `containerName`: (Blob) The name of the Blob Storage container.
    *   `accountName`: (Blob) The name of the Azure Storage account.
    *   `accountKey`: (Blob) The access key for the Azure Storage account.
    *   `connectionString`: (Blob) The full connection string for the Azure Storage account.

5.  **`uploadFile` Function (Overloads):**

```typescript
/**
 * Upload a file to the configured storage provider
 * @param file Buffer containing file data
 * @param fileName Original file name
 * @param contentType MIME type of the file
 * @param size File size in bytes (optional, will use buffer length if not provided)
 * @returns Object with file information
 */
export async function uploadFile(
  file: Buffer,
  fileName: string,
  contentType: string,
  size?: number
): Promise<FileInfo>

/**
 * Upload a file to the configured storage provider with custom configuration
 * @param file Buffer containing file data
 * @param fileName Original file name
 * @param contentType MIME type of the file
 * @param customConfig Custom storage configuration
 * @param size File size in bytes (optional, will use buffer length if not provided)
 * @returns Object with file information
 */
export async function uploadFile(
  file: Buffer,
  fileName: string,
  contentType: string,
  customConfig: CustomStorageConfig,
  size?: number
): Promise<FileInfo>

export async function uploadFile(
  file: Buffer,
  fileName: string,
  contentType: string,
  configOrSize?: CustomStorageConfig | number,
  size?: number
): Promise<FileInfo> {
  if (USE_BLOB_STORAGE) {
    logger.info(`Uploading file to Azure Blob Storage: ${fileName}`)
    const { uploadToBlob } = await import('@/lib/uploads/blob/blob-client')
    if (typeof configOrSize === 'object') {
      const blobConfig: CustomBlobConfig = {
        containerName: configOrSize.containerName!,
        accountName: configOrSize.accountName!,
        accountKey: configOrSize.accountKey,
        connectionString: configOrSize.connectionString,
      }
      return uploadToBlob(file, fileName, contentType, blobConfig, size)
    }
    return uploadToBlob(file, fileName, contentType, configOrSize)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Uploading file to S3: ${fileName}`)
    const { uploadToS3 } = await import('@/lib/uploads/s3/s3-client')
    if (typeof configOrSize === 'object') {
      const s3Config: CustomS3Config = {
        bucket: configOrSize.bucket!,
        region: configOrSize.region!,
      }
      return uploadToS3(file, fileName, contentType, s3Config, size)
    }
    return uploadToS3(file, fileName, contentType, configOrSize)
  }

  throw new Error(
    'No storage provider configured. Set Azure credentials (AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY) or configure AWS credentials for S3.'
  )
}
```

*   This function uploads a file to the configured storage provider (either Blob Storage or S3). It uses function overloading to provide two different ways to call the function: one with a `size` parameter, and another with `CustomStorageConfig` and optionally `size` parameter.
*   It takes the file as a `Buffer`, the file name, the content type, and optionally a custom configuration or the file size.
*   It checks `USE_BLOB_STORAGE` first. If true, it dynamically imports the Blob Storage client (`@/lib/uploads/blob/blob-client`) and calls its `uploadToBlob` function. If `configOrSize` is an object, it's treated as a `CustomStorageConfig` and converted into `CustomBlobConfig` before calling `uploadToBlob`.  Otherwise, `configOrSize` is passed directly to `uploadToBlob`, implying it is the `size`.
*   If `USE_BLOB_STORAGE` is false, it checks `USE_S3_STORAGE`.  If true, it dynamically imports the S3 client (`@/lib/uploads/s3/s3-client`) and calls its `uploadToS3` function. If `configOrSize` is an object, it's treated as a `CustomStorageConfig` and converted into `CustomS3Config` before calling `uploadToS3`. Otherwise, `configOrSize` is passed directly to `uploadToS3`, implying it is the `size`.
*   If neither `USE_BLOB_STORAGE` nor `USE_S3_STORAGE` is true, it throws an error indicating that no storage provider is configured.
*   Dynamic imports (`import()`) are used for code splitting, so the storage client code is only loaded when needed.

6.  **`downloadFile` Function (Overloads):**

```typescript
/**
 * Download a file from the configured storage provider
 * @param key File key/name
 * @returns File buffer
 */
export async function downloadFile(key: string): Promise<Buffer>

/**
 * Download a file from the configured storage provider with custom configuration
 * @param key File key/name
 * @param customConfig Custom storage configuration
 * @returns File buffer
 */
export async function downloadFile(key: string, customConfig: CustomStorageConfig): Promise<Buffer>

export async function downloadFile(
  key: string,
  customConfig?: CustomStorageConfig
): Promise<Buffer> {
  if (USE_BLOB_STORAGE) {
    logger.info(`Downloading file from Azure Blob Storage: ${key}`)
    const { downloadFromBlob } = await import('@/lib/uploads/blob/blob-client')
    if (customConfig) {
      const blobConfig: CustomBlobConfig = {
        containerName: customConfig.containerName!,
        accountName: customConfig.accountName!,
        accountKey: customConfig.accountKey,
        connectionString: customConfig.connectionString,
      }
      return downloadFromBlob(key, blobConfig)
    }
    return downloadFromBlob(key)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Downloading file from S3: ${key}`)
    const { downloadFromS3 } = await import('@/lib/uploads/s3/s3-client')
    if (customConfig) {
      const s3Config: CustomS3Config = {
        bucket: customConfig.bucket!,
        region: customConfig.region!,
      }
      return downloadFromS3(key, s3Config)
    }
    return downloadFromS3(key)
  }

  throw new Error(
    'No storage provider configured. Set Azure credentials (AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY) or configure AWS credentials for S3.'
  )
}
```

*   This function downloads a file from the configured storage provider. It also uses function overloading to provide a way to download with and without a `CustomStorageConfig`.
*   It takes the file key/name as input.
*   It checks `USE_BLOB_STORAGE` first. If true, it dynamically imports the Blob Storage client and calls its `downloadFromBlob` function.  If `customConfig` is provided, it's converted to a `CustomBlobConfig` before calling `downloadFromBlob`.
*   If `USE_BLOB_STORAGE` is false, it checks `USE_S3_STORAGE`. If true, it dynamically imports the S3 client and calls its `downloadFromS3` function. If `customConfig` is provided, it's converted to `CustomS3Config` before calling `downloadFromS3`.
*   If neither `USE_BLOB_STORAGE` nor `USE_S3_STORAGE` is true, it throws an error.

7.  **`deleteFile` Function:**

```typescript
/**
 * Delete a file from the configured storage provider
 * @param key File key/name
 */
export async function deleteFile(key: string): Promise<void> {
  if (USE_BLOB_STORAGE) {
    logger.info(`Deleting file from Azure Blob Storage: ${key}`)
    const { deleteFromBlob } = await import('@/lib/uploads/blob/blob-client')
    return deleteFromBlob(key)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Deleting file from S3: ${key}`)
    const { deleteFromS3 } = await import('@/lib/uploads/s3/s3-client')
    return deleteFromS3(key)
  }

  throw new Error(
    'No storage provider configured. Set Azure credentials (AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY) or configure AWS credentials for S3.'
  )
}
```

*   This function deletes a file from the configured storage provider.
*   It takes the file key/name as input.
*   It checks `USE_BLOB_STORAGE` first. If true, it dynamically imports the Blob Storage client and calls its `deleteFromBlob` function.
*   If `USE_BLOB_STORAGE` is false, it checks `USE_S3_STORAGE`. If true, it dynamically imports the S3 client and calls its `deleteFromS3` function.
*   If neither `USE_BLOB_STORAGE` nor `USE_S3_STORAGE` is true, it throws an error.

8.  **`getPresignedUrl` Function:**

```typescript
/**
 * Generate a presigned URL for direct file access
 * @param key File key/name
 * @param expiresIn Time in seconds until URL expires
 * @returns Presigned URL
 */
export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  if (USE_BLOB_STORAGE) {
    logger.info(`Generating presigned URL for Azure Blob Storage: ${key}`)
    const { getPresignedUrl: getBlobPresignedUrl } = await import('@/lib/uploads/blob/blob-client')
    return getBlobPresignedUrl(key, expiresIn)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Generating presigned URL for S3: ${key}`)
    const { getPresignedUrl: getS3PresignedUrl } = await import('@/lib/uploads/s3/s3-client')
    return getS3PresignedUrl(key, expiresIn)
  }

  throw new Error(
    'No storage provider configured. Set Azure credentials (AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY) or configure AWS credentials for S3.'
  )
}
```

*   This function generates a pre-signed URL for direct file access.
*   It takes the file key/name and an optional `expiresIn` parameter (defaulting to 3600 seconds = 1 hour).
*   It checks `USE_BLOB_STORAGE` first. If true, it dynamically imports the Blob Storage client and calls its `getPresignedUrl` function (aliased as `getBlobPresignedUrl` to avoid name collision).
*   If `USE_BLOB_STORAGE` is false, it checks `USE_S3_STORAGE`. If true, it dynamically imports the S3 client and calls its `getPresignedUrl` function (aliased as `getS3PresignedUrl`).
*   If neither `USE_BLOB_STORAGE` nor `USE_S3_STORAGE` is true, it throws an error.

9. **`getPresignedUrlWithConfig` Function:**

```typescript
/**
 * Generate a presigned URL for direct file access with custom configuration
 * @param key File key/name
 * @param customConfig Custom storage configuration
 * @param expiresIn Time in seconds until URL expires
 * @returns Presigned URL
 */
export async function getPresignedUrlWithConfig(
  key: string,
  customConfig: CustomStorageConfig,
  expiresIn = 3600
): Promise<string> {
  if (USE_BLOB_STORAGE) {
    logger.info(`Generating presigned URL for Azure Blob Storage with custom config: ${key}`)
    const { getPresignedUrlWithConfig: getBlobPresignedUrlWithConfig } = await import(
      '@/lib/uploads/blob/blob-client'
    )
    // Convert CustomStorageConfig to CustomBlobConfig
    const blobConfig: CustomBlobConfig = {
      containerName: customConfig.containerName!,
      accountName: customConfig.accountName!,
      accountKey: customConfig.accountKey,
      connectionString: customConfig.connectionString,
    }
    return getBlobPresignedUrlWithConfig(key, blobConfig, expiresIn)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Generating presigned URL for S3 with custom config: ${key}`)
    const { getPresignedUrlWithConfig: getS3PresignedUrlWithConfig } = await import(
      '@/lib/uploads/s3/s3-client'
    )
    // Convert CustomStorageConfig to CustomS3Config
    const s3Config: CustomS3Config = {
      bucket: customConfig.bucket!,
      region: customConfig.region!,
    }
    return getS3PresignedUrlWithConfig(key, s3Config, expiresIn)
  }

  throw new Error(
    'No storage provider configured. Set Azure credentials (AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY) or configure AWS credentials for S3.'
  )
}
```

*   This function generates a pre-signed URL for direct file access, using a custom configuration.
*   It takes the file key/name, a `CustomStorageConfig`, and an optional `expiresIn` parameter.
*   It checks `USE_BLOB_STORAGE` first. If true, it dynamically imports the Blob Storage client and calls its `getPresignedUrlWithConfig` function (aliased). It converts the generic `CustomStorageConfig` to `CustomBlobConfig`.
*   If `USE_BLOB_STORAGE` is false, it checks `USE_S3_STORAGE`. If true, it dynamically imports the S3 client and calls its `getPresignedUrlWithConfig` function (aliased). It converts the generic `CustomStorageConfig` to `CustomS3Config`.
*   If neither `USE_BLOB_STORAGE` nor `USE_S3_STORAGE` is true, it throws an error.

10. **`getStorageProvider` Function:**

```typescript
/**
 * Get the current storage provider name
 */
export function getStorageProvider(): 'blob' | 's3' | 'local' {
  if (USE_BLOB_STORAGE) return 'blob'
  if (USE_S3_STORAGE) return 's3'
  return 'local'
}
```

*   Returns the name of the current storage provider as a string ('blob', 's3', or 'local').  It checks the configuration flags to determine which provider is being used. "local" implies that neither cloud storage option is enabled.

11. **`isUsingCloudStorage` Function:**

```typescript
/**
 * Check if we're using cloud storage (either S3 or Blob)
 */
export function isUsingCloudStorage(): boolean {
  return USE_BLOB_STORAGE || USE_S3_STORAGE
}
```

*   Returns `true` if either Blob Storage or S3 is enabled, indicating that cloud storage is being used.  Returns `false` otherwise.

12. **`getServePathPrefix` Function:**

```typescript
/**
 * Get the appropriate serve path prefix based on storage provider
 */
export function getServePathPrefix(): string {
  if (USE_BLOB_STORAGE) return '/api/files/serve/blob/'
  if (USE_S3_STORAGE) return '/api/files/serve/s3/'
  return '/api/files/serve/'
}
```

*   Returns the appropriate prefix for serving files via an API, based on the storage provider. This is likely used for constructing URLs to access files.

## Simplification of Complex Logic

The code simplifies complex logic in several ways:

*   **Abstraction:** The `uploadFile`, `downloadFile`, `deleteFile`, and `getPresignedUrl` functions provide a single, consistent interface for interacting with either Blob Storage or S3.  The calling code doesn't need to know which storage provider is being used.
*   **Configuration-Driven:** The `USE_BLOB_STORAGE` and `USE_S3_STORAGE` flags centralize the storage provider configuration.  Switching between providers only requires changing these flags.
*   **Dynamic Imports:**  The use of dynamic imports (`import()`) improves performance by only loading the necessary storage client code when it's actually needed.  This reduces the initial bundle size.
*   **Type Safety:** The use of TypeScript types (`FileInfo`, `CustomStorageConfig`, `CustomBlobConfig`, `CustomS3Config`) ensures that the code is type-safe and less prone to errors.
*   **Function Overloading:** The `uploadFile` and `downloadFile` functions use function overloading to handle different argument lists, providing flexibility for the caller.
*   **Centralized Error Handling:** The `throw new Error(...)` block at the end of each function provides a consistent way to handle the case where no storage provider is configured.
*   **Logging:**  The `logger` instance is used to log storage operations, which helps with debugging and monitoring.
