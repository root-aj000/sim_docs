```typescript
import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import path, { join } from 'path'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { getStorageProvider, USE_BLOB_STORAGE, USE_S3_STORAGE } from '@/lib/uploads/setup'

const logger = createLogger('UploadsSetup')

// Server-only upload directory path
const PROJECT_ROOT = path.resolve(process.cwd())
export const UPLOAD_DIR_SERVER = join(PROJECT_ROOT, 'uploads')

/**
 * Server-only function to ensure uploads directory exists
 */
export async function ensureUploadsDirectory() {
  if (USE_S3_STORAGE) {
    logger.info('Using S3 storage, skipping local uploads directory creation')
    return true
  }

  if (USE_BLOB_STORAGE) {
    logger.info('Using Azure Blob storage, skipping local uploads directory creation')
    return true
  }

  try {
    if (!existsSync(UPLOAD_DIR_SERVER)) {
      await mkdir(UPLOAD_DIR_SERVER, { recursive: true })
    } else {
      logger.info(`Uploads directory already exists at ${UPLOAD_DIR_SERVER}`)
    }
    return true
  } catch (error) {
    logger.error('Failed to create uploads directory:', error)
    return false
  }
}

// Immediately invoke on server startup
if (typeof process !== 'undefined') {
  const storageProvider = getStorageProvider()

  // Log storage mode
  logger.info(`Storage provider: ${storageProvider}`)

  if (USE_BLOB_STORAGE) {
    // Verify Azure Blob credentials
    if (!env.AZURE_STORAGE_CONTAINER_NAME) {
      logger.warn('Azure Blob storage is enabled but AZURE_STORAGE_CONTAINER_NAME is not set')
    } else if (!env.AZURE_ACCOUNT_NAME && !env.AZURE_CONNECTION_STRING) {
      logger.warn(
        'Azure Blob storage is enabled but neither AZURE_ACCOUNT_NAME nor AZURE_CONNECTION_STRING is set'
      )
      logger.warn(
        'Set AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY or AZURE_CONNECTION_STRING for Azure Blob storage'
      )
    } else if (env.AZURE_ACCOUNT_NAME && !env.AZURE_ACCOUNT_KEY && !env.AZURE_CONNECTION_STRING) {
      logger.warn(
        'AZURE_ACCOUNT_NAME is set but AZURE_ACCOUNT_KEY is missing and no AZURE_CONNECTION_STRING provided'
      )
      logger.warn('Set AZURE_ACCOUNT_KEY or use AZURE_CONNECTION_STRING for authentication')
    } else {
      logger.info('Azure Blob storage credentials found in environment variables')
      if (env.AZURE_CONNECTION_STRING) {
        logger.info('Using Azure connection string for authentication')
      } else {
        logger.info('Using Azure account name and key for authentication')
      }
    }
  } else if (USE_S3_STORAGE) {
    // Verify AWS credentials
    if (!env.S3_BUCKET_NAME || !env.AWS_REGION) {
      logger.warn('S3 storage configuration is incomplete')
      logger.warn('Set S3_BUCKET_NAME and AWS_REGION for S3 storage')
    } else if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      logger.warn('AWS credentials are not set in environment variables')
      logger.warn('Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY for S3 storage')
    } else {
      logger.info('AWS S3 credentials found in environment variables')
    }
  } else {
    // Local storage mode
    logger.info('Using local file storage')

    // Only initialize local uploads directory when using local storage
    ensureUploadsDirectory().then((success) => {
      if (success) {
        logger.info('Local uploads directory initialized')
      } else {
        logger.error('Failed to initialize local uploads directory')
      }
    })
  }

  // Log additional configuration details
  if (USE_BLOB_STORAGE && env.AZURE_STORAGE_KB_CONTAINER_NAME) {
    logger.info(`Azure Blob knowledge base container: ${env.AZURE_STORAGE_KB_CONTAINER_NAME}`)
  }
  if (USE_BLOB_STORAGE && env.AZURE_STORAGE_COPILOT_CONTAINER_NAME) {
    logger.info(`Azure Blob copilot container: ${env.AZURE_STORAGE_COPILOT_CONTAINER_NAME}`)
  }
  if (USE_S3_STORAGE && env.S3_KB_BUCKET_NAME) {
    logger.info(`S3 knowledge base bucket: ${env.S3_KB_BUCKET_NAME}`)
  }
  if (USE_S3_STORAGE && env.S3_COPILOT_BUCKET_NAME) {
    logger.info(`S3 copilot bucket: ${env.S3_COPILOT_BUCKET_NAME}`)
  }
}

export default ensureUploadsDirectory
```

### Purpose of this file
This TypeScript file is responsible for setting up and configuring the storage system used by the application for file uploads. It handles the following:

1.  **Determining the storage provider:** It checks whether the application should use local file storage, Azure Blob storage, or AWS S3 storage based on environment variables.
2.  **Initializing the storage:** If using local file storage, it ensures that the `uploads` directory exists.  If using cloud storage, it validates that the required environment variables for the selected cloud provider are set.
3.  **Logging configuration details:** It logs information about the selected storage provider and related configuration, which is valuable for debugging and monitoring.
4.  **Credentials Validation:** It validates required credentials.

### Explanation of each line of code

**Imports:**

*   `import { existsSync } from 'fs'`: Imports the `existsSync` function from the `fs` (file system) module.  `existsSync` is a synchronous function that checks if a file or directory exists.
*   `import { mkdir } from 'fs/promises'`: Imports the `mkdir` function from the `fs/promises` module. This provides a promise-based asynchronous version of `mkdir`, allowing you to create directories.
*   `import path, { join } from 'path'`: Imports the `path` module and the `join` function from it. The `path` module provides utilities for working with file and directory paths. The `join` function joins path segments into a single path.
*   `import { env } from '@/lib/env'`: Imports the `env` object from the `@/lib/env` module. This object likely contains environment variables used throughout the application.  The `@` alias suggests this is part of the application's source directory structure.
*   `import { createLogger } from '@/lib/logs/console/logger'`: Imports the `createLogger` function from the `@/lib/logs/console/logger` module. This function is used to create a logger instance for the file, allowing for structured logging.
*   `import { getStorageProvider, USE_BLOB_STORAGE, USE_S3_STORAGE } from '@/lib/uploads/setup'`: Imports constants and a function related to storage provider configuration. `USE_BLOB_STORAGE` and `USE_S3_STORAGE` are likely boolean constants determining which storage mechanism to use.  `getStorageProvider` probably returns a string indicating the configured storage.

**Logger Initialization:**

*   `const logger = createLogger('UploadsSetup')`: Creates a logger instance named 'UploadsSetup'.  All logs generated in this file will be tagged with this name, making it easier to filter and analyze logs.

**Upload Directory Path Definition:**

*   `const PROJECT_ROOT = path.resolve(process.cwd())`: Determines the project's root directory. `process.cwd()` returns the current working directory, and `path.resolve()` resolves it to an absolute path.
*   `export const UPLOAD_DIR_SERVER = join(PROJECT_ROOT, 'uploads')`: Defines the path to the uploads directory. It joins the project root with the string 'uploads' to create the full path.  This path is exported so other parts of the application can access it.

**`ensureUploadsDirectory` Function:**

*   `export async function ensureUploadsDirectory() { ... }`: Defines an asynchronous function that ensures the local uploads directory exists.
*   `if (USE_S3_STORAGE) { ... }`: Checks if S3 storage is enabled via the `USE_S3_STORAGE` constant. If true, it logs a message and returns `true`, indicating that no local directory creation is needed.
*   `if (USE_BLOB_STORAGE) { ... }`: Similar to the S3 check, this checks if Azure Blob storage is enabled.  If true, it logs a message and returns `true`.
*   `try { ... } catch (error) { ... }`:  A try-catch block is used to handle potential errors during directory creation.
*   `if (!existsSync(UPLOAD_DIR_SERVER)) { ... }`: Checks if the uploads directory already exists using `existsSync`. The `!` negates the result, so the code inside the `if` block executes if the directory *does not* exist.
*   `await mkdir(UPLOAD_DIR_SERVER, { recursive: true })`: Creates the uploads directory asynchronously using `mkdir`.  The `{ recursive: true }` option ensures that any necessary parent directories are also created.
*   `else { logger.info(...) }`: If the directory already exists, a message is logged.
*   `return true`: Returns `true` to indicate that the directory was successfully created or already existed.
*   `logger.error('Failed to create uploads directory:', error)`: If an error occurs during directory creation, an error message is logged.
*   `return false`: Returns `false` to indicate that directory creation failed.

**Server Startup Logic:**

*   `if (typeof process !== 'undefined') { ... }`: This conditional statement ensures that the code within the block is executed only in a server-side environment (Node.js).  The `typeof process !== 'undefined'` check verifies that the `process` global variable, which is only available in Node.js, is defined.  This prevents the code from running in a browser environment.
*   `const storageProvider = getStorageProvider()`: Calls the `getStorageProvider` function (imported earlier) to determine which storage provider is being used.
*   `logger.info(\`Storage provider: ${storageProvider}\`)`: Logs the selected storage provider.
*   `if (USE_BLOB_STORAGE) { ... }`: Conditional block that runs if Azure Blob storage is enabled. Inside, it verifies crucial environment variables.
*   `if (!env.AZURE_STORAGE_CONTAINER_NAME) { ... }`: Checks if the `AZURE_STORAGE_CONTAINER_NAME` environment variable is set. If not, a warning message is logged.
*   `else if (!env.AZURE_ACCOUNT_NAME && !env.AZURE_CONNECTION_STRING) { ... }`: Checks if either `AZURE_ACCOUNT_NAME` and `AZURE_ACCOUNT_KEY` or `AZURE_CONNECTION_STRING` are set. If neither is set, a warning message is logged.
*   `else if (env.AZURE_ACCOUNT_NAME && !env.AZURE_ACCOUNT_KEY && !env.AZURE_CONNECTION_STRING) { ... }`: Checks if `AZURE_ACCOUNT_NAME` is set but `AZURE_ACCOUNT_KEY` and `AZURE_CONNECTION_STRING` are not set.  If this is the case, logs a warning that the key is missing.
*   `else { logger.info(...) }`: If all required Azure Blob storage environment variables are set, an informational message is logged.
*   `if (env.AZURE_CONNECTION_STRING) { ... } else { ... }`: Logs whether an Azure connection string is being used for authentication, or the individual account name and key.
*   `else if (USE_S3_STORAGE) { ... }`: Conditional block that runs if S3 storage is enabled.  Inside, it verifies environment variables.
*   `if (!env.S3_BUCKET_NAME || !env.AWS_REGION) { ... }`: Checks if the `S3_BUCKET_NAME` and `AWS_REGION` environment variables are set.  If not, a warning message is logged.
*   `else if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) { ... }`: Checks if the `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables are set.  If not, a warning message is logged.
*   `else { logger.info(...) }`: If all required S3 storage environment variables are set, an informational message is logged.
*   `else { ... }`: Conditional block that runs if neither Azure Blob nor S3 storage is enabled, indicating that local file storage is being used.
*   `logger.info('Using local file storage')`: Logs a message indicating that local file storage is being used.
*   `ensureUploadsDirectory().then((success) => { ... })`: Calls the `ensureUploadsDirectory` function to create the local uploads directory (if it doesn't exist).  The `.then()` method is used to handle the promise returned by the asynchronous function.
*   `if (success) { logger.info(...) } else { logger.error(...) }`: Logs a message indicating whether the local uploads directory was successfully initialized.
*   Logging Additional Configuration Details: These blocks log the values of additional container/bucket names for KB (Knowledge Base) and Copilot features, if they are configured. This is useful to confirm that the correct storage locations are being used.  The logs are conditional based on whether Blob or S3 storage is in use and if the corresponding env variable is defined.

**Export Default:**

*   `export default ensureUploadsDirectory`: Exports the `ensureUploadsDirectory` function as the default export of the module. This allows other modules to easily import and use this function.

### Simplification of complex logic:
The logic within this file is already fairly well-structured and understandable. However, we can improve readability in a few ways:

1.  **Environment Variable Validation Functions:** You could extract the environment variable validation logic for Azure and S3 into separate, reusable functions. This would make the main logic easier to follow and improve testability.

    ```typescript
    function validateAzureCredentials() {
      if (!env.AZURE_STORAGE_CONTAINER_NAME) {
        logger.warn('Azure Blob storage is enabled but AZURE_STORAGE_CONTAINER_NAME is not set')
        return false
      }
      if (!env.AZURE_ACCOUNT_NAME && !env.AZURE_CONNECTION_STRING) {
        logger.warn(
          'Azure Blob storage is enabled but neither AZURE_ACCOUNT_NAME nor AZURE_CONNECTION_STRING is set'
        )
        logger.warn(
          'Set AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY or AZURE_CONNECTION_STRING for Azure Blob storage'
        )
        return false
      }
      if (env.AZURE_ACCOUNT_NAME && !env.AZURE_ACCOUNT_KEY && !env.AZURE_CONNECTION_STRING) {
        logger.warn(
          'AZURE_ACCOUNT_NAME is set but AZURE_ACCOUNT_KEY is missing and no AZURE_CONNECTION_STRING provided'
        )
        logger.warn('Set AZURE_ACCOUNT_KEY or use AZURE_CONNECTION_STRING for authentication')
        return false
      }

      logger.info('Azure Blob storage credentials found in environment variables')
      if (env.AZURE_CONNECTION_STRING) {
        logger.info('Using Azure connection string for authentication')
      } else {
        logger.info('Using Azure account name and key for authentication')
      }
      return true
    }

    function validateS3Credentials() {
      if (!env.S3_BUCKET_NAME || !env.AWS_REGION) {
        logger.warn('S3 storage configuration is incomplete')
        logger.warn('Set S3_BUCKET_NAME and AWS_REGION for S3 storage')
        return false
      }
      if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
        logger.warn('AWS credentials are not set in environment variables')
        logger.warn('Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY for S3 storage')
        return false
      }

      logger.info('AWS S3 credentials found in environment variables')
      return true
    }

    // And then in the main block:
    if (USE_BLOB_STORAGE) {
      validateAzureCredentials();
    } else if (USE_S3_STORAGE) {
      validateS3Credentials();
    }
    ```

2.  **Early Exits:** For validation, you could employ "early exits".  If validation fails, log the warning and immediately return (or throw an error, depending on how critical the validation is).  This reduces nesting.  In the provided example, I've converted validation to return a boolean indicating success/failure.

By implementing these changes, the code becomes more modular, testable, and easier to understand, improving its overall maintainability.
