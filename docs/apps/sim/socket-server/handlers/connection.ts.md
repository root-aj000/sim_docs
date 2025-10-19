```typescript
import { createLogger } from '@/lib/logs/console/logger'
import type { HandlerDependencies } from '@/socket-server/handlers/workflow'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'
import type { RoomManager } from '@/socket-server/rooms/manager'

const logger = createLogger('ConnectionHandlers')

export function setupConnectionHandlers(
  socket: AuthenticatedSocket,
  deps: HandlerDependencies | RoomManager
) {
  const roomManager =
    deps instanceof Object && 'roomManager' in deps ? deps.roomManager : (deps as RoomManager)

  socket.on('error', (error) => {
    logger.error(`Socket ${socket.id} error:`, error)
  })

  socket.conn.on('error', (error) => {
    logger.error(`Socket ${socket.id} connection error:`, error)
  })

  socket.on('disconnect', (reason) => {
    const workflowId = roomManager.getWorkflowIdForSocket(socket.id)
    const session = roomManager.getUserSession(socket.id)

    if (workflowId && session) {
      roomManager.cleanupUserFromRoom(socket.id, workflowId)
      roomManager.broadcastPresenceUpdate(workflowId)
    }
  })
}
```

## Explanation of `setupConnectionHandlers.ts`

This TypeScript file defines a function `setupConnectionHandlers` that configures event listeners for Socket.IO connections. These listeners handle socket errors, connection errors, and socket disconnections, ensuring proper cleanup and logging.  The file is crucial for managing socket lifecycle events in a structured and maintainable way within a Socket.IO based application, especially those managing collaborative workflows.

**Purpose of this file:**

The primary purpose of this file is to set up event handlers for Socket.IO connections. These handlers respond to various events, such as errors and disconnections, to maintain the integrity of the application's state, log important information, and handle user cleanup within collaborative workflows.

**Simplifying Complex Logic:**

The logic is already relatively straightforward.  However, it could be simplified further with comments and potentially breaking the `socket.on('disconnect', ...)` block into smaller, named functions for improved readability and testability.

**Line-by-line explanation:**

1.  **`import { createLogger } from '@/lib/logs/console/logger'`**:
    *   This line imports the `createLogger` function from a module located at `@/lib/logs/console/logger`.
    *   `createLogger` is presumably a function that creates a logger instance for logging messages to the console or other output streams.  The `@` alias suggests a project-specific root path.

2.  **`import type { HandlerDependencies } from '@/socket-server/handlers/workflow'`**:
    *   This line imports a type definition `HandlerDependencies` from the module located at `@/socket-server/handlers/workflow`. The `type` keyword means that we are importing a type (an interface or type alias) and not a value.
    *   `HandlerDependencies` likely represents an object containing dependencies required by the connection handlers, potentially including things like database connections or other services.

3.  **`import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'`**:
    *   This line imports a type definition `AuthenticatedSocket` from the module `@/socket-server/middleware/auth`.
    *   `AuthenticatedSocket` likely represents a Socket.IO socket object that has been authenticated, containing additional properties related to the authenticated user or session.

4.  **`import type { RoomManager } from '@/socket-server/rooms/manager'`**:
    *   This line imports a type definition `RoomManager` from the module `@/socket-server/rooms/manager`.
    *   `RoomManager` likely represents a class or interface responsible for managing Socket.IO rooms, including adding/removing users, tracking room membership, and broadcasting messages within rooms.

5.  **`const logger = createLogger('ConnectionHandlers')`**:
    *   This line creates a logger instance using the `createLogger` function imported earlier.
    *   The string `'ConnectionHandlers'` is passed as an argument, likely used as a label or identifier for log messages originating from this file.  This allows for easy filtering or identification of logs related to connection handling.

6.  **`export function setupConnectionHandlers( socket: AuthenticatedSocket, deps: HandlerDependencies | RoomManager ) {`**:
    *   This line defines the main function `setupConnectionHandlers`, which is exported for use in other modules.
    *   It takes two arguments:
        *   `socket`: An `AuthenticatedSocket` object, representing the authenticated Socket.IO connection.
        *   `deps`: Either a `HandlerDependencies` object or a `RoomManager` object.  This allows flexibility in how the function receives its dependencies.

7.  **`const roomManager = deps instanceof Object && 'roomManager' in deps ? deps.roomManager : (deps as RoomManager)`**:
    *   This line determines the `roomManager` to use. It checks if `deps` is an object and if it contains the property `roomManager`.
    *   If both are true, it means `deps` is a `HandlerDependencies` object, and `roomManager` is extracted from it.
    *   Otherwise, it assumes that `deps` is a `RoomManager` object and casts it to that type.  This provides type safety based on the conditional check.

8.  **`socket.on('error', (error) => { ... })`**:
    *   This line registers an event listener for the `'error'` event on the Socket.IO socket.
    *   When an error occurs on the socket, the provided callback function is executed.

9.  **`logger.error(\`Socket ${socket.id} error:\`, error)`**:
    *   Inside the error handler, this line logs an error message using the `logger` instance.
    *   The message includes the socket's ID (`socket.id`) and the error object itself.  This helps identify which socket experienced the error and provides detailed information about the error.

10. **`socket.conn.on('error', (error) => { ... })`**:
    *   This registers an event listener for the `'error'` event on the underlying socket connection (`socket.conn`).  This is a lower-level error that can occur at the TCP connection level.
    *   When an error occurs on the connection, the callback function is executed.

11. **`logger.error(\`Socket ${socket.id} connection error:\`, error)`**:
    *   Inside the connection error handler, this line logs an error message using the `logger` instance.
    *   It logs the socket ID and the error object, similar to the socket error handler.

12. **`socket.on('disconnect', (reason) => { ... })`**:
    *   This line registers an event listener for the `'disconnect'` event on the Socket.IO socket.
    *   The `reason` argument provides information about why the socket disconnected (e.g., "client disconnect", "server disconnect", "transport error").

13. **`const workflowId = roomManager.getWorkflowIdForSocket(socket.id)`**:
    *   Inside the disconnect handler, this line retrieves the workflow ID associated with the disconnected socket using the `roomManager`.
    *   `roomManager.getWorkflowIdForSocket(socket.id)` likely looks up the workflow ID based on the socket's ID.

14. **`const session = roomManager.getUserSession(socket.id)`**:
    *   This line retrieves the user session associated with the disconnected socket using the `roomManager`.
    *   `roomManager.getUserSession(socket.id)` likely retrieves the user's session data (e.g., user ID, authentication token) based on the socket's ID.

15. **`if (workflowId && session) { ... }`**:
    *   This conditional statement checks if both a `workflowId` and a `session` exist for the disconnected socket. This ensures that cleanup is only performed if the socket was actually participating in a workflow and had a valid session.

16. **`roomManager.cleanupUserFromRoom(socket.id, workflowId)`**:
    *   Inside the conditional block, this line calls the `cleanupUserFromRoom` method on the `roomManager` to remove the user (identified by `socket.id`) from the workflow's room (identified by `workflowId`).
    *   This ensures that the user is no longer considered part of the workflow and will not receive further updates.

17. **`roomManager.broadcastPresenceUpdate(workflowId)`**:
    *   This line calls the `broadcastPresenceUpdate` method on the `roomManager` to notify other users in the workflow's room that the user has disconnected.
    *   This allows the application to update the UI to reflect the user's absence.

In summary, this file provides the fundamental logic for handling socket connections, logging errors, and managing user disconnections within a collaborative application using Socket.IO and a room management system.  It ensures that resources are properly cleaned up and that other users are notified when a user disconnects from a workflow.
