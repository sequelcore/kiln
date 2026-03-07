// Facebook Messenger Send API client
// Uses the Messenger Platform Graph API for page-scoped messaging

/** Messenger Graph API version */
export const MESSENGER_GRAPH_API_VERSION = "v21.0";

/** Build the Messenger Send API endpoint URL */
export function messengerMessagesUrl(): string {
  return `https://graph.facebook.com/${MESSENGER_GRAPH_API_VERSION}/me/messages`;
}

/** Response from Messenger Send API */
export interface MessengerSendResult {
  readonly recipientId: string;
  readonly messageId: string;
}

/**
 * Send a text message via Messenger Send API.
 *
 * @param accessToken - Page access token
 * @param recipientId - Page-scoped user ID (PSID)
 * @param text - Message text (max 2000 chars)
 */
export async function sendMessengerMessage(
  accessToken: string,
  recipientId: string,
  text: string,
): Promise<MessengerSendResult> {
  const res = await fetch(messengerMessagesUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_type: "RESPONSE",
      recipient: { id: recipientId },
      message: { text },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`Messenger API error ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { recipient_id?: string; message_id?: string };
  return {
    recipientId: json.recipient_id ?? recipientId,
    messageId: json.message_id ?? "",
  };
}

/**
 * Send a media message (image) via Messenger Send API.
 *
 * @param accessToken - Page access token
 * @param recipientId - Page-scoped user ID (PSID)
 * @param mediaUrl - Public URL of the media
 * @param mediaType - Type of media ("image")
 */
export async function sendMessengerMediaMessage(
  accessToken: string,
  recipientId: string,
  mediaUrl: string,
  mediaType: "image",
): Promise<MessengerSendResult> {
  const res = await fetch(messengerMessagesUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_type: "RESPONSE",
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
    throw new Error(`Messenger API error ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { recipient_id?: string; message_id?: string };
  return {
    recipientId: json.recipient_id ?? recipientId,
    messageId: json.message_id ?? "",
  };
}
