```typescript
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import type { CustomToolsStore } from '@/stores/custom-tools/types'

// Create a logger instance for this store.  This will help with debugging.
const logger = createLogger('CustomToolsStore')

// Define the API endpoint for fetching and saving custom tools.
const API_ENDPOINT = '/api/tools/custom'

// Create the Zustand store using the `create` function.
// The `<CustomToolsStore>` type parameter specifies the shape of the store.
export const useCustomToolsStore = create<CustomToolsStore>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state of the store.
        tools: {}, // An object to store the custom tools, indexed by their IDs.
        isLoading: false, // A boolean indicating whether data is currently being loaded.
        error: null, // A string to store any error message that occurs.

        // Action: Load custom tools from the server.
        loadCustomTools: async () => {
          try {
            // Set loading state to true and clear any previous errors.
            set({ isLoading: true, error: null })
            logger.info('Loading custom tools from server')

            // Fetch data from the API endpoint.
            const response = await fetch(API_ENDPOINT)

            // Check if the response was successful.
            if (!response.ok) {
              throw new Error(`Failed to load custom tools: ${response.statusText}`)
            }

            // Parse the response body as JSON.
            const { data } = await response.json()

            // Verify that the returned data is an array.
            if (!Array.isArray(data)) {
              throw new Error('Invalid response format')
            }

            // Filter and validate tools, skipping invalid ones instead of throwing errors
            const validTools = data.filter((tool, index) => {
              if (!tool || typeof tool !== 'object') {
                logger.warn(`Skipping invalid tool at index ${index}: not an object`)
                return false
              }
              if (!tool.id || typeof tool.id !== 'string') {
                logger.warn(`Skipping invalid tool at index ${index}: missing or invalid id`)
                return false
              }
              if (!tool.title || typeof tool.title !== 'string') {
                logger.warn(`Skipping invalid tool at index ${index}: missing or invalid title`)
                return false
              }
              if (!tool.schema || typeof tool.schema !== 'object') {
                logger.warn(`Skipping invalid tool at index ${index}: missing or invalid schema`)
                return false
              }
              // Make code field optional - default to empty string if missing
              if (!tool.code || typeof tool.code !== 'string') {
                logger.warn(`Tool at index ${index} missing code field, defaulting to empty string`)
                tool.code = ''
              }
              return true
            })

            // Transform the array of tools into an object, indexed by tool ID.
            const transformedTools = validTools.reduce(
              (acc, tool) => ({
                ...acc,
                [tool.id]: tool,
              }),
              {}
            )

            // Update the store with the loaded tools and set loading state to false.
            set({
              tools: transformedTools,
              isLoading: false,
            })
          } catch (error) {
            // Handle any errors that occur during the process.
            logger.error('Error loading custom tools:', error)
            set({
              error: error instanceof Error ? error.message : 'Unknown error',
              isLoading: false,
            })
          }
        },

        // Action: Save tools to server
        sync: async () => {
          try {
            // Set loading state to true and clear any previous errors.
            set({ isLoading: true, error: null })

            // Extract tools from the store's state. Convert the object of tools into an array of tools.
            const tools = Object.values(get().tools)
            logger.info(`Syncing ${tools.length} custom tools with server`)

            // Log details of tools being synced for debugging
            if (tools.length > 0) {
              logger.info(
                'Custom tools to sync:',
                tools.map((tool) => ({
                  id: tool.id,
                  title: tool.title,
                  functionName: tool.schema?.function?.name || 'unknown',
                }))
              )
            }

            // Send a POST request to the API endpoint with the tools data.
            const response = await fetch(API_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tools }),
            })

            // Check if the response was successful.
            if (!response.ok) {
              // Try to get more detailed error information
              try {
                const errorData = await response.json()
                throw new Error(
                  `Failed to sync custom tools: ${response.statusText}. ${errorData.error || ''}`
                )
              } catch (_parseError) {
                throw new Error(`Failed to sync custom tools: ${response.statusText}`)
              }
            }

            // Set loading state to false.
            set({ isLoading: false })
            logger.info('Successfully synced custom tools with server')
          } catch (error) {
            // Handle any errors that occur during the process.
            logger.error('Error syncing custom tools:', error)
            set({
              error: error instanceof Error ? error.message : 'Unknown error',
              isLoading: false,
            })
          }
        },

        // Action: Add a new tool to the store.
        addTool: (tool) => {
          // Generate a unique ID for the new tool.
          const id = crypto.randomUUID()
          const newTool = {
            ...tool,
            id,
            createdAt: new Date().toISOString(),
          }

          // Update the store with the new tool.
          set((state) => ({
            tools: {
              ...state.tools,
              [id]: newTool,
            },
          }))

          // Sync with server
          get()
            .sync()
            .catch((error) => {
              logger.error('Error syncing after adding tool:', error)
            })

          return id
        },

        // Action: Update an existing tool in the store.
        updateTool: (id, updates) => {
          // Get the tool to update from the store.
          const tool = get().tools[id]
          // If it doesn't exist, early return false
          if (!tool) return false

          // Create an updated tool with the new properties.
          const updatedTool = {
            ...tool,
            ...updates,
            updatedAt: new Date().toISOString(),
          }

          // Update the store with the updated tool.
          set((state) => ({
            tools: {
              ...state.tools,
              [id]: updatedTool,
            },
          }))

          // Sync with server
          get()
            .sync()
            .catch((error) => {
              logger.error('Error syncing after updating tool:', error)
            })

          return true
        },

        // Action: Remove a tool from the store.
        removeTool: (id) => {
          // Update the store by removing the tool with the given ID.
          set((state) => {
            const newTools = { ...state.tools }
            delete newTools[id]
            return { tools: newTools }
          })

          // Sync with server
          get()
            .sync()
            .catch((error) => {
              logger.error('Error syncing after removing tool:', error)
            })
        },

        // Action: Get a single tool by ID
        getTool: (id) => {
          return get().tools[id]
        },

        // Action: Get all tools as an array
        getAllTools: () => {
          return Object.values(get().tools)
        },
      }),
      {
        // Configuration options for the `persist` middleware.
        name: 'custom-tools-store', // A unique name for the persisted data in localStorage.
        onRehydrateStorage: () => {
          // Callback function that is called when the store is rehydrated from localStorage.
          return (state) => {
            // We'll load via the central initialization system in stores/index.ts
            // No need for a setTimeout here
            logger.info('Store rehydrated from localStorage')
          }
        },
      }
    )
  )
)

```

### Explanation:

**Purpose of this file:**

This file defines a Zustand store called `useCustomToolsStore` that manages a collection of custom tools.  The store provides functionality to:

*   Load custom tools from a server.
*   Save custom tools to a server.
*   Add, update, and remove custom tools.
*   Retrieve custom tools by ID or get all tools.
*   Persist the store's data in local storage using `zustand/persist`.
*   Provide debugging support using `zustand/devtools` and a custom logger.

**Simplifying Complex Logic:**

1.  **Validation and Transformation:** The `loadCustomTools` function includes comprehensive validation of the data received from the server.  Instead of throwing errors when invalid data is encountered, the store now logs a warning and skips the invalid tool.  This prevents a single invalid tool from crashing the entire loading process.  The `code` field is optional, and defaults to an empty string.
2.  **Error Handling:** The `sync` function now attempts to extract more detailed error information from the server's response when a sync fails.  This provides more informative error messages to the user.
3.  **Centralized State Management:** Zustand's `set` function is used consistently to update the store's state.  This ensures that all state updates are performed in a controlled and predictable manner.  The `get` function is used to access the current state of the store within actions.
4. **Middleware:** The use of `devtools` and `persist` middleware enhances the store's functionality without cluttering the core logic. `devtools` enables time-travel debugging in the Redux DevTools extension, while `persist` automatically saves and restores the store's state to local storage.

**Line-by-line explanation:**

1.  **`import { create } from 'zustand'`:** Imports the `create` function from the `zustand` library.  `zustand` is a simple and lightweight state management solution for React.
2.  **`import { devtools, persist } from 'zustand/middleware'`:** Imports the `devtools` and `persist` middleware from `zustand/middleware`.  Middleware allows you to extend the functionality of the store.
    *   `devtools`: Enables the use of Redux DevTools for debugging the store.
    *   `persist`: Persists the store's data to local storage, so it's preserved across page reloads.
3.  **`import { createLogger } from '@/lib/logs/console/logger'`:** Imports a custom `createLogger` function for creating logger instances.  This is likely a utility function defined elsewhere in the project to provide consistent logging.
4.  **`import type { CustomToolsStore } from '@/stores/custom-tools/types'`:** Imports the `CustomToolsStore` type definition from another file.  This type defines the shape of the store's state and actions.
5.  **`const logger = createLogger('CustomToolsStore')`:** Creates a logger instance specifically for this store, using the `createLogger` function and giving it the name 'CustomToolsStore'.  This allows you to easily identify log messages originating from this store.
6.  **`const API_ENDPOINT = '/api/tools/custom'`:** Defines a constant variable `API_ENDPOINT` that stores the URL of the API endpoint used to fetch and save custom tools.
7.  **`export const useCustomToolsStore = create<CustomToolsStore>()(`:** Creates the Zustand store using the `create` function.  The `<CustomToolsStore>` type parameter specifies that the store will conform to the `CustomToolsStore` interface. The `export const` makes the store available for use in other parts of the application.
8.  **`devtools(`:** Wraps the store creation with the `devtools` middleware, enabling Redux DevTools integration.
9.  **`persist(`:** Wraps the store creation with the `persist` middleware, enabling persistence of the store's data to local storage.
10. **`(set, get) => ({`:** This is the store's state and actions definition. `set` is a function used to update the store's state, and `get` is a function used to access the current state.  The object returned from this function defines the store's initial state and actions.
11. **`tools: {},`:** Defines the `tools` state property, which is an object that will store the custom tools.  The keys of the object will be the tool IDs, and the values will be the tool objects themselves. Initialized as an empty object.
12. **`isLoading: false,`:** Defines the `isLoading` state property, which is a boolean that indicates whether the store is currently loading data from the server. Initialized to `false`.
13. **`error: null,`:** Defines the `error` state property, which is a string that will store any error message that occurs during data loading or saving. Initialized to `null`.
14. **`loadCustomTools: async () => { ... },`:** Defines the `loadCustomTools` action, which is an asynchronous function that loads custom tools from the server.
15. **`set({ isLoading: true, error: null })`:**  Inside `loadCustomTools`, this line sets the `isLoading` state to `true` and resets the `error` state to `null`.  This indicates that a data loading operation is in progress.
16. **`logger.info('Loading custom tools from server')`:** Logs an informational message to the console, indicating that the store is about to load custom tools from the server.
17. **`const response = await fetch(API_ENDPOINT)`:**  Fetches data from the API endpoint defined by `API_ENDPOINT`.  The `await` keyword pauses execution until the fetch operation is complete.
18. **`if (!response.ok) { ... }`:** Checks if the response was successful (status code 200-299). If not, it throws an error with a descriptive message.
19. **`const { data } = await response.json()`:** Parses the JSON response body and extracts the `data` property.  The `await` keyword pauses execution until the JSON parsing is complete.
20. **`if (!Array.isArray(data)) { ... }`:** Checks if the `data` property is an array.  If not, it throws an error indicating an invalid response format.
21. **`const validTools = data.filter((tool, index) => { ... })`:** Filters the `data` array to remove any invalid tool objects.
    *   The filter function checks if each `tool` is an object, has an `id` (string), a `title` (string), and a `schema` (object).
    *   If a tool is missing any of these properties, a warning message is logged to the console, and the tool is filtered out (returned `false`).
    *   The code field is validated to be a string, defaulting to an empty string if missing.
22. **`const transformedTools = validTools.reduce( ... , {})`:** Transforms the validated array of tools into an object, where the keys are the tool IDs and the values are the tool objects.  This makes it easier to access tools by their ID.
    *   The `reduce` function iterates over the `validTools` array and accumulates the tools into a new object.
    *   For each tool, it adds a property to the accumulator object with the tool's ID as the key and the tool object as the value.
23. **`set({ tools: transformedTools, isLoading: false })`:** Updates the store's state with the loaded tools and sets `isLoading` to `false`.  This indicates that the data loading operation is complete.
24. **`} catch (error) { ... }`:** Catches any errors that occur during the data loading process.
25. **`logger.error('Error loading custom tools:', error)`:** Logs an error message to the console with the error details.
26. **`set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false })`:** Updates the store's state with the error message and sets `isLoading` to `false`.
27. **`sync: async () => { ... },`:** Defines the `sync` action, which is an asynchronous function that saves the custom tools to the server.
28. **`const tools = Object.values(get().tools)`:** Retrieves the tools from the store's state as an array.
29. **`logger.info(`Syncing ${tools.length} custom tools with server`)`:** Logs an informational message to the console, indicating that the store is about to save custom tools to the server.
30. **`const response = await fetch(API_ENDPOINT, { ... })`:** Sends a POST request to the API endpoint defined by `API_ENDPOINT`, with the tools data in the request body.
31. **`if (!response.ok) { ... }`:** Checks if the response was successful. If not, it throws an error with a descriptive message.
32. **`set({ isLoading: false })`:**  Sets the `isLoading` state to `false`. This indicates that the data loading operation is complete.
33. **`addTool: (tool) => { ... },`:** Defines the `addTool` action, which adds a new tool to the store.
34. **`const id = crypto.randomUUID()`:** Generates a unique ID for the new tool using `crypto.randomUUID()`.
35. **`const newTool = { ...tool, id, createdAt: new Date().toISOString() }`:** Creates a new tool object with the provided `tool` data, the generated `id`, and a `createdAt` timestamp.
36. **`set((state) => ({ ... }))`:** Updates the store's state by adding the new tool to the `tools` object. It uses the functional update form of `set` which receives the current state as an argument.
37. **`get().sync().catch((error) => { ... })`:** Calls the `sync` action to save the updated tools to the server.  It also includes error handling to catch any errors that occur during the sync process.
38. **`updateTool: (id, updates) => { ... },`:** Defines the `updateTool` action, which updates an existing tool in the store.
39. **`const tool = get().tools[id]`:** Retrieves the tool to update from the store's state using its ID.
40. **`const updatedTool = { ...tool, ...updates, updatedAt: new Date().toISOString() }`:** Creates a new tool object with the updated data, including an `updatedAt` timestamp.
41. **`removeTool: (id) => { ... },`:** Defines the `removeTool` action, which removes a tool from the store.
42. **`set((state) => { ... })`:** Updates the store's state by removing the tool with the given ID from the `tools` object.
43. **`name: 'custom-tools-store',`:** Configuration option for the `persist` middleware, specifying the name used to store the data in local storage.
44. **`onRehydrateStorage: () => { ... },`:** Configuration option for the `persist` middleware, defining a callback function that is called when the store is rehydrated from local storage.

**In summary:** This file defines a Zustand store for managing custom tools.  It provides actions for loading, saving, adding, updating, and removing tools.  The store uses middleware to enable debugging and persistence.  The code is well-structured, easy to read, and includes comprehensive error handling and logging.  It also leverages TypeScript's type system to ensure type safety.
