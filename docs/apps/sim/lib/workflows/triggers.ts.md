```typescript
import { getBlock } from '@/blocks'

/**
 * Unified trigger type definitions
 */
export const TRIGGER_TYPES = {
  INPUT: 'input_trigger',
  MANUAL: 'manual_trigger',
  CHAT: 'chat_trigger',
  API: 'api_trigger',
  WEBHOOK: 'webhook',
  SCHEDULE: 'schedule',
  STARTER: 'starter', // Legacy
} as const

export type TriggerType = (typeof TRIGGER_TYPES)[keyof typeof TRIGGER_TYPES]

/**
 * Mapping from reference alias (used in inline refs like <api.*>, <chat.*>, etc.)
 * to concrete trigger block type identifiers used across the system.
 */
export const TRIGGER_REFERENCE_ALIAS_MAP = {
  start: TRIGGER_TYPES.STARTER,
  api: TRIGGER_TYPES.API,
  chat: TRIGGER_TYPES.CHAT,
  manual: TRIGGER_TYPES.INPUT,
} as const

export type TriggerReferenceAlias = keyof typeof TRIGGER_REFERENCE_ALIAS_MAP

/**
 * Trigger classification and utilities
 */
export class TriggerUtils {
  /**
   * Check if a block is any kind of trigger
   */
  static isTriggerBlock(block: { type: string; triggerMode?: boolean }): boolean {
    const blockConfig = getBlock(block.type)

    return (
      // New trigger blocks (explicit category)
      blockConfig?.category === 'triggers' ||
      // Blocks with trigger mode enabled
      block.triggerMode === true ||
      // Legacy starter block
      block.type === TRIGGER_TYPES.STARTER
    )
  }

  /**
   * Check if a block is a specific trigger type
   */
  static isTriggerType(block: { type: string }, triggerType: TriggerType): boolean {
    return block.type === triggerType
  }

  /**
   * Check if a type string is any trigger type
   */
  static isAnyTriggerType(type: string): boolean {
    return Object.values(TRIGGER_TYPES).includes(type as TriggerType)
  }

  /**
   * Check if a block is a chat-compatible trigger
   */
  static isChatTrigger(block: { type: string; subBlocks?: any }): boolean {
    if (block.type === TRIGGER_TYPES.CHAT) {
      return true
    }

    // Legacy: starter block in chat mode
    if (block.type === TRIGGER_TYPES.STARTER) {
      return block.subBlocks?.startWorkflow?.value === 'chat'
    }

    return false
  }

  /**
   * Check if a block is a manual-compatible trigger
   */
  static isManualTrigger(block: { type: string; subBlocks?: any }): boolean {
    if (block.type === TRIGGER_TYPES.INPUT || block.type === TRIGGER_TYPES.MANUAL) {
      return true
    }

    // Legacy: starter block in manual mode or without explicit mode (default to manual)
    if (block.type === TRIGGER_TYPES.STARTER) {
      // If startWorkflow is not set or is set to 'manual', treat as manual trigger
      const startWorkflowValue = block.subBlocks?.startWorkflow?.value
      return startWorkflowValue === 'manual' || startWorkflowValue === undefined
    }

    return false
  }

  /**
   * Check if a block is an API-compatible trigger
   * @param block - Block to check
   * @param isChildWorkflow - Whether this is being called from a child workflow context
   */
  static isApiTrigger(block: { type: string; subBlocks?: any }, isChildWorkflow = false): boolean {
    if (isChildWorkflow) {
      // Child workflows (workflow-in-workflow) only work with input_trigger
      return block.type === TRIGGER_TYPES.INPUT
    }
    // Direct API calls only work with api_trigger
    if (block.type === TRIGGER_TYPES.API) {
      return true
    }

    // Legacy: starter block in API mode
    if (block.type === TRIGGER_TYPES.STARTER) {
      const mode = block.subBlocks?.startWorkflow?.value
      return mode === 'api' || mode === 'run'
    }

    return false
  }

  /**
   * Get the default name for a trigger type
   */
  static getDefaultTriggerName(triggerType: string): string | null {
    // Use the block's actual name from the registry
    const block = getBlock(triggerType)
    if (block) {
      // Special case for generic_webhook - show as "Webhook" in UI
      if (triggerType === 'generic_webhook') {
        return 'Webhook'
      }
      return block.name
    }

    // Fallback for legacy or unknown types
    switch (triggerType) {
      case TRIGGER_TYPES.CHAT:
        return 'Chat'
      case TRIGGER_TYPES.INPUT:
        return 'Input Trigger'
      case TRIGGER_TYPES.MANUAL:
        return 'Manual'
      case TRIGGER_TYPES.API:
        return 'API'
      case TRIGGER_TYPES.WEBHOOK:
        return 'Webhook'
      case TRIGGER_TYPES.SCHEDULE:
        return 'Schedule'
      default:
        return null
    }
  }

  /**
   * Find trigger blocks of a specific type in a workflow
   */
  static findTriggersByType<T extends { type: string; subBlocks?: any }>(
    blocks: T[] | Record<string, T>,
    triggerType: 'chat' | 'manual' | 'api',
    isChildWorkflow = false
  ): T[] {
    const blockArray = Array.isArray(blocks) ? blocks : Object.values(blocks)

    switch (triggerType) {
      case 'chat':
        return blockArray.filter((block) => TriggerUtils.isChatTrigger(block))
      case 'manual':
        return blockArray.filter((block) => TriggerUtils.isManualTrigger(block))
      case 'api':
        return blockArray.filter((block) => TriggerUtils.isApiTrigger(block, isChildWorkflow))
      default:
        return []
    }
  }

  /**
   * Find the appropriate start block for a given execution context
   */
  static findStartBlock<T extends { type: string; subBlocks?: any }>(
    blocks: Record<string, T>,
    executionType: 'chat' | 'manual' | 'api',
    isChildWorkflow = false
  ): { blockId: string; block: T } | null {
    const entries = Object.entries(blocks)

    // Look for new trigger blocks first
    const triggers = TriggerUtils.findTriggersByType(blocks, executionType, isChildWorkflow)
    if (triggers.length > 0) {
      const blockId = entries.find(([, b]) => b === triggers[0])?.[0]
      if (blockId) {
        return { blockId, block: triggers[0] }
      }
    }

    // Legacy fallback: look for starter block
    const starterEntry = entries.find(([, block]) => block.type === TRIGGER_TYPES.STARTER)
    if (starterEntry) {
      return { blockId: starterEntry[0], block: starterEntry[1] }
    }

    return null
  }

  /**
   * Check if multiple triggers of a restricted type exist
   */
  static hasMultipleTriggers<T extends { type: string }>(
    blocks: T[] | Record<string, T>,
    triggerType: TriggerType
  ): boolean {
    const blockArray = Array.isArray(blocks) ? blocks : Object.values(blocks)
    const count = blockArray.filter((block) => block.type === triggerType).length
    return count > 1
  }

  /**
   * Check if a trigger type requires single instance constraint
   */
  static requiresSingleInstance(triggerType: string): boolean {
    // Each trigger type can only have one instance of itself
    // Manual and Input Form can coexist
    // API, Chat triggers must be unique
    // Schedules and webhooks can have multiple instances
    return (
      triggerType === TRIGGER_TYPES.API ||
      triggerType === TRIGGER_TYPES.INPUT ||
      triggerType === TRIGGER_TYPES.MANUAL ||
      triggerType === TRIGGER_TYPES.CHAT
    )
  }

  /**
   * Check if a workflow has a legacy starter block
   */
  static hasLegacyStarter<T extends { type: string }>(blocks: T[] | Record<string, T>): boolean {
    const blockArray = Array.isArray(blocks) ? blocks : Object.values(blocks)
    return blockArray.some((block) => block.type === TRIGGER_TYPES.STARTER)
  }

  /**
   * Check if adding a trigger would violate single instance constraint
   */
  static wouldViolateSingleInstance<T extends { type: string }>(
    blocks: T[] | Record<string, T>,
    triggerType: string
  ): boolean {
    const blockArray = Array.isArray(blocks) ? blocks : Object.values(blocks)
    const hasLegacyStarter = TriggerUtils.hasLegacyStarter(blocks)

    // Legacy starter block can't coexist with Chat, Input, Manual, or API triggers
    if (hasLegacyStarter) {
      if (
        triggerType === TRIGGER_TYPES.CHAT ||
        triggerType === TRIGGER_TYPES.INPUT ||
        triggerType === TRIGGER_TYPES.MANUAL ||
        triggerType === TRIGGER_TYPES.API
      ) {
        return true
      }
    }

    if (triggerType === TRIGGER_TYPES.STARTER) {
      const hasModernTriggers = blockArray.some(
        (block) =>
          block.type === TRIGGER_TYPES.CHAT ||
          block.type === TRIGGER_TYPES.INPUT ||
          block.type === TRIGGER_TYPES.MANUAL ||
          block.type === TRIGGER_TYPES.API
      )
      if (hasModernTriggers) {
        return true
      }
    }

    // Only one Input trigger allowed
    if (triggerType === TRIGGER_TYPES.INPUT) {
      return blockArray.some((block) => block.type === TRIGGER_TYPES.INPUT)
    }

    // Only one Manual trigger allowed
    if (triggerType === TRIGGER_TYPES.MANUAL) {
      return blockArray.some((block) => block.type === TRIGGER_TYPES.MANUAL)
    }

    // Only one API trigger allowed
    if (triggerType === TRIGGER_TYPES.API) {
      return blockArray.some((block) => block.type === TRIGGER_TYPES.API)
    }

    // Chat trigger must be unique
    if (triggerType === TRIGGER_TYPES.CHAT) {
      return blockArray.some((block) => block.type === TRIGGER_TYPES.CHAT)
    }

    // Centralized rule: only API, Input, Chat are single-instance
    if (!TriggerUtils.requiresSingleInstance(triggerType)) {
      return false
    }

    return blockArray.some((block) => block.type === triggerType)
  }

  /**
   * Evaluate whether adding a trigger of the given type is allowed and, if not, why.
   * Returns null if allowed; otherwise returns an object describing the violation.
   * This avoids duplicating UI logic across toolbar/drop handlers.
   */
  static getTriggerAdditionIssue<T extends { type: string }>(
    blocks: T[] | Record<string, T>,
    triggerType: string
  ): { issue: 'legacy' | 'duplicate'; triggerName: string } | null {
    if (!TriggerUtils.wouldViolateSingleInstance(blocks, triggerType)) {
      return null
    }

    // Legacy starter present + adding modern trigger → legacy incompatibility
    if (TriggerUtils.hasLegacyStarter(blocks) && TriggerUtils.isAnyTriggerType(triggerType)) {
      return { issue: 'legacy', triggerName: 'new trigger' }
    }

    // Otherwise treat as duplicate of a single-instance trigger
    const triggerName = TriggerUtils.getDefaultTriggerName(triggerType) || 'trigger'
    return { issue: 'duplicate', triggerName }
  }

  /**
   * Get trigger validation message
   */
  static getTriggerValidationMessage(
    triggerType: 'chat' | 'manual' | 'api',
    issue: 'missing' | 'multiple'
  ): string {
    const triggerName = triggerType.charAt(0).toUpperCase() + triggerType.slice(1)

    if (issue === 'missing') {
      return `${triggerName} execution requires a ${triggerName} Trigger block`
    }

    return `Multiple ${triggerName} Trigger blocks found. Keep only one.`
  }
}
```

## Detailed Explanation of the TypeScript Code

This TypeScript code defines a utility class, `TriggerUtils`, along with supporting types and constants, to manage and validate trigger blocks within a workflow system. Trigger blocks are the entry points or initiators of workflows, defining how and when a workflow starts. The code handles both modern trigger types and a legacy "starter" block, ensuring compatibility and providing validation logic.

### 1. Purpose of the File

The primary purpose of this file is to provide a centralized location for:

-   Defining trigger types and their aliases.
-   Implementing utility functions to identify, validate, and manage trigger blocks within a workflow.
-   Handling compatibility between legacy and modern trigger implementations.
-   Providing helper functions to find the appropriate trigger block for a given execution context (e.g., chat, API).

### 2. Simplification of Complex Logic

The code simplifies complex logic by:

-   **Abstraction:** Encapsulating trigger-related logic within the `TriggerUtils` class.
-   **Constants:** Defining trigger types as constants (`TRIGGER_TYPES`) to avoid magic strings and improve maintainability.
-   **Helper Functions:** Providing specialized functions for common tasks like checking trigger types, finding triggers, and validating trigger configurations.
-   **Clear Separation of Concerns:** Separating the definition of trigger types, aliases, and utility functions.
-   **Handling Legacy Code:** Gradually deprecating legacy trigger types by encapsulating them in specific areas.

### 3. Line-by-Line Explanation

**a) Imports**

```typescript
import { getBlock } from '@/blocks'
```

-   `import { getBlock } from '@/blocks'`: Imports the `getBlock` function from the `@/blocks` module. This function is presumably used to retrieve block configuration details based on a block type.  It's likely that the `getBlock` function fetches metadata (like name, category) associated with a given block type identifier.

**b) Trigger Type Definitions**

```typescript
/**
 * Unified trigger type definitions
 */
export const TRIGGER_TYPES = {
  INPUT: 'input_trigger',
  MANUAL: 'manual_trigger',
  CHAT: 'chat_trigger',
  API: 'api_trigger',
  WEBHOOK: 'webhook',
  SCHEDULE: 'schedule',
  STARTER: 'starter', // Legacy
} as const

export type TriggerType = (typeof TRIGGER_TYPES)[keyof typeof TRIGGER_TYPES]
```

-   `export const TRIGGER_TYPES = { ... } as const`: Defines a constant object `TRIGGER_TYPES` that maps descriptive names (e.g., `INPUT`, `MANUAL`) to unique string identifiers for each trigger type (e.g., `'input_trigger'`, `'manual_trigger'`).  The `as const` assertion makes the object deeply read-only, ensuring that the values cannot be accidentally modified and allowing TypeScript to infer more specific types. The `STARTER` type is marked as "Legacy," indicating it's an older implementation.
-   `export type TriggerType = (typeof TRIGGER_TYPES)[keyof typeof TRIGGER_TYPES]`: Defines a TypeScript type `TriggerType` as a union of all the values in the `TRIGGER_TYPES` object. This creates a type that can only be one of the trigger type strings (e.g., `'input_trigger' | 'manual_trigger' | ...`).  This provides strong type checking when working with trigger types.

**c) Trigger Reference Alias Map**

```typescript
/**
 * Mapping from reference alias (used in inline refs like <api.*>, <chat.*>, etc.)
 * to concrete trigger block type identifiers used across the system.
 */
export const TRIGGER_REFERENCE_ALIAS_MAP = {
  start: TRIGGER_TYPES.STARTER,
  api: TRIGGER_TYPES.API,
  chat: TRIGGER_TYPES.CHAT,
  manual: TRIGGER_TYPES.INPUT,
} as const

export type TriggerReferenceAlias = keyof typeof TRIGGER_REFERENCE_ALIAS_MAP
```

-   `export const TRIGGER_REFERENCE_ALIAS_MAP = { ... } as const`: Defines a constant object `TRIGGER_REFERENCE_ALIAS_MAP` that maps shorter, more user-friendly aliases (e.g., `api`, `chat`) to the corresponding trigger type identifiers defined in `TRIGGER_TYPES`. These aliases are likely used in a templating system or UI to refer to triggers without using the full, more technical type strings.  Again, `as const` makes the object deeply read-only.
-   `export type TriggerReferenceAlias = keyof typeof TRIGGER_REFERENCE_ALIAS_MAP`: Defines a TypeScript type `TriggerReferenceAlias` as a union of all the *keys* in the `TRIGGER_REFERENCE_ALIAS_MAP` object.  This type represents the possible aliases (e.g., `'start' | 'api' | 'chat' | 'manual'`).

**d) TriggerUtils Class**

The `TriggerUtils` class provides static methods for working with trigger blocks.

*   `static isTriggerBlock(block: { type: string; triggerMode?: boolean }): boolean`: Checks if a given block is a trigger block. It considers three possibilities:
    *   If `getBlock(block.type)?.category === 'triggers'`: The block's configuration, fetched using `getBlock`, has a `category` property set to `'triggers'`.  This is the primary way to identify modern trigger blocks.
    *   `block.triggerMode === true`:  The block has a `triggerMode` property explicitly set to `true`.
    *   `block.type === TRIGGER_TYPES.STARTER`:  The block's `type` is `TRIGGER_TYPES.STARTER`, indicating a legacy starter block.

*   `static isTriggerType(block: { type: string }, triggerType: TriggerType): boolean`: Checks if a given block is of a specific trigger type. It simply compares the `block.type` to the provided `triggerType`.

*   `static isAnyTriggerType(type: string): boolean`: Checks if a given type string is a valid trigger type by checking if it exists in the `TRIGGER_TYPES` values.

*   `static isChatTrigger(block: { type: string; subBlocks?: any }): boolean`: Checks if a given block is a chat trigger. It checks two conditions:
    *   `block.type === TRIGGER_TYPES.CHAT`: If the block's type is directly the chat trigger type.
    *   (Legacy) `block.type === TRIGGER_TYPES.STARTER && block.subBlocks?.startWorkflow?.value === 'chat'`: If the block is a legacy starter block and its `startWorkflow` sub-block is set to `'chat'`.

*   `static isManualTrigger(block: { type: string; subBlocks?: any }): boolean`: Checks if a given block is a manual trigger. It checks multiple conditions:
    *   `block.type === TRIGGER_TYPES.INPUT || block.type === TRIGGER_TYPES.MANUAL`: The block is directly an input or manual trigger.
    *   (Legacy) `block.type === TRIGGER_TYPES.STARTER`: If the block is a legacy starter block, it checks the `startWorkflow` sub-block:
        *   `startWorkflowValue === 'manual' || startWorkflowValue === undefined`:  If `startWorkflow` is set to `'manual'` or is not defined, it's considered a manual trigger (likely the default behavior of the legacy starter block).

*   `static isApiTrigger(block: { type: string; subBlocks?: any }, isChildWorkflow = false): boolean`: Checks if a given block is an API trigger. This method takes an optional `isChildWorkflow` parameter to handle different trigger requirements in child workflows.
    *   `isChildWorkflow && block.type === TRIGGER_TYPES.INPUT`: In child workflows, only the `INPUT` trigger type is considered an API trigger.  This suggests that child workflows use a generic input mechanism to receive data from the parent workflow.
    *   `block.type === TRIGGER_TYPES.API`:  For direct API calls, the block must be of the `API` trigger type.
    *   (Legacy) `block.type === TRIGGER_TYPES.STARTER`: If it's a legacy starter block, it checks if `startWorkflow` is set to `'api'` or `'run'`.

*   `static getDefaultTriggerName(triggerType: string): string | null`: Gets the default name for a given trigger type.
    *   It first tries to get the block configuration using `getBlock(triggerType)`. If found, it returns the block's `name` property, with a special case for `'generic_webhook'` to display as `"Webhook"` in the UI.
    *   If the block configuration is not found, it falls back to a `switch` statement that provides default names for known trigger types. If the `triggerType` is not recognized, it returns `null`.

*   `static findTriggersByType<T extends { type: string; subBlocks?: any }>( blocks: T[] | Record<string, T>, triggerType: 'chat' | 'manual' | 'api', isChildWorkflow = false ): T[]`: Finds all trigger blocks of a specific type within a given set of blocks.
    *   It accepts either an array or an object of blocks.
    *   It uses a `switch` statement to determine which `is...Trigger` function to use based on the `triggerType` parameter (e.g., `isChatTrigger`, `isManualTrigger`, `isApiTrigger`). It uses the `isChildWorkflow` to decide if this is a child workflow or not.
    *   It filters the block array based on the selected `is...Trigger` function and returns the resulting array of matching trigger blocks.

*   `static findStartBlock<T extends { type: string; subBlocks?: any }>( blocks: Record<string, T>, executionType: 'chat' | 'manual' | 'api', isChildWorkflow = false ): { blockId: string; block: T } | null`: Finds the appropriate start block for a given execution context (chat, manual, or API).
    *   It first attempts to find modern trigger blocks using `TriggerUtils.findTriggersByType`.
    *   If modern triggers are found, it returns the first one along with its block ID.
    *   If no modern triggers are found, it falls back to searching for a legacy starter block.
    *   If a legacy starter block is found, it returns it along with its block ID.
    *   If no suitable start block is found, it returns `null`.

*   `static hasMultipleTriggers<T extends { type: string }>( blocks: T[] | Record<string, T>, triggerType: TriggerType ): boolean`: Checks if there are multiple triggers of a specific type in the given set of blocks. It returns `true` if more than one trigger of the specified type is found, and `false` otherwise.

*   `static requiresSingleInstance(triggerType: string): boolean`: Checks if a given trigger type requires a single instance constraint. This method centralizes the logic for determining which trigger types can only have one instance in a workflow. API, Input, Manual, and Chat triggers have only one instance allowed.

*   `static hasLegacyStarter<T extends { type: string }>(blocks: T[] | Record<string, T>): boolean`: Checks if a workflow has a legacy starter block. It simply checks if any block in the provided set has the `type` equal to `TRIGGER_TYPES.STARTER`.

*   `static wouldViolateSingleInstance<T extends { type: string }>( blocks: T[] | Record<string, T>, triggerType: string ): boolean`: Checks if adding a new trigger of the given type would violate the single instance constraint. This is a complex method that handles various scenarios, including the presence of legacy starter blocks and the specific constraints of different trigger types.  It ensures that adding a new trigger doesn't conflict with existing triggers or the legacy starter block.

*   `static getTriggerAdditionIssue<T extends { type: string }>( blocks: T[] | Record<string, T>, triggerType: string ): { issue: 'legacy' | 'duplicate'; triggerName: string } | null`: Evaluates whether adding a trigger of the given type is allowed and, if not, why. This is useful for providing informative error messages in the UI.
    *   If `wouldViolateSingleInstance` returns `false` (no violation), it returns `null`.
    *   If a legacy starter block is present and a modern trigger is being added, it returns an object indicating a `'legacy'` issue.
    *   Otherwise, it returns an object indicating a `'duplicate'` issue, along with the trigger name.

*   `static getTriggerValidationMessage( triggerType: 'chat' | 'manual' | 'api', issue: 'missing' | 'multiple' ): string`: Generates a user-friendly validation message based on the trigger type and the type of issue (missing or multiple).  This helps in providing clear and consistent feedback to the user when trigger configurations are invalid.

### Summary

This code provides a comprehensive set of tools for managing and validating trigger blocks in a workflow system. It addresses the complexities of handling both modern and legacy trigger implementations, enforces single-instance constraints where necessary, and provides helpful functions for finding and validating triggers based on different execution contexts. The use of TypeScript enhances the code's reliability and maintainability through strong type checking.
