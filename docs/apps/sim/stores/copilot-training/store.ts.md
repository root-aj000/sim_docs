```typescript
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import { sanitizeForCopilot } from '@/lib/workflows/json-sanitizer'
import {
  computeEditSequence,
  type EditOperation,
} from '@/lib/workflows/training/compute-edit-sequence'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('CopilotTrainingStore')

export interface TrainingDataset {
  id: string
  workflowId: string
  title: string
  prompt: string
  startState: WorkflowState
  endState: WorkflowState
  editSequence: EditOperation[]
  createdAt: Date
  sentAt?: Date
  metadata?: {
    duration?: number // Time taken to complete edits in ms
    blockCount?: number
    edgeCount?: number
  }
}

interface CopilotTrainingState {
  // Current training session
  isTraining: boolean
  currentTitle: string
  currentPrompt: string
  startSnapshot: WorkflowState | null
  startTime: number | null

  // Completed datasets
  datasets: TrainingDataset[]

  // UI state
  showModal: boolean

  // Actions
  startTraining: (title: string, prompt: string) => void
  stopTraining: () => TrainingDataset | null
  cancelTraining: () => void
  setPrompt: (prompt: string) => void
  toggleModal: () => void
  clearDatasets: () => void
  exportDatasets: () => string
  markDatasetSent: (id: string, sentAt?: Date) => void
}

/**
 * Get a clean snapshot of the current workflow state
 */
function captureWorkflowSnapshot(): WorkflowState {
  const rawState = useWorkflowStore.getState().getWorkflowState()

  // Merge subblock values to get complete state
  const blocksWithSubblockValues = mergeSubblockState(rawState.blocks)

  // Clean the state - only include essential fields
  return {
    blocks: blocksWithSubblockValues,
    edges: rawState.edges || [],
    loops: rawState.loops || {},
    parallels: rawState.parallels || {},
    lastSaved: Date.now(),
  }
}

export const useCopilotTrainingStore = create<CopilotTrainingState>()(
  devtools(
    (set, get) => ({
      // Initial state
      isTraining: false,
      currentTitle: '',
      currentPrompt: '',
      startSnapshot: null,
      startTime: null,
      datasets: [],
      showModal: false,

      // Start a new training session
      startTraining: (title: string, prompt: string) => {
        if (!prompt.trim()) {
          logger.warn('Cannot start training without a prompt')
          return
        }
        if (!title.trim()) {
          logger.warn('Cannot start training without a title')
          return
        }

        const snapshot = captureWorkflowSnapshot()

        logger.info('Starting training session', {
          title,
          prompt,
          blockCount: Object.keys(snapshot.blocks).length,
          edgeCount: snapshot.edges.length,
        })

        set({
          isTraining: true,
          currentTitle: title,
          currentPrompt: prompt,
          startSnapshot: snapshot,
          startTime: Date.now(),
          showModal: false, // Close modal when starting
        })
      },

      // Stop training and save the dataset
      stopTraining: () => {
        const state = get()

        if (!state.isTraining || !state.startSnapshot) {
          logger.warn('No active training session to stop')
          return null
        }

        const endSnapshot = captureWorkflowSnapshot()
        const duration = state.startTime ? Date.now() - state.startTime : 0

        // Sanitize snapshots for compute-edit-sequence (it works with sanitized state)
        const sanitizedStart = sanitizeForCopilot(state.startSnapshot!)
        const sanitizedEnd = sanitizeForCopilot(endSnapshot)

        // Compute the edit sequence
        const { operations, summary } = computeEditSequence(sanitizedStart, sanitizedEnd)

        // Get workflow ID from the store
        const { activeWorkflowId } = useWorkflowStore.getState() as any

        const dataset: TrainingDataset = {
          id: crypto.randomUUID(),
          workflowId: activeWorkflowId || 'unknown',
          title: state.currentTitle,
          prompt: state.currentPrompt,
          startState: state.startSnapshot,
          endState: endSnapshot,
          editSequence: operations,
          createdAt: new Date(),
          metadata: {
            duration,
            blockCount: Object.keys(endSnapshot.blocks).length,
            edgeCount: endSnapshot.edges.length,
          },
        }

        logger.info('Training session completed', {
          title: state.currentTitle,
          prompt: state.currentPrompt,
          duration,
          operations: operations.length,
          summary,
        })

        set((prev) => ({
          isTraining: false,
          currentTitle: '',
          currentPrompt: '',
          startSnapshot: null,
          startTime: null,
          datasets: [...prev.datasets, dataset],
        }))

        return dataset
      },

      // Cancel training without saving
      cancelTraining: () => {
        logger.info('Training session cancelled')

        set({
          isTraining: false,
          currentTitle: '',
          currentPrompt: '',
          startSnapshot: null,
          startTime: null,
        })
      },

      // Update the prompt
      setPrompt: (prompt: string) => {
        set({ currentPrompt: prompt })
      },

      // Toggle modal visibility
      toggleModal: () => {
        set((state) => ({ showModal: !state.showModal }))
      },

      // Clear all datasets
      clearDatasets: () => {
        logger.info('Clearing all training datasets')
        set({ datasets: [] })
      },

      // Export datasets as JSON
      exportDatasets: () => {
        const { datasets } = get()

        const exportData = {
          version: '1.0',
          exportedAt: new Date().toISOString(),
          datasets: datasets.map((d) => ({
            id: d.id,
            workflowId: d.workflowId,
            prompt: d.prompt,
            startState: d.startState,
            endState: d.endState,
            editSequence: d.editSequence,
            createdAt: d.createdAt.toISOString(),
            sentAt: d.sentAt ? d.sentAt.toISOString() : undefined,
            metadata: d.metadata,
          })),
        }

        return JSON.stringify(exportData, null, 2)
      },

      // Mark a dataset as sent (persist a timestamp)
      markDatasetSent: (id: string, sentAt?: Date) => {
        const when = sentAt ?? new Date()
        set((state) => ({
          datasets: state.datasets.map((d) => (d.id === id ? { ...d, sentAt: when } : d)),
        }))
      },
    }),
    {
      name: 'copilot-training-store',
    }
  )
)
```

### Purpose of this file

This file defines a Zustand store called `useCopilotTrainingStore`. This store is responsible for managing the state related to training a "Copilot" (likely an AI assistant) on workflow edits. It handles:

-   Managing the current training session (isTraining, title, prompt, start snapshot, start time).
-   Storing the completed training datasets.
-   Managing the UI state for a modal related to training.
-   Providing actions to start, stop, cancel, and manage training datasets.

In essence, it acts as a central repository for the data and logic needed to record and manage training examples for the Copilot, where each example consists of a prompt, the initial workflow state, the final workflow state after edits, and the sequence of edits performed.

### Explanation of Code

**1. Imports:**

*   `create` from `zustand`: This is the core function from the `zustand` library used to create a store. Zustand is a simple state management library for React.
*   `devtools` from `zustand/middleware`: A middleware that enhances the store with debugging capabilities via the Redux DevTools extension.  This allows time-travel debugging and inspecting state changes.
*   `createLogger` from `@/lib/logs/console/logger`:  A custom logging utility function (likely defined elsewhere in the project) to create a logger instance for this store.  It prefixes logs with "CopilotTrainingStore" for easy identification.
*   `sanitizeForCopilot` from `@/lib/workflows/json-sanitizer`: A function that takes a workflow state and removes any fields that are not required for the copilot training, cleaning up the JSON and potentially reducing its size.  This is likely for privacy or efficiency reasons.
*   `computeEditSequence` and `EditOperation` from `@/lib/workflows/training/compute-edit-sequence`:  `computeEditSequence` is a function that takes two sanitized workflow states (start and end) and computes the sequence of edit operations required to transform the start state into the end state. `EditOperation` is a type definition for an individual edit operation in the sequence.
*   `mergeSubblockState` from `@/stores/workflows/utils`: This function probably merges the state of nested "subblocks" within a workflow's blocks into the main block state. This likely ensures that the captured workflow state is complete and accurate, especially when dealing with complex workflows that contain nested elements.
*   `useWorkflowStore` from `@/stores/workflows/workflow/store`:  Imports the Zustand store that manages the overall workflow state. This store is used to access the current workflow state for capturing snapshots and to get the current `activeWorkflowId`.
*   `WorkflowState` from `@/stores/workflows/workflow/types`:  Imports the type definition for the workflow state, which includes information about blocks, edges, loops and parallels.

**2. `logger`:**

```typescript
const logger = createLogger('CopilotTrainingStore')
```

Creates a logger instance using the `createLogger` function, tagged with the name 'CopilotTrainingStore'. This allows for easy filtering and identification of logs originating from this store.

**3. `TrainingDataset` Interface:**

```typescript
export interface TrainingDataset {
  id: string
  workflowId: string
  title: string
  prompt: string
  startState: WorkflowState
  endState: WorkflowState
  editSequence: EditOperation[]
  createdAt: Date
  sentAt?: Date
  metadata?: {
    duration?: number // Time taken to complete edits in ms
    blockCount?: number
    edgeCount?: number
  }
}
```

Defines the structure of a training dataset.  Each dataset represents one training example for the Copilot.  It includes:

*   `id`: A unique identifier for the dataset.
*   `workflowId`: The ID of the workflow this dataset relates to.
*   `title`: A descriptive title for the training session.
*   `prompt`: The user prompt given to the Copilot or user during training.
*   `startState`: The initial state of the workflow before edits.
*   `endState`: The final state of the workflow after edits.
*   `editSequence`:  An array of `EditOperation` objects representing the sequence of steps taken to transform the `startState` into the `endState`. This is the key to training the copilot to understand how workflows are modified.
*   `createdAt`: A timestamp indicating when the dataset was created.
*   `sentAt`: An optional timestamp indicating when the dataset was sent for training (e.g., to an external API).
*   `metadata`:  Optional metadata about the training session, like duration, number of blocks, and number of edges in the workflow.

**4. `CopilotTrainingState` Interface:**

```typescript
interface CopilotTrainingState {
  // Current training session
  isTraining: boolean
  currentTitle: string
  currentPrompt: string
  startSnapshot: WorkflowState | null
  startTime: number | null

  // Completed datasets
  datasets: TrainingDataset[]

  // UI state
  showModal: boolean

  // Actions
  startTraining: (title: string, prompt: string) => void
  stopTraining: () => TrainingDataset | null
  cancelTraining: () => void
  setPrompt: (prompt: string) => void
  toggleModal: () => void
  clearDatasets: () => void
  exportDatasets: () => string
  markDatasetSent: (id: string, sentAt?: Date) => void
}
```

Defines the structure of the state managed by the `useCopilotTrainingStore`. It includes:

*   `isTraining`: A boolean indicating whether a training session is currently active.
*   `currentTitle`: The title of the current training session.
*   `currentPrompt`: The prompt used in the current training session.
*   `startSnapshot`:  A snapshot of the workflow state at the beginning of the training session.  This allows the system to compare the initial state with the final state to determine the edits made.  It's nullable because there's no snapshot when not training.
*   `startTime`: The timestamp when the training session started. Nullable as there is no start time when not training.
*   `datasets`: An array of `TrainingDataset` objects representing the completed training examples.
*   `showModal`: A boolean controlling the visibility of a UI modal related to training.
*   **Actions:**  A set of functions that allow components to interact with and modify the store's state.  These actions are described in more detail below.

**5. `captureWorkflowSnapshot` Function:**

```typescript
/**
 * Get a clean snapshot of the current workflow state
 */
function captureWorkflowSnapshot(): WorkflowState {
  const rawState = useWorkflowStore.getState().getWorkflowState()

  // Merge subblock values to get complete state
  const blocksWithSubblockValues = mergeSubblockState(rawState.blocks)

  // Clean the state - only include essential fields
  return {
    blocks: blocksWithSubblockValues,
    edges: rawState.edges || [],
    loops: rawState.loops || {},
    parallels: rawState.parallels || {},
    lastSaved: Date.now(),
  }
}
```

This function captures a snapshot of the current workflow state from the `useWorkflowStore`. It performs these key steps:

1.  **Gets Raw State:** Retrieves the current workflow state using `useWorkflowStore.getState().getWorkflowState()`. This assumes the `useWorkflowStore` has a `getWorkflowState` method to return the state.
2.  **Merges Subblock State:** Calls `mergeSubblockState` to merge any nested subblock data into the main blocks. This ensures a complete representation of the workflow blocks.
3.  **Creates a New Object:** Constructs a new `WorkflowState` object containing only the essential properties from the raw state: `blocks`, `edges`, `loops`, and `parallels`, and `lastSaved`.  It uses the merged subblock values for the `blocks` property.  The `|| []` ensures that `edges`, `loops` and `parallels` are initialized as empty arrays/objects if they are undefined in the `rawState`. `lastSaved` is assigned the current timestamp.

This function is crucial for creating consistent snapshots of the workflow, both at the start and end of the training session.

**6. `useCopilotTrainingStore` Zustand Store:**

```typescript
export const useCopilotTrainingStore = create<CopilotTrainingState>()(
  devtools(
    (set, get) => ({
      // Initial state
      isTraining: false,
      currentTitle: '',
      currentPrompt: '',
      startSnapshot: null,
      startTime: null,
      datasets: [],
      showModal: false,

      // Start a new training session
      startTraining: (title: string, prompt: string) => {
        if (!prompt.trim()) {
          logger.warn('Cannot start training without a prompt')
          return
        }
        if (!title.trim()) {
          logger.warn('Cannot start training without a title')
          return
        }

        const snapshot = captureWorkflowSnapshot()

        logger.info('Starting training session', {
          title,
          prompt,
          blockCount: Object.keys(snapshot.blocks).length,
          edgeCount: snapshot.edges.length,
        })

        set({
          isTraining: true,
          currentTitle: title,
          currentPrompt: prompt,
          startSnapshot: snapshot,
          startTime: Date.now(),
          showModal: false, // Close modal when starting
        })
      },

      // Stop training and save the dataset
      stopTraining: () => {
        const state = get()

        if (!state.isTraining || !state.startSnapshot) {
          logger.warn('No active training session to stop')
          return null
        }

        const endSnapshot = captureWorkflowSnapshot()
        const duration = state.startTime ? Date.now() - state.startTime : 0

        // Sanitize snapshots for compute-edit-sequence (it works with sanitized state)
        const sanitizedStart = sanitizeForCopilot(state.startSnapshot!)
        const sanitizedEnd = sanitizeForCopilot(endSnapshot)

        // Compute the edit sequence
        const { operations, summary } = computeEditSequence(sanitizedStart, sanitizedEnd)

        // Get workflow ID from the store
        const { activeWorkflowId } = useWorkflowStore.getState() as any

        const dataset: TrainingDataset = {
          id: crypto.randomUUID(),
          workflowId: activeWorkflowId || 'unknown',
          title: state.currentTitle,
          prompt: state.currentPrompt,
          startState: state.startSnapshot,
          endState: endSnapshot,
          editSequence: operations,
          createdAt: new Date(),
          metadata: {
            duration,
            blockCount: Object.keys(endSnapshot.blocks).length,
            edgeCount: endSnapshot.edges.length,
          },
        }

        logger.info('Training session completed', {
          title: state.currentTitle,
          prompt: state.currentPrompt,
          duration,
          operations: operations.length,
          summary,
        })

        set((prev) => ({
          isTraining: false,
          currentTitle: '',
          currentPrompt: '',
          startSnapshot: null,
          startTime: null,
          datasets: [...prev.datasets, dataset],
        }))

        return dataset
      },

      // Cancel training without saving
      cancelTraining: () => {
        logger.info('Training session cancelled')

        set({
          isTraining: false,
          currentTitle: '',
          currentPrompt: '',
          startSnapshot: null,
          startTime: null,
        })
      },

      // Update the prompt
      setPrompt: (prompt: string) => {
        set({ currentPrompt: prompt })
      },

      // Toggle modal visibility
      toggleModal: () => {
        set((state) => ({ showModal: !state.showModal }))
      },

      // Clear all datasets
      clearDatasets: () => {
        logger.info('Clearing all training datasets')
        set({ datasets: [] })
      },

      // Export datasets as JSON
      exportDatasets: () => {
        const { datasets } = get()

        const exportData = {
          version: '1.0',
          exportedAt: new Date().toISOString(),
          datasets: datasets.map((d) => ({
            id: d.id,
            workflowId: d.workflowId,
            prompt: d.prompt,
            startState: d.startState,
            endState: d.endState,
            editSequence: d.editSequence,
            createdAt: d.createdAt.toISOString(),
            sentAt: d.sentAt ? d.sentAt.toISOString() : undefined,
            metadata: d.metadata,
          })),
        }

        return JSON.stringify(exportData, null, 2)
      },

      // Mark a dataset as sent (persist a timestamp)
      markDatasetSent: (id: string, sentAt?: Date) => {
        const when = sentAt ?? new Date()
        set((state) => ({
          datasets: state.datasets.map((d) => (d.id === id ? { ...d, sentAt: when } : d)),
        }))
      },
    }),
    {
      name: 'copilot-training-store',
    }
  )
)
```

This is where the Zustand store is actually created and exported.  Let's break it down:

*   `create<CopilotTrainingState>()`:  This tells Zustand to create a store that adheres to the `CopilotTrainingState` interface.  This enforces type safety.
*   `devtools(...)`:  This wraps the store's configuration with the `devtools` middleware.  This enables the Redux DevTools for debugging.
*   `(set, get) => ({ ... })`: This is the core configuration function for the store.  It receives two arguments:
    *   `set`:  A function used to update the store's state.  It's similar to `setState` in React class components.  It can take either a new state object or a function that receives the previous state and returns the new state (as shown in the `toggleModal` example).
    *   `get`: A function used to retrieve the current store's state.

Inside the configuration function, an object is returned that defines the store's initial state and actions:

**Initial State:**

The initial state sets default values for all the properties defined in `CopilotTrainingState`:

*   `isTraining: false`
*   `currentTitle: ''`
*   `currentPrompt: ''`
*   `startSnapshot: null`
*   `startTime: null`
*   `datasets: []`
*   `showModal: false`

**Actions:**

Each action is a function that modifies the store's state using the `set` function and potentially retrieves state using the `get` function. Let's describe each action in more detail:

*   `startTraining(title: string, prompt: string)`:
    *   Starts a new training session.
    *   Validates that the `title` and `prompt` are not empty.
    *   Captures a workflow snapshot using `captureWorkflowSnapshot()`.
    *   Logs the start of the training session using the logger.
    *   Updates the state:
        *   `isTraining: true`
        *   `currentTitle: title`
        *   `currentPrompt: prompt`
        *   `startSnapshot: snapshot`
        *   `startTime: Date.now()`
        *   `showModal: false` (closes the modal)
*   `stopTraining()`:
    *   Stops the current training session and saves the data as a training dataset.
    *   Validates that a training session is active.
    *   Captures the end workflow snapshot using `captureWorkflowSnapshot()`.
    *   Calculates the duration of the training session.
    *   Sanitizes the `startSnapshot` and `endSnapshot` using `sanitizeForCopilot()`.
    *   Computes the edit sequence using `computeEditSequence()`.
    *   Gets the active workflow ID from the `useWorkflowStore`.
    *   Creates a new `TrainingDataset` object with all the relevant data.
    *   Logs the completion of the training session.
    *   Updates the state:
        *   `isTraining: false`
        *   `currentTitle: ''`
        *   `currentPrompt: ''`
        *   `startSnapshot: null`
        *   `startTime: null`
        *   Adds the new `dataset` to the `datasets` array.
    *   Returns the created `dataset`.
*   `cancelTraining()`:
    *   Cancels the current training session without saving the data.
    *   Logs the cancellation of the training session.
    *   Resets the state related to the current session:
        *   `isTraining: false`
        *   `currentTitle: ''`
        *   `currentPrompt: ''`
        *   `startSnapshot: null`
        *   `startTime: null`
*   `setPrompt(prompt: string)`:
    *   Updates the `currentPrompt` in the state.
*   `toggleModal()`:
    *   Toggles the visibility of the modal (`showModal`) by inverting its current value.  This demonstrates how to use the `set` function with a function argument that receives the previous state.
*   `clearDatasets()`:
    *   Clears all training datasets by setting `datasets` to an empty array.
    *   Logs that the datasets were cleared.
*   `exportDatasets()`:
    *   Exports the training datasets as a JSON string.
    *   Retrieves the `datasets` from the store using `get()`.
    *   Creates a data object with a `version`, `exportedAt` timestamp, and the `datasets`.  It transforms the `createdAt` and `sentAt` dates into ISO strings.
    *   Stringifies the data object into a JSON string using `JSON.stringify` with indentation for readability.
*   `markDatasetSent(id: string, sentAt?: Date)`:
    *   Marks a specific dataset as "sent" by updating its `sentAt` property.
    *   If `sentAt` is not provided, it defaults to the current date and time.
    *   It iterates through the `datasets` array and updates the `sentAt` property of the dataset with the matching `id`.

**Zustand Configuration:**

*   `{ name: 'copilot-training-store' }`: This provides a name for the store within the `devtools` middleware, making it easier to identify in the Redux DevTools.

### Summary

In summary, this code defines a Zustand store (`useCopilotTrainingStore`) that manages the state and logic for training a Copilot on workflow edits. It includes actions to start, stop, cancel, and manage training sessions, capture workflow snapshots, compute edit sequences, and export training datasets. The store utilizes middleware for debugging and logging, and it interacts with other stores and utility functions within the project. The overall structure promotes a clean and organized approach to managing the training data and process.
