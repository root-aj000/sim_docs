```typescript
import * as schema from '@sim/db/schema'
import { workflowBlocks, workflowEdges } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { Server } from 'socket.io'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

// Define the database connection string from environment variables.
const connectionString = env.DATABASE_URL

// Create a Drizzle ORM client for interacting with the PostgreSQL database.
// Drizzle is an ORM that allows you to interact with databases using TypeScript.
const db = drizzle(
  postgres(connectionString, {
    prepare: false, // Disable prepared statements for simpler queries
    idle_timeout: 15, // Close idle connections after 15 seconds
    connect_timeout: 20, // Timeout for establishing a connection (20 seconds)
    max: 3, // Maximum number of connections in the pool
    onnotice: () => {}, // Ignore database notices
  }),
  { schema } // Pass database schema to drizzle.
)

// Create a logger instance for RoomManager-related messages.
const logger = createLogger('RoomManager')

// Define the structure of a UserPresence object.  This represents a user's
// presence and activity within a workflow.
export interface UserPresence {
  userId: string // Unique identifier for the user.
  workflowId: string // The ID of the workflow the user is currently in.
  userName: string // The user's display name.
  socketId: string // The Socket.IO ID for the user's connection.
  joinedAt: number // Timestamp when the user joined the workflow.
  lastActivity: number // Timestamp of the user's last activity.
  role: string // User's role within the workflow (e.g., 'editor', 'viewer').
  cursor?: { x: number; y: number } // Optional cursor position for collaborative editing.
  selection?: { type: 'block' | 'edge' | 'none'; id?: string } // Optional selection information, indicating a selected block or edge.
}

// Define the structure of a WorkflowRoom object.  This represents a single workflow
// and the users currently present in that workflow.
export interface WorkflowRoom {
  workflowId: string // The ID of the workflow.
  users: Map<string, UserPresence> // socketId -> UserPresence:  A map of socket IDs to UserPresence objects, tracking users in the room.
  lastModified: number // Timestamp of the last modification to the workflow.
  activeConnections: number // Number of active socket connections in the room.
}

// The RoomManager class is responsible for managing workflow rooms and user presence.
// It handles creating, updating, and deleting rooms, as well as tracking user activity
// and broadcasting updates to clients.
export class RoomManager {
  // A map to store workflow rooms, keyed by workflow ID.
  private workflowRooms = new Map<string, WorkflowRoom>()
  // A map to store the workflow ID associated with each socket connection.
  private socketToWorkflow = new Map<string, string>()
  // A map to store user session information (userId, userName) associated with each socket connection.
  private userSessions = new Map<string, { userId: string; userName: string }>()
  // The Socket.IO server instance.
  private io: Server

  // Constructor: Initializes the RoomManager with the Socket.IO server instance.
  constructor(io: Server) {
    this.io = io
  }

  // Creates a new workflow room with the given workflow ID.
  createWorkflowRoom(workflowId: string): WorkflowRoom {
    return {
      workflowId,
      users: new Map(),
      lastModified: Date.now(),
      activeConnections: 0,
    }
  }

  // Cleans up a user's presence from a workflow room when they disconnect.
  cleanupUserFromRoom(socketId: string, workflowId: string) {
    // Get the workflow room.
    const room = this.workflowRooms.get(workflowId)
    if (room) {
      // Remove the user from the room's user list.
      room.users.delete(socketId)
      // Decrement the active connection count, ensuring it doesn't go below 0.
      room.activeConnections = Math.max(0, room.activeConnections - 1)

      // If the room is now empty (no active connections), delete it.
      if (room.activeConnections === 0) {
        this.workflowRooms.delete(workflowId)
        logger.info(`Cleaned up empty workflow room: ${workflowId}`)
      }
    }

    // Remove the socket ID from the socket-to-workflow map.
    this.socketToWorkflow.delete(socketId)
    // Remove the user session from the user sessions map.
    this.userSessions.delete(socketId)
  }

  // Handles workflow deletion notifications.
  handleWorkflowDeletion(workflowId: string) {
    logger.info(`Handling workflow deletion notification for ${workflowId}`)

    // Get the workflow room.
    const room = this.workflowRooms.get(workflowId)
    if (!room) {
      logger.debug(`No active room found for deleted workflow ${workflowId}`)
      return
    }

    // Emit a 'workflow-deleted' event to all clients in the workflow room,
    // informing them that the workflow has been deleted.
    this.io.to(workflowId).emit('workflow-deleted', {
      workflowId,
      message: 'This workflow has been deleted',
      timestamp: Date.now(),
    })

    // Collect all socket IDs in the room to disconnect.
    const socketsToDisconnect: string[] = []
    room.users.forEach((_presence, socketId) => {
      socketsToDisconnect.push(socketId)
    })

    // Iterate through the socket IDs and disconnect each socket.
    socketsToDisconnect.forEach((socketId) => {
      // Get the Socket.IO socket object.
      const socket = this.io.sockets.sockets.get(socketId)
      if (socket) {
        // Remove the socket from the workflow room.
        socket.leave(workflowId)
        logger.debug(`Disconnected socket ${socketId} from deleted workflow ${workflowId}`)
      }
      // Clean up the user from the room.
      this.cleanupUserFromRoom(socketId, workflowId)
    })

    // Delete the workflow room.
    this.workflowRooms.delete(workflowId)
    logger.info(
      `Cleaned up workflow room ${workflowId} after deletion (${socketsToDisconnect.length} users disconnected)`
    )
  }

  // Handles workflow revert notifications.
  handleWorkflowRevert(workflowId: string, timestamp: number) {
    logger.info(`Handling workflow revert notification for ${workflowId}`)

    // Get the workflow room.
    const room = this.workflowRooms.get(workflowId)
    if (!room) {
      logger.debug(`No active room found for reverted workflow ${workflowId}`)
      return
    }

    // Emit a 'workflow-reverted' event to all clients in the workflow room,
    // informing them that the workflow has been reverted.
    this.io.to(workflowId).emit('workflow-reverted', {
      workflowId,
      message: 'Workflow has been reverted to deployed state',
      timestamp,
    })

    // Update the last modified timestamp of the room.
    room.lastModified = timestamp

    logger.info(`Notified ${room.users.size} users about workflow revert: ${workflowId}`)
  }

  // Handles workflow update notifications.
  handleWorkflowUpdate(workflowId: string) {
    logger.info(`Handling workflow update notification for ${workflowId}`)

    // Get the workflow room.
    const room = this.workflowRooms.get(workflowId)
    if (!room) {
      logger.debug(`No active room found for updated workflow ${workflowId}`)
      return
    }

    // Get the current timestamp.
    const timestamp = Date.now()

    // Notify all clients in the workflow room that the workflow has been updated.
    // This will trigger them to refresh their local state.
    this.io.to(workflowId).emit('workflow-updated', {
      workflowId,
      message: 'Workflow has been updated externally',
      timestamp,
    })

    // Update the last modified timestamp of the room.
    room.lastModified = timestamp

    logger.info(`Notified ${room.users.size} users about workflow update: ${workflowId}`)
  }

  // Handles copilot workflow edit notifications.
  handleCopilotWorkflowEdit(workflowId: string, description?: string) {
    logger.info(`Handling copilot workflow edit notification for ${workflowId}`)

    // Get the workflow room.
    const room = this.workflowRooms.get(workflowId)
    if (!room) {
      logger.debug(`No active room found for copilot workflow edit ${workflowId}`)
      return
    }

    // Get the current timestamp.
    const timestamp = Date.now()

    // Emit special event for copilot edits that tells clients to rehydrate from database
    this.io.to(workflowId).emit('copilot-workflow-edit', {
      workflowId,
      description,
      message: 'Copilot has edited the workflow - rehydrating from database',
      timestamp,
    })

    // Update the last modified timestamp of the room.
    room.lastModified = timestamp

    logger.info(`Notified ${room.users.size} users about copilot workflow edit: ${workflowId}`)
  }

  // Validates the consistency of a workflow by checking for orphaned edges.
  async validateWorkflowConsistency(
    workflowId: string
  ): Promise<{ valid: boolean; issues: string[] }> {
    try {
      const issues: string[] = []

      // Query the database for orphaned edges (edges whose source block doesn't exist).
      const orphanedEdges = await db
        .select({
          id: workflowEdges.id,
          sourceBlockId: workflowEdges.sourceBlockId,
          targetBlockId: workflowEdges.targetBlockId,
        })
        .from(workflowEdges)
        .leftJoin(workflowBlocks, eq(workflowEdges.sourceBlockId, workflowBlocks.id))
        .where(and(eq(workflowEdges.workflowId, workflowId), isNull(workflowBlocks.id)))

      // If orphaned edges are found, add an issue to the list.
      if (orphanedEdges.length > 0) {
        issues.push(`Found ${orphanedEdges.length} orphaned edges with missing source blocks`)
      }

      // Return the validation result.
      return { valid: issues.length === 0, issues }
    } catch (error) {
      // Log any errors that occur during validation.
      logger.error('Error validating workflow consistency:', error)
      return { valid: false, issues: ['Consistency check failed'] }
    }
  }

  // Returns a read-only map of workflow rooms.
  getWorkflowRooms(): ReadonlyMap<string, WorkflowRoom> {
    return this.workflowRooms
  }

  // Returns a read-only map of socket-to-workflow assignments.
  getSocketToWorkflow(): ReadonlyMap<string, string> {
    return this.socketToWorkflow
  }

  // Returns a read-only map of user sessions.
  getUserSessions(): ReadonlyMap<string, { userId: string; userName: string }> {
    return this.userSessions
  }

  // Checks if a workflow room exists for the given workflow ID.
  hasWorkflowRoom(workflowId: string): boolean {
    return this.workflowRooms.has(workflowId)
  }

  // Gets a workflow room by its workflow ID.
  getWorkflowRoom(workflowId: string): WorkflowRoom | undefined {
    return this.workflowRooms.get(workflowId)
  }

  // Sets a workflow room.
  setWorkflowRoom(workflowId: string, room: WorkflowRoom): void {
    this.workflowRooms.set(workflowId, room)
  }

  // Gets the workflow ID associated with a socket ID.
  getWorkflowIdForSocket(socketId: string): string | undefined {
    return this.socketToWorkflow.get(socketId)
  }

  // Sets the workflow ID associated with a socket ID.
  setWorkflowForSocket(socketId: string, workflowId: string): void {
    this.socketToWorkflow.set(socketId, workflowId)
  }

  // Gets a user session by socket ID.
  getUserSession(socketId: string): { userId: string; userName: string } | undefined {
    return this.userSessions.get(socketId)
  }

  // Sets a user session.
  setUserSession(socketId: string, session: { userId: string; userName: string }): void {
    this.userSessions.set(socketId, session)
  }

  // Gets the total number of active connections across all workflow rooms.
  getTotalActiveConnections(): number {
    return Array.from(this.workflowRooms.values()).reduce(
      (total, room) => total + room.activeConnections,
      0
    )
  }

  // Broadcasts a presence update to all clients in a workflow room.
  broadcastPresenceUpdate(workflowId: string): void {
    const room = this.workflowRooms.get(workflowId)
    if (room) {
      const roomPresence = Array.from(room.users.values())
      this.io.to(workflowId).emit('presence-update', roomPresence)
    }
  }

  // Emits an event to all clients in a workflow room.
  emitToWorkflow<T = unknown>(workflowId: string, event: string, payload: T): void {
    this.io.to(workflowId).emit(event, payload)
  }

  /**
   * Get the number of unique users in a workflow room
   * (not the number of socket connections)
   */
  getUniqueUserCount(workflowId: string): number {
    const room = this.workflowRooms.get(workflowId)
    if (!room) return 0

    const uniqueUsers = new Set<string>()
    room.users.forEach((presence) => {
      uniqueUsers.add(presence.userId)
    })

    return uniqueUsers.size
  }
}
```

### Purpose of this file

This TypeScript file defines the `RoomManager` class, which is responsible for managing collaborative workflow editing sessions. It handles:

*   **Creating and deleting workflow rooms:**  Each workflow being edited has its own room.
*   **Tracking user presence:**  Keeping track of which users are in which workflow rooms.
*   **Broadcasting updates:**  Sending real-time updates about workflow changes, user activity, and other events to clients connected to the same workflow.
*   **Validating Workflow Consistency:** Checking if the workflow has any orphaned edges.
*   **Managing Socket Connections:** Mapping socket connections to their corresponding workflows.
*   **Managing User Sessions:** Storing user information associated with each socket connection.

In essence, it's the central component for managing real-time collaboration features in a workflow editing application.

### Simplification of Complex Logic

1.  **Centralized Room Management:** The `RoomManager` encapsulates all logic related to managing workflow rooms and user presence, simplifying the codebase by providing a single point of access for these operations.
2.  **Clear Data Structures:** The use of `Map` objects for storing workflow rooms, socket-to-workflow assignments, and user sessions provides efficient and organized storage and retrieval of data.
3.  **Event-Driven Updates:** The use of Socket.IO events for broadcasting updates to clients simplifies the process of synchronizing changes across multiple users.
4.  **Validation Checks:** The `validateWorkflowConsistency` function encapsulates the logic for checking the consistency of a workflow, making it easier to maintain and test.
5.  **Helper Functions:** The class includes numerous helper functions for common tasks, such as getting workflow rooms, socket assignments, and user sessions, which simplifies the codebase and improves readability.

### Explanation of each line of code

The code can be logically divided into the following sections:

**1. Imports:**

*   `import * as schema from '@sim/db/schema'`: Imports all definitions from the database schema file. The alias `schema` allows referencing these definitions.
*   `import { workflowBlocks, workflowEdges } from '@sim/db/schema'`:  Specifically imports the `workflowBlocks` and `workflowEdges` tables from the database schema.  These tables likely represent the nodes and connections in the workflow.
*   `import { and, eq, isNull } from 'drizzle-orm'`: Imports functions from the Drizzle ORM library for building database queries.
    *   `eq`: Creates an equality condition (e.g., `workflowEdges.workflowId = workflowId`).
    *   `and`: Combines multiple conditions with a logical AND.
    *   `isNull`: Checks if a value is null.
*   `import { drizzle } from 'drizzle-orm/postgres-js'`: Imports the `drizzle` function, which initializes the Drizzle ORM client for PostgreSQL.
*   `import postgres from 'postgres'`: Imports the `postgres` library, a PostgreSQL client.
*   `import type { Server } from 'socket.io'`: Imports the `Server` type from the Socket.IO library, used for real-time communication.  The `type` keyword means this is only used for type checking, not for importing a value.
*   `import { env } from '@/lib/env'`: Imports the `env` object from the `lib/env` module, which presumably provides access to environment variables.
*   `import { createLogger } from '@/lib/logs/console/logger'`: Imports a function for creating a logger instance for structured logging.

**2. Database Configuration:**

*   `const connectionString = env.DATABASE_URL`: Retrieves the database connection string from the environment variables.  This is a standard security practice to avoid hardcoding sensitive information.
*   `const db = drizzle(...)`: Initializes the Drizzle ORM client.
    *   `postgres(connectionString, { ... })`: Creates a PostgreSQL client using the connection string and configuration options.
        *   `prepare: false`: Disables prepared statements for simpler queries.
        *   `idle_timeout: 15`: Sets the idle timeout to 15 seconds.
        *   `connect_timeout: 20`: Sets the connection timeout to 20 seconds.
        *   `max: 3`: Sets the maximum number of connections in the connection pool to 3.
        *   `onnotice: () => {}`: A no-op function to ignore database notices.
    *   `{ schema }`:  Passes the imported database schema to Drizzle so it knows the structure of the database tables.

**3. Logger Initialization:**

*   `const logger = createLogger('RoomManager')`: Creates a logger instance with the name 'RoomManager'. This allows filtering logs specifically related to this class.

**4. Interface Definitions:**

*   `export interface UserPresence { ... }`: Defines the `UserPresence` interface, representing a user's information and status within a workflow room.  It includes properties like `userId`, `workflowId`, `userName`, `socketId`, `joinedAt`, `lastActivity`, `role`, `cursor`, and `selection`.
*   `export interface WorkflowRoom { ... }`: Defines the `WorkflowRoom` interface, representing a single workflow room. It includes properties like `workflowId`, `users` (a map of socket IDs to `UserPresence` objects), `lastModified`, and `activeConnections`.

**5. RoomManager Class:**

*   `export class RoomManager { ... }`: Defines the `RoomManager` class.
    *   `private workflowRooms = new Map<string, WorkflowRoom>()`: A private map storing workflow rooms, keyed by their `workflowId`.
    *   `private socketToWorkflow = new Map<string, string>()`: A private map storing the association between Socket.IO socket IDs and workflow IDs.  This allows quickly determining which workflow a user is connected to based on their socket.
    *   `private userSessions = new Map<string, { userId: string; userName: string }>()`: A private map storing user session information (userId, userName) based on the socket ID. This is used to easily retrieve user information associated with a socket.
    *   `private io: Server`: A private property storing the Socket.IO server instance.
    *   `constructor(io: Server) { this.io = io }`: The constructor, which takes the Socket.IO server instance as an argument and initializes the `io` property.
    *   `createWorkflowRoom(workflowId: string): WorkflowRoom { ... }`: Creates a new `WorkflowRoom` object for a given workflow ID.
    *   `cleanupUserFromRoom(socketId: string, workflowId: string) { ... }`: Removes a user from a workflow room when they disconnect, and cleans up the room if it becomes empty.
    *   `handleWorkflowDeletion(workflowId: string) { ... }`: Handles the deletion of a workflow.  It notifies all connected clients, removes them from the room, and deletes the room.
    *   `handleWorkflowRevert(workflowId: string, timestamp: number) { ... }`: Handles the reversion of a workflow to a previous state. It notifies all connected clients.
    *   `handleWorkflowUpdate(workflowId: string) { ... }`: Handles updates to a workflow.  It notifies all connected clients that the workflow has been updated.
    *   `handleCopilotWorkflowEdit(workflowId: string, description?: string) { ... }`: Handles Copilot edits to the workflow by emitting a special event that tells clients to rehydrate from the database.
    *   `async validateWorkflowConsistency(workflowId: string): Promise<{ valid: boolean; issues: string[] }> { ... }`: Validates the consistency of a workflow by checking for orphaned edges (edges that point to non-existent blocks).  It uses Drizzle ORM to query the database.
    *   `getWorkflowRooms(): ReadonlyMap<string, WorkflowRoom> { ... }`: Returns a read-only view of the `workflowRooms` map.
    *   `getSocketToWorkflow(): ReadonlyMap<string, string> { ... }`: Returns a read-only view of the `socketToWorkflow` map.
    *   `getUserSessions(): ReadonlyMap<string, { userId: string; userName: string }> { ... }`: Returns a read-only view of the `userSessions` map.
    *   `hasWorkflowRoom(workflowId: string): boolean { ... }`: Checks if a workflow room exists for a given workflow ID.
    *   `getWorkflowRoom(workflowId: string): WorkflowRoom | undefined { ... }`: Retrieves a workflow room by its workflow ID.
    *   `setWorkflowRoom(workflowId: string, room: WorkflowRoom): void { ... }`: Sets a workflow room.
    *   `getWorkflowIdForSocket(socketId: string): string | undefined { ... }`: Retrieves the workflow ID associated with a socket ID.
    *   `setWorkflowForSocket(socketId: string, workflowId: string): void { ... }`: Sets the workflow ID associated with a socket ID.
    *   `getUserSession(socketId: string): { userId: string; userName: string } | undefined { ... }`: Retrieves the user session associated with a socket ID.
    *   `setUserSession(socketId: string, session: { userId: string; userName: string }): void { ... }`: Sets the user session.
    *   `getTotalActiveConnections(): number { ... }`: Calculates the total number of active connections across all workflow rooms.
    *   `broadcastPresenceUpdate(workflowId: string): void { ... }`: Broadcasts a presence update to all clients in a workflow room, informing them of the current users and their status.
    *   `emitToWorkflow<T = unknown>(workflowId: string, event: string, payload: T): void { ... }`: Emits a custom event to all clients in a workflow room with a specified payload.
    *  `getUniqueUserCount(workflowId: string): number { ... }`: Get the number of unique users within a workflow room

In summary, the code defines a robust `RoomManager` class for managing real-time collaborative workflow editing sessions using Socket.IO and Drizzle ORM, providing essential functionality for handling user presence, workflow updates, and data consistency.
