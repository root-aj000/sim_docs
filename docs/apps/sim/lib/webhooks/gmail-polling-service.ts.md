```typescript
import { db } from '@sim/db'
import { account, webhook } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { pollingIdempotency } from '@/lib/idempotency/service'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { getOAuthToken, refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import type { GmailAttachment } from '@/tools/gmail/types'
import { downloadAttachments, extractAttachmentInfo } from '@/tools/gmail/utils'

// Initialize a logger for this service, providing context in log messages.
const logger = createLogger('GmailPollingService')

// Define the configuration interface for Gmail webhooks.  This specifies all the tunable parameters
// needed for the service to operate against each webhook.
interface GmailWebhookConfig {
  labelIds: string[] // Gmail label IDs to filter emails.
  labelFilterBehavior: 'INCLUDE' | 'EXCLUDE' // Whether to include or exclude emails matching the labels.
  markAsRead: boolean // Whether to mark the emails as read after processing.
  maxEmailsPerPoll?: number // Maximum number of emails to fetch per poll.  Defaults to 25 if not set.
  lastCheckedTimestamp?: string // Timestamp of the last time the webhook was checked.  Used for incremental fetching.
  historyId?: string // Gmail history ID used for efficient incremental fetching via the Gmail History API.
  pollingInterval?: number // How often (in minutes) to poll Gmail for updates. Used to determine a buffer when querying new emails.
  includeAttachments?: boolean // Whether to download and include attachments in the webhook payload.
  includeRawEmail?: boolean // Whether to include the raw Gmail email object in the webhook payload.
}

// Represents a minimal Gmail email object, useful for intermediate processing steps.
interface GmailEmail {
  id: string // Unique ID of the email.
  threadId: string // ID of the email thread.
  historyId?: string // Gmail history ID associated with the email.
  labelIds?: string[] // List of label IDs applied to the email.
  payload?: any // The full email payload (headers, body, attachments, etc.)
  snippet?: string // A short snippet of the email body.
  internalDate?: string // Internal date representation of the email (timestamp).
}

// Represents a simplified version of the Gmail email object for sending in the webhook payload.
// This reduces the amount of data sent and makes it easier to work with.
export interface SimplifiedEmail {
  id: string // Unique ID of the email.
  threadId: string // ID of the email thread.
  subject: string // Email subject.
  from: string // Sender email address.
  to: string // Recipient email address.
  cc: string // Carbon copy recipient email address.
  date: string | null // Email sending date (ISO string).
  bodyText: string // Plain text email body.
  bodyHtml: string // HTML email body.
  labels: string[] // List of label IDs applied to the email.
  hasAttachments: boolean // Indicates whether the email has attachments.
  attachments: GmailAttachment[] // Array of attachment objects.
}

// Defines the structure of the payload sent to the webhook.  It includes the simplified email
// and optionally the raw email object and the timestamp of when the webhook was triggered.
export interface GmailWebhookPayload {
  email: SimplifiedEmail // Simplified email object.
  timestamp: string // Timestamp of when the webhook was triggered (ISO string).
  rawEmail?: GmailEmail // Optional: Raw Gmail email object (only included when includeRawEmail is true).
}

// The main function responsible for polling Gmail webhooks.
export async function pollGmailWebhooks() {
  logger.info('Starting Gmail webhook polling')

  try {
    // Retrieve all active Gmail webhooks from the database.
    const activeWebhooks = await db
      .select()
      .from(webhook)
      .where(and(eq(webhook.provider, 'gmail'), eq(webhook.isActive, true)))

    // If no active webhooks are found, log a message and return a summary.
    if (!activeWebhooks.length) {
      logger.info('No active Gmail webhooks found')
      return { total: 0, successful: 0, failed: 0, details: [] }
    }

    logger.info(`Found ${activeWebhooks.length} active Gmail webhooks`)

    // Define the maximum number of webhooks to process in parallel.
    // This helps prevent overwhelming the database or Gmail API.
    const CONCURRENCY = 10

    // Initialize arrays to track running promises and settled results.
    const running: Promise<any>[] = []
    const settledResults: PromiseSettledResult<any>[] = []

    // Define an asynchronous function to enqueue a single webhook for processing.
    const enqueue = async (webhookData: (typeof activeWebhooks)[number]) => {
      // Extract the webhook ID.
      const webhookId = webhookData.id
      // Generate a unique request ID for logging and tracing.
      const requestId = nanoid()

      try {
        // Extract metadata from the webhook configuration.
        const metadata = webhookData.providerConfig as any
        const credentialId: string | undefined = metadata?.credentialId
        const userId: string | undefined = metadata?.userId

        // Check if both credentialId and userId are missing.
        if (!credentialId && !userId) {
          logger.error(`[${requestId}] Missing credentialId and userId for webhook ${webhookId}`)
          return { success: false, webhookId, error: 'Missing credentialId and userId' }
        }

        // Resolve owner and token
        let accessToken: string | null = null
        if (credentialId) {
          // Fetch the account associated with the credential ID from the database.
          const rows = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)
          // If the credential is not found, log an error and return an error result.
          if (rows.length === 0) {
            logger.error(
              `[${requestId}] Credential ${credentialId} not found for webhook ${webhookId}`
            )
            return { success: false, webhookId, error: 'Credential not found' }
          }
          // Get the user ID of the account owner.
          const ownerUserId = rows[0].userId
          // Refresh the access token if needed, using the credential ID and owner user ID.
          accessToken = await refreshAccessTokenIfNeeded(credentialId, ownerUserId, requestId)
        } else if (userId) {
          // Backward-compat fallback to workflow owner token
          accessToken = await getOAuthToken(userId, 'google-email')
        }

        // If no access token is obtained, log an error and return an error result.
        if (!accessToken) {
          logger.error(
            `[${requestId}] Failed to get Gmail access token for webhook ${webhookId} (cred or fallback)`
          )
          return { success: false, webhookId, error: 'No access token' }
        }

        // Get webhook configuration
        const config = webhookData.providerConfig as unknown as GmailWebhookConfig

        // Record current time
        const now = new Date()

        // Fetch new emails
        const fetchResult = await fetchNewEmails(accessToken, config, requestId)

        // Extract the fetched emails and the latest history ID.
        const { emails, latestHistoryId } = fetchResult

        // If no new emails are found, update the last checked timestamp and history ID in the database.
        if (!emails || !emails.length) {
          await updateWebhookLastChecked(
            webhookId,
            now.toISOString(),
            latestHistoryId || config.historyId
          )
          logger.info(`[${requestId}] No new emails found for webhook ${webhookId}`)
          return { success: true, webhookId, status: 'no_emails' }
        }

        // Log the number of new emails found.
        logger.info(`[${requestId}] Found ${emails.length} new emails for webhook ${webhookId}`)

        logger.info(`[${requestId}] Processing ${emails.length} emails for webhook ${webhookId}`)

        // Process all emails (process each email as a separate workflow trigger)
        const emailsToProcess = emails

        // Process emails
        const processed = await processEmails(
          emailsToProcess,
          webhookData,
          config,
          accessToken,
          requestId
        )

        // Update webhook with latest history ID and timestamp
        await updateWebhookData(webhookId, now.toISOString(), latestHistoryId || config.historyId)

        // Return a success result with the number of emails found and processed.
        return {
          success: true,
          webhookId,
          emailsFound: emails.length,
          emailsProcessed: processed,
        }
      } catch (error) {
        // If an error occurs during processing, log the error and return an error result.
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        logger.error(`[${requestId}] Error processing Gmail webhook ${webhookId}:`, error)
        return { success: false, webhookId, error: errorMessage }
      }
    }

    // Iterate through the active webhooks and enqueue them for processing.
    for (const webhookData of activeWebhooks) {
      running.push(enqueue(webhookData))

      // If the number of running promises reaches the concurrency limit, wait for one to complete.
      if (running.length >= CONCURRENCY) {
        const result = await Promise.race(running)
        running.splice(running.indexOf(result), 1)
        settledResults.push(result)
      }
    }

    // Wait for all remaining running promises to complete.
    while (running.length) {
      const result = await Promise.race(running)
      running.splice(running.indexOf(result), 1)
      settledResults.push(result)
    }

    // Collect the results of all processed webhooks.
    const results = settledResults

    // Generate a summary of the polling results.
    const summary = {
      total: results.length,
      successful: results.filter((r) => r.status === 'fulfilled' && r.value.success).length,
      failed: results.filter(
        (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)
      ).length,
      details: results.map((r) =>
        r.status === 'fulfilled' ? r.value : { success: false, error: r.reason }
      ),
    }

    // Log the completion of the Gmail polling process and the summary of results.
    logger.info('Gmail polling completed', {
      total: summary.total,
      successful: summary.successful,
      failed: summary.failed,
    })

    // Return the summary of the polling results.
    return summary
  } catch (error) {
    // If an error occurs during the overall polling process, log the error and re-throw it.
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Error in Gmail polling service:', errorMessage)
    throw error
  }
}

// Fetches new emails from Gmail based on the configured webhook settings.
async function fetchNewEmails(accessToken: string, config: GmailWebhookConfig, requestId: string) {
  try {
    // Determine whether to use history API or search
    const useHistoryApi = !!config.historyId
    let emails = []
    let latestHistoryId = config.historyId

    if (useHistoryApi) {
      // Use history API to get changes since last check
      const historyUrl = `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${config.historyId}`

      const historyResponse = await fetch(historyUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!historyResponse.ok) {
        const errorData = await historyResponse.json()
        logger.error(`[${requestId}] Gmail history API error:`, {
          status: historyResponse.status,
          statusText: historyResponse.statusText,
          error: errorData,
        })

        // Fall back to search if history API fails
        logger.info(`[${requestId}] Falling back to search API after history API failure`)
        const searchResult = await searchEmails(accessToken, config, requestId)
        return {
          emails: searchResult.emails,
          latestHistoryId: searchResult.latestHistoryId,
        }
      }

      const historyData = await historyResponse.json()

      if (!historyData.history || !historyData.history.length) {
        return { emails: [], latestHistoryId }
      }

      // Update the latest history ID
      if (historyData.historyId) {
        latestHistoryId = historyData.historyId
      }

      // Extract message IDs from history
      const messageIds = new Set<string>()

      for (const history of historyData.history) {
        if (history.messagesAdded) {
          for (const messageAdded of history.messagesAdded) {
            messageIds.add(messageAdded.message.id)
          }
        }
      }

      if (messageIds.size === 0) {
        return { emails: [], latestHistoryId }
      }

      // Sort IDs by recency (reverse order)
      const sortedIds = [...messageIds].sort().reverse()

      // Process all emails but respect the configured limit
      const idsToFetch = sortedIds.slice(0, config.maxEmailsPerPoll || 25)
      logger.info(`[${requestId}] Processing ${idsToFetch.length} emails from history API`)

      // Fetch full email details for each message
      const emailPromises = idsToFetch.map(async (messageId) => {
        return getEmailDetails(accessToken, messageId)
      })

      const emailResults = await Promise.allSettled(emailPromises)
      emails = emailResults
        .filter(
          (result): result is PromiseFulfilledResult<GmailEmail> => result.status === 'fulfilled'
        )
        .map((result) => result.value)

      // Filter emails by labels if needed
      emails = filterEmailsByLabels(emails, config)
    } else {
      // Use search if no history ID is available
      const searchResult = await searchEmails(accessToken, config, requestId)
      return searchResult
    }

    return { emails, latestHistoryId }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Error fetching new emails:`, errorMessage)
    return { emails: [], latestHistoryId: config.historyId }
  }
}

// Searches for emails in Gmail based on the configured webhook settings.
async function searchEmails(accessToken: string, config: GmailWebhookConfig, requestId: string) {
  try {
    // Build query parameters for label filtering
    const labelQuery =
      config.labelIds && config.labelIds.length > 0
        ? config.labelIds.map((label) => `label:${label}`).join(' ')
        : 'in:inbox'

    // Improved time-based filtering with dynamic buffer
    let timeConstraint = ''

    if (config.lastCheckedTimestamp) {
      // Parse the last check time
      const lastCheckedTime = new Date(config.lastCheckedTimestamp)
      const now = new Date()

      // Calculate minutes since last check
      const minutesSinceLastCheck = (now.getTime() - lastCheckedTime.getTime()) / (60 * 1000)

      // If last check was recent, use precise time-based query
      if (minutesSinceLastCheck < 60) {
        // Less than an hour ago
        // Calculate buffer in seconds - the greater of:
        // 1. Twice the configured polling interval (or 2 minutes if not set)
        // 2. At least 3 minutes (180 seconds)
        const bufferSeconds = Math.max((config.pollingInterval || 2) * 60 * 2, 180)

        // Calculate the cutoff time with buffer
        const cutoffTime = new Date(lastCheckedTime.getTime() - bufferSeconds * 1000)

        // Format for Gmail's search syntax (seconds since epoch)
        const timestamp = Math.floor(cutoffTime.getTime() / 1000)

        timeConstraint = ` after:${timestamp}`
        logger.debug(`[${requestId}] Using timestamp-based query with ${bufferSeconds}s buffer`)
      }
      // If last check was a while ago, use Gmail's relative time queries
      else if (minutesSinceLastCheck < 24 * 60) {
        // Less than a day
        // Use newer_than:Xh syntax for better reliability with longer intervals
        const hours = Math.ceil(minutesSinceLastCheck / 60) + 1 // Round up and add 1 hour buffer
        timeConstraint = ` newer_than:${hours}h`
        logger.debug(`[${requestId}] Using hour-based query: newer_than:${hours}h`)
      } else {
        // For very old last checks, limit to a reasonable time period (7 days max)
        const days = Math.min(Math.ceil(minutesSinceLastCheck / (24 * 60)), 7) + 1
        timeConstraint = ` newer_than:${days}d`
        logger.debug(`[${requestId}] Using day-based query: newer_than:${days}d`)
      }
    } else {
      // If there's no last checked timestamp, default to recent emails (last 24h)
      timeConstraint = ' newer_than:1d'
      logger.debug(`[${requestId}] No last check time, using default: newer_than:1d`)
    }

    // Combine label and time constraints
    const query =
      config.labelFilterBehavior === 'INCLUDE'
        ? `${labelQuery}${timeConstraint}`
        : `-${labelQuery}${timeConstraint}`

    logger.info(`[${requestId}] Searching for emails with query: ${query}`)

    // Search for emails with lower default
    const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${config.maxEmailsPerPoll || 25}`

    const searchResponse = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!searchResponse.ok) {
      const errorData = await searchResponse.json()
      logger.error(`[${requestId}] Gmail search API error:`, {
        status: searchResponse.status,
        statusText: searchResponse.statusText,
        query: query,
        error: errorData,
      })
      return { emails: [], latestHistoryId: config.historyId }
    }

    const searchData = await searchResponse.json()

    if (!searchData.messages || !searchData.messages.length) {
      logger.info(`[${requestId}] No emails found matching query: ${query}`)
      return { emails: [], latestHistoryId: config.historyId }
    }

    // Process emails within the limit
    const idsToFetch = searchData.messages.slice(0, config.maxEmailsPerPoll || 25)
    let latestHistoryId = config.historyId

    logger.info(
      `[${requestId}] Processing ${idsToFetch.length} emails from search API (total matches: ${searchData.messages.length})`
    )

    // Fetch full email details for each message
    const emailPromises = idsToFetch.map(async (message: { id: string }) => {
      return getEmailDetails(accessToken, message.id)
    })

    const emailResults = await Promise.allSettled(emailPromises)
    const emails = emailResults
      .filter(
        (result): result is PromiseFulfilledResult<GmailEmail> => result.status === 'fulfilled'
      )
      .map((result) => result.value)

    // Get the latest history ID from the first email (most recent)
    if (emails.length > 0 && emails[0].historyId) {
      latestHistoryId = emails[0].historyId
      logger.debug(`[${requestId}] Updated historyId to ${latestHistoryId}`)
    }

    return { emails, latestHistoryId }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Error searching emails:`, errorMessage)
    return { emails: [], latestHistoryId: config.historyId }
  }
}

// Retrieves the full details of a single email from Gmail using the Gmail API.
async function getEmailDetails(accessToken: string, messageId: string): Promise<GmailEmail> {
  // Construct the URL for fetching the email message.  The 'format=full' parameter
  // ensures that the complete email details are retrieved.
  const messageUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`

  // Make the API request to Gmail.  The request includes the access token in the Authorization header.
  const messageResponse = await fetch(messageUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  // Check if the API request was successful.  If not, throw an error with details
  // about the failure, including the HTTP status code and status text.
  if (!messageResponse.ok) {
    const errorData = await messageResponse.json().catch(() => ({}))
    throw new Error(
      `Failed to fetch email details for message ${messageId}: ${messageResponse.status} ${messageResponse.statusText} - ${JSON.stringify(errorData)}`
    )
  }

  // If the request was successful, parse the JSON response and return the email details.
  return await messageResponse.json()
}

// Filters emails based on the configured label settings.
function filterEmailsByLabels(emails: GmailEmail[], config: GmailWebhookConfig): GmailEmail[] {
  // If no label IDs are specified in the configuration, return all emails.
  if (!config.labelIds.length) {
    return emails
  }

  // Filter the emails based on whether they have matching labels.
  return emails.filter((email) => {
    // Get the labels associated with the email.
    const emailLabels = email.labelIds || []
    // Check if any of the configured labels match the email's labels.
    const hasMatchingLabel = config.labelIds.some((configLabel) =>
      emailLabels.includes(configLabel)
    )

    // Return emails based on the configured label filter behavior (INCLUDE or EXCLUDE).
    return config.labelFilterBehavior === 'INCLUDE'
      ? hasMatchingLabel // Include emails with matching labels
      : !hasMatchingLabel // Exclude emails with matching labels
  })
}

// Processes a batch of emails, triggering the associated webhook for each email.
async function processEmails(
  emails: any[],
  webhookData: any,
  config: GmailWebhookConfig,
  accessToken: string,
  requestId: string
) {
  let processedCount = 0

  // Iterate over the emails
  for (const email of emails) {
    try {
      // Use idempotency service to prevent duplicate webhook triggers
      const result = await pollingIdempotency.executeWithIdempotency(
        'gmail',
        `${webhookData.id}:${email.id}`,
        async () => {
          // Extract useful information from email to create a simplified payload
          // First, extract headers into a map for easy access
          const headers: Record<string, string> = {}
          if (email.payload?.headers) {
            for (const header of email.payload.headers) {
              headers[header.name.toLowerCase()] = header.value
            }
          }

          // Extract and decode email body content
          let textContent = ''
          let htmlContent = ''

          // Function to extract content from parts recursively
          const extractContent = (part: any) => {
            if (!part) return

            // Extract current part content if it exists
            if (part.mimeType === 'text/plain' && part.body?.data) {
              textContent = Buffer.from(part.body.data, 'base64').toString('utf-8')
            } else if (part.mimeType === 'text/html' && part.body?.data) {
              htmlContent = Buffer.from(part.body.data, 'base64').toString('utf-8')
            }

            // Process nested parts
            if (part.parts && Array.isArray(part.parts)) {
              for (const subPart of part.parts) {
                extractContent(subPart)
              }
            }
          }

          // Extract content from the email payload
          if (email.payload) {
            extractContent(email.payload)
          }

          // Parse date into standard format
          let date: string | null = null
          if (headers.date) {
            try {
              date = new Date(headers.date).toISOString()
            } catch (_e) {
              // Keep date as null if parsing fails
            }
          } else if (email.internalDate) {
            // Use internalDate as fallback (convert from timestamp to ISO string)
            date = new Date(Number.parseInt(email.internalDate)).toISOString()
          }

          // Download attachments if requested (raw Buffers - will be uploaded during execution)
          let attachments: GmailAttachment[] = []
          const hasAttachments = email.payload
            ? extractAttachmentInfo(email.payload).length > 0
            : false

          if (config.includeAttachments && hasAttachments && email.payload) {
            try {
              const attachmentInfo = extractAttachmentInfo(email.payload)
              attachments = await downloadAttachments(email.id, attachmentInfo, accessToken)
            } catch (error) {
              logger.error(
                `[${requestId}] Error downloading attachments for email ${email.id}:`,
                error
              )
              // Continue without attachments rather than failing the entire request
            }
          }

          // Create simplified email object
          const simplifiedEmail: SimplifiedEmail = {
            id: email.id,
            threadId: email.threadId,
            subject: headers.subject || '[No Subject]',
            from: headers.from || '',
            to: headers.to || '',
            cc: headers.cc || '',
            date: date,
            bodyText: textContent,
            bodyHtml: htmlContent,
            labels: email.labelIds || [],
            hasAttachments,
            attachments,
          }

          // Prepare webhook payload with simplified email and optionally raw email
          const payload: GmailWebhookPayload = {
            email: simplifiedEmail,
            timestamp: new Date().toISOString(),
            ...(config.includeRawEmail ? { rawEmail: email } : {}),
          }

          logger.debug(
            `[${requestId}] Sending ${config.includeRawEmail ? 'simplified + raw' : 'simplified'} email payload for ${email.id}`
          )

          // Trigger the webhook
          const webhookUrl = `${getBaseUrl()}/api/webhooks/trigger/${webhookData.path}`

          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Webhook-Secret': webhookData.secret || '',
              'User-Agent': 'SimStudio/1.0',
            },
            body: JSON.stringify(payload),
          })

          if (!response.ok) {
            const errorText = await response.text()
            logger.error(
              `[${requestId}] Failed to trigger webhook for email ${email.id}:`,
              response.status,
              errorText
            )
            throw new Error(`Webhook request failed: ${response.status} - ${errorText}`)
          }

          // Mark email as read if configured
          if (config.markAsRead) {
            await markEmailAsRead(accessToken, email.id)
          }

          return {
            emailId: email.id,
            webhookStatus: response.status,
            processed: true,
          }
        }
      )

      logger.info(
        `[${requestId}] Successfully processed email ${email.id} for webhook ${webhookData.id}`
      )
      processedCount++
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error(`[${requestId}] Error processing email ${email.id}:`, errorMessage)
      // Continue processing other emails even if one fails
    }
  }

  return processedCount
}

// Marks an email as read in Gmail using the Gmail API.
async function markEmailAsRead(accessToken: string, messageId: string) {
  // Construct the URL for modifying the email message.
  const modifyUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`

  try {
    // Make the API request to Gmail to remove the "UNREAD" label from the email.
    const response = await fetch(modifyUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        removeLabelIds: ['UNREAD'],
      }),
    })

    // Check if the API request was successful.  If not, throw an error with details
    // about the failure, including the HTTP status code and status text.
    if (!response.ok) {
      throw new Error(
        `Failed to mark email ${messageId} as read: ${response.status} ${response.statusText}`
      )
    }
  } catch (error) {
    // If an error occurs during the API request, log the error and re-throw it.
    logger.error(`Error marking email ${messageId} as read:`, error)
    throw error
  }
}

// Updates the `lastCheckedTimestamp` and `historyId` in the webhook configuration in the database.
async function updateWebhookLastChecked(webhookId: string, timestamp: string, historyId?: string) {
  // Retrieve the existing provider configuration. This is needed to avoid overwriting other settings.
  const existingConfig =
    (await db.select().from(webhook).where(eq(webhook.id, webhookId)))[0]?.providerConfig || {}
  // Update the webhook record in the database with the new timestamp and history ID.
  await db
    .update(webhook)
    .set({
      providerConfig: {
        ...existingConfig,
        lastCheckedTimestamp: timestamp,
        ...(historyId ? { historyId } : {}), // Conditionally set the historyId
      },
      updatedAt: new Date(), // Update the updatedAt timestamp
    })
    .where(eq(webhook.id, webhookId))
}

// Updates the webhook data, which includes the timestamp and history ID.
async function updateWebhookData(webhookId: string, timestamp: string, historyId?: string) {
  // Retrieve the existing provider configuration to preserve existing settings
  const existingConfig =
    (await db.select().from(webhook).where(eq(webhook.id, webhookId)))[0]?.providerConfig || {}

  // Update the webhook record in the database
  await db
    .update(webhook)
    .set({
      providerConfig: {
        ...existingConfig,
        lastCheckedTimestamp: timestamp,
        ...(historyId ? { historyId } : {}), // Conditionally set the historyId
      },
      updatedAt: new Date(), // Update the updatedAt timestamp
    })
    .where(eq(webhook.id, webhookId))
}
```

**Purpose of this file:**

This TypeScript file implements a Gmail webhook polling service. Its primary function is to periodically check Gmail accounts for new emails based on specific configurations and trigger associated webhooks when new emails are found.  It handles authentication, email retrieval using both the Gmail History API and Search API, email filtering, data transformation into a simplified format, attachment handling, and webhook triggering with idempotency. The service also manages updating the webhook state, such as the last checked timestamp and history ID, to ensure efficient incremental polling.

**Simplification of Complex Logic:**

1.  **Abstraction of Gmail API calls:** The functions `getEmailDetails`, `searchEmails`, and `fetchNewEmails` encapsulate the complexity of interacting with the Gmail API, including authentication, request formatting, and error handling.
2.  **Data Transformation:** The `SimplifiedEmail` interface and the email processing logic within `processEmails` transform the complex Gmail email object into a simplified, more manageable format for webhook payloads.
3.  **Idempotency Handling:**  The `pollingIdempotency` service ensures that webhooks are not triggered multiple times for the same email, even in the event of failures or retries.
4.  **Configuration Management:** The `GmailWebhookConfig` interface centralizes the configuration parameters for each webhook, making it easier to manage and understand the behavior of the service.
5.  **Error Handling:** Comprehensive try-catch blocks with logging provide robust error handling throughout the service, preventing failures in one webhook from affecting others.
6.  **Concurrency Control:** The `CONCURRENCY` constant and the use of `Promise.race` limit the number of concurrent API calls, preventing resource exhaustion.
7.  **History API / Search API Fallback:** The service attempts to use the more efficient History API first, but gracefully falls back to the Search API if the History API is unavailable or returns an error.
8.  **Time-Based Query Optimization:** The `searchEmails` function uses a dynamic time-based query that adjusts the granularity of the search based on the time since the last check, optimizing query performance.

**Explanation of Each Line of Code:**

See the extensive inline comments within the code.  The comments describe the purpose of each major section of the code, the inputs and outputs of functions, and the logic behind key decisions.
