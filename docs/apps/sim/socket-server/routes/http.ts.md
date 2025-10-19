```typescript
import type { IncomingMessage, ServerResponse } from 'http'
import type { RoomManager } from '@/socket-server/rooms/manager'

interface Logger {
  info: (message: string, ...args: any[]) => void
  error: (message: string, ...args: any[]) => void
  debug: (message: string, ...args: any[]) => void
  warn: (message: string, ...args: any[]) => void
}

/**
 * Creates an HTTP request handler for the socket server
 * @param roomManager - RoomManager instance for managing workflow rooms and state
 * @param logger - Logger instance for logging requests and errors
 * @returns HTTP request handler function
 */
export function createHttpHandler(roomManager: RoomManager, logger: Logger) {
  return (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          status: 'ok',
          timestamp: new Date().toISOString(),
          connections: roomManager.getTotalActiveConnections(),
        })
      )
      return
    }

    // Handle workflow deletion notifications from the main API
    if (req.method === 'POST' && req.url === '/api/workflow-deleted') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const { workflowId } = JSON.parse(body)
          roomManager.handleWorkflowDeletion(workflowId)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (error) {
          logger.error('Error handling workflow deletion notification:', error)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Failed to process deletion notification' }))
        }
      })
      return
    }

    // Handle workflow update notifications from the main API
    if (req.method === 'POST' && req.url === '/api/workflow-updated') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const { workflowId } = JSON.parse(body)
          roomManager.handleWorkflowUpdate(workflowId)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (error) {
          logger.error('Error handling workflow update notification:', error)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Failed to process update notification' }))
        }
      })
      return
    }

    // Handle copilot workflow edit notifications from the main API
    if (req.method === 'POST' && req.url === '/api/copilot-workflow-edit') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const { workflowId, description } = JSON.parse(body)
          roomManager.handleCopilotWorkflowEdit(workflowId, description)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (error) {
          logger.error('Error handling copilot workflow edit notification:', error)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Failed to process copilot edit notification' }))
        }
      })
      return
    }

    // Handle workflow revert notifications from the main API
    if (req.method === 'POST' && req.url === '/api/workflow-reverted') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const { workflowId, timestamp } = JSON.parse(body)
          roomManager.handleWorkflowRevert(workflowId, timestamp)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (error) {
          logger.error('Error handling workflow revert notification:', error)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Failed to process revert notification' }))
        }
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  }
}
```

### Purpose of this file

This TypeScript file defines a function `createHttpHandler` that generates an HTTP request handler for a socket server. This handler is responsible for:

1.  **Health Check:** Responding to health check requests (GET `/health`).
2.  **Workflow Notifications:** Handling POST requests from a main API to notify the socket server about workflow events such as deletion, updates, copilot workflow edits, and reverts.  These notifications trigger corresponding actions within the `RoomManager` to manage connected clients and their state.
3.  **Error Handling:** Logging errors that occur during notification processing and sending appropriate error responses.
4.  **Default Response:** Returning a 404 "Not found" response for any unhandled routes.

### Simplification of Complex Logic

The code is already fairly straightforward, but here are some potential simplifications that could be considered:

*   **Extract Body Parsing:** The body parsing logic (reading data chunks and converting them to a string) is repeated in each POST request handler. This could be extracted into a separate utility function.
*   **Centralized Error Handling:** The error handling logic (logging and sending a 500 response) is also repeated.  A separate function could encapsulate this.
*   **Route Handling:** Using a more structured approach for route handling (e.g., a `switch` statement or a route mapping object) could improve readability and maintainability if more routes are added.
*   **Async/Await:** Convert `req.on('data')` and `req.on('end')` to use `async/await` for cleaner code, especially if further logic needs to be added after parsing the body.

### Line-by-Line Explanation

```typescript
import type { IncomingMessage, ServerResponse } from 'http'
import type { RoomManager } from '@/socket-server/rooms/manager'

interface Logger {
  info: (message: string, ...args: any[]) => void
  error: (message: string, ...args: any[]) => void
  debug: (message: string, ...args: any[]) => void
  warn: (message: string, ...args: any[]) => void
}

/**
 * Creates an HTTP request handler for the socket server
 * @param roomManager - RoomManager instance for managing workflow rooms and state
 * @param logger - Logger instance for logging requests and errors
 * @returns HTTP request handler function
 */
export function createHttpHandler(roomManager: RoomManager, logger: Logger) {
  return (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          status: 'ok',
          timestamp: new Date().toISOString(),
          connections: roomManager.getTotalActiveConnections(),
        })
      )
      return
    }

    // Handle workflow deletion notifications from the main API
    if (req.method === 'POST' && req.url === '/api/workflow-deleted') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const { workflowId } = JSON.parse(body)
          roomManager.handleWorkflowDeletion(workflowId)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (error) {
          logger.error('Error handling workflow deletion notification:', error)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Failed to process deletion notification' }))
        }
      })
      return
    }

    // Handle workflow update notifications from the main API
    if (req.method === 'POST' && req.url === '/api/workflow-updated') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const { workflowId } = JSON.parse(body)
          roomManager.handleWorkflowUpdate(workflowId)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (error) {
          logger.error('Error handling workflow update notification:', error)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Failed to process update notification' }))
        }
      })
      return
    }

    // Handle copilot workflow edit notifications from the main API
    if (req.method === 'POST' && req.url === '/api/copilot-workflow-edit') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const { workflowId, description } = JSON.parse(body)
          roomManager.handleCopilotWorkflowEdit(workflowId, description)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (error) {
          logger.error('Error handling copilot workflow edit notification:', error)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Failed to process copilot edit notification' }))
        }
      })
      return
    }

    // Handle workflow revert notifications from the main API
    if (req.method === 'POST' && req.url === '/api/workflow-reverted') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const { workflowId, timestamp } = JSON.parse(body)
          roomManager.handleWorkflowRevert(workflowId, timestamp)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (error) {
          logger.error('Error handling workflow revert notification:', error)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Failed to process revert notification' }))
        }
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  }
}
```

*   **`import type { IncomingMessage, ServerResponse } from 'http'`:** Imports the `IncomingMessage` and `ServerResponse` types from the `http` module.  These types represent the HTTP request and response objects, respectively. The `type` keyword ensures that these are only used for type checking and not included in the compiled JavaScript.
*   **`import type { RoomManager } from '@/socket-server/rooms/manager'`:** Imports the `RoomManager` type from a local module.  This likely represents a class or interface responsible for managing socket rooms and their associated state within the socket server.  Again, `type` is used to avoid importing the actual module at runtime.
*   **`interface Logger { ... }`:** Defines an interface named `Logger`.  This interface specifies the structure of a logger object, which should have `info`, `error`, `debug`, and `warn` methods. Each method accepts a message string and a variable number of arguments (`...args: any[]`). This promotes type safety and allows for different logging implementations to be used as long as they conform to this interface.
*   **`/** ... */ export function createHttpHandler(roomManager: RoomManager, logger: Logger) { ... }`:** This is a JSDoc comment explaining what the function does. Defines the `createHttpHandler` function.
    *   `export`:  Makes the function available for use in other modules.
    *   `function createHttpHandler(roomManager: RoomManager, logger: Logger)`: Declares the function, taking a `RoomManager` and a `Logger` instance as arguments.  The types are explicitly specified for type safety.
*   **`return (req: IncomingMessage, res: ServerResponse) => { ... }`:** The `createHttpHandler` function returns another function.  This returned function is the actual HTTP request handler.  It takes an `IncomingMessage` (the request) and a `ServerResponse` (the response) as arguments.
*   **`if (req.method === 'GET' && req.url === '/health') { ... }`:** Checks if the request method is `GET` and the URL is `/health`. This is a health check endpoint.
    *   **`res.writeHead(200, { 'Content-Type': 'application/json' })`:** Sets the HTTP status code to 200 (OK) and the `Content-Type` header to `application/json`, indicating that the response body will be in JSON format.
    *   **`res.end(JSON.stringify({ ... }))`:**  Sends the response body as a JSON string. The body includes:
        *   `status: 'ok'`:  Indicates that the server is healthy.
        *   `timestamp: new Date().toISOString()`:  The current timestamp in ISO 8601 format.
        *   `connections: roomManager.getTotalActiveConnections()`: The number of active connections managed by the `RoomManager`.
    *   **`return`:**  Exits the handler function after sending the response.

*   **`if (req.method === 'POST' && req.url === '/api/workflow-deleted') { ... }`**:  This and the subsequent `if` blocks handle POST requests to specific API endpoints. This specific block handles notifications when a workflow is deleted.
    *   **`let body = ''`:** Initializes an empty string variable `body` to accumulate the request body.
    *   **`req.on('data', (chunk) => { body += chunk.toString() })`:** Attaches a listener to the `data` event of the request object.  This event is emitted whenever a chunk of data is received in the request body.  The listener appends the chunk (converted to a string) to the `body` variable.
    *   **`req.on('end', () => { ... })`:** Attaches a listener to the `end` event of the request object.  This event is emitted when all data has been received in the request body.  The listener function is executed after all data is received.
        *   **`try { ... } catch (error) { ... }`:** A `try...catch` block is used to handle potential errors during JSON parsing and workflow deletion.
            *   **`const { workflowId } = JSON.parse(body)`:** Parses the JSON string in the `body` variable and extracts the `workflowId` property.  If the `body` is not valid JSON, this will throw an error.
            *   **`roomManager.handleWorkflowDeletion(workflowId)`:** Calls the `handleWorkflowDeletion` method of the `RoomManager` instance, passing the `workflowId` as an argument. This likely triggers the appropriate actions within the socket server to remove the workflow and notify relevant clients.
            *   **`res.writeHead(200, { 'Content-Type': 'application/json' })`:** Sets the HTTP status code to 200 (OK) and the `Content-Type` header to `application/json`.
            *   **`res.end(JSON.stringify({ success: true }))`:** Sends a JSON response indicating that the workflow deletion was successfully processed.
            *   **`logger.error('Error handling workflow deletion notification:', error)`:**  Logs an error message using the injected `Logger` instance. This provides debugging information about the error.
            *   **`res.writeHead(500, { 'Content-Type': 'application/json' })`:** Sets the HTTP status code to 500 (Internal Server Error) and the `Content-Type` header to `application/json`.
            *   **`res.end(JSON.stringify({ error: 'Failed to process deletion notification' }))`:** Sends a JSON response indicating that the workflow deletion notification failed to process.
        *   **`return`:**  Exits the handler function after processing the request and sending the response.

*   **`if (req.method === 'POST' && req.url === '/api/workflow-updated') { ... }`**: Handles POST requests to the `/api/workflow-updated` endpoint. Similar logic to the deletion handler, but calls `roomManager.handleWorkflowUpdate(workflowId)`.

*   **`if (req.method === 'POST' && req.url === '/api/copilot-workflow-edit') { ... }`**: Handles POST requests to the `/api/copilot-workflow-edit` endpoint. Similar logic to the deletion and update handlers, but calls `roomManager.handleCopilotWorkflowEdit(workflowId, description)`. This endpoint expects both `workflowId` and `description` to be present in the request body.

*   **`if (req.method === 'POST' && req.url === '/api/workflow-reverted') { ... }`**: Handles POST requests to the `/api/workflow-reverted` endpoint.  Similar logic to the other POST request handlers, but calls `roomManager.handleWorkflowRevert(workflowId, timestamp)`. This endpoint expects both `workflowId` and `timestamp` to be present in the request body.

*   **`res.writeHead(404, { 'Content-Type': 'application/json' })`:** Sets the HTTP status code to 404 (Not Found) and the `Content-Type` header to `application/json`. This is the default response if none of the previous routes match.
*   **`res.end(JSON.stringify({ error: 'Not found' }))`:** Sends a JSON response indicating that the requested resource was not found.

In summary, this file defines a function that creates an HTTP handler responsible for managing health checks and workflow-related notifications for a socket server.  It utilizes a `RoomManager` to manage connected clients and a `Logger` for logging events.  The handler processes POST requests to specific API endpoints, extracts data from the request body, calls appropriate methods on the `RoomManager`, and sends responses indicating success or failure.
