```typescript
import { db } from '@sim/db'
import { webhook as webhookTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const teamsLogger = createLogger('TeamsSubscription')
const telegramLogger = createLogger('TelegramWebhook')

/**
 * Create a Microsoft Teams chat subscription
 * Returns true if successful, false otherwise
 */
export async function createTeamsSubscription(
  request: NextRequest,
  webhook: any,
  workflow: any,
  requestId: string
): Promise<boolean> {
  try {
    const config = (webhook.providerConfig as Record<string, any>) || {}

    // Only handle Teams chat subscriptions
    if (config.triggerId !== 'microsoftteams_chat_subscription') {
      return true // Not a Teams subscription, no action needed
    }

    const credentialId = config.credentialId as string | undefined
    const chatId = config.chatId as string | undefined

    if (!credentialId) {
      teamsLogger.warn(
        `[${requestId}] Missing credentialId for Teams chat subscription ${webhook.id}`
      )
      return false
    }

    if (!chatId) {
      teamsLogger.warn(`[${requestId}] Missing chatId for Teams chat subscription ${webhook.id}`)
      return false
    }

    // Get access token
    const accessToken = await refreshAccessTokenIfNeeded(credentialId, workflow.userId, requestId)
    if (!accessToken) {
      teamsLogger.error(
        `[${requestId}] Failed to get access token for Teams subscription ${webhook.id}`
      )
      return false
    }

    // Check if subscription already exists
    const existingSubscriptionId = config.externalSubscriptionId as string | undefined
    if (existingSubscriptionId) {
      try {
        const checkRes = await fetch(
          `https://graph.microsoft.com/v1.0/subscriptions/${existingSubscriptionId}`,
          { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } }
        )
        if (checkRes.ok) {
          teamsLogger.info(
            `[${requestId}] Teams subscription ${existingSubscriptionId} already exists for webhook ${webhook.id}`
          )
          return true
        }
      } catch {
        teamsLogger.debug(`[${requestId}] Existing subscription check failed, will create new one`)
      }
    }

    // Build notification URL
    // Always use NEXT_PUBLIC_APP_URL to ensure Microsoft Graph can reach the public endpoint
    const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${webhook.path}`

    // Subscribe to the specified chat
    const resource = `/chats/${chatId}/messages`

    // Create subscription with max lifetime (4230 minutes = ~3 days)
    const maxLifetimeMinutes = 4230
    const expirationDateTime = new Date(Date.now() + maxLifetimeMinutes * 60 * 1000).toISOString()

    const body = {
      changeType: 'created,updated',
      notificationUrl,
      lifecycleNotificationUrl: notificationUrl,
      resource,
      includeResourceData: false,
      expirationDateTime,
      clientState: webhook.id,
    }

    const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const payload = await res.json()
    if (!res.ok) {
      teamsLogger.error(
        `[${requestId}] Failed to create Teams subscription for webhook ${webhook.id}`,
        {
          status: res.status,
          error: payload.error,
        }
      )
      return false
    }

    // Update webhook config with subscription details
    const updatedConfig = {
      ...config,
      externalSubscriptionId: payload.id,
      subscriptionExpiration: payload.expirationDateTime,
    }

    await db
      .update(webhookTable)
      .set({ providerConfig: updatedConfig, updatedAt: new Date() })
      .where(eq(webhookTable.id, webhook.id))

    teamsLogger.info(
      `[${requestId}] Successfully created Teams subscription ${payload.id} for webhook ${webhook.id}`
    )
    return true
  } catch (error) {
    teamsLogger.error(
      `[${requestId}] Error creating Teams subscription for webhook ${webhook.id}`,
      error
    )
    return false
  }
}

/**
 * Delete a Microsoft Teams chat subscription
 * Always returns true (don't fail webhook deletion if cleanup fails)
 */
export async function deleteTeamsSubscription(
  webhook: any,
  workflow: any,
  requestId: string
): Promise<void> {
  try {
    const config = (webhook.providerConfig as Record<string, any>) || {}

    // Only handle Teams chat subscriptions
    if (config.triggerId !== 'microsoftteams_chat_subscription') {
      return // Not a Teams subscription, no action needed
    }

    const externalSubscriptionId = config.externalSubscriptionId as string | undefined
    const credentialId = config.credentialId as string | undefined

    if (!externalSubscriptionId || !credentialId) {
      teamsLogger.info(
        `[${requestId}] No external subscription to delete for webhook ${webhook.id}`
      )
      return
    }

    // Get access token
    const accessToken = await refreshAccessTokenIfNeeded(credentialId, workflow.userId, requestId)
    if (!accessToken) {
      teamsLogger.warn(
        `[${requestId}] Could not get access token to delete Teams subscription for webhook ${webhook.id}`
      )
      return // Don't fail deletion
    }

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/subscriptions/${externalSubscriptionId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )

    if (res.ok || res.status === 404) {
      teamsLogger.info(
        `[${requestId}] Successfully deleted Teams subscription ${externalSubscriptionId} for webhook ${webhook.id}`
      )
    } else {
      const errorBody = await res.text()
      teamsLogger.warn(
        `[${requestId}] Failed to delete Teams subscription ${externalSubscriptionId} for webhook ${webhook.id}. Status: ${res.status}`
      )
    }
  } catch (error) {
    teamsLogger.error(
      `[${requestId}] Error deleting Teams subscription for webhook ${webhook.id}`,
      error
    )
    // Don't fail webhook deletion
  }
}

/**
 * Create a Telegram bot webhook
 * Returns true if successful, false otherwise
 */
export async function createTelegramWebhook(
  request: NextRequest,
  webhook: any,
  requestId: string
): Promise<boolean> {
  try {
    const config = (webhook.providerConfig as Record<string, any>) || {}
    const botToken = config.botToken as string | undefined

    if (!botToken) {
      telegramLogger.warn(`[${requestId}] Missing botToken for Telegram webhook ${webhook.id}`)
      return false
    }

    const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${webhook.path}`

    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`
    const telegramResponse = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TelegramBot/1.0',
      },
      body: JSON.stringify({ url: notificationUrl }),
    })

    const responseBody = await telegramResponse.json()
    if (!telegramResponse.ok || !responseBody.ok) {
      const errorMessage =
        responseBody.description ||
        `Failed to create Telegram webhook. Status: ${telegramResponse.status}`
      telegramLogger.error(`[${requestId}] ${errorMessage}`, { response: responseBody })
      return false
    }

    telegramLogger.info(
      `[${requestId}] Successfully created Telegram webhook for webhook ${webhook.id}`
    )
    return true
  } catch (error) {
    telegramLogger.error(
      `[${requestId}] Error creating Telegram webhook for webhook ${webhook.id}`,
      error
    )
    return false
  }
}

/**
 * Delete a Telegram bot webhook
 * Always returns void (don't fail webhook deletion if cleanup fails)
 */
export async function deleteTelegramWebhook(webhook: any, requestId: string): Promise<void> {
  try {
    const config = (webhook.providerConfig as Record<string, any>) || {}
    const botToken = config.botToken as string | undefined

    if (!botToken) {
      telegramLogger.warn(
        `[${requestId}] Missing botToken for Telegram webhook deletion ${webhook.id}`
      )
      return
    }

    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/deleteWebhook`
    const telegramResponse = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    const responseBody = await telegramResponse.json()
    if (!telegramResponse.ok || !responseBody.ok) {
      const errorMessage =
        responseBody.description ||
        `Failed to delete Telegram webhook. Status: ${telegramResponse.status}`
      telegramLogger.error(`[${requestId}] ${errorMessage}`, { response: responseBody })
    } else {
      telegramLogger.info(
        `[${requestId}] Successfully deleted Telegram webhook for webhook ${webhook.id}`
      )
    }
  } catch (error) {
    telegramLogger.error(
      `[${requestId}] Error deleting Telegram webhook for webhook ${webhook.id}`,
      error
    )
    // Don't fail webhook deletion
  }
}
```

### Purpose of this file

This file contains functions to manage webhooks for Microsoft Teams and Telegram integrations. It includes functions to:

1.  **Create Teams Subscriptions:**  Sets up a subscription with Microsoft Graph to receive notifications for specific Teams chats.
2.  **Delete Teams Subscriptions:**  Removes existing Teams subscriptions.
3.  **Create Telegram Webhooks:**  Registers a webhook with Telegram to receive updates to a bot.
4.  **Delete Telegram Webhooks:**  Removes existing Telegram webhooks.

The file uses logging for debugging and error tracking. It also interacts with a database (`@sim/db`) to store and update webhook configurations.

### Explanation of each line of code

**Imports:**

```typescript
import { db } from '@sim/db'
import { webhook as webhookTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
```

*   `import { db } from '@sim/db'`: Imports the database instance from the `@sim/db` module.  This allows the code to interact with the database.
*   `import { webhook as webhookTable } from '@sim/db/schema'`: Imports the `webhook` table definition from the database schema. It's aliased as `webhookTable` for easier reference.
*   `import { eq } from 'drizzle-orm'`: Imports the `eq` function from the `drizzle-orm` library. This function is used to create equality conditions in database queries (e.g., `WHERE id = ...`).
*   `import type { NextRequest } from 'next/server'`: Imports the `NextRequest` type from `next/server`. This type represents an incoming HTTP request in a Next.js server environment.
*   `import { createLogger } from '@/lib/logs/console/logger'`: Imports a function `createLogger` to create logger instances.  These loggers are used to record events and errors.
*   `import { getBaseUrl } from '@/lib/urls/utils'`: Imports a utility function to retrieve the base URL of the application.
*   `import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'`: Imports a function to refresh an access token if it's expired. This is crucial for authenticating with external services like Microsoft Graph.

**Loggers:**

```typescript
const teamsLogger = createLogger('TeamsSubscription')
const telegramLogger = createLogger('TelegramWebhook')
```

*   Creates two logger instances, one for Teams subscriptions and one for Telegram webhooks.  The string argument to `createLogger` is likely used as a prefix or identifier for the logs.

**`createTeamsSubscription` function:**

```typescript
/**
 * Create a Microsoft Teams chat subscription
 * Returns true if successful, false otherwise
 */
export async function createTeamsSubscription(
  request: NextRequest,
  webhook: any,
  workflow: any,
  requestId: string
): Promise<boolean> {
  try {
    const config = (webhook.providerConfig as Record<string, any>) || {}

    // Only handle Teams chat subscriptions
    if (config.triggerId !== 'microsoftteams_chat_subscription') {
      return true // Not a Teams subscription, no action needed
    }

    const credentialId = config.credentialId as string | undefined
    const chatId = config.chatId as string | undefined

    if (!credentialId) {
      teamsLogger.warn(
        `[${requestId}] Missing credentialId for Teams chat subscription ${webhook.id}`
      )
      return false
    }

    if (!chatId) {
      teamsLogger.warn(`[${requestId}] Missing chatId for Teams chat subscription ${webhook.id}`)
      return false
    }

    // Get access token
    const accessToken = await refreshAccessTokenIfNeeded(credentialId, workflow.userId, requestId)
    if (!accessToken) {
      teamsLogger.error(
        `[${requestId}] Failed to get access token for Teams subscription ${webhook.id}`
      )
      return false
    }

    // Check if subscription already exists
    const existingSubscriptionId = config.externalSubscriptionId as string | undefined
    if (existingSubscriptionId) {
      try {
        const checkRes = await fetch(
          `https://graph.microsoft.com/v1.0/subscriptions/${existingSubscriptionId}`,
          { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } }
        )
        if (checkRes.ok) {
          teamsLogger.info(
            `[${requestId}] Teams subscription ${existingSubscriptionId} already exists for webhook ${webhook.id}`
          )
          return true
        }
      } catch {
        teamsLogger.debug(`[${requestId}] Existing subscription check failed, will create new one`)
      }
    }

    // Build notification URL
    // Always use NEXT_PUBLIC_APP_URL to ensure Microsoft Graph can reach the public endpoint
    const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${webhook.path}`

    // Subscribe to the specified chat
    const resource = `/chats/${chatId}/messages`

    // Create subscription with max lifetime (4230 minutes = ~3 days)
    const maxLifetimeMinutes = 4230
    const expirationDateTime = new Date(Date.now() + maxLifetimeMinutes * 60 * 1000).toISOString()

    const body = {
      changeType: 'created,updated',
      notificationUrl,
      lifecycleNotificationUrl: notificationUrl,
      resource,
      includeResourceData: false,
      expirationDateTime,
      clientState: webhook.id,
    }

    const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const payload = await res.json()
    if (!res.ok) {
      teamsLogger.error(
        `[${requestId}] Failed to create Teams subscription for webhook ${webhook.id}`,
        {
          status: res.status,
          error: payload.error,
        }
      )
      return false
    }

    // Update webhook config with subscription details
    const updatedConfig = {
      ...config,
      externalSubscriptionId: payload.id,
      subscriptionExpiration: payload.expirationDateTime,
    }

    await db
      .update(webhookTable)
      .set({ providerConfig: updatedConfig, updatedAt: new Date() })
      .where(eq(webhookTable.id, webhook.id))

    teamsLogger.info(
      `[${requestId}] Successfully created Teams subscription ${payload.id} for webhook ${webhook.id}`
    )
    return true
  } catch (error) {
    teamsLogger.error(
      `[${requestId}] Error creating Teams subscription for webhook ${webhook.id}`,
      error
    )
    return false
  }
}
```

*   **Function Signature:**
    *   `export async function createTeamsSubscription(...)`: Defines an asynchronous function named `createTeamsSubscription` that creates a Microsoft Teams chat subscription.
    *   `request: NextRequest`:  A Next.js request object, likely used for accessing headers or other request-specific data.
    *   `webhook: any`: An object containing webhook information (e.g., ID, path, provider configuration).  The `any` type should ideally be replaced with a more specific type definition.
    *   `workflow: any`: An object containing workflow information, including the user ID.  The `any` type should ideally be replaced with a more specific type definition.
    *   `requestId: string`:  A unique identifier for the request, used for logging and tracking.
    *   `Promise<boolean>`:  The function returns a promise that resolves to a boolean value, indicating success or failure.
*   **Error Handling:**
    *   The entire function is wrapped in a `try...catch` block to handle potential errors during the subscription creation process.
    *   If an error occurs, the `teamsLogger.error` method is used to log the error, and the function returns `false`.
*   **Configuration Extraction:**
    *   `const config = (webhook.providerConfig as Record<string, any>) || {}`: Extracts the provider configuration from the `webhook` object.  If `webhook.providerConfig` is null or undefined, it defaults to an empty object.  The `as Record<string, any>` is a type assertion, and it's good practice to define a proper type instead of using `any`.
*   **Teams Chat Subscription Check:**
    *   `if (config.triggerId !== 'microsoftteams_chat_subscription') { return true }`: Checks if the webhook is actually intended for Teams chat subscriptions. If not, it returns `true` (indicating no action is needed), effectively skipping the rest of the function. This is likely used when the same function is called for other webhook types.
*   **Credential and Chat ID Validation:**
    *   `const credentialId = config.credentialId as string | undefined`: Extracts the `credentialId` from the configuration.  `undefined` is used as a possible value to handle cases where the credential id is not present.
    *   `const chatId = config.chatId as string | undefined`: Extracts the `chatId` from the configuration.
    *   The code then checks if `credentialId` and `chatId` are present. If either is missing, it logs a warning using `teamsLogger.warn` and returns `false`.
*   **Access Token Retrieval:**
    *   `const accessToken = await refreshAccessTokenIfNeeded(credentialId, workflow.userId, requestId)`: Calls the `refreshAccessTokenIfNeeded` function to retrieve a valid access token. The `credentialId`, `workflow.userId`, and `requestId` are passed as arguments.
    *   If the `accessToken` is not successfully retrieved, it logs an error using `teamsLogger.error` and returns `false`.
*   **Check for Existing Subscription:**
    *   `const existingSubscriptionId = config.externalSubscriptionId as string | undefined`: Extracts `externalSubscriptionId` from config.
    *   If `externalSubscriptionId` exists, the code attempts to check if the subscription already exists by making a `GET` request to the Microsoft Graph API:
        *   `fetch(\`https://graph.microsoft.com/v1.0/subscriptions/${existingSubscriptionId}\`, ...)`: Sends a GET request to the Microsoft Graph API to check if the subscription with the given ID exists.
        *   If the request is successful (`checkRes.ok`), it logs an informational message and returns `true`.
        *   If the request fails (e.g., the subscription doesn't exist), it logs a debug message and proceeds to create a new subscription.
*   **Build Notification URL:**
    *   `const notificationUrl = \`\${getBaseUrl()}/api/webhooks/trigger/\${webhook.path}\``: Constructs the notification URL that Microsoft Graph will use to send notifications.  It uses the `getBaseUrl()` function to get the application's base URL and appends the webhook's path.  This URL *must* be publicly accessible for Microsoft Graph to reach it.
*   **Subscription Details:**
    *   `const resource = \`/chats/\${chatId}/messages\``: Defines the Microsoft Graph resource to subscribe to (messages in the specified chat).
    *   `const maxLifetimeMinutes = 4230`: Defines the maximum lifetime of the subscription in minutes (approximately 3 days).  Microsoft Graph subscriptions have a limited lifetime.
    *   `const expirationDateTime = new Date(Date.now() + maxLifetimeMinutes * 60 * 1000).toISOString()`: Calculates the expiration date and time for the subscription.
*   **Subscription Request Body:**
    *   A `body` object is constructed, containing the following properties:
        *   `changeType`:  Specifies the types of changes to be notified about (`created,updated`).
        *   `notificationUrl`: The URL where notifications will be sent.
        *   `lifecycleNotificationUrl`:  The URL where lifecycle notifications (e.g., subscription expiration) will be sent.
        *   `resource`: The Microsoft Graph resource to subscribe to.
        *   `includeResourceData`:  Indicates whether to include resource data in the notification (set to `false` for this example).
        *   `expirationDateTime`: The expiration date and time for the subscription.
        *   `clientState`: A value that will be included in the notification to help correlate it with the webhook.  Here, it's set to the webhook's ID.
*   **Create Subscription via Microsoft Graph:**
    *   `const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', ...)`: Sends a `POST` request to the Microsoft Graph API to create the subscription.
        *   The `Authorization` header is set to `Bearer ${accessToken}` to authenticate the request.
        *   The `Content-Type` header is set to `application/json`.
        *   The `body` of the request is the JSON stringified subscription details.
*   **Handle Subscription Creation Response:**
    *   `const payload = await res.json()`: Parses the JSON response from the Microsoft Graph API.
    *   If the response status is not `ok`, it logs an error with the status code and error details from the payload and returns `false`.
*   **Update Webhook Configuration:**
    *   `const updatedConfig = { ...config, externalSubscriptionId: payload.id, subscriptionExpiration: payload.expirationDateTime }`: Creates a new configuration object by merging the existing configuration with the `externalSubscriptionId` and `subscriptionExpiration` from the Microsoft Graph response.
    *   `await db.update(webhookTable).set({ providerConfig: updatedConfig, updatedAt: new Date() }).where(eq(webhookTable.id, webhook.id))`: Updates the `webhookTable` in the database with the new configuration and update timestamp.
        *   `db.update(webhookTable)`:  Starts an update query on the `webhookTable`.
        *   `.set({ providerConfig: updatedConfig, updatedAt: new Date() })`: Sets the `providerConfig` to the updated configuration and updates the `updatedAt` field to the current date and time.
        *   `.where(eq(webhookTable.id, webhook.id))`:  Specifies the condition for the update, matching the webhook with the provided ID.
*   **Success Logging and Return:**
    *   `teamsLogger.info(\`[${requestId}] Successfully created Teams subscription ${payload.id} for webhook ${webhook.id}\`)`: Logs a success message with the subscription ID.
    *   `return true`: Returns `true` to indicate that the subscription was created successfully.

**`deleteTeamsSubscription` function:**

```typescript
/**
 * Delete a Microsoft Teams chat subscription
 * Always returns true (don't fail webhook deletion if cleanup fails)
 */
export async function deleteTeamsSubscription(
  webhook: any,
  workflow: any,
  requestId: string
): Promise<void> {
  try {
    const config = (webhook.providerConfig as Record<string, any>) || {}

    // Only handle Teams chat subscriptions
    if (config.triggerId !== 'microsoftteams_chat_subscription') {
      return // Not a Teams subscription, no action needed
    }

    const externalSubscriptionId = config.externalSubscriptionId as string | undefined
    const credentialId = config.credentialId as string | undefined

    if (!externalSubscriptionId || !credentialId) {
      teamsLogger.info(
        `[${requestId}] No external subscription to delete for webhook ${webhook.id}`
      )
      return
    }

    // Get access token
    const accessToken = await refreshAccessTokenIfNeeded(credentialId, workflow.userId, requestId)
    if (!accessToken) {
      teamsLogger.warn(
        `[${requestId}] Could not get access token to delete Teams subscription for webhook ${webhook.id}`
      )
      return // Don't fail deletion
    }

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/subscriptions/${externalSubscriptionId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )

    if (res.ok || res.status === 404) {
      teamsLogger.info(
        `[${requestId}] Successfully deleted Teams subscription ${externalSubscriptionId} for webhook ${webhook.id}`
      )
    } else {
      const errorBody = await res.text()
      teamsLogger.warn(
        `[${requestId}] Failed to delete Teams subscription ${externalSubscriptionId} for webhook ${webhook.id}. Status: ${res.status}`
      )
    }
  } catch (error) {
    teamsLogger.error(
      `[${requestId}] Error deleting Teams subscription for webhook ${webhook.id}`,
      error
    )
    // Don't fail webhook deletion
  }
}
```

*   **Function Signature:**
    *   `export async function deleteTeamsSubscription(...)`: Defines an asynchronous function to delete a Teams subscription.
    *   `webhook: any`:  The webhook object.
    *   `workflow: any`: The workflow object.
    *   `requestId: string`: The request ID for logging.
    *   `Promise<void>`: The function returns a promise that resolves to void because it should *not* cause the webhook deletion process to fail if deleting the subscription fails.
*   **Error Handling:**
    *   The function is wrapped in a `try...catch` block to handle errors during the deletion process. The catch block logs the error but does *not* re-throw or return an error value, because the function is designed to *always* succeed so that webhook deletion isn't blocked.
*   **Configuration Extraction and Validation:**
    *   Extracts the provider configuration (`config`) from the `webhook` object, defaulting to an empty object if `providerConfig` is null or undefined.
    *   Checks if the `triggerId` is `microsoftteams_chat_subscription`.  If not, the function returns early.
    *   Retrieves `externalSubscriptionId` and `credentialId` from `config`.  If either is missing, logs an info message and returns, as there's nothing to delete.
*   **Access Token Retrieval:**
    *   Retrieves an access token using `refreshAccessTokenIfNeeded`. If this fails, it logs a warning and returns, because deletion should not fail.
*   **Deletion via Microsoft Graph:**
    *   `fetch(\`https://graph.microsoft.com/v1.0/subscriptions/${externalSubscriptionId}\`, ...)`: Sends a `DELETE` request to the Microsoft Graph API to delete the subscription.
        *   If the request is successful (`res.ok`) or returns a 404 (Not Found), it logs a success message. A 404 indicates the subscription didn't exist, which can happen if it was already deleted.
        *   If the request fails, it logs a warning with the status code and error details.
*   **Return Value:**
    *   Returns `void`. The function is designed to *always* succeed, even if deleting the Microsoft Teams subscription fails.  This is important so that failures here don't prevent a webhook from being deleted.

**`createTelegramWebhook` function:**

```typescript
/**
 * Create a Telegram bot webhook
 * Returns true if successful, false otherwise
 */
export async function createTelegramWebhook(
  request: NextRequest,
  webhook: any,
  requestId: string
): Promise<boolean> {
  try {
    const config = (webhook.providerConfig as Record<string, any>) || {}
    const botToken = config.botToken as string | undefined

    if (!botToken) {
      telegramLogger.warn(`[${requestId}] Missing botToken for Telegram webhook ${webhook.id}`)
      return false
    }

    const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${webhook.path}`

    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`
    const telegramResponse = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TelegramBot/1.0',
      },
      body: JSON.stringify({ url: notificationUrl }),
    })

    const responseBody = await telegramResponse.json()
    if (!telegramResponse.ok || !responseBody.ok) {
      const errorMessage =
        responseBody.description ||
        `Failed to create Telegram webhook. Status: ${telegramResponse.status}`
      telegramLogger.error(`[${requestId}] ${errorMessage}`, { response: responseBody })
      return false
    }

    telegramLogger.info(
      `[${requestId}] Successfully created Telegram webhook for webhook ${webhook.id}`
    )
    return true
  } catch (error) {
    telegramLogger.error(
      `[${requestId}] Error creating Telegram webhook for webhook ${webhook.id}`,
      error
    )
    return false
  }
}
```

*   **Function Signature:**
    *   `export async function createTelegramWebhook(...)`: Defines an asynchronous function to create a Telegram webhook.
    *   `request: NextRequest`:  The Next.js request object.
    *   `webhook: any`: The webhook object.
    *   `requestId: string`:  The request ID.
    *   `Promise<boolean>`:  Returns `true` if the webhook is created successfully, `false` otherwise.
*   **Error Handling:**
    *   The function is wrapped in a `try...catch` block to handle potential errors.
*   **Configuration Extraction and Validation:**
    *   Extracts the `botToken` from the `webhook.providerConfig`.
    *   If `botToken` is missing, logs a warning and returns `false`.
*   **Build Notification URL:**
    *   Constructs the `notificationUrl` using `getBaseUrl()` and the webhook's path, similar to the Teams function.
*   **Create Webhook via Telegram API:**
    *   `fetch(telegramApiUrl, ...)`: Sends a `POST` request to the Telegram API's `setWebhook` endpoint.
        *   The `telegramApiUrl` is constructed using the `botToken`.
        *   The `Content-Type` header is set to `application/json`.
        *    The `User-Agent` header is set to `TelegramBot/1.0`.
        *   The body includes the `url` parameter, which is set to the `notificationUrl`.
*   **Handle Telegram API Response:**
    *   `const responseBody = await telegramResponse.json()`: Parses the JSON response from the Telegram API.
    *   If the response is not `ok` (either `telegramResponse.ok` or `responseBody.ok` is false), it logs an error message with details from the response and returns `false`.
*   **Success Logging and Return:**
    *   Logs a success message if the webhook is created successfully.
    *   Returns `true`.

**`deleteTelegramWebhook` function:**

```typescript
/**
 * Delete a Telegram bot webhook
 * Always returns void (don't fail webhook deletion if cleanup fails)
 */
export async function deleteTelegramWebhook(webhook: any, requestId: string): Promise<void> {
  try {
    const config = (webhook.providerConfig as Record<string, any>) || {}
    const botToken = config.botToken as string | undefined

    if (!botToken) {
      telegramLogger.warn(
        `[${requestId}] Missing botToken for Telegram webhook deletion ${webhook.id}`
      )
      return
    }

    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/deleteWebhook`
    const telegramResponse = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    const responseBody = await telegramResponse.json()
    if (!telegramResponse.ok || !responseBody.ok) {
      const errorMessage =
        responseBody.description ||
        `Failed to delete Telegram webhook. Status: ${telegramResponse.status}`
      telegramLogger.error(`[${requestId}] ${errorMessage}`, { response: responseBody })
    } else {
      telegramLogger.info(
        `[${requestId}] Successfully deleted Telegram webhook for webhook ${webhook.id}`
      )
    }
  } catch (error) {
    telegramLogger.error(
      `[${requestId}] Error deleting Telegram webhook for webhook ${webhook.id}`,
      error
    )
    // Don't fail webhook deletion
  }
}
```

*   **Function Signature:**
    *   `export async function deleteTelegramWebhook(...)`: Defines an asynchronous function to delete a Telegram webhook.
    *   `webhook: any`: The webhook object.
    *   `requestId: string`: The request ID.
    *   `Promise<void>`: Returns `void` because it does not want to cause the webhook deletion process to fail.
*   **Error Handling:**
    *   The function is wrapped in a `try...catch` block.  The catch block logs the error but *does not* re-throw or return an error, ensuring that deletion failures don't block the overall process.
*   **