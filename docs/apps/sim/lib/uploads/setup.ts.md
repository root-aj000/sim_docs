```typescript
import { env } from '@/lib/env'

// Client-safe configuration - no Node.js modules
export const UPLOAD_DIR = '/uploads'

// Check if S3 is configured (has required credentials)
const hasS3Config = !!(env.S3_BUCKET_NAME && env.AWS_REGION)

// Check if Azure Blob is configured (has required credentials)
const hasBlobConfig = !!(
  env.AZURE_STORAGE_CONTAINER_NAME &&
  ((env.AZURE_ACCOUNT_NAME && env.AZURE_ACCOUNT_KEY) || env.AZURE_CONNECTION_STRING)
)

// Storage configuration flags - auto-detect based on available credentials
// Priority: Blob > S3 > Local (if both are configured, Blob takes priority)
export const USE_BLOB_STORAGE = hasBlobConfig
export const USE_S3_STORAGE = hasS3Config && !USE_BLOB_STORAGE

export const S3_CONFIG = {
  bucket: env.S3_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

export const BLOB_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_CONTAINER_NAME || '',
}

export const S3_KB_CONFIG = {
  bucket: env.S3_KB_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

export const S3_EXECUTION_FILES_CONFIG = {
  bucket: env.S3_EXECUTION_FILES_BUCKET_NAME || 'sim-execution-files',
  region: env.AWS_REGION || '',
}

export const BLOB_KB_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_KB_CONTAINER_NAME || '',
}

export const BLOB_EXECUTION_FILES_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_EXECUTION_FILES_CONTAINER_NAME || 'sim-execution-files',
}

export const S3_CHAT_CONFIG = {
  bucket: env.S3_CHAT_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

export const BLOB_CHAT_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_CHAT_CONTAINER_NAME || '',
}

export const S3_COPILOT_CONFIG = {
  bucket: env.S3_COPILOT_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

export const BLOB_COPILOT_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_COPILOT_CONTAINER_NAME || '',
}

export const S3_PROFILE_PICTURES_CONFIG = {
  bucket: env.S3_PROFILE_PICTURES_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

export const BLOB_PROFILE_PICTURES_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_PROFILE_PICTURES_CONTAINER_NAME || '',
}

/**
 * Get the current storage provider as a human-readable string
 */
export function getStorageProvider(): 'Azure Blob' | 'S3' | 'Local' {
  if (USE_BLOB_STORAGE) return 'Azure Blob'
  if (USE_S3_STORAGE) return 'S3'
  return 'Local'
}

/**
 * Check if we're using any cloud storage (S3 or Blob)
 */
export function isUsingCloudStorage(): boolean {
  return USE_S3_STORAGE || USE_BLOB_STORAGE
}
```

### Purpose of this file

This TypeScript file is designed to manage the configuration of different storage options for an application. It supports storing files locally, on Amazon S3, or on Azure Blob Storage. The file determines which storage provider to use based on environment variables and provides configuration objects for each provider. The code prioritizes Azure Blob storage over S3 if both are configured. It also includes utility functions to determine the active storage provider and whether cloud storage is being used.

### Explanation of each line of code

1.  **`import { env } from '@/lib/env'`**

    *   **Purpose:** Imports the `env` object from the specified path. The `env` object is assumed to contain environment variables loaded from a `.env` file or the system environment. This is a common pattern for accessing configuration values in Node.js applications.
    *   **Details:**  The `@/lib/env` path suggests a structure where environment variables are managed within a dedicated module.

2.  **`export const UPLOAD_DIR = '/uploads'`**

    *   **Purpose:** Defines a constant variable `UPLOAD_DIR` and exports it. This variable stores the directory where uploaded files will be stored locally (or a relative path for other storage systems).
    *   **Details:**  This is considered a client-safe configuration because it doesn't contain sensitive information or Node.js specific code that should be kept on the server.

3.  **`const hasS3Config = !!(env.S3_BUCKET_NAME && env.AWS_REGION)`**

    *   **Purpose:** Determines if S3 storage is configured by checking if the `S3_BUCKET_NAME` and `AWS_REGION` environment variables are defined.
    *   **Details:**
        *   `env.S3_BUCKET_NAME && env.AWS_REGION`:  This part checks if both environment variables have truthy values (are not `null`, `undefined`, `''`, `0`, `false`).
        *   `!!(...)`: The double negation (`!!`) converts the result of the boolean expression to a boolean value.  This ensures `hasS3Config` is explicitly `true` or `false`.

4.  **`const hasBlobConfig = !!(` ... `)`**

    *   **Purpose:** Determines if Azure Blob Storage is configured. It checks if the `AZURE_STORAGE_CONTAINER_NAME` is defined and either both `AZURE_ACCOUNT_NAME` and `AZURE_ACCOUNT_KEY` are defined, or the `AZURE_CONNECTION_STRING` is defined.
    *   **Details:**
        *   `env.AZURE_STORAGE_CONTAINER_NAME`: Checks if the container name is defined.
        *   `((env.AZURE_ACCOUNT_NAME && env.AZURE_ACCOUNT_KEY) || env.AZURE_CONNECTION_STRING)`: This checks if either:
            *   Both the account name and account key are defined.
            *   The connection string is defined.
        *   `!!(...)`: Ensures that the result is explicitly a boolean value (`true` or `false`).

5.  **`export const USE_BLOB_STORAGE = hasBlobConfig`**

    *   **Purpose:** Exports a constant boolean variable `USE_BLOB_STORAGE` which is assigned the value of `hasBlobConfig`. This flag indicates whether Azure Blob Storage should be used.

6.  **`export const USE_S3_STORAGE = hasS3Config && !USE_BLOB_STORAGE`**

    *   **Purpose:** Exports a constant boolean variable `USE_S3_STORAGE`. S3 storage is enabled only if S3 is configured (`hasS3Config` is `true`) and Azure Blob storage is *not* enabled (`!USE_BLOB_STORAGE` is `true`). This prioritizes Blob storage if both are configured.

7.  **`export const S3_CONFIG = { ... }`**

    *   **Purpose:** Exports a constant object `S3_CONFIG` containing the configuration for S3 storage.
    *   **Details:**
        *   `bucket: env.S3_BUCKET_NAME || ''`:  Sets the `bucket` property to the value of the `S3_BUCKET_NAME` environment variable. If the environment variable is not defined, it defaults to an empty string (`''`).
        *   `region: env.AWS_REGION || ''`: Sets the `region` property to the value of the `AWS_REGION` environment variable. If the environment variable is not defined, it defaults to an empty string (`''`).

8.  **`export const BLOB_CONFIG = { ... }`**

    *   **Purpose:** Exports a constant object `BLOB_CONFIG` containing the configuration for Azure Blob Storage.
    *   **Details:**  Similar to `S3_CONFIG`, it retrieves configuration values from environment variables and provides default empty strings if the environment variables are not defined. It includes the account name, account key, connection string, and container name.

9.  **`export const S3_KB_CONFIG = { ... }`**, **`export const S3_EXECUTION_FILES_CONFIG = { ... }`**,  **`export const S3_CHAT_CONFIG = { ... }`**, **`export const S3_COPILOT_CONFIG = { ... }`**, **`export const S3_PROFILE_PICTURES_CONFIG = { ... }`**

    *   **Purpose:** Exports constant objects containing configuration for S3 storage, but for specific use cases (KB, execution files, chat, copilot, profile pictures).  They follow the same pattern as `S3_CONFIG`.
    *   **Details:** These configurations allow the application to use different S3 buckets for different types of data.
    *    `bucket: env.S3_EXECUTION_FILES_BUCKET_NAME || 'sim-execution-files'`: Note that `S3_EXECUTION_FILES_CONFIG` defaults the bucket name to `sim-execution-files`.

10. **`export const BLOB_KB_CONFIG = { ... }`**, **`export const BLOB_EXECUTION_FILES_CONFIG = { ... }`**,  **`export const BLOB_CHAT_CONFIG = { ... }`**, **`export const BLOB_COPILOT_CONFIG = { ... }`**, **`export const BLOB_PROFILE_PICTURES_CONFIG = { ... }`**

    *   **Purpose:** Exports constant objects containing configuration for Azure Blob Storage, but for specific use cases (KB, execution files, chat, copilot, profile pictures). They follow the same pattern as `BLOB_CONFIG`.
    *   **Details:** These configurations allow the application to use different Azure Blob containers for different types of data.
    *   `containerName: env.AZURE_STORAGE_EXECUTION_FILES_CONTAINER_NAME || 'sim-execution-files'` - same as above, but for azure blob storage.

11. **`export function getStorageProvider(): 'Azure Blob' | 'S3' | 'Local' { ... }`**

    *   **Purpose:** Defines and exports a function `getStorageProvider` that returns a string indicating which storage provider is currently in use.
    *   **Details:**
        *   `(): 'Azure Blob' | 'S3' | 'Local'`: This is the function signature.  It defines the return type as a string literal type, meaning the function can only return one of these three string values.
        *   It uses `USE_BLOB_STORAGE` and `USE_S3_STORAGE` to determine the provider. If neither is enabled, it returns 'Local'.

12. **`export function isUsingCloudStorage(): boolean { ... }`**

    *   **Purpose:** Defines and exports a function `isUsingCloudStorage` that returns `true` if either S3 or Azure Blob Storage is being used, and `false` otherwise.
    *   **Details:**
        *   `(): boolean`: Specifies that the function returns a boolean value.
        *   `return USE_S3_STORAGE || USE_BLOB_STORAGE`: Returns `true` if either `USE_S3_STORAGE` or `USE_BLOB_STORAGE` is `true`.

### Simplification and Key Takeaways

The code essentially configures different storage options (local, S3, Azure Blob) based on environment variables. Here's a simplified breakdown:

1.  **Configuration Loading:** It loads configuration settings like bucket names, regions, account details, etc., from environment variables using `env`.
2.  **Provider Detection:** It determines whether S3 or Azure Blob storage are configured by checking for the presence of the necessary environment variables.
3.  **Priority:**  It establishes a priority for storage providers: Azure Blob > S3 > Local. If both Blob and S3 are configured, Blob is used.
4.  **Configuration Objects:**  It creates configuration objects (`S3_CONFIG`, `BLOB_CONFIG`, etc.) that can be used to initialize the storage clients later in the application. These config objects are also broken out into specific use cases for various aspects of the application, such as storing chatbot conversations, copilot data, or execution files.
5.  **Utility Functions:**  It provides helper functions to determine the active storage provider (`getStorageProvider`) and whether cloud storage is in use (`isUsingCloudStorage`).

The code is well-structured and easy to understand. The use of boolean flags (`USE_BLOB_STORAGE`, `USE_S3_STORAGE`) and configuration objects makes it easy to switch between different storage options and manage their settings. The priority logic ensures that the application uses the preferred storage provider if it's available.  The use of default values ensures that the application doesn't crash if any of the required variables are missing.
