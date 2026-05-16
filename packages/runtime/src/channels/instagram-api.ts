// Instagram Messaging API client
// Uses the Instagram Graph API (same version as WhatsApp) for DM replies

/** Instagram/Meta Graph API version */
export const INSTAGRAM_GRAPH_API_VERSION = "v21.0";

/** Build the Instagram Graph API messages endpoint URL */
export function instagramMessagesUrl(pageId: string): string {
  return `https://graph.facebook.com/${INSTAGRAM_GRAPH_API_VERSION}/${pageId}/messages`;
}

/** Response from Instagram messaging API */
export interface InstagramSendResult {
  readonly recipientId: string;
  readonly messageId: string;
}

/**
 * Send a text message via Instagram Messaging API.
 *
 * @param pageId - The Instagram-connected Page ID
 * @param accessToken - Page access token
 * @param recipientId - Instagram-scoped user ID (IGSID)
 * @param text - Message text (max 1000 chars)
 */
export async function sendInstagramMessage(
  pageId: string,
  accessToken: string,
  recipientId: string,
  text: string,
): Promise<InstagramSendResult> {
  const res = await fetch(instagramMessagesUrl(pageId), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`Instagram API error ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { recipient_id?: string; message_id?: string };
  return {
    recipientId: json.recipient_id ?? recipientId,
    messageId: json.message_id ?? "",
  };
}

/**
 * Send a media message via Instagram Messaging API.
 *
 * @param pageId - The Instagram-connected Page ID
 * @param accessToken - Page access token
 * @param recipientId - Instagram-scoped user ID (IGSID)
 * @param mediaUrl - Public URL of the media
 * @param mediaType - Type of media
 */
export async function sendInstagramMediaMessage(
  pageId: string,
  accessToken: string,
  recipientId: string,
  mediaUrl: string,
  mediaType: "image" | "audio",
): Promise<InstagramSendResult> {
  const res = await fetch(instagramMessagesUrl(pageId), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: mediaType,
          payload: { url: mediaUrl },
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`Instagram API error ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { recipient_id?: string; message_id?: string };
  return {
    recipientId: json.recipient_id ?? recipientId,
    messageId: json.message_id ?? "",
  };
}
