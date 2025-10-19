```typescript
'use client'

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { type CopilotChat, sendStreamingMessage } from '@/lib/copilot/api'
import type {
  BaseClientToolMetadata,
  ClientToolDisplay,
} from '@/lib/copilot/tools/client/base-tool'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { GetBlocksAndToolsClientTool } from '@/lib/copilot/tools/client/blocks/get-blocks-and-tools'
import { GetBlocksMetadataClientTool } from '@/lib/copilot/tools/client/blocks/get-blocks-metadata'
import { GetTriggerBlocksClientTool } from '@/lib/copilot/tools/client/blocks/get-trigger-blocks'
import { GetExamplesRagClientTool } from '@/lib/copilot/tools/client/examples/get-examples-rag'
import { GetOperationsExamplesClientTool } from '@/lib/copilot/tools/client/examples/get-operations-examples'
import { GetTriggerExamplesClientTool } from '@/lib/copilot/tools/client/examples/get-trigger-examples'
import { ListGDriveFilesClientTool } from '@/lib/copilot/tools/client/gdrive/list-files'
import { ReadGDriveFileClientTool } from '@/lib/copilot/tools/client/gdrive/read-file'
import { GDriveRequestAccessClientTool } from '@/lib/copilot/tools/client/google/gdrive-request-access'
import {
  getClientTool,
  registerClientTool,
  registerToolStateSync,
} from '@/lib/copilot/tools/client/manager'
import { CheckoffTodoClientTool } from '@/lib/copilot/tools/client/other/checkoff-todo'
import { MakeApiRequestClientTool } from '@/lib/copilot/tools/client/other/make-api-request'
import { MarkTodoInProgressClientTool } from '@/lib/copilot/tools/client/other/mark-todo-in-progress'
import { OAuthRequestAccessClientTool } from '@/lib/copilot/tools/client/other/oauth-request-access'
import { PlanClientTool } from '@/lib/copilot/tools/client/other/plan'
import { SearchDocumentationClientTool } from '@/lib/copilot/tools/client/other/search-documentation'
import { SearchOnlineClientTool } from '@/lib/copilot/tools/client/other/search-online'
import { createExecutionContext, getTool } from '@/lib/copilot/tools/client/registry'
import { GetEnvironmentVariablesClientTool } from '@/lib/copilot/tools/client/user/get-environment-variables'
import { GetOAuthCredentialsClientTool } from '@/lib/copilot/tools/client/user/get-oauth-credentials'
import { SetEnvironmentVariablesClientTool } from '@/lib/copilot/tools/client/user/set-environment-variables'
import { EditWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/edit-workflow'
import { GetGlobalWorkflowVariablesClientTool } from '@/lib/copilot/tools/client/workflow/get-global-workflow-variables'
import { GetUserWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/get-user-workflow'
import { GetWorkflowConsoleClientTool } from '@/lib/copilot/tools/client/workflow/get-workflow-console'
import { GetWorkflowFromNameClientTool } from '@/lib/copilot/tools/client/workflow/get-workflow-from-name'
import { ListUserWorkflowsClientTool } from '@/lib/copilot/tools/client/workflow/list-user-workflows'
import { RunWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/run-workflow'
import { SetGlobalWorkflowVariablesClientTool } from '@/lib/copilot/tools/client/workflow/set-global-workflow-variables'
import { createLogger } from '@/lib/logs/console/logger'
import type {
  ChatContext,
  CopilotMessage,
  CopilotStore,
  CopilotToolCall,
  MessageFileAttachment,
} from '@/stores/copilot/types'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('CopilotStore')

// On module load, clear any lingering diff preview (fresh page refresh)
try {
  const diffStore = useWorkflowDiffStore.getState()
  if (diffStore?.isShowingDiff || diffStore?.diffWorkflow) {
    diffStore.clearDiff()
  }
} catch {}

// Known class-based client tools: map tool name -> instantiator
const CLIENT_TOOL_INSTANTIATORS: Record<string, (id: string) => any> = {
  run_workflow: (id) => new RunWorkflowClientTool(id),
  get_workflow_console: (id) => new GetWorkflowConsoleClientTool(id),
  get_blocks_and_tools: (id) => new GetBlocksAndToolsClientTool(id),
  get_blocks_metadata: (id) => new GetBlocksMetadataClientTool(id),
  get_trigger_blocks: (id) => new GetTriggerBlocksClientTool(id),
  search_online: (id) => new SearchOnlineClientTool(id),
  search_documentation: (id) => new SearchDocumentationClientTool(id),
  get_environment_variables: (id) => new GetEnvironmentVariablesClientTool(id),
  set_environment_variables: (id) => new SetEnvironmentVariablesClientTool(id),
  list_gdrive_files: (id) => new ListGDriveFilesClientTool(id),
  read_gdrive_file: (id) => new ReadGDriveFileClientTool(id),
  get_oauth_credentials: (id) => new GetOAuthCredentialsClientTool(id),
  make_api_request: (id) => new MakeApiRequestClientTool(id),
  plan: (id) => new PlanClientTool(id),
  checkoff_todo: (id) => new CheckoffTodoClientTool(id),
  mark_todo_in_progress: (id) => new MarkTodoInProgressClientTool(id),
  gdrive_request_access: (id) => new GDriveRequestAccessClientTool(id),
  oauth_request_access: (id) => new OAuthRequestAccessClientTool(id),
  edit_workflow: (id) => new EditWorkflowClientTool(id),
  get_user_workflow: (id) => new GetUserWorkflowClientTool(id),
  list_user_workflows: (id) => new ListUserWorkflowsClientTool(id),
  get_workflow_from_name: (id) => new GetWorkflowFromNameClientTool(id),
  get_global_workflow_variables: (id) => new GetGlobalWorkflowVariablesClientTool(id),
  set_global_workflow_variables: (id) => new SetGlobalWorkflowVariablesClientTool(id),
  get_trigger_examples: (id) => new GetTriggerExamplesClientTool(id),
  get_examples_rag: (id) => new GetExamplesRagClientTool(id),
  get_operations_examples: (id) => new GetOperationsExamplesClientTool(id),
}

// Read-only static metadata for class-based tools (no instances)
export const CLASS_TOOL_METADATA: Record<string, BaseClientToolMetadata | undefined> = {
  run_workflow: (RunWorkflowClientTool as any)?.metadata,
  get_workflow_console: (GetWorkflowConsoleClientTool as any)?.metadata,
  get_blocks_and_tools: (GetBlocksAndToolsClientTool as any)?.metadata,
  get_blocks_metadata: (GetBlocksMetadataClientTool as any)?.metadata,
  get_trigger_blocks: (GetTriggerBlocksClientTool as any)?.metadata,
  search_online: (SearchOnlineClientTool as any)?.metadata,
  search_documentation: (SearchDocumentationClientTool as any)?.metadata,
  get_environment_variables: (GetEnvironmentVariablesClientTool as any)?.metadata,
  set_environment_variables: (SetEnvironmentVariablesClientTool as any)?.metadata,
  list_gdrive_files: (ListGDriveFilesClientTool as any)?.metadata,
  read_gdrive_file: (ReadGDriveFileClientTool as any)?.metadata,
  get_oauth_credentials: (GetOAuthCredentialsClientTool as any)?.metadata,
  make_api_request: (MakeApiRequestClientTool as any)?.metadata,
  plan: (PlanClientTool as any)?.metadata,
  checkoff_todo: (CheckoffTodoClientTool as any)?.metadata,
  mark_todo_in_progress: (MarkTodoInProgressClientTool as any)?.metadata,
  gdrive_request_access: (GDriveRequestAccessClientTool as any)?.metadata,
  edit_workflow: (EditWorkflowClientTool as any)?.metadata,
  get_user_workflow: (GetUserWorkflowClientTool as any)?.metadata,
  list_user_workflows: (ListUserWorkflowsClientTool as any)?.metadata,
  get_workflow_from_name: (GetWorkflowFromNameClientTool as any)?.metadata,
  get_global_workflow_variables: (GetGlobalWorkflowVariablesClientTool as any)?.metadata,
  set_global_workflow_variables: (SetGlobalWorkflowVariablesClientTool as any)?.metadata,
  get_trigger_examples: (GetTriggerExamplesClientTool as any)?.metadata,
  get_examples_rag: (GetExamplesRagClientTool as any)?.metadata,
  oauth_request_access: (OAuthRequestAccessClientTool as any)?.metadata,
  get_operations_examples: (GetOperationsExamplesClientTool as any)?.metadata,
}

function ensureClientToolInstance(toolName: string | undefined, toolCallId: string | undefined) {
  try {
    if (!toolName || !toolCallId) return
    if (getClientTool(toolCallId)) return
    const make = CLIENT_TOOL_INSTANTIATORS[toolName]
    if (make) {
      const inst = make(toolCallId)
      registerClientTool(toolCallId, inst)
    }
  } catch {}
}

// Constants
const TEXT_BLOCK_TYPE = 'text'
const THINKING_BLOCK_TYPE = 'thinking'
const DATA_PREFIX = 'data: '
const DATA_PREFIX_LENGTH = 6

// Resolve display text/icon for a tool based on its state
function resolveToolDisplay(
  toolName: string | undefined,
  state: ClientToolCallState,
  toolCallId?: string,
  params?: Record<string, any>
): ClientToolDisplay | undefined {
  try {
    if (!toolName) return undefined
    const def = getTool(toolName) as any
    const meta = def?.metadata?.displayNames || CLASS_TOOL_METADATA[toolName]?.displayNames || {}
    // Exact state first
    const ds = meta?.[state]
    if (ds?.text || ds?.icon) return { text: ds.text, icon: ds.icon }
    // Fallback order (prefer pre-execution states for unknown states like pending)
    const fallbackOrder: ClientToolCallState[] = [
      (ClientToolCallState as any).generating,
      (ClientToolCallState as any).executing,
      (ClientToolCallState as any).review,
      (ClientToolCallState as any).success,
      (ClientToolCallState as any).error,
      (ClientToolCallState as any).rejected,
    ]
    for (const key of fallbackOrder) {
      const cand = meta?.[key]
      if (cand?.text || cand?.icon) return { text: cand.text, icon: cand.icon }
    }
  } catch {}
  // Humanized fallback as last resort
  try {
    if (toolName) {
      const text = toolName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      return { text, icon: undefined as any }
    }
  } catch {}
  return undefined
}

// Helper: check if a tool state is rejected
function isRejectedState(state: any): boolean {
  try {
    return state === 'rejected' || state === (ClientToolCallState as any).rejected
  } catch {
    return state === 'rejected'
  }
}

// Helper: check if a tool state is review (terminal for build/edit preview)
function isReviewState(state: any): boolean {
  try {
    return state === 'review' || state === (ClientToolCallState as any).review
  } catch {
    return state === 'review'
  }
}

// Helper: check if a tool state is background (terminal)
function isBackgroundState(state: any): boolean {
  try {
    return state === 'background' || state === (ClientToolCallState as any).background
  } catch {
    return state === 'background'
  }
}

// Helper: abort all in-progress client tools and update inline blocks
function abortAllInProgressTools(set: any, get: () => CopilotStore) {
  try {
    const { toolCallsById, messages } = get()
    const updatedMap = { ...toolCallsById }
    const abortedIds = new Set<string>()
    for (const [id, tc] of Object.entries(toolCallsById)) {
      const st = tc.state as any
      // Abort anything not already terminal success/error/rejected/aborted
      const isTerminal =
        st === ClientToolCallState.success ||
        st === ClientToolCallState.error ||
        st === ClientToolCallState.rejected ||
        st === ClientToolCallState.aborted
      if (!isTerminal || isReviewState(st)) {
        abortedIds.add(id)
        updatedMap[id] = {
          ...tc,
          state: ClientToolCallState.aborted,
          display: resolveToolDisplay(tc.name, ClientToolCallState.aborted, id, (tc as any).params),
        }
      }
    }
    if (abortedIds.size > 0) {
      set({ toolCallsById: updatedMap })
      // Update inline blocks in-place for the latest assistant message only (most relevant)
      set((s: CopilotStore) => {
        const msgs = [...s.messages]
        for (let mi = msgs.length - 1; mi >= 0; mi--) {
          const m = msgs[mi] as any
          if (m.role !== 'assistant' || !Array.isArray(m.contentBlocks)) continue
          let changed = false
          const blocks = m.contentBlocks.map((b: any) => {
            if (b?.type === 'tool_call' && b.toolCall?.id && abortedIds.has(b.toolCall.id)) {
              changed = true
              const prev = b.toolCall
              return {
                ...b,
                toolCall: {
                  ...prev,
                  state: ClientToolCallState.aborted,
                  display: resolveToolDisplay(
                    prev?.name,
                    ClientToolCallState.aborted,
                    prev?.id,
                    prev?.params
                  ),
                },
              }
            }
            return b
          })
          if (changed) {
            msgs[mi] = { ...m, contentBlocks: blocks }
            break
          }
        }
        return { messages: msgs }
      })
    }
  } catch {}
}

// Normalize loaded messages so assistant messages render correctly from DB
function normalizeMessagesForUI(messages: CopilotMessage[]): CopilotMessage[] {
  try {
    return messages.map((message) => {
      if (message.role !== 'assistant') {
        // For user messages (and others), restore contexts from a saved contexts block
        if (Array.isArray(message.contentBlocks) && message.contentBlocks.length > 0) {
          const ctxBlock = (message.contentBlocks as any[]).find((b: any) => b?.type === 'contexts')
          if (ctxBlock && Array.isArray((ctxBlock as any).contexts)) {
            return {
              ...message,
              contexts: (ctxBlock as any).contexts,
            }
          }
        }
        return message
      }

      // Use existing contentBlocks ordering if present; otherwise only render text content
      const blocks: any[] = Array.isArray(message.contentBlocks)
        ? (message.contentBlocks as any[]).map((b: any) =>
            b?.type === 'tool_call' && b.toolCall
              ? {
                  ...b,
                  toolCall: {
                    ...b.toolCall,
                    state:
                      isRejectedState(b.toolCall?.state) ||
                      isReviewState(b.toolCall?.state) ||
                      isBackgroundState(b.toolCall?.state) ||
                      b.toolCall?.state === ClientToolCallState.success ||
                      b.toolCall?.state === ClientToolCallState.error ||
                      b.toolCall?.state === ClientToolCallState.aborted
                        ? b.toolCall.state
                        : ClientToolCallState.rejected,
                    display: resolveToolDisplay(
                      b.toolCall?.name,
                      (isRejectedState(b.toolCall?.state) ||
                      isReviewState(b.toolCall?.state) ||
                      isBackgroundState(b.toolCall?.state) ||
                      b.toolCall?.state === ClientToolCallState.success ||
                      b.toolCall?.state === ClientToolCallState.error ||
                      b.toolCall?.state === ClientToolCallState.aborted
                        ? (b.toolCall?.state as any)
                        : ClientToolCallState.rejected) as any,
                      b.toolCall?.id,
                      b.toolCall?.params
                    ),
                  },
                }
              : b
          )
        : []

      // Prepare toolCalls with display for non-block UI components, but do not fabricate blocks
      const updatedToolCalls = Array.isArray((message as any).toolCalls)
        ? (message as any).toolCalls.map((tc: any) => ({
            ...tc,
            state:
              isRejectedState(tc?.state) ||
              isReviewState(tc?.state) ||
              isBackgroundState(tc?.state) ||
              tc?.state === ClientToolCallState.success ||
              tc?.state === ClientToolCallState.error ||
              tc?.state === ClientToolCallState.aborted
                ? tc.state
                : ClientToolCallState.rejected,
            display: resolveToolDisplay(
              tc?.name,
              (isRejectedState(tc?.state) ||
              isReviewState(tc?.state) ||
              isBackgroundState(tc?.state) ||
              tc?.state === ClientToolCallState.success ||
              tc?.state === ClientToolCallState.error ||
              tc?.state === ClientToolCallState.aborted
                ? (tc?.state as any)
                : ClientToolCallState.rejected) as any,
              tc?.id,
              tc?.params
            ),
          }))
        : (message as any).toolCalls

      return {
        ...message,
        ...(updatedToolCalls && { toolCalls: updatedToolCalls }),
        ...(blocks.length > 0
          ? { contentBlocks: blocks }
          : message.content?.trim()
            ? { contentBlocks: [{ type: 'text', content: message.content, timestamp: Date.now() }] }
            : {}),
      }
    })
  } catch {
    return messages
  }
}

// Simple object pool for content blocks
class ObjectPool<T> {
  private pool: T[] = []
  private createFn: () => T
  private resetFn: (obj: T) => void

  constructor(createFn: () => T, resetFn: (obj: T) => void, initialSize = 5) {
    this.createFn = createFn
    this.resetFn = resetFn
    for (let i = 0; i < initialSize; i++) this.pool.push(createFn())
  }
  get(): T {
    const obj = this.pool.pop()
    if (obj) {
      this.resetFn(obj)
      return obj
    }
    return this.createFn()
  }
  release(obj: T): void {
    if (this.pool.length < 20) this.pool.push(obj)
  }
}

const contentBlockPool = new ObjectPool(
  () => ({ type: '', content: '', timestamp: 0, toolCall: null as any }),
  (obj) => {
    obj.type = ''
    obj.content = ''
    obj.timestamp = 0
    ;(obj as any).toolCall = null
    ;(obj as any).startTime = undefined
    ;(obj as any).duration = undefined
  }
)

// Efficient string builder
class StringBuilder {
  private parts: string[] = []
  private length = 0
  append(str: string): void {
    this.parts.push(str)
    this.length += str.length
  }
  toString(): string {
    const result = this.parts.join('')
    this.clear()
    return result
  }
  clear(): void {
    this.parts.length = 0
    this.length = 0
  }
  get size(): number {
    return this.length
  }
}

// Helpers
function createUserMessage(
  content: string,
  fileAttachments?: MessageFileAttachment[],
  contexts?: ChatContext[]
): CopilotMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
    ...(fileAttachments && fileAttachments.length > 0 && { fileAttachments }),
    ...(contexts && contexts.length > 0 && { contexts }),
    ...(contexts &&
      contexts.length > 0 && {
        contentBlocks: [
          { type: 'contexts', contexts: contexts as any, timestamp: Date.now() },
        ] as any,
      }),
  }
}

function createStreamingMessage(): CopilotMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
  }
}

function createErrorMessage(messageId: string, content: string): CopilotMessage {
  return {
    id: messageId,
    role: 'assistant',
    content,
    timestamp: new Date().toISOString(),
    contentBlocks: [
      {
        type: 'text',
        content,
        timestamp: Date.now(),
      },
    ],
  }
}

function validateMessagesForLLM(messages: CopilotMessage[]): any[] {
  return messages
    .map((msg) => {
      // Build content from blocks if assistant content is empty (exclude thinking)
      let content = msg.content || ''
      if (msg.role === 'assistant' && !content.trim() && msg.contentBlocks?.length) {
        content = msg.contentBlocks
          .filter((b: any) => b?.type === 'text')
          .map((b: any) => String(b.content || ''))
          .join('')
          .trim()
      }

      // Strip thinking tags from content
      if (content) {
        content = content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim()
      }

      return {
        id: msg.id,
        role: msg.role,
        content,
        timestamp: msg.timestamp,
        ...(Array.isArray((msg as any).toolCalls) &&
          (msg as any).toolCalls.length > 0 && {
            toolCalls: (msg as any).toolCalls,
          }),
        ...(Array.isArray(msg.contentBlocks) &&
          msg.contentBlocks.length > 0 && {
            // Persist full contentBlocks including thinking so history can render it
            contentBlocks: msg.contentBlocks,
          }),
        ...(msg.fileAttachments &&
          msg.fileAttachments.length > 0 && {
            fileAttachments: msg.fileAttachments,
          }),
        ...((msg as any).contexts &&
          Array.isArray((msg as any).contexts) && {
            contexts: (msg as any).contexts,
          }),
      }
    })
    .filter((m) => {
      if (m.role === 'assistant') {
        const hasText = typeof m.content === 'string' && m.content.trim().length > 0
        const hasTools = Array.isArray((m as any).toolCalls) && (m as any).toolCalls.length > 0
        const hasBlocks =
          Array.isArray((m as any).contentBlocks) && (m as any).contentBlocks.length > 0
        return hasText || hasTools || hasBlocks
      }
      return true
    })
}

// Streaming context and SSE parsing
interface StreamingContext {
  messageId: string
  accumulatedContent: StringBuilder
  contentBlocks: any[]
  currentTextBlock: any | null
  isInThinkingBlock: boolean
  currentThinkingBlock: any | null
  pendingContent: string
  newChatId?: string
  doneEventCount: number
  streamComplete?: boolean
}

type SSEHandler = (
  data: any,
  context: StreamingContext,
  get: () => CopilotStore,
  set: any
) => Promise<void> | void

const sseHandlers: Record<string, SSEHandler> = {
  chat_id: async (data, context, get) => {
    context.newChatId = data.chatId
    const { currentChat } = get()
    if (!currentChat && context.newChatId) {
      await get().handleNewChatCreation(context.newChatId)
    }
  },
  tool_result: (data, context, get, set) => {
    try {
      const toolCallId: string | undefined = data?.toolCallId || data?.data?.id
      const success: boolean | undefined = data?.success
      const failedDependency: boolean = data?.failedDependency === true
      const skipped: boolean = data?.result?.skipped === true
      if (!toolCallId) return
      const { toolCallsById } = get()
      const current = toolCallsById[toolCallId]
      if (current) {
        if (
          isRejectedState(current.state) ||
          isReviewState(current.state) ||
          isBackgroundState(current.state)
        ) {
          // Preserve terminal review/rejected state; do not override
          return
        }
        const targetState = success
          ? ClientToolCallState.success
          : failedDependency || skipped
            ? ClientToolCallState.rejected
            : ClientToolCallState.error
        const updatedMap = { ...toolCallsById }
        updatedMap[toolCallId] = {
          ...current,
          state: targetState,
          display: resolveToolDisplay(
            current.name,
            targetState,
            current.id,
            (current as any).params
          ),
        }
        set({ toolCallsById: updatedMap })

        // If checkoff_todo succeeded, mark todo as completed in planTodos
        if (targetState === ClientToolCallState.success && current.name === 'checkoff_todo') {
          try {
            const result = data?.result || data?.data?.result || {}
            const input = (current as any).params || (current as any).input || {}
            const todoId = input.id || input.todoId || result.id || result.todoId
            if (todoId) {
              get().updatePlanTodoStatus(todoId, 'completed')
            }
          } catch {}
        }

        // If mark_todo_in_progress succeeded, set todo executing in planTodos
        if (
          targetState === ClientToolCallState.success &&
          current.name === 'mark_todo_in_progress'
        ) {
          try {
            const result = data?.result || data?.data?.result || {}
            const input = (current as any).params || (current as any).input || {}
            const todoId = input.id || input.todoId || result.id || result.todoId
            if (todoId) {
              get().updatePlanTodoStatus(todoId, 'executing')
            }
          } catch {}
        }
      }

      // Update inline content block state
      for (let i = 0; i < context.contentBlocks.length; i++) {
        const b = context.contentBlocks[i] as any
        if (b?.type === 'tool_call' && b?.toolCall?.id === toolCallId) {
          if (
            isRejectedState(b.toolCall?.state) ||
            isReviewState(b.toolCall?.state) ||
            isBackgroundState(b.toolCall?.state)
          )
            break
          const targetState = success
            ? ClientToolCallState.success
            : failedDependency || skipped
              ? ClientToolCallState.rejected
              : ClientToolCallState.error
          context.contentBlocks[i] = {
            ...b,
            toolCall: {
              ...b.toolCall,
              state: targetState,
              display: resolveToolDisplay(
                b.toolCall?.name,
                targetState,
                toolCallId,
                b.toolCall?.params
              ),
            },
          }
          break
        }
      }
      updateStreamingMessage(set, context)
    } catch {}
  },
  tool_error: (data, context, get, set) => {
    try {
      const toolCallId: string | undefined = data?.toolCallId || data?.data?.id
      const failedDependency: boolean = data?.failedDependency === true
      if (!toolCallId) return
      const { toolCallsById } = get()
      const current = toolCallsById[toolCallId]
      if (current) {
        if (
          isRejectedState(current.state) ||
          isReviewState(current.state) ||
          isBackgroundState(current.state)
        ) {
          return
        }
        const targetState = failedDependency
          ? ClientToolCallState.rejected
          : ClientToolCallState.error
        const updatedMap = { ...toolCallsById }
        updatedMap[toolCallId] = {
          ...current,
          state: targetState,
          display: resolveToolDisplay(
            current.name,
            targetState,
            current.id,
            (current as any).params
          ),
        }
        set({ toolCallsById: updatedMap })
      }
      for (let i = 0; i < context.contentBlocks.length; i++) {
        const b = context.contentBlocks[i] as any
        if (b?.type === 'tool_call' && b?.toolCall?.id === toolCallId) {
          if (
            isRejectedState(b.toolCall?.state) ||
            isReviewState(b.toolCall?.state) ||
            isBackgroundState(b.toolCall?.state)
          )
            break
          const targetState = failedDependency
            ? ClientToolCallState.rejected
            : ClientToolCallState.error
          context.contentBlocks[i] = {
            ...b,
            toolCall: {
              ...b.toolCall,
              state: targetState,
              display: resolveToolDisplay(
                b.toolCall?.name,
                targetState,
                toolCallId,
                b.toolCall?.params
              ),
            },
          }
          break
        }
      }
      updateStreamingMessage(set, context)
    } catch {}
  },
  tool_generating: (data, context, get, set) => {
    const { toolCallId, toolName } = data
    if (!toolCallId || !toolName) return
    const { toolCallsById } = get()

    // Ensure class-based client tool instances are registered (for interrupts/display)
    ensureClientToolInstance(toolName, toolCallId)

    if (!toolCallsById[toolCallId]) {
      // Show as pending until we receive full tool_call (with arguments) to decide execution
      const initialState = ClientToolCallState.pending
      const tc: CopilotToolCall = {
        id: toolCallId,
        name: toolName,
        state: initialState,
        display: resolveToolDisplay(toolName, initialState, toolCallId),
      }
      const updated = { ...toolCallsById, [toolCallId]: tc }
      set({ toolCallsById: updated })
      logger.info('[toolCallsById] map updated', updated)

      // Add/refresh inline content block
      let found = false
      for (let i = 0; i < context.contentBlocks.length; i++) {
        const b = context.contentBlocks[i] as any
        if (b.type === 'tool_call' && b.toolCall?.id === toolCallId) {
          context.contentBlocks[i] = { ...b, toolCall: tc }
          found = true
          break
        }
      }
      if (!found)
        context.contentBlocks.push({ type: 'tool_call', toolCall: tc, timestamp: Date.now() })
      updateStreamingMessage(set, context)
    }
  },
  tool_call: (data, context, get, set) => {
    const toolData = data?.data || {}
    const id: string | undefined = toolData.id || data?.toolCallId
    const name: string | undefined = toolData.name || data?.toolName
    if (!id) return
    const args = toolData.arguments
    const { toolCallsById } = get()

    // Ensure class-based client tool instances are registered (for interrupts/display)
    ensureClientToolInstance(name, id)

    const existing = toolCallsById[id]
    const next: CopilotToolCall = existing
      ? {
          ...existing,
          state: ClientToolCallState.pending,
          ...(args ? { params: args } : {}),
          display: resolveToolDisplay(name, ClientToolCallState.pending, id, args),
        }
      : {
          id,
          name: name || 'unknown_tool',
          state: ClientToolCallState.pending,
          ...(args ? { params: args } : {}),
          display: resolveToolDisplay(name, ClientToolCallState.pending, id, args),
        }
    const updated = { ...toolCallsById, [id]: next }
    set({ toolCallsById: updated })
    logger.info('[toolCallsById] → pending', { id, name, params: args })

    // Ensure an inline content block exists/updated for this tool call
    let found = false
    for (let i = 0; i < context.contentBlocks.length; i++) {
      const b = context.contentBlocks[