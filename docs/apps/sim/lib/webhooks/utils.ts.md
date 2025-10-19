```typescript
import { db } from '@sim/db'
import { account, webhook } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebhookUtils')

/**
 * Handle WhatsApp verification requests
 */
export async function handleWhatsAppVerification(
  requestId: string,
  path: string,
  mode: string | null,
  token: string | null,
  challenge: string | null
): Promise<NextResponse | null> {
  if (mode && token && challenge) {
    // This is a WhatsApp verification request
    logger.info(`[${requestId}] WhatsApp verification request received for path: ${path}`)

    if (mode !== 'subscribe') {
      logger.warn(`[${requestId}] Invalid WhatsApp verification mode: ${mode}`)
      return new NextResponse('Invalid mode', { status: 400 })
    }

    // Find all active WhatsApp webhooks
    const webhooks = await db
      .select()
      .from(webhook)
      .where(and(eq(webhook.provider, 'whatsapp'), eq(webhook.isActive, true)))

    // Check if any webhook has a matching verification token
    for (const wh of webhooks) {
      const providerConfig = (wh.providerConfig as Record<string, any>) || {}
      const verificationToken = providerConfig.verificationToken

      if (!verificationToken) {
        logger.debug(`[${requestId}] Webhook ${wh.id} has no verification token, skipping`)
        continue
      }

      if (token === verificationToken) {
        logger.info(`[${requestId}] WhatsApp verification successful for webhook ${wh.id}`)
        // Return ONLY the challenge as plain text (exactly as WhatsApp expects)
        return new NextResponse(challenge, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain',
          },
        })
      }
    }

    logger.warn(`[${requestId}] No matching WhatsApp verification token found`)
    return new NextResponse('Verification failed', { status: 403 })
  }

  return null
}

/**
 * Handle Slack verification challenges
 */
export function handleSlackChallenge(body: any): NextResponse | null {
  if (body.type === 'url_verification' && body.challenge) {
    return NextResponse.json({ challenge: body.challenge })
  }

  return null
}

/**
 * Validates a Slack webhook request signature using HMAC SHA-256
 * @param signingSecret - Slack signing secret for validation
 * @param signature - X-Slack-Signature header value
 * @param timestamp - X-Slack-Request-Timestamp header value
 * @param body - Raw request body string
 * @returns Whether the signature is valid
 */

export async function validateSlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string
): Promise<boolean> {
  try {
    // Basic validation first
    if (!signingSecret || !signature || !timestamp || !body) {
      return false
    }

    // Check if the timestamp is too old (> 5 minutes)
    const currentTime = Math.floor(Date.now() / 1000)
    if (Math.abs(currentTime - Number.parseInt(timestamp)) > 300) {
      return false
    }

    // Compute the signature
    const encoder = new TextEncoder()
    const baseString = `v0:${timestamp}:${body}`

    // Create the HMAC with the signing secret
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(signingSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(baseString))

    // Convert the signature to hex
    const signatureHex = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    // Prepare the expected signature format
    const computedSignature = `v0=${signatureHex}`

    // Constant-time comparison to prevent timing attacks
    if (computedSignature.length !== signature.length) {
      return false
    }

    let result = 0
    for (let i = 0; i < computedSignature.length; i++) {
      result |= computedSignature.charCodeAt(i) ^ signature.charCodeAt(i)
    }

    return result === 0
  } catch (error) {
    logger.error('Error validating Slack signature:', error)
    return false
  }
}

/**
 * Format Microsoft Teams Graph change notification
 */
async function formatTeamsGraphNotification(
  body: any,
  foundWebhook: any,
  foundWorkflow: any,
  request: NextRequest
): Promise<any> {
  const notification = body.value[0]
  const changeType = notification.changeType || 'created'
  const resource = notification.resource || ''
  const subscriptionId = notification.subscriptionId || ''

  // Extract chatId and messageId from resource path
  let chatId: string | null = null
  let messageId: string | null = null

  const fullMatch = resource.match(/chats\/([^/]+)\/messages\/([^/]+)/)
  if (fullMatch) {
    chatId = fullMatch[1]
    messageId = fullMatch[2]
  }

  if (!chatId || !messageId) {
    const quotedMatch = resource.match(/chats\('([^']+)'\)\/messages\('([^']+)'\)/)
    if (quotedMatch) {
      chatId = quotedMatch[1]
      messageId = quotedMatch[2]
    }
  }

  if (!chatId || !messageId) {
    const collectionMatch = resource.match(/chats\/([^/]+)\/messages$/)
    const rdId = body?.value?.[0]?.resourceData?.id
    if (collectionMatch && rdId) {
      chatId = collectionMatch[1]
      messageId = rdId
    }
  }

  if ((!chatId || !messageId) && body?.value?.[0]?.resourceData?.['@odata.id']) {
    const odataId = String(body.value[0].resourceData['@odata.id'])
    const odataMatch = odataId.match(/chats\('([^']+)'\)\/messages\('([^']+)'\)\/messages\('([^']+)'\)/)
    if (odataMatch) {
      chatId = odataMatch[1]
      messageId = odataMatch[2]
    }
  }

  if (!chatId || !messageId) {
    logger.warn('Could not resolve chatId/messageId from Teams notification', {
      resource,
      hasResourceDataId: Boolean(body?.value?.[0]?.resourceData?.id),
      valueLength: Array.isArray(body?.value) ? body.value.length : 0,
      keys: Object.keys(body || {}),
    })
    return {
      input: 'Teams notification received',
      webhook: {
        data: {
          provider: 'microsoftteams',
          path: foundWebhook?.path || '',
          providerConfig: foundWebhook?.providerConfig || {},
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }
  const resolvedChatId = chatId as string
  const resolvedMessageId = messageId as string
  const providerConfig = (foundWebhook?.providerConfig as Record<string, any>) || {}
  const credentialId = providerConfig.credentialId
  const includeAttachments = providerConfig.includeAttachments !== false

  let message: any = null
  const rawAttachments: Array<{ name: string; data: Buffer; contentType: string; size: number }> =
    []
  let accessToken: string | null = null

  // Teams chat subscriptions require credentials
  if (!credentialId) {
    logger.error('Missing credentialId for Teams chat subscription', {
      chatId: resolvedChatId,
      messageId: resolvedMessageId,
      webhookId: foundWebhook?.id,
      blockId: foundWebhook?.blockId,
      providerConfig,
    })
  } else {
    try {
      // Get userId from credential
      const rows = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)
      if (rows.length === 0) {
        logger.error('Teams credential not found', { credentialId, chatId: resolvedChatId })
        // Continue without message data
      } else {
        const effectiveUserId = rows[0].userId
        accessToken = await refreshAccessTokenIfNeeded(
          credentialId,
          effectiveUserId,
          'teams-graph-notification'
        )
      }

      if (accessToken) {
        const msgUrl = `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(resolvedChatId)}/messages/${encodeURIComponent(resolvedMessageId)}`
        const res = await fetch(msgUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
        if (res.ok) {
          message = await res.json()

          if (includeAttachments && message?.attachments?.length > 0) {
            const attachments = Array.isArray(message?.attachments) ? message.attachments : []
            for (const att of attachments) {
              try {
                const contentUrl =
                  typeof att?.contentUrl === 'string' ? (att.contentUrl as string) : undefined
                const contentTypeHint =
                  typeof att?.contentType === 'string' ? (att.contentType as string) : undefined
                let attachmentName = (att?.name as string) || 'teams-attachment'

                if (!contentUrl) continue

                let buffer: Buffer | null = null
                let mimeType = 'application/octet-stream'

                if (contentUrl.includes('sharepoint.com') || contentUrl.includes('onedrive')) {
                  try {
                    const directRes = await fetch(contentUrl, {
                      headers: { Authorization: `Bearer ${accessToken}` },
                      redirect: 'follow',
                    })

                    if (directRes.ok) {
                      const arrayBuffer = await directRes.arrayBuffer()
                      buffer = Buffer.from(arrayBuffer)
                      mimeType =
                        directRes.headers.get('content-type') ||
                        contentTypeHint ||
                        'application/octet-stream'
                    } else {
                      const encodedUrl = Buffer.from(contentUrl)
                        .toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '')

                      const graphUrl = `https://graph.microsoft.com/v1.0/shares/u!${encodedUrl}/driveItem/content`
                      const graphRes = await fetch(graphUrl, {
                        headers: { Authorization: `Bearer ${accessToken}` },
                        redirect: 'follow',
                      })

                      if (graphRes.ok) {
                        const arrayBuffer = await graphRes.arrayBuffer()
                        buffer = Buffer.from(arrayBuffer)
                        mimeType =
                          graphRes.headers.get('content-type') ||
                          contentTypeHint ||
                          'application/octet-stream'
                      } else {
                        continue
                      }
                    }
                  } catch {
                    continue
                  }
                } else if (
                  contentUrl.includes('1drv.ms') ||
                  contentUrl.includes('onedrive.live.com') ||
                  contentUrl.includes('onedrive.com') ||
                  contentUrl.includes('my.microsoftpersonalcontent.com')
                ) {
                  try {
                    let shareToken: string | null = null

                    if (contentUrl.includes('1drv.ms')) {
                      const urlParts = contentUrl.split('/').pop()
                      if (urlParts) shareToken = urlParts
                    } else if (contentUrl.includes('resid=')) {
                      const urlParams = new URL(contentUrl).searchParams
                      const resId = urlParams.get('resid')
                      if (resId) shareToken = resId
                    }

                    if (!shareToken) {
                      const base64Url = Buffer.from(contentUrl, 'utf-8')
                        .toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '')
                      shareToken = `u!${base64Url}`
                    } else if (!shareToken.startsWith('u!')) {
                      const base64Url = Buffer.from(shareToken, 'utf-8')
                        .toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '')
                      shareToken = `u!${base64Url}`
                    }

                    const metadataUrl = `https://graph.microsoft.com/v1.0/shares/${shareToken}/driveItem`
                    const metadataRes = await fetch(metadataUrl, {
                      headers: {
                        Authorization: `Bearer ${accessToken}`,
                        Accept: 'application/json',
                      },
                    })

                    if (!metadataRes.ok) {
                      const directUrl = `https://graph.microsoft.com/v1.0/shares/${shareToken}/driveItem/content`
                      const directRes = await fetch(directUrl, {
                        headers: { Authorization: `Bearer ${accessToken}` },
                        redirect: 'follow',
                      })

                      if (directRes.ok) {
                        const arrayBuffer = await directRes.arrayBuffer()
                        buffer = Buffer.from(arrayBuffer)
                        mimeType =
                          directRes.headers.get('content-type') ||
                          contentTypeHint ||
                          'application/octet-stream'
                      } else {
                        continue
                      }
                    } else {
                      const metadata = await metadataRes.json()
                      const downloadUrl = metadata['@microsoft.graph.downloadUrl']

                      if (downloadUrl) {
                        const downloadRes = await fetch(downloadUrl)

                        if (downloadRes.ok) {
                          const arrayBuffer = await downloadRes.arrayBuffer()
                          buffer = Buffer.from(arrayBuffer)
                          mimeType =
                            downloadRes.headers.get('content-type') ||
                            metadata.file?.mimeType ||
                            contentTypeHint ||
                            'application/octet-stream'

                          if (metadata.name && metadata.name !== attachmentName) {
                            attachmentName = metadata.name
                          }
                        } else {
                          continue
                        }
                      } else {
                        continue
                      }
                    }
                  } catch {
                    continue
                  }
                } else {
                  try {
                    const ares = await fetch(contentUrl, {
                      headers: { Authorization: `Bearer ${accessToken}` },
                    })
                    if (ares.ok) {
                      const arrayBuffer = await ares.arrayBuffer()
                      buffer = Buffer.from(arrayBuffer)
                      mimeType =
                        ares.headers.get('content-type') ||
                        contentTypeHint ||
                        'application/octet-stream'
                    }
                  } catch {
                    continue
                  }
                }

                if (!buffer) continue

                const size = buffer.length

                // Store raw attachment (will be uploaded to execution storage later)
                rawAttachments.push({
                  name: attachmentName,
                  data: buffer,
                  contentType: mimeType,
                  size,
                })
              } catch {}
            }
          }
        }
      }
    } catch (error) {
      logger.error('Failed to fetch Teams message', {
        error,
        chatId: resolvedChatId,
        messageId: resolvedMessageId,
      })
    }
  }

  // If no message was fetched, return minimal data
  if (!message) {
    logger.warn('No message data available for Teams notification', {
      chatId: resolvedChatId,
      messageId: resolvedMessageId,
      hasCredential: !!credentialId,
    })
    return {
      input: '',
      message_id: messageId,
      chat_id: chatId,
      from_name: 'Unknown',
      text: '',
      created_at: notification.resourceData?.createdDateTime || '',
      change_type: changeType,
      subscription_id: subscriptionId,
      attachments: [],
      microsoftteams: {
        message: { id: messageId, text: '', timestamp: '', chatId, raw: null },
        from: { id: '', name: 'Unknown', aadObjectId: '' },
        notification: { changeType, subscriptionId, resource },
      },
      webhook: {
        data: {
          provider: 'microsoftteams',
          path: foundWebhook?.path || '',
          providerConfig: foundWebhook?.providerConfig || {},
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  // Extract data from message - we know it exists now
  // body.content is the HTML/text content, summary is a plain text preview (max 280 chars)
  const messageText = message.body?.content || ''
  const from = message.from?.user || {}
  const createdAt = message.createdDateTime || ''

  return {
    input: messageText,
    message_id: messageId,
    chat_id: chatId,
    from_name: from.displayName || 'Unknown',
    text: messageText,
    created_at: createdAt,
    change_type: changeType,
    subscription_id: subscriptionId,
    attachments: rawAttachments,
    microsoftteams: {
      message: {
        id: messageId,
        text: messageText,
        timestamp: createdAt,
        chatId,
        raw: message,
      },
      from: {
        id: from.id,
        name: from.displayName,
        aadObjectId: from.aadObjectId,
      },
      notification: {
        changeType,
        subscriptionId,
        resource,
      },
    },
    webhook: {
      data: {
        provider: 'microsoftteams',
        path: foundWebhook?.path || '',
        providerConfig: foundWebhook?.providerConfig || {},
        payload: body,
        headers: Object.fromEntries(request.headers.entries()),
        method: request.method,
      },
    },
    workflowId: foundWorkflow.id,
  }
}

/**
 * Format webhook input based on provider
 */
export async function formatWebhookInput(
  foundWebhook: any,
  foundWorkflow: any,
  body: any,
  request: NextRequest
): Promise<any> {
  if (foundWebhook.provider === 'whatsapp') {
    const data = body?.entry?.[0]?.changes?.[0]?.value
    const messages = data?.messages || []

    if (messages.length > 0) {
      const message = messages[0]
      const phoneNumberId = data.metadata?.phone_number_id
      const from = message.from
      const messageId = message.id
      const timestamp = message.timestamp
      const text = message.text?.body

      return {
        whatsapp: {
          data: {
            messageId,
            from,
            phoneNumberId,
            text,
            timestamp,
            raw: message,
          },
        },
        webhook: {
          data: {
            provider: 'whatsapp',
            path: foundWebhook.path,
            providerConfig: foundWebhook.providerConfig,
            payload: body,
            headers: Object.fromEntries(request.headers.entries()),
            method: request.method,
          },
        },
        workflowId: foundWorkflow.id,
      }
    }
    return null
  }

  if (foundWebhook.provider === 'telegram') {
    const message =
      body?.message || body?.edited_message || body?.channel_post || body?.edited_channel_post

    if (message) {
      let input = ''

      if (message.text) {
        input = message.text
      } else if (message.caption) {
        input = message.caption
      } else if (message.photo) {
        input = 'Photo message'
      } else if (message.document) {
        input = `Document: ${message.document.file_name || 'file'}`
      } else if (message.audio) {
        input = `Audio: ${message.audio.title || 'audio file'}`
      } else if (message.video) {
        input = 'Video message'
      } else if (message.voice) {
        input = 'Voice message'
      } else if (message.sticker) {
        input = `Sticker: ${message.sticker.emoji || '🎭'}`
      } else if (message.location) {
        input = 'Location shared'
      } else if (message.contact) {
        input = `Contact: ${message.contact.first_name || 'contact'}`
      } else if (message.poll) {
        input = `Poll: ${message.poll.question}`
      } else {
        input = 'Message received'
      }

      const messageObj = {
        id: message.message_id,
        text: message.text,
        caption: message.caption,
        date: message.date,
        messageType: message.photo
          ? 'photo'
          : message.document
            ? 'document'
            : message.audio
              ? 'audio'
              : message.video
                ? 'video'
                : message.voice
                  ? 'voice'
                  : message.sticker
                    ? 'sticker'
                    : message.location
                      ? 'location'
                      : message.contact
                        ? 'contact'
                        : message.poll
                          ? 'poll'
                          : 'text',
        raw: message,
      }

      const senderObj = message.from
        ? {
            id: message.from.id,
            firstName: message.from.first_name,
            lastName: message.from.last_name,
            username: message.from.username,
            languageCode: message.from.language_code,
            isBot: message.from.is_bot,
          }
        : null

      const chatObj = message.chat
        ? {
            id: message.chat.id,
            type: message.chat.type,
            title: message.chat.title,
            username: message.chat.username,
            firstName: message.chat.first_name,
            lastName: message.chat.last_name,
          }
        : null

      return {
        input,

        // Top-level properties for backward compatibility with <blockName.message> syntax
        message: messageObj,
        sender: senderObj,
        chat: chatObj,
        updateId: body.update_id,
        updateType: body.message
          ? 'message'
          : body.edited_message
            ? 'edited_message'
            : body.channel_post
              ? 'channel_post'
              : body.edited_channel_post
                ? 'edited_channel_post'
                : 'unknown',

        // Keep the nested structure for the new telegram.message.text syntax
        telegram: {
          message: messageObj,
          sender: senderObj,
          chat: chatObj,
          updateId: body.update_id,
          updateType: body.message
            ? 'message'
            : body.edited_message
              ? 'edited_message'
              : body.channel_post
                ? 'channel_post'
                : body.edited_channel_post
                  ? 'edited_channel_post'
                  : 'unknown',
        },
        webhook: {
          data: {
            provider: 'telegram',
            path: foundWebhook.path,
            providerConfig: foundWebhook.providerConfig,
            payload: body,
            headers: Object.fromEntries(request.headers.entries()),
            method: request.method,
          },
        },
        workflowId: foundWorkflow.id,
      }
    }

    // Fallback for unknown Telegram update types
    logger.warn('Unknown Telegram update type', {
      updateId: body.update_id,
      bodyKeys: Object.keys(body || {}),
    })

    return {
      input: 'Telegram update received',
      telegram: {
        updateId: body.update_id,
        updateType: 'unknown',
        raw: body,
      },
      webhook: {
        data: {
          provider: 'telegram',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'gmail') {
    if (body && typeof body === 'object' && 'email' in body) {
      return body // { email: {...}, timestamp: ... }
    }
    return body
  }

  if (foundWebhook.provider === 'outlook') {
    if (body && typeof body === 'object' && 'email' in body) {
      return body // { email: {...}, timestamp: ... }
    }
    return body
  }

  if (foundWebhook.provider === 'microsoftteams') {
    // Check if this is a Microsoft Graph change notification
    if (body?.value && Array.isArray(body.value) && body.value.length > 0) {
      return await formatTeamsGraphNotification(body, foundWebhook, foundWorkflow, request)
    }

    // Microsoft Teams outgoing webhook - Teams sending data to us
    //
    const messageText = body?.text || ''
    const messageId = body?.id || ''
    const timestamp = body?.timestamp || body?.localTimestamp || ''
    const from = body?.from || {}
    const conversation = body?.conversation || {}

    return {
      input: messageText, // Primary workflow input - the message text

      // Top-level properties for backward compatibility with <blockName.text> syntax
      type: body?.type || 'message',
      id: messageId,
      timestamp,
      localTimestamp: body?.localTimestamp || '',
      serviceUrl: body?.serviceUrl || '',
      channelId: body?.channelId || '',
      from_id: from.id || '',
      from_name: from.name || '',
      conversation_id: conversation.id || '',
      text: messageText,

      microsoftteams: {
        message: {
          id: messageId,
          text: messageText,
          timestamp,
          type: body?.type || 'message',
          serviceUrl: body?.serviceUrl,
          channelId: body?.channelId,
          raw: body,
        },
        from: {
          id: from.id,
          name: from.name,
          aadObjectId: from.aadObjectId,
        },
        conversation: {
          id: conversation.id,
          name: conversation.name,
          conversationType: conversation.conversationType,
          tenantId: conversation.tenantId,
        },
        activity: {
          type: body?.type,
          id: body?.id,
          timestamp: body?.timestamp,
          localTimestamp: body?.localTimestamp,
          serviceUrl: body?.serviceUrl,
          channelId: body?.channelId,
        },
      },
      webhook: {
        data: {
          provider: 'microsoftteams',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'slack') {
    // Slack input formatting logic - check for valid event
    const event = body?.event

    if (event && body?.type === 'event_callback') {
      // Extract event text with fallbacks for different event types
      let input = ''

      if (event.text) {
        input = event.text
      } else if (event.type === 'app_mention') {
        input = 'App mention received'
      } else {
        input = 'Slack event received'
      }

      // Create the event object for easier access
      const eventObj = {
        event_type: event.type || '',
        channel: event.channel || '',
        channel_name: '', // Could be resolved via additional API calls if needed
        user: event.user || '',
        user_name: '', // Could be resolved via additional API calls if needed
        text: event.text || '',
        timestamp: event.ts || event.event_ts || '',
        team_id: body.team_id || event.team || '',
        event_id: body.event_id || '',
      }

      return {
        input, // Primary workflow input - the event content

        // // // Top-level properties for backward compatibility with <blockName.event> syntax
        event: eventObj,

        // Keep the nested structure for the new slack.event.text syntax
        slack: {
          event: eventObj,
        },
        webhook: {
          data: {
            provider: 'slack',
            path: foundWebhook.path,
            providerConfig: foundWebhook.providerConfig,
            payload: body,
            headers: Object.fromEntries(request.headers.entries()),
            method: request.method,
          },
        },
        workflowId: foundWorkflow.id,
      }
    }

    // Fallback for unknown Slack event types
    logger.warn('Unknown Slack event type', {
      type: body?.type,
      hasEvent: !!body?.event,
      bodyKeys: Object.keys(body || {}),
    })

    return {
      input: 'Slack webhook received',
      slack: {
        event: {
          event_type: body?.event?.type || body?.type || 'unknown',
          channel: body?.event?.channel || '',
          user: body?.event?.user || '',
          text: body?.event?.text || '',
          timestamp: body?.event?.ts || '',
          team_id: body?.team_id || '',
          event_id: body?.event_id || '',
        },
      },
      webhook: {
        data: {
          provider: 'slack',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'generic') {
    return body
  }

  if (foundWebhook.provider === 'google_forms') {
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}

    // Normalize answers: if value is an array with single element, collapse to scalar; keep multi-select arrays
    const normalizeAnswers = (src: unknown): Record<string, unknown> => {
      if (!src || typeof src !== 'object') return {}
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        if (Array.isArray(v)) {
          out[k] = v.length === 1 ? v[0] : v
        } else {
          out[k] = v as unknown
        }
      }
      return out
    }

    const responseId = body?.responseId || body?.id || ''
    const createTime = body?.createTime || body?.timestamp || new Date().toISOString()
    const lastSubmittedTime = body?.lastSubmittedTime || createTime
    const formId = body?.formId || providerConfig.formId || ''
    const includeRaw = providerConfig.includeRawPayload !== false

    const normalizedAnswers = normalizeAnswers(body?.answers)

    const summaryCount = Object.keys(normalizedAnswers).length
    const input = `Google Form response${responseId ? ` ${responseId}` : ''} (${summaryCount} answers)`

    return {
      input,
      responseId,
      createTime,
      lastSubmittedTime,
      formId,
      answers: normalizedAnswers,
      ...(includeRaw ? { raw: body?.raw ?? body } : {}),
      google_forms: {
        responseId,
        createTime,
        lastSubmittedTime,
        formId,
        answers: normalizedAnswers,
        ...(includeRaw ? { raw: body?.raw ?? body } : {}),
      },
      webhook: {
        data: {
          provider: 'google_forms',
          path: foundWebhook.path,
          providerConfig: foundWebhook.providerConfig,
          payload: includeRaw ? body : undefined,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
      workflowId: foundWorkflow.id,
    }
  }

  if (foundWebhook.provider === 'github') {
    // GitHub webhook input formatting logic
    const eventType = request.headers.get('x-github-event') || 'unknown'
    const delivery = request.headers.get('x-github-delivery') || ''

    // Extract common GitHub properties
    const repository = body?.repository || {}
    const sender = body?.sender || {}
    const action = body?.action || ''

    // Build GitHub-specific variables based on the trigger config outputs
    const githubData = {
      // Event metadata
      event_type: eventType,
      action: action,
      delivery_id: delivery,

      // Repository information (avoid 'repository' to prevent conflict with the object)
      repository_full_name: repository.full_name || '',
      repository_name: repository.name || '',
      repository_owner: repository.owner?.login || '',
      repository_id: repository.id || '',
      repository_url: repository.html_url || '',

      // Sender information (avoid 'sender' to prevent conflict with the object)
      sender_login: sender.login || '',
      sender_id: sender.id || '',
      sender_type: sender.type || '',
      sender_url: sender.html_url || '',

      // Event-specific data
      ...(body?.ref && {
        ref: body.ref,
        branch: body.ref?.replace('refs/heads/', '') || '',
      }),
      ...(body?.before && { before: body.before }),
      ...(body?.after && { after: body.after }),
      ...(body?.commits && {
        commits: JSON.stringify(