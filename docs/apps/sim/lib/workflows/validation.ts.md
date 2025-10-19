```typescript
import { createLogger } from '@/lib/logs/console/logger'
import { getBlock } from '@/blocks/registry'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { getTool } from '@/tools/utils'

const logger = createLogger('WorkflowValidation')

/**
 * Validates the schema of a custom tool.
 *
 * @param tool - The tool object to validate.
 * @returns `true` if the custom tool schema is valid, `false` otherwise.
 */
function isValidCustomToolSchema(tool: any): boolean {
  try {
    // Check if tool exists and is an object
    if (!tool || typeof tool !== 'object') return false

    // If the tool is not a custom tool, return true as it is validated elsewhere
    if (tool.type !== 'custom-tool') return true

    const schema = tool.schema
    // Check if schema exists and is an object
    if (!schema || typeof schema !== 'object') return false

    const fn = schema.function
    // Check if the function property exists and is an object
    if (!fn || typeof fn !== 'object') return false

    // Check if the function has a name and is a string
    if (!fn.name || typeof fn.name !== 'string') return false

    const params = fn.parameters
    // Check if parameters exist and is an object
    if (!params || typeof params !== 'object') return false

    // Check if parameters is an object
    if (params.type !== 'object') return false

    // Check if parameters has properties and is an object
    if (!params.properties || typeof params.properties !== 'object') return false

    return true
  } catch (_err) {
    // If any error occurs during validation, return false
    return false
  }
}

/**
 * Sanitizes agent tools within blocks, ensuring they are valid and have required defaults.
 *
 * This function iterates through the provided blocks, identifies agent blocks, and cleans their
 * associated tools. It parses legacy string formats, validates custom tool schemas, and ensures
 * required properties (code, usageControl) are set to default values if missing.
 *
 * @param blocks - A record of blocks, where the key is the block ID and the value is the block object.
 * @returns An object containing the sanitized blocks and an array of warnings encountered during the process.
 */
export function sanitizeAgentToolsInBlocks(blocks: Record<string, any>): {
  blocks: Record<string, any>
  warnings: string[]
} {
  const warnings: string[] = []

  // Shallow clone to avoid mutating callers
  const sanitizedBlocks: Record<string, any> = { ...blocks }

  for (const [blockId, block] of Object.entries(sanitizedBlocks)) {
    try {
      // Skip non-agent blocks
      if (!block || block.type !== 'agent') continue

      const subBlocks = block.subBlocks || {}
      const toolsSubBlock = subBlocks.tools

      // Skip blocks without a tools sub-block
      if (!toolsSubBlock) continue

      let value = toolsSubBlock.value

      // Parse legacy string format
      if (typeof value === 'string') {
        try {
          // Try to parse the value as JSON
          value = JSON.parse(value)
        } catch (_e) {
          // If parsing fails, add a warning and reset the tools to an empty array
          warnings.push(
            `Block ${block.name || blockId}: invalid tools JSON; resetting tools to empty array`
          )
          value = []
        }
      }

      // Ensure the value is an array
      if (!Array.isArray(value)) {
        // If the value is not an array, add a warning and force it to an empty array
        warnings.push(`Block ${block.name || blockId}: tools value is not an array; resetting`)
        toolsSubBlock.value = []
        continue
      }

      const originalLength = value.length

      // Filter out invalid custom tools and map the remaining tools to ensure required defaults
      const cleaned = value
        .filter((tool: any) => {
          // Allow non-custom tools to pass through as-is
          if (!tool || typeof tool !== 'object') return false
          if (tool.type !== 'custom-tool') return true
          const ok = isValidCustomToolSchema(tool)
          if (!ok) {
            logger.warn('Removing invalid custom tool from workflow', {
              blockId,
              blockName: block.name,
            })
          }
          return ok
        })
        .map((tool: any) => {
          // Ensure required defaults to avoid client crashes
          if (tool.type === 'custom-tool') {
            if (!tool.code || typeof tool.code !== 'string') {
              tool.code = ''
            }
            if (!tool.usageControl) {
              tool.usageControl = 'auto'
            }
          }
          return tool
        })

      // Add a warning if any tools were removed
      if (cleaned.length !== originalLength) {
        warnings.push(
          `Block ${block.name || blockId}: removed ${originalLength - cleaned.length} invalid tool(s)`
        )
      }

      // Update the tools sub-block with the cleaned tools
      toolsSubBlock.value = cleaned
      // Reassign in case caller uses object identity
      sanitizedBlocks[blockId] = { ...block, subBlocks: { ...subBlocks, tools: toolsSubBlock } }
    } catch (err: any) {
      // Catch any errors during the process and add a warning
      warnings.push(
        `Block ${block?.name || blockId}: tools sanitation failed: ${err?.message || String(err)}`
      )
    }
  }

  return { blocks: sanitizedBlocks, warnings }
}

export interface WorkflowValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  sanitizedState?: WorkflowState
}

/**
 * Validates the entire workflow state, checking for structural integrity,
 * valid block types, and correct tool references.
 *
 * This function performs a comprehensive validation of the workflow state, ensuring that it adheres to the expected structure and contains valid data. It checks for the existence of required fields, the validity of block types, and the correctness of tool references. It returns a result object containing a boolean indicating whether the workflow state is valid, an array of errors encountered during validation, and an array of warnings.
 *
 * @param workflowState - The workflow state to validate.
 * @param options - Optional parameters for validation.
 * @param options.sanitize - if `true` the workflow state will be sanitized. Invalid blocks will be removed. Defaults to `false`.
 * @returns A `WorkflowValidationResult` object containing the validation result, errors, and warnings.  If `sanitize` is true, the result will contain the sanitized workflow state.
 */
export function validateWorkflowState(
  workflowState: WorkflowState,
  options: { sanitize?: boolean } = {}
): WorkflowValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  let sanitizedState = workflowState

  try {
    // Basic structure validation
    if (!workflowState || typeof workflowState !== 'object') {
      errors.push('Invalid workflow state: must be an object')
      return { valid: false, errors, warnings }
    }

    if (!workflowState.blocks || typeof workflowState.blocks !== 'object') {
      errors.push('Invalid workflow state: missing blocks')
      return { valid: false, errors, warnings }
    }

    // Validate each block
    const sanitizedBlocks: Record<string, any> = {}
    let hasChanges = false

    for (const [blockId, block] of Object.entries(workflowState.blocks)) {
      if (!block || typeof block !== 'object') {
        errors.push(`Block ${blockId}: invalid block structure`)
        continue
      }

      // Check if block type exists
      const blockConfig = getBlock(block.type)

      // Special handling for container blocks (loop and parallel)
      if (block.type === 'loop' || block.type === 'parallel') {
        // These are valid container types, they don't need block configs
        sanitizedBlocks[blockId] = block
        continue
      }

      if (!blockConfig) {
        errors.push(`Block ${block.name || blockId}: unknown block type '${block.type}'`)
        if (options.sanitize) {
          hasChanges = true
          continue // Skip this block in sanitized output
        }
      }

      // Validate tool references in blocks that use tools
      if (block.type === 'api' || block.type === 'generic') {
        // For API and generic blocks, the tool is determined by the block's tool configuration
        // In the workflow state, we need to check if the block type has valid tool access
        const blockConfig = getBlock(block.type)
        if (blockConfig?.tools?.access) {
          // API block has static tool access
          const toolIds = blockConfig.tools.access
          for (const toolId of toolIds) {
            const validationError = validateToolReference(toolId, block.type, block.name)
            if (validationError) {
              errors.push(validationError)
            }
          }
        }
      } else if (block.type === 'knowledge' || block.type === 'supabase' || block.type === 'mcp') {
        // These blocks have dynamic tool selection based on operation
        // The actual tool validation happens at runtime based on the operation value
        // For now, just ensure the block type is valid (already checked above)
      }

      // Special validation for agent blocks
      if (block.type === 'agent' && block.subBlocks?.tools?.value) {
        const toolsSanitization = sanitizeAgentToolsInBlocks({ [blockId]: block })
        warnings.push(...toolsSanitization.warnings)
        if (toolsSanitization.warnings.length > 0) {
          sanitizedBlocks[blockId] = toolsSanitization.blocks[blockId]
          hasChanges = true
        } else {
          sanitizedBlocks[blockId] = block
        }
      } else {
        sanitizedBlocks[blockId] = block
      }
    }

    // Validate edges reference existing blocks
    if (workflowState.edges && Array.isArray(workflowState.edges)) {
      const blockIds = new Set(Object.keys(sanitizedBlocks))
      const loopIds = new Set(Object.keys(workflowState.loops || {}))
      const parallelIds = new Set(Object.keys(workflowState.parallels || {}))

      for (const edge of workflowState.edges) {
        if (!edge || typeof edge !== 'object') {
          errors.push('Invalid edge structure')
          continue
        }

        // Check if source and target exist
        const sourceExists =
          blockIds.has(edge.source) || loopIds.has(edge.source) || parallelIds.has(edge.source)
        const targetExists =
          blockIds.has(edge.target) || loopIds.has(edge.target) || parallelIds.has(edge.target)

        if (!sourceExists) {
          errors.push(`Edge references non-existent source block '${edge.source}'`)
        }
        if (!targetExists) {
          errors.push(`Edge references non-existent target block '${edge.target}'`)
        }
      }
    }

    // If we made changes during sanitization, create a new state object
    if (hasChanges && options.sanitize) {
      sanitizedState = {
        ...workflowState,
        blocks: sanitizedBlocks,
      }
    }

    const valid = errors.length === 0
    return {
      valid,
      errors,
      warnings,
      sanitizedState: options.sanitize ? sanitizedState : undefined,
    }
  } catch (err) {
    logger.error('Workflow validation failed with exception', err)
    errors.push(`Validation failed: ${err instanceof Error ? err.message : String(err)}`)
    return { valid: false, errors, warnings }
  }
}

/**
 * Validates a tool reference for a specific block.
 *
 * This function checks if a tool reference (toolId) is valid for a given block type.
 * It distinguishes between built-in tools, custom tools, and MCP tools, and performs
 * appropriate validation based on the tool type. For built-in tools, it verifies that
 * the tool exists in the tool registry.
 *
 * @param toolId - The ID of the tool to validate.
 * @param blockType - The type of the block that references the tool.
 * @param blockName - The name of the block that references the tool (optional).
 * @returns `null` if the tool reference is valid, or an error message if it is invalid.
 */
export function validateToolReference(
  toolId: string | undefined,
  blockType: string,
  blockName?: string
): string | null {
  if (!toolId) return null

  // Check if it's a custom tool or MCP tool
  const isCustomTool = toolId.startsWith('custom_')
  const isMcpTool = toolId.startsWith('mcp-')

  if (!isCustomTool && !isMcpTool) {
    // For built-in tools, verify they exist
    const tool = getTool(toolId)
    if (!tool) {
      return `Block ${blockName || 'unknown'} (${blockType}): references non-existent tool '${toolId}'`
    }
  }

  return null
}
```

**Purpose of this file:**

This file contains functions for validating and sanitizing workflow states within an application. The primary goal is to ensure that the workflow configurations are valid, consistent, and safe to execute. It includes checks for:

-   **Structural integrity:**  Ensuring the workflow state and its constituent parts (blocks, edges) have the expected structure and data types.
-   **Block type validity:** Verifying that all blocks within the workflow are of known and supported types.
-   **Tool reference validity:** Confirming that any references to tools within blocks are valid and that the tools exist.  This includes special handling for custom tools and their schemas.
-   **Agent tool sanitization:**  Cleaning and validating the tools associated with agent blocks, ensuring they conform to the expected format and have necessary default values.
-   **Edge validity:** Ensuring that edges connect existing blocks within the workflow.

The functions also provide the capability to sanitize a workflow state, meaning removing invalid blocks or correcting invalid tool references, to ensure the application can continue to operate even with potentially malformed workflow configurations.

**Explanation of each section:**

1.  **Imports:**

    *   `createLogger` from `'@/lib/logs/console/logger'`: Imports a function to create a logger instance for logging validation-related messages. This helps in debugging and monitoring the validation process.
    *   `getBlock` from `'@/blocks/registry'`: Imports a function to retrieve block configuration information based on the block type. This is used to validate that blocks used in the workflow are of known types and have the expected properties.
    *   `WorkflowState` from `'@/stores/workflows/workflow/types'`: Imports the type definition for the workflow state object. This defines the structure of the data being validated.
    *   `getTool` from `'@/tools/utils'`: Imports a function to retrieve tool information based on the tool ID. This is used to validate that tool references in blocks are valid and that the specified tools exist.

2.  **`logger` constant:**

    *   `const logger = createLogger('WorkflowValidation')`: Creates a logger instance with the name 'WorkflowValidation'. This allows the code to log messages specifically related to workflow validation, making it easier to filter and analyze logs.

3.  **`isValidCustomToolSchema(tool: any): boolean` Function:**

    *   This function validates the structure of a custom tool's schema.
    *   It checks if the `tool` is an object, has a `schema` property that is an object, has a `function` property inside the schema that is an object, and that this function has a `name` property that is a string. It also validates the parameter definitions of the function.
    *   It returns `true` if the schema is valid, and `false` otherwise.
    *   Error handling with a `try...catch` block ensures the function doesn't crash if the `tool` object is malformed.

4.  **`sanitizeAgentToolsInBlocks(blocks: Record<string, any>): { blocks: Record<string, any>; warnings: string[] }` Function:**

    *   This function sanitizes the tools associated with agent blocks in the workflow.
    *   It iterates through each block in the provided `blocks` object.
    *   For each agent block, it retrieves the `tools` sub-block.
    *   If the `tools` value is a string, it attempts to parse it as JSON. If parsing fails, it resets the tools to an empty array and adds a warning.
    *   It then ensures the `tools` value is an array. If not, it resets it to an empty array and adds a warning.
    *   It iterates through the array of tools, filters out invalid tools (specifically custom tools with invalid schemas), and updates custom tools with default values for `code` and `usageControl` if they are missing. It uses the `isValidCustomToolSchema` function to determine if a custom tool has a valid schema.
    *   It collects warnings for invalid tools or parsing errors.
    *   The function returns a new `blocks` object with the sanitized tools and an array of `warnings`.  It makes a shallow copy of the blocks to avoid modifying the original workflow state directly.

5.  **`WorkflowValidationResult` Interface:**

    *   This interface defines the structure of the object returned by the `validateWorkflowState` function.
    *   `valid`: A boolean indicating whether the workflow state is valid.
    *   `errors`: An array of error messages encountered during validation.
    *   `warnings`: An array of warning messages encountered during validation.
    *   `sanitizedState`: An optional `WorkflowState` object containing the sanitized workflow state (only present if sanitization is enabled).

6.  **`validateWorkflowState(workflowState: WorkflowState, options: { sanitize?: boolean } = {}): WorkflowValidationResult` Function:**

    *   This function is the core of the workflow validation logic.
    *   It takes a `workflowState` object and an optional `options` object as input. The `options` object can contain a `sanitize` flag indicating whether to sanitize the workflow state.
    *   It performs a series of checks on the `workflowState` to ensure its validity.
    *   It first checks if the `workflowState` and its `blocks` property are valid objects.
    *   It then iterates through each block in the `blocks` object and performs the following checks:
        *   Validates that the block type exists in the block registry using `getBlock`.
        *   Special handling for "loop" and "parallel" blocks which are valid without a config.
        *   Validates tool references for 'api' and 'generic' blocks by calling the `validateToolReference` function for each tool.
        *   Sanitizes agent blocks using the `sanitizeAgentToolsInBlocks` function.
    *   It then validates the edges to ensure that they reference existing blocks.
    *   If the `sanitize` option is enabled and changes were made during validation, it creates a new `workflowState` object with the sanitized blocks.
    *   The function returns a `WorkflowValidationResult` object containing the validation result, errors, warnings, and the sanitized workflow state (if sanitization is enabled). It catches any exceptions during the process and logs the error before returning a failure result.

7.  **`validateToolReference(toolId: string | undefined, blockType: string, blockName?: string): string | null` Function:**

    *   This function validates a single tool reference.
    *   It checks if the `toolId` is defined. If not, it returns `null` (indicating no error).
    *   It then checks if the `toolId` is a custom tool or an MCP tool.
    *   If it's not a custom tool or an MCP tool, it retrieves the tool from the tool registry using `getTool`. If the tool is not found, it returns an error message.
    *   If the tool is found or is a custom/MCP tool, it returns `null` (indicating no error).

**In Summary:**

This file provides a comprehensive set of tools for validating and sanitizing workflow states.  It ensures that workflows are structurally sound, use valid components, and reference existing tools.  The sanitization functionality allows the application to gracefully handle potentially invalid workflow configurations by removing or correcting the invalid parts, improving overall robustness and stability.  The use of logging and detailed error/warning messages aids in debugging and identifying the root cause of workflow validation issues.
