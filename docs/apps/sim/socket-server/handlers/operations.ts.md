```typescript
import { ZodError } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { persistWorkflowOperation } from '@/socket-server/database/operations'
import type { HandlerDependencies } from '@/socket-server/handlers/workflow'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'
import { checkRolePermission } from '@/socket-server/middleware/permissions'
import type { RoomManager } from '@/socket-server/rooms/manager'
import { WorkflowOperationSchema } from '@/socket-server/validation/schemas'

const logger = createLogger('OperationsHandlers')

export function setupOperationsHandlers(
  socket: AuthenticatedSocket,
  deps: HandlerDependencies | RoomManager
) {
  const roomManager =
    deps instanceof Object && 'roomManager' in deps ? deps.roomManager : (deps as RoomManager)
  socket.on('workflow-operation', async (data) => {
    const workflowId = roomManager.getWorkflowIdForSocket(socket.id)
    const session = roomManager.getUserSession(socket.id)

    if (!workflowId || !session) {
      socket.emit('error', {
        type: 'NOT_JOINED',
        message: 'Not joined to any workflow',
      })
      return
    }

    const room = roomManager.getWorkflowRoom(workflowId)
    if (!room) {
      socket.emit('error', {
        type: 'ROOM_NOT_FOUND',
        message: 'Workflow room not found',
      })
      return
    }

    let operationId: string | undefined

    try {
      const validatedOperation = WorkflowOperationSchema.parse(data)
      operationId = validatedOperation.operationId
      const { operation, target, payload, timestamp } = validatedOperation

      // For position updates, preserve client timestamp to maintain ordering
      // For other operations, use server timestamp for consistency
      const isPositionUpdate = operation === 'update-position' && target === 'block'
      const commitPositionUpdate =
        isPositionUpdate && 'commit' in payload ? payload.commit === true : false
      const operationTimestamp = isPositionUpdate ? timestamp : Date.now()

      // Skip permission checks for non-committed position updates (broadcasts only, no persistence)
      if (isPositionUpdate && !commitPositionUpdate) {
        // Update last activity
        const userPresence = room.users.get(socket.id)
        if (userPresence) {
          userPresence.lastActivity = Date.now()
        }
      } else {
        // Check permissions from cached role for all other operations
        const userPresence = room.users.get(socket.id)
        if (!userPresence) {
          logger.warn(`User presence not found for socket ${socket.id}`)
          socket.emit('operation-forbidden', {
            type: 'SESSION_ERROR',
            message: 'User session not found',
            operation,
            target,
          })
          return
        }

        userPresence.lastActivity = Date.now()

        // Check permissions using cached role (no DB query)
        const permissionCheck = checkRolePermission(userPresence.role, operation)
        if (!permissionCheck.allowed) {
          logger.warn(
            `User ${session.userId} (role: ${userPresence.role}) forbidden from ${operation} on ${target}`
          )
          socket.emit('operation-forbidden', {
            type: 'INSUFFICIENT_PERMISSIONS',
            message: `${permissionCheck.reason} on '${target}'`,
            operation,
            target,
          })
          return
        }
      }

      // Broadcast first for position updates to minimize latency, then persist
      // For other operations, persist first for consistency
      if (isPositionUpdate) {
        // Broadcast position updates immediately for smooth real-time movement
        const broadcastData = {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          senderId: socket.id,
          userId: session.userId,
          userName: session.userName,
          metadata: {
            workflowId,
            operationId: crypto.randomUUID(),
            isPositionUpdate: true,
          },
        }

        socket.to(workflowId).emit('workflow-operation', broadcastData)

        if (!commitPositionUpdate) {
          return
        }

        try {
          await persistWorkflowOperation(workflowId, {
            operation,
            target,
            payload,
            timestamp: operationTimestamp,
            userId: session.userId,
          })
          room.lastModified = Date.now()

          if (operationId) {
            socket.emit('operation-confirmed', {
              operationId,
              serverTimestamp: Date.now(),
            })
          }
        } catch (error) {
          logger.error('Failed to persist position update:', error)

          if (operationId) {
            socket.emit('operation-failed', {
              operationId,
              error: error instanceof Error ? error.message : 'Database persistence failed',
              retryable: true,
            })
          }
        }

        return
      }

      if (target === 'variable' && ['add', 'remove', 'duplicate'].includes(operation)) {
        // Persist first, then broadcast
        await persistWorkflowOperation(workflowId, {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          userId: session.userId,
        })

        room.lastModified = Date.now()

        const broadcastData = {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          senderId: socket.id,
          userId: session.userId,
          userName: session.userName,
          metadata: {
            workflowId,
            operationId: crypto.randomUUID(),
          },
        }

        socket.to(workflowId).emit('workflow-operation', broadcastData)

        if (operationId) {
          socket.emit('operation-confirmed', {
            operationId,
            serverTimestamp: Date.now(),
          })
        }

        return
      }

      // For non-position operations, persist first then broadcast
      await persistWorkflowOperation(workflowId, {
        operation,
        target,
        payload,
        timestamp: operationTimestamp,
        userId: session.userId,
      })

      room.lastModified = Date.now()

      const broadcastData = {
        operation,
        target,
        payload,
        timestamp: operationTimestamp, // Preserve client timestamp for position updates
        senderId: socket.id,
        userId: session.userId,
        userName: session.userName,
        // Add operation metadata for better client handling
        metadata: {
          workflowId,
          operationId: crypto.randomUUID(),
          isPositionUpdate, // Flag to help clients handle position updates specially
        },
      }

      socket.to(workflowId).emit('workflow-operation', broadcastData)

      // Emit confirmation if operationId is provided
      if (operationId) {
        socket.emit('operation-confirmed', {
          operationId,
          serverTimestamp: Date.now(),
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

      // Emit operation-failed for queue-tracked operations
      if (operationId) {
        socket.emit('operation-failed', {
          operationId,
          error: errorMessage,
          retryable: !(error instanceof ZodError), // Don't retry validation errors
        })
      }

      // Also emit legacy operation-error for backward compatibility
      if (error instanceof ZodError) {
        socket.emit('operation-error', {
          type: 'VALIDATION_ERROR',
          message: 'Invalid operation data',
          errors: error.errors,
          operation: data.operation,
          target: data.target,
        })
        logger.warn(`Validation error for operation from ${session.userId}:`, error.errors)
      } else if (error instanceof Error) {
        // Handle specific database errors
        if (error.message.includes('not found')) {
          socket.emit('operation-error', {
            type: 'RESOURCE_NOT_FOUND',
            message: error.message,
            operation: data.operation,
            target: data.target,
          })
        } else if (error.message.includes('duplicate') || error.message.includes('unique')) {
          socket.emit('operation-error', {
            type: 'DUPLICATE_RESOURCE',
            message: 'Resource already exists',
            operation: data.operation,
            target: data.target,
          })
        } else {
          socket.emit('operation-error', {
            type: 'OPERATION_FAILED',
            message: error.message,
            operation: data.operation,
            target: data.target,
          })
        }
        logger.error(
          `Operation error for ${session.userId} (${data.operation} on ${data.target}):`,
          error
        )
      } else {
        socket.emit('operation-error', {
          type: 'UNKNOWN_ERROR',
          message: 'An unknown error occurred',
          operation: data.operation,
          target: data.target,
        })
        logger.error('Unknown error handling workflow operation:', error)
      }
    }
  })
}
```

### Purpose of this file

This TypeScript file, `operations.ts`, defines the server-side logic for handling workflow operations received via WebSocket connections. It's responsible for:

1.  **Validating Operation Data:** Ensuring the incoming operation data conforms to a predefined schema.
2.  **Permission Checks:** Verifying if the user has the necessary permissions to perform the requested operation, based on their role.
3.  **Data Persistence:** Saving the operation to a database for persistence and audit trails.
4.  **Broadcasting Operations:**  Emitting the operation to other connected clients in the same workflow room, enabling real-time collaboration.
5.  **Error Handling:**  Managing and reporting errors that occur during validation, permission checks, or persistence.
6. **Optimized Handling of Position Updates:** Implements special handling for position updates (e.g., dragging blocks), prioritizing responsiveness by broadcasting them immediately and then asynchronously persisting them.  Non-committed position updates are broadcasted only.

In essence, this file acts as a central hub for processing and distributing workflow operations within a collaborative environment.

### Code Explanation

Let's break down the code line by line:

**1. Imports:**

```typescript
import { ZodError } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { persistWorkflowOperation } from '@/socket-server/database/operations'
import type { HandlerDependencies } from '@/socket-server/handlers/workflow'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'
import { checkRolePermission } from '@/socket-server/middleware/permissions'
import type { RoomManager } from '@/socket-server/rooms/manager'
import { WorkflowOperationSchema } from '@/socket-server/validation/schemas'
```

*   `ZodError`:  Imported from the `zod` library, used for handling schema validation errors.
*   `createLogger`: A function (presumably from a logging utility) used to create a logger instance for this module.
*   `persistWorkflowOperation`: A function that handles the persistence of workflow operations to a database.
*   `HandlerDependencies`: A type definition for dependencies that can be injected into the handler.
*   `AuthenticatedSocket`: A type definition representing a WebSocket connection that has been authenticated.
*   `checkRolePermission`: A function that checks if a user with a given role has permission to perform a specific operation.
*   `RoomManager`: A type definition for the room manager, responsible for managing workflow rooms and user sessions.
*   `WorkflowOperationSchema`: A Zod schema used to validate the structure and content of incoming workflow operation data.

**2. Logger Initialization:**

```typescript
const logger = createLogger('OperationsHandlers')
```

*   Creates a logger instance named 'OperationsHandlers'.  This logger will be used to record events, errors, and debugging information within this module.

**3. `setupOperationsHandlers` Function:**

```typescript
export function setupOperationsHandlers(
  socket: AuthenticatedSocket,
  deps: HandlerDependencies | RoomManager
) {
  // ... function body ...
}
```

*   This is the main function that sets up the WebSocket event handlers for workflow operations.
*   It takes two arguments:
    *   `socket`:  The authenticated WebSocket connection.
    *   `deps`: Either `HandlerDependencies` or `RoomManager`. This enables the code to be flexible in how it gets the `RoomManager`.  It uses dependency injection to provide the necessary context.

**4. Extracting the `RoomManager`**

```typescript
 const roomManager =
    deps instanceof Object && 'roomManager' in deps ? deps.roomManager : (deps as RoomManager)
```

*  This line elegantly extracts the `RoomManager` instance. It checks if `deps` is an object and has a `roomManager` property. If so, it uses `deps.roomManager`. Otherwise, it assumes `deps` is the `RoomManager` directly.

**5.  `socket.on('workflow-operation', async (data) => { ... })`:**

```typescript
  socket.on('workflow-operation', async (data) => {
    // ... event handler logic ...
  })
```

*   This line registers an event listener on the WebSocket connection for the `workflow-operation` event.  When a client sends a message with the event name `workflow-operation`, the provided asynchronous callback function will be executed. The `data` argument contains the data sent by the client.

**6. Retrieving Workflow and Session Information:**

```typescript
    const workflowId = roomManager.getWorkflowIdForSocket(socket.id)
    const session = roomManager.getUserSession(socket.id)
```

*   `workflowId`:  Gets the ID of the workflow the socket is currently connected to, using the `RoomManager`.
*   `session`:  Retrieves the user's session information associated with the socket ID.

**7. Checking if the User is in a Workflow:**

```typescript
    if (!workflowId || !session) {
      socket.emit('error', {
        type: 'NOT_JOINED',
        message: 'Not joined to any workflow',
      })
      return
    }
```

*   Checks if the `workflowId` and `session` are valid. If either is missing, it means the user isn't properly joined to a workflow.  An error message is sent back to the client using `socket.emit('error', ...)` and the handler function exits.

**8. Checking if the Workflow Room Exists:**

```typescript
    const room = roomManager.getWorkflowRoom(workflowId)
    if (!room) {
      socket.emit('error', {
        type: 'ROOM_NOT_FOUND',
        message: 'Workflow room not found',
      })
      return
    }
```

*   Attempts to retrieve the workflow room using the `workflowId`. If the room doesn't exist, an error message is sent to the client, and the handler exits.

**9. Declaring `operationId`:**

```typescript
    let operationId: string | undefined
```
* Declares a variable to store the operation ID, if any is provided in the incoming `data`. This ID is used for tracking the success or failure of an operation, especially in asynchronous scenarios. It's initialized to `undefined` because the operation ID may not always be present.

**10. Try-Catch Block for Error Handling:**

```typescript
    try {
      // ... operation processing logic ...
    } catch (error) {
      // ... error handling logic ...
    }
```

*   The core logic of the event handler is wrapped in a `try...catch` block to handle potential errors during operation processing. This ensures that errors are caught and handled gracefully, preventing the WebSocket connection from crashing.

**11. Validating the Operation Data:**

```typescript
      const validatedOperation = WorkflowOperationSchema.parse(data)
      operationId = validatedOperation.operationId
      const { operation, target, payload, timestamp } = validatedOperation
```

*   `WorkflowOperationSchema.parse(data)`: Uses the Zod schema to validate the incoming `data`. If the data doesn't conform to the schema, a `ZodError` will be thrown.
*   `operationId = validatedOperation.operationId`: Extracts the `operationId` from the validated operation. This ID is used to track the operation and send confirmation or failure messages to the client.
*   `const { operation, target, payload, timestamp } = validatedOperation`: Destructures the validated operation data into its individual components: `operation`, `target`, `payload`, and `timestamp`.

**12. Handling Position Updates:**

```typescript
      // For position updates, preserve client timestamp to maintain ordering
      // For other operations, use server timestamp for consistency
      const isPositionUpdate = operation === 'update-position' && target === 'block'
      const commitPositionUpdate =
        isPositionUpdate && 'commit' in payload ? payload.commit === true : false
      const operationTimestamp = isPositionUpdate ? timestamp : Date.now()

      // Skip permission checks for non-committed position updates (broadcasts only, no persistence)
      if (isPositionUpdate && !commitPositionUpdate) {
        // Update last activity
        const userPresence = room.users.get(socket.id)
        if (userPresence) {
          userPresence.lastActivity = Date.now()
        }
      } else {
        // Check permissions from cached role for all other operations
        const userPresence = room.users.get(socket.id)
        if (!userPresence) {
          logger.warn(`User presence not found for socket ${socket.id}`)
          socket.emit('operation-forbidden', {
            type: 'SESSION_ERROR',
            message: 'User session not found',
            operation,
            target,
          })
          return
        }

        userPresence.lastActivity = Date.now()

        // Check permissions using cached role (no DB query)
        const permissionCheck = checkRolePermission(userPresence.role, operation)
        if (!permissionCheck.allowed) {
          logger.warn(
            `User ${session.userId} (role: ${userPresence.role}) forbidden from ${operation} on ${target}`
          )
          socket.emit('operation-forbidden', {
            type: 'INSUFFICIENT_PERMISSIONS',
            message: `${permissionCheck.reason} on '${target}'`,
            operation,
            target,
          })
          return
        }
      }
```

* This section contains optimized handling for `update-position` operations specifically targeting `block` elements, identified by `isPositionUpdate`.  This optimization is important because position updates are very frequent and need to be handled with minimal latency to provide a smooth user experience during collaborative editing.
* `isPositionUpdate`: Determines whether the current operation is a position update for a block element.
* `commitPositionUpdate`: Checks if the position update should be committed to the database. This allows for temporary, non-persistent position updates.
* `operationTimestamp`: Sets the timestamp for the operation. If it's a position update, it uses the client-provided timestamp to maintain ordering. Otherwise, it uses the server's current timestamp for consistency.
* Permission Checks: Permission checks are skipped for non-committed position updates as they are broadcasted only.
* For committed position updates and all other operations, the code retrieves the user's presence in the room.  If the user presence isn't found, an error is logged, and the client is notified.  The code then calls `checkRolePermission` to verify if the user has permission to perform the operation. If not, a warning is logged, and the client receives an `operation-forbidden` message containing the reason for the denial.
* Last Activity Update: Regardless of permission status, the user's `lastActivity` is updated to keep their session alive.

**13. Broadcasting and Persisting the Operation:**

```typescript
      // Broadcast first for position updates to minimize latency, then persist
      // For other operations, persist first for consistency
      if (isPositionUpdate) {
        // Broadcast position updates immediately for smooth real-time movement
        const broadcastData = {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          senderId: socket.id,
          userId: session.userId,
          userName: session.userName,
          metadata: {
            workflowId,
            operationId: crypto.randomUUID(),
            isPositionUpdate: true,
          },
        }

        socket.to(workflowId).emit('workflow-operation', broadcastData)

        if (!commitPositionUpdate) {
          return
        }

        try {
          await persistWorkflowOperation(workflowId, {
            operation,
            target,
            payload,
            timestamp: operationTimestamp,
            userId: session.userId,
          })
          room.lastModified = Date.now()

          if (operationId) {
            socket.emit('operation-confirmed', {
              operationId,
              serverTimestamp: Date.now(),
            })
          }
        } catch (error) {
          logger.error('Failed to persist position update:', error)

          if (operationId) {
            socket.emit('operation-failed', {
              operationId,
              error: error instanceof Error ? error.message : 'Database persistence failed',
              retryable: true,
            })
          }
        }

        return
      }

      if (target === 'variable' && ['add', 'remove', 'duplicate'].includes(operation)) {
        // Persist first, then broadcast
        await persistWorkflowOperation(workflowId, {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          userId: session.userId,
        })

        room.lastModified = Date.now()

        const broadcastData = {
          operation,
          target,
          payload,
          timestamp: operationTimestamp,
          senderId: socket.id,
          userId: session.userId,
          userName: session.userName,
          metadata: {
            workflowId,
            operationId: crypto.randomUUID(),
          },
        }

        socket.to(workflowId).emit('workflow-operation', broadcastData)

        if (operationId) {
          socket.emit('operation-confirmed', {
            operationId,
            serverTimestamp: Date.now(),
          })
        }

        return
      }

      // For non-position operations, persist first then broadcast
      await persistWorkflowOperation(workflowId, {
        operation,
        target,
        payload,
        timestamp: operationTimestamp,
        userId: session.userId,
      })

      room.lastModified = Date.now()

      const broadcastData = {
        operation,
        target,
        payload,
        timestamp: operationTimestamp, // Preserve client timestamp for position updates
        senderId: socket.id,
        userId: session.userId,
        userName: session.userName,
        // Add operation metadata for better client handling
        metadata: {
          workflowId,
          operationId: crypto.randomUUID(),
          isPositionUpdate, // Flag to help clients handle position updates specially
        },
      }

      socket.to(workflowId).emit('workflow-operation', broadcastData)

      // Emit confirmation if operationId is provided
      if (operationId) {
        socket.emit('operation-confirmed', {
          operationId,
          serverTimestamp: Date.now(),
        })
      }
```

*   This section handles the broadcasting of the operation to other clients and persisting the operation to the database.  The order of these actions depends on the type of operation.
*   **Position Updates (`isPositionUpdate`):**
    *   These are broadcast *first* to ensure minimal latency in collaborative editing. The broadcast data includes the sender's ID, user ID, and user name, along with metadata like the workflow ID and a flag indicating that it's a position update.
    *   If `commitPositionUpdate` is false, the operation is broadcasted only, and the function returns immediately.
    *   If `commitPositionUpdate` is true, the operation is persisted asynchronously using `persistWorkflowOperation`. The `room.lastModified` timestamp is updated to reflect the change.  If the persistence fails, an error is logged, and the client receives an `operation-failed` message.
*   **Variable operations (`target === 'variable' && ['add', 'remove', 'duplicate'].includes(operation)`):**
    * These are persisted first, then broadcasted
*   **Other Operations:**
    *   These are persisted to the database *first* to ensure data consistency.
    *   Then, the operation is broadcast to other clients in the workflow room.
    *   The `room.lastModified` timestamp is updated.
*   **Broadcast Data:** The `broadcastData` object includes the `operation`, `target`, `payload`, `timestamp`, sender's ID, user ID, user name, and metadata including the workflow ID and `isPositionUpdate` flag. This flag helps clients handle position updates specially. A new `operationId` is generated for the broadcasted message using `crypto.randomUUID()`.
*   **Confirmation:**  If an `operationId` was provided by the client, a `operation-confirmed` message is sent back to the client, including the original `operationId` and the server's timestamp.

**14. Error Handling:**

```typescript
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

      // Emit operation-failed for queue-tracked operations
      if (operationId) {
        socket.emit('operation-failed', {
          operationId,
          error: errorMessage,
          retryable: !(error instanceof ZodError), // Don't retry validation errors
        })
      }

      // Also emit legacy operation-error for backward compatibility
      if (error instanceof ZodError) {
        socket.emit('operation-error', {
          type: 'VALIDATION_ERROR',
          message: 'Invalid operation data',
          errors: error.errors,
          operation: data.operation,
          target: data.target,
        })
        logger.warn(`Validation error for operation from ${session.userId}:`, error.errors)
      } else if (error instanceof Error) {
        // Handle specific database errors
        if (error.message.includes('not found')) {
          socket.emit('operation-error', {
            type: 'RESOURCE_NOT_FOUND',
            message: error.message,
            operation: data.operation,
            target: data.target,
          })
        } else if (error.message.includes('duplicate') || error.message.includes('unique')) {
          socket.emit('operation-error', {
            type: 'DUPLICATE_RESOURCE',
            message: 'Resource already exists',
            operation: data.operation,
            target: data.target,
          })
        } else {
          socket.emit('operation-error', {
            type: 'OPERATION_FAILED',
            message: error.message,
            operation: data.operation,
            target: data.target,
          })
        }
        logger.error(
          `Operation error for ${session.userId} (${data.operation} on ${data.target}):`,
          error
        )
      } else {
        socket.emit('operation-error', {
          type: 'UNKNOWN_ERROR',
          message: 'An unknown error occurred',
          operation: data.operation,
          target: data.target,
        })
        logger.error('Unknown error handling workflow operation:', error)
      }
    }
```

*   This `catch` block handles any errors that occur during the operation processing.  It distinguishes between different types of errors and sends appropriate error messages back to the client.
*   **`operation-failed`:** If an `operationId` is available (meaning the client is tracking the operation), an `operation-failed` message is sent. The message includes the `operationId`, the error message, and a `retryable` flag.  `retryable` is set to `false` for `ZodError` (validation errors) because retrying the same invalid data will always fail.
*   **`operation-error`:** This message is sent for backward compatibility.
    *   `ZodError`: If the error is a validation error ( `ZodError`), a `VALIDATION_ERROR` message is sent, including the validation errors.
    *   Database Errors: The code checks for specific database error messages (e.g., "not found", "duplicate", "unique") and sends corresponding error types ( `RESOURCE_NOT_FOUND`, `DUPLICATE_RESOURCE`).
    *   Generic Errors: For other errors, a generic `OPERATION_FAILED` message is sent.
    *   Unknown Errors: If the error is not an `Error` instance, an `UNKNOWN_ERROR` message is sent.
*   Logging: The code logs errors using the `logger` instance, providing context about the error and the user who initiated the operation.

In summary, the `operations.ts` file provides a robust and well-structured mechanism for handling workflow operations in a real-time collaborative environment, with a strong focus on validation, permissions, data consistency, and efficient error handling. The optimized handling of position updates is crucial for delivering a smooth and responsive user experience.
