```typescript
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

describe('Socket Server Integration Tests', () => {
  let httpServer: any;
  let socketServer: Server;
  let clientSocket: Socket;
  let serverPort: number;

  beforeAll(async () => {
    // Create a test server instance
    httpServer = createServer();
    socketServer = new Server(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    // Start server on random port
    await new Promise<void>((resolve) => {
      httpServer.listen(() => {
        serverPort = httpServer.address()?.port;
        resolve();
      });
    });

    // Basic socket handlers for testing
    socketServer.on('connection', (socket) => {
      socket.on('join-workflow', ({ workflowId }) => {
        socket.join(workflowId);
        socket.emit('joined-workflow', { workflowId });
      });

      socket.on('workflow-operation', (data) => {
        socket.to(data.workflowId || 'test-workflow').emit('workflow-operation', {
          ...data,
          senderId: socket.id,
        });
      });
    });
  });

  afterAll(async () => {
    if (socketServer) {
      socketServer.close();
    }
    if (httpServer) {
      httpServer.close();
    }
  });

  beforeEach(async () => {
    // Create client socket for each test
    clientSocket = io(`http://localhost:${serverPort}`, {
      transports: ['polling', 'websocket'],
    });

    await new Promise<void>((resolve) => {
      clientSocket.on('connect', () => {
        resolve();
      });
    });
  });

  afterEach(() => {
    if (clientSocket) {
      clientSocket.close();
    }
  });

  it('should connect to socket server', () => {
    expect(clientSocket.connected).toBe(true);
  });

  it('should join workflow room', async () => {
    const workflowId = 'test-workflow-123';

    const joinedPromise = new Promise<void>((resolve) => {
      clientSocket.on('joined-workflow', (data) => {
        expect(data.workflowId).toBe(workflowId);
        resolve();
      });
    });

    clientSocket.emit('join-workflow', { workflowId });
    await joinedPromise;
  });

  it('should broadcast workflow operations', async () => {
    const workflowId = 'test-workflow-456';

    // Create second client
    const client2 = io(`http://localhost:${serverPort}`);
    await new Promise<void>((resolve) => {
      client2.on('connect', resolve);
    });

    // Both clients join the same workflow
    clientSocket.emit('join-workflow', { workflowId });
    client2.emit('join-workflow', { workflowId });

    // Wait for joins to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    const operationPromise = new Promise<void>((resolve) => {
      client2.on('workflow-operation', (data) => {
        expect(data.operation).toBe('add');
        expect(data.target).toBe('block');
        expect(data.payload.id).toBe('block-123');
        resolve();
      });
    });

    // Client 1 sends operation
    clientSocket.emit('workflow-operation', {
      workflowId,
      operation: 'add',
      target: 'block',
      payload: { id: 'block-123', type: 'action', name: 'Test Block' },
      timestamp: Date.now(),
    });

    await operationPromise;
    client2.close();
  });

  it('should handle multiple concurrent connections', async () => {
    const numClients = 10;
    const clients: Socket[] = [];
    const workflowId = 'stress-test-workflow';

    // Create multiple clients
    for (let i = 0; i < numClients; i++) {
      const client = io(`http://localhost:${serverPort}`);
      clients.push(client);

      await new Promise<void>((resolve) => {
        client.on('connect', resolve);
      });

      client.emit('join-workflow', { workflowId });
    }

    // Wait for all joins
    await new Promise((resolve) => setTimeout(resolve, 200));

    let receivedCount = 0;
    const expectedCount = numClients - 1; // All except sender

    const operationPromise = new Promise<void>((resolve) => {
      clients.forEach((client, index) => {
        if (index === 0) return; // Skip sender

        client.on('workflow-operation', () => {
          receivedCount++;
          if (receivedCount === expectedCount) {
            resolve();
          }
        });
      });
    });

    // First client sends operation
    clients[0].emit('workflow-operation', {
      workflowId,
      operation: 'add',
      target: 'block',
      payload: { id: 'stress-block', type: 'action' },
      timestamp: Date.now(),
    });

    await operationPromise;
    expect(receivedCount).toBe(expectedCount);

    // Clean up
    clients.forEach((client) => client.close());
  });

  it('should handle rapid operations without loss', async () => {
    const workflowId = 'rapid-test-workflow';
    const numOperations = 50;

    const client2 = io(`http://localhost:${serverPort}`);
    await new Promise<void>((resolve) => {
      client2.on('connect', resolve);
    });

    clientSocket.emit('join-workflow', { workflowId });
    client2.emit('join-workflow', { workflowId });

    await new Promise((resolve) => setTimeout(resolve, 100));

    let receivedCount = 0;
    const receivedOperations = new Set<string>();

    const operationsPromise = new Promise<void>((resolve) => {
      client2.on('workflow-operation', (data) => {
        receivedCount++;
        receivedOperations.add(data.payload.id);

        if (receivedCount === numOperations) {
          resolve();
        }
      });
    });

    // Send rapid operations
    for (let i = 0; i < numOperations; i++) {
      clientSocket.emit('workflow-operation', {
        workflowId,
        operation: 'add',
        target: 'block',
        payload: { id: `rapid-block-${i}`, type: 'action' },
        timestamp: Date.now(),
      });
    }

    await operationsPromise;
    expect(receivedCount).toBe(numOperations);
    expect(receivedOperations.size).toBe(numOperations);

    client2.close();
  });
});
```

### Purpose of this File

This file contains integration tests for a Socket.IO server.  It tests the server's ability to:

1.  Establish connections.
2.  Handle clients joining and leaving "workflow" rooms.
3.  Broadcast "workflow operations" (messages) to clients within the same workflow room.
4.  Handle multiple concurrent connections.
5.  Handle a high volume of messages without data loss.

### Simplification of Complex Logic

The code utilizes `async/await` to manage asynchronous operations, such as connecting to the server and waiting for events.  `Promises` are used extensively to synchronize the test execution with the asynchronous behavior of the Socket.IO connections.  `Vitest`'s `describe`, `it`, `beforeAll`, `afterAll`, `beforeEach`, and `afterEach` functions structure the tests in a clear and organized manner.  The use of `expect` assertions clearly defines the expected behavior of the socket server. The tests are crafted to cover the core functionality of the socket server, ensuring reliable broadcasting of workflow operations to the appropriate clients.

### Line-by-Line Explanation

```typescript
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
```

*   **Imports:** This section imports necessary modules:
    *   `createServer` from `http`: Used to create a basic HTTP server, which Socket.IO will then enhance with WebSocket capabilities.
    *   `Server` from `socket.io`: The Socket.IO server class.
    *   `io` and `Socket` from `socket.io-client`:  The Socket.IO client, used to create client connections for testing. `type Socket` is used to specifically type the client socket to `Socket` for type safety.
    *   `afterAll`, `afterEach`, `beforeAll`, `beforeEach`, `describe`, `expect`, `it` from `vitest`:  Vitest's testing framework functions for structuring tests.

```typescript
describe('Socket Server Integration Tests', () => {
  let httpServer: any;
  let socketServer: Server;
  let clientSocket: Socket;
  let serverPort: number;
```

*   **`describe('Socket Server Integration Tests', () => { ... });`**:  Defines a test suite for Socket Server Integration Tests. All the tests related to socket server integration will be grouped inside this block.
*   **Variable Declarations:** Declares variables to hold the HTTP server, Socket.IO server, a client socket, and the port the server is listening on. Note that `httpServer` is typed as `any` which is not ideal; a better practice would be to type it as `http.Server`.

```typescript
  beforeAll(async () => {
    // Create a test server instance
    httpServer = createServer();
    socketServer = new Server(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });
```

*   **`beforeAll(async () => { ... });`**:  A Vitest hook that runs once *before* all tests in the `describe` block. This is used to set up the test environment.  The `async` keyword signifies that this function contains asynchronous operations.
*   **`httpServer = createServer();`**: Creates an HTTP server instance using Node.js's built-in `http` module.  This server will be used as the foundation for the Socket.IO server.
*   **`socketServer = new Server(httpServer, { ... });`**: Creates a new Socket.IO server instance, attaching it to the HTTP server.  The `cors` option allows connections from any origin (`origin: '*'`) and specifies allowed HTTP methods.  This is crucial for client-side JavaScript to connect to the server from different domains during testing.

```typescript
    // Start server on random port
    await new Promise<void>((resolve) => {
      httpServer.listen(() => {
        serverPort = httpServer.address()?.port;
        resolve();
      });
    });
```

*   This section starts the HTTP server and retrieves the port it's listening on.  It uses a `Promise` to wait for the server to start listening before proceeding.
*   **`await new Promise<void>((resolve) => { ... });`**: Creates a `Promise` that resolves when the server starts listening.  This ensures that the tests don't start before the server is ready.
*   **`httpServer.listen(() => { ... });`**: Starts the HTTP server, listening on an available port. When the server is successfully listening, the callback function is executed.
*   **`serverPort = httpServer.address()?.port;`**:  Gets the port number that the server is listening on. `httpServer.address()` returns an object containing the address information or `null` if the server is not listening. The `?.` (optional chaining) handles the case where `httpServer.address()` returns `null`.
*   **`resolve();`**: Resolves the `Promise`, signaling that the server has started listening and the `serverPort` is available.

```typescript
    // Basic socket handlers for testing
    socketServer.on('connection', (socket) => {
      socket.on('join-workflow', ({ workflowId }) => {
        socket.join(workflowId);
        socket.emit('joined-workflow', { workflowId });
      });

      socket.on('workflow-operation', (data) => {
        socket.to(data.workflowId || 'test-workflow').emit('workflow-operation', {
          ...data,
          senderId: socket.id,
        });
      });
    });
  });
```

*   This sets up the core Socket.IO event handlers on the server.
*   **`socketServer.on('connection', (socket) => { ... });`**:  Registers a handler for the `connection` event.  This event is emitted whenever a new client connects to the server. The callback function receives the `socket` object, which represents the individual client connection.
*   **`socket.on('join-workflow', ({ workflowId }) => { ... });`**:  Registers a handler for the `join-workflow` event on the client's socket.  When a client emits this event (e.g., `socket.emit('join-workflow', { workflowId: 'some-id' })`), this handler is executed.
*   **`socket.join(workflowId);`**:  Adds the client's socket to a Socket.IO "room" identified by `workflowId`.  Rooms are a way to group sockets together so that messages can be broadcast to only those sockets in the room.
*   **`socket.emit('joined-workflow', { workflowId });`**: Emits a `joined-workflow` event back to the *specific* client that requested to join the workflow, confirming the join.  This is an acknowledgement.
*   **`socket.on('workflow-operation', (data) => { ... });`**:  Registers a handler for the `workflow-operation` event. This is the primary mechanism for clients to send workflow-related data to the server.
*   **`socket.to(data.workflowId || 'test-workflow').emit('workflow-operation', { ... });`**:  This is the core logic for broadcasting messages. `socket.to(data.workflowId || 'test-workflow')` sends the message *only* to sockets in the room identified by `data.workflowId`.  If `data.workflowId` is not provided (or is `null` or `undefined`), it defaults to the `test-workflow` room.  `emit('workflow-operation', { ... })` then emits the `workflow-operation` event with the provided data to all clients *in the specified room*.
*   **`...data`**: Spreads all the properties from the original `data` object into the new object being emitted, preserving the original data.
*   **`senderId: socket.id`**: Adds a `senderId` property to the emitted data, indicating the ID of the socket that sent the original message. This allows clients to identify the source of the operation.

```typescript
  afterAll(async () => {
    if (socketServer) {
      socketServer.close();
    }
    if (httpServer) {
      httpServer.close();
    }
  });
```

*   **`afterAll(async () => { ... });`**:  A Vitest hook that runs once *after* all tests in the `describe` block.  This is used to clean up the test environment, preventing resource leaks.
*   **`if (socketServer) { socketServer.close(); }`**:  Closes the Socket.IO server, disconnecting all clients and releasing resources.
*   **`if (httpServer) { httpServer.close(); }`**:  Closes the underlying HTTP server.

```typescript
  beforeEach(async () => {
    // Create client socket for each test
    clientSocket = io(`http://localhost:${serverPort}`, {
      transports: ['polling', 'websocket'],
    });

    await new Promise<void>((resolve) => {
      clientSocket.on('connect', () => {
        resolve();
      });
    });
  });
```

*   **`beforeEach(async () => { ... });`**:  A Vitest hook that runs *before* each test in the `describe` block.  This is used to set up the environment required for each individual test.
*   **`clientSocket = io(`http://localhost:${serverPort}`, { ... });`**: Creates a new Socket.IO client instance, connecting to the server at `http://localhost:${serverPort}`.
    *   The `transports: ['polling', 'websocket']` option specifies the allowed transport mechanisms. It first tries websocket and if it fails, it uses HTTP long polling.
*   This section uses a `Promise` to wait for the client socket to connect to the server.
*   **`await new Promise<void>((resolve) => { ... });`**: Creates a `Promise` that resolves when the client socket connects. This ensures that the test doesn't start before the client is connected.
*   **`clientSocket.on('connect', () => { ... });`**:  Registers a handler for the `connect` event on the client socket.  This event is emitted when the client successfully connects to the server.
*   **`resolve();`**: Resolves the `Promise`, signaling that the client has connected.

```typescript
  afterEach(() => {
    if (clientSocket) {
      clientSocket.close();
    }
  });
```

*   **`afterEach(() => { ... });`**:  A Vitest hook that runs *after* each test in the `describe` block.  This is used to clean up after each test.
*   **`if (clientSocket) { clientSocket.close(); }`**:  Disconnects the client socket if it exists.

```typescript
  it('should connect to socket server', () => {
    expect(clientSocket.connected).toBe(true);
  });
```

*   **`it('should connect to socket server', () => { ... });`**:  Defines a single test case with the description "should connect to socket server".
*   **`expect(clientSocket.connected).toBe(true);`**:  Asserts that the `clientSocket` is connected to the server.  The `expect` function is provided by Vitest.

```typescript
  it('should join workflow room', async () => {
    const workflowId = 'test-workflow-123';

    const joinedPromise = new Promise<void>((resolve) => {
      clientSocket.on('joined-workflow', (data) => {
        expect(data.workflowId).toBe(workflowId);
        resolve();
      });
    });

    clientSocket.emit('join-workflow', { workflowId });
    await joinedPromise;
  });
```

*   **`it('should join workflow room', async () => { ... });`**:  Defines a test case to verify that a client can successfully join a workflow room.
*   **`const workflowId = 'test-workflow-123';`**:  Defines the ID of the workflow room that the client will attempt to join.
*   This creates a `Promise` that resolves when the client receives the `joined-workflow` event from the server.
*   **`const joinedPromise = new Promise<void>((resolve) => { ... });`**: Creates a promise `joinedPromise` that will resolve when a 'joined-workflow' event is received.
*   **`clientSocket.on('joined-workflow', (data) => { ... });`**: Registers a handler for the 'joined-workflow' event.
*   **`expect(data.workflowId).toBe(workflowId);`**: Assertion to check if the received workflowId is the same as the sent workflowId.
*   **`resolve();`**: Resolves the `joinedPromise` when the event is received, signaling that the client has successfully joined the workflow room.
*   **`clientSocket.emit('join-workflow', { workflowId });`**:  Emits the `join-workflow` event to the server, requesting to join the specified workflow room.
*   **`await joinedPromise;`**:  Waits for the `joinedPromise` to resolve, ensuring that the test doesn't complete until the client has successfully joined the workflow room.

```typescript
  it('should broadcast workflow operations', async () => {
    const workflowId = 'test-workflow-456';

    // Create second client
    const client2 = io(`http://localhost:${serverPort}`);
    await new Promise<void>((resolve) => {
      client2.on('connect', resolve);
    });

    // Both clients join the same workflow
    clientSocket.emit('join-workflow', { workflowId });
    client2.emit('join-workflow', { workflowId });

    // Wait for joins to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    const operationPromise = new Promise<void>((resolve) => {
      client2.on('workflow-operation', (data) => {
        expect(data.operation).toBe('add');
        expect(data.target).toBe('block');
        expect(data.payload.id).toBe('block-123');
        resolve();
      });
    });

    // Client 1 sends operation
    clientSocket.emit('workflow-operation', {
      workflowId,
      operation: 'add',
      target: 'block',
      payload: { id: 'block-123', type: 'action', name: 'Test Block' },
      timestamp: Date.now(),
    });

    await operationPromise;
    client2.close();
  });
```

*   **`it('should broadcast workflow operations', async () => { ... });`**: Tests if the server correctly broadcasts messages to clients in the same workflow room.
*   **`const workflowId = 'test-workflow-456';`**: Sets the ID of the workflow.
*   A second client (`client2`) is created and connected to the server, similar to the initial client.
*   Both `clientSocket` and `client2` join the same `workflowId` room.
*   `await new Promise((resolve) => setTimeout(resolve, 100));`: A small delay is introduced to allow the clients to fully join the room before sending messages. This isn't ideal and a more robust solution would involve the server emitting an event when all clients have joined the room.
*   `operationPromise`: A Promise is created to await the workflow operation on the second client.
*   `client2.on('workflow-operation', (data) => { ... });`: Sets up the 'workflow-operation' listener on the second client.
*   The `expect` calls check the received data and ensure it matches with the broadcast data.
*   `clientSocket.emit('workflow-operation', { ... });`: The main client sends a 'workflow-operation' to the server to be broadcast.
*   `await operationPromise`: Waits for the second client to receive the broadcasted workflow operation.
*   `client2.close();`: Closes the second client's connection after the test.

```typescript
  it('should handle multiple concurrent connections', async () => {
    const numClients = 10;
    const clients: Socket[] = [];
    const workflowId = 'stress-test-workflow';

    // Create multiple clients
    for (let i = 0; i < numClients; i++) {
      const client = io(`http://localhost:${serverPort}`);
      clients.push(client);

      await new Promise<void>((resolve) => {
        client.on('connect', resolve);
      });

      client.emit('join-workflow', { workflowId });
    }

    // Wait for all joins
    await new Promise((resolve) => setTimeout(resolve, 200));

    let receivedCount = 0;
    const expectedCount = numClients - 1; // All except sender

    const operationPromise = new Promise<void>((resolve) => {
      clients.forEach((client, index) => {
        if (index === 0) return; // Skip sender

        client.on('workflow-operation', () => {
          receivedCount++;
          if (receivedCount === expectedCount) {
            resolve();
          }
        });
      });
    });

    // First client sends operation
    clients[0].emit('workflow-operation', {
      workflowId,
      operation: 'add',
      target: 'block',
      payload: { id: 'stress-block', type: 'action' },
      timestamp: Date.now(),
    });

    await operationPromise;
    expect(receivedCount).toBe(expectedCount);

    // Clean up
    clients.forEach((client) => client.close());
  });
```

*   **`it('should handle multiple concurrent connections', async () => { ... });`**: Tests the server's ability to handle multiple clients connected simultaneously.
*   `numClients`: Defines the number of clients to connect.
*   `clients`: Array to store all the connected client sockets.
*   A loop creates and connects `numClients` clients to the server and stores them in the `clients` array.  Each client also joins a workflow room.
*   `await new Promise((resolve) => setTimeout(resolve, 200));`:  A short delay to allow all clients to join the workflow.  Again, a more robust method would be preferable.
*   `receivedCount`: Counter to track the number of clients that received the broadcasted message.
*   `expectedCount`: The expected number of clients that should receive the message (all clients except the sender).
*   The `operationPromise` is set up to resolve when the `receivedCount` matches the `expectedCount`. It iterates through each client, setting up a listener for the `workflow-operation` event on all *except* the sending client (index 0).
*   The first client (index 0) then sends a `workflow-operation` event.
*   `await operationPromise`: Waits for the promise to be resolved, meaning all the intended clients have received the message.
*   The test asserts that the `receivedCount` matches the `expectedCount`.
*   The `clients.forEach` loop cleans up by closing each client's connection.

```typescript
  it('should handle rapid operations without loss', async () => {
    const workflowId = 'rapid-test-workflow';
    const numOperations = 50;

    const client2 = io(`http://localhost:${serverPort}`);
    await new Promise<void>((resolve) => {
      client2.on('connect', resolve);
    });

    clientSocket.emit('join-workflow', { workflowId });
    client2.emit('join-workflow', { workflowId });

    await new Promise((resolve) => setTimeout(resolve, 100));

    let receivedCount = 0;
    const receivedOperations = new Set<string>();

    const operationsPromise = new Promise<void>((resolve) => {
      client2.on('workflow-operation', (data) => {
        receivedCount++;
        receivedOperations.add(data.payload.id);

        if (receivedCount === numOperations) {
          resolve();
        }
      });
    });

    // Send rapid operations
    for (let i = 0; i < numOperations; i++) {
      clientSocket.emit('workflow-operation', {
        workflowId,
        operation: 'add',
        target: 'block',
        payload: { id: `rapid-block-${i}`, type: 'action' },
        timestamp: Date.now(),
      });
    }

    await operationsPromise;
    expect(receivedCount).toBe(numOperations);
    expect(receivedOperations.size).toBe(numOperations);

    client2.close();
  });
});
```

*   **`it('should handle rapid operations without loss', async () => { ... });`**:  Tests the server's ability to handle a large number of messages sent in rapid succession, ensuring that no messages are lost.
*   `workflowId`: Sets the workflow ID.
*   `numOperations`: Defines the number of operations (messages) to send.
*   A second client, `client2`, is created and connected to the server and joins the workflow.
*   `receivedCount`: Tracks the number of messages received by the second client.
*   `receivedOperations`: A `Set` is used to store the IDs of the received operations.  Using a `Set` ensures that each operation ID is only stored once, which is useful for detecting duplicate messages.
*   The `operationsPromise` resolves when the `receivedCount` equals `numOperations`.
*   A loop sends `numOperations` `workflow-operation` events in rapid succession. Each message has a unique `id` to track individual messages.
*   `await operationsPromise`: The test waits for all operations to be received.
*   `expect(receivedCount).toBe(numOperations);`: Checks if the total number of received messages is equal to the number of sent messages.
*   `expect(receivedOperations.size).toBe(numOperations);`: Checks if the `Set` contains the same number of unique operation IDs as the number of sent messages.  This verifies that there are no duplicate messages and no messages were lost.
*   `client2.close();`: The connection for the second client is closed.

In summary, this file provides a comprehensive set of integration tests for a Socket.IO server, covering connection management, room management, message broadcasting, concurrency, and message volume. The tests utilize `async/await`, `Promises`, and Vitest's testing framework to create clear, readable, and reliable tests.
