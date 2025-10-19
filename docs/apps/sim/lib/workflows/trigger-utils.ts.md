```typescript
import { getAllBlocks, getBlock } from '@/blocks';
import type { BlockConfig } from '@/blocks/types';

export interface TriggerInfo {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  category: 'core' | 'integration';
  enableTriggerMode?: boolean;
}

/**
 * Get all blocks that can act as triggers
 * This includes both dedicated trigger blocks and tools with trigger capabilities
 */
export function getAllTriggerBlocks(): TriggerInfo[] {
  const allBlocks = getAllBlocks();
  const triggers: TriggerInfo[] = [];

  for (const block of allBlocks) {
    // Skip hidden blocks
    if (block.hideFromToolbar) continue;

    // Check if it's a core trigger block (category: 'triggers')
    if (block.category === 'triggers') {
      triggers.push({
        id: block.type,
        name: block.name,
        description: block.description,
        icon: block.icon,
        color: block.bgColor,
        category: 'core',
      });
    }
    // Check if it's a tool with trigger capability (has trigger-config subblock)
    else if (hasTriggerCapability(block)) {
      triggers.push({
        id: block.type,
        name: block.name,
        description: block.description.replace(' or trigger workflows from ', ', trigger from '),
        icon: block.icon,
        color: block.bgColor,
        category: 'integration',
        enableTriggerMode: true,
      });
    }
  }

  // Sort: core triggers first, then integration triggers, alphabetically within each category
  return triggers.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category === 'core' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Check if a block has trigger capability (contains a trigger-config subblock)
 */
export function hasTriggerCapability(block: BlockConfig): boolean {
  return block.subBlocks.some((subBlock) => subBlock.type === 'trigger-config');
}

/**
 * Get blocks that should appear in the triggers tab
 * This includes all trigger blocks and tools with trigger mode
 */
export function getTriggersForSidebar(): BlockConfig[] {
  const allBlocks = getAllBlocks();
  return allBlocks.filter((block) => {
    if (block.hideFromToolbar) return false;
    // Include blocks with triggers category or trigger-config subblock
    return block.category === 'triggers' || hasTriggerCapability(block);
  });
}

/**
 * Get blocks that should appear in the blocks tab
 * This excludes only dedicated trigger blocks, not tools with trigger capability
 */
export function getBlocksForSidebar(): BlockConfig[] {
  const allBlocks = getAllBlocks();
  return allBlocks.filter((block) => {
    if (block.hideFromToolbar) return false;
    if (block.type === 'starter') return false; // Legacy block
    // Only exclude blocks with 'triggers' category
    // Tools with trigger capability should still appear in blocks tab
    return block.category !== 'triggers';
  });
}

/**
 * Get the proper display name for a trigger block in the UI
 */
export function getTriggerDisplayName(blockType: string): string {
  const block = getBlock(blockType);
  if (!block) return blockType;

  // Special case for generic_webhook - show as "Webhook" in UI
  if (blockType === 'generic_webhook') {
    return 'Webhook';
  }

  return block.name;
}
```

### Purpose of this file

This TypeScript file defines functions and interfaces related to managing and displaying blocks, specifically focusing on trigger blocks within a workflow or application.  It handles retrieving all available blocks, identifying which blocks can act as triggers, and filtering blocks for display in different sections of the user interface (e.g., a "Triggers" tab versus a "Blocks" tab).  It also provides a mechanism for customizing the display name of trigger blocks.

### Explanation of each section:

**1. Imports:**

```typescript
import { getAllBlocks, getBlock } from '@/blocks';
import type { BlockConfig } from '@/blocks/types';
```

*   **`import { getAllBlocks, getBlock } from '@/blocks';`**: This line imports two functions, `getAllBlocks` and `getBlock`, from a module located at the path `@/blocks`.
    *   `getAllBlocks()`:  Presumably, this function retrieves a list of all available blocks in the application.
    *   `getBlock(blockType: string)`:  This function retrieves a specific block configuration given its `blockType`.
*   **`import type { BlockConfig } from '@/blocks/types';`**: This line imports a type definition, `BlockConfig`, from a module located at `@/blocks/types`.  The `type` keyword specifies that this is only a type import and doesn't import any runtime code.  This type likely represents the structure of a block's configuration object.

**2. `TriggerInfo` Interface:**

```typescript
export interface TriggerInfo {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  category: 'core' | 'integration';
  enableTriggerMode?: boolean;
}
```

*   This interface defines the structure of an object that represents trigger information. This interface is used to represent trigger blocks in a simplified format.
    *   `id: string;`: A unique identifier for the trigger.
    *   `name: string;`: The human-readable name of the trigger.
    *   `description: string;`: A description of what the trigger does.
    *   `icon: React.ComponentType<{ className?: string }>;`: A React component that renders the icon for the trigger.  The `className` prop allows for styling the icon.
    *   `color: string;`: The color associated with the trigger, likely for visual representation.
    *   `category: 'core' | 'integration';`:  Categorizes the trigger as either a "core" trigger (fundamental to the system) or an "integration" trigger (related to external services).
    *   `enableTriggerMode?: boolean;`:  An optional boolean indicating whether the trigger has a special "trigger mode," likely influencing its behavior or UI representation.

**3. `getAllTriggerBlocks` Function:**

```typescript
/**
 * Get all blocks that can act as triggers
 * This includes both dedicated trigger blocks and tools with trigger capabilities
 */
export function getAllTriggerBlocks(): TriggerInfo[] {
  const allBlocks = getAllBlocks();
  const triggers: TriggerInfo[] = [];

  for (const block of allBlocks) {
    // Skip hidden blocks
    if (block.hideFromToolbar) continue;

    // Check if it's a core trigger block (category: 'triggers')
    if (block.category === 'triggers') {
      triggers.push({
        id: block.type,
        name: block.name,
        description: block.description,
        icon: block.icon,
        color: block.bgColor,
        category: 'core',
      });
    }
    // Check if it's a tool with trigger capability (has trigger-config subblock)
    else if (hasTriggerCapability(block)) {
      triggers.push({
        id: block.type,
        name: block.name,
        description: block.description.replace(' or trigger workflows from ', ', trigger from '),
        icon: block.icon,
        color: block.bgColor,
        category: 'integration',
        enableTriggerMode: true,
      });
    }
  }

  // Sort: core triggers first, then integration triggers, alphabetically within each category
  return triggers.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category === 'core' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}
```

*   This function retrieves all blocks that can act as triggers. It considers both dedicated trigger blocks (blocks explicitly designed to be triggers) and tools that have trigger capabilities.
    *   `const allBlocks = getAllBlocks();`:  Calls the `getAllBlocks` function to get an array of all block configurations.
    *   `const triggers: TriggerInfo[] = [];`:  Initializes an empty array called `triggers` to store the `TriggerInfo` objects that represent the identified trigger blocks.
    *   **`for (const block of allBlocks) { ... }`**: Iterates through each block in the `allBlocks` array.
        *   `if (block.hideFromToolbar) continue;`: Skips the current block if its `hideFromToolbar` property is `true`. This allows hiding blocks from the toolbar, likely used for internal or deprecated blocks.
        *   **`if (block.category === 'triggers') { ... }`**: Checks if the current block's `category` is equal to `"triggers"`.  If so, it's considered a core trigger block.
            *   `triggers.push({ ... });`:  Creates a `TriggerInfo` object from the block's properties (`id`, `name`, `description`, `icon`, `bgColor`) and pushes it onto the `triggers` array. The `category` is explicitly set to `'core'`.
        *   **`else if (hasTriggerCapability(block)) { ... }`**: If the block is not a core trigger, this checks if it *has* trigger capabilities by calling the `hasTriggerCapability` function.
            *   `triggers.push({ ... });`:  If the block has trigger capability, a `TriggerInfo` object is created and added to the `triggers` array.
                *   `description: block.description.replace(' or trigger workflows from ', ', trigger from '),`: Modifies the description of the trigger, replacing "or trigger workflows from" with ", trigger from".  This is likely to standardize the description text.
                *   `category: 'integration'`:  Sets the category to "integration" to indicate that this is not a core trigger.
                *   `enableTriggerMode: true`:  Sets the `enableTriggerMode` flag to `true`, indicating that this trigger has a special trigger mode.
    *   **`return triggers.sort((a, b) => { ... });`**: After iterating through all blocks, this sorts the `triggers` array.
        *   Sorting Logic:
            *   `if (a.category !== b.category) { return a.category === 'core' ? -1 : 1; }`:  If the categories are different, sort based on the category. "core" triggers come before "integration" triggers.
            *   `return a.name.localeCompare(b.name);`:  If the categories are the same, sort alphabetically by the trigger's name using `localeCompare` for proper string comparison.

**4. `hasTriggerCapability` Function:**

```typescript
/**
 * Check if a block has trigger capability (contains a trigger-config subblock)
 */
export function hasTriggerCapability(block: BlockConfig): boolean {
  return block.subBlocks.some((subBlock) => subBlock.type === 'trigger-config');
}
```

*   This function checks if a given block has trigger capabilities. It determines this by checking if the block's `subBlocks` array contains a sub-block with the type `"trigger-config"`.
    *   `return block.subBlocks.some((subBlock) => subBlock.type === 'trigger-config');`: This line uses the `some()` method to iterate through the `subBlocks` array. The `some()` method returns `true` if at least one element in the array satisfies the provided testing function (in this case, `subBlock.type === 'trigger-config'`), and `false` otherwise.  In essence, it checks if a "trigger-config" sub-block exists within the block's configuration.

**5. `getTriggersForSidebar` Function:**

```typescript
/**
 * Get blocks that should appear in the triggers tab
 * This includes all trigger blocks and tools with trigger mode
 */
export function getTriggersForSidebar(): BlockConfig[] {
  const allBlocks = getAllBlocks();
  return allBlocks.filter((block) => {
    if (block.hideFromToolbar) return false;
    // Include blocks with triggers category or trigger-config subblock
    return block.category === 'triggers' || hasTriggerCapability(block);
  });
}
```

*   This function returns an array of `BlockConfig` objects that should be displayed in the "Triggers" tab of the user interface.  It includes dedicated trigger blocks and tools with trigger capabilities.
    *   `const allBlocks = getAllBlocks();`:  Retrieves all blocks.
    *   `return allBlocks.filter((block) => { ... });`:  Filters the `allBlocks` array based on a condition.
        *   `if (block.hideFromToolbar) return false;`: Excludes hidden blocks.
        *   `return block.category === 'triggers' || hasTriggerCapability(block);`:  Includes blocks if their `category` is `"triggers"` (dedicated trigger) or if they have trigger capabilities (as determined by `hasTriggerCapability`).

**6. `getBlocksForSidebar` Function:**

```typescript
/**
 * Get blocks that should appear in the blocks tab
 * This excludes only dedicated trigger blocks, not tools with trigger capability
 */
export function getBlocksForSidebar(): BlockConfig[] {
  const allBlocks = getAllBlocks();
  return allBlocks.filter((block) => {
    if (block.hideFromToolbar) return false;
    if (block.type === 'starter') return false; // Legacy block
    // Only exclude blocks with 'triggers' category
    // Tools with trigger capability should still appear in blocks tab
    return block.category !== 'triggers';
  });
}
```

*   This function returns an array of `BlockConfig` objects that should be displayed in the "Blocks" tab of the user interface.  It excludes *only* dedicated trigger blocks (blocks with `category: 'triggers'`), but *includes* tools that have trigger capabilities.
    *   `const allBlocks = getAllBlocks();`: Retrieves all blocks.
    *   `return allBlocks.filter((block) => { ... });`:  Filters the `allBlocks` array.
        *   `if (block.hideFromToolbar) return false;`: Excludes hidden blocks.
        *   `if (block.type === 'starter') return false;`: Excludes blocks of type 'starter'. This is likely a legacy block that should no longer be displayed.
        *   `return block.category !== 'triggers';`: Includes blocks whose `category` is *not* `"triggers"`. This ensures that only dedicated trigger blocks are excluded from the "Blocks" tab.  Tools with trigger capabilities are still included because they might also have other functionalities beyond triggering.

**7. `getTriggerDisplayName` Function:**

```typescript
/**
 * Get the proper display name for a trigger block in the UI
 */
export function getTriggerDisplayName(blockType: string): string {
  const block = getBlock(blockType);
  if (!block) return blockType;

  // Special case for generic_webhook - show as "Webhook" in UI
  if (blockType === 'generic_webhook') {
    return 'Webhook';
  }

  return block.name;
}
```

*   This function retrieves the appropriate display name for a trigger block, given its `blockType`. It allows for customizing the display name in the UI.
    *   `const block = getBlock(blockType);`: Retrieves the block configuration using the `getBlock` function.
    *   `if (!block) return blockType;`: If the block is not found (i.e., `getBlock` returns `null` or `undefined`), it returns the original `blockType`. This provides a fallback if the block configuration is missing.
    *   **`if (blockType === 'generic_webhook') { return 'Webhook'; }`**:  This is a special case. If the `blockType` is `"generic_webhook"`, it returns the string `"Webhook"`.  This provides a more user-friendly display name for this specific type of trigger.
    *   `return block.name;`:  If no special case applies, it returns the block's `name` property as the display name.

### Summary and Simplifications

This file provides a set of utility functions for managing and displaying trigger blocks in a workflow application.

**Simplified Logic:**

*   **`getAllTriggerBlocks`**:  Combines logic to identify both dedicated trigger blocks and tools with trigger capabilities into a single, sorted list.
*   **`hasTriggerCapability`**:  Provides a clear and concise way to determine if a block has trigger capabilities based on the presence of a specific sub-block.
*   **`getTriggersForSidebar` and `getBlocksForSidebar`**:  Define the logic for which blocks to show in the "Triggers" and "Blocks" tabs, respectively, providing a clean separation of concerns for UI presentation.
*   **`getTriggerDisplayName`**: Abstracted the logic of what display name should be used in the UI.
