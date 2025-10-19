```typescript
import type { Executor } from '@/executor'
import type { ExecutionContext } from '@/executor/types'

// Purpose of this file:
//
// This file defines the data structures and initial state related to the execution of a program or workflow within a visual programming environment.  It focuses on tracking the state of execution, debugging, and related actions. This includes which blocks of code are currently active, whether the execution is running or debugging, blocks waiting to be executed, the execution engine itself, and debugging context.  It also manages the panning behavior during execution, allowing the UI to follow the active block.
//
// Simplification of Complex Logic:
//
// The code simplifies complex execution management by:
//   1. Centralizing all execution-related state into a single `ExecutionState` interface.
//   2. Defining explicit actions (`ExecutionActions`) to modify this state, promoting controlled updates.
//   3. Providing a clear `initialState` for a predictable starting point.
//   4. Separating panning related functionalities to decouple concerns.

// Explanation of each line of code:

// Imports:
// ----------------------------------------------------------------------------------------------------

// `import type { Executor } from '@/executor'`
// Imports the `Executor` type from the specified path.  `Executor` likely represents the engine responsible for running the program or workflow.  The `type` keyword ensures that this import only brings in type information and doesn't include the actual code, optimizing bundle size.  The `@` alias commonly refers to the `src` directory of the project.
import type { Executor } from '@/executor'

// `import type { ExecutionContext } from '@/executor/types'`
// Imports the `ExecutionContext` type from the specified path.  `ExecutionContext` likely holds information about the environment in which the program or workflow is being executed, such as variable values, function definitions, and other relevant data for debugging and running the program.  Again, `type` is used for type-only import.
import type { ExecutionContext } from '@/executor/types'

// Interfaces:
// ----------------------------------------------------------------------------------------------------

// `export interface ExecutionState { ... }`
// Defines the `ExecutionState` interface. This interface encapsulates all the data necessary to represent the current state of the program execution.  It's `export`ed, making it available for use in other modules.

// `activeBlockIds: Set<string>`
// A `Set` of strings representing the IDs of the blocks currently being executed or considered active.  Using a `Set` ensures that block IDs are unique and allows for efficient checking of block membership.

// `isExecuting: boolean`
// A boolean flag indicating whether the program is currently running.

// `isDebugging: boolean`
// A boolean flag indicating whether the program is currently being debugged.

// `pendingBlocks: string[]`
// An array of strings representing the IDs of blocks that are waiting to be executed.  This is likely a queue or stack of blocks to be processed in a specific order.

// `executor: Executor | null`
// Represents the execution engine responsible for running the program.  It can be an `Executor` object or `null` if no executor is currently active.

// `debugContext: ExecutionContext | null`
// Represents the debugging context, containing information about the program's state during debugging. It can be an `ExecutionContext` object or `null` if not debugging.

// `autoPanDisabled: boolean`
// A boolean flag that controls whether the UI should automatically pan to the currently executing block.  If `true`, auto-panning is disabled; if `false`, it's enabled.

// `export interface ExecutionActions { ... }`
// Defines the `ExecutionActions` interface. This interface specifies the actions (functions) that can be used to modify the `ExecutionState`.  These actions promote a controlled and predictable way to update the state.

// `setActiveBlocks: (blockIds: Set<string>) => void`
// A function that sets the `activeBlockIds` in the `ExecutionState`. It takes a `Set<string>` of block IDs as input and returns void (nothing).

// `setIsExecuting: (isExecuting: boolean) => void`
// A function that sets the `isExecuting` flag in the `ExecutionState`. It takes a boolean value as input and returns void.

// `setIsDebugging: (isDebugging: boolean) => void`
// A function that sets the `isDebugging` flag in the `ExecutionState`. It takes a boolean value as input and returns void.

// `setPendingBlocks: (blockIds: string[]) => void`
// A function that sets the `pendingBlocks` array in the `ExecutionState`. It takes an array of block IDs (strings) as input and returns void.

// `setExecutor: (executor: Executor | null) => void`
// A function that sets the `executor` in the `ExecutionState`. It takes an `Executor` object (or null) as input and returns void.

// `setDebugContext: (context: ExecutionContext | null) => void`
// A function that sets the `debugContext` in the `ExecutionState`. It takes an `ExecutionContext` object (or null) as input and returns void.

// `setAutoPanDisabled: (disabled: boolean) => void`
// A function that sets the `autoPanDisabled` flag in the `ExecutionState`. It takes a boolean value as input and returns void.

// `reset: () => void`
// A function that resets the `ExecutionState` to its initial state. It takes no input and returns void.  This function is useful for cleaning up the state after an execution or debugging session.

// Initial State:
// ----------------------------------------------------------------------------------------------------

// `export const initialState: ExecutionState = { ... }`
// Defines the initial state of the `ExecutionState`.  This object provides default values for all the properties in the `ExecutionState` interface.

// `activeBlockIds: new Set()`
// Initializes the `activeBlockIds` to an empty `Set`.

// `isExecuting: false`
// Initializes the `isExecuting` flag to `false`, indicating that the program is not running by default.

// `isDebugging: false`
// Initializes the `isDebugging` flag to `false`, indicating that the program is not being debugged by default.

// `pendingBlocks: []`
// Initializes the `pendingBlocks` array to an empty array.

// `executor: null`
// Initializes the `executor` to `null`, indicating that no executor is active by default.

// `debugContext: null`
// Initializes the `debugContext` to `null`, indicating that no debugging context is active by default.

// `autoPanDisabled: false`
// Initializes `autoPanDisabled` to `false`, enabling auto-panning by default.

// Panning Functionality:
// ----------------------------------------------------------------------------------------------------

// `export type PanToBlockCallback = (blockId: string) => void`
// Defines a type alias `PanToBlockCallback` for a function that takes a block ID (string) as input and returns void. This callback function is likely responsible for panning the UI to the specified block.

// `export type SetPanToBlockCallback = (callback: PanToBlockCallback | null) => void`
// Defines a type alias `SetPanToBlockCallback` for a function that takes a `PanToBlockCallback` (or null) as input and returns void. This function is likely responsible for setting or updating the callback that is used to pan to a block. Providing `null` would likely disable panning functionality.
```
