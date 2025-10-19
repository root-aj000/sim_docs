```typescript
import type { Socket } from 'socket.io'
import { auth } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SocketAuth')

// Extend Socket interface to include user data
export interface AuthenticatedSocket extends Socket {
  userId?: string
  userName?: string
  userEmail?: string
  activeOrganizationId?: string
}

// Enhanced authentication middleware
export async function authenticateSocket(socket: AuthenticatedSocket, next: any) {
  try {
    // Extract authentication data from socket handshake
    const token = socket.handshake.auth?.token
    const origin = socket.handshake.headers.origin
    const referer = socket.handshake.headers.referer

    logger.info(`Socket ${socket.id} authentication attempt:`, {
      hasToken: !!token,
      origin,
      referer,
    })

    if (!token) {
      logger.warn(`Socket ${socket.id} rejected: No authentication token found`)
      return next(new Error('Authentication required'))
    }

    // Validate one-time token with Better Auth
    try {
      logger.debug(`Attempting token validation for socket ${socket.id}`, {
        tokenLength: token?.length || 0,
        origin,
      })

      const session = await auth.api.verifyOneTimeToken({
        body: {
          token,
        },
      })

      if (!session?.user?.id) {
        logger.warn(`Socket ${socket.id} rejected: Invalid token - no user found`)
        return next(new Error('Invalid session'))
      }

      // Store user info in socket for later use
      socket.userId = session.user.id
      socket.userName = session.user.name || session.user.email || 'Unknown User'
      socket.userEmail = session.user.email
      socket.activeOrganizationId = session.session.activeOrganizationId || undefined

      next()
    } catch (tokenError) {
      const errorMessage = tokenError instanceof Error ? tokenError.message : String(tokenError)
      const errorStack = tokenError instanceof Error ? tokenError.stack : undefined

      logger.warn(`Token validation failed for socket ${socket.id}:`, {
        error: errorMessage,
        stack: errorStack,
        origin,
        referer,
      })
      return next(new Error('Token validation failed'))
    }
  } catch (error) {
    logger.error(`Socket authentication error for ${socket.id}:`, error)
    next(new Error('Authentication failed'))
  }
}
```

### Purpose of this file:

This TypeScript file defines an authentication middleware for Socket.IO connections. It's responsible for:

1.  **Authenticating Socket.IO connections:**  It verifies the identity of a client attempting to connect to a Socket.IO server using a one-time token.
2.  **Extending Socket type:**  It extends the standard Socket.IO `Socket` interface to include user-specific data, making this data accessible throughout the socket's lifecycle.
3.  **Logging:** It logs authentication attempts, successes, and failures, providing valuable insights for debugging and security monitoring.

### Detailed Explanation:

**1. Imports:**

```typescript
import type { Socket } from 'socket.io'
import { auth } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
```

*   `import type { Socket } from 'socket.io'`: Imports the `Socket` type from the `socket.io` library.  The `type` keyword ensures that this import is only used for type checking and does not introduce any runtime dependencies, which is important for performance.
*   `import { auth } from '@/lib/auth'`: Imports an `auth` object from a local module (`@/lib/auth`). This `auth` object is assumed to contain authentication-related functions, likely including a function to verify tokens.
*   `import { createLogger } from '@/lib/logs/console/logger'`: Imports a `createLogger` function from a local module (`@/lib/logs/console/logger`). This function is used to create a logger instance for logging authentication events.  It likely configures the logger with a specific prefix or context.

**2. Logger Instance:**

```typescript
const logger = createLogger('SocketAuth')
```

*   `const logger = createLogger('SocketAuth')`: Creates a logger instance using the `createLogger` function, naming it 'SocketAuth'. This logger will be used throughout the file to record information about the authentication process.  The logger likely outputs to the console and may also write to log files.

**3. `AuthenticatedSocket` Interface:**

```typescript
// Extend Socket interface to include user data
export interface AuthenticatedSocket extends Socket {
  userId?: string
  userName?: string
  userEmail?: string
  activeOrganizationId?: string
}
```

*   `export interface AuthenticatedSocket extends Socket { ... }`:  This defines a new TypeScript interface named `AuthenticatedSocket`.  Critically, it *extends* the existing `Socket` interface from `socket.io`.  This means that an `AuthenticatedSocket` is *also* a `Socket`, but with additional properties.
*   `userId?: string`:  Adds an optional `userId` property of type string to the `AuthenticatedSocket` interface.  This will store the user's ID after successful authentication. The `?` makes it optional, as the socket might not be authenticated yet.
*   `userName?: string`:  Adds an optional `userName` property of type string.
*   `userEmail?: string`: Adds an optional `userEmail` property of type string.
*   `activeOrganizationId?: string`: Adds an optional `activeOrganizationId` property of type string.  This suggests the application supports multiple organizations and associates the socket with a specific organization.

By extending the `Socket` interface, the authentication middleware can attach user-specific information directly to the socket object, making it easily accessible to other parts of the application that handle socket events.

**4. `authenticateSocket` Function (Authentication Middleware):**

```typescript
// Enhanced authentication middleware
export async function authenticateSocket(socket: AuthenticatedSocket, next: any) {
  try {
    // Extract authentication data from socket handshake
    const token = socket.handshake.auth?.token
    const origin = socket.handshake.headers.origin
    const referer = socket.handshake.headers.referer

    logger.info(`Socket ${socket.id} authentication attempt:`, {
      hasToken: !!token,
      origin,
      referer,
    })

    if (!token) {
      logger.warn(`Socket ${socket.id} rejected: No authentication token found`)
      return next(new Error('Authentication required'))
    }

    // Validate one-time token with Better Auth
    try {
      logger.debug(`Attempting token validation for socket ${socket.id}`, {
        tokenLength: token?.length || 0,
        origin,
      })

      const session = await auth.api.verifyOneTimeToken({
        body: {
          token,
        },
      })

      if (!session?.user?.id) {
        logger.warn(`Socket ${socket.id} rejected: Invalid token - no user found`)
        return next(new Error('Invalid session'))
      }

      // Store user info in socket for later use
      socket.userId = session.user.id
      socket.userName = session.user.name || session.user.email || 'Unknown User'
      socket.userEmail = session.user.email
      socket.activeOrganizationId = session.session.activeOrganizationId || undefined

      next()
    } catch (tokenError) {
      const errorMessage = tokenError instanceof Error ? tokenError.message : String(tokenError)
      const errorStack = tokenError instanceof Error ? tokenError.stack : undefined

      logger.warn(`Token validation failed for socket ${socket.id}:`, {
        error: errorMessage,
        stack: errorStack,
        origin,
        referer,
      })
      return next(new Error('Token validation failed'))
    }
  } catch (error) {
    logger.error(`Socket authentication error for ${socket.id}:`, error)
    next(new Error('Authentication failed'))
  }
}
```

*   `export async function authenticateSocket(socket: AuthenticatedSocket, next: any) { ... }`: Defines an asynchronous function named `authenticateSocket`. This function serves as the authentication middleware. It receives the `socket` object (of type `AuthenticatedSocket`), and a `next` function.  The `next` function is crucial for middleware; it's what you call to pass control to the next middleware in the chain, or to the final handler if this is the last middleware.
*   `try { ... } catch (error) { ... }`:  A top-level `try...catch` block to handle any errors that might occur during the authentication process.  This ensures that any errors are caught and logged, and that the connection is properly handled (e.g., by disconnecting or sending an error message).
*   `const token = socket.handshake.auth?.token`: Extracts the authentication token from the socket's handshake data. Socket.IO allows clients to send authentication information during the initial connection handshake. The code accesses the token using the optional chaining operator (`?.`) to gracefully handle cases where `socket.handshake.auth` or `socket.handshake.auth.token` is undefined.
*   `const origin = socket.handshake.headers.origin`: Retrieves the `origin` header from the socket handshake headers. This header indicates the origin of the client connecting to the server, which can be useful for security checks and logging.
*   `const referer = socket.handshake.headers.referer`: Retrieves the `referer` header from the socket handshake headers.  Similar to `origin`, the `referer` header provides information about the page or resource that linked the client to the server.
*   `logger.info(...)`: Logs an informational message indicating that an authentication attempt is being made for the given socket. The log message includes the socket ID, whether a token was provided, the origin, and the referer.
*   `if (!token) { ... }`: Checks if a token was provided. If no token is present, it logs a warning message, and calls `next(new Error('Authentication required'))`.  Critically, calling `next` with an `Error` object signals to Socket.IO that the middleware has failed, and the connection will be rejected with the provided error message.
*   `try { ... } catch (tokenError) { ... }`: A nested `try...catch` block specifically to handle errors that might occur during token validation.
*   `logger.debug(...)`: Logs a debug message before attempting to validate the token. This log includes the length of the token (for debugging purposes) and the origin.
*   `const session = await auth.api.verifyOneTimeToken({ body: { token } })`: This is the core of the authentication logic. It calls an asynchronous function `auth.api.verifyOneTimeToken` (presumably provided by the `auth` module) to validate the token.  The token is sent in the `body` of the request. The `await` keyword pauses execution until the token validation is complete.
*   `if (!session?.user?.id) { ... }`: After attempting to verify the token, this code checks if the `session` object returned from `auth.api.verifyOneTimeToken` contains a valid user ID. If `session`, `session.user`, or `session.user.id` are null or undefined, or if the user ID is missing, it means the token is invalid.  A warning is logged, and `next` is called with an `Error` to reject the connection.
*   `socket.userId = session.user.id; ...`: If the token is valid, this block extracts user information from the `session` object and stores it in the `socket` object's properties (`userId`, `userName`, `userEmail`, and `activeOrganizationId`). This makes the user information available to other parts of the application that handle socket events. The code uses the `||` operator to provide a default value for `userName` if the user's name is not available (using the email if it exists, otherwise "Unknown User"). The `activeOrganizationId` uses the nullish coalescing operator (`|| undefined`) to handle cases where the session doesn't have an active organization.
*   `next()`:  If the token is valid and user information has been stored in the socket, this calls `next()` without any arguments.  This signals to Socket.IO that the authentication middleware has succeeded, and the connection should be allowed to proceed.  The next middleware in the chain (if any) will be executed.
*   `const errorMessage = tokenError instanceof Error ? tokenError.message : String(tokenError)`: Extracts the error message from the `tokenError` object. This handles cases where the error is an `Error` instance (in which case the `message` property is used) or another type of object (in which case the object is converted to a string).
*   `const errorStack = tokenError instanceof Error ? tokenError.stack : undefined`: Extracts the stack trace from the `tokenError` object if it is an instance of the `Error` class.
*   `logger.warn(...)`: Logs a warning message indicating that token validation failed. The log includes the error message, stack trace (if available), origin, and referer.
*   `return next(new Error('Token validation failed'))`: Calls `next` with an `Error` object, indicating that token validation failed and the connection should be rejected.
*   `logger.error(...)`: The outer `catch` block logs a general error message if any other error occurs during the authentication process.
*   `next(new Error('Authentication failed'))`: Calls `next` with an `Error` object, indicating that authentication failed and the connection should be rejected.

### Simplifying Complex Logic

The code is already relatively well-structured and readable.  However, here are a few suggestions to potentially simplify it further:

1.  **Create a Helper Function for Token Validation:**  Extract the token validation logic into a separate, reusable function. This improves readability and makes the code easier to test:

    ```typescript
    async function validateToken(token: string): Promise<any> {
      try {
        const session = await auth.api.verifyOneTimeToken({
          body: {
            token,
          },
        })
        return session;
      } catch (error) {
        throw error;
      }
    }

    export async function authenticateSocket(socket: AuthenticatedSocket, next: any) {
      try {
        // ... existing code ...

        try {
          const session = await validateToken(token);

          if (!session?.user?.id) {
            logger.warn(`Socket ${socket.id} rejected: Invalid token - no user found`);
            return next(new Error('Invalid session'));
          }

          // ... existing code ...
        } catch (tokenError) {
          // ... existing code ...
        }

      } catch (error) {
        // ... existing code ...
      }
    }
    ```

2.  **Use a Configuration Object for Logging:**  If you have multiple log statements with similar data, consider creating a configuration object to hold the common data:

    ```typescript
    export async function authenticateSocket(socket: AuthenticatedSocket, next: any) {
      try {
        // ... existing code ...

        const logContext = {
          socketId: socket.id,
          origin,
          referer,
        };

        logger.info(`Socket ${socket.id} authentication attempt:`, {
          ...logContext,
          hasToken: !!token,
        });

        if (!token) {
          logger.warn(`Socket ${socket.id} rejected: No authentication token found`, logContext);
          return next(new Error('Authentication required'));
        }

        // ... existing code ...
      } catch (error) {
        // ... existing code ...
      }
    }
    ```

3.  **Centralize Error Handling:** Create a function for handling and logging errors in a consistent way.  This can encapsulate the logic for extracting error messages and stacks.

    ```typescript
    function handleTokenValidationError(socketId: string, tokenError: any, origin: string, referer: string, next: any) {
        const errorMessage = tokenError instanceof Error ? tokenError.message : String(tokenError);
        const errorStack = tokenError instanceof Error ? tokenError.stack : undefined;

        logger.warn(`Token validation failed for socket ${socketId}:`, {
            error: errorMessage,
            stack: errorStack,
            origin,
            referer,
        });
        return next(new Error('Token validation failed'));
    }
    ```

### Summary

This file provides a robust and well-documented authentication middleware for Socket.IO applications using one-time tokens. It handles token validation, user information storage, and detailed logging, ensuring secure and reliable socket connections. The use of TypeScript interfaces enhances type safety and code maintainability. The `next()` callback is crucial for allowing the request to proceed to its destination. The logging, along with contextual data, allows for effective issue diagnosis.
