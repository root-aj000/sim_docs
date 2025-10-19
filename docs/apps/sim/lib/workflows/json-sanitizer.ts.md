```typescript
import type { Edge } from 'reactflow'
import type { BlockState, Loop, Parallel, WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * Sanitized workflow state for copilot (removes all UI-specific data)
 * Connections are embedded in blocks for consistency with operations format
 * Loops and parallels use nested structure - no separate loops/parallels objects
 */
export interface CopilotWorkflowState {
  blocks: Record<string, CopilotBlockState>
}

/**
 * Block state for copilot (no positions, no UI dimensions, no redundant IDs)
 * Connections are embedded here instead of separate edges array
 * Loops and parallels have nested structure for clarity
 */
export interface CopilotBlockState {
  type: string
  name: string
  inputs?: Record<string, string | number | string[][] | object>
  outputs: BlockState['outputs']
  connections?: Record<string, string | string[]>
  nestedNodes?: Record<string, CopilotBlockState>
  enabled: boolean
  advancedMode?: boolean
  triggerMode?: boolean
}

/**
 * Edge state for copilot (only semantic connection data)
 */
export interface CopilotEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

/**
 * Export workflow state (includes positions but removes secrets)
 */
export interface ExportWorkflowState {
  version: string
  exportedAt: string
  state: {
    blocks: Record<string, BlockState>
    edges: Edge[]
    loops: Record<string, Loop>
    parallels: Record<string, Parallel>
  }
}

/**
 * Check if a subblock contains sensitive/secret data
 */
function isSensitiveSubBlock(key: string, subBlock: BlockState['subBlocks'][string]): boolean {
  // Check if it's an OAuth input type
  if (subBlock.type === 'oauth-input') {
    return true
  }

  // Check if the field name suggests it contains sensitive data
  const sensitivePattern = /credential|oauth|api[_-]?key|token|secret|auth|password|bearer/i
  if (sensitivePattern.test(key)) {
    return true
  }

  // Check if the value itself looks like a secret (but not environment variable references)
  if (typeof subBlock.value === 'string' && subBlock.value.length > 0) {
    // Don't sanitize environment variable references like {{VAR_NAME}}
    if (subBlock.value.startsWith('{{') && subBlock.value.endsWith('}}')) {
      return false
    }

    // If it matches sensitive patterns in the value, it's likely a hardcoded secret
    if (sensitivePattern.test(subBlock.value)) {
      return true
    }
  }

  return false
}

/**
 * Sanitize condition blocks by removing UI-specific metadata
 * Returns cleaned JSON string (not parsed array)
 */
function sanitizeConditions(conditionsJson: string): string {
  try {
    const conditions = JSON.parse(conditionsJson)
    if (!Array.isArray(conditions)) return conditionsJson

    // Keep only id, title, and value - remove UI state
    const cleaned = conditions.map((cond: any) => ({
      id: cond.id,
      title: cond.title,
      value: cond.value || '',
    }))

    return JSON.stringify(cleaned)
  } catch {
    return conditionsJson
  }
}

/**
 * Sanitize tools array by removing UI state and redundant fields
 */
function sanitizeTools(tools: any[]): any[] {
  return tools.map((tool) => {
    if (tool.type === 'custom-tool') {
      const sanitized: any = {
        type: tool.type,
        title: tool.title,
        toolId: tool.toolId,
        usageControl: tool.usageControl,
      }

      if (tool.schema?.function) {
        sanitized.schema = {
          function: {
            description: tool.schema.function.description,
            parameters: tool.schema.function.parameters,
          },
        }
      }

      if (tool.code) {
        sanitized.code = tool.code
      }

      return sanitized
    }

    const { isExpanded, ...cleanTool } = tool
    return cleanTool
  })
}

/**
 * Sanitize subblocks by removing null values, secrets, and simplifying structure
 * Maps each subblock key directly to its value instead of the full object
 * Note: responseFormat is kept as an object for better copilot understanding
 */
function sanitizeSubBlocks(
  subBlocks: BlockState['subBlocks']
): Record<string, string | number | string[][] | object> {
  const sanitized: Record<string, string | number | string[][] | object> = {}

  Object.entries(subBlocks).forEach(([key, subBlock]) => {
    // Special handling for responseFormat - process BEFORE null check
    // so we can detect when it's added/removed
    if (key === 'responseFormat') {
      try {
        // Handle null/undefined - skip if no value
        if (subBlock.value === null || subBlock.value === undefined) {
          return
        }

        let obj = subBlock.value

        // Handle string values - parse them first
        if (typeof subBlock.value === 'string') {
          const trimmed = subBlock.value.trim()
          if (!trimmed) {
            // Empty string - skip this field
            return
          }
          obj = JSON.parse(trimmed)
        }

        // Handle object values - normalize keys and keep as object for copilot
        if (obj && typeof obj === 'object') {
          // Sort keys recursively for consistent comparison
          const sortKeys = (item: any): any => {
            if (Array.isArray(item)) {
              return item.map(sortKeys)
            }
            if (item !== null && typeof item === 'object') {
              return Object.keys(item)
                .sort()
                .reduce((result: any, key: string) => {
                  result[key] = sortKeys(item[key])
                  return result
                }, {})
            }
            return item
          }

          // Keep as object (not stringified) for better copilot understanding
          const normalized = sortKeys(obj)
          sanitized[key] = normalized
          return
        }

        // If we get here, obj is not an object (maybe null or primitive) - skip it
        return
      } catch (error) {
        // Invalid JSON - skip this field to avoid crashes
        return
      }
    }

    // Skip null/undefined values for other fields
    if (subBlock.value === null || subBlock.value === undefined) {
      return
    }

    // For sensitive fields, either omit or replace with placeholder
    if (isSensitiveSubBlock(key, subBlock)) {
      // If it's an environment variable reference, keep it
      if (
        typeof subBlock.value === 'string' &&
        subBlock.value.startsWith('{{') &&
        subBlock.value.endsWith('}}')
      ) {
        sanitized[key] = subBlock.value
      }
      // Otherwise omit the sensitive value entirely
      return
    }

    // Special handling for condition-input type - clean UI metadata
    if (subBlock.type === 'condition-input' && typeof subBlock.value === 'string') {
      const cleanedConditions: string = sanitizeConditions(subBlock.value)
      sanitized[key] = cleanedConditions
      return
    }

    if (key === 'tools' && Array.isArray(subBlock.value)) {
      sanitized[key] = sanitizeTools(subBlock.value)
      return
    }

    // Skip knowledge base tag filters and document tags (workspace-specific data)
    if (key === 'tagFilters' || key === 'documentTags') {
      return
    }

    sanitized[key] = subBlock.value
  })

  return sanitized
}

/**
 * Extract connections for a block from edges and format as operations-style connections
 */
function extractConnectionsForBlock(
  blockId: string,
  edges: WorkflowState['edges']
): Record<string, string | string[]> | undefined {
  const connections: Record<string, string[]> = {}

  // Find all outgoing edges from this block
  const outgoingEdges = edges.filter((edge) => edge.source === blockId)

  if (outgoingEdges.length === 0) {
    return undefined
  }

  // Group by source handle
  for (const edge of outgoingEdges) {
    const handle = edge.sourceHandle || 'source'

    if (!connections[handle]) {
      connections[handle] = []
    }

    connections[handle].push(edge.target)
  }

  // Simplify single-element arrays to just the string
  const simplified: Record<string, string | string[]> = {}
  for (const [handle, targets] of Object.entries(connections)) {
    simplified[handle] = targets.length === 1 ? targets[0] : targets
  }

  return simplified
}

/**
 * Sanitize workflow state for copilot by removing all UI-specific data
 * Creates nested structure for loops/parallels with their child blocks inside
 */
export function sanitizeForCopilot(state: WorkflowState): CopilotWorkflowState {
  const sanitizedBlocks: Record<string, CopilotBlockState> = {}
  const processedBlocks = new Set<string>()

  // Helper to find child blocks of a parent (loop/parallel container)
  const findChildBlocks = (parentId: string): string[] => {
    return Object.keys(state.blocks).filter(
      (blockId) => state.blocks[blockId].data?.parentId === parentId
    )
  }

  // Helper to recursively sanitize a block and its children
  const sanitizeBlock = (blockId: string, block: BlockState): CopilotBlockState => {
    const connections = extractConnectionsForBlock(blockId, state.edges)

    // For loop/parallel blocks, extract config from block.data instead of subBlocks
    let inputs: Record<string, string | number | string[][] | object>

    if (block.type === 'loop' || block.type === 'parallel') {
      // Extract configuration from block.data
      const loopInputs: Record<string, string | number | string[][] | object> = {}
      if (block.data?.loopType) loopInputs.loopType = block.data.loopType
      if (block.data?.count !== undefined) loopInputs.iterations = block.data.count
      if (block.data?.collection !== undefined) loopInputs.collection = block.data.collection
      if (block.data?.parallelType) loopInputs.parallelType = block.data.parallelType
      inputs = loopInputs
    } else {
      // For regular blocks, sanitize subBlocks
      inputs = sanitizeSubBlocks(block.subBlocks)
    }

    // Check if this is a loop or parallel (has children)
    const childBlockIds = findChildBlocks(blockId)
    const nestedNodes: Record<string, CopilotBlockState> = {}

    if (childBlockIds.length > 0) {
      // Recursively sanitize child blocks
      childBlockIds.forEach((childId) => {
        const childBlock = state.blocks[childId]
        if (childBlock) {
          nestedNodes[childId] = sanitizeBlock(childId, childBlock)
          processedBlocks.add(childId)
        }
      })
    }

    const result: CopilotBlockState = {
      type: block.type,
      name: block.name,
      outputs: block.outputs,
      enabled: block.enabled,
    }

    if (Object.keys(inputs).length > 0) result.inputs = inputs
    if (connections) result.connections = connections
    if (Object.keys(nestedNodes).length > 0) result.nestedNodes = nestedNodes
    if (block.advancedMode !== undefined) result.advancedMode = block.advancedMode
    if (block.triggerMode !== undefined) result.triggerMode = block.triggerMode

    return result
  }

  // Process only root-level blocks (those without a parent)
  Object.entries(state.blocks).forEach(([blockId, block]) => {
    // Skip if already processed as a child
    if (processedBlocks.has(blockId)) return

    // Skip if it has a parent (it will be processed as nested)
    if (block.data?.parentId) return

    sanitizedBlocks[blockId] = sanitizeBlock(blockId, block)
  })

  return {
    blocks: sanitizedBlocks,
  }
}

/**
 * Sanitize workflow state for export by removing secrets but keeping positions
 * Users need positions to restore the visual layout when importing
 */
export function sanitizeForExport(state: WorkflowState): ExportWorkflowState {
  // Deep clone to avoid mutating original state
  const clonedState = JSON.parse(
    JSON.stringify({
      blocks: state.blocks,
      edges: state.edges,
      loops: state.loops || {},
      parallels: state.parallels || {},
    })
  )

  // Remove sensitive data from subblocks
  Object.values(clonedState.blocks).forEach((block: any) => {
    if (block.subBlocks) {
      Object.entries(block.subBlocks).forEach(([key, subBlock]: [string, any]) => {
        // Clear OAuth credentials and API keys based on field name only
        if (
          /credential|oauth|api[_-]?key|token|secret|auth|password|bearer/i.test(key) ||
          subBlock.type === 'oauth-input'
        ) {
          subBlock.value = ''
        }
        // Remove knowledge base tag filters and document tags (workspace-specific data)
        if (key === 'tagFilters' || key === 'documentTags') {
          subBlock.value = ''
        }
      })
    }

    // Also clear from data field if present
    if (block.data) {
      Object.entries(block.data).forEach(([key, value]: [string, any]) => {
        if (/credential|oauth|api[_-]?key|token|secret|auth|password|bearer/i.test(key)) {
          block.data[key] = ''
        }
      })
    }
  })

  return {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    state: clonedState,
  }
}
```

### Purpose of this file

This TypeScript file defines utility functions and interfaces for sanitizing workflow state.  It provides two primary sanitization functions:

1.  `sanitizeForCopilot`:  Prepares a workflow state for use by a copilot or AI assistant.  This involves removing UI-specific information like positions and dimensions, and structuring the data in a way that is easier for the copilot to understand (e.g., nesting loops and parallels, embedding connections within blocks).  The goal is to provide the AI with only the essential workflow logic.

2.  `sanitizeForExport`:  Prepares a workflow state for export.  This involves removing sensitive information like API keys, OAuth credentials, and secrets, while preserving the layout information (positions of blocks) necessary to restore the visual layout when importing the workflow.  This allows workflows to be shared without exposing sensitive data.

The file also includes helper functions for identifying and sanitizing sensitive data and data related to UI elements.

### Explanation of each line of code

**Imports:**

```typescript
import type { Edge } from 'reactflow'
import type { BlockState, Loop, Parallel, WorkflowState } from '@/stores/workflows/workflow/types'
```

*   `import type { Edge } from 'reactflow'`: Imports the `Edge` type from the `reactflow` library.  `Edge` likely represents a connection between two blocks in the workflow UI.  The `type` keyword means we are only importing the type definition and not the actual ReactFlow component.
*   `import type { BlockState, Loop, Parallel, WorkflowState } from '@/stores/workflows/workflow/types'`: Imports type definitions for `BlockState`, `Loop`, `Parallel`, and `WorkflowState` from a local module.  These types likely represent the structure of a block in the workflow, loop and parallel constructs, and the overall workflow state, respectively.

**Interfaces:**

```typescript
export interface CopilotWorkflowState {
  blocks: Record<string, CopilotBlockState>
}

export interface CopilotBlockState {
  type: string
  name: string
  inputs?: Record<string, string | number | string[][] | object>
  outputs: BlockState['outputs']
  connections?: Record<string, string | string[]>
  nestedNodes?: Record<string, CopilotBlockState>
  enabled: boolean
  advancedMode?: boolean
  triggerMode?: boolean
}

export interface CopilotEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export interface ExportWorkflowState {
  version: string
  exportedAt: string
  state: {
    blocks: Record<string, BlockState>
    edges: Edge[]
    loops: Record<string, Loop>
    parallels: Record<string, Parallel>
  }
}
```

These interfaces define the structure of the sanitized workflow states:

*   `CopilotWorkflowState`: Represents the workflow state after sanitization for the copilot.
    *   `blocks`: A record (object) where the keys are block IDs and the values are `CopilotBlockState` objects.
*   `CopilotBlockState`: Represents a single block in the sanitized workflow state for the copilot. It is a simplified version of `BlockState` without UI-specific properties.
    *   `type`: The type of the block (e.g., "api-call", "loop", "condition").
    *   `name`: The name of the block.
    *   `inputs`: An optional record of input values for the block.  The values can be strings, numbers, arrays of strings, or objects.
    *   `outputs`: The outputs of the block, using the type `BlockState['outputs']`.
    *   `connections`: An optional record representing the connections from this block to other blocks.  Keys represent output handles, and values are either a single target block ID (string) or an array of target block IDs (string\[]).
    *   `nestedNodes`: An optional record containing nested blocks, used for representing loops and parallels.
    *   `enabled`: A boolean indicating whether the block is enabled.
    *  `advancedMode`: A boolean indicating whether the block is in advanced mode.
	 *  `triggerMode`: A boolean indicating whether the block is in trigger mode.
*   `CopilotEdge`: Represents an edge (connection) in the sanitized workflow state for the copilot.
    *   `id`: The unique ID of the edge.
    *   `source`: The ID of the source block.
    *   `target`: The ID of the target block.
    *   `sourceHandle`: The handle on the source block where the connection originates.
    *   `targetHandle`: The handle on the target block where the connection terminates.
*   `ExportWorkflowState`: Represents the workflow state after sanitization for export.
    *   `version`: A string representing the version of the export format.
    *   `exportedAt`: A string representing the date and time of the export in ISO format.
    *   `state`: An object containing the sanitized workflow state.  This includes the blocks, edges, loops, and parallels.

**`isSensitiveSubBlock` function:**

```typescript
function isSensitiveSubBlock(key: string, subBlock: BlockState['subBlocks'][string]): boolean {
  // Check if it's an OAuth input type
  if (subBlock.type === 'oauth-input') {
    return true
  }

  // Check if the field name suggests it contains sensitive data
  const sensitivePattern = /credential|oauth|api[_-]?key|token|secret|auth|password|bearer/i
  if (sensitivePattern.test(key)) {
    return true
  }

  // Check if the value itself looks like a secret (but not environment variable references)
  if (typeof subBlock.value === 'string' && subBlock.value.length > 0) {
    // Don't sanitize environment variable references like {{VAR_NAME}}
    if (subBlock.value.startsWith('{{') && subBlock.value.endsWith('}}')) {
      return false
    }

    // If it matches sensitive patterns in the value, it's likely a hardcoded secret
    if (sensitivePattern.test(subBlock.value)) {
      return true
    }
  }

  return false
}
```

This function determines whether a given sub-block contains sensitive information based on its type, key, and value.

*   It first checks if the `subBlock.type` is `"oauth-input"`. If so, it's considered sensitive.
*   It then checks if the `key` (the name of the sub-block field) matches a regular expression (`sensitivePattern`) that looks for terms like "credential", "oauth", "api\_key", etc.  If it matches, it's considered sensitive.
*   Finally, it checks the `subBlock.value` (if it's a string and not empty) to see if it contains sensitive information, but it makes an exception for environment variable references (e.g., `{{API_KEY}}`). The regex is used to test the value for sensitive terms, and returns true if any are matched.

**`sanitizeConditions` function:**

```typescript
function sanitizeConditions(conditionsJson: string): string {
  try {
    const conditions = JSON.parse(conditionsJson)
    if (!Array.isArray(conditions)) return conditionsJson

    // Keep only id, title, and value - remove UI state
    const cleaned = conditions.map((cond: any) => ({
      id: cond.id,
      title: cond.title,
      value: cond.value || '',
    }))

    return JSON.stringify(cleaned)
  } catch {
    return conditionsJson
  }
}
```

This function sanitizes a JSON string representing conditions, typically used in conditional blocks.  It parses the JSON, filters out any properties except `id`, `title`, and `value` from each condition, and then stringifies the result back into a JSON string. The function includes a try/catch block to handle potential JSON parsing errors, returning the original `conditionsJson` if an error occurs.

**`sanitizeTools` function:**

```typescript
function sanitizeTools(tools: any[]): any[] {
  return tools.map((tool) => {
    if (tool.type === 'custom-tool') {
      const sanitized: any = {
        type: tool.type,
        title: tool.title,
        toolId: tool.toolId,
        usageControl: tool.usageControl,
      }

      if (tool.schema?.function) {
        sanitized.schema = {
          function: {
            description: tool.schema.function.description,
            parameters: tool.schema.function.parameters,
          },
        }
      }

      if (tool.code) {
        sanitized.code = tool.code
      }

      return sanitized
    }

    const { isExpanded, ...cleanTool } = tool
    return cleanTool
  })
}
```

This function sanitizes an array of "tool" objects, removing UI-specific and redundant fields.

*   It iterates through each `tool` in the `tools` array.
*   If the `tool` is of type `"custom-tool"`, it creates a new `sanitized` object with a limited set of properties: `type`, `title`, `toolId`, and `usageControl`. It also preserves the function `description` and `parameters` from the tool `schema`. If `tool.code` is defined, it preserves it too.
*   If the `tool` is not a `"custom-tool"`, it removes the `isExpanded` property and returns the remaining properties using object destructuring with the rest operator (`...cleanTool`).
*   This function helps reduce the amount of data sent to the copilot by removing unnecessary information.

**`sanitizeSubBlocks` function:**

```typescript
function sanitizeSubBlocks(
  subBlocks: BlockState['subBlocks']
): Record<string, string | number | string[][] | object> {
  const sanitized: Record<string, string | number | string[][] | object> = {}

  Object.entries(subBlocks).forEach(([key, subBlock]) => {
    // Special handling for responseFormat - process BEFORE null check
    // so we can detect when it's added/removed
    if (key === 'responseFormat') {
      try {
        // Handle null/undefined - skip if no value
        if (subBlock.value === null || subBlock.value === undefined) {
          return
        }

        let obj = subBlock.value

        // Handle string values - parse them first
        if (typeof subBlock.value === 'string') {
          const trimmed = subBlock.value.trim()
          if (!trimmed) {
            // Empty string - skip this field
            return
          }
          obj = JSON.parse(trimmed)
        }

        // Handle object values - normalize keys and keep as object for copilot
        if (obj && typeof obj === 'object') {
          // Sort keys recursively for consistent comparison
          const sortKeys = (item: any): any => {
            if (Array.isArray(item)) {
              return item.map(sortKeys)
            }
            if (item !== null && typeof item === 'object') {
              return Object.keys(item)
                .sort()
                .reduce((result: any, key: string) => {
                  result[key] = sortKeys(item[key])
                  return result
                }, {})
            }
            return item
          }

          // Keep as object (not stringified) for better copilot understanding
          const normalized = sortKeys(obj)
          sanitized[key] = normalized
          return
        }

        // If we get here, obj is not an object (maybe null or primitive) - skip it
        return
      } catch (error) {
        // Invalid JSON - skip this field to avoid crashes
        return
      }
    }

    // Skip null/undefined values for other fields
    if (subBlock.value === null || subBlock.value === undefined) {
      return
    }

    // For sensitive fields, either omit or replace with placeholder
    if (isSensitiveSubBlock(key, subBlock)) {
      // If it's an environment variable reference, keep it
      if (
        typeof subBlock.value === 'string' &&
        subBlock.value.startsWith('{{') &&
        subBlock.value.endsWith('}}')
      ) {
        sanitized[key] = subBlock.value
      }
      // Otherwise omit the sensitive value entirely
      return
    }

    // Special handling for condition-input type - clean UI metadata
    if (subBlock.type === 'condition-input' && typeof subBlock.value === 'string') {
      const cleanedConditions: string = sanitizeConditions(subBlock.value)
      sanitized[key] = cleanedConditions
      return
    }

    if (key === 'tools' && Array.isArray(subBlock.value)) {
      sanitized[key] = sanitizeTools(subBlock.value)
      return
    }

    // Skip knowledge base tag filters and document tags (workspace-specific data)
    if (key === 'tagFilters' || key === 'documentTags') {
      return
    }

    sanitized[key] = subBlock.value
  })

  return sanitized
}
```

This function sanitizes the `subBlocks` of a block, removing null values, sensitive data, and simplifying the structure.  It transforms the `subBlocks` object from a record of `BlockState['subBlocks']` to a simpler record where each key maps directly to its value.

*   It iterates through each `subBlock` in the `subBlocks` object.
*   It has special logic for handling the `responseFormat` sub-block.
    *   It parses the value of `responseFormat` if it's a string, handles potential JSON parsing errors.
    *   It keeps the value as an object.
    *   It sorts the keys recursively for consistent comparison.
*   It skips null or undefined values.
*   It uses `isSensitiveSubBlock` to check if a sub-block is sensitive. If it is, it either omits the value entirely, or replaces it with a placeholder if the value is an environment variable reference.
*   It calls `sanitizeConditions` to clean UI metadata for `condition-input` types.
*   It calls `sanitizeTools` to clean the `tools` array.
*   It skips specific keys (`tagFilters` and `documentTags`).

**`extractConnectionsForBlock` function:**

```typescript
function extractConnectionsForBlock(
  blockId: string,
  edges: WorkflowState['edges']
): Record<string, string | string[]> | undefined {
  const connections: Record<string, string[]> = {}

  // Find all outgoing edges from this block
  const outgoingEdges = edges.filter((edge) => edge.source === blockId)

  if (outgoingEdges.length === 0) {
    return undefined
  }

  // Group by source handle
  for (const edge of outgoingEdges) {
    const handle = edge.sourceHandle || 'source'

    if (!connections[handle]) {
      connections[handle] = []
    }

    connections[handle].push(edge.target)
  }

  // Simplify single-element arrays to just the string
  const simplified: Record<string, string | string[]> = {}
  for (const [handle, targets] of Object.entries(connections)) {
    simplified[handle] = targets.length === 1 ? targets[0] : targets
  }

  return simplified
}
```

This function extracts the outgoing connections for a given block from the workflow's edges and formats them into a more easily consumable format.

*   It filters the `edges` array to find all edges where the `source` matches the given `blockId`.
*   It groups the target block IDs (`edge.target`) by the `sourceHandle` of the edge. If no `sourceHandle` is defined, it defaults to "source".
*   If a `sourceHandle` has only one target, it simplifies the value to be a single string instead of an array of strings.
*   It returns a record where the keys are the source handles and the values are either a single target block ID (string) or an array of target block IDs (string\[]).

**`sanitizeForCopilot` function:**

```typescript
export function sanitizeForCopilot(state: WorkflowState): CopilotWorkflowState {
  const sanitizedBlocks: Record<string, CopilotBlockState> = {}
  const processedBlocks = new Set<string>()

  // Helper to find child blocks of a parent (loop/parallel container)
  const findChildBlocks = (parentId: string): string[] => {
    return Object.keys(state.blocks).filter(
      (blockId) => state.blocks[blockId].data?.parentId === parentId
    )
  }

  // Helper to recursively sanitize a block and its children
  const sanitizeBlock = (blockId: string, block: BlockState): CopilotBlockState => {
    const connections = extractConnectionsForBlock(blockId, state.edges)

    // For loop/parallel blocks, extract config from block.data instead of subBlocks
    let inputs: Record<string, string | number | string[][] | object>

    if (block.type === 'loop' || block.type === 'parallel') {
      // Extract configuration from block.data
      const loopInputs: Record<string, string | number | string[][] | object> = {}
      if (block.data?.loopType) loopInputs.loopType = block.data.loopType
      if (block.data?.count !== undefined) loopInputs.iterations = block.data.count
      if (block.data?.collection !== undefined) loopInputs.collection = block.data.collection
      if (block.data?.parallelType) loopInputs.parallelType = block.data.parallelType
      inputs = loopInputs
    } else {
      // For regular blocks, sanitize subBlocks
      inputs = sanitizeSubBlocks(block.subBlocks)
    }

    // Check if this is a loop or parallel (has children)
    const childBlockIds = findChildBlocks(blockId)
    const nestedNodes: Record<string, CopilotBlockState> = {}

    if (childBlockIds.length > 0) {
      // Recursively sanitize child blocks
      childBlockIds.forEach((childId) => {
        const childBlock = state.blocks[childId]
        if (childBlock) {
          nestedNodes[childId] = sanitizeBlock(childId, childBlock)
          processedBlocks.add(childId)
        }
      })
    }

    const result: CopilotBlockState = {
      type: block.type,
      name: block.name,
      outputs: block.outputs,
      enabled: block.enabled,
    }

    if (Object.keys(inputs).length > 0) result.inputs = inputs
    if (connections) result.connections = connections
    if (Object.keys(nestedNodes).length > 0) result.nestedNodes = nestedNodes
    if (block.advancedMode !== undefined) result.advancedMode = block.advancedMode
    if (block.triggerMode !== undefined) result.triggerMode = block.triggerMode

    return result
  }

  // Process only root-level blocks (those without a parent)
  Object.entries(state.blocks).forEach(([blockId, block]) => {
    // Skip if already processed as a child
    if (processedBlocks.has(blockId)) return

    // Skip if it has a parent (it will be processed as nested)
    if (block.data?.parentId) return

    sanitizedBlocks[blockId] = sanitizeBlock(blockId, block)
  })

  return {
    blocks: sanitizedBlocks,
  }
}
```

This is the main function for sanitizing the workflow state for use by a copilot.  It removes UI-specific data, nests loops and parallels, and formats connections for consistency.

*   It initializes `sanitizedBlocks` to store the sanitized blocks and `processedBlocks` to track blocks that have already been processed as children of loops or parallels.
*   `findChildBlocks` is a helper function that finds all the child blocks of a given block ID (used for loops and parallels).
*   `sanitizeBlock` is a recursive helper function that sanitizes a single block.
    *   It extracts connections using `extractConnectionsForBlock`.
    *   For loop and parallel blocks, it extracts the configuration from `block.data` instead of `block.subBlocks`.
    *   For other blocks, it sanitizes the `subBlocks` using `sanitizeSubBlocks`.
    *   It recursively calls `sanitizeBlock` for any child blocks of the current block, storing them in the `nestedNodes` property.
    *   It constructs a `CopilotBlockState` object with the sanitized data.
*   The main part of the function iterates through the blocks in the `state.blocks`.
    *   It skips blocks that have already been processed (as children) or that have a parent (meaning they are nested inside a loop or parallel).
    *   It calls `sanitizeBlock` for