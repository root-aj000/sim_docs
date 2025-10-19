```typescript
/**
 * Test Workflows
 *
 * This file contains test fixtures for serializer tests, providing
 * sample workflow states with different configurations.
 */
import type { Edge } from 'reactflow'
import type { BlockState, Loop } from '@/stores/workflows/workflow/types'

/**
 * Workflow State Interface
 */
export interface WorkflowStateFixture {
  blocks: Record<string, BlockState>
  edges: Edge[]
  loops: Record<string, Loop>
}
```

**Purpose of this file:**

This file serves as a collection of test fixtures for workflow states.  It provides pre-configured `WorkflowStateFixture` objects that can be used in unit and integration tests, particularly for testing serialization and deserialization logic.  These fixtures cover various scenarios, including minimal workflows, workflows with conditional logic, workflows with loops, complex workflows with multiple block types, and workflows with custom tools. Additionally, the file contains fixtures designed to simulate invalid workflow states for error handling tests.

**Explanation of the Code:**

1.  **Imports:**
    *   `import type { Edge } from 'reactflow'`:\
        Imports the `Edge` type from the `reactflow` library. `Edge` represents a connection between two blocks in the workflow diagram. The `type` keyword ensures that only the type information is imported and not the entire `reactflow` library, improving performance.
    *   `import type { BlockState, Loop } from '@/stores/workflows/workflow/types'`:\
        Imports the `BlockState` and `Loop` types from a local file. These types define the structure of a single block and a loop within a workflow, respectively. The `@/stores/workflows/workflow/types` path suggests that these types are part of a state management system (likely using a library like Zustand or Redux) related to workflows.

2.  **`WorkflowStateFixture` Interface:**

    ```typescript
    export interface WorkflowStateFixture {
      blocks: Record<string, BlockState>
      edges: Edge[]
      loops: Record<string, Loop>
    }
    ```

    *   Defines the structure of a workflow state fixture. It contains three properties:
        *   `blocks`: An object where the keys are block IDs (strings) and the values are `BlockState` objects. This represents all the blocks in the workflow.  `Record<string, BlockState>` is a TypeScript utility type that defines an object with string keys and `BlockState` values.
        *   `edges`: An array of `Edge` objects, representing the connections between blocks in the workflow.
        *   `loops`: An object where the keys are loop IDs (strings) and the values are `Loop` objects. This represents any loops defined in the workflow. Similar to `blocks`, `Record<string, Loop>` is an object with string keys and `Loop` values.

3.  **`createMinimalWorkflowState` Function:**

    ```typescript
    /**
     * Create a minimal workflow with just a starter and one block
     */
    export function createMinimalWorkflowState(): WorkflowStateFixture {
      const blocks: Record<string, BlockState> = {
        starter: {
          id: 'starter',
          type: 'starter',
          name: 'Starter Block',
          position: { x: 0, y: 0 },
          subBlocks: {
            description: {
              id: 'description',
              type: 'long-input',
              value: 'This is the starter block',
            },
          },
          outputs: {},
          enabled: true,
        },
        agent1: {
          id: 'agent1',
          type: 'agent',
          name: 'Agent Block',
          position: { x: 300, y: 0 },
          subBlocks: {
            provider: {
              id: 'provider',
              type: 'dropdown',
              value: 'anthropic',
            },
            model: {
              id: 'model',
              type: 'dropdown',
              value: 'claude-3-7-sonnet-20250219',
            },
            prompt: {
              id: 'prompt',
              type: 'long-input',
              value: 'Hello, world!',
            },
            tools: {
              id: 'tools',
              type: 'tool-input',
              value: '[]',
            },
            system: {
              id: 'system',
              type: 'long-input',
              value: 'You are a helpful assistant.',
            },
            responseFormat: {
              id: 'responseFormat',
              type: 'code',
              value: null,
            },
          },
          outputs: {},
          enabled: true,
        },
      }

      const edges: Edge[] = [
        {
          id: 'edge1',
          source: 'starter',
          target: 'agent1',
        },
      ]

      const loops: Record<string, Loop> = {}

      return { blocks, edges, loops }
    }
    ```

    *   Creates a very basic workflow with a "starter" block and an "agent" block.
    *   `blocks`: Defines two blocks:
        *   `starter`: A block of type "starter" with a description.
        *   `agent1`: A block of type "agent" with various sub-blocks defining its configuration (provider, model, prompt, etc.).
    *   `edges`: Defines a single edge connecting the "starter" block to the "agent1" block.
    *   `loops`: An empty object, indicating no loops in this workflow.
    *   Returns a `WorkflowStateFixture` object containing the created blocks, edges, and loops.

4.  **`createConditionalWorkflowState` Function:**

    ```typescript
    /**
     * Create a workflow with condition blocks
     */
    export function createConditionalWorkflowState(): WorkflowStateFixture {
      const blocks: Record<string, BlockState> = {
        starter: {
          id: 'starter',
          type: 'starter',
          name: 'Starter Block',
          position: { x: 0, y: 0 },
          subBlocks: {
            description: {
              id: 'description',
              type: 'long-input',
              value: 'This is the starter block',
            },
          },
          outputs: {},
          enabled: true,
        },
        condition1: {
          id: 'condition1',
          type: 'condition',
          name: 'Condition Block',
          position: { x: 300, y: 0 },
          subBlocks: {
            condition: {
              id: 'condition',
              type: 'long-input',
              value: 'input.value > 10',
            },
          },
          outputs: {},
          enabled: true,
        },
        agent1: {
          id: 'agent1',
          type: 'agent',
          name: 'True Path Agent',
          position: { x: 600, y: -100 },
          subBlocks: {
            provider: {
              id: 'provider',
              type: 'dropdown',
              value: 'anthropic',
            },
            model: {
              id: 'model',
              type: 'dropdown',
              value: 'claude-3-7-sonnet-20250219',
            },
            prompt: {
              id: 'prompt',
              type: 'long-input',
              value: 'Value is greater than 10',
            },
            tools: {
              id: 'tools',
              type: 'tool-input',
              value: '[]',
            },
            system: {
              id: 'system',
              type: 'long-input',
              value: 'You are a helpful assistant.',
            },
            responseFormat: {
              id: 'responseFormat',
              type: 'code',
              value: null,
            },
          },
          outputs: {},
          enabled: true,
        },
        agent2: {
          id: 'agent2',
          type: 'agent',
          name: 'False Path Agent',
          position: { x: 600, y: 100 },
          subBlocks: {
            provider: {
              id: 'provider',
              type: 'dropdown',
              value: 'anthropic',
            },
            model: {
              id: 'model',
              type: 'dropdown',
              value: 'claude-3-7-sonnet-20250219',
            },
            prompt: {
              id: 'prompt',
              type: 'long-input',
              value: 'Value is less than or equal to 10',
            },
            tools: {
              id: 'tools',
              type: 'tool-input',
              value: '[]',
            },
            system: {
              id: 'system',
              type: 'long-input',
              value: 'You are a helpful assistant.',
            },
            responseFormat: {
              id: 'responseFormat',
              type: 'code',
              value: null,
            },
          },
          outputs: {},
          enabled: true,
        },
      }

      const edges: Edge[] = [
        {
          id: 'edge1',
          source: 'starter',
          target: 'condition1',
        },
        {
          id: 'edge2',
          source: 'condition1',
          target: 'agent1',
          sourceHandle: 'condition-true',
        },
        {
          id: 'edge3',
          source: 'condition1',
          target: 'agent2',
          sourceHandle: 'condition-false',
        },
      ]

      const loops: Record<string, Loop> = {}

      return { blocks, edges, loops }
    }
    ```

    *   Creates a workflow that includes a conditional block.
    *   `blocks`: Defines four blocks:
        *   `starter`:  A starter block similar to the minimal workflow.
        *   `condition1`: A "condition" block with a condition defined as `input.value > 10`.  This block likely has two output paths: one for when the condition is true, and one for when it's false.
        *   `agent1`:  An "agent" block that's executed if the condition is true.  Its prompt indicates this ("Value is greater than 10").
        *   `agent2`: An "agent" block that's executed if the condition is false.  Its prompt indicates this ("Value is less than or equal to 10").
    *   `edges`: Defines the connections between the blocks:
        *   `edge1`:  Connects the "starter" to the "condition1" block.
        *   `edge2`:  Connects the "condition1" block to "agent1" using the `condition-true` source handle. This means this edge is taken when the condition is true.
        *   `edge3`:  Connects the "condition1" block to "agent2" using the `condition-false` source handle.  This means this edge is taken when the condition is false.
    *   `loops`: An empty object (no loops).
    *   Returns a `WorkflowStateFixture` representing the conditional workflow.

5.  **`createLoopWorkflowState` Function:**

    ```typescript
    /**
     * Create a workflow with a loop
     */
    export function createLoopWorkflowState(): WorkflowStateFixture {
      const blocks: Record<string, BlockState> = {
        starter: {
          id: 'starter',
          type: 'starter',
          name: 'Starter Block',
          position: { x: 0, y: 0 },
          subBlocks: {
            description: {
              id: 'description',
              type: 'long-input',
              value: 'This is the starter block',
            },
          },
          outputs: {},
          enabled: true,
        },
        function1: {
          id: 'function1',
          type: 'function',
          name: 'Function Block',
          position: { x: 300, y: 0 },
          subBlocks: {
            code: {
              id: 'code',
              type: 'code',
              value: 'let counter = input.counter || 0;\ncounter++;\nreturn { counter };',
            },
            language: {
              id: 'language',
              type: 'dropdown',
              value: 'javascript',
            },
          },
          outputs: {},
          enabled: true,
        },
        condition1: {
          id: 'condition1',
          type: 'condition',
          name: 'Loop Condition',
          position: { x: 600, y: 0 },
          subBlocks: {
            condition: {
              id: 'condition',
              type: 'long-input',
              value: 'input.counter < 5',
            },
          },
          outputs: {},
          enabled: true,
        },
        agent1: {
          id: 'agent1',
          type: 'agent',
          name: 'Loop Complete Agent',
          position: { x: 900, y: 100 },
          subBlocks: {
            provider: {
              id: 'provider',
              type: 'dropdown',
              value: 'anthropic',
            },
            model: {
              id: 'model',
              type: 'dropdown',
              value: 'claude-3-7-sonnet-20250219',
            },
            prompt: {
              id: 'prompt',
              type: 'long-input',
              value: 'Loop completed after {{input.counter}} iterations',
            },
            tools: {
              id: 'tools',
              type: 'tool-input',
              value: '[]',
            },
            system: {
              id: 'system',
              type: 'long-input',
              value: 'You are a helpful assistant.',
            },
            responseFormat: {
              id: 'responseFormat',
              type: 'code',
              value: null,
            },
          },
          outputs: {},
          enabled: true,
        },
      }

      const edges: Edge[] = [
        {
          id: 'edge1',
          source: 'starter',
          target: 'function1',
        },
        {
          id: 'edge2',
          source: 'function1',
          target: 'condition1',
        },
        {
          id: 'edge3',
          source: 'condition1',
          target: 'function1',
          sourceHandle: 'condition-true',
        },
        {
          id: 'edge4',
          source: 'condition1',
          target: 'agent1',
          sourceHandle: 'condition-false',
        },
      ]

      const loops: Record<string, Loop> = {
        loop1: {
          id: 'loop1',
          nodes: ['function1', 'condition1'],
          iterations: 10,
          loopType: 'for',
        },
      }

      return { blocks, edges, loops }
    }
    ```

    *   Creates a workflow that contains a loop.
    *   `blocks`: Defines four blocks:
        *   `starter`: A starter block.
        *   `function1`: A "function" block that increments a counter. The code `let counter = input.counter || 0;\ncounter++;\nreturn { counter };` initializes a counter to 0 if it doesn't exist in the input, increments it, and returns it.
        *   `condition1`: A "condition" block that checks if `input.counter < 5`. This determines whether the loop continues.
        *   `agent1`: An "agent" block that's executed when the loop completes (condition is false).  Its prompt indicates the number of loop iterations.
    *   `edges`: Defines the connections between the blocks to create the loop:
        *   `edge1`: Connects "starter" to "function1".
        *   `edge2`: Connects "function1" to "condition1".
        *   `edge3`: Connects "condition1" back to "function1" using the `condition-true` source handle. This is the loop back edge.
        *   `edge4`: Connects "condition1" to "agent1" using the `condition-false` source handle. This is the exit from the loop.
    *   `loops`: Defines a single loop:
        *   `loop1`:  Specifies that blocks "function1" and "condition1" are part of the loop. It's set to run a maximum of 10 iterations.  The `loopType` is `for`.
    *   Returns a `WorkflowStateFixture` representing the workflow with a loop.

6.  **`createComplexWorkflowState` Function:**

    ```typescript
    /**
     * Create a workflow with multiple block types
     */
    export function createComplexWorkflowState(): WorkflowStateFixture {
      const blocks: Record<string, BlockState> = {
        starter: {
          id: 'starter',
          type: 'starter',
          name: 'Starter Block',
          position: { x: 0, y: 0 },
          subBlocks: {
            description: {
              id: 'description',
              type: 'long-input',
              value: 'This is the starter block',
            },
          },
          outputs: {},
          enabled: true,
        },
        api1: {
          id: 'api1',
          type: 'api',
          name: 'API Request',
          position: { x: 300, y: 0 },
          subBlocks: {
            url: {
              id: 'url',
              type: 'short-input',
              value: 'https://api.example.com/data',
            },
            method: {
              id: 'method',
              type: 'dropdown',
              value: 'GET',
            },
            headers: {
              id: 'headers',
              type: 'table',
              value: [
                ['Content-Type', 'application/json'],
                ['Authorization', 'Bearer {{API_KEY}}'],
              ],
            },
            body: {
              id: 'body',
              type: 'long-input',
              value: '',
            },
          },
          outputs: {},
          enabled: true,
        },
        function1: {
          id: 'function1',
          type: 'function',
          name: 'Process Data',
          position: { x: 600, y: 0 },
          subBlocks: {
            code: {
              id: 'code',
              type: 'code',
              value: 'const data = input.data;\nreturn { processed: data.map(item => item.name) };',
            },
            language: {
              id: 'language',
              type: 'dropdown',
              value: 'javascript',
            },
          },
          outputs: {},
          enabled: true,
        },
        agent1: {
          id: 'agent1',
          type: 'agent',
          name: 'Summarize Data',
          position: { x: 900, y: 0 },
          subBlocks: {
            provider: {
              id: 'provider',
              type: 'dropdown',
              value: 'openai',
            },
            model: {
              id: 'model',
              type: 'dropdown',
              value: 'gpt-4o',
            },
            prompt: {
              id: 'prompt',
              type: 'long-input',
              value: 'Summarize the following data:\n\n{{input.processed}}',
            },
            tools: {
              id: 'tools',
              type: 'tool-input',
              value:
                '[{"type":"function","name":"calculator","description":"Perform calculations","parameters":{"type":"object","properties":{"expression":{"type":"string","description":"Math expression to evaluate"}},"required":["expression"]}}]',
            },
            system: {
              id: 'system',
              type: 'long-input',
              value: 'You are a data analyst assistant.',
            },
            responseFormat: {
              id: 'responseFormat',
              type: 'code',
              value:
                '{"type":"object","properties":{"summary":{"type":"string"},"keyPoints":{"type":"array","items":{"type":"string"}},"sentiment":{"type":"string","enum":["positive","neutral","negative"]}},"required":["summary","keyPoints","sentiment"]}',
            },
          },
          outputs: {},
          enabled: true,
        },
      }

      const edges: Edge[] = [
        {
          id: 'edge1',
          source: 'starter',
          target: 'api1',
        },
        {
          id: 'edge2',
          source: 'api1',
          target: 'function1',
        },
        {
          id: 'edge3',
          source: 'function1',
          target: 'agent1',
        },
      ]

      const loops: Record<string, Loop> = {}

      return { blocks, edges, loops }
    }
    ```

    *   Creates a more complex workflow demonstrating various block types.
    *   `blocks`: Defines four blocks:
        *   `starter`:  A starter block.
        *   `api1`: An "api" block that makes an API request.  It includes configuration for the URL, method (GET), headers (including an `API_KEY` variable), and body.
        *   `function1`: A "function" block that processes the data returned from the API.  The code `const data = input.data;\nreturn { processed: data.map(item => item.name) };` extracts the `name` property from each item in the input data array.
        *   `agent1`: An "agent" block that summarizes the processed data.  It uses the `openai` provider and the `gpt-4o` model. It also defines tools that the agent can use, specifically a calculator tool. The `responseFormat` is defined as JSON.
    *   `edges`: Connects the blocks sequentially: "starter" -> "api1" -> "function1" -> "agent1".
    *   `loops`: An empty object (no loops).
    *   Returns a `WorkflowStateFixture` representing this complex workflow.

7.  **`createAgentWithToolsWorkflowState` Function:**

    ```typescript
    /**
     * Create a workflow with agent blocks that have custom tools
     */
    export function createAgentWithToolsWorkflowState(): WorkflowStateFixture {
      const blocks: Record<string, BlockState> = {
        starter: {
          id: 'starter',
          type: 'starter',
          name: 'Starter Block',
          position: { x: 0, y: 0 },
          subBlocks: {
            description: {
              id: 'description',
              type: 'long-input',
              value: 'This is the starter block',
            },
          },
          outputs: {},
          enabled: true,
        },
        agent1: {
          id: 'agent1',
          type: 'agent',
          name: 'Custom Tools Agent',
          position: { x: 300, y: 0 },
          subBlocks: {
            provider: {
              id: 'provider',
              type: 'dropdown',
              value: 'openai',
            },
            model: {
              id: 'model',
              type: 'dropdown',
              value: 'gpt-4o',
            },
            prompt: {
              id: 'prompt',
              type: 'long-input',
              value: 'Use the tools to help answer: {{input.question}}',
            },
            tools: {
              id: 'tools',
              type: 'tool-input',
              value:
                '[{"type":"custom-tool","name":"weather","description":"Get current weather","parameters":{"type":"object","properties":{"location":{"type":"string"}},"required":["location"]}},{"type":"function","name":"calculator","description":"Calculate expression","parameters":{"type":"object","properties":{"expression":{"type":"string"}},"required":["expression"]}}]',
            },
            system: {
              id: 'system',
              type: 'long-input',
              value: 'You are a helpful assistant with access to tools.',
            },
            responseFormat: {
              id: 'responseFormat',
              type: 'code',
              value: null,
            },
          },
          outputs: {},
          enabled: true,
        },
      }

      const edges: Edge[] = [
        {
          id: 'edge1',
          source: 'starter',
          target: 'agent1',
        },
      ]

      const loops: Record<string, Loop> = {}

      return { blocks, edges, loops }
    }
    ```

    *   Creates a workflow with an agent block that uses custom tools.
    *   `blocks`: Defines two blocks:
        *   `starter`: A starter block.
        *   `agent1`: An agent block configured to use custom tools. The `tools` sub-block contains two tool definitions: a "weather" tool and a "calculator" tool. The weather tool takes a `location` as a parameter, and the calculator tool takes an `expression`.  Note the "type":"custom-tool" property, which indicates that these are external tools that the agent can access.
    *   `edges`: Connects the "starter" block to the "agent1" block.
    *   `loops`: An empty object (no loops).
    *   Returns a `WorkflowStateFixture`.

8.  **`createInvalidWorkflowState` Function:**

    ```typescript
    /**
     * Create a workflow state with an invalid block type for error testing
     */
    export function createInvalidWorkflowState(): WorkflowStateFixture {
      const { blocks, edges, loops } = createMinimalWorkflowState()

      // Add an invalid block type
      blocks.invalid = {
        id: 'invalid',
        type: 'invalid-type',
        name: 'Invalid Block',
        position: { x: 600, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
      }

      edges.push({
        id: 'edge-invalid',
        source: 'agent1',
        target: 'invalid',
      })

      return { blocks, edges, loops }
    }
    ```

    *   Creates a workflow state that contains an invalid block type.
    *   It starts by creating a minimal workflow using `createMinimalWorkflowState()`.
    *   It then adds a new block to the `blocks` object with `type: 'invalid-type'`.
    *   It also adds an edge connecting the `agent1` block to the invalid block.
    *   This fixture is designed to test error handling when encountering unknown or unsupported block types.

9.  **`createInvalidSerializedWorkflow` Function:**

    ```typescript
    /**
     * Create a serialized workflow with invalid metadata for error testing
     */
    export function createInvalidSerializedWorkflow() {
      return {
        version: '1.0',
        blocks: [
          {
            id: 'invalid',
            position: { x: 0, y: 0 },
            config: {
              tool: 'invalid',
              params: {},
            },
            inputs: {},
            outputs: {},
            metadata: {
              id: 'non-existent-type',
            },
            enabled: true,
          },
        ],
        connections: [],
        loops: {},
      }
    }
    ```

    *   Creates a serialized workflow representation with invalid metadata.  This is meant to simulate a workflow that has been saved in an incorrect format.
    *   It returns an object resembling a serialized workflow structure with:
        *   `version`: The version of the workflow format.
        *   `blocks`: An array containing a single block with `metadata.id` set to `non-existent-type`. This signifies that the block's type is not recognized.
        *   `connections`: An empty array, implying no connections.
        *   `loops`: An empty object, implying no loops.

10. **`createMissingMetadataWorkflow` Function:**

    ```typescript
    /**
     * Create a serialized workflow with missing metadata for error testing
     */
    export function createMissingMetadataWorkflow() {
      return {
        version: '1.0',
        blocks: [
          {
            id: 'invalid',
            position: { x: 0, y: 0 },
            config: {
              tool: 'invalid',
              params: {},
            },
            inputs: {},
            outputs: {},
            metadata: undefined,
            enabled: true,
          },
        ],
        connections: [],
        loops: {},
      }
    }
    ```

    *   Creates a serialized workflow representation with missing metadata.
    *   Similar to `createInvalidSerializedWorkflow`, it returns an object resembling a serialized workflow.
    *   The key difference is that the `metadata` property of the block is explicitly set to `undefined`. This is designed to test how the system handles workflows where the block type information is completely missing.

**In summary,** this file provides a set of TypeScript functions that generate various `WorkflowStateFixture` objects for testing purposes. These fixtures cover different workflow scenarios, including basic workflows, conditional workflows, looping workflows, complex workflows, and workflows with custom tools.  Crucially, it also provides fixtures with intentionally invalid data to test error handling within the application. These fixtures are likely used extensively in unit tests to verify the correct behavior of workflow-related logic, especially around serialization, deserialization, and execution.
