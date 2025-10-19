```typescript
import { getBlock } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

/**
 * Get the effective outputs for a block, including dynamic outputs from inputFormat
 * and trigger outputs for blocks in trigger mode
 */
export function getBlockOutputs(
  blockType: string,
  subBlocks?: Record<string, any>,
  triggerMode?: boolean
): Record<string, any> {
  // 1. Purpose: This function determines the outputs of a block, considering various factors like block type,
  //    sub-block configurations, and whether the block is running in "trigger mode".  It handles both static
  //    outputs (defined in the block's configuration) and dynamic outputs (derived from the "inputFormat" or
  //    trigger configurations).
  // 2. Args:
  //    - blockType (string): The type of the block (e.g., "api_trigger", "starter"). This identifies the block's configuration.
  //    - subBlocks (Record<string, any>, optional):  A dictionary of sub-block configurations. Sub-blocks are configurable
  //      elements within a block (e.g., "inputFormat", "triggerId").  The keys of this object are the names of the sub-blocks,
  //      and the values are their configurations. Defaults to undefined.
  //    - triggerMode (boolean, optional): A boolean indicating whether the block is running in "trigger mode".  In trigger mode,
  //      the block's outputs might be determined by the trigger that activated it. Defaults to undefined.
  // 3. Return:
  //    - Record<string, any>: An object representing the block's outputs.  The keys of this object are the output names, and
  //      the values are the output definitions.  An output definition typically includes a `type` (e.g., "string", "number", "files")
  //      and a `description`. If the block has no outputs, it returns an empty object.

  // Get the block configuration based on the block type.  The `getBlock` function (imported from '@/blocks') presumably retrieves
  // the block's configuration object, which defines its properties, inputs, outputs, and sub-blocks.
  const blockConfig = getBlock(blockType)
  if (!blockConfig) return {} // If no config found, return empty object

  // Check if the block is in trigger mode and if triggers are enabled for this block type.
  if (triggerMode && blockConfig.triggers?.enabled) {
    // Determine the trigger ID. If a `triggerId` is provided in the `subBlocks`, use it. Otherwise, use the first available trigger
    // ID from the block's configuration.
    const triggerId = subBlocks?.triggerId?.value || blockConfig.triggers?.available?.[0]
    if (triggerId) {
      // Get the trigger configuration based on the trigger ID. The `getTrigger` function (imported from '@/triggers') presumably
      // retrieves the trigger's configuration object.
      const trigger = getTrigger(triggerId)
      if (trigger?.outputs) {
        // If the trigger has outputs defined, return them.  In trigger mode, the trigger's outputs override the block's static outputs.
        return trigger.outputs
      }
    }
  }

  // If not in trigger mode, or if the trigger doesn't have outputs, start with the static outputs defined in the block configuration.
  // The `blockConfig.outputs` property is assumed to be an object containing the block's static output definitions.  The spread
  // operator (`...`) creates a shallow copy of this object, so modifications to `outputs` later in the function don't affect the
  // original block configuration.
  let outputs = { ...(blockConfig.outputs || {}) }

  // Special handling for the "starter" block type.  This block has different output structures depending on the `startWorkflow` and
  // `inputFormat` sub-block values.  This section appears to be legacy code, handling specific scenarios for the "starter" block.
  if (blockType === 'starter') {
    const startWorkflowValue = subBlocks?.startWorkflow?.value

    // If `startWorkflow` is set to "chat", define specific outputs for chat mode: `input`, `conversationId`, and `files`.
    if (startWorkflowValue === 'chat') {
      // Chat mode outputs
      return {
        input: { type: 'string', description: 'User message' },
        conversationId: { type: 'string', description: 'Conversation ID' },
        files: { type: 'files', description: 'Uploaded files' },
      }
    }
    // If `startWorkflow` is set to "api", "run", or "manual", the outputs are determined by the `inputFormat` sub-block.
    if (
      startWorkflowValue === 'api' ||
      startWorkflowValue === 'run' ||
      startWorkflowValue === 'manual'
    ) {
      // API/manual mode - use inputFormat fields only
      let inputFormatValue = subBlocks?.inputFormat?.value
      outputs = {} // Clear any existing outputs, as the outputs are now dynamically defined by the input format.

      // Ensure that inputFormatValue is an array. If it's not an array, null, or undefined, default to an empty array.  This sanitizes
      // the input to prevent errors later.
      if (
        inputFormatValue !== null &&
        inputFormatValue !== undefined &&
        !Array.isArray(inputFormatValue)
      ) {
        inputFormatValue = []
      }

      // If `inputFormatValue` is an array, iterate over its elements and create an output for each field defined in the input format.
      if (Array.isArray(inputFormatValue)) {
        inputFormatValue.forEach((field: { name?: string; type?: string }) => {
          // For each field in the input format, create an output with the field's name as the key and an object containing the field's
          // type and description as the value. The type defaults to "any" if not specified. Only create an output if the field has a
          // non-empty name.
          if (field?.name && field.name.trim() !== '') {
            outputs[field.name] = {
              type: (field.type || 'any') as any,
              description: `Field from input format`,
            }
          }
        })
      }

      return outputs // Return the dynamically generated outputs based on the input format.
    }
  }

  // For blocks that have an "inputFormat" sub-block, add dynamic outputs based on the value of the input format.  The `hasInputFormat`
  // function (defined later in the file) checks if the block configuration has an "input-format" sub-block defined.
  if (hasInputFormat(blockConfig) && subBlocks?.inputFormat?.value) {
    let inputFormatValue = subBlocks.inputFormat.value

    // Sanitize inputFormat - ensure it's an array. Similar to the "starter" block handling, this ensures that the `inputFormatValue`
    // is an array to prevent errors. If it's not a valid array-like value, it defaults to an empty array.
    if (
      inputFormatValue !== null &&
      inputFormatValue !== undefined &&
      !Array.isArray(inputFormatValue)
    ) {
      // Invalid format, default to empty array
      inputFormatValue = []
    }

    // If the sanitized `inputFormatValue` is an array, process it to create dynamic outputs.
    if (Array.isArray(inputFormatValue)) {
      // Special handling for "api_trigger", "input_trigger", and "generic_webhook" block types.  These block types derive their outputs
      // directly from the input format.
      if (
        blockType === 'api_trigger' ||
        blockType === 'input_trigger' ||
        blockType === 'generic_webhook'
      ) {
        // For generic_webhook, only clear outputs if inputFormat has fields
        // Otherwise keep the default outputs (pass-through body)
        if (inputFormatValue.length > 0 || blockType !== 'generic_webhook') {
          outputs = {} // Clear all default outputs.  These block types rely entirely on the input format for their outputs.
        }

        // Add each field from inputFormat as an output at root level.  Iterate over the fields in the input format and create
        // an output for each, similar to the "starter" block's API/manual mode handling.
        inputFormatValue.forEach((field: { name?: string; type?: string }) => {
          if (field?.name && field.name.trim() !== '') {
            outputs[field.name] = {
              type: (field.type || 'any') as any,
              description: `Field from input format`,
            }
          }
        })
      }
    } else if (blockType === 'api_trigger' || blockType === 'input_trigger') {
      // If no inputFormat defined, API/Input trigger has no outputs.  This handles the case where the block is an "api_trigger" or
      // "input_trigger" but no input format is specified. In this case, the block has no outputs.
      outputs = {}
    }
  }

  // Finally, return the calculated outputs.  This object contains either the static outputs from the block configuration, the trigger
  // outputs (if in trigger mode), or the dynamic outputs derived from the input format.
  return outputs
}

/**
 * Check if a block config has an inputFormat sub-block
 */
function hasInputFormat(blockConfig: BlockConfig): boolean {
  // 1. Purpose: This function checks if a given block configuration includes an "input-format" sub-block.
  // 2. Args:
  //    - blockConfig (BlockConfig): The configuration object for a block. It's expected to have a `subBlocks` property, which is an
  //      array of sub-block configurations.
  // 3. Return:
  //    - boolean: Returns `true` if the block configuration contains at least one sub-block with the type "input-format"; otherwise,
  //      returns `false`.

  // Use the `some` method on the `blockConfig.subBlocks` array (if it exists) to check if at least one of the sub-blocks has the type
  // "input-format".  The `some` method returns `true` if the provided callback function returns `true` for at least one element in the array.
  return blockConfig.subBlocks?.some((sb) => sb.type === 'input-format') || false
}

/**
 * Get output paths for a block (for tag dropdown)
 */
export function getBlockOutputPaths(
  blockType: string,
  subBlocks?: Record<string, any>,
  triggerMode?: boolean
): string[] {
  // 1. Purpose: This function retrieves all possible output paths for a given block, taking into account nested outputs.
  //    This is useful for creating a tag dropdown, where users can select which output they want to use in a workflow.
  // 2. Args:
  //    - blockType (string): The type of the block.
  //    - subBlocks (Record<string, any>, optional): A dictionary of sub-block configurations. Defaults to undefined.
  //    - triggerMode (boolean, optional): Whether the block is in trigger mode. Defaults to undefined.
  // 3. Return:
  //    - string[]: An array of strings, where each string represents an output path (e.g., "input", "conversationId", "files.url").

  // Get the block's outputs using the `getBlockOutputs` function, which handles static and dynamic outputs based on the block type,
  // sub-blocks, and trigger mode.
  const outputs = getBlockOutputs(blockType, subBlocks, triggerMode)

  // Initialize an empty array to store the output paths.
  const paths: string[] = []

  // Define a recursive function `collectPaths` to traverse the `outputs` object and build the output paths.
  function collectPaths(obj: Record<string, any>, prefix = ''): void {
    // Iterate over the key-value pairs in the current object.
    for (const [key, value] of Object.entries(obj)) {
      // Build the current path by appending the current key to the existing prefix. If there is already a prefix, include a dot.
      const path = prefix ? `${prefix}.${key}` : key

      // If the value is an object and has a 'type' property, consider it a leaf node (an output definition).
      if (value && typeof value === 'object' && 'type' in value) {
        // Special handling for 'files' type - expand to show array element properties. The `files` type represents an array of file objects.
        if (value.type === 'files') {
          // Show properties without [0] for cleaner display
          // The tag dropdown will add [0] automatically when inserting
          paths.push(`${path}.url`)
          paths.push(`${path}.name`)
          paths.push(`${path}.size`)
          paths.push(`${path}.type`)
          paths.push(`${path}.key`)
          paths.push(`${path}.uploadedAt`)
          paths.push(`${path}.expiresAt`)
        } else {
          // If it's not a `files` type, just add the current path to the `paths` array.
          paths.push(path)
        }
      }
      // If the value is an object but doesn't have a 'type' property, recursively call `collectPaths` to explore its nested properties.
      else if (value && typeof value === 'object' && !Array.isArray(value)) {
        collectPaths(value, path)
      }
      // Otherwise treat as a leaf node. If the value is not an object, it represents a simple output value, and its path is added to the `paths` array.
      else {
        paths.push(path)
      }
    }
  }

  // Start the recursive process by calling `collectPaths` with the `outputs` object.
  collectPaths(outputs)
  // Return the array of output paths.
  return paths
}

/**
 * Get the type of a specific output path (supports nested paths like "email.subject")
 */
export function getBlockOutputType(
  blockType: string,
  outputPath: string,
  subBlocks?: Record<string, any>,
  triggerMode?: boolean
): string {
  // 1. Purpose: This function retrieves the data type of a specific output path within a block. It supports nested paths
  //    (e.g., "email.subject") and handles special cases like the "files" output type.
  // 2. Args:
  //    - blockType (string): The type of the block.
  //    - outputPath (string): The path to the output, which can be a nested path using dot notation (e.g., "email.subject").
  //    - subBlocks (Record<string, any>, optional): A dictionary of sub-block configurations. Defaults to undefined.
  //    - triggerMode (boolean, optional): Whether the block is in trigger mode. Defaults to undefined.
  // 3. Return:
  //    - string: A string representing the data type of the output at the specified path (e.g., "string", "number", "files", "any").
  //      Returns "any" if the path is not found or if the type cannot be determined.

  // Get the block's outputs using the `getBlockOutputs` function.
  const outputs = getBlockOutputs(blockType, subBlocks, triggerMode)

  // Remove array index notation from the path (e.g., "[0]") as it's not needed for type resolution.
  const arrayIndexRegex = /\[(\d+)\]/g
  const cleanPath = outputPath.replace(arrayIndexRegex, '')
  // Split the path into an array of parts using the dot as a delimiter. Filter out any empty strings that might result from consecutive dots.
  const pathParts = cleanPath.split('.').filter(Boolean)

  // Define a mapping of file property names to their respective types. This is used for handling the "files" output type.
  const filePropertyTypes: Record<string, string> = {
    url: 'string',
    name: 'string',
    size: 'number',
    type: 'string',
    key: 'string',
    uploadedAt: 'string',
    expiresAt: 'string',
  }

  // Check if the last part of the path corresponds to a property of a "files" output.
  const lastPart = pathParts[pathParts.length - 1]
  if (lastPart && filePropertyTypes[lastPart]) {
    const parentPath = pathParts.slice(0, -1).join('.')
    let current: any = outputs
    for (const part of pathParts.slice(0, -1)) {
      if (!current || typeof current !== 'object') break
      current = current[part]
    }
    if (current && typeof current === 'object' && 'type' in current && current.type === 'files') {
      return filePropertyTypes[lastPart]
    }
  }

  // Start traversing the `outputs` object from the root.
  let current: any = outputs

  // Iterate over the path parts.
  for (const part of pathParts) {
    // If the current object is not an object or is null/undefined, the path is invalid, so return "any".
    if (!current || typeof current !== 'object') {
      return 'any'
    }
    // Move to the next level in the object based on the current path part.
    current = current[part]
  }

  // If the current object is null/undefined after traversing the path, the path is not found, so return "any".
  if (!current) return 'any'

  // If the current object has a 'type' property, return its value. This indicates that the output at the specified path has a defined type.
  if (typeof current === 'object' && 'type' in current) {
    return current.type
  }

  // If the current object is a string, return it. This handles cases where the output type is directly a string (although this is less common).
  return typeof current === 'string' ? current : 'any'
}
```