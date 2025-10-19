```typescript
/**
 * Server-only execution file metadata management
 * This file contains database operations and should only be imported by server-side code
 */

import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import type { ExecutionFileMetadata } from './execution-files'

const logger = createLogger('ExecutionFilesServer')

/**
 * Retrieve file metadata from execution logs
 */
export async function getExecutionFiles(executionId: string): Promise<ExecutionFileMetadata[]> {
  try {
    const log = await db
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    if (log.length === 0) {
      return []
    }

    // Get files from the dedicated files column
    return (log[0].files as ExecutionFileMetadata[]) || []
  } catch (error) {
    logger.error(`Failed to retrieve file metadata for execution ${executionId}:`, error)
    return []
  }
}

/**
 * Store file metadata in execution logs
 */
export async function storeExecutionFiles(
  executionId: string,
  files: ExecutionFileMetadata[]
): Promise<void> {
  try {
    logger.info(`Storing ${files.length} file metadata entries for execution ${executionId}`)

    await db
      .update(workflowExecutionLogs)
      .set({ files })
      .where(eq(workflowExecutionLogs.executionId, executionId))

    logger.info(`Successfully stored file metadata for execution ${executionId}`)
  } catch (error) {
    logger.error(`Failed to store file metadata for execution ${executionId}:`, error)
    throw error
  }
}

/**
 * Add file metadata to existing execution logs
 */
export async function addExecutionFile(
  executionId: string,
  fileMetadata: ExecutionFileMetadata
): Promise<void> {
  try {
    // Get existing files
    const existingFiles = await getExecutionFiles(executionId)

    // Add new file
    const updatedFiles = [...existingFiles, fileMetadata]

    // Store updated files
    await storeExecutionFiles(executionId, updatedFiles)

    logger.info(`Added file ${fileMetadata.name} to execution ${executionId}`)
  } catch (error) {
    logger.error(`Failed to add file to execution ${executionId}:`, error)
    throw error
  }
}

/**
 * Get all expired files across all executions
 */
export async function getExpiredFiles(): Promise<ExecutionFileMetadata[]> {
  try {
    const now = new Date().toISOString()

    // Query all execution logs that have files
    const logs = await db
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.level, 'info')) // Only get successful executions

    const expiredFiles: ExecutionFileMetadata[] = []

    for (const log of logs) {
      const files = log.files as ExecutionFileMetadata[]
      if (files) {
        const expired = files.filter((file) => file.expiresAt < now)
        expiredFiles.push(...expired)
      }
    }

    return expiredFiles
  } catch (error) {
    logger.error('Failed to get expired files:', error)
    return []
  }
}

/**
 * Remove expired file metadata from execution logs
 */
export async function cleanupExpiredFileMetadata(): Promise<number> {
  try {
    const now = new Date().toISOString()
    let cleanedCount = 0

    // Get all execution logs
    const logs = await db.select().from(workflowExecutionLogs)

    for (const log of logs) {
      const files = log.files as ExecutionFileMetadata[]
      if (files && files.length > 0) {
        const nonExpiredFiles = files.filter((file) => file.expiresAt >= now)

        if (nonExpiredFiles.length !== files.length) {
          // Some files expired, update the files column
          await db
            .update(workflowExecutionLogs)
            .set({ files: nonExpiredFiles.length > 0 ? nonExpiredFiles : null })
            .where(eq(workflowExecutionLogs.id, log.id))

          cleanedCount += files.length - nonExpiredFiles.length
        }
      }
    }

    logger.info(`Cleaned up ${cleanedCount} expired file metadata entries`)
    return cleanedCount
  } catch (error) {
    logger.error('Failed to cleanup expired file metadata:', error)
    return 0
  }
}
```

### Purpose of this file:

This TypeScript file is designed for server-side execution only. It manages metadata related to files generated or used during workflow executions. The core functionality revolves around storing, retrieving, adding, and cleaning up file metadata associated with specific execution logs within a database. It explicitly avoids usage in client-side code, given the database interactions.

### Simplification of Complex Logic:

The code provides the following simplifications:

1.  **Centralized File Metadata Management**: It encapsulates all file metadata operations into a single module, promoting code reusability and maintainability.

2.  **Abstraction of Database Interactions**: The functions abstract the underlying database queries (using Drizzle ORM) into high-level operations like `getExecutionFiles`, `storeExecutionFiles`, etc.  This makes the code easier to understand and less prone to errors related to database specifics.

3.  **Clear Error Handling**: Each function includes a `try...catch` block to handle potential errors during database interactions, logging the error, and either returning a default value or re-throwing the error.

4. **Modular Functions:** The code is organized into small, focused functions, making it easier to understand the purpose of each function and how it interacts with the rest of the code.  For example, `addExecutionFile` reuses `getExecutionFiles` and `storeExecutionFiles`.

5.  **Logging**: The use of a logger provides insight into the operations performed by the functions.

### Explanation of each line of code:

```typescript
/**
 * Server-only execution file metadata management
 * This file contains database operations and should only be imported by server-side code
 */
```

*   **Documentation:** This is a multi-line comment explaining the purpose of the file. It emphasizes that this file is for server-side execution only and handles database operations.

```typescript
import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import type { ExecutionFileMetadata } from './execution-files'
```

*   **Imports:**
    *   `db`: Imports the database connection instance from `@sim/db`.  This is the connection that is used to run queries against the database.
    *   `workflowExecutionLogs`: Imports the schema definition for the `workflowExecutionLogs` table from `@sim/db/schema`. This defines the structure and type of data stored in the execution logs.
    *   `eq`: Imports the `eq` function from `drizzle-orm`. This function is used to create "equals" conditions in database queries (e.g., `WHERE executionId = '...'`). Drizzle ORM is being used as the database access layer.
    *   `createLogger`: Imports a function to create a logger instance from `@/lib/logs/console/logger`. This is used for logging information and errors.
    *   `ExecutionFileMetadata`: Imports a type definition for `ExecutionFileMetadata` from `./execution-files`. This defines the structure of the file metadata objects being managed.  The `type` keyword ensures that it is a type-only import that is removed during transpilation, which prevents potential issues with client-side code.

```typescript
const logger = createLogger('ExecutionFilesServer')
```

*   **Logger Initialization:** Creates a logger instance named `ExecutionFilesServer`. This logger will be used to record information, warnings, and errors within this module.

```typescript
/**
 * Retrieve file metadata from execution logs
 */
export async function getExecutionFiles(executionId: string): Promise<ExecutionFileMetadata[]> {
  try {
    const log = await db
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    if (log.length === 0) {
      return []
    }

    // Get files from the dedicated files column
    return (log[0].files as ExecutionFileMetadata[]) || []
  } catch (error) {
    logger.error(`Failed to retrieve file metadata for execution ${executionId}:`, error)
    return []
  }
}
```

*   **`getExecutionFiles` Function:**
    *   **Purpose:** Retrieves the file metadata associated with a specific execution ID from the `workflowExecutionLogs` table.
    *   **Parameters:** `executionId` (string): The ID of the execution to retrieve files for.
    *   **Return Value:** `Promise<ExecutionFileMetadata[]>`: A promise that resolves to an array of `ExecutionFileMetadata` objects. Returns an empty array if no logs are found or if an error occurs.
    *   **Logic:**
        *   `db.select().from(workflowExecutionLogs).where(eq(workflowExecutionLogs.executionId, executionId)).limit(1)`:  Constructs a database query using Drizzle ORM:
            *   `db.select()`: Selects all columns from the table.
            *   `from(workflowExecutionLogs)`: Specifies the `workflowExecutionLogs` table as the source.
            *   `where(eq(workflowExecutionLogs.executionId, executionId))`: Filters the results to only include rows where the `executionId` column matches the provided `executionId`.
            *   `limit(1)`: Limits the result set to a single row.  This optimizes the query since we only expect one log entry per execution ID.
        *   `if (log.length === 0) { return [] }`: Checks if any logs were found for the given `executionId`. If not, it returns an empty array.
        *   `return (log[0].files as ExecutionFileMetadata[]) || []`: Retrieves the `files` column from the first (and only) log entry.  It performs a type assertion (`as ExecutionFileMetadata[]`) to treat the `files` column as an array of `ExecutionFileMetadata` objects, assuming the database stores it as a serialized JSON array. The `|| []` provides a default empty array in case the `files` column is null or undefined.
        *   `try...catch`: Handles potential errors during the database query. If an error occurs, it logs the error using the `logger` and returns an empty array.

```typescript
/**
 * Store file metadata in execution logs
 */
export async function storeExecutionFiles(
  executionId: string,
  files: ExecutionFileMetadata[]
): Promise<void> {
  try {
    logger.info(`Storing ${files.length} file metadata entries for execution ${executionId}`)

    await db
      .update(workflowExecutionLogs)
      .set({ files })
      .where(eq(workflowExecutionLogs.executionId, executionId))

    logger.info(`Successfully stored file metadata for execution ${executionId}`)
  } catch (error) {
    logger.error(`Failed to store file metadata for execution ${executionId}:`, error)
    throw error
  }
}
```

*   **`storeExecutionFiles` Function:**
    *   **Purpose:** Stores or updates file metadata for a specific execution ID in the `workflowExecutionLogs` table.
    *   **Parameters:**
        *   `executionId` (string): The ID of the execution to store files for.
        *   `files` (`ExecutionFileMetadata[]`): An array of `ExecutionFileMetadata` objects to store.
    *   **Return Value:** `Promise<void>`: A promise that resolves when the operation is complete.
    *   **Logic:**
        *   `logger.info(...)`: Logs information about the number of files being stored.
        *   `db.update(workflowExecutionLogs).set({ files }).where(eq(workflowExecutionLogs.executionId, executionId))`: Constructs a database update query:
            *   `db.update(workflowExecutionLogs)`: Specifies that we are updating the `workflowExecutionLogs` table.
            *   `set({ files })`: Sets the `files` column to the provided `files` array. Drizzle ORM will handle serializing this array to JSON for storage.
            *   `where(eq(workflowExecutionLogs.executionId, executionId))`: Filters the update to only apply to the row where the `executionId` column matches the provided `executionId`.
        *   `logger.info(...)`: Logs a success message.
        *   `try...catch`: Handles potential errors during the database update. If an error occurs, it logs the error and re-throws it, allowing the calling function to handle the error appropriately.

```typescript
/**
 * Add file metadata to existing execution logs
 */
export async function addExecutionFile(
  executionId: string,
  fileMetadata: ExecutionFileMetadata
): Promise<void> {
  try {
    // Get existing files
    const existingFiles = await getExecutionFiles(executionId)

    // Add new file
    const updatedFiles = [...existingFiles, fileMetadata]

    // Store updated files
    await storeExecutionFiles(executionId, updatedFiles)

    logger.info(`Added file ${fileMetadata.name} to execution ${executionId}`)
  } catch (error) {
    logger.error(`Failed to add file to execution ${executionId}:`, error)
    throw error
  }
}
```

*   **`addExecutionFile` Function:**
    *   **Purpose:** Adds a new file metadata entry to the existing list of file metadata for a specific execution ID.
    *   **Parameters:**
        *   `executionId` (string): The ID of the execution.
        *   `fileMetadata` (`ExecutionFileMetadata`): The file metadata to add.
    *   **Return Value:** `Promise<void>`: A promise that resolves when the operation is complete.
    *   **Logic:**
        *   `const existingFiles = await getExecutionFiles(executionId)`: Retrieves the existing file metadata for the given execution ID using the `getExecutionFiles` function.
        *   `const updatedFiles = [...existingFiles, fileMetadata]`: Creates a new array containing all the existing file metadata and the new `fileMetadata` entry. This uses the spread operator (`...`) to create a copy of the `existingFiles` array.
        *   `await storeExecutionFiles(executionId, updatedFiles)`: Stores the updated file metadata array in the database using the `storeExecutionFiles` function.
        *   `logger.info(...)`: Logs a success message.
        *   `try...catch`: Handles potential errors, logging and re-throwing them.

```typescript
/**
 * Get all expired files across all executions
 */
export async function getExpiredFiles(): Promise<ExecutionFileMetadata[]> {
  try {
    const now = new Date().toISOString()

    // Query all execution logs that have files
    const logs = await db
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.level, 'info')) // Only get successful executions

    const expiredFiles: ExecutionFileMetadata[] = []

    for (const log of logs) {
      const files = log.files as ExecutionFileMetadata[]
      if (files) {
        const expired = files.filter((file) => file.expiresAt < now)
        expiredFiles.push(...expired)
      }
    }

    return expiredFiles
  } catch (error) {
    logger.error('Failed to get expired files:', error)
    return []
  }
}
```

*   **`getExpiredFiles` Function:**
    *   **Purpose:** Retrieves all file metadata entries that have expired across all executions.
    *   **Return Value:** `Promise<ExecutionFileMetadata[]>`:  A promise resolving to an array of `ExecutionFileMetadata` objects representing expired files.  Returns an empty array on error.
    *   **Logic:**
        *   `const now = new Date().toISOString()`: Gets the current date and time in ISO string format. This will be used to compare against the `expiresAt` property of the file metadata.
        *   `const logs = await db.select().from(workflowExecutionLogs).where(eq(workflowExecutionLogs.level, 'info'))`: Retrieves all execution logs from the database using Drizzle ORM.  It filters only for logs with `level` set to `info` which are considered successful.
        *   The code then iterates through each log entry and filters the associated files, adding expired files to the `expiredFiles` array.  It uses `.push(...expired)` to add all expired files from the `expired` array to the `expiredFiles` array.
        *   `try...catch`: Handles potential errors, logging them and returning an empty array.

```typescript
/**
 * Remove expired file metadata from execution logs
 */
export async function cleanupExpiredFileMetadata(): Promise<number> {
  try {
    const now = new Date().toISOString()
    let cleanedCount = 0

    // Get all execution logs
    const logs = await db.select().from(workflowExecutionLogs)

    for (const log of logs) {
      const files = log.files as ExecutionFileMetadata[]
      if (files && files.length > 0) {
        const nonExpiredFiles = files.filter((file) => file.expiresAt >= now)

        if (nonExpiredFiles.length !== files.length) {
          // Some files expired, update the files column
          await db
            .update(workflowExecutionLogs)
            .set({ files: nonExpiredFiles.length > 0 ? nonExpiredFiles : null })
            .where(eq(workflowExecutionLogs.id, log.id))

          cleanedCount += files.length - nonExpiredFiles.length
        }
      }
    }

    logger.info(`Cleaned up ${cleanedCount} expired file metadata entries`)
    return cleanedCount
  } catch (error) {
    logger.error('Failed to cleanup expired file metadata:', error)
    return 0
  }
}
```

*   **`cleanupExpiredFileMetadata` Function:**
    *   **Purpose:** Removes expired file metadata from the execution logs in the database.
    *   **Return Value:** `Promise<number>`:  A promise resolving to the number of file metadata entries that were cleaned up (removed). Returns 0 on error.
    *   **Logic:**
        *   `const now = new Date().toISOString()`: Gets the current date and time in ISO string format, used for expiration comparison.
        *   `let cleanedCount = 0`: Initializes a counter to track the number of cleaned-up file metadata entries.
        *   `const logs = await db.select().from(workflowExecutionLogs)`: Retrieves all execution logs from the database.
        *   The code then iterates through each log.  For each log entry, it filters the files, keeping only the non-expired files. If the number of non-expired files is different from the original number of files, it means some files have expired.
        *   `await db.update(workflowExecutionLogs).set({ files: nonExpiredFiles.length > 0 ? nonExpiredFiles : null }).where(eq(workflowExecutionLogs.id, log.id))`: Updates the `files` column in the database for the current log entry. If there are non-expired files, the `files` column is set to the new array of non-expired files.  If *all* files have expired, the `files` column is set to `null`.
        *   `cleanedCount += files.length - nonExpiredFiles.length`: Increments the `cleanedCount` by the number of expired files.
        *   `logger.info(...)`: Logs the number of cleaned-up entries.
        *   `try...catch`: Handles errors, logging and returning 0.

In summary, this file provides a set of functions for managing file metadata associated with workflow executions, including storing, retrieving, adding, and cleaning up expired entries. It emphasizes server-side execution, database interactions, and error handling.  The `drizzle-orm` library is used to type-safely construct and execute database queries.
