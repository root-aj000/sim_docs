```typescript
'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { COPILOT_TOOL_IDS } from './constants'
import type { CopilotMessage, CopilotToolCall } from './types'

// Define the structure of the data representing a preview.  These previews are workflow configuration changes
// suggested by the Copilot and awaiting user acceptance.
export interface PreviewData {
  id: string // Unique identifier for the preview
  workflowState: any // The complete state of the workflow after applying the preview.  Type `any` is a temporary measure for flexibility.  In a production environment, replace this with a more specific type definition for your workflow state.
  yamlContent: string // The YAML representation of the workflow, used for displaying the configuration to the user.
  description?: string // Optional description of the changes included in the preview.
  timestamp: number // Time the preview was created (UNIX timestamp).
  status: 'pending' | 'accepted' | 'rejected' // Status of the preview: pending approval, accepted, or rejected.  The `as const` assertion ensures that these string literals are treated as a type rather than just strings, enabling type checking on the PreviewData type.
  workflowId: string // The ID of the workflow that this preview applies to.
  toolCallId?: string // The ID of the tool call that generated this preview (if applicable).
  chatId?: string // Track which chat session this preview belongs to
  messageTimestamp?: number // Track when the message containing this preview was created
}

// Define the structure of the store that manages the previews.  This is a Zustand store.
interface PreviewStore {
  previews: Record<string, PreviewData> // An object (record) mapping preview IDs to PreviewData objects.  This allows for quick lookup of previews by ID.
  seenToolCallIds: Set<string> // A Set of tool call IDs that have already been seen by the user. This is used to prevent duplicate previews for the same tool call. Using a Set allows for efficient checking of existence.
  addPreview: (preview: Omit<PreviewData, 'id' | 'timestamp' | 'status'>) => string // Adds a new preview to the store.  The `Omit` type removes the `id`, `timestamp`, and `status` fields from the `PreviewData` type, as these are generated automatically when a new preview is created.  Returns the generated preview ID.
  acceptPreview: (previewId: string) => void // Marks a preview as accepted.
  rejectPreview: (previewId: string) => void // Marks a preview as rejected.
  getLatestPendingPreview: (workflowId: string, chatId?: string) => PreviewData | null // Retrieves the most recent pending preview for a given workflow.  Returns `null` if no pending previews are found.
  getPreviewById: (previewId: string) => PreviewData | null // Retrieves a preview by its ID. Returns `null` if not found.
  getPreviewsForWorkflow: (workflowId: string) => PreviewData[] // Retrieves all previews associated with a given workflow.
  getPreviewByToolCall: (toolCallId: string) => PreviewData | null // Retrieves a preview associated with a specific tool call. Returns `null` if not found.
  clearPreviewsForWorkflow: (workflowId: string) => void // Removes all previews associated with a given workflow.
  clearPreviewsForChat: (chatId: string) => void // Removes all previews associated with a given chat ID.
  clearStalePreviewsForWorkflow: (workflowId: string, maxAgeMinutes?: number) => void // Clears any pending previews for a workflow that are older than a specified age.
  expireOldPreviews: (maxAgeHours?: number) => void // Expires any previews older than a specified number of hours, regardless of workflow.
  markToolCallAsSeen: (toolCallId: string) => void // Adds a tool call ID to the set of seen tool call IDs.
  isToolCallSeen: (toolCallId: string) => boolean // Checks if a tool call ID has already been seen.
  scanAndMarkExistingPreviews: (messages: CopilotMessage[]) => void // Scans a list of messages and marks the tool call IDs of successfully edited workflows as seen, preventing redundant previews.
}

// Create the Zustand store using the `create` function.  This creates a custom hook that can be used to access the store's state and actions.
export const usePreviewStore = create<PreviewStore>()(
  // Wrap the store definition with `persist` middleware.  This automatically saves the store's state to local storage, so it persists across page reloads and sessions.
  persist(
    (set, get) => ({
      // Initial state of the store.
      previews: {},
      seenToolCallIds: new Set<string>(),

      // Implementation of the `addPreview` action.
      addPreview: (preview) => {
        // Generate a unique ID for the preview.
        const id = `preview_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` // Combines timestamp and random string to create a unique ID
        // Create a new PreviewData object, including the generated ID, current timestamp, and setting the status to 'pending'.
        const newPreview: PreviewData = {
          ...preview,
          id,
          timestamp: Date.now(),
          status: 'pending',
        }

        // Update the store's state using the `set` function.
        set((state) => ({
          // Merge the new preview into the existing `previews` object.
          previews: {
            ...state.previews,
            [id]: newPreview,
          },
        }))

        // Return the generated preview ID.
        return id
      },

      // Implementation of the `acceptPreview` action.
      acceptPreview: (previewId) => {
        // Update the store's state.
        set((state) => {
          const existingPreview = state.previews[previewId]
          if (!existingPreview) {
            return state
          }

          // Update the status of the preview to 'accepted'.
          return {
            previews: {
              ...state.previews,
              [previewId]: {
                ...existingPreview,
                status: 'accepted' as const, // Type assertion to ensure the status is one of the allowed values.
              },
            },
          }
        })
      },

      // Implementation of the `rejectPreview` action.
      rejectPreview: (previewId) => {
        // Update the store's state.
        set((state) => {
          const existingPreview = state.previews[previewId]
          if (!existingPreview) {
            return state
          }
          return {
            previews: {
              ...state.previews,
              [previewId]: {
                ...existingPreview,
                status: 'rejected' as const, // Type assertion to ensure the status is one of the allowed values.
              },
            },
          }
        })
      },

      // Implementation of the `getLatestPendingPreview` action.
      getLatestPendingPreview: (workflowId, chatId) => {
        const now = Date.now()
        const maxAge = 30 * 60 * 1000 // 30 minutes
        const allPreviews = Object.values(get().previews)

        const previews = allPreviews
          .filter((p) => {
            // Must be for the current workflow and pending
            if (p.workflowId !== workflowId || p.status !== 'pending') {
              return false
            }

            // If chatId is provided, only show previews from this chat session
            // If no chatId provided or preview has no chatId, allow it (for backward compatibility)
            if (chatId && p.chatId && p.chatId !== chatId) {
              return false
            }

            // Filter out previews older than 30 minutes to avoid stale previews
            if (now - p.timestamp > maxAge) {
              return false
            }

            return true
          })
          .sort((a, b) => b.timestamp - a.timestamp)

        return previews[0] || null
      },

      // Implementation of the `getPreviewById` action.
      getPreviewById: (previewId) => {
        // Access the `previews` object from the store using `get()`.
        return get().previews[previewId] || null // Returns the preview if found, otherwise null.
      },

      // Implementation of the `getPreviewsForWorkflow` action.
      getPreviewsForWorkflow: (workflowId) => {
        // Access the `previews` object from the store and filter the values based on the `workflowId`.
        return Object.values(get().previews).filter((p) => p.workflowId === workflowId)
      },

      // Implementation of the `getPreviewByToolCall` action.
      getPreviewByToolCall: (toolCallId) => {
        // Access the `previews` object and find the first preview that matches the `toolCallId`.
        return Object.values(get().previews).find((p) => p.toolCallId === toolCallId) || null
      },

      // Implementation of the `clearPreviewsForWorkflow` action.
      clearPreviewsForWorkflow: (workflowId) => {
        // Update the state by filtering out previews with the specified `workflowId`.
        set((state) => ({
          previews: Object.fromEntries(
            Object.entries(state.previews).filter(
              ([_, preview]) => preview.workflowId !== workflowId
            )
          ),
        }))
      },

      // Implementation of the `clearPreviewsForChat` action.
      clearPreviewsForChat: (chatId) => {
        // Update the state by filtering out previews with the specified `workflowId`.
        set((state) => ({
          previews: Object.fromEntries(
            Object.entries(state.previews).filter(([_, preview]) => preview.chatId !== chatId)
          ),
        }))
      },

      // Implementation of the `clearStalePreviewsForWorkflow` action.
      clearStalePreviewsForWorkflow: (workflowId, maxAgeMinutes = 30) => {
        const now = Date.now()
        const maxAge = maxAgeMinutes * 60 * 1000

        set((state) => ({
          previews: Object.fromEntries(
            Object.entries(state.previews).filter(([_, preview]) => {
              if (preview.workflowId === workflowId && preview.status === 'pending') {
                return now - preview.timestamp <= maxAge
              }
              return true // Keep previews from other workflows or accepted/rejected previews
            })
          ),
        }))
      },

      // Implementation of the `expireOldPreviews` action.
      expireOldPreviews: (maxAgeHours = 24) => {
        const now = Date.now()
        const maxAge = maxAgeHours * 60 * 60 * 1000

        set((state) => ({
          previews: Object.fromEntries(
            Object.entries(state.previews).filter(
              ([_, preview]) => now - preview.timestamp <= maxAge
            )
          ),
        }))
      },

      // Implementation of the `markToolCallAsSeen` action.
      markToolCallAsSeen: (toolCallId) => {
        // Update the `seenToolCallIds` Set by adding the given `toolCallId`.
        set((state) => ({
          seenToolCallIds: new Set([...state.seenToolCallIds, toolCallId]), // Create a new Set to trigger a state update.
        }))
      },

      // Implementation of the `isToolCallSeen` action.
      isToolCallSeen: (toolCallId) => {
        // Check if the `seenToolCallIds` Set contains the given `toolCallId`.
        return get().seenToolCallIds.has(toolCallId)
      },

      // Implementation of the `scanAndMarkExistingPreviews` action.
      scanAndMarkExistingPreviews: (messages: CopilotMessage[]) => {
        const toolCallIds = new Set<string>()

        messages.forEach((message) => {
          if (message.role === 'assistant' && message.toolCalls) {
            message.toolCalls.forEach((toolCall: CopilotToolCall) => {
              if (
                toolCall.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW &&
                toolCall.state === 'success' &&
                toolCall.id
              ) {
                toolCallIds.add(toolCall.id)
              }
            })
          }
        })

        set((state) => ({
          seenToolCallIds: new Set([...state.seenToolCallIds, ...toolCallIds]),
        }))
      },
    }),
    {
      // Configuration options for the `persist` middleware.
      name: 'copilot-preview-store', // A unique name for the store in local storage.
      partialize: (state) => ({
        // Defines which parts of the state to persist.  This is important for performance and security.  In this case, we only persist the `previews` and `seenToolCallIds`.
        previews: Object.fromEntries(
          Object.entries(state.previews).filter(
            ([_, preview]) => Date.now() - preview.timestamp < 24 * 60 * 60 * 1000 // Keep for 24 hours
          )
        ),
        seenToolCallIds: Array.from(state.seenToolCallIds), // Convert Set to Array for serialization
      }),
      merge: (persistedState: any, currentState) => ({
        // Defines how to merge the persisted state with the current state.  This is important because the persisted state may be out of date.
        ...currentState,
        ...persistedState,
        seenToolCallIds: new Set(persistedState?.seenToolCallIds || []), // Convert Array back to Set
      }),
    }
  )
)
```

### Purpose of this file

This file defines a Zustand store called `usePreviewStore` that manages previews of workflow configurations suggested by a Copilot.  These previews represent potential changes to a workflow and require user acceptance before being applied. The store handles adding, accepting, rejecting, retrieving, and clearing these previews. The store also utilizes the `zustand/middleware` `persist` to automatically save the store's state to local storage, so it persists across page reloads and sessions.

### Simplification of complex logic

1.  **State Management with Zustand:** Zustand simplifies state management by providing a straightforward way to define and update state using hooks. This eliminates the need for more complex solutions like Redux for this specific use case.

2.  **Persistence with `zustand/middleware`:**  The `persist` middleware automatically handles saving the store's state to local storage. It handles complex logic of serializing and deserializing state.

3.  **Immutability:** The store uses immutable updates (e.g., using the spread operator `...`) to ensure that state changes are predictable and avoid unintended side effects.

4.  **Set for `seenToolCallIds`:** Using a `Set` for `seenToolCallIds` simplifies checking if a tool call has already been seen, providing better performance than using an array.

5.  **Filtering and Mapping:** Functions like `clearPreviewsForWorkflow` and `expireOldPreviews` utilize `Object.entries`, `filter`, and `Object.fromEntries` to efficiently manipulate the `previews` object.

### Explanation of each line of code

See detailed explanation above in the comments of each line of code.
