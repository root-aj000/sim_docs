```typescript
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import { initialState, type McpServersActions, type McpServersState } from './types'

const logger = createLogger('McpServersStore')

export const useMcpServersStore = create<McpServersState & McpServersActions>()(
  devtools(
    (set, get) => ({
      ...initialState,

      fetchServers: async (workspaceId: string) => {
        set({ isLoading: true, error: null })

        try {
          const response = await fetch(`/api/mcp/servers?workspaceId=${workspaceId}`)
          const data = await response.json()

          if (!response.ok) {
            throw new Error(data.error || 'Failed to fetch servers')
          }

          set({ servers: data.data?.servers || [], isLoading: false })
          logger.info(
            `Fetched ${data.data?.servers?.length || 0} MCP servers for workspace ${workspaceId}`
          )
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to fetch servers'
          logger.error('Failed to fetch MCP servers:', error)
          set({ error: errorMessage, isLoading: false })
        }
      },

      createServer: async (workspaceId: string, config) => {
        set({ isLoading: true, error: null })

        try {
          const serverData = {
            ...config,
            workspaceId,
            id: `mcp-${Date.now()}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }

          const response = await fetch('/api/mcp/servers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(serverData),
          })

          const data = await response.json()

          if (!response.ok) {
            throw new Error(data.error || 'Failed to create server')
          }

          const newServer = { ...serverData, connectionStatus: 'disconnected' as const }
          set((state) => ({
            servers: [...state.servers, newServer],
            isLoading: false,
          }))

          logger.info(`Created MCP server: ${config.name} in workspace: ${workspaceId}`)
          return newServer
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to create server'
          logger.error('Failed to create MCP server:', error)
          set({ error: errorMessage, isLoading: false })
          throw error
        }
      },

      updateServer: async (workspaceId: string, id: string, updates) => {
        set({ isLoading: true, error: null })

        try {
          // For now, update locally only - server updates would require a PATCH endpoint
          set((state) => ({
            servers: state.servers.map((server) =>
              server.id === id && server.workspaceId === workspaceId
                ? { ...server, ...updates, updatedAt: new Date().toISOString() }
                : server
            ),
            isLoading: false,
          }))

          logger.info(`Updated MCP server: ${id} in workspace: ${workspaceId}`)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to update server'
          logger.error('Failed to update MCP server:', error)
          set({ error: errorMessage, isLoading: false })
          throw error
        }
      },

      deleteServer: async (workspaceId: string, id: string) => {
        set({ isLoading: true, error: null })

        try {
          const response = await fetch(
            `/api/mcp/servers?serverId=${id}&workspaceId=${workspaceId}`,
            {
              method: 'DELETE',
            }
          )

          const data = await response.json()

          if (!response.ok) {
            throw new Error(data.error || 'Failed to delete server')
          }

          set((state) => ({
            servers: state.servers.filter((server) => server.id !== id),
            isLoading: false,
          }))

          logger.info(`Deleted MCP server: ${id} from workspace: ${workspaceId}`)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to delete server'
          logger.error('Failed to delete MCP server:', error)
          set({ error: errorMessage, isLoading: false })
          throw error
        }
      },

      refreshServer: async (workspaceId: string, id: string) => {
        const server = get().servers.find((s) => s.id === id && s.workspaceId === workspaceId)
        if (!server) return

        try {
          // For now, just update the last refresh time - actual refresh would require an endpoint
          set((state) => ({
            servers: state.servers.map((s) =>
              s.id === id && s.workspaceId === workspaceId
                ? {
                    ...s,
                    lastToolsRefresh: new Date().toISOString(),
                  }
                : s
            ),
          }))

          logger.info(`Refreshed MCP server: ${id} in workspace: ${workspaceId}`)
        } catch (error) {
          logger.error(`Failed to refresh MCP server ${id}:`, error)

          set((state) => ({
            servers: state.servers.map((s) =>
              s.id === id && s.workspaceId === workspaceId
                ? {
                    ...s,
                    connectionStatus: 'error',
                    lastError: error instanceof Error ? error.message : 'Refresh failed',
                  }
                : s
            ),
          }))
        }
      },

      clearError: () => set({ error: null }),

      reset: () => set(initialState),
    }),
    {
      name: 'mcp-servers-store',
    }
  )
)

export const useIsConnectedServer = (serverId: string) => {
  return useMcpServersStore(
    (state) => state.servers.find((s) => s.id === serverId)?.connectionStatus === 'connected'
  )
}

export const useServerToolCount = (serverId: string) => {
  return useMcpServersStore((state) => state.servers.find((s) => s.id === serverId)?.toolCount || 0)
}

export const useEnabledServers = () => {
  return useMcpServersStore((state) => state.servers.filter((s) => s.enabled && !s.deletedAt))
}
```

## Explanation of the Code:

This code defines a Zustand store for managing MCP (presumably "My Cloud Platform") servers within a web application. It handles fetching, creating, updating, deleting, and refreshing server data.  It also provides derived hooks for accessing specific server properties.

**1. Imports:**

- `create` from `zustand`:  This is the core function from the Zustand library used to create the store.  Zustand is a simple state management solution for React.
- `devtools` from `zustand/middleware`: This middleware enhances the store with debugging capabilities, allowing you to inspect state changes using the Redux DevTools extension in your browser.
- `createLogger` from `'@/lib/logs/console/logger'`: This imports a custom logger function to provide structured logging within the store's actions.  The `@` alias likely points to the project's root directory.
- `initialState, type McpServersActions, type McpServersState` from `'./types'`: This imports the type definitions and initial state for the store.  `McpServersState` defines the shape of the state object (e.g., `servers`, `isLoading`, `error`). `McpServersActions` defines the types of the actions that can be performed on the state (e.g., `fetchServers`, `createServer`). `initialState` contains the default values for the state.

**2. Logger Instance:**

- `const logger = createLogger('McpServersStore')`:  This creates an instance of the custom logger, named `McpServersStore`. This allows you to easily filter logs specifically related to this store in the console.

**3. `useMcpServersStore` Definition:**

- `export const useMcpServersStore = create<McpServersState & McpServersActions>()(...)`: This is the heart of the code. It creates and exports a Zustand store using the `create` function.
    - `create<McpServersState & McpServersActions>()`:  This tells Zustand that the store will hold state of type `McpServersState` and will have actions defined by `McpServersActions`.  The `&` combines these two types into a single type that represents the entire store.
    - `devtools(...)`: This wraps the store's logic with the `devtools` middleware for debugging. The `name` option within `devtools` sets the name that will appear in the Redux DevTools.
    - `(set, get) => ({ ... })`: This is the store's state and action creator function.  It receives two arguments:
        - `set`:  A function to update the store's state.  It accepts either a partial state object (to merge with the existing state) or a function that receives the current state and returns a partial state object.
        - `get`:  A function to access the current store's state.

**4. Store State and Actions:**

The function passed to `devtools` returns an object containing the initial state and the actions that can be performed on the store.

- `...initialState`:  This spreads the properties of the `initialState` object into the store, initializing the store with default values.

**Actions:**

- **`fetchServers: async (workspaceId: string) => { ... }`**:
    - Fetches a list of MCP servers from the API for a given `workspaceId`.
    - Sets `isLoading` to `true` and clears any existing `error`.
    - Uses `fetch` to make a GET request to `/api/mcp/servers?workspaceId=${workspaceId}`.
    - Parses the response as JSON.
    - If the response is not ok (status code is not in the 200-299 range), it throws an error.
    - Updates the `servers` array in the store with the fetched data and sets `isLoading` to `false`. If `data.data?.servers` is undefined, it defaults to an empty array.
    - Logs the number of fetched servers using the logger.
    - Catches any errors during the process, logs the error, and updates the `error` property in the store.

- **`createServer: async (workspaceId: string, config) => { ... }`**:
    - Creates a new MCP server.  Takes `workspaceId` and a `config` object (presumably containing the server's configuration details) as input.
    - Sets `isLoading` to `true` and clears any existing `error`.
    - Constructs `serverData` object, merges it with existing `config` object, and populates `workspaceId`, `id`, `createdAt`, and `updatedAt` properties. The server `id` is generated using `mcp-${Date.now()}`.
    - Makes a POST request to `/api/mcp/servers` with the server data in the request body.
    - Parses the response as JSON.
    - If the response is not ok, it throws an error.
    - Adds the new server to the `servers` array in the store and sets `isLoading` to `false`. The `connectionStatus` is initialized to 'disconnected'.
    - Logs the creation of the server.
    - Returns the newly created server object.
    - Catches any errors during the process, logs the error, updates the `error` property in the store, and re-throws the error.

- **`updateServer: async (workspaceId: string, id: string, updates) => { ... }`**:
    - Updates an existing MCP server's properties. Takes `workspaceId`, `id` of the server to update, and an `updates` object (containing the properties to update) as input.
    - Sets `isLoading` to `true` and clears any existing `error`.
    - **Important:** This action currently only updates the server data in the store's local state.  It does *not* send any updates to the backend (API). This is indicated by the comment "// For now, update locally only - server updates would require a PATCH endpoint".
    - Updates the server in the `servers` array by mapping over the array and merging the `updates` object with the server's existing properties if the `id` and `workspaceId` match.  It also updates the `updatedAt` timestamp.
    - Sets `isLoading` to `false`.
    - Logs the server update.
    - Catches any errors during the process, logs the error, updates the `error` property in the store, and re-throws the error.

- **`deleteServer: async (workspaceId: string, id: string) => { ... }`**:
    - Deletes an MCP server.  Takes `workspaceId` and the `id` of the server to delete as input.
    - Sets `isLoading` to `true` and clears any existing `error`.
    - Makes a DELETE request to `/api/mcp/servers?serverId=${id}&workspaceId=${workspaceId}`.
    - Parses the response as JSON.
    - If the response is not ok, it throws an error.
    - Removes the server from the `servers` array in the store by filtering the array to exclude the server with the matching `id`.
    - Sets `isLoading` to `false`.
    - Logs the server deletion.
    - Catches any errors during the process, logs the error, updates the `error` property in the store, and re-throws the error.

- **`refreshServer: async (workspaceId: string, id: string) => { ... }`**:
    - Refreshes the state of an MCP server. Takes `workspaceId` and the `id` of the server to refresh as input.
    - Finds the server in the store's state. If it doesn't exist, the function returns early.
    - **Important:** This action currently only updates the `lastToolsRefresh` timestamp in the store's local state. It does *not* perform an actual refresh operation against the backend. This is indicated by the comment "// For now, just update the last refresh time - actual refresh would require an endpoint".
    - Updates the `lastToolsRefresh` property of the server in the `servers` array.
    - Logs the server refresh.
    - Catches any errors during the process. If there's an error, it sets the `connectionStatus` to `'error'` and saves the error message in the `lastError` property.

- **`clearError: () => set({ error: null })`**:
    - Clears any error message currently stored in the state by setting the `error` property to `null`.

- **`reset: () => set(initialState)`**:
    - Resets the store's state to the `initialState`.

**5. Derived Hooks:**

These custom hooks provide a convenient way to access specific pieces of information from the store without having to manually subscribe to the entire store. They use selector functions within `useMcpServersStore` to extract the required data.

- **`useIsConnectedServer(serverId: string)`**:
    - Takes a `serverId` as input.
    - Returns a boolean value indicating whether the server with the given `serverId` has a `connectionStatus` of `'connected'`.

- **`useServerToolCount(serverId: string)`**:
    - Takes a `serverId` as input.
    - Returns the `toolCount` property of the server with the given `serverId`. Returns 0 if server not found.

- **`useEnabledServers()`**:
    - Returns an array of servers that are both `enabled` and not marked as `deletedAt`.

**Purpose of the file:**

This file defines a Zustand store to manage the state of MCP servers within a React application. It provides actions to fetch, create, update, delete, and refresh server data, as well as derived hooks to access specific server properties. The store interacts with a backend API (presumably RESTful) to persist and retrieve server information. The Zustand store provides a centralized and efficient way to manage and share server state across different components in the application.

**Simplifying Complex Logic:**

- **Zustand:**  Using Zustand itself simplifies state management compared to more verbose solutions like Redux, especially for smaller applications.
- **Custom Hooks:** The derived hooks (`useIsConnectedServer`, `useServerToolCount`, `useEnabledServers`) abstract away the logic of accessing specific data within the store, making it easier to use in components.
- **Error Handling:** The `try...catch` blocks provide centralized error handling for each action, preventing errors from crashing the application and providing a way to display error messages to the user.
- **Logger:** The logging statements help track the flow of data and identify potential issues during development and debugging.
- **Type Safety:** TypeScript enforces type safety, reducing the risk of runtime errors and making the code more maintainable. The use of types `McpServersState`, and `McpServersActions` improve readability and provide clear contracts for state and actions.
