```typescript
import type { Server as HttpServer } from 'http'
import { Server } from 'socket.io'
import { env } from '@/lib/env'
import { isProd } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'

const logger = createLogger('SocketIOConfig')

/**
 * Get allowed origins for Socket.IO CORS configuration
 *
 * This function determines the origins that are permitted to connect to the Socket.IO server.
 * It combines a dynamically generated base URL, localhost URLs, and URLs from environment variables,
 * ensuring a flexible and secure configuration.
 *
 * @returns string[] - An array of allowed origin strings.
 */
function getAllowedOrigins(): string[] {
  // 1. Start with a base set of allowed origins:
  //   - The application's base URL (obtained dynamically).
  //   - 'http://localhost:3000' (for development).
  //   - 'http://localhost:3001' (another common development port).
  const allowedOrigins = [
    getBaseUrl(),
    'http://localhost:3000',
    'http://localhost:3001',
    // 2. Add origins from the `ALLOWED_ORIGINS` environment variable (if defined).
    //    - `env.ALLOWED_ORIGINS?.split(',')` splits the comma-separated string into an array.
    //    - `|| []` provides a default empty array if `ALLOWED_ORIGINS` is not defined, avoiding errors.
    ...(env.ALLOWED_ORIGINS?.split(',') || []),
  ].filter((url): url is string => Boolean(url)) // 3. Filter out any empty or undefined strings from the array, and also type assertion

  logger.info('Socket.IO CORS configuration:', { allowedOrigins })

  return allowedOrigins
}

/**
 * Create and configure a Socket.IO server instance.
 *
 * This function sets up the Socket.IO server with various configurations,
 * including CORS (Cross-Origin Resource Sharing), transports, ping settings,
 * buffer size, and cookie settings.  It aims to provide a robust and secure
 * Socket.IO setup.
 *
 * @param httpServer - The HTTP server instance to attach Socket.IO to.  This allows
 *                     Socket.IO to share the same port and underlying infrastructure.
 * @returns Configured Socket.IO server instance.
 */
export function createSocketIOServer(httpServer: HttpServer): Server {
  // 1. Determine the allowed origins using the `getAllowedOrigins` function.
  const allowedOrigins = getAllowedOrigins()

  // 2. Create a new Socket.IO server instance, attaching it to the provided HTTP server.
  const io = new Server(httpServer, {
    // 3. Configure CORS (Cross-Origin Resource Sharing) to control which origins can connect.
    cors: {
      // `origin`:  The array of allowed origins (determined earlier).
      origin: allowedOrigins,
      // `methods`:  Allowed HTTP methods for the CORS preflight request.
      methods: ['GET', 'POST', 'OPTIONS'],
      // `allowedHeaders`:  Allowed headers in the actual request. Includes Content-Type for data,
      //                    Authorization for authentication, Cookie for session management, and
      //                    socket.io for Socket.IO-specific headers.
      allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'socket.io'],
      // `credentials`:  Enable sending cookies from the client to the server.  Essential for
      //                 session-based authentication with Socket.IO.
      credentials: true, // Enable credentials to accept cookies
    },
    // 4. Configure transports:
    //   - `websocket`:  The preferred transport protocol for real-time communication.
    //   - `polling`:  A fallback transport that uses HTTP long-polling if WebSocket is not available.
    transports: ['websocket', 'polling'], // WebSocket first, polling as fallback
    // 5. Keep legacy support for compatibility with older Socket.IO clients
    allowEIO3: true, // Keep legacy support for compatibility
    // 6. Configure ping settings to detect and handle broken connections:
    //   - `pingTimeout`:  The time (in milliseconds) the server waits for a ping from the client
    //                     before considering the connection closed.  A longer timeout prevents
    //                     premature disconnection in unreliable networks.
    pingTimeout: 60000, // Back to original conservative setting
    //   - `pingInterval`: The interval (in milliseconds) at which the server sends pings to the client.
    pingInterval: 25000, // Back to original interval
    // 7. Configure the maximum HTTP buffer size (in bytes).  This limits the size of individual messages
    //    to prevent denial-of-service attacks.
    maxHttpBufferSize: 1e6,
    // 8. Configure cookie settings for session management and sticky sessions:
    cookie: {
      // `name`: The name of the cookie used to store the Socket.IO session ID.
      name: 'io',
      // `path`:  The path for which the cookie is valid (root path in this case).
      path: '/',
      // `httpOnly`:  Prevent client-side JavaScript from accessing the cookie for security.
      httpOnly: true,
      // `sameSite`:  Controls when the browser sends the cookie with cross-site requests.  `none`
      //               is required for cross-origin Socket.IO connections, but it also requires `secure: true`.
      sameSite: 'none', // Required for cross-origin cookies
      // `secure`:  Indicates whether the cookie should only be transmitted over HTTPS.  Enabled in production
      //            for security reasons.
      secure: isProd, // HTTPS in production
    },
  })

  logger.info('Socket.IO server configured with:', {
    allowedOrigins: allowedOrigins.length,
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
    cookieSecure: isProd,
    corsCredentials: true,
  })

  return io
}
```

**Explanation:**

This code configures a Socket.IO server within a TypeScript environment. It focuses on security, stability, and compatibility. Here's a breakdown:

**1. Purpose of the File:**

The primary goal of this file is to encapsulate the creation and configuration of a Socket.IO server instance.  This includes:

*   **Defining Allowed Origins (CORS):**  Specifying which websites are permitted to connect to the Socket.IO server. This is a crucial security measure.
*   **Setting Transports:**  Configuring the communication protocols (WebSocket and polling) used by Socket.IO.
*   **Tuning Ping Settings:**  Adjusting the ping interval and timeout to maintain stable connections and detect disconnections effectively.
*   **Managing Cookie Settings:**  Configuring cookie attributes for session management and cross-origin communication.
*   **Logging Configuration:** Logging essential configuration values.

**2. Imports:**

*   `import type { Server as HttpServer } from 'http'`: Imports the `Server` type from the `http` module. This is used to type the `httpServer` parameter in the `createSocketIOServer` function.  We only need the *type* here, not the actual `Server` class, hence `import type`. This avoids importing the entire `http` module when it's not needed.
*   `import { Server } from 'socket.io'`: Imports the `Server` class from the `socket.io` library, which is the core class for creating Socket.IO servers.
*   `import { env } from '@/lib/env'`: Imports an `env` object from a local module (`@/lib/env`). This object likely contains environment variables used for configuration (e.g., `ALLOWED_ORIGINS`).  The `@/` alias likely refers to the project's root directory.
*   `import { isProd } from '@/lib/environment'`: Imports the `isProd` boolean from a local module (`@/lib/environment`).  This variable likely indicates whether the application is running in a production environment.
*   `import { createLogger } from '@/lib/logs/console/logger'`: Imports a `createLogger` function from a local module (`@/lib/logs/console/logger`). This function is used to create a logger instance for logging messages related to the Socket.IO configuration.
*   `import { getBaseUrl } from '@/lib/urls/utils'`: Imports a `getBaseUrl` function from a local module (`@/lib/urls/utils`). This function is likely used to dynamically determine the base URL of the application.

**3. Logger Instance:**

*   `const logger = createLogger('SocketIOConfig')`: Creates a logger instance using the `createLogger` function.  The string `'SocketIOConfig'` is likely used as a label or category for the logger, making it easier to filter and identify log messages related to this module.

**4. `getAllowedOrigins` Function:**

This function is responsible for determining the allowed origins for CORS (Cross-Origin Resource Sharing).

*   **Purpose:** To create a list of URLs that are permitted to connect to the Socket.IO server. This is a critical security measure to prevent unauthorized access.
*   **Logic:**
    1.  **Base Origins:** Starts with a predefined set of allowed origins, including the application's base URL (obtained using `getBaseUrl()`) and common localhost URLs for development.
    2.  **Environment Variable Origins:**  Retrieves additional allowed origins from the `ALLOWED_ORIGINS` environment variable.  If the variable is defined, it splits the comma-separated string into an array of URLs.
    3.  **Filtering:** Filters the resulting array to remove any empty or `undefined` values, ensuring that only valid URLs are included.
    4.  **Logging:** Logs the complete list of allowed origins using the logger instance.
*   **Return Value:** Returns an array of strings, where each string represents an allowed origin.
*   **Type Safety:**  The `.filter((url): url is string => Boolean(url))` line uses a type predicate to ensure that the resulting array only contains strings. This provides better type safety in subsequent code that uses the allowed origins.

**5. `createSocketIOServer` Function:**

This function creates and configures the Socket.IO server.

*   **Purpose:** To instantiate and configure a Socket.IO server instance, attaching it to an existing HTTP server.
*   **Parameters:**
    *   `httpServer: HttpServer`:  An instance of an HTTP server (from the `http` module). The Socket.IO server will be attached to this HTTP server, sharing the same port and underlying infrastructure.
*   **Logic:**
    1.  **Get Allowed Origins:** Calls the `getAllowedOrigins()` function to get the list of allowed origins for CORS.
    2.  **Create Socket.IO Server:** Creates a new `Server` instance from the `socket.io` library, passing in the `httpServer` and a configuration object.
    3.  **CORS Configuration:** Configures CORS options:
        *   `origin`: Sets the allowed origins to the list obtained from `getAllowedOrigins()`.
        *   `methods`: Specifies the allowed HTTP methods for the CORS preflight request (GET, POST, OPTIONS).
        *   `allowedHeaders`: Specifies the allowed headers in the actual request, including `Content-Type`, `Authorization`, and `Cookie`, as well as `socket.io` for internal Socket.IO communication.
        *   `credentials`:  Enables sending cookies from the client to the server, which is essential for session-based authentication.
    4.  **Transport Configuration:**
        *   `transports`:  Specifies the transport protocols to use for communication. `['websocket', 'polling']` indicates that WebSocket is preferred, but HTTP long-polling will be used as a fallback if WebSocket is not available.
    5.  **Legacy Support:**
        *   `allowEIO3`:  Enables support for older Socket.IO clients (version 3).  This is often included for backward compatibility.
    6.  **Ping Configuration:**
        *   `pingTimeout`: Sets the timeout (in milliseconds) for pings. If the server doesn't receive a ping from the client within this time, it considers the connection broken. A longer timeout helps prevent premature disconnections on unreliable networks.
        *   `pingInterval`: Sets the interval (in milliseconds) at which the server sends pings to the client to check if the connection is still alive.
    7.  **Buffer Size:**
        *   `maxHttpBufferSize`: Sets the maximum size (in bytes) of HTTP messages that the server will accept.  This helps prevent denial-of-service attacks by limiting the size of individual requests.
    8.  **Cookie Configuration:** Configures cookie attributes for session management:
        *   `name`: Sets the name of the cookie to `'io'`.
        *   `path`: Sets the cookie path to `'/'`, making it valid for the entire domain.
        *   `httpOnly`: Sets the `httpOnly` flag to `true`, preventing client-side JavaScript from accessing the cookie for security.
        *   `sameSite`: Sets the `sameSite` attribute to `'none'`, which is required for cross-origin cookies.  This is used when the Socket.IO server is on a different domain than the client.  However, `sameSite: 'none'` also requires `secure: true`.
        *   `secure`: Sets the `secure` flag to `isProd`, meaning the cookie will only be transmitted over HTTPS in production environments. This is essential for security reasons when `sameSite: 'none'` is used.
    9.  **Logging:** Logs the Socket.IO server configuration using the logger instance. This provides a record of the settings used to configure the server.
*   **Return Value:** Returns the configured Socket.IO `Server` instance.

**3. Simplifications and Key Improvements:**

*   **Detailed Comments:** The code is thoroughly commented, explaining the purpose and logic of each section and line.
*   **Logical Grouping:** Code is grouped into logical blocks to improve readability.
*   **Environment Variable Handling:** The code gracefully handles the case where the `ALLOWED_ORIGINS` environment variable is not defined, preventing errors.
*   **Type Safety:** The use of TypeScript ensures type safety, reducing the risk of runtime errors. The filter on the origins array explicitly defines the return type using a type predicate.
*   **Clear Function Responsibilities:** The `getAllowedOrigins` and `createSocketIOServer` functions have clear responsibilities, making the code easier to understand and maintain.
*   **Security Considerations:**  The code explicitly addresses security concerns such as CORS, cookie settings (including `httpOnly`, `sameSite`, and `secure`), and buffer size limits.
*   **Configuration Logging:**  The code logs the Socket.IO server configuration, which is helpful for debugging and monitoring.

In summary, this code provides a well-structured, secure, and configurable Socket.IO server setup using TypeScript.  The detailed comments and clear organization make it easy to understand and maintain.
