Okay, let's break down this TypeScript file.

**1. Purpose of this file:**

This file contains utility functions for managing workflows within the application. It handles tasks like:

*   Fetching workflow data.
*   Checking user permissions for accessing workflows.
*   Updating workflow statistics.
*   Comparing workflow states to detect changes.
*   Sanitizing workflow data for comparison.
*   Creating HTTP responses from workflow executions.

In essence, it's a central place for workflow-related logic, abstracting database interactions, permission checks, and state comparisons into reusable functions.

**2. Code Explanation (Line by Line):**

```typescript
import { db } from '@sim/db'
import { apiKey, permissions, workflow as workflowTable, workspace } from '@sim/db/schema'
import type { InferSelectModel } from 'drizzle-orm'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import type { PermissionType } from '@/lib/permissions/utils'
import { getBaseUrl } from '@/lib/urls/utils'
import type { ExecutionResult } from '@/executor/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
```

*   **`import { db } from '@sim/db'`**: Imports the database connection object (`db`) from a module. This likely uses Drizzle ORM to interact with the database.
*   **`import { apiKey, permissions, workflow as workflowTable, workspace } from '@sim/db/schema'`**: Imports database schema definitions for `apiKey`, `permissions`, `workflow` (renamed as `workflowTable` to avoid naming conflicts), and `workspace` tables. These are likely Drizzle ORM schema objects.
*   **`import type { InferSelectModel } from 'drizzle-orm'`**: Imports a type utility `InferSelectModel` from Drizzle ORM. This utility allows you to infer the TypeScript type of a database table's select model, based on the table's schema.
*   **`import { and, eq } from 'drizzle-orm'`**: Imports `and` and `eq` functions from Drizzle ORM. These are used to construct SQL `AND` and `EQUALS` conditions in database queries.
*   **`import { NextResponse } from 'next/server'`**: Imports `NextResponse` from `next/server`. This is used to create HTTP responses in Next.js route handlers.
*   **`import { getSession } from '@/lib/auth'`**: Imports `getSession` function from the application's authentication library. This function is used to retrieve the current user's session.
*   **`import { createLogger } from '@/lib/logs/console/logger'`**: Imports `createLogger` function. This is used to create a logger instance for logging messages.
*   **`import type { PermissionType } from '@/lib/permissions/utils'`**: Imports `PermissionType` type from a permissions utility module. This type likely defines the possible permission levels (e.g., 'read', 'write', 'admin').
*   **`import { getBaseUrl } from '@/lib/urls/utils'`**: Imports `getBaseUrl` function. This function is used to get the base URL of the application.
*   **`import type { ExecutionResult } from '@/executor/types'`**: Imports `ExecutionResult` type. Represents the result of executing a workflow.
*   **`import type { WorkflowState } from '@/stores/workflows/workflow/types'`**: Imports `WorkflowState` type.  Represents the state of a workflow, typically used in the frontend store.

```typescript
const logger = createLogger('WorkflowUtils')
```

*   **`const logger = createLogger('WorkflowUtils')`**: Creates a logger instance with the name 'WorkflowUtils'.  This allows for easy identification of log messages originating from this file.

```typescript
const WORKFLOW_BASE_SELECTION = {
  id: workflowTable.id,
  userId: workflowTable.userId,
  workspaceId: workflowTable.workspaceId,
  folderId: workflowTable.folderId,
  name: workflowTable.name,
  description: workflowTable.description,
  color: workflowTable.color,
  lastSynced: workflowTable.lastSynced,
  createdAt: workflowTable.createdAt,
  updatedAt: workflowTable.updatedAt,
  isDeployed: workflowTable.isDeployed,
  deployedState: workflowTable.deployedState,
  deployedAt: workflowTable.deployedAt,
  pinnedApiKeyId: workflowTable.pinnedApiKeyId,
  collaborators: workflowTable.collaborators,
  runCount: workflowTable.runCount,
  lastRunAt: workflowTable.lastRunAt,
  variables: workflowTable.variables,
  isPublished: workflowTable.isPublished,
  marketplaceData: workflowTable.marketplaceData,
  pinnedApiKeyKey: apiKey.key,
  pinnedApiKeyName: apiKey.name,
  pinnedApiKeyType: apiKey.type,
  pinnedApiKeyWorkspaceId: apiKey.workspaceId,
}
```

*   **`const WORKFLOW_BASE_SELECTION = { ... }`**: Defines a constant object `WORKFLOW_BASE_SELECTION`. This object specifies which columns to select from the `workflowTable` and `apiKey` tables when fetching workflow data. This is a performance optimization to avoid selecting unnecessary columns. It also includes related `apiKey` information based on the `pinnedApiKeyId`.

```typescript
type WorkflowSelection = InferSelectModel<typeof workflowTable>
type ApiKeySelection = InferSelectModel<typeof apiKey>

type WorkflowRow = WorkflowSelection & {
  pinnedApiKeyKey: ApiKeySelection['key'] | null
  pinnedApiKeyName: ApiKeySelection['name'] | null
  pinnedApiKeyType: ApiKeySelection['type'] | null
  pinnedApiKeyWorkspaceId: ApiKeySelection['workspaceId'] | null
}

type WorkflowWithPinnedKey = WorkflowSelection & {
  pinnedApiKey: Pick<ApiKeySelection, 'id' | 'name' | 'key' | 'type' | 'workspaceId'> | null
}
```

*   **`type WorkflowSelection = InferSelectModel<typeof workflowTable>`**: Defines a TypeScript type `WorkflowSelection` using `InferSelectModel`. This type represents the shape of a workflow object when selected from the database. Drizzle ORM automatically infers the type based on the `workflowTable` schema.
*   **`type ApiKeySelection = InferSelectModel<typeof apiKey>`**: Defines a TypeScript type `ApiKeySelection` using `InferSelectModel`. This type represents the shape of an API key object when selected from the database.
*   **`type WorkflowRow = WorkflowSelection & { ... }`**: Defines a TypeScript type `WorkflowRow`. This type extends `WorkflowSelection` to include the `key`, `name`, `type`, and `workspaceId` of the pinned API key.  The `| null` allows these properties to be null if no API key is pinned. This type represents the raw data structure returned from the database query, combining workflow and API key data.
*   **`type WorkflowWithPinnedKey = WorkflowSelection & { pinnedApiKey: ... | null }`**: Defines a TypeScript type `WorkflowWithPinnedKey`.  This type extends `WorkflowSelection` to include a `pinnedApiKey` property. This property is either an object containing the `id`, `name`, `key`, `type`, and `workspaceId` of the pinned API key, or `null` if no API key is pinned. This is the type used *after* mapping the raw `WorkflowRow` to a more structured object. `Pick` utility type is used to select only specific properties from `ApiKeySelection`.

```typescript
function mapWorkflowRow(row: WorkflowRow | undefined): WorkflowWithPinnedKey | undefined {
  if (!row) {
    return undefined
  }

  const {
    pinnedApiKeyKey,
    pinnedApiKeyName,
    pinnedApiKeyType,
    pinnedApiKeyWorkspaceId,
    ...workflowWithoutDerived
  } = row

  const pinnedApiKey =
    workflowWithoutDerived.pinnedApiKeyId && pinnedApiKeyKey && pinnedApiKeyName && pinnedApiKeyType
      ? {
          id: workflowWithoutDerived.pinnedApiKeyId,
          name: pinnedApiKeyName,
          key: pinnedApiKeyKey,
          type: pinnedApiKeyType,
          workspaceId: pinnedApiKeyWorkspaceId,
        }
      : null

  return {
    ...workflowWithoutDerived,
    pinnedApiKey,
  }
}
```

*   **`function mapWorkflowRow(row: WorkflowRow | undefined): WorkflowWithPinnedKey | undefined { ... }`**: Defines a function `mapWorkflowRow` that transforms a `WorkflowRow` (raw database result) into a `WorkflowWithPinnedKey` (a more structured object).
    *   It handles the case where `row` is `undefined` (no workflow found).
    *   It destructures the `WorkflowRow` to extract the `pinnedApiKeyKey`, `pinnedApiKeyName`, `pinnedApiKeyType`, and `pinnedApiKeyWorkspaceId` properties, as well as the rest of the workflow properties into `workflowWithoutDerived`.
    *   It constructs the `pinnedApiKey` object based on whether a pinned API key exists ( `workflowWithoutDerived.pinnedApiKeyId && pinnedApiKeyKey && pinnedApiKeyName && pinnedApiKeyType`).
    *   Finally, it returns a new object combining the `workflowWithoutDerived` properties with the `pinnedApiKey` object.

```typescript
export async function getWorkflowById(id: string) {
  const rows = await db
    .select(WORKFLOW_BASE_SELECTION)
    .from(workflowTable)
    .leftJoin(apiKey, eq(workflowTable.pinnedApiKeyId, apiKey.id))
    .where(eq(workflowTable.id, id))
    .limit(1)

  return mapWorkflowRow(rows[0] as WorkflowRow | undefined)
}
```

*   **`export async function getWorkflowById(id: string) { ... }`**: Defines an asynchronous function `getWorkflowById` that retrieves a workflow by its ID.
    *   It uses Drizzle ORM to select data from the `workflowTable` and perform a `leftJoin` with the `apiKey` table (based on `workflowTable.pinnedApiKeyId` and `apiKey.id`).  A left join ensures that all workflows are returned, even if they don't have a pinned API key.
    *   It filters the results using `where(eq(workflowTable.id, id))` to only retrieve the workflow with the matching ID.
    *   `limit(1)` is added to optimize the query, as it expects only one workflow with a given ID.
    *   It calls the `mapWorkflowRow` function to transform the raw database result (`rows[0]`) into a `WorkflowWithPinnedKey` object.

```typescript
type WorkflowRecord = ReturnType<typeof getWorkflowById> extends Promise<infer R>
  ? NonNullable<R>
  : never
```

*   **`type WorkflowRecord = ReturnType<typeof getWorkflowById> extends Promise<infer R> ? NonNullable<R> : never`**: Defines a TypeScript type `WorkflowRecord`. This is a utility type that extracts the return type of the `getWorkflowById` function. Specifically, it unwraps the `Promise` and the `Nullable` from the return type. This ensures that `WorkflowRecord` will be the workflow object type or `never` if `getWorkflowById` never returns anything.

```typescript
export interface WorkflowAccessContext {
  workflow: WorkflowRecord
  workspaceOwnerId: string | null
  workspacePermission: PermissionType | null
  isOwner: boolean
  isWorkspaceOwner: boolean
}
```

*   **`export interface WorkflowAccessContext { ... }`**: Defines a TypeScript interface `WorkflowAccessContext`. This interface represents the context in which a user is accessing a workflow. It includes the workflow itself (`workflow`), information about the workspace (owner ID and permission level), and boolean flags indicating whether the user is the workflow owner or the workspace owner.

```typescript
export async function getWorkflowAccessContext(
  workflowId: string,
  userId?: string
): Promise<WorkflowAccessContext | null> {
  const rows = await db
    .select({
      ...WORKFLOW_BASE_SELECTION,
      workspaceOwnerId: workspace.ownerId,
      workspacePermission: permissions.permissionType,
    })
    .from(workflowTable)
    .leftJoin(apiKey, eq(workflowTable.pinnedApiKeyId, apiKey.id))
    .leftJoin(workspace, eq(workspace.id, workflowTable.workspaceId))
    .leftJoin(
      permissions,
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workflowTable.workspaceId),
        userId ? eq(permissions.userId, userId) : eq(permissions.userId, '' as unknown as string)
      )
    )
    .where(eq(workflowTable.id, workflowId))
    .limit(1)

  const row = rows[0] as
    | (WorkflowRow & {
        workspaceOwnerId: string | null
        workspacePermission: PermissionType | null
      })
    | undefined

  if (!row) {
    return null
  }

  const workflow = mapWorkflowRow(row as WorkflowRow)

  if (!workflow) {
    return null
  }

  const resolvedWorkspaceOwner = row.workspaceOwnerId ?? null
  const resolvedWorkspacePermission = row.workspacePermission ?? null

  const resolvedUserId = userId ?? null

  const isOwner = resolvedUserId ? workflow.userId === resolvedUserId : false
  const isWorkspaceOwner = resolvedUserId ? resolvedWorkspaceOwner === resolvedUserId : false

  return {
    workflow,
    workspaceOwnerId: resolvedWorkspaceOwner,
    workspacePermission: resolvedWorkspacePermission,
    isOwner,
    isWorkspaceOwner,
  }
}
```

*   **`export async function getWorkflowAccessContext(workflowId: string, userId?: string): Promise<WorkflowAccessContext | null> { ... }`**: Defines an asynchronous function `getWorkflowAccessContext` that retrieves the access context for a given workflow and user.
    *   It fetches workflow data, workspace owner ID, and user's workspace permission in a single database query.
    *   It uses `leftJoin` to join `workflowTable` with `apiKey`, `workspace`, and `permissions` tables.
    *   It constructs a complex `AND` condition for the `permissions` join to filter permissions based on the workspace ID and user ID. If no `userId` is provided, the query uses an empty string for the user ID, effectively returning no permissions. This part `userId ? eq(permissions.userId, userId) : eq(permissions.userId, '' as unknown as string)` is a bit tricky.  It's trying to handle cases where a user isn't logged in.  It casts the empty string to `string as unknown` to satisfy the type checker, which might be improved with a better default value for `permissions.userId`.
    *   It transforms the raw database result into a `WorkflowAccessContext` object.
    *   It determines whether the user is the workflow owner or the workspace owner based on the fetched data.
    *   It returns `null` if the workflow is not found.

```typescript
export async function updateWorkflowRunCounts(workflowId: string, runs = 1) {
  try {
    const workflow = await getWorkflowById(workflowId)
    if (!workflow) {
      logger.error(`Workflow ${workflowId} not found`)
      throw new Error(`Workflow ${workflowId} not found`)
    }

    // Use the API to update stats
    const response = await fetch(`${getBaseUrl()}/api/workflows/${workflowId}/stats?runs=${runs}`, {
      method: 'POST',
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to update workflow stats')
    }

    return response.json()
  } catch (error) {
    logger.error(`Error updating workflow stats for ${workflowId}`, error)
    throw error
  }
}
```

*   **`export async function updateWorkflowRunCounts(workflowId: string, runs = 1) { ... }`**: Defines an asynchronous function `updateWorkflowRunCounts` that updates the run count for a given workflow.
    *   It first retrieves the workflow by ID to ensure it exists.
    *   It then makes an HTTP `POST` request to an API endpoint (`/api/workflows/${workflowId}/stats`) to update the run count.  This indicates that the actual run count update logic is handled by a separate API.
    *   It handles potential errors during the API request.
    *   It logs errors using the logger instance.

```typescript
/**
 * Sanitize tools array by removing UI-only fields
 * @param tools - The tools array to sanitize
 * @returns A sanitized tools array
 */
function sanitizeToolsForComparison(tools: any[] | undefined): any[] {
  if (!Array.isArray(tools)) {
    return []
  }

  return tools.map((tool) => {
    // Remove UI-only field: isExpanded
    const { isExpanded, ...cleanTool } = tool
    return cleanTool
  })
}

/**
 * Sanitize inputFormat array by removing test-only value fields
 * @param inputFormat - The inputFormat array to sanitize
 * @returns A sanitized inputFormat array without test values
 */
function sanitizeInputFormatForComparison(inputFormat: any[] | undefined): any[] {
  if (!Array.isArray(inputFormat)) {
    return []
  }

  return inputFormat.map((field) => {
    // Remove test-only field: value (used only for manual testing)
    const { value, collapsed, ...cleanField } = field
    return cleanField
  })
}
```

*   **`function sanitizeToolsForComparison(tools: any[] | undefined): any[] { ... }`**: Defines a function `sanitizeToolsForComparison` that removes UI-specific properties (like `isExpanded`) from an array of "tool" objects. This is likely used to compare workflow states without considering UI-related differences.  It is often necessary to remove these values for comparing the "functional" parts of the workflow.
*   **`function sanitizeInputFormatForComparison(inputFormat: any[] | undefined): any[] { ... }`**: Defines a function `sanitizeInputFormatForComparison` that removes the `value` and `collapsed` properties from an array of `inputFormat` objects. Similar to `sanitizeToolsForComparison`, this likely removes properties used for testing or UI purposes, making the comparison more reliable.

```typescript
/**
 * Normalize a value for consistent comparison by sorting object keys
 * @param value - The value to normalize
 * @returns A normalized version of the value
 */
function normalizeValue(value: any): any {
  // If not an object or array, return as is
  if (value === null || value === undefined || typeof value !== 'object') {
    return value
  }

  // Handle arrays by normalizing each element
  if (Array.isArray(value)) {
    return value.map(normalizeValue)
  }

  // For objects, sort keys and normalize each value
  const sortedObj: Record<string, any> = {}

  // Get all keys and sort them
  const sortedKeys = Object.keys(value).sort()

  // Reconstruct object with sorted keys and normalized values
  for (const key of sortedKeys) {
    sortedObj[key] = normalizeValue(value[key])
  }

  return sortedObj
}

/**
 * Generate a normalized JSON string for comparison
 * @param value - The value to normalize and stringify
 * @returns A normalized JSON string
 */
function normalizedStringify(value: any): string {
  return JSON.stringify(normalizeValue(value))
}
```

*   **`function normalizeValue(value: any): any { ... }`**: Defines a function `normalizeValue` that recursively normalizes a value by sorting the keys of objects. This is crucial for consistent comparisons because the order of keys in a JavaScript object doesn't matter semantically, but `JSON.stringify` will produce different strings for objects with the same key-value pairs in different orders.
    *   It handles `null`, `undefined`, and non-object values by returning them directly.
    *   For arrays, it recursively calls `normalizeValue` on each element.
    *   For objects, it sorts the keys alphabetically and creates a new object with the sorted keys and normalized values.
*   **`function normalizedStringify(value: any): string { ... }`**: Defines a function `normalizedStringify` that normalizes a value using `normalizeValue` and then converts it to a JSON string using `JSON.stringify`. This ensures that the JSON string representation is consistent regardless of the original key order or nested structure of the value.

```typescript
/**
 * Compare the current workflow state with the deployed state to detect meaningful changes
 * @param currentState - The current workflow state
 * @param deployedState - The deployed workflow state
 * @returns True if there are meaningful changes, false if only position changes or no changes
 */
export function hasWorkflowChanged(
  currentState: WorkflowState,
  deployedState: WorkflowState | null
): boolean {
  // If no deployed state exists, then the workflow has changed
  if (!deployedState) return true

  // 1. Compare edges (connections between blocks)
  // First check length
  const currentEdges = currentState.edges || []
  const deployedEdges = deployedState.edges || []

  // Create sorted, normalized representations of the edges for more reliable comparison
  const normalizedCurrentEdges = currentEdges
    .map((edge) => ({
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
    }))
    .sort((a, b) =>
      `${a.source}-${a.sourceHandle}-${a.target}-${a.targetHandle}`.localeCompare(
        `${b.source}-${b.sourceHandle}-${b.target}-${b.targetHandle}`
      )
    )

  const normalizedDeployedEdges = deployedEdges
    .map((edge) => ({
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
    }))
    .sort((a, b) =>
      `${a.source}-${a.sourceHandle}-${a.target}-${a.targetHandle}`.localeCompare(
        `${b.source}-${b.sourceHandle}-${b.target}-${b.targetHandle}`
      )
    )

  // Compare the normalized edge arrays
  if (
    normalizedStringify(normalizedCurrentEdges) !== normalizedStringify(normalizedDeployedEdges)
  ) {
    return true
  }

  // 2. Compare blocks and their configurations
  const currentBlockIds = Object.keys(currentState.blocks || {}).sort()
  const deployedBlockIds = Object.keys(deployedState.blocks || {}).sort()

  // Check if the block IDs are different
  if (
    currentBlockIds.length !== deployedBlockIds.length ||
    normalizedStringify(currentBlockIds) !== normalizedStringify(deployedBlockIds)
  ) {
    return true
  }

  // 3. Build normalized representations of blocks for comparison
  const normalizedCurrentBlocks: Record<string, any> = {}
  const normalizedDeployedBlocks: Record<string, any> = {}

  for (const blockId of currentBlockIds) {
    const currentBlock = currentState.blocks[blockId]
    const deployedBlock = deployedState.blocks[blockId]

    // Destructure and exclude non-functional fields
    const { position: _currentPos, subBlocks: currentSubBlocks = {}, ...currentRest } = currentBlock

    const {
      position: _deployedPos,
      subBlocks: deployedSubBlocks = {},
      ...deployedRest
    } = deployedBlock

    normalizedCurrentBlocks[blockId] = {
      ...currentRest,
      subBlocks: undefined,
    }

    normalizedDeployedBlocks[blockId] = {
      ...deployedRest,
      subBlocks: undefined,
    }

    // Get all subBlock IDs from both states
    const allSubBlockIds = [
      ...new Set([...Object.keys(currentSubBlocks), ...Object.keys(deployedSubBlocks)]),
    ].sort()

    // Check if any subBlocks are missing in either state
    if (Object.keys(currentSubBlocks).length !== Object.keys(deployedSubBlocks).length) {
      return true
    }

    // Normalize and compare each subBlock
    for (const subBlockId of allSubBlockIds) {
      // If the subBlock doesn't exist in either state, there's a difference
      if (!currentSubBlocks[subBlockId] || !deployedSubBlocks[subBlockId]) {
        return true
      }

      // Get values with special handling for null/undefined
      let currentValue = currentSubBlocks[subBlockId].value ?? null
      let deployedValue = deployedSubBlocks[subBlockId].value ?? null

      // Special handling for 'tools' subBlock - sanitize UI-only fields
      if (subBlockId === 'tools' && Array.isArray(currentValue) && Array.isArray(deployedValue)) {
        currentValue = sanitizeToolsForComparison(currentValue)
        deployedValue = sanitizeToolsForComparison(deployedValue)
      }

      // Special handling for 'inputFormat' subBlock - sanitize UI-only fields (collapsed state)
      if (
        subBlockId === 'inputFormat' &&
        Array.isArray(currentValue) &&
        Array.isArray(deployedValue)
      ) {
        currentValue = sanitizeInputFormatForComparison(currentValue)
        deployedValue = sanitizeInputFormatForComparison(deployedValue)
      }

      // For string values, compare directly to catch even small text changes
      if (typeof currentValue === 'string' && typeof deployedValue === 'string') {
        if (currentValue !== deployedValue) {
          return true
        }
      } else {
        // For other types, use normalized comparison
        const normalizedCurrentValue = normalizeValue(currentValue)
        const normalizedDeployedValue = normalizeValue(deployedValue)

        if (
          normalizedStringify(normalizedCurrentValue) !==
          normalizedStringify(normalizedDeployedValue)
        ) {
          return true
        }
      }

      // Compare type and other properties
      const currentSubBlockWithoutValue = { ...currentSubBlocks[subBlockId], value: undefined }
      const deployedSubBlockWithoutValue = { ...deployedSubBlocks[subBlockId], value: undefined }

      if (
        normalizedStringify(currentSubBlockWithoutValue) !==
        normalizedStringify(deployedSubBlockWithoutValue)
      ) {
        return true
      }
    }

    // Skip the normalization of subBlocks since we've already done detailed comparison above
    const blocksEqual =
      normalizedStringify(normalizedCurrentBlocks[blockId]) ===
      normalizedStringify(normalizedDeployedBlocks[blockId])

    // We've already compared subBlocks in detail
    if (!blocksEqual) {
      return true
    }
  }

  // 4. Compare loops
  const currentLoops = currentState.loops || {}
  const deployedLoops = deployedState.loops || {}

  const currentLoopIds = Object.keys(currentLoops).sort()
  const deployedLoopIds = Object.keys(deployedLoops).sort()

  if (
    currentLoopIds.length !== deployedLoopIds.length ||
    normalizedStringify(currentLoopIds) !== normalizedStringify(deployedLoopIds)
  ) {
    return true
  }

  // Compare each loop with normalized values
  for (const loopId of currentLoopIds) {
    const normalizedCurrentLoop = normalizeValue(currentLoops[loopId])
    const normalizedDeployedLoop = normalizeValue(deployedLoops[loopId])

    if (
      normalizedStringify(normalizedCurrentLoop) !== normalizedStringify(normalizedDeployedLoop)
    ) {
      return true
    }
  }

  // 5. Compare parallels
  const currentParallels = currentState.parallels || {}
  const deployedParallels = deployedState.parallels || {}

  const currentParallelIds = Object.keys(currentParallels).sort()
  const deployedParallelIds = Object.keys(deployedParallels).sort()

  if (
    currentParallelIds.length !== deployedParallelIds.length ||
    normalizedStringify(currentParallelIds) !== normalizedStringify(deployedParallelIds)
  ) {
    return true
  }

  // Compare each parallel with normalized values
  for (const parallelId of currentParallelIds) {
    const normalizedCurrentParallel = normalizeValue(currentParallels[parallelId])
    const normalizedDeployedParallel = normalizeValue(deployedParallels[parallelId])

    if (
      normalizedStringify(normalizedCurrentParallel) !==
      normalizedStringify(normalizedDeployedParallel)
    ) {
      return true
    }
  }

  return false
}
```

*   **`export function hasWorkflowChanged(currentState: WorkflowState, deployedState: WorkflowState | null): boolean { ... }`**: This function is the heart of the state comparison logic. It determines if there are meaningful changes between the `currentState` of a workflow and its `deployedState`. It focuses on detecting functional changes rather than superficial ones like node positions. This is critical for deciding when a workflow needs to be redeployed.

    The function performs a deep comparison of the workflow state, considering:

    1.  **Edges (Connections):** Checks if the connections between blocks have changed (source, target, and handles). Edge arrays are normalized and sorted before comparison.
    2.  **Blocks:** Compares the blocks themselves.
        *   First, it checks if the set of block IDs is different.
        *   Then, it iterates through each block, comparing its properties, *excluding* `position` and `subBlocks` initially. The `position` is excluded since changes in position should not trigger a re-deployment.
        *   **SubBlocks:** This is where the comparison gets granular. It compares the `subBlocks` (configuration options within each block). It handles the special cases of `tools` and `inputFormat` subBlocks using the `sanitizeToolsForComparison` and `sanitizeInputFormatForComparison` functions to ignore UI-only properties. For other `subBlocks`, it compares their values using `normalizedStringify`.
    3.  **Loops:** Compares the loop configurations, normalizing the values for reliable comparison.
    4.  **Parallels:** Compares parallel processing configurations, again using normalized values.

    The function returns `true` if *any* meaningful change is detected; otherwise, it returns `false`.

```typescript
export function stripCustomToolPrefix(name: string) {
  return name.startsWith('custom_') ? name.replace('custom_', '') : name
}

export const workflowHasResponseBlock = (executionResult: ExecutionResult): boolean => {
  if (
    !executionResult?.logs ||
    !Array.isArray(executionResult.logs) ||
    !executionResult.success ||
    !executionResult.output.response
  ) {
    return false
  }

  const responseBlock = executionResult.logs.find(
    (log) => log?.blockType === 'response' && log?.success
  )

  return responseBlock !== undefined
}

// Create a HTTP response from response block
export const createHttpResponseFromBlock = (executionResult: ExecutionResult): NextResponse => {
  const output = executionResult.output.response
  const { data = {}, status = 200, headers = {} } = output

  const responseHeaders = new Headers({
    'Content-Type': 'application/json',
    ...headers,
  })

  return NextResponse.json(data, {
    status: status,
    headers: responseHeaders,
  })
}
```

*   **`export function stripCustomToolPrefix(name: string) { ... }`**: Defines a function `stripCustomToolPrefix` that removes the "custom_" prefix from a tool name, if it exists.  This is likely used to normalize tool names for display or comparison.
*   **`export const workflowHasResponseBlock = (executionResult: ExecutionResult): boolean => { ... }`**: Defines a function `workflowHasResponseBlock` that checks if a workflow execution result contains a successful "response" block in its logs. This is used to determine if the workflow is designed to return a custom HTTP response.
*   **`export const createHttpResponseFromBlock = (executionResult: ExecutionResult): NextResponse => { ... }`**: Defines a function `createHttpResponseFromBlock` that creates a Next.js `NextResponse` object from the output of a workflow execution that contains a "response" block.  It extracts the `data`, `status`, and `headers` from the `executionResult.output.response` and uses them to construct the HTTP response.

```typescript
/**
 * Validates that the current user has permission to access/modify a workflow
 * Returns session and workflow info if authorized, or error response if not
 */
export async function validateWorkflowPermissions(
  workflowId: string,
  requestId: string,
  action: 'read' | 'write' | 'admin' = 'read'
) {
  const session = await getSession()
  if (!session?.user?.id) {
    logger.warn(`[${requestId}] No authenticated user session for workflow ${action}`)
    return {
      error: { message: 'Unauthorized', status: 401 },
      session: null,
      workflow: null,
    }
  }

  const accessContext = await getWorkflowAccessContext(workflowId, session.user.id)
  if (!accessContext) {
    logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
    return {
      error: { message: 'Workflow not found', status: 404 },
      session: null,
      workflow: null,
    }
  }

  const { workflow, workspacePermission, isOwner } = accessContext

  if (isOwner) {
    return {
      error: null,
      session,
      workflow,
    }
  }

  if (workflow.workspaceId) {
    let hasPermission = false

    if (action === 'read') {
      // Any workspace permission allows read
      hasPermission = workspacePermission !== null
    } else if (action === 'write') {
      // Write or admin permission allows write
      hasPermission = workspacePermission === 'write' || workspacePermission === 'admin'
    } else if (action === 'admin') {
      // Only admin permission allows admin actions
      hasPermission = workspacePermission === 'admin'
    }

    if (!hasPermission) {
      logger.warn(
        `[${requestId}] User ${session.user.id} unauthorized to ${action} workflow ${workflowId} in workspace ${workflow.workspaceId}`
      )
      return {
        error: { message: `Unauthorized: Access denied to ${action} this workflow`, status: 403 },
        session: null,
        workflow: null,
      }
    }
  } else {
    logger.warn(
      `[${requestId}] User ${session.user.id} unauthorized to ${action} workflow ${workflowId} owned by ${workflow.userId}`
    )
    return {
      error: { message: `Unauthorized: Access denied to ${action} this workflow`, status: 403 },
      session: null,
      workflow: null,
    }
  }

  return {
    error: null,
    session,
    workflow,
  }
}
```

*   **`export async function validateWorkflowPermissions(workflowId: string, requestId: string, action: 'read' | 'write' | 'admin' = 'read') { ... }`**: Defines an asynchronous function `validateWorkflowPermissions` that validates if the current user has the required permission to access or modify a specific workflow. This function is a critical piece of security logic.
    *   It first retrieves the user's session using `getSession()`. If there's no session (user not authenticated), it returns an "Unauthorized" error.
    *   It then retrieves the workflow access context using `getWorkflowAccessContext()