Okay, let's break down this TypeScript code. This file defines functions for processing incoming webhooks, including parsing the request, verifying authentication, checking rate limits, and queuing the webhook execution. It's a crucial part of a system that allows external services to trigger actions within the application.

**Purpose of this File**

The primary purpose of this file is to handle incoming webhook requests. It performs the following key tasks:

1.  **Parsing the Webhook Body:** Extracts and parses the body of the incoming request, handling different content types (JSON, form-urlencoded).
2.  **Handling Provider Challenges:** Responds to challenges from providers like Slack and WhatsApp (used for webhook verification during setup).
3.  **Finding the Webhook and Workflow:**  Retrieves the relevant webhook configuration and associated workflow from the database, based on the webhook's ID or path.
4.  **Verifying Provider Authentication:** Validates the request's authenticity based on the provider (e.g., Microsoft Teams HMAC signature verification, Google Forms token validation, Generic token verification).
5.  **Checking Rate Limits:** Ensures that the webhook is not exceeding the allowed rate of requests for the user.
6.  **Checking Usage Limits:**  Ensures that the user has not exceeded the maximum allowed usage of the platform.
7.  **Queuing Webhook Execution:**  Adds the webhook execution to a queue (using either Trigger.dev or a direct execution function) for background processing.

**Overall Workflow**

The typical flow when a webhook request hits this code is:

1.  The request arrives at an API endpoint that calls these functions.
2.  `parseWebhookBody` extracts and validates the request body.
3.  `handleProviderChallenges` checks for and responds to provider challenges.
4.  `findWebhookAndWorkflow` retrieves the webhook and workflow configuration from the database.
5.  `verifyProviderAuth` validates the request's authenticity.
6.  `checkRateLimits` makes sure the user isn't exceeding their rate limit.
7.  `checkUsageLimits` checks if the user has exceeded their usage limits.
8.  `queueWebhookExecution` adds the webhook execution to a queue.
9.  A response is sent back to the webhook sender.

**Code Explanation (Line by Line)**

```typescript
import { db, webhook, workflow } from '@sim/db'
import { tasks } from '@trigger.dev/sdk'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getApiKeyOwnerUserId } from '@/lib/api-key/service'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { env, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import {
  handleSlackChallenge,
  handleWhatsAppVerification,
  validateMicrosoftTeamsSignature,
  verifyProviderWebhook,
} from '@/lib/webhooks/utils'
import { executeWebhookJob } from '@/background/webhook-execution'
import { RateLimiter } from '@/services/queue'

// Imports:
// - db, webhook, workflow:  Database connection and table definitions from `@sim/db`. Assumed to be using Drizzle ORM.
// - tasks: Functions for interacting with the Trigger.dev task queue.
// - and, eq: Drizzle ORM functions for building SQL queries (AND, equals).
// - NextRequest, NextResponse:  Types from Next.js for handling HTTP requests and responses.
// - getApiKeyOwnerUserId: A function to retrieve the user ID associated with an API key.
// - checkServerSideUsageLimits: A function to check server-side usage limits for a user.
// - getHighestPrioritySubscription: A function to get the highest priority subscription for a user, used for billing.
// - env, isTruthy: Functions to access environment variables. `isTruthy` checks if an env variable is truthy.
// - createLogger:  A function to create a logger instance.
// - handleSlackChallenge, handleWhatsAppVerification, validateMicrosoftTeamsSignature, verifyProviderWebhook:  Utility functions for handling provider-specific webhook challenges and verifications.
// - executeWebhookJob: A function to execute the webhook job directly (without Trigger.dev).
// - RateLimiter: A class for implementing rate limiting.

const logger = createLogger('WebhookProcessor')

// Creates a logger instance specifically for this module, labeled as "WebhookProcessor".

export interface WebhookProcessorOptions {
  requestId: string
  path?: string
  webhookId?: string
  testMode?: boolean
  executionTarget?: 'deployed' | 'live'
}

// Defines an interface for options passed to the webhook processing functions.
// - requestId: A unique ID for the request, used for logging and tracing.
// - path: The webhook path (optional).
// - webhookId: The webhook ID (optional). Either path or webhookId must be present to identify the webhook.
// - testMode:  A boolean indicating if the webhook is being processed in test mode (optional).
// - executionTarget: Indicates if the webhook should be run in deployed or live mode.

export async function parseWebhookBody(
  request: NextRequest,
  requestId: string
): Promise<{ body: any; rawBody: string } | NextResponse> {
  let rawBody: string | null = null
  try {
    const requestClone = request.clone()
    rawBody = await requestClone.text()

    if (!rawBody || rawBody.length === 0) {
      logger.warn(`[${requestId}] Rejecting request with empty body`)
      return new NextResponse('Empty request body', { status: 400 })
    }
  } catch (bodyError) {
    logger.error(`[${requestId}] Failed to read request body`, {
      error: bodyError instanceof Error ? bodyError.message : String(bodyError),
    })
    return new NextResponse('Failed to read request body', { status: 400 })
  }

  let body: any
  try {
    const contentType = request.headers.get('content-type') || ''

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = new URLSearchParams(rawBody)
      const payloadString = formData.get('payload')

      if (!payloadString) {
        logger.warn(`[${requestId}] No payload field found in form-encoded data`)
        return new NextResponse('Missing payload field', { status: 400 })
      }

      body = JSON.parse(payloadString)
      logger.debug(`[${requestId}] Parsed form-encoded GitHub webhook payload`)
    } else {
      body = JSON.parse(rawBody)
      logger.debug(`[${requestId}] Parsed JSON webhook payload`)
    }

    if (Object.keys(body).length === 0) {
      logger.warn(`[${requestId}] Rejecting empty JSON object`)
      return new NextResponse('Empty JSON payload', { status: 400 })
    }
  } catch (parseError) {
    logger.error(`[${requestId}] Failed to parse webhook body`, {
      error: parseError instanceof Error ? parseError.message : String(parseError),
      contentType: request.headers.get('content-type'),
      bodyPreview: `${rawBody?.slice(0, 100)}...`,
    })
    return new NextResponse('Invalid payload format', { status: 400 })
  }

  return { body, rawBody }
}

// Parses the webhook body from the request.
// - Clones the request to read the body without consuming it.
// - Handles empty bodies by returning a 400 error.
// - Handles `application/x-www-form-urlencoded` content type (used by GitHub webhooks, etc.) by extracting the `payload` field and parsing it as JSON.
// - Handles `application/json` content type by parsing the entire body as JSON.
// - Handles empty JSON objects by returning a 400 error.
// - Logs errors during body reading or parsing and returns a 400 error.
// - Returns the parsed body and the raw body as a string.

export async function handleProviderChallenges(
  body: any,
  request: NextRequest,
  requestId: string,
  path: string
): Promise<NextResponse | null> {
  const slackResponse = handleSlackChallenge(body)
  if (slackResponse) {
    return slackResponse
  }

  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  const whatsAppResponse = await handleWhatsAppVerification(requestId, path, mode, token, challenge)
  if (whatsAppResponse) {
    return whatsAppResponse
  }

  return null
}

// Handles provider-specific webhook challenges (e.g., Slack, WhatsApp).
// - Calls `handleSlackChallenge` to check if the request is a Slack challenge. If so, returns the response.
// - Extracts the `hub.mode`, `hub.verify_token`, and `hub.challenge` parameters from the URL (used by WhatsApp verification).
// - Calls `handleWhatsAppVerification` to handle WhatsApp verification. If successful, returns the response.
// - Returns `null` if no challenge is detected.

export async function findWebhookAndWorkflow(
  options: WebhookProcessorOptions
): Promise<{ webhook: any; workflow: any } | null> {
  if (options.webhookId) {
    const results = await db
      .select({
        webhook: webhook,
        workflow: workflow,
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(and(eq(webhook.id, options.webhookId), eq(webhook.isActive, true)))
      .limit(1)

    if (results.length === 0) {
      logger.warn(`[${options.requestId}] No active webhook found for id: ${options.webhookId}`)
      return null
    }

    return { webhook: results[0].webhook, workflow: results[0].workflow }
  }

  if (options.path) {
    const results = await db
      .select({
        webhook: webhook,
        workflow: workflow,
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(and(eq(webhook.path, options.path), eq(webhook.isActive, true)))
      .limit(1)

    if (results.length === 0) {
      logger.warn(`[${options.requestId}] No active webhook found for path: ${options.path}`)
      return null
    }

    return { webhook: results[0].webhook, workflow: results[0].workflow }
  }

  return null
}

// Finds the webhook and associated workflow in the database based on either the `webhookId` or the `path` provided in the options.
// - Uses Drizzle ORM to query the database.
// - Joins the `webhook` and `workflow` tables on `webhook.workflowId = workflow.id`.
// - Filters the results based on the `webhookId` or `path` and `webhook.isActive = true`.
// - Limits the result to 1.
// - Returns an object containing the `webhook` and `workflow` if found, otherwise returns `null`.

export async function verifyProviderAuth(
  foundWebhook: any,
  request: NextRequest,
  rawBody: string,
  requestId: string
): Promise<NextResponse | null> {
  if (foundWebhook.provider === 'microsoftteams') {
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}

    if (providerConfig.hmacSecret) {
      const authHeader = request.headers.get('authorization')

      if (!authHeader || !authHeader.startsWith('HMAC ')) {
        logger.warn(
          `[${requestId}] Microsoft Teams outgoing webhook missing HMAC authorization header`
        )
        return new NextResponse('Unauthorized - Missing HMAC signature', { status: 401 })
      }

      const isValidSignature = validateMicrosoftTeamsSignature(
        providerConfig.hmacSecret,
        authHeader,
        rawBody
      )

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Microsoft Teams HMAC signature verification failed`)
        return new NextResponse('Unauthorized - Invalid HMAC signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Microsoft Teams HMAC signature verified successfully`)
    }
  }

  // Provider-specific verification (utils may return a response for some providers)
  const providerVerification = verifyProviderWebhook(foundWebhook, request, requestId)
  if (providerVerification) {
    return providerVerification
  }

  // Handle Google Forms shared-secret authentication (Apps Script forwarder)
  if (foundWebhook.provider === 'google_forms') {
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
    const expectedToken = providerConfig.token as string | undefined
    const secretHeaderName = providerConfig.secretHeaderName as string | undefined

    if (expectedToken) {
      let isTokenValid = false

      if (secretHeaderName) {
        const headerValue = request.headers.get(secretHeaderName.toLowerCase())
        if (headerValue === expectedToken) {
          isTokenValid = true
        }
      } else {
        const authHeader = request.headers.get('authorization')
        if (authHeader?.toLowerCase().startsWith('bearer ')) {
          const token = authHeader.substring(7)
          if (token === expectedToken) {
            isTokenValid = true
          }
        }
      }

      if (!isTokenValid) {
        logger.warn(`[${requestId}] Google Forms webhook authentication failed`)
        return new NextResponse('Unauthorized - Invalid secret', { status: 401 })
      }
    }
  }

  // Generic webhook authentication
  if (foundWebhook.provider === 'generic') {
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}

    if (providerConfig.requireAuth) {
      const configToken = providerConfig.token
      const secretHeaderName = providerConfig.secretHeaderName

      if (configToken) {
        let isTokenValid = false

        if (secretHeaderName) {
          // Check custom header (headers are case-insensitive)
          const headerValue = request.headers.get(secretHeaderName.toLowerCase())
          if (headerValue === configToken) {
            isTokenValid = true
          }
        } else {
          // Check Authorization: Bearer <token> (case-insensitive)
          const authHeader = request.headers.get('authorization')
          if (authHeader?.toLowerCase().startsWith('bearer ')) {
            const token = authHeader.substring(7)
            if (token === configToken) {
              isTokenValid = true
            }
          }
        }

        if (!isTokenValid) {
          return new NextResponse('Unauthorized - Invalid authentication token', { status: 401 })
        }
      } else {
        return new NextResponse('Unauthorized - Authentication required but not configured', {
          status: 401,
        })
      }
    }
  }

  return null
}

// Verifies the authenticity of the webhook request based on the provider.
// - **Microsoft Teams:**
//   - Checks for the `authorization` header starting with `HMAC `.
//   - Calls `validateMicrosoftTeamsSignature` to verify the HMAC signature.
// - Calls `verifyProviderWebhook` for provider-specific verification (using a utility function).
// - **Google Forms:**
//   - Checks for a shared secret token in either a custom header or the `Authorization` header.
// - **Generic:**
//   - If `requireAuth` is true in the provider config, checks for a token in either a custom header or the `Authorization` header.
// - Returns a 401 error if authentication fails.
// - Returns `null` if authentication is successful or not required.

export async function checkRateLimits(
  foundWorkflow: any,
  foundWebhook: any,
  requestId: string
): Promise<NextResponse | null> {
  try {
    const actorUserId = await getApiKeyOwnerUserId(foundWorkflow.pinnedApiKeyId)

    if (!actorUserId) {
      logger.warn(`[${requestId}] Webhook requires pinned API key to attribute usage`)
      return NextResponse.json({ message: 'Pinned API key required' }, { status: 200 })
    }

    const userSubscription = await getHighestPrioritySubscription(actorUserId)

    const rateLimiter = new RateLimiter()
    const rateLimitCheck = await rateLimiter.checkRateLimitWithSubscription(
      actorUserId,
      userSubscription,
      'webhook',
      true
    )

    if (!rateLimitCheck.allowed) {
      logger.warn(`[${requestId}] Rate limit exceeded for webhook user ${actorUserId}`, {
        provider: foundWebhook.provider,
        remaining: rateLimitCheck.remaining,
        resetAt: rateLimitCheck.resetAt,
      })

      if (foundWebhook.provider === 'microsoftteams') {
        return NextResponse.json({
          type: 'message',
          text: 'Rate limit exceeded. Please try again later.',
        })
      }

      return NextResponse.json({ message: 'Rate limit exceeded' }, { status: 200 })
    }

    logger.debug(`[${requestId}] Rate limit check passed for webhook`, {
      provider: foundWebhook.provider,
      remaining: rateLimitCheck.remaining,
      resetAt: rateLimitCheck.resetAt,
    })
  } catch (rateLimitError) {
    logger.error(`[${requestId}] Error checking webhook rate limits:`, rateLimitError)
  }

  return null
}

// Checks if the webhook request exceeds the rate limit for the user.
// - Retrieves the user ID associated with the API key.
// - Retrieves the user's highest priority subscription.
// - Uses a `RateLimiter` to check the rate limit.
// - If the rate limit is exceeded, returns a 200 response with a "Rate limit exceeded" message.
// - For Microsoft Teams, returns a specific message format.

export async function checkUsageLimits(
  foundWorkflow: any,
  foundWebhook: any,
  requestId: string,
  testMode: boolean
): Promise<NextResponse | null> {
  if (testMode) {
    logger.debug(`[${requestId}] Skipping usage limit check for test webhook`)
    return null
  }

  try {
    const actorUserId = await getApiKeyOwnerUserId(foundWorkflow.pinnedApiKeyId)

    if (!actorUserId) {
      logger.warn(`[${requestId}] Webhook requires pinned API key to attribute usage`)
      return NextResponse.json({ message: 'Pinned API key required' }, { status: 200 })
    }

    const usageCheck = await checkServerSideUsageLimits(actorUserId)
    if (usageCheck.isExceeded) {
      logger.warn(
        `[${requestId}] User ${actorUserId} has exceeded usage limits. Skipping webhook execution.`,
        {
          currentUsage: usageCheck.currentUsage,
          limit: usageCheck.limit,
          workflowId: foundWorkflow.id,
          provider: foundWebhook.provider,
        }
      )

      if (foundWebhook.provider === 'microsoftteams') {
        return NextResponse.json({
          type: 'message',
          text: 'Usage limit exceeded. Please upgrade your plan to continue.',
        })
      }

      return NextResponse.json({ message: 'Usage limit exceeded' }, { status: 200 })
    }

    logger.debug(`[${requestId}] Usage limit check passed for webhook`, {
      provider: foundWebhook.provider,
      currentUsage: usageCheck.currentUsage,
      limit: usageCheck.limit,
    })
  } catch (usageError) {
    logger.error(`[${requestId}] Error checking webhook usage limits:`, usageError)
  }

  return null
}

// Checks if the webhook request exceeds the usage limits for the user.
// - Skips the check if in test mode.
// - Retrieves the user ID associated with the API key.
// - Calls `checkServerSideUsageLimits` to check the usage limits.
// - If the usage limit is exceeded, returns a 200 response with a "Usage limit exceeded" message.
// - For Microsoft Teams, returns a specific message format.

export async function queueWebhookExecution(
  foundWebhook: any,
  foundWorkflow: any,
  body: any,
  request: NextRequest,
  options: WebhookProcessorOptions
): Promise<NextResponse> {
  try {
    const actorUserId = await getApiKeyOwnerUserId(foundWorkflow.pinnedApiKeyId)
    if (!actorUserId) {
      logger.warn(`[${options.requestId}] Webhook requires pinned API key to attribute usage`)
      return NextResponse.json({ message: 'Pinned API key required' }, { status: 200 })
    }

    const headers = Object.fromEntries(request.headers.entries())

    // For Microsoft Teams Graph notifications, extract unique identifiers for idempotency
    if (
      foundWebhook.provider === 'microsoftteams' &&
      body?.value &&
      Array.isArray(body.value) &&
      body.value.length > 0
    ) {
      const notification = body.value[0]
      const subscriptionId = notification.subscriptionId
      const messageId = notification.resourceData?.id

      if (subscriptionId && messageId) {
        headers['x-teams-notification-id'] = `${subscriptionId}:${messageId}`
      }
    }

    // Extract credentialId from webhook config for credential-based webhooks
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
    const credentialId = providerConfig.credentialId as string | undefined

    const payload = {
      webhookId: foundWebhook.id,
      workflowId: foundWorkflow.id,
      userId: actorUserId,
      provider: foundWebhook.provider,
      body,
      headers,
      path: options.path || foundWebhook.path,
      blockId: foundWebhook.blockId,
      testMode: options.testMode,
      executionTarget: options.executionTarget,
      ...(credentialId ? { credentialId } : {}),
    }

    const useTrigger = isTruthy(env.TRIGGER_DEV_ENABLED)

    if (useTrigger) {
      const handle = await tasks.trigger('webhook-execution', payload)
      logger.info(
        `[${options.requestId}] Queued ${options.testMode ? 'TEST ' : ''}webhook execution task ${
          handle.id
        } for ${foundWebhook.provider} webhook`
      )
    } else {
      void executeWebhookJob(payload).catch((error) => {
        logger.error(`[${options.requestId}] Direct webhook execution failed`, error)
      })
      logger.info(
        `[${options.requestId}] Queued direct ${
          options.testMode ? 'TEST ' : ''
        }webhook execution for ${foundWebhook.provider} webhook (Trigger.dev disabled)`
      )
    }

    if (foundWebhook.provider === 'microsoftteams') {
      const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
      const triggerId = providerConfig.triggerId as string | undefined

      // Chat subscription (Graph API) returns 202
      if (triggerId === 'microsoftteams_chat_subscription') {
        return new NextResponse(null, { status: 202 })
      }

      // Channel webhook (outgoing webhook) returns message response
      return NextResponse.json({
        type: 'message',
        text: 'Sim',
      })
    }

    return NextResponse.json({ message: 'Webhook processed' })
  } catch (error: any) {
    logger.error(`[${options.requestId}] Failed to queue webhook execution:`, error)

    if (foundWebhook.provider === 'microsoftteams') {
      return NextResponse.json({
        type: 'message',
        text: 'Webhook processing failed',
      })
    }

    return NextResponse.json({ message: 'Internal server error' }, { status: 200 })
  }
}

// Queues the webhook execution for background processing.
// - Retrieves the user ID associated with the API key.
// - Extracts all headers from the request.
// - Extracts unique identifiers from Microsoft Teams Graph notifications for idempotency.
// - Constructs a payload object containing all the necessary information for the webhook execution.
// - Checks if Trigger.dev is enabled using the `TRIGGER_DEV_ENABLED` environment variable.
//   - If Trigger.dev is enabled, queues the webhook execution as a task using `tasks.trigger`.
//   - If Trigger.dev is disabled, executes the webhook job directly using `executeWebhookJob`.
// - Returns a 200 response with a "Webhook processed" message.
// - For Microsoft Teams, returns a specific message format or status code.

**Simplifying Complex Logic**

While the code is already reasonably well-structured, here are some potential areas for simplification and improvements:

1.  **Provider-Specific Logic:**  The `verifyProviderAuth` function and `queueWebhookExecution` function have a lot of provider-specific logic (especially for Microsoft Teams). This could be further modularized by creating separate functions or classes for each provider. For instance:

    ```typescript
    // In verifyProviderAuth:
    if (foundWebhook.provider === 'microsoftteams') {
        return handleMicrosoftTeamsAuth(foundWebhook, request, rawBody, requestId);
    }

    // New function to handle Microsoft Teams Auth
    async function handleMicrosoftTeamsAuth(foundWebhook: any, request: NextRequest, rawBody: string, requestId: string): Promise<NextResponse | null> {
        //All the Microsoft Teams specific logic from above
    }
    ```

    This would make the main function more readable and easier to maintain.  The same could be done for the Microsoft Teams logic in the `queueWebhookExecution` function.

2.  **Error Handling:**  The error handling in `queueWebhookExecution` could be improved by using a more generic error response, rather than provider specific ones. Consider using an error boundary.
3. **Reduce Redundancy** The check for `pinnedApiKeyId` is repeated in both `checkRateLimits` and `checkUsageLimits`. Consider creating a shared utility function to handle this check and retrieve the `actorUserId`.

**Key Takeaways**

*   This code is well-structured and handles a complex task (webhook processing) in a modular way.
*   It prioritizes security by verifying the authenticity of webhook requests.
*   It includes rate limiting and usage limit checks to protect the system from abuse and manage resources.
*   It uses logging extensively for debugging and monitoring.
*   It's designed to integrate with a task queue (Trigger.dev) for asynchronous webhook execution.
*   There's room for further simplification by modularizing provider-specific logic.

This detailed explanation should give you a strong understanding of the code's purpose, functionality, and potential areas for improvement. Let me know if you have any other questions.
