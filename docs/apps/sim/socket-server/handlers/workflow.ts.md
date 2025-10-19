```typescript
import { createLogger } from '@/lib/logs/console/logger'
import { getWorkflowState } from '@/socket-server/database/operations'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'
import { verifyWorkflowAccess } from '@/socket-server/middleware/permissions'
import type { RoomManager, UserPresence, WorkflowRoom } from '@/socket-server/rooms/manager'

// Create a logger instance for this module.  This allows for structured logging, making debugging and monitoring easier.
const logger = createLogger('WorkflowHandlers')

// Export the types, so other modules can use them.
export type { UserPresence, WorkflowRoom }

// Define dependencies needed by the workflow handlers.
export interface HandlerDependencies {
  roomManager: RoomManager
}

/**
 * Creates a new WorkflowRoom object. This object represents a single workflow and the users currently interacting with it.
 * @param workflowId - The unique identifier for the workflow.
 * @returns A new WorkflowRoom object.
 */
export const createWorkflowRoom = (workflowId: string): WorkflowRoom => ({
  workflowId,
  users: new Map(), // users: Stores the connected users using a Map. The key is the socket ID, and the value is the UserPresence object.
  lastModified: Date.now(), // lastModified: Timestamp indicating the last time the workflow was modified.
  activeConnections: 0, // activeConnections:  Counts the number of active socket connections to the workflow.
})

/**
 * Cleans up user data associated with a specific workflow room.
 * @param socketId - The ID of the socket connection to clean up.
 * @param workflowId - The ID of the workflow the user is leaving.
 * @param roomManager - The RoomManager instance responsible for managing rooms and user presence.
 */
export const cleanupUserFromRoom = (
  socketId: string,
  workflowId: string,
  roomManager: RoomManager
) => {
  roomManager.cleanupUserFromRoom(socketId, workflowId) // Call the cleanupUserFromRoom method on the RoomManager to remove user-related data.
}

/**
 * Sets up the event handlers for workflow-related socket events.
 * @param socket - The authenticated socket connection.
 * @param deps -  The dependencies required by the handlers. This can either be a RoomManager instance, or an object containing a RoomManager instance.
 */
export function setupWorkflowHandlers(
  socket: AuthenticatedSocket,
  deps: HandlerDependencies | RoomManager
) {
  // Determine the RoomManager instance based on the type of `deps`. It handles cases where deps is a RoomManager directly or an object with a roomManager property.
  const roomManager =
    deps instanceof Object && 'roomManager' in deps ? deps.roomManager : (deps as RoomManager)

  // Handle the 'join-workflow' event. This event is triggered when a user wants to join a specific workflow.
  socket.on('join-workflow', async ({ workflowId }) => {
    try {
      const userId = socket.userId // Get the user ID from the authenticated socket.
      const userName = socket.userName // Get the username from the authenticated socket.

      // Authentication Check
      if (!userId || !userName) {
        logger.warn(`Join workflow rejected: Socket ${socket.id} not authenticated`)
        socket.emit('join-workflow-error', { error: 'Authentication required' })
        return
      }

      logger.info(`Join workflow request from ${userId} (${userName}) for workflow ${workflowId}`)

      // Authorization Check
      let userRole: string
      try {
        // Verify the user's access to the workflow.
        const accessInfo = await verifyWorkflowAccess(userId, workflowId)
        // If the user doesn't have access, reject the join request.
        if (!accessInfo.hasAccess) {
          logger.warn(`User ${userId} (${userName}) denied access to workflow ${workflowId}`)
          socket.emit('join-workflow-error', { error: 'Access denied to workflow' })
          return
        }
        userRole = accessInfo.role || 'read' // Determine the user's role based on access info, defaults to 'read'.
      } catch (error) {
        logger.warn(`Error verifying workflow access for ${userId}:`, error)
        socket.emit('join-workflow-error', { error: 'Failed to verify workflow access' })
        return
      }

      // Check if the user is already in a workflow and clean up.
      const currentWorkflowId = roomManager.getWorkflowIdForSocket(socket.id)
      if (currentWorkflowId) {
        socket.leave(currentWorkflowId) // Make the socket leave the current workflow room.
        roomManager.cleanupUserFromRoom(socket.id, currentWorkflowId) // Cleanup the user data from the current workflow room.

        roomManager.broadcastPresenceUpdate(currentWorkflowId) // Notify other users in the previous workflow room about the user leaving.
      }

      socket.join(workflowId) // Make the socket join the specified workflow room.

      // Check if the workflow room exists, create if not.
      if (!roomManager.hasWorkflowRoom(workflowId)) {
        roomManager.setWorkflowRoom(workflowId, roomManager.createWorkflowRoom(workflowId))
      }

      // Update Workflow Room State
      const room = roomManager.getWorkflowRoom(workflowId)! // Get the workflow room from the RoomManager.
      room.activeConnections++ // Increment the number of active connections in the room.

      // Create User Presence Object
      const userPresence: UserPresence = {
        userId,
        workflowId,
        userName,
        socketId: socket.id,
        joinedAt: Date.now(),
        lastActivity: Date.now(),
        role: userRole,
      }

      // Store User Presence and Session
      room.users.set(socket.id, userPresence) // Add the user's presence information to the workflow room.
      roomManager.setWorkflowForSocket(socket.id, workflowId) // Map the socket ID to the workflow ID.
      roomManager.setUserSession(socket.id, { userId, userName }) // Store the user's session information.

      // Send Workflow State to User
      const workflowState = await getWorkflowState(workflowId) // Get the current state of the workflow from the database.
      socket.emit('workflow-state', workflowState) // Send the workflow state to the user.

      // Broadcast Presence Update
      roomManager.broadcastPresenceUpdate(workflowId) // Notify all users in the workflow room about the new user joining.

      // Log User Join
      const uniqueUserCount = roomManager.getUniqueUserCount(workflowId) // Get the number of unique users in the workflow room.
      logger.info(
        `User ${userId} (${userName}) joined workflow ${workflowId}. Room now has ${uniqueUserCount} unique users (${room.activeConnections} connections).`
      )
    } catch (error) {
      logger.error('Error joining workflow:', error)
      socket.emit('error', {
        type: 'JOIN_ERROR',
        message: 'Failed to join workflow',
      })
    }
  })

  // Handle 'request-sync' event. This event is triggered when a user requests the current state of the workflow.
  socket.on('request-sync', async ({ workflowId }) => {
    try {
      // Check Authentication
      if (!socket.userId) {
        socket.emit('error', { type: 'NOT_AUTHENTICATED', message: 'Not authenticated' })
        return
      }

      // Check Authorization
      const accessInfo = await verifyWorkflowAccess(socket.userId, workflowId)
      if (!accessInfo.hasAccess) {
        socket.emit('error', { type: 'ACCESS_DENIED', message: 'Access denied' })
        return
      }

      // Get and Send Workflow State
      const workflowState = await getWorkflowState(workflowId)
      socket.emit('workflow-state', workflowState)

      logger.info(`Sent sync data to ${socket.userId} for workflow ${workflowId}`)
    } catch (error) {
      logger.error('Error handling sync request:', error)
      socket.emit('error', { type: 'SYNC_FAILED', message: 'Failed to sync workflow state' })
    }
  })

  // Handle 'leave-workflow' event. This event is triggered when a user wants to leave a specific workflow.
  socket.on('leave-workflow', () => {
    const workflowId = roomManager.getWorkflowIdForSocket(socket.id) // Get the workflow ID associated with the socket.
    const session = roomManager.getUserSession(socket.id) // Get the user's session information.

    // If the user is in a workflow
    if (workflowId && session) {
      socket.leave(workflowId) // Make the socket leave the workflow room.
      roomManager.cleanupUserFromRoom(socket.id, workflowId) // Cleanup the user data from the workflow room.

      // Broadcast Presence Update
      roomManager.broadcastPresenceUpdate(workflowId) // Notify other users in the workflow room about the user leaving.

      logger.info(`User ${session.userId} (${session.userName}) left workflow ${workflowId}`)
    }
  })
}
```

**Purpose of this file:**

This file defines the socket event handlers responsible for managing user interactions within a collaborative workflow environment. Specifically, it handles the following:

-   **Joining a workflow:**  Authenticates and authorizes users before allowing them to join a specific workflow.  It also manages user presence and broadcasts updates to other users in the workflow.
-   **Requesting workflow state synchronization:** Allows users to request the latest state of a workflow when they join or reconnect.
-   **Leaving a workflow:**  Cleans up user data and notifies other users when a user leaves a workflow.

**Simplified Logic and Explanations:**

1.  **Dependencies:**  The `setupWorkflowHandlers` function relies on a `RoomManager` to manage rooms, user presence, and associated data. It also utilizes other modules for logging, database operations, authentication, and authorization. The use of `HandlerDependencies` interface makes the code more testable and flexible because dependencies can be easily mocked or swapped out.

2.  **Authentication and Authorization:** The `join-workflow` and `request-sync` handlers perform authentication (checking if the user is logged in) and authorization (checking if the user has access to the requested workflow) before proceeding.  This ensures that only authorized users can access and modify workflow data.

3.  **Room Management:** The `RoomManager` is responsible for creating, managing, and cleaning up workflow rooms.  Each workflow room maintains a list of connected users, their presence information, and other relevant data.

4.  **Presence Updates:**  Whenever a user joins or leaves a workflow, the `broadcastPresenceUpdate` function is called to notify other users in the room.  This allows clients to maintain an up-to-date list of active users.

5.  **Error Handling:**  The code includes `try...catch` blocks to handle potential errors during the join, sync, and leave operations.  Errors are logged and emitted to the client, allowing them to gracefully handle unexpected situations.

6.  **Workflow State Synchronization:** When a user joins a workflow or requests a synchronization, the `getWorkflowState` function is called to retrieve the current state of the workflow from the database. This state is then sent to the client, allowing them to initialize or update their view of the workflow.

**Line-by-line explanation:**

*   **`import { createLogger } from '@/lib/logs/console/logger'`**: Imports the `createLogger` function from the specified path. This function is used to create a logger instance for this module.

*   **`import { getWorkflowState } from '@/socket-server/database/operations'`**: Imports the `getWorkflowState` function. This function fetches the current state of a workflow from the database.

*   **`import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'`**: Imports the `AuthenticatedSocket` type from the specified path. This type represents a socket connection that has been authenticated.

*   **`import { verifyWorkflowAccess } from '@/socket-server/middleware/permissions'`**: Imports the `verifyWorkflowAccess` function, which checks if a user has the required permissions to access a specific workflow.

*   **`import type { RoomManager, UserPresence, WorkflowRoom } from '@/socket-server/rooms/manager'`**: Imports types related to room management: `RoomManager`, `UserPresence`, and `WorkflowRoom`. These types are used to define the structure of rooms and user information.

*   **`const logger = createLogger('WorkflowHandlers')`**: Creates a logger instance with the name 'WorkflowHandlers'.  This allows you to easily identify log messages originating from this module.

*   **`export type { UserPresence, WorkflowRoom }`**:  Exports the `UserPresence` and `WorkflowRoom` types, making them available for use in other modules.

*   **`export interface HandlerDependencies { roomManager: RoomManager }`**: Defines an interface `HandlerDependencies` that specifies the dependencies required by the workflow handlers, specifically the `RoomManager`.

*   **`export const createWorkflowRoom = (workflowId: string): WorkflowRoom => ({ ... })`**: Creates a new `WorkflowRoom` object, which represents a single workflow and the users currently interacting with it.

    *   `workflowId`: The unique identifier for the workflow.
    *   `users`: Stores the connected users using a Map.  The key is the socket ID, and the value is the `UserPresence` object.
    *   `lastModified`: Timestamp indicating the last time the workflow was modified.
    *   `activeConnections`: Counts the number of active socket connections to the workflow.

*   **`export const cleanupUserFromRoom = (socketId: string, workflowId: string, roomManager: RoomManager) => { ... }`**:  A utility function to clean up user data associated with a specific workflow room.  It takes the `socketId`, `workflowId`, and `roomManager` as arguments and calls the `cleanupUserFromRoom` method on the `RoomManager` to remove user-related data.

*   **`export function setupWorkflowHandlers(socket: AuthenticatedSocket, deps: HandlerDependencies | RoomManager) { ... }`**:  This is the main function that sets up the socket event handlers for workflow-related events.

    *   `socket: AuthenticatedSocket`:  The authenticated socket connection.
    *   `deps: HandlerDependencies | RoomManager`: The dependencies required by the handlers. This can either be a `RoomManager` instance, or an object containing a `RoomManager` instance.

*   **`const roomManager = deps instanceof Object && 'roomManager' in deps ? deps.roomManager : (deps as RoomManager)`**: Determines the `RoomManager` instance based on the type of `deps`.  It handles cases where `deps` is a `RoomManager` directly or an object with a `roomManager` property.

*   **`socket.on('join-workflow', async ({ workflowId }) => { ... })`**:  Sets up a handler for the `join-workflow` event.  This event is triggered when a user wants to join a specific workflow.

    *   The handler extracts the `userId` and `userName` from the authenticated socket.
    *   It performs an authentication check to ensure the user is logged in.
    *   It performs an authorization check to ensure the user has access to the workflow.
    *   It checks if the user is already in a workflow and cleans up the previous connection.
    *   It makes the socket join the specified workflow room.
    *   It updates the workflow room state, including the number of active connections.
    *   It creates a `UserPresence` object to store information about the user's presence in the workflow.
    *   It stores the user's presence information and session data in the `RoomManager`.
    *   It fetches the current state of the workflow from the database and sends it to the user.
    *   It broadcasts a presence update to all other users in the workflow room.
    *   It logs the user join event.

*   **`socket.on('request-sync', async ({ workflowId }) => { ... })`**: Sets up a handler for the `request-sync` event.  This event is triggered when a user requests the current state of the workflow.

    *   The handler performs an authentication check.
    *   The handler performs an authorization check.
    *   It retrieves the workflow state and sends it to the user.

*   **`socket.on('leave-workflow', () => { ... })`**: Sets up a handler for the `leave-workflow` event. This event is triggered when a user wants to leave a specific workflow.

    *   The handler retrieves the workflow ID associated with the socket.
    *   It retrieves the user's session information.
    *   It makes the socket leave the workflow room.
    *   It cleans up the user data from the workflow room.
    *   It broadcasts a presence update to all other users in the workflow room.
    *   It logs the user leave event.
