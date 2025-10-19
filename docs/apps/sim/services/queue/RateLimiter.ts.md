```typescript
import { db } from '@sim/db'
import { userRateLimits } from '@sim/db/schema'
import { eq, sql } from 'drizzle-orm'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { createLogger } from '@/lib/logs/console/logger'
import {
  MANUAL_EXECUTION_LIMIT,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMITS,
  type RateLimitCounterType,
  type SubscriptionPlan,
  type TriggerType,
} from '@/services/queue/types'

const logger = createLogger('RateLimiter')

interface SubscriptionInfo {
  plan: string
  referenceId: string
}

export class RateLimiter {
  /**
   * Determine the rate limit key based on subscription
   * For team/enterprise plans via organization, use the organization ID
   * For direct user subscriptions (including direct team), use the user ID
   */
  private getRateLimitKey(userId: string, subscription: SubscriptionInfo | null): string {
    if (!subscription) {
      return userId
    }

    const plan = subscription.plan as SubscriptionPlan

    // Check if this is an organization subscription (referenceId !== userId)
    // If referenceId === userId, it's a direct user subscription
    if ((plan === 'team' || plan === 'enterprise') && subscription.referenceId !== userId) {
      // This is an organization subscription
      // All organization members share the same rate limit pool
      return subscription.referenceId
    }

    // For direct user subscriptions (free/pro/team/enterprise where referenceId === userId)
    return userId
  }

  /**
   * Determine which counter type to use based on trigger type and async flag
   */
  private getCounterType(triggerType: TriggerType, isAsync: boolean): RateLimitCounterType {
    if (triggerType === 'api-endpoint') {
      return 'api-endpoint'
    }
    return isAsync ? 'async' : 'sync'
  }

  /**
   * Get the rate limit for a specific counter type
   */
  private getRateLimitForCounter(
    config: (typeof RATE_LIMITS)[SubscriptionPlan],
    counterType: RateLimitCounterType
  ): number {
    switch (counterType) {
      case 'api-endpoint':
        return config.apiEndpointRequestsPerMinute
      case 'async':
        return config.asyncApiExecutionsPerMinute
      case 'sync':
        return config.syncApiExecutionsPerMinute
    }
  }

  /**
   * Get the current count from a rate limit record for a specific counter type
   */
  private getCountFromRecord(
    record: { syncApiRequests: number; asyncApiRequests: number; apiEndpointRequests: number },
    counterType: RateLimitCounterType
  ): number {
    switch (counterType) {
      case 'api-endpoint':
        return record.apiEndpointRequests
      case 'async':
        return record.asyncApiRequests
      case 'sync':
        return record.syncApiRequests
    }
  }

  /**
   * Check if user can execute a workflow with organization-aware rate limiting
   * Manual executions bypass rate limiting entirely
   */
  async checkRateLimitWithSubscription(
    userId: string,
    subscription: SubscriptionInfo | null,
    triggerType: TriggerType = 'manual',
    isAsync = false
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    try {
      if (triggerType === 'manual') {
        return {
          allowed: true,
          remaining: MANUAL_EXECUTION_LIMIT,
          resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
        }
      }

      const subscriptionPlan = (subscription?.plan || 'free') as SubscriptionPlan
      const rateLimitKey = this.getRateLimitKey(userId, subscription)
      const limit = RATE_LIMITS[subscriptionPlan]

      const counterType = this.getCounterType(triggerType, isAsync)
      const execLimit = this.getRateLimitForCounter(limit, counterType)

      const now = new Date()
      const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS)

      // Get or create rate limit record using the rate limit key
      const [rateLimitRecord] = await db
        .select()
        .from(userRateLimits)
        .where(eq(userRateLimits.referenceId, rateLimitKey))
        .limit(1)

      if (!rateLimitRecord || new Date(rateLimitRecord.windowStart) < windowStart) {
        // Window expired - reset window with this request as the first one
        const result = await db
          .insert(userRateLimits)
          .values({
            referenceId: rateLimitKey,
            syncApiRequests: counterType === 'sync' ? 1 : 0,
            asyncApiRequests: counterType === 'async' ? 1 : 0,
            apiEndpointRequests: counterType === 'api-endpoint' ? 1 : 0,
            windowStart: now,
            lastRequestAt: now,
            isRateLimited: false,
          })
          .onConflictDoUpdate({
            target: userRateLimits.referenceId,
            set: {
              // Only reset if window is still expired (avoid race condition)
              syncApiRequests: sql`CASE WHEN ${userRateLimits.windowStart} < ${windowStart.toISOString()} THEN ${counterType === 'sync' ? 1 : 0} ELSE ${userRateLimits.syncApiRequests} + ${counterType === 'sync' ? 1 : 0} END`,
              asyncApiRequests: sql`CASE WHEN ${userRateLimits.windowStart} < ${windowStart.toISOString()} THEN ${counterType === 'async' ? 1 : 0} ELSE ${userRateLimits.asyncApiRequests} + ${counterType === 'async' ? 1 : 0} END`,
              apiEndpointRequests: sql`CASE WHEN ${userRateLimits.windowStart} < ${windowStart.toISOString()} THEN ${counterType === 'api-endpoint' ? 1 : 0} ELSE ${userRateLimits.apiEndpointRequests} + ${counterType === 'api-endpoint' ? 1 : 0} END`,
              windowStart: sql`CASE WHEN ${userRateLimits.windowStart} < ${windowStart.toISOString()} THEN ${now.toISOString()} ELSE ${userRateLimits.windowStart} END`,
              lastRequestAt: now,
              isRateLimited: false,
              rateLimitResetAt: null,
            },
          })
          .returning({
            syncApiRequests: userRateLimits.syncApiRequests,
            asyncApiRequests: userRateLimits.asyncApiRequests,
            apiEndpointRequests: userRateLimits.apiEndpointRequests,
            windowStart: userRateLimits.windowStart,
          })

        const insertedRecord = result[0]
        const actualCount = this.getCountFromRecord(insertedRecord, counterType)

        // Check if we exceeded the limit
        if (actualCount > execLimit) {
          const resetAt = new Date(
            new Date(insertedRecord.windowStart).getTime() + RATE_LIMIT_WINDOW_MS
          )

          await db
            .update(userRateLimits)
            .set({
              isRateLimited: true,
              rateLimitResetAt: resetAt,
            })
            .where(eq(userRateLimits.referenceId, rateLimitKey))

          logger.info(
            `Rate limit exceeded - request ${actualCount} > limit ${execLimit} for ${
              rateLimitKey === userId ? `user ${userId}` : `organization ${rateLimitKey}`
            }`,
            {
              execLimit,
              isAsync,
              actualCount,
              rateLimitKey,
              plan: subscriptionPlan,
            }
          )

          return {
            allowed: false,
            remaining: 0,
            resetAt,
          }
        }

        return {
          allowed: true,
          remaining: execLimit - actualCount,
          resetAt: new Date(new Date(insertedRecord.windowStart).getTime() + RATE_LIMIT_WINDOW_MS),
        }
      }

      // Simple atomic increment - increment first, then check if over limit
      const updateResult = await db
        .update(userRateLimits)
        .set({
          ...(counterType === 'api-endpoint'
            ? { apiEndpointRequests: sql`${userRateLimits.apiEndpointRequests} + 1` }
            : counterType === 'async'
              ? { asyncApiRequests: sql`${userRateLimits.asyncApiRequests} + 1` }
              : { syncApiRequests: sql`${userRateLimits.syncApiRequests} + 1` }),
          lastRequestAt: now,
        })
        .where(eq(userRateLimits.referenceId, rateLimitKey))
        .returning({
          asyncApiRequests: userRateLimits.asyncApiRequests,
          syncApiRequests: userRateLimits.syncApiRequests,
          apiEndpointRequests: userRateLimits.apiEndpointRequests,
        })

      const updatedRecord = updateResult[0]
      const actualNewRequests = this.getCountFromRecord(updatedRecord, counterType)

      // Check if we exceeded the limit AFTER the atomic increment
      if (actualNewRequests > execLimit) {
        const resetAt = new Date(
          new Date(rateLimitRecord.windowStart).getTime() + RATE_LIMIT_WINDOW_MS
        )

        logger.info(
          `Rate limit exceeded - request ${actualNewRequests} > limit ${execLimit} for ${
            rateLimitKey === userId ? `user ${userId}` : `organization ${rateLimitKey}`
          }`,
          {
            execLimit,
            isAsync,
            actualNewRequests,
            rateLimitKey,
            plan: subscriptionPlan,
          }
        )

        // Update rate limited status
        await db
          .update(userRateLimits)
          .set({
            isRateLimited: true,
            rateLimitResetAt: resetAt,
          })
          .where(eq(userRateLimits.referenceId, rateLimitKey))

        return {
          allowed: false,
          remaining: 0,
          resetAt,
        }
      }

      return {
        allowed: true,
        remaining: execLimit - actualNewRequests,
        resetAt: new Date(new Date(rateLimitRecord.windowStart).getTime() + RATE_LIMIT_WINDOW_MS),
      }
    } catch (error) {
      logger.error('Error checking rate limit:', error)
      // Allow execution on error to avoid blocking users
      return {
        allowed: true,
        remaining: 0,
        resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
      }
    }
  }

  /**
   * Legacy method - for backward compatibility
   * @deprecated Use checkRateLimitWithSubscription instead
   */
  async checkRateLimit(
    userId: string,
    subscriptionPlan: SubscriptionPlan = 'free',
    triggerType: TriggerType = 'manual',
    isAsync = false
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    // For backward compatibility, fetch the subscription
    const subscription = await getHighestPrioritySubscription(userId)
    return this.checkRateLimitWithSubscription(userId, subscription, triggerType, isAsync)
  }

  /**
   * Get current rate limit status with organization awareness
   * Only applies to API executions
   */
  async getRateLimitStatusWithSubscription(
    userId: string,
    subscription: SubscriptionInfo | null,
    triggerType: TriggerType = 'manual',
    isAsync = false
  ): Promise<{ used: number; limit: number; remaining: number; resetAt: Date }> {
    try {
      if (triggerType === 'manual') {
        return {
          used: 0,
          limit: MANUAL_EXECUTION_LIMIT,
          remaining: MANUAL_EXECUTION_LIMIT,
          resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
        }
      }

      const subscriptionPlan = (subscription?.plan || 'free') as SubscriptionPlan
      const rateLimitKey = this.getRateLimitKey(userId, subscription)
      const limit = RATE_LIMITS[subscriptionPlan]

      const counterType = this.getCounterType(triggerType, isAsync)
      const execLimit = this.getRateLimitForCounter(limit, counterType)

      const now = new Date()
      const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS)

      const [rateLimitRecord] = await db
        .select()
        .from(userRateLimits)
        .where(eq(userRateLimits.referenceId, rateLimitKey))
        .limit(1)

      if (!rateLimitRecord || new Date(rateLimitRecord.windowStart) < windowStart) {
        return {
          used: 0,
          limit: execLimit,
          remaining: execLimit,
          resetAt: new Date(now.getTime() + RATE_LIMIT_WINDOW_MS),
        }
      }

      const used = this.getCountFromRecord(rateLimitRecord, counterType)
      return {
        used,
        limit: execLimit,
        remaining: Math.max(0, execLimit - used),
        resetAt: new Date(new Date(rateLimitRecord.windowStart).getTime() + RATE_LIMIT_WINDOW_MS),
      }
    } catch (error) {
      logger.error('Error getting rate limit status:', error)
      const execLimit = isAsync
        ? RATE_LIMITS[(subscription?.plan || 'free') as SubscriptionPlan]
            .asyncApiExecutionsPerMinute
        : RATE_LIMITS[(subscription?.plan || 'free') as SubscriptionPlan].syncApiExecutionsPerMinute
      return {
        used: 0,
        limit: execLimit,
        remaining: execLimit,
        resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS),
      }
    }
  }

  /**
   * Legacy method - for backward compatibility
   * @deprecated Use getRateLimitStatusWithSubscription instead
   */
  async getRateLimitStatus(
    userId: string,
    subscriptionPlan: SubscriptionPlan = 'free',
    triggerType: TriggerType = 'manual',
    isAsync = false
  ): Promise<{ used: number; limit: number; remaining: number; resetAt: Date }> {
    // For backward compatibility, fetch the subscription
    const subscription = await getHighestPrioritySubscription(userId)
    return this.getRateLimitStatusWithSubscription(userId, subscription, triggerType, isAsync)
  }

  /**
   * Reset rate limit for a user or organization
   */
  async resetRateLimit(rateLimitKey: string): Promise<void> {
    try {
      await db.delete(userRateLimits).where(eq(userRateLimits.referenceId, rateLimitKey))
      logger.info(`Reset rate limit for ${rateLimitKey}`)
    } catch (error) {
      logger.error('Error resetting rate limit:', error)
      throw error
    }
  }
}
```

### Purpose of this file

This file defines a `RateLimiter` class in TypeScript. The primary purpose of this class is to manage and enforce rate limits for users or organizations interacting with an application. It provides methods to:

-   Determine rate limit keys based on subscription plans and user/organization context.
-   Check if a user is allowed to perform an action based on their rate limit.
-   Retrieve the current rate limit status (used, limit, remaining, reset time).
-   Reset the rate limit for a specific user or organization.

The rate limiting is designed to be aware of subscription plans and can differentiate between user-level and organization-level rate limits. It also supports different types of rate limits (sync, async, API endpoint).

### Detailed Explanation

**1. Imports:**

```typescript
import { db } from '@sim/db'
import { userRateLimits } from '@sim/db/schema'
import { eq, sql } from 'drizzle-orm'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { createLogger } from '@/lib/logs/console/logger'
import {
  MANUAL_EXECUTION_LIMIT,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMITS,
  type RateLimitCounterType,
  type SubscriptionPlan,
  type TriggerType,
} from '@/services/queue/types'
```

-   `db`: An instance of the database connection, likely using Drizzle ORM.
-   `userRateLimits`: The database schema for the `user_rate_limits` table.
-   `eq, sql`: Functions from Drizzle ORM for building SQL queries (equality check and raw SQL).
-   `getHighestPrioritySubscription`: A function to retrieve the highest priority subscription for a user.
-   `createLogger`: A function to create a logger instance.
-   `MANUAL_EXECUTION_LIMIT`: A constant defining the limit for manual executions (which bypass rate limiting).
-   `RATE_LIMIT_WINDOW_MS`: A constant defining the duration of the rate limit window in milliseconds.
-   `RATE_LIMITS`: A configuration object that defines the rate limits for different subscription plans.
-   `RateLimitCounterType, SubscriptionPlan, TriggerType`: TypeScript types defining the possible values for rate limit counters, subscription plans, and trigger types.

**2. Logger Initialization:**

```typescript
const logger = createLogger('RateLimiter')
```

-   Creates a logger instance named 'RateLimiter' for logging rate limiting events and errors.

**3. `SubscriptionInfo` Interface:**

```typescript
interface SubscriptionInfo {
  plan: string
  referenceId: string
}
```

-   Defines an interface to represent subscription information, including the subscription plan and a reference ID (either user or organization ID).

**4. `RateLimiter` Class:**

```typescript
export class RateLimiter {
  // ... methods ...
}
```

-   Defines the `RateLimiter` class, which encapsulates the rate limiting logic.

**5. `getRateLimitKey` Method:**

```typescript
private getRateLimitKey(userId: string, subscription: SubscriptionInfo | null): string {
  if (!subscription) {
    return userId
  }

  const plan = subscription.plan as SubscriptionPlan

  if ((plan === 'team' || plan === 'enterprise') && subscription.referenceId !== userId) {
    return subscription.referenceId
  }

  return userId
}
```

-   Determines the rate limit key based on the user ID and subscription information.
-   If there's no subscription, it defaults to the user ID.
-   For `team` or `enterprise` plans, if the `referenceId` (organization ID) is different from the `userId`, it uses the `referenceId` as the rate limit key. This ensures that all members of an organization share the same rate limit pool.
-   Otherwise, it uses the user ID as the rate limit key (for direct user subscriptions).

**6. `getCounterType` Method:**

```typescript
private getCounterType(triggerType: TriggerType, isAsync: boolean): RateLimitCounterType {
  if (triggerType === 'api-endpoint') {
    return 'api-endpoint'
  }
  return isAsync ? 'async' : 'sync'
}
```

-   Determines the rate limit counter type based on the `triggerType` and the `isAsync` flag.
-   If the `triggerType` is 'api-endpoint', it returns 'api-endpoint'.
-   Otherwise, it returns 'async' if `isAsync` is true, and 'sync' if `isAsync` is false.  This categorizes different kinds of requests for differentiated rate limiting.

**7. `getRateLimitForCounter` Method:**

```typescript
private getRateLimitForCounter(
  config: (typeof RATE_LIMITS)[SubscriptionPlan],
  counterType: RateLimitCounterType
): number {
  switch (counterType) {
    case 'api-endpoint':
      return config.apiEndpointRequestsPerMinute
    case 'async':
      return config.asyncApiExecutionsPerMinute
    case 'sync':
      return config.syncApiExecutionsPerMinute
  }
}
```

-   Retrieves the rate limit value for a specific `counterType` from the `config` object (which is a rate limit configuration for a specific subscription plan).
-   It uses a `switch` statement to determine which property to access based on the `counterType`.

**8. `getCountFromRecord` Method:**

```typescript
private getCountFromRecord(
  record: { syncApiRequests: number; asyncApiRequests: number; apiEndpointRequests: number },
  counterType: RateLimitCounterType
): number {
  switch (counterType) {
    case 'api-endpoint':
      return record.apiEndpointRequests
    case 'async':
      return record.asyncApiRequests
    case 'sync':
      return record.syncApiRequests
  }
}
```

-   Retrieves the current count for a specific `counterType` from a rate limit record.
-   It uses a `switch` statement to determine which property to access based on the `counterType`.

**9. `checkRateLimitWithSubscription` Method:**

```typescript
async checkRateLimitWithSubscription(
  userId: string,
  subscription: SubscriptionInfo | null,
  triggerType: TriggerType = 'manual',
  isAsync = false
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  // ... logic ...
}
```

-   This is the core method for checking if a user is allowed to perform an action, taking into account their subscription and the type of action.
-   It first handles the case where the `triggerType` is 'manual'.  Manual executions bypass rate limits and returns allowed, remaining, and a reset time.
-   It determines the `subscriptionPlan`, `rateLimitKey`, `counterType`, and `execLimit`.
-   It calculates the start of the rate limit window (`windowStart`).
-   It then retrieves the rate limit record from the database using the `rateLimitKey`.

    -   If the record doesn't exist or the window has expired:
        -   It inserts a new record into the `userRateLimits` table, initializing the appropriate counter to 1.
        -   If the window has expired and the record already exists, it resets the counters and the window start using `onConflictDoUpdate` with raw SQL to handle potential race conditions. Critically, it resets the window only if it's expired.
        -   It checks if the new count exceeds the `execLimit`. If it does, it updates the record to mark the user as rate-limited and returns `allowed: false`.
        -   If the count is within the limit, it returns `allowed: true` with the remaining limit and reset time.
    -   If the record exists and the window is still valid:
        -   It atomically increments the appropriate counter in the database using raw SQL.
        -   It retrieves the updated record and checks if the new count exceeds the `execLimit`.
        -   If it does, it updates the record to mark the user as rate-limited and returns `allowed: false`.
        -   If the count is within the limit, it returns `allowed: true` with the remaining limit and reset time.
-   If any error occurs during the process, it logs the error and returns `allowed: true` to avoid blocking the user. This is important for resilience.

**10. `checkRateLimit` Method:**

```typescript
async checkRateLimit(
  userId: string,
  subscriptionPlan: SubscriptionPlan = 'free',
  triggerType: TriggerType = 'manual',
  isAsync = false
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  // For backward compatibility, fetch the subscription
  const subscription = await getHighestPrioritySubscription(userId)
  return this.checkRateLimitWithSubscription(userId, subscription, triggerType, isAsync)
}
```

-   This is a legacy method for backward compatibility.  It fetches the subscription information and calls `checkRateLimitWithSubscription`.
-   It's marked as `@deprecated`, indicating that it should not be used in new code.

**11. `getRateLimitStatusWithSubscription` Method:**

```typescript
async getRateLimitStatusWithSubscription(
  userId: string,
  subscription: SubscriptionInfo | null,
  triggerType: TriggerType = 'manual',
  isAsync = false
): Promise<{ used: number; limit: number; remaining: number; resetAt: Date }> {
  // ... logic ...
}
```

-   This method retrieves the current rate limit status for a user, taking into account their subscription.
-   Similar to `checkRateLimitWithSubscription`, it first handles manual executions.
-   It retrieves the rate limit record from the database.
-   If the record doesn't exist or the window has expired, it returns the default rate limit status based on the subscription plan.
-   Otherwise, it retrieves the used count from the record and calculates the remaining limit and reset time.
-   If any error occurs, it logs the error and returns a default rate limit status.

**12. `getRateLimitStatus` Method:**

```typescript
async getRateLimitStatus(
  userId: string,
  subscriptionPlan: SubscriptionPlan = 'free',
  triggerType: TriggerType = 'manual',
  isAsync = false
): Promise<{ used: number; limit: number; remaining: number; resetAt: Date }> {
  // For backward compatibility, fetch the subscription
  const subscription = await getHighestPrioritySubscription(userId)
  return this.getRateLimitStatusWithSubscription(userId, subscription, triggerType, isAsync)
}
```

-   This is a legacy method for backward compatibility, similar to `checkRateLimit`. It fetches the subscription information and calls `getRateLimitStatusWithSubscription`.
-   It's marked as `@deprecated`.

**13. `resetRateLimit` Method:**

```typescript
async resetRateLimit(rateLimitKey: string): Promise<void> {
  try {
    await db.delete(userRateLimits).where(eq(userRateLimits.referenceId, rateLimitKey))
    logger.info(`Reset rate limit for ${rateLimitKey}`)
  } catch (error) {
    logger.error('Error resetting rate limit:', error)
    throw error
  }
}
```

-   This method resets the rate limit for a given `rateLimitKey` by deleting the corresponding record from the `userRateLimits` table.
-   It logs a message indicating that the rate limit has been reset.
-   If any error occurs, it logs the error and re-throws the error.

### Simplification and Key Logic Breakdown

The complex logic resides primarily within `checkRateLimitWithSubscription`.  Here's a simplified breakdown:

1.  **Determine Context:**  Identify the user, their subscription, the type of request (sync, async, API endpoint), and the applicable rate limit.
2.  **Fetch or Create/Reset Record:** Retrieve the rate limit record from the database. If it doesn't exist (or the rate limit window has expired), create a new record (or reset the expired one).  The `onConflictDoUpdate` with the `CASE WHEN` statements are crucial for preventing race conditions when multiple requests happen at the same time.
3.  **Increment Counter:** Increment the appropriate counter (sync, async, or API endpoint) in the database *atomically*.
4.  **Check Against Limit:** Determine if the incremented count exceeds the rate limit.
5.  **Enforce Limit:** If the limit is exceeded, mark the user as rate-limited and return a response indicating they are blocked.
6.  **Return Status:** If the limit is not exceeded, return a response indicating the request is allowed, along with the remaining limit and the time the rate limit resets.
7.  **Error Handling:**  Handle database errors gracefully, and err on the side of allowing requests through to avoid service disruption.

The use of raw SQL (`sql\`...\``) within the `onConflictDoUpdate` and `update` calls is deliberate.  It ensures that the increment operation is atomic, preventing race conditions when multiple requests occur simultaneously.  Without this atomicity, it would be possible for multiple requests to slip through the rate limit. The `CASE WHEN` in the `onConflictDoUpdate` is important to reset the window only when it's expired, preventing race conditions.

The `getRateLimitStatusWithSubscription` provides a read-only view of the rate limit status without modifying any data.

The `resetRateLimit` provides a mechanism for administrators to clear rate limits, perhaps after a user upgrades their subscription or resolves an issue.
