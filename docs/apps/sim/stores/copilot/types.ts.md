```typescript
import type { ClientToolCallState, ClientToolDisplay } from '@/lib/copilot/tools/client/base-tool'

// Defines the type for the state of a tool call on the client side.
export type ToolState = ClientToolCallState

// Defines the structure for a tool call within the copilot system.  A tool call is when the copilot invokes an external tool to perform a task.
export interface CopilotToolCall {
  // Unique identifier for the tool call.
  id: string
  // The name of the tool being called.
  name: string
  // The current state of the tool call (e.g., pending, success, error).  This uses the ClientToolCallState type defined in '@/lib/copilot/tools/client/base-tool'.
  state: ClientToolCallState
  // Optional parameters passed to the tool. Can be any type.
  params?: Record<string, any>
  // Optional display properties to control how the tool call is presented in the UI. This uses the ClientToolDisplay type defined in '@/lib/copilot/tools/client/base-tool'.
  display?: ClientToolDisplay
}

// Defines the structure for a file attachment associated with a message.
export interface MessageFileAttachment {
  // Unique identifier for the file attachment.
  id: string
  // Key for accessing the file in storage (e.g., cloud storage).
  key: string
  // The original filename of the attached file.
  filename: string
  // The media type of the file (e.g., 'image/png', 'application/pdf').
  media_type: string
  // The size of the file in bytes.
  size: number
}

// Defines the structure for a message within the copilot chat.
export interface CopilotMessage {
  // Unique identifier for the message.
  id: string
  // The role of the message sender (user, assistant, or system).
  role: 'user' | 'assistant' | 'system'
  // The content of the message.
  content: string
  // The timestamp of when the message was created.
  timestamp: string
  // Optional citations for the message, providing sources for the content.
  citations?: { id: number; title: string; url: string; similarity?: number }[]
  // Optional tool calls associated with the message (if the assistant invoked any tools).
  toolCalls?: CopilotToolCall[]
  // Defines how the message is structured into blocks. Can include text, "thinking" status, tool calls or other contexts
  contentBlocks?: Array<
    // A simple text block.
    | { type: 'text'; content: string; timestamp: number }
    // Represents the copilot "thinking" about the response.
    | {
        type: 'thinking'
        content: string
        timestamp: number
        duration?: number  //Optional duration of the thinking process.
        startTime?: number //Optional timestamp of when the thinking process began.
      }
    // A tool call block, referencing a specific tool call.
    | { type: 'tool_call'; toolCall: CopilotToolCall; timestamp: number }
    //Contexts block.
    | { type: 'contexts'; contexts: ChatContext[]; timestamp: number }
  >
  // Optional file attachments associated with the message.
  fileAttachments?: MessageFileAttachment[]
  // Optional contexts associated with the message.  Provides metadata about the source or purpose of the message.
  contexts?: ChatContext[]
}

// Defines the structure for context objects associated with a user message.  Context provides additional information about the message, such as the source chat, workflow, or document.
export type ChatContext =
  // Refers to a past chat.
  | { kind: 'past_chat'; chatId: string; label: string }
  // Refers to a workflow.
  | { kind: 'workflow'; workflowId: string; label: string }
  // Refers to the current workflow.
  | { kind: 'current_workflow'; workflowId: string; label: string }
  // Refers to specific blocks within a chat or workflow.
  | { kind: 'blocks'; blockIds: string[]; label: string }
  // Refers to logs, possibly associated with an execution.
  | { kind: 'logs'; executionId?: string; label: string }
  // Refers to a specific block within a workflow.
  | { kind: 'workflow_block'; workflowId: string; blockId: string; label: string }
  // Refers to knowledge base entries.
  | { kind: 'knowledge'; knowledgeId?: string; label: string }
  // Refers to templates.
  | { kind: 'templates'; templateId?: string; label: string }
  // Refers to documentation.
  | { kind: 'docs'; label: string }

// Defines the structure for a Copilot chat session.
export interface CopilotChat {
  // Unique identifier for the chat.
  id: string
  // The title of the chat (can be null if not set).
  title: string | null
  // The language model used for the chat (e.g., 'gpt-4').
  model: string
  // An array of messages in the chat.
  messages: CopilotMessage[]
  // The number of messages in the chat.  This might be different than `messages.length` if messages are loaded in pages.
  messageCount: number
  // Preview of the YAML content
  previewYaml: string | null
  // The date the chat was created.
  createdAt: Date
  // The date the chat was last updated.
  updatedAt: Date
}

// Defines the mode of operation for the copilot ('ask' or 'agent').
export type CopilotMode = 'ask' | 'agent'

// Defines the structure for the Copilot's state, encompassing various aspects of the chat session, settings, and UI state.
export interface CopilotState {
  // The current mode of the copilot ('ask' or 'agent').
  mode: CopilotMode
  // The selected language model.
  selectedModel:
    | 'gpt-5-fast'
    | 'gpt-5'
    | 'gpt-5-medium'
    | 'gpt-5-high'
    | 'gpt-4o'
    | 'gpt-4.1'
    | 'o3'
    | 'claude-4-sonnet'
    | 'claude-4.5-sonnet'
    | 'claude-4.1-opus'
  // Whether to prefetch agent data.
  agentPrefetch: boolean
  // The list of enabled models.  Null means the models haven't been loaded yet.
  enabledModels: string[] | null
  // Whether the copilot interface is collapsed.
  isCollapsed: boolean

  // The currently selected chat.
  currentChat: CopilotChat | null
  // An array of all chats.
  chats: CopilotChat[]
  // An array of messages in the current chat.  This can be different than `currentChat.messages` when lazy loading.
  messages: CopilotMessage[]
  // The ID of the workflow associated with the copilot (can be null).
  workflowId: string | null

  // Checkpoints represent saved states of the conversation.  The `any[]` type should ideally be replaced with a more specific type.
  checkpoints: any[]
  // Per-message checkpoints
  messageCheckpoints: Record<string, any[]>

  // Flags indicating loading states for various operations.
  isLoading: boolean
  isLoadingChats: boolean
  isLoadingCheckpoints: boolean
  isSendingMessage: boolean
  isSaving: boolean
  isRevertingCheckpoint: boolean
  isAborting: boolean

  // Error messages for various operations.
  error: string | null
  saveError: string | null
  checkpointError: string | null

  // AbortController for cancelling in-flight requests.
  abortController: AbortController | null

  // Timestamps for when chats were last loaded.
  chatsLastLoadedAt: Date | null
  // Workflow for which chats were loaded.
  chatsLoadedForWorkflow: string | null

  // State for reverting to a previous message.
  revertState: { messageId: string; messageContent: string } | null
  // The current value of the input field.
  inputValue: string

  // Plan todos
  planTodos: Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>
  // Show plan todos
  showPlanTodos: boolean

  // Map of toolCallId -> CopilotToolCall for quick access during streaming
  toolCallsById: Record<string, CopilotToolCall>

  // Transient flag to prevent auto-selecting a chat during new-chat UX
  suppressAutoSelect?: boolean

  // Explicitly track the current user message id for this in-flight query (for stats/diff correlation)
  currentUserMessageId?: string | null

  // Per-message metadata captured at send-time for reliable stats

  // Context usage tracking for percentage pill
  contextUsage: {
    usage: number
    percentage: number
    model: string
    contextWindow: number
    when: 'start' | 'end'
    estimatedTokens?: number
  } | null
}

// Defines the structure for the Copilot's actions, providing functions to interact with the state and perform operations.
export interface CopilotActions {
  // Sets the copilot mode.
  setMode: (mode: CopilotMode) => void
  // Sets the selected language model.
  setSelectedModel: (model: CopilotStore['selectedModel']) => void
  // Sets whether to prefetch agent data.
  setAgentPrefetch: (prefetch: boolean) => void
  // Sets the list of enabled models.
  setEnabledModels: (models: string[] | null) => void

  // Sets the workflow ID.
  setWorkflowId: (workflowId: string | null) => Promise<void>
  // Validates the current chat.
  validateCurrentChat: () => boolean
  // Loads chats (optionally force refreshing).
  loadChats: (forceRefresh?: boolean) => Promise<void>
  // Checks if chats are fresh for a given workflow ID.
  areChatsFresh: (workflowId: string) => boolean
  // Selects a chat.
  selectChat: (chat: CopilotChat) => Promise<void>
  // Creates a new chat.
  createNewChat: () => Promise<void>
  // Deletes a chat.
  deleteChat: (chatId: string) => Promise<void>

  // Sends a message.
  sendMessage: (
    message: string,
    options?: {
      stream?: boolean
      fileAttachments?: MessageFileAttachment[]
      contexts?: ChatContext[]
    }
  ) => Promise<void>
  // Aborts a message sending operation.
  abortMessage: () => void
  // Sends implicit feedback.
  sendImplicitFeedback: (
    implicitFeedback: string,
    toolCallState?: 'accepted' | 'rejected' | 'error'
  ) => Promise<void>
  // Updates the preview tool call state.
  updatePreviewToolCallState: (
    toolCallState: 'accepted' | 'rejected' | 'error',
    toolCallId?: string
  ) => void
  // Sets the tool call state.
  setToolCallState: (toolCall: any, newState: ClientToolCallState, options?: any) => void
  // Sends a documentation message.
  sendDocsMessage: (query: string, options?: { stream?: boolean; topK?: number }) => Promise<void>
  // Saves the chat messages.
  saveChatMessages: (chatId: string) => Promise<void>

  // Loads checkpoints for a chat.
  loadCheckpoints: (chatId: string) => Promise<void>
  // Loads message checkpoints for a chat.
  loadMessageCheckpoints: (chatId: string) => Promise<void>
  // Reverts to a checkpoint.
  revertToCheckpoint: (checkpointId: string) => Promise<void>
  // Gets the checkpoints for a message.
  getCheckpointsForMessage: (messageId: string) => any[]

  // Sets the preview YAML content.
  setPreviewYaml: (yamlContent: string) => Promise<void>
  // Clears the preview YAML content.
  clearPreviewYaml: () => Promise<void>

  // Clears the messages.
  clearMessages: () => void
  // Clears the error message.
  clearError: () => void
  // Clears the save error message.
  clearSaveError: () => void
  // Clears the checkpoint error message.
  clearCheckpointError: () => void
  // Retries saving the chat.
  retrySave: (chatId: string) => Promise<void>
  // Performs cleanup.
  cleanup: () => void
  // Resets the copilot state.
  reset: () => void

  // Sets the input value.
  setInputValue: (value: string) => void
  // Clears the revert state.
  clearRevertState: () => void

  // Sets plan todos
  setPlanTodos: (
    todos: Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>
  ) => void
  // Updates a plan todo
  updatePlanTodoStatus: (id: string, status: 'executing' | 'completed') => void
  // Closes plan todos
  closePlanTodos: () => void

  // Handles a streaming response.
  handleStreamingResponse: (
    stream: ReadableStream,
    messageId: string,
    isContinuation?: boolean,
    triggerUserMessageId?: string
  ) => Promise<void>
  // Handles the creation of a new chat.
  handleNewChatCreation: (newChatId: string) => Promise<void>
  // Updates the diff store.
  updateDiffStore: (yamlContent: string, toolName?: string) => Promise<void>
  // Updates the diff store with workflow state.
  updateDiffStoreWithWorkflowState: (workflowState: any, toolName?: string) => Promise<void>
}

// Combines the CopilotState and CopilotActions into a single type, representing the complete Copilot store.
export type CopilotStore = CopilotState & CopilotActions
```

**Purpose of this file:**

This TypeScript file defines the data structures (interfaces and types) and actions related to the state management of a "Copilot" feature. The Copilot likely provides assistance within an application (e.g., code editor, design tool). It encompasses everything from chat sessions and message structures to tool calls, context management, and UI-related state.  This file serves as a central definition of the copilot's data model.  By having these definitions, the application can maintain a consistent and predictable state for the copilot, enabling complex features like chat history, tool integration, and checkpointing. It essentially defines the contract for how the Copilot system operates.

**Explanation of each section and line of code:**

1.  **Imports:**

    *   `import type { ClientToolCallState, ClientToolDisplay } from '@/lib/copilot/tools/client/base-tool'`: This line imports two type definitions from a module related to client-side tool integration: `ClientToolCallState` and `ClientToolDisplay`. These are likely used to manage the state and display of tools invoked by the copilot. The `@` symbol is a common convention in projects using tools like Webpack or Vite to refer to the project's root directory, thus providing a clean way to reference internal modules.
2.  **`ToolState` Type Alias:**

    *   `export type ToolState = ClientToolCallState`: This line creates a type alias named `ToolState`.  It makes `ToolState` a synonym for `ClientToolCallState`. This can improve code readability by using a more specific name relevant to the current context, and allows you to easily change the underlying type in one place if needed.
3.  **`CopilotToolCall` Interface:**

    *   `export interface CopilotToolCall { ... }`: Defines the structure of an object representing a call to a tool by the Copilot.

        *   `id: string`: A unique identifier for this specific tool call.
        *   `name: string`: The name of the tool being called (e.g., "search", "generateCode").
        *   `state: ClientToolCallState`: The current state of the tool call (e.g., "pending", "success", "error").  This uses the imported `ClientToolCallState` type.
        *   `params?: Record<string, any>`: An optional object containing parameters to pass to the tool. `Record<string, any>` means it's a dictionary where keys are strings and values can be of any type.
        *   `display?: ClientToolDisplay`: Optional display configurations for the tool in the UI, like icons or custom rendering. Uses the imported `ClientToolDisplay` type.
4.  **`MessageFileAttachment` Interface:**

    *   `export interface MessageFileAttachment { ... }`: Defines the structure of an object representing a file attached to a message.

        *   `id: string`: A unique identifier for the file attachment.
        *   `key: string`: The key used to retrieve the file from storage (e.g., AWS S3).
        *   `filename: string`: The original name of the file.
        *   `media_type: string`: The MIME type of the file (e.g., "image/jpeg", "application/pdf").
        *   `size: number`: The size of the file in bytes.
5.  **`CopilotMessage` Interface:**

    *   `export interface CopilotMessage { ... }`: Defines the structure of a message within the Copilot chat.

        *   `id: string`: A unique identifier for the message.
        *   `role: 'user' | 'assistant' | 'system'`: The role of the sender.  `user` is the human user, `assistant` is the Copilot itself, and `system` is for internal messages.
        *   `content: string`: The text content of the message.
        *   `timestamp: string`: A string representation of the timestamp the message was created
        *   `citations?: { id: number; title: string; url: string; similarity?: number }[]`: Optional citations to link parts of the message content to external sources. The `similarity` property likely indicates the relevance of the citation to the message content.
        *   `toolCalls?: CopilotToolCall[]`: An optional array of `CopilotToolCall` objects, representing tools invoked by the Copilot in this message.
        *   `contentBlocks?: Array<...> `: Defines different structured blocks that compose a message, allowing more complex formatting and content types than just plain text.
        *   `fileAttachments?: MessageFileAttachment[]`: An optional array of `MessageFileAttachment` objects, representing files attached to the message.
        *   `contexts?: ChatContext[]`: An optional array of `ChatContext` objects, providing contextual information about the message.
6.  **`ChatContext` Type:**

    *   `export type ChatContext = ...`: Defines a union type representing different types of context that can be associated with a message. These contexts provide additional information about the message's origin or purpose.  Each context type has a `kind` property to identify it and a `label` for display purposes. Examples:

        *   `past_chat`: Links to a previous chat session.
        *   `workflow`: Links to a specific workflow.
        *   `blocks`: Links to specific blocks within a chat or workflow.
        *   `logs`: Links to execution logs.
        *   `knowledge`: Links to a knowledge base article.
        *   `templates`: Links to a template.
        *   `docs`: Links to documentation.
7.  **`CopilotChat` Interface:**

    *   `export interface CopilotChat { ... }`: Defines the structure of a Copilot chat session.

        *   `id: string`: A unique identifier for the chat.
        *   `title: string | null`: The title of the chat, which can be `null` if not set.
        *   `model: string`: The language model used for the chat (e.g., "gpt-4").
        *   `messages: CopilotMessage[]`: An array of `CopilotMessage` objects representing the messages in the chat.
        *   `messageCount: number`:  The total number of messages in the chat. Useful for pagination and lazy loading.
        *   `previewYaml: string | null`:  A preview of YAML data related to the chat, if applicable.
        *   `createdAt: Date`: The date the chat was created.
        *   `updatedAt: Date`: The date the chat was last updated.
8.  **`CopilotMode` Type:**

    *   `export type CopilotMode = 'ask' | 'agent'`: Defines a type for the different modes the Copilot can operate in. `"ask"` likely refers to a simple question-answering mode, while `"agent"` might represent a more proactive and automated mode.
9.  **`CopilotState` Interface:**

    *   `export interface CopilotState { ... }`: Defines the overall state of the Copilot feature.  This interface groups together all the data needed to represent the Copilot's current status and configuration.

        *   `mode: CopilotMode`: The current mode of the Copilot.
        *   `selectedModel: ...`: The specific language model currently selected for use.  The union type lists the allowed model IDs.
        *   `agentPrefetch: boolean`: A flag indicating whether data for the agent mode should be prefetched.
        *   `enabledModels: string[] | null`: An array of IDs for the language models that are currently enabled. `null` likely means the models haven't been loaded yet.
        *   `isCollapsed: boolean`: A flag indicating whether the Copilot UI is currently collapsed.
        *   `currentChat: CopilotChat | null`: The currently selected chat session, or `null` if none is selected.
        *   `chats: CopilotChat[]`: An array of all available chat sessions.
        *   `messages: CopilotMessage[]`: Array of messages currently displayed.
        *   `workflowId: string | null`: The ID of the workflow currently associated with the Copilot, if any.
        *   `checkpoints: any[]`: An array of checkpoint data, which likely represents saved states of the conversation or workflow. The use of `any[]` suggests that the exact structure of the checkpoint data is not yet defined or varies.
        *   `messageCheckpoints: Record<string, any[]>`: Checkpoints per message id.
        *   `isLoading: boolean`: A flag indicating whether the Copilot is currently loading data.
        *   `isLoadingChats: boolean`: A flag indicating whether the Copilot is currently loading chat sessions.
        *   `isLoadingCheckpoints: boolean`: A flag indicating whether checkpoints are currently being loaded.
        *   `isSendingMessage: boolean`: A flag indicating whether a message is currently being sent.
        *   `isSaving: boolean`: A flag indicating whether the chat is currently being saved.
        *   `isRevertingCheckpoint: boolean`: A flag indicating whether the Copilot is currently reverting to a previous checkpoint.
          *   `isAborting: boolean`: A flag indicating whether the current request is being aborted.
        *   `error: string | null`: An error message, if any.
        *   `saveError: string | null`: An error message related to saving, if any.
        *   `checkpointError: string | null`: An error message related to checkpoints, if any.
        *   `abortController: AbortController | null`: An `AbortController` object, used to cancel in-flight requests.
        *   `chatsLastLoadedAt: Date | null`: The last time the chats list was loaded.
        *   `chatsLoadedForWorkflow: string | null`: Workflow chats were loaded for.
        *   `revertState: { messageId: string; messageContent: string } | null`: Stores information about the message being reverted to.
        *   `inputValue: string`: The current value in the input field (where the user types messages).
        *   `planTodos: Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>`: Array of todo items for a plan.
        *    `showPlanTodos: boolean`: Flag whether to show plan todos.
        *   `toolCallsById: Record<string, CopilotToolCall>`: A map (dictionary) that allows efficient lookup of `CopilotToolCall` objects by their `id`. This is likely used during streaming responses where tool call information arrives incrementally.
        * `suppressAutoSelect?: boolean`: Flag to prevent auto selecting a chat during new chat UX.
        * `currentUserMessageId?: string | null`: Id for the current user message in flight.
        * `contextUsage`: Tracks the context usage (tokens) and percentage for sending requests to LLMs, including usage, limit, model name, and whether the token usage is determined at the start or end of the request

10. **`CopilotActions` Interface:**

    *   `export interface CopilotActions { ... }`: Defines the actions (functions) that can be performed to modify the Copilot's state. These actions provide a controlled and predictable way to update the state, ensuring consistency. The types of the parameters mirror the `CopilotState` properties.

        *   Each property of this interface is a function that takes some arguments and potentially returns a Promise (for asynchronous operations).  Examples:

            *   `setMode: (mode: CopilotMode) => void`: Sets the Copilot's mode.
            *   `setSelectedModel: (model: CopilotStore['selectedModel']) => void`: Sets the selected language model.
            *   `sendMessage: (message: string, options?: { ... }) => Promise<void>`: Sends a message. This function accepts a message string and optional configuration (e.g., whether to stream the response, file attachments, or contexts). It returns a Promise, indicating that the operation is asynchronous.
            *   `loadChats: (forceRefresh?: boolean) => Promise<void>`: Loads chats, allowing for an optional forced refresh.
            *  `clearMessages: () => void`: Clear existing messages from current copilot session.

11. **`CopilotStore` Type:**

    *   `export type CopilotStore = CopilotState & CopilotActions`: This line creates a type alias named `CopilotStore`.  It uses an intersection type (`&`) to combine the `CopilotState` and `CopilotActions` interfaces. This means that a `CopilotStore` object will have *all* the properties defined in both `CopilotState` and `CopilotActions`. This is a common pattern in state management libraries (like Redux, Zustand, or Vuex) where the "store" holds both the state data and the functions to update that state.

**Summary:**

This file defines the core types and interfaces for managing the state and behavior of a sophisticated Copilot feature within an application. It covers chat sessions, messages, tool integrations, context management, and UI-related state.  The separation of state (data) and actions (functions to modify data) promotes a structured and maintainable architecture.  The `CopilotStore` type encapsulates the complete state and all the allowed operations on that state.
