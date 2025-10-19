```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimiter } from '@/services/queue/RateLimiter'
import { MANUAL_EXECUTION_LIMIT, RATE_LIMITS } from '@/services/queue/types'

// Mock the database module
vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

// Mock drizzle-orm
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field, value) => ({ field, value })),
  sql: vi.fn((strings, ...values) => ({ sql: strings.join('?'), values })),
  and: vi.fn((...conditions) => ({ and: conditions })),
}))

// Mock getHighestPrioritySubscription
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: vi.fn().mockResolvedValue(null),
}))

import { db } from '@sim/db'

describe('RateLimiter', () => {
  const rateLimiter = new RateLimiter()
  const testUserId = 'test-user-123'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('checkRateLimit', () => {
    it('should allow unlimited requests for manual trigger type', async () => {
      const result = await rateLimiter.checkRateLimit(testUserId, 'free', 'manual', false)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(MANUAL_EXECUTION_LIMIT)
      expect(result.resetAt).toBeInstanceOf(Date)
      expect(db.select).not.toHaveBeenCalled()
    })

    it('should allow first API request for sync execution', async () => {
      // Mock select to return empty array (no existing record)
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]), // No existing record
          }),
        }),
      } as any)

      // Mock insert to return the expected structure
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                syncApiRequests: 1,
                asyncApiRequests: 0,
                windowStart: new Date(),
              },
            ]),
          }),
        }),
      } as any)

      const result = await rateLimiter.checkRateLimit(testUserId, 'free', 'api', false)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(RATE_LIMITS.free.syncApiExecutionsPerMinute - 1)
      expect(result.resetAt).toBeInstanceOf(Date)
    })

    it('should allow first API request for async execution', async () => {
      // Mock select to return empty array (no existing record)
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]), // No existing record
          }),
        }),
      } as any)

      // Mock insert to return the expected structure
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                syncApiRequests: 0,
                asyncApiRequests: 1,
                windowStart: new Date(),
              },
            ]),
          }),
        }),
      } as any)

      const result = await rateLimiter.checkRateLimit(testUserId, 'free', 'api', true)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(RATE_LIMITS.free.asyncApiExecutionsPerMinute - 1)
      expect(result.resetAt).toBeInstanceOf(Date)
    })

    it('should work for all trigger types except manual', async () => {
      const triggerTypes = ['api', 'webhook', 'schedule', 'chat'] as const

      for (const triggerType of triggerTypes) {
        // Mock select to return empty array (no existing record)
        vi.mocked(db.select).mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]), // No existing record
            }),
          }),
        } as any)

        // Mock insert to return the expected structure
        vi.mocked(db.insert).mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                {
                  syncApiRequests: 1,
                  asyncApiRequests: 0,
                  windowStart: new Date(),
                },
              ]),
            }),
          }),
        } as any)

        const result = await rateLimiter.checkRateLimit(testUserId, 'free', triggerType, false)

        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(RATE_LIMITS.free.syncApiExecutionsPerMinute - 1)
      }
    })
  })

  describe('getRateLimitStatus', () => {
    it('should return unlimited for manual trigger type', async () => {
      const status = await rateLimiter.getRateLimitStatus(testUserId, 'free', 'manual', false)

      expect(status.used).toBe(0)
      expect(status.limit).toBe(MANUAL_EXECUTION_LIMIT)
      expect(status.remaining).toBe(MANUAL_EXECUTION_LIMIT)
      expect(status.resetAt).toBeInstanceOf(Date)
    })

    it('should return sync API limits for API trigger type', async () => {
      const mockSelect = vi.fn().mockReturnThis()
      const mockFrom = vi.fn().mockReturnThis()
      const mockWhere = vi.fn().mockReturnThis()
      const mockLimit = vi.fn().mockResolvedValue([])

      vi.mocked(db.select).mockReturnValue({
        from: mockFrom,
        where: mockWhere,
        limit: mockLimit,
      } as any)

      const status = await rateLimiter.getRateLimitStatus(testUserId, 'free', 'api', false)

      expect(status.used).toBe(0)
      expect(status.limit).toBe(RATE_LIMITS.free.syncApiExecutionsPerMinute)
      expect(status.remaining).toBe(RATE_LIMITS.free.syncApiExecutionsPerMinute)
      expect(status.resetAt).toBeInstanceOf(Date)
    })
  })

  describe('resetRateLimit', () => {
    it('should delete rate limit record for user', async () => {
      vi.mocked(db.delete).mockReturnValue({
        where: vi.fn().mockResolvedValue({}),
      } as any)

      await rateLimiter.resetRateLimit(testUserId)

      expect(db.delete).toHaveBeenCalled()
    })
  })
})
```

### Purpose of this File

This file contains unit tests for the `RateLimiter` class. The `RateLimiter` class is responsible for managing and enforcing rate limits for users based on their subscription tier and the type of trigger that initiated a request.  The tests verify that the rate limiter behaves as expected under various conditions, such as different trigger types (manual, API, webhook, schedule, chat) and different scenarios (first request, subsequent requests, reaching the limit).

### Explanation of Code

1.  **Imports:**

    *   `{ beforeEach, describe, expect, it, vi } from 'vitest'`: Imports testing utilities from Vitest, a fast unit test framework.
        *   `describe`: Defines a suite of tests.
        *   `it`: Defines a single test case.
        *   `expect`: Makes assertions about the test results.
        *   `beforeEach`:  Executes before each test case within a `describe` block.
        *   `vi`:  Vitest's mocking library.
    *   `{ RateLimiter } from '@/services/queue/RateLimiter'`: Imports the `RateLimiter` class being tested.  The `@` symbol typically refers to the `src` directory in a project using module aliases.
    *   `{ MANUAL_EXECUTION_LIMIT, RATE_LIMITS } from '@/services/queue/types'`: Imports constants defining rate limits. `MANUAL_EXECUTION_LIMIT` likely defines the number of manual executions allowed, and `RATE_LIMITS` is an object containing rate limit definitions for different subscription tiers (e.g., "free", "pro").

2.  **Mocks:**

    *   `vi.mock('@sim/db', ...)`: This block mocks the database module (`@sim/db`).  Mocking allows tests to run without a real database connection and provides predictable return values.
        *   `vi.mock`:  Replaces the actual database module with a mock object.
        *   The mock object has `select`, `insert`, `update`, and `delete` functions, all of which are mocked using `vi.fn()`.  `vi.fn()` creates a mock function, allowing us to track whether it was called and what arguments it received, and to specify its return value.
    *   `vi.mock('drizzle-orm', ...)`: This mocks the `drizzle-orm` library, likely an ORM (Object-Relational Mapper) used to interact with the database.  The mocks provide simplified versions of `eq`, `sql`, and `and` functions that are used for constructing database queries. This makes testing independent of the actual ORM implementation.
        *   `eq`: Mocks the `eq` function, used for equality comparisons in queries.
        *   `sql`:  Mocks the `sql` function, likely used for constructing raw SQL queries or fragments.
        *   `and`: Mocks the `and` function, used for combining multiple conditions in a `WHERE` clause.
    *   `vi.mock('@/lib/billing/core/subscription', ...)`: This mocks the `getHighestPrioritySubscription` function, which is responsible for retrieving the user's highest priority subscription. Mocking this allows us to control the subscription tier used in the rate limiting calculations.
        *   The `mockResolvedValue(null)` indicates that, by default, this mock will return `null`, simulating a user without an active subscription.
    *   `import { db } from '@sim/db'`: Imports the (mocked) `db` object for use in the tests.

3.  **`describe('RateLimiter', ...)`:**

    *   This block defines a test suite for the `RateLimiter` class.  All tests related to the `RateLimiter` are grouped within this block.
    *   `const rateLimiter = new RateLimiter()`: Creates an instance of the `RateLimiter` class.  This instance will be used in the tests.
    *   `const testUserId = 'test-user-123'`: Defines a constant `testUserId` that is used to identify the user in the tests.
    *   `beforeEach(() => { vi.clearAllMocks() })`: This `beforeEach` hook is executed before each test case within the `RateLimiter` test suite. It clears all mocks using `vi.clearAllMocks()`. This is essential to ensure that the mocks are in a clean state before each test, preventing interference between tests.

4.  **`describe('checkRateLimit', ...)`:**

    *   This block defines a test suite for the `checkRateLimit` method of the `RateLimiter` class. The `checkRateLimit` method likely determines if a user is allowed to perform an action based on their current rate limit.
    *   `it('should allow unlimited requests for manual trigger type', async () => { ... })`: This test case verifies that the `checkRateLimit` method allows unlimited requests when the trigger type is "manual".
        *   `const result = await rateLimiter.checkRateLimit(testUserId, 'free', 'manual', false)`: Calls the `checkRateLimit` method with the `testUserId`, a "free" subscription tier, a "manual" trigger type, and `false` (likely indicating a synchronous execution).
        *   `expect(result.allowed).toBe(true)`: Asserts that the `allowed` property of the result is `true`, meaning the request is allowed.
        *   `expect(result.remaining).toBe(MANUAL_EXECUTION_LIMIT)`: Asserts that the `remaining` property of the result is equal to `MANUAL_EXECUTION_LIMIT`, indicating that the user has the full allowance for manual executions.
        *   `expect(result.resetAt).toBeInstanceOf(Date)`: Asserts that the `resetAt` property of the result is an instance of `Date`, indicating that the rate limit will reset at a specific time.
        *   `expect(db.select).not.toHaveBeenCalled()`: Asserts that the `db.select` method was not called. This confirms that rate limiting is not enforced for manual triggers, and no database query was made.
    *   `it('should allow first API request for sync execution', async () => { ... })`: This test case verifies that the `checkRateLimit` method allows the first API request for synchronous execution.
        *   The test mocks the `db.select` method to return an empty array, simulating the scenario where there is no existing rate limit record for the user. This means it's the user's first request within the rate limit window.  The complex nesting of `vi.fn().mockReturnValue` is necessary to simulate the chained method calls of the ORM.
        *   The test mocks the `db.insert` method to simulate inserting a new rate limit record for the user.  This also has complex nested mocks to simulate the ORM.
        *   `const result = await rateLimiter.checkRateLimit(testUserId, 'free', 'api', false)`: Calls the `checkRateLimit` method with the `testUserId`, a "free" subscription tier, an "api" trigger type, and `false` (synchronous execution).
        *   `expect(result.allowed).toBe(true)`: Asserts that the request is allowed.
        *   `expect(result.remaining).toBe(RATE_LIMITS.free.syncApiExecutionsPerMinute - 1)`: Asserts that the `remaining` property is equal to the number of allowed synchronous API executions per minute for the "free" tier, minus 1 (because the user has now made one request).
        *   `expect(result.resetAt).toBeInstanceOf(Date)`: Asserts that `resetAt` is a `Date` object.
    *   `it('should allow first API request for async execution', async () => { ... })`: This test is similar to the previous one, but it tests the scenario where the first API request is for *asynchronous* execution (`true` is passed as the fourth argument to `checkRateLimit`).
    *   `it('should work for all trigger types except manual', async () => { ... })`: This test case iterates through an array of trigger types (`'api'`, `'webhook'`, `'schedule'`, `'chat'`) and verifies that the `checkRateLimit` method behaves as expected for each of them. It uses the same mocking strategy as the previous test cases. The purpose is to ensure that the rate limiting logic is consistent across different trigger types.

5.  **`describe('getRateLimitStatus', ...)`:**

    *   This block defines a test suite for the `getRateLimitStatus` method. This method likely returns the current rate limit status for a user (e.g., how many requests they have used, their limit, and when the limit resets).
    *   `it('should return unlimited for manual trigger type', async () => { ... })`: This test case verifies that the `getRateLimitStatus` method returns the correct values for a "manual" trigger type (unlimited executions).
        *   `const status = await rateLimiter.getRateLimitStatus(testUserId, 'free', 'manual', false)`: Calls the `getRateLimitStatus` method.
        *   The assertions verify that `used` is 0, `limit` and `remaining` are equal to `MANUAL_EXECUTION_LIMIT`, and `resetAt` is a `Date` object.
    *   `it('should return sync API limits for API trigger type', async () => { ... })`: This test case verifies that the `getRateLimitStatus` method returns the correct values for an "api" trigger type and sync execution, pulling values from the `RATE_LIMITS` constant.

6.  **`describe('resetRateLimit', ...)`:**

    *   This block defines a test suite for the `resetRateLimit` method. This method likely deletes the rate limit record for a user, effectively resetting their rate limit.
    *   `it('should delete rate limit record for user', async () => { ... })`: This test case verifies that the `resetRateLimit` method calls the `db.delete` method with the correct arguments.
        *   `vi.mocked(db.delete).mockReturnValue(...)`: Mocks the `db.delete` method.
        *   `await rateLimiter.resetRateLimit(testUserId)`: Calls the `resetRateLimit` method.
        *   `expect(db.delete).toHaveBeenCalled()`: Asserts that the `db.delete` method was called, indicating that the rate limit record was deleted.

### Summary

This file provides comprehensive unit tests for the `RateLimiter` class. It uses mocking extensively to isolate the `RateLimiter` from its dependencies (database, billing service) and to simulate various scenarios. The tests cover different trigger types, execution types (sync/async), and methods of the `RateLimiter` class. The tests ensure that the rate limiting logic is correctly implemented and that the `RateLimiter` behaves as expected under different conditions.
