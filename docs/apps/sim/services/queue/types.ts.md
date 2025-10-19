## Explanation of Rate Limiting Configuration in TypeScript

This TypeScript file defines the types, configurations, and constants related to rate limiting within an application. It aims to provide a structured and configurable system to control the frequency of various actions performed by users, based on their subscription plan and the type of trigger initiating the action. Let's break down each section:

**1. Imports:**

```typescript
import type { userRateLimits } from '@sim/db/schema'
import type { InferSelectModel } from 'drizzle-orm'
import { env } from '@/lib/env'
```

-   `import type { userRateLimits } from '@sim/db/schema'`: This line imports the type definition `userRateLimits` from a database schema file (`@sim/db/schema`).  This type likely represents the structure of the `user_rate_limits` table in the database, defining the columns and their data types related to user-specific rate limit information. The `type` keyword ensures that this import is only used for type checking and doesn't introduce any runtime dependencies.
-   `import type { InferSelectModel } from 'drizzle-orm'`: This line imports the `InferSelectModel` type from the `drizzle-orm` library. Drizzle ORM is a TypeScript ORM (Object-Relational Mapper). `InferSelectModel` is a utility type that automatically infers the TypeScript type of a database table's select model, i.e., the shape of the data returned when querying that table.
-   `import { env } from '@/lib/env'`: This line imports the `env` object from a file located at `@/lib/env`. This `env` object is assumed to hold environment variables used to configure the rate limiting parameters. This pattern is used to configure values like rate limits without hardcoding them into the application.

**2. Database Types:**

```typescript
export type UserRateLimit = InferSelectModel<typeof userRateLimits>
```

-   `export type UserRateLimit = InferSelectModel<typeof userRateLimits>`: This line defines a TypeScript type alias called `UserRateLimit`. It uses the `InferSelectModel` utility type to automatically create a type that represents the data structure of a row fetched from the `userRateLimits` table.  `typeof userRateLimits` provides the type information of the imported database schema. This type is then exported, so it can be used in other parts of the application to represent user rate limit data retrieved from the database.

**3. Trigger Types:**

```typescript
export type TriggerType = 'api' | 'webhook' | 'schedule' | 'manual' | 'chat' | 'api-endpoint'
```

-   `export type TriggerType = 'api' | 'webhook' | 'schedule' | 'manual' | 'chat' | 'api-endpoint'`: This line defines a TypeScript type called `TriggerType` as a union of string literals. This type represents the different events or sources that can trigger an action subject to rate limiting.  The allowed values are:
    -   `'api'`: Actions triggered by an API call.
    -   `'webhook'`: Actions triggered by a webhook event.
    -   `'schedule'`: Actions triggered by a scheduled job.
    -   `'manual'`: Actions triggered manually by a user.
    -   `'chat'`: Actions triggered through a chat interface.
    -   `'api-endpoint'`: Actions triggered by an internal API endpoint.
    This type ensures that only valid trigger types are used in the application, improving type safety.

**4. Rate Limit Counter Types:**

```typescript
export type RateLimitCounterType = 'sync' | 'async' | 'api-endpoint'
```

-   `export type RateLimitCounterType = 'sync' | 'async' | 'api-endpoint'`: This line defines a TypeScript type called `RateLimitCounterType` as a union of string literals. This type specifies which counter in the database should be incremented when a rate-limited action is performed. The allowed values are:
    -   `'sync'`: Counter for synchronous API executions.
    -   `'async'`: Counter for asynchronous API executions.
    -   `'api-endpoint'`: Counter for internal API endpoint requests.
    This type helps to categorize and track different types of rate-limited actions separately.

**5. Subscription Plan Types:**

```typescript
export type SubscriptionPlan = 'free' | 'pro' | 'team' | 'enterprise'
```

-   `export type SubscriptionPlan = 'free' | 'pro' | 'team' | 'enterprise'`: This line defines a TypeScript type called `SubscriptionPlan` as a union of string literals. It represents the different subscription tiers available to users. This allows different rate limits to be applied based on the user's subscription plan.

**6. Rate Limit Configuration Interface:**

```typescript
export interface RateLimitConfig {
  syncApiExecutionsPerMinute: number
  asyncApiExecutionsPerMinute: number
  apiEndpointRequestsPerMinute: number // For external API endpoints like /api/v1/logs
}
```

-   `export interface RateLimitConfig { ... }`: This line defines a TypeScript interface called `RateLimitConfig`.  An interface describes the shape of an object.  This interface is used to define the structure of the rate limit configuration for each subscription plan.
    -   `syncApiExecutionsPerMinute: number`:  Specifies the maximum number of synchronous API executions allowed per minute.
    -   `asyncApiExecutionsPerMinute: number`: Specifies the maximum number of asynchronous API executions allowed per minute.
    -   `apiEndpointRequestsPerMinute: number`: Specifies the maximum number of requests allowed per minute for internal API endpoints.  The comment clarifies that this applies to external API endpoints.
    This interface provides a clear and type-safe way to define the rate limits for different types of actions.

**7. Rate Limit Window Duration:**

```typescript
export const RATE_LIMIT_WINDOW_MS = Number.parseInt(env.RATE_LIMIT_WINDOW_MS) || 60000
```

-   `export const RATE_LIMIT_WINDOW_MS = Number.parseInt(env.RATE_LIMIT_WINDOW_MS) || 60000`: This line defines a constant called `RATE_LIMIT_WINDOW_MS`, representing the duration of the rate limiting window in milliseconds.
    -   `env.RATE_LIMIT_WINDOW_MS`: Reads the value of the environment variable `RATE_LIMIT_WINDOW_MS`. It's expected to be a string representation of a number.
    -   `Number.parseInt(...)`: Attempts to parse the environment variable value into an integer.
    -   `|| 60000`:  Uses the "or" operator to provide a default value of `60000` (60 seconds or 1 minute) if the environment variable is not set or cannot be parsed into a number. This ensures that a valid window duration is always used.

**8. Manual Execution Limit:**

```typescript
export const MANUAL_EXECUTION_LIMIT = Number.parseInt(env.MANUAL_EXECUTION_LIMIT) || 999999
```

-   `export const MANUAL_EXECUTION_LIMIT = Number.parseInt(env.MANUAL_EXECUTION_LIMIT) || 999999`: This line defines a constant called `MANUAL_EXECUTION_LIMIT`, representing the rate limit for manually triggered actions.
    -   `env.MANUAL_EXECUTION_LIMIT`: Reads the value of the environment variable `MANUAL_EXECUTION_LIMIT`.  It's expected to be a string representation of a number.
    -   `Number.parseInt(...)`: Attempts to parse the environment variable value into an integer.
    -   `|| 999999`: Uses the "or" operator to provide a very high default value of `999999` if the environment variable is not set or cannot be parsed. This effectively bypasses rate limiting for manual executions, allowing them to occur almost without limit.

**9. Rate Limits Configuration:**

```typescript
export const RATE_LIMITS: Record<SubscriptionPlan, RateLimitConfig> = {
  free: {
    syncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_FREE_SYNC) || 10,
    asyncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_FREE_ASYNC) || 50,
    apiEndpointRequestsPerMinute: 10,
  },
  pro: {
    syncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_PRO_SYNC) || 25,
    asyncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_PRO_ASYNC) || 200,
    apiEndpointRequestsPerMinute: 30,
  },
  team: {
    syncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_TEAM_SYNC) || 75,
    asyncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_TEAM_ASYNC) || 500,
    apiEndpointRequestsPerMinute: 60,
  },
  enterprise: {
    syncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_ENTERPRISE_SYNC) || 150,
    asyncApiExecutionsPerMinute: Number.parseInt(env.RATE_LIMIT_ENTERPRISE_ASYNC) || 1000,
    apiEndpointRequestsPerMinute: 120,
  },
}
```

-   `export const RATE_LIMITS: Record<SubscriptionPlan, RateLimitConfig> = { ... }`: This line defines a constant called `RATE_LIMITS`.  It's a record (an object) where:
    -   The keys are of type `SubscriptionPlan` (i.e., 'free', 'pro', 'team', 'enterprise').
    -   The values are of type `RateLimitConfig` (defined in the interface above).
    This structure allows you to easily look up the rate limit configuration for a specific subscription plan.
-   Inside the object, each subscription plan ('free', 'pro', 'team', 'enterprise') is associated with a `RateLimitConfig` object, specifying the rate limits for synchronous API executions, asynchronous API executions, and API endpoint requests per minute.
-   For each rate limit value, it reads the corresponding environment variable (e.g., `env.RATE_LIMIT_FREE_SYNC`) and attempts to parse it into an integer using `Number.parseInt()`. If the environment variable is not set or cannot be parsed, a default value is used (e.g., `10` for `free.syncApiExecutionsPerMinute`).  This ensures that default rate limits are in place if the environment variables are not configured.

**10. Custom Error Class:**

```typescript
export class RateLimitError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 429) {
    super(message)
    this.name = 'RateLimitError'
    this.statusCode = statusCode
  }
}
```

-   `export class RateLimitError extends Error { ... }`: This line defines a custom error class called `RateLimitError` that extends the built-in `Error` class.
    -   `statusCode: number`:  Adds a `statusCode` property to the error object, which is used to indicate the HTTP status code to be returned when a rate limit is exceeded.
    -   `constructor(message: string, statusCode = 429)`: Defines the constructor for the `RateLimitError` class.
        -   `message: string`:  Takes a `message` argument that describes the error. This message will be passed to the parent `Error` class.
        -   `statusCode = 429`: Takes an optional `statusCode` argument, defaulting to `429` (Too Many Requests), which is the standard HTTP status code for rate limiting errors.
        -   `super(message)`: Calls the constructor of the parent `Error` class, passing the error message.
        -   `this.name = 'RateLimitError'`: Sets the `name` property of the error object to `'RateLimitError'`. This helps to identify the type of error.
        -   `this.statusCode = statusCode`: Sets the `statusCode` property of the error object to the provided `statusCode`.

**Summary**

This file provides a comprehensive configuration for rate limiting in a TypeScript application. It uses types to ensure safety and clarity, and environment variables to configure the rate limits without needing to change the code. The custom `RateLimitError` class allows the application to handle rate limiting errors in a consistent and informative manner. The clear separation of concerns and the use of environment variables make this configuration flexible, maintainable, and adaptable to different environments.
