```typescript
import { db } from '@sim/db'
import { customTools } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CustomToolsPersistence')

interface CustomTool {
  id?: string
  type: 'custom-tool'
  title: string
  toolId?: string
  schema: {
    function: {
      name?: string
      description: string
      parameters: Record<string, any>
    }
  }
  code: string
  usageControl?: string
}

/**
 * Extract all custom tools from agent blocks in the workflow state
 */
export function extractCustomToolsFromWorkflowState(workflowState: any): CustomTool[] {
  const customToolsMap = new Map<string, CustomTool>()

  if (!workflowState?.blocks) {
    return []
  }

  for (const [blockId, block] of Object.entries(workflowState.blocks)) {
    try {
      const blockData = block as any

      // Only process agent blocks
      if (!blockData || blockData.type !== 'agent') {
        continue
      }

      const subBlocks = blockData.subBlocks || {}
      const toolsSubBlock = subBlocks.tools

      if (!toolsSubBlock?.value) {
        continue
      }

      let tools = toolsSubBlock.value

      // Parse if it's a string
      if (typeof tools === 'string') {
        try {
          tools = JSON.parse(tools)
        } catch (error) {
          logger.warn(`Failed to parse tools in block ${blockId}`, { error })
          continue
        }
      }

      if (!Array.isArray(tools)) {
        continue
      }

      // Extract custom tools
      for (const tool of tools) {
        if (
          tool &&
          typeof tool === 'object' &&
          tool.type === 'custom-tool' &&
          tool.title &&
          tool.schema?.function &&
          tool.code
        ) {
          // Use toolId if available, otherwise generate one from title
          const toolKey = tool.toolId || tool.title

          // Deduplicate by toolKey (if same tool appears in multiple blocks)
          if (!customToolsMap.has(toolKey)) {
            customToolsMap.set(toolKey, tool as CustomTool)
          }
        }
      }
    } catch (error) {
      logger.error(`Error extracting custom tools from block ${blockId}`, { error })
    }
  }

  return Array.from(customToolsMap.values())
}

/**
 * Persist custom tools to the database
 * Creates new tools or updates existing ones
 */
export async function persistCustomToolsToDatabase(
  customToolsList: CustomTool[],
  userId: string
): Promise<{ saved: number; errors: string[] }> {
  if (!customToolsList || customToolsList.length === 0) {
    return { saved: 0, errors: [] }
  }

  const errors: string[] = []
  let saved = 0

  try {
    await db.transaction(async (tx) => {
      for (const tool of customToolsList) {
        try {
          // Extract the base identifier (without 'custom_' prefix) for database storage
          // If toolId exists and has the prefix, strip it; otherwise use title as base
          let baseId: string
          if (tool.toolId) {
            baseId = tool.toolId.startsWith('custom_')
              ? tool.toolId.replace('custom_', '')
              : tool.toolId
          } else {
            // Use title as the base identifier (agent handler will add 'custom_' prefix)
            baseId = tool.title
          }

          const nowTime = new Date()

          // Check if tool already exists
          const existingTool = await tx
            .select()
            .from(customTools)
            .where(eq(customTools.id, baseId))
            .limit(1)

          if (existingTool.length === 0) {
            // Create new tool
            await tx.insert(customTools).values({
              id: baseId,
              userId,
              title: tool.title,
              schema: tool.schema,
              code: tool.code,
              createdAt: nowTime,
              updatedAt: nowTime,
            })

            logger.info(`Created custom tool: ${tool.title}`, { toolId: baseId })
            saved++
          } else if (existingTool[0].userId === userId) {
            // Update existing tool if it belongs to the user
            await tx
              .update(customTools)
              .set({
                title: tool.title,
                schema: tool.schema,
                code: tool.code,
                updatedAt: nowTime,
              })
              .where(eq(customTools.id, baseId))

            logger.info(`Updated custom tool: ${tool.title}`, { toolId: baseId })
            saved++
          } else {
            // Tool exists but belongs to different user - skip
            logger.warn(`Skipping custom tool - belongs to different user: ${tool.title}`, {
              toolId: baseId,
            })
            errors.push(`Tool ${tool.title} belongs to a different user`)
          }
        } catch (error) {
          const errorMsg = `Failed to persist tool ${tool.title}: ${error instanceof Error ? error.message : String(error)}`
          logger.error(errorMsg, { error })
          errors.push(errorMsg)
        }
      }
    })
  } catch (error) {
    const errorMsg = `Transaction failed while persisting custom tools: ${error instanceof Error ? error.message : String(error)}`
    logger.error(errorMsg, { error })
    errors.push(errorMsg)
  }

  return { saved, errors }
}

/**
 * Extract and persist custom tools from workflow state in one operation
 */
export async function extractAndPersistCustomTools(
  workflowState: any,
  userId: string
): Promise<{ saved: number; errors: string[] }> {
  const customToolsList = extractCustomToolsFromWorkflowState(workflowState)

  if (customToolsList.length === 0) {
    logger.debug('No custom tools found in workflow state')
    return { saved: 0, errors: [] }
  }

  logger.info(`Found ${customToolsList.length} custom tool(s) to persist`, {
    tools: customToolsList.map((t) => t.title),
  })

  return await persistCustomToolsToDatabase(customToolsList, userId)
}
```

## Explanation of the Code:

This TypeScript file is responsible for extracting custom tools from a workflow state, persisting them to a database, and handling updates to existing tools. It uses the `drizzle-orm` library for database interactions, and a custom logger for logging information, warnings, and errors.

**1. Imports:**

- `db` from `@sim/db`:  Imports the database connection object, presumably configured elsewhere in the project.  This is the main entry point for interacting with the database.
- `customTools` from `@sim/db/schema`: Imports the database schema definition for the `customTools` table.  This defines the structure of the `custom_tools` table in the database, including column names and data types.
- `eq` from `drizzle-orm`: Imports the `eq` (equals) function from `drizzle-orm`. This is used to create equality conditions in database queries (e.g., `WHERE id = 'someId'`).
- `createLogger` from `@/lib/logs/console/logger`: Imports a function to create a logger instance.  This is used for logging messages to the console (or potentially other logging destinations).

**2. Logger Initialization:**

- `const logger = createLogger('CustomToolsPersistence')`:  Creates a logger instance with the label 'CustomToolsPersistence'.  This allows you to easily identify log messages originating from this file.

**3. `CustomTool` Interface:**

- This interface defines the structure of a custom tool object. It includes properties like:
    - `id`:  The unique identifier of the tool (optional).
    - `type`:  The type of the tool (always 'custom-tool').
    - `title`:  The human-readable name of the tool.
    - `toolId`:  An optional identifier provided, potentially from another system.
    - `schema`:  An object containing the tool's function definition, including its name, description, and parameters.
    - `code`:  The actual code that implements the tool's functionality.
    - `usageControl`: Optional setting to control the tool usage

**4. `extractCustomToolsFromWorkflowState` Function:**

- **Purpose:**  This function extracts custom tool definitions from a complex `workflowState` object.  The workflow state is assumed to be a nested structure containing blocks, sub-blocks, and potentially serialized data.

- **Logic Breakdown:**

    - `const customToolsMap = new Map<string, CustomTool>()`:  Initializes a `Map` to store custom tools, using the tool's ID (or title as a fallback) as the key. This is used to prevent duplicate tools from being extracted.

    - `if (!workflowState?.blocks) { return [] }`: Early return if the workflow state doesn't contain any blocks.

    - `for (const [blockId, block] of Object.entries(workflowState.blocks))`: Iterates through each block in the `workflowState.blocks` object.  `Object.entries` provides both the key (blockId) and the value (block) for each block.

    - `try { ... } catch (error) { ... }`:  Wraps the block processing logic in a `try...catch` block to handle potential errors during extraction.

    - `if (!blockData || blockData.type !== 'agent') { continue }`: Checks if the current block is an "agent" block.  Only agent blocks are processed, as they are assumed to contain custom tool definitions.

    - `const subBlocks = blockData.subBlocks || {}`:  Gets the `subBlocks` property of the current block.  If `subBlocks` is undefined, it defaults to an empty object to avoid errors.

    - `const toolsSubBlock = subBlocks.tools`:  Gets the `tools` sub-block, which is expected to contain the tool definitions.

    - `if (!toolsSubBlock?.value) { continue }`:  Checks if the `tools` sub-block has a `value` property. If not, it means there are no tools defined in this block, so the loop continues to the next block.

    - `let tools = toolsSubBlock.value`: Assigns the value of `toolsSubBlock.value` to the `tools` variable.

    - `if (typeof tools === 'string') { ... }`: Checks if the `tools` value is a string.  If it is, it attempts to parse it as JSON. This handles the case where the tool definitions are stored as a serialized JSON string.

    - `if (!Array.isArray(tools)) { continue }`:  Checks if the `tools` value is an array. If not, it skips to the next block.

    - `for (const tool of tools)`:  Iterates through each tool in the `tools` array.

    - `if (tool && typeof tool === 'object' && tool.type === 'custom-tool' && tool.title && tool.schema?.function && tool.code)`:  Performs a series of checks to ensure that the current item in the array is a valid custom tool object.

    - `const toolKey = tool.toolId || tool.title`:  Determines the key to use for the tool in the `customToolsMap`. It prefers `tool.toolId` if it exists, otherwise it uses `tool.title`.

    - `if (!customToolsMap.has(toolKey)) { customToolsMap.set(toolKey, tool as CustomTool) }`:  Adds the tool to the `customToolsMap` if it doesn't already exist.  This ensures that only unique tools are extracted.

    - `return Array.from(customToolsMap.values())`:  Converts the values of the `customToolsMap` (which are the custom tool objects) into an array and returns it.

**5. `persistCustomToolsToDatabase` Function:**

- **Purpose:**  This function takes a list of `CustomTool` objects and persists them to the database.  It either creates new tools or updates existing ones based on their ID.  Crucially, it handles cases where a tool already exists but belongs to a different user.

- **Logic Breakdown:**

    - `if (!customToolsList || customToolsList.length === 0) { return { saved: 0, errors: [] } }`:  Handles the case where the input list is empty or null.

    - `const errors: string[] = []`:  Initializes an array to store any errors that occur during the persistence process.

    - `let saved = 0`:  Initializes a counter to track the number of tools that were successfully saved or updated.

    - `try { await db.transaction(async (tx) => { ... }) } catch (error) { ... }`:  Executes the persistence logic within a database transaction.  This ensures that either all tools are saved successfully, or none are (atomicity).

    - `for (const tool of customToolsList)`: Iterates through each tool in the input list.

    - `let baseId: string`: Declares a variable to store the base identifier for the tool.

    - `if (tool.toolId) { ... } else { ... }`: Determines the base ID for the tool.  If `tool.toolId` exists, it checks if it starts with "custom_" and removes it. Otherwise, `tool.title` is used as the base ID.  The prefix stripping is important because the client-side may add this prefix, but the database ID should be the core ID.

    - `const nowTime = new Date()`: Gets the current timestamp for setting `createdAt` and `updatedAt` fields.

    - `const existingTool = await tx.select().from(customTools).where(eq(customTools.id, baseId)).limit(1)`: Checks if a tool with the same ID already exists in the database. The `.limit(1)` is added for efficiency, as we only need to know if at least one record exists.

    - `if (existingTool.length === 0) { ... }`:  If the tool doesn't exist, it creates a new record in the `customTools` table.

    - `else if (existingTool[0].userId === userId) { ... }`: If the tool *does* exist, it checks if the existing tool belongs to the *same* user as the one provided in the function arguments.  This is a crucial security check to prevent users from modifying tools that belong to others.

    - `else { ... }`: If the tool exists but belongs to a *different* user, it logs a warning and adds an error message to the `errors` array.  The tool is not updated.

    - The `insert` and `update` queries use the `tx` (transaction) object to ensure that the operations are performed within the database transaction.

    - Error handling within the loop logs individual tool persistence failures and adds error messages to the `errors` array.

    - The outer `catch` block handles errors that occur during the transaction itself.

    - Returns an object containing the number of saved tools and the array of errors.

**6. `extractAndPersistCustomTools` Function:**

- **Purpose:**  This is a convenience function that combines the `extractCustomToolsFromWorkflowState` and `persistCustomToolsToDatabase` functions into a single operation.

- **Logic Breakdown:**

    - Calls `extractCustomToolsFromWorkflowState` to get the list of custom tools from the workflow state.
    - Logs a debug message if no custom tools are found.
    - Logs an info message indicating the number of custom tools found.
    - Calls `persistCustomToolsToDatabase` to save the extracted tools to the database.
    - Returns the result of `persistCustomToolsToDatabase` (which includes the number of saved tools and any errors).

**In Summary:**

This file provides a robust and well-structured solution for extracting and persisting custom tools.  It includes comprehensive error handling, logging, and database transaction management to ensure data integrity and security. The code is also designed to prevent duplicate tools and to handle cases where tools already exist in the database, including those that belong to different users.  The use of `drizzle-orm` provides a type-safe and efficient way to interact with the database.
