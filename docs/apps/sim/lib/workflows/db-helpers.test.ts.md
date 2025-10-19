```typescript
/**
 * @vitest-environment node
 *
 * Database Helpers Unit Tests
 *
 * Tests for normalized table operations including loading, saving, and migrating
 * workflow data between JSON blob format and normalized database tables.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

// Purpose:
// This file contains unit tests for database helper functions related to workflow management.
// These functions are responsible for interacting with the database to:
//   - Load workflow data from normalized tables (blocks, edges, subflows).
//   - Save workflow data to normalized tables.
//   - Check if a workflow exists in normalized tables.
//   - Migrate workflow data from a JSON blob format to normalized tables.

// The tests use the vitest testing framework and mock the database and other dependencies to isolate the functions being tested.
// These tests ensure the integrity of data conversion between the application's state management and the database's storage structure.

// ---
// Mocking the Database and External Modules
// ---

// `mockDb`:  A mock object simulating a database connection.  It uses `vi.fn()` from vitest to create mock functions for common database operations (select, insert, delete, transaction).  This allows us to control the database's behavior during testing and avoid actual database calls.
const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
}

// `mockWorkflowBlocks`, `mockWorkflowEdges`, `mockWorkflowSubflows`: Mock objects representing the structure of the database tables for workflow blocks, edges, and subflows respectively.  They provide a consistent structure for mocking database queries and ensuring that the tests are not dependent on the actual database schema.  Each property corresponds to a column in the respective table.
const mockWorkflowBlocks = {
  workflowId: 'workflowId',
  id: 'id',
  type: 'type',
  name: 'name',
  positionX: 'positionX',
  positionY: 'positionY',
  enabled: 'enabled',
  horizontalHandles: 'horizontalHandles',
  isWide: 'isWide',
  height: 'height',
  subBlocks: 'subBlocks',
  outputs: 'outputs',
  data: 'data',
  parentId: 'parentId',
  extent: 'extent',
}

const mockWorkflowEdges = {
  workflowId: 'workflowId',
  id: 'id',
  sourceBlockId: 'sourceBlockId',
  targetBlockId: 'targetBlockId',
  sourceHandle: 'sourceHandle',
  targetHandle: 'targetHandle',
}

const mockWorkflowSubflows = {
  workflowId: 'workflowId',
  id: 'id',
  type: 'type',
  config: 'config',
}

// `vi.doMock()`:  vitest's mocking function. It's used to replace the actual database module (`@sim/db`) and drizzle-orm with the mock objects defined above.  This ensures that the tests operate in a controlled environment and do not rely on external dependencies. The logger is also mocked to prevent actual log output during tests.
vi.doMock('@sim/db', () => ({
  db: mockDb,
  workflowBlocks: mockWorkflowBlocks,
  workflowEdges: mockWorkflowEdges,
  workflowSubflows: mockWorkflowSubflows,
  workflowDeploymentVersion: {
    id: 'id',
    workflowId: 'workflowId',
    version: 'version',
    state: 'state',
    isActive: 'isActive',
    createdAt: 'createdAt',
    createdBy: 'createdBy',
    deployedBy: 'deployedBy',
  },
}))

vi.doMock('drizzle-orm', () => ({
  eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
  and: vi.fn((...conditions) => ({ type: 'and', conditions })),
  desc: vi.fn((field) => ({ field, type: 'desc' })),
}))

vi.doMock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

// ---
// Mock Data
// ---

// `mockWorkflowId`: A constant string used as the ID for the mock workflow. This is used to identify the workflow in the mock database queries.
const mockWorkflowId = 'test-workflow-123'

// `mockBlocksFromDb`, `mockEdgesFromDb`, `mockSubflowsFromDb`:  Arrays of objects representing mock data that would be returned from the database when querying for workflow blocks, edges, and subflows.  This data is used to simulate the database's response and test how the helper functions handle different scenarios. This mock data represents the raw format from the database.
const mockBlocksFromDb = [
  {
    id: 'block-1',
    workflowId: mockWorkflowId,
    type: 'starter',
    name: 'Start Block',
    positionX: 100,
    positionY: 100,
    enabled: true,
    horizontalHandles: true,
    isWide: false,
    advancedMode: false,
    triggerMode: false,
    height: 150,
    subBlocks: { input: { id: 'input', type: 'short-input' as const, value: 'test' } },
    outputs: { result: { type: 'string' } },
    data: { parentId: null, extent: null, width: 350 },
    parentId: null,
    extent: null,
  },
  {
    id: 'block-2',
    workflowId: mockWorkflowId,
    type: 'api',
    name: 'API Block',
    positionX: 300,
    positionY: 100,
    enabled: true,
    horizontalHandles: true,
    isWide: true,
    height: 200,
    subBlocks: {},
    outputs: {},
    data: { parentId: 'loop-1', extent: 'parent' },
    parentId: 'loop-1',
    extent: 'parent',
  },
]

const mockEdgesFromDb = [
  {
    id: 'edge-1',
    workflowId: mockWorkflowId,
    sourceBlockId: 'block-1',
    targetBlockId: 'block-2',
    sourceHandle: 'output',
    targetHandle: 'input',
  },
]

const mockSubflowsFromDb = [
  {
    id: 'loop-1',
    workflowId: mockWorkflowId,
    type: 'loop',
    config: {
      id: 'loop-1',
      nodes: ['block-2'],
      iterations: 5,
      loopType: 'for',
    },
  },
  {
    id: 'parallel-1',
    workflowId: mockWorkflowId,
    type: 'parallel',
    config: {
      id: 'parallel-1',
      nodes: ['block-3'],
      distribution: ['item1', 'item2'],
    },
  },
]

// `mockWorkflowState`:  A mock object representing the application's state for a workflow.  This data is in the format expected by the application and is used to test the saving and migration functions. This represents the workflow in the format the application uses.
const mockWorkflowState: WorkflowState = {
  blocks: {
    'block-1': {
      id: 'block-1',
      type: 'starter',
      name: 'Start Block',
      position: { x: 100, y: 100 },
      subBlocks: { input: { id: 'input', type: 'short-input' as const, value: 'test' } },
      outputs: { result: { type: 'string' } },
      enabled: true,
      horizontalHandles: true,
      isWide: false,
      height: 150,
      data: { width: 350 },
    },
    'block-2': {
      id: 'block-2',
      type: 'api',
      name: 'API Block',
      position: { x: 300, y: 100 },
      subBlocks: {},
      outputs: {},
      enabled: true,
      horizontalHandles: true,
      isWide: true,
      height: 200,
      data: { parentId: 'loop-1', extent: 'parent' },
    },
  },
  edges: [
    {
      id: 'edge-1',
      source: 'block-1',
      target: 'block-2',
      sourceHandle: 'output',
      targetHandle: 'input',
    },
  ],
  loops: {
    'loop-1': {
      id: 'loop-1',
      nodes: ['block-2'],
      iterations: 5,
      loopType: 'for',
    },
  },
  parallels: {
    'parallel-1': {
      id: 'parallel-1',
      nodes: ['block-3'],
      distribution: ['item1', 'item2'],
    },
  },
  lastSaved: Date.now(),
  isDeployed: false,
  deploymentStatuses: {},
}

// ---
// Test Suite Setup
// ---

// `describe('Database Helpers', ...)`:  Defines a test suite for the database helper functions.  This groups together related tests for better organization and readability.
describe('Database Helpers', () => {
  // `dbHelpers`:  A variable to hold the imported database helper functions. This allows access to the functions being tested within each test case. The type `typeof import('@/lib/workflows/db-helpers')` ensures type safety.
  let dbHelpers: typeof import('@/lib/workflows/db-helpers')

  // `beforeEach(async () => ...)`:  A hook that runs before each test case in the suite.  It imports the database helper functions and clears all mock calls to ensure a clean slate for each test.
  beforeEach(async () => {
    vi.clearAllMocks()
    dbHelpers = await import('@/lib/workflows/db-helpers')
  })

  // `afterEach(() => ...)`:  A hook that runs after each test case in the suite.  It resets all mocks to ensure that the mocks do not interfere with subsequent tests.
  afterEach(() => {
    vi.resetAllMocks()
  })

  // ---
  // Test Cases: loadWorkflowFromNormalizedTables
  // ---

  // `describe('loadWorkflowFromNormalizedTables', () => ...)`: Defines a test suite specifically for the `loadWorkflowFromNormalizedTables` function.
  describe('loadWorkflowFromNormalizedTables', () => {
    // `it('should successfully load workflow data from normalized tables', async () => ...)`:  A test case that checks if the `loadWorkflowFromNormalizedTables` function correctly loads workflow data from the database and transforms it into the expected format.
    it('should successfully load workflow data from normalized tables', async () => {
      vi.clearAllMocks()

      let callCount = 0
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) {
              return Promise.resolve(mockBlocksFromDb)
            }
            if (callCount === 2) {
              return Promise.resolve(mockEdgesFromDb)
            }
            if (callCount === 3) {
              return Promise.resolve(mockSubflowsFromDb)
            }
            return Promise.resolve([])
          }),
        }),
      }))

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)
      expect(result).toBeDefined()
      expect(result?.isFromNormalizedTables).toBe(true)
      expect(result?.blocks).toBeDefined()
      expect(result?.edges).toBeDefined()
      expect(result?.loops).toBeDefined()
      expect(result?.parallels).toBeDefined()

      // Verify blocks are transformed correctly
      expect(result?.blocks['block-1']).toEqual({
        id: 'block-1',
        type: 'starter',
        name: 'Start Block',
        position: { x: 100, y: 100 },
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        height: 150,
        subBlocks: { input: { id: 'input', type: 'short-input' as const, value: 'test' } },
        outputs: { result: { type: 'string' } },
        data: { parentId: null, extent: null, width: 350 },
        advancedMode: false,
        triggerMode: false,
      })

      // Verify edges are transformed correctly
      expect(result?.edges[0]).toEqual({
        id: 'edge-1',
        source: 'block-1',
        target: 'block-2',
        sourceHandle: 'output',
        targetHandle: 'input',
        type: 'default',
        data: {},
      })

      // Verify loops are transformed correctly
      expect(result?.loops['loop-1']).toEqual({
        id: 'loop-1',
        nodes: ['block-2'],
        iterations: 5,
        loopType: 'for',
        forEachItems: '',
      })

      // Verify parallels are transformed correctly
      expect(result?.parallels['parallel-1']).toEqual({
        id: 'parallel-1',
        nodes: ['block-3'],
        count: 2,
        distribution: ['item1', 'item2'],
        parallelType: 'count',
      })
    })

    // `it('should return null when no blocks are found', async () => ...)`: A test case to verify that the function returns `null` when no blocks are found in the database for the given workflow ID.  This simulates a scenario where the workflow does not exist or has no associated blocks.
    it('should return null when no blocks are found', async () => {
      // Mock empty results from all queries
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeNull()
    })

    // `it('should return null when database query fails', async () => ...)`:  A test case to ensure that the function handles database query errors gracefully.  It mocks a database error and verifies that the function returns `null` in such cases.
    it('should return null when database query fails', async () => {
      // Mock database error
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('Database connection failed')),
        }),
      })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeNull()
    })

    // `it('should handle unknown subflow types gracefully', async () => ...)`: A test case to verify that the function handles unknown subflow types without crashing. It checks if the function still returns a result with empty loops and parallels while processing blocks and edges correctly.
    it('should handle unknown subflow types gracefully', async () => {
      const subflowsWithUnknownType = [
        {
          id: 'unknown-1',
          workflowId: mockWorkflowId,
          type: 'unknown-type',
          config: { id: 'unknown-1' },
        },
      ]

      // Mock the database queries properly
      let callCount = 0
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve(mockBlocksFromDb) // blocks query
            if (callCount === 2) return Promise.resolve(mockEdgesFromDb) // edges query
            if (callCount === 3) return Promise.resolve(subflowsWithUnknownType) // subflows query
            return Promise.resolve([])
          }),
        }),
      })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeDefined()
      // The function should still return a result but with empty loops and parallels
      expect(result?.loops).toEqual({})
      expect(result?.parallels).toEqual({})
      // Verify blocks and edges are still processed correctly
      expect(result?.blocks).toBeDefined()
      expect(result?.edges).toBeDefined()
    })

    // `it('should handle malformed database responses', async () => ...)`: A test case to verify that the function handles malformed database responses. It checks if the function handles null types and names gracefully.
    it('should handle malformed database responses', async () => {
      const malformedBlocks = [
        {
          id: 'block-1',
          workflowId: mockWorkflowId,
          // Missing required fields
          type: null,
          name: null,
          positionX: 0,
          positionY: 0,
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          height: 0,
          subBlocks: {},
          outputs: {},
          data: {},
          parentId: null,
          extent: null,
        },
      ]

      // Mock the database queries properly
      let callCount = 0
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve(malformedBlocks) // blocks query
            if (callCount === 2) return Promise.resolve([]) // edges query
            if (callCount === 3) return Promise.resolve([]) // subflows query
            return Promise.resolve([])
          }),
        }),
      })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeDefined()
      expect(result?.blocks['block-1']).toBeDefined()
      // The function should handle null type and name gracefully
      expect(result?.blocks['block-1'].type).toBeNull()
      expect(result?.blocks['block-1'].name).toBeNull()
    })

    // `it('should handle database connection errors gracefully', async () => ...)`:  A test case to verify that the function handles database connection errors gracefully.
    it('should handle database connection errors gracefully', async () => {
      const connectionError = new Error('Connection refused')
      ;(connectionError as any).code = 'ECONNREFUSED'

      // Mock database connection error
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(connectionError),
        }),
      })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeNull()
    })
  })

  // ---
  // Test Cases: saveWorkflowToNormalizedTables
  // ---

  // `describe('saveWorkflowToNormalizedTables', () => ...)`: Defines a test suite specifically for the `saveWorkflowToNormalizedTables` function.
  describe('saveWorkflowToNormalizedTables', () => {
    // `it('should successfully save workflow data to normalized tables', async () => ...)`: A test case that checks if the function correctly saves workflow data to normalized tables. It mocks a transaction and verifies that the function returns a success result.
    it('should successfully save workflow data to normalized tables', async () => {
      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const tx = {
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue([]),
          }),
        }
        return await callback(tx)
      })

      mockDb.transaction = mockTransaction

      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        mockWorkflowState
      )

      expect(result.success).toBe(true)

      // Verify transaction was called
      expect(mockTransaction).toHaveBeenCalledTimes(1)
    })

    // `it('should handle empty workflow state gracefully', async () => ...)`:  A test case to verify that the function handles empty workflow states. It checks if the function returns a success result.
    it('should handle empty workflow state gracefully', async () => {
      const emptyWorkflowState: WorkflowState = {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        lastSaved: Date.now(),
        isDeployed: false,
        deploymentStatuses: {},
      }

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const tx = {
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue([]),
          }),
        }
        return await callback(tx)
      })

      mockDb.transaction = mockTransaction

      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        emptyWorkflowState
      )

      expect(result.success).toBe(true)
    })

    // `it('should return error when transaction fails', async () => ...)`:  A test case to verify that the function handles transaction failures. It checks if the function returns an error result.
    it('should return error when transaction fails', async () => {
      const mockTransaction = vi.fn().mockRejectedValue(new Error('Transaction failed'))
      mockDb.transaction = mockTransaction

      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        mockWorkflowState
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Transaction failed')
    })

    // `it('should handle database constraint errors', async () => ...)`:  A test case to verify that the function handles database constraint errors. It checks if the function returns an error result.
    it('should handle database constraint errors', async () => {
      const constraintError = new Error('Unique constraint violation')
      ;(constraintError as any).code = '23505'

      const mockTransaction = vi.fn().mockRejectedValue(constraintError)
      mockDb.transaction = mockTransaction

      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        mockWorkflowState
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Unique constraint violation')
    })

    // `it('should properly format block data for database insertion', async () => ...)`:  A test case to verify that the function properly formats block data for database insertion.
    it('should properly format block data for database insertion', async () => {
      let capturedBlockInserts: any[] = []
      let capturedEdgeInserts: any[] = []
      let capturedSubflowInserts: any[] = []

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const tx = {
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((data) => {
              // Capture the data based on which insert call it is
              if (data.length > 0) {
                if (data[0].positionX !== undefined) {
                  capturedBlockInserts = data
                } else if (data[0].sourceBlockId !== undefined) {
                  capturedEdgeInserts = data
                } else if (data[0].type === 'loop' || data[0].type === 'parallel') {
                  capturedSubflowInserts = data
                }
              }
              return Promise.resolve([])
            }),
          }),
        }
        return await callback(tx)
      })

      mockDb.transaction = mockTransaction

      await dbHelpers.saveWorkflowToNormalizedTables(mockWorkflowId, mockWorkflowState)

      expect(capturedBlockInserts).toHaveLength(2)
      expect(capturedBlockInserts[0]).toMatchObject({
        id: 'block-1',
        workflowId: mockWorkflowId,
        type: 'starter',
        name: 'Start Block',
        positionX: '100',
        positionY: '100',
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        height: '150',
        parentId: null,
        extent: null,
      })

      expect(capturedEdgeInserts).toHaveLength(1)
      expect(capturedEdgeInserts[0]).toMatchObject({
        id: 'edge-1',
        workflowId: mockWorkflowId,
        sourceBlockId: 'block-1',
        targetBlockId: 'block-2',
        sourceHandle: 'output',
        targetHandle: 'input',
      })

      expect(capturedSubflowInserts).toHaveLength(2)
      expect(capturedSubflowInserts[0]).toMatchObject({
        id: 'loop-1',
        workflowId: mockWorkflowId,
        type: 'loop',
      })
    })
  })

  // ---
  // Test Cases: workflowExistsInNormalizedTables
  // ---

  // `describe('workflowExistsInNormalizedTables', () => ...)`: Defines a test suite specifically for the `workflowExistsInNormalizedTables` function.
  describe('workflowExistsInNormalizedTables', () => {
    // `it('should return true when workflow exists in normalized tables', async () => ...)`: A test case that checks if the function returns true when a workflow exists in normalized tables.
    it('should return true when workflow exists in normalized tables', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 'block-1' }]),
          }),
        }),
      })

      const result = await dbHelpers.workflowExistsInNormalizedTables(mockWorkflowId)

      expect(result).toBe(true)
    })

    // `it('should return false when workflow does not exist in normalized tables', async () => ...)`: A test case that checks if the function returns false when a workflow does not exist in normalized tables.
    it('should return false when workflow does not exist in normalized tables', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      })

      const result = await dbHelpers.workflowExistsInNormalizedTables(mockWorkflowId)

      expect(result).toBe(false)
    })

    // `it('should return false when database query fails', async () => ...)`: A test case that checks if the function returns false when a database query fails.
    it('should return false when database query fails', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('Database error')),
          }),
        }),
      })

      const result = await dbHelpers.workflowExistsInNormalizedTables(mockWorkflowId)

      expect(result).toBe(false)
    })
  })

  // ---
  // Test Cases: migrateWorkflowToNormalizedTables
  // ---

  // `describe('migrateWorkflowToNormalizedTables', () => ...)`: Defines a test suite specifically for the `migrateWorkflowToNormalizedTables` function.
  describe('migrateWorkflowToNormalizedTables', () => {
    const mockJsonState = {
      blocks: mockWorkflowState.blocks,
      edges: mockWorkflowState.edges,
      loops: mockWorkflowState.loops,
      parallels: mockWorkflowState.parallels,
      lastSaved: Date.now(),
      isDeployed: false,
      deploymentStatuses: {},
    }

    // `it('should successfully migrate workflow from JSON to normalized tables', async () => ...)`: A test case that checks if the function successfully migrates a workflow from JSON to normalized tables.
    it('should successfully migrate workflow from JSON to normalized tables', async () => {
      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const tx = {
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue([]),
          }),
        }
        return await callback(tx)
      })

      mockDb.transaction = mockTransaction

      const result = await dbHelpers.migrateWorkflowToNormalizedTables(
        mockWorkflowId,
        mockJsonState
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })

    // `it('should return error when migration fails', async () => ...)`: A test case that checks if the function returns an error when the migration fails.
    it('should return error when migration fails', async () => {
      const mockTransaction = vi.fn().mockRejectedValue(new Error('Migration failed'))
      mockDb.transaction = mockTransaction

      const result = await dbHelpers.migrateWorkflowToNormalizedTables(
        mockWorkflowId,
        mockJsonState
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Migration failed')
    })

    // `it('should handle missing properties in JSON state gracefully', async () => ...)`: A test case that checks if the function handles missing properties in the JSON state gracefully.
    it('should handle missing properties in JSON state gracefully', async () => {
      const incompleteJsonState = {
        blocks: mockWorkflowState.blocks,
        edges: mockWorkflowState.edges,
        // Missing loops, parallels, and other properties
      }

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const tx = {
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue([]),
          }),
        }
        return await callback(tx)
      })

      mockDb.transaction = mockTransaction

      const result = await dbHelpers.migrateWorkflowToNormalizedTables(
        mockWorkflowId,
        incompleteJsonState
      )

      expect(result.success).toBe(true)
    })

    // `it('should handle null/undefined JSON state', async () => ...)`: A test case that checks if the function handles null/undefined JSON state.
    it('should handle null/undefined JSON state', async () => {
      const result = await dbHelpers.migrateWorkflowToNormalizedTables(mockWorkflowId, null)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Cannot read properties')
    })
  })

  // ---
  // Test Cases: Error Handling and Edge Cases
  // ---

  // `describe('error handling and edge cases', () => ...)`: Defines a test suite specifically for error handling and edge cases.
  describe('error handling and edge cases', () => {
    // `it('should handle very large workflow data', async () => ...)`: A test case that checks if the function handles very large workflow data.
    it('should handle very large workflow data', async () => {
      const largeWorkflowState: WorkflowState = {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        lastSaved: Date.now(),
        isDeployed: false,
        deploymentStatuses: {},
      }

      // Create 1000 blocks
      for (let i = 0; i < 1000; i++) {
        largeWorkflowState.blocks[`block-${i}`] = {
          id: `block-${i}`,
          type: 'api',
          name: `Block ${i}`,
          position: { x: i * 100, y: i * 100 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        }
      }

      // Create 999 edges to connect them
      for (let i = 0; i < 999; i++) {
        largeWorkflowState.edges.push({
          id: `edge-${i}`,
          source: `block-${i}`,
          target: `block-${i + 1}`,
        })
      }

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const tx = {
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue([]),
          }),
        }
        return await callback(tx)
      })

      mockDb.transaction = mockTransaction

      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        largeWorkflowState
      )

      expect(result.success).toBe(true)
    })
  })

  // ---
  // Test Cases: advancedMode Persistence and isWide
  // ---

  // `describe('advancedMode persistence comparison with isWide', () => ...)`: Defines a test suite specifically for advancedMode persistence comparison with isWide.
  describe('advancedMode persistence comparison with isWide', () => {
    // `it('should load advancedMode property exactly like isWide from database', async () => ...)`: A test case that checks if the advancedMode property is loaded correctly from the database.
    it('should load advancedMode property exactly like isWide from database', async () => {
      const testBlocks = [
        {
          id: 'block-advanced-wide',
          workflowId: mockWorkflowId,
          type: 'agent',
          name: 'Advanced Wide Block',
          positionX: 100,
          positionY: 100,
          enabled: true,
          horizontalHandles: true,
          isWide: true,
          advancedMode: true,
          height: 200,
          subBlocks: {},
          outputs: {},
          data: {},
          parentId: null,
          extent: null,
        },
        {
          id: 'block-basic-narrow',
          workflowId: mockWorkflowId,
          type: 'agent',
          name: 'Basic Narrow Block',
          positionX: 200,
          positionY: 100,
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          advancedMode: false,
          height: 150,
          sub