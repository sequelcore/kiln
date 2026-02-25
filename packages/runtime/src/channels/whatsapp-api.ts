// Shared WhatsApp Cloud API client
// Single source of truth for graph.facebook.com URL construction, headers, and POST logic

/** WhatsApp Cloud API version */
export const WHATSAPP_GRAPH_API_VERSION = "v21.0";

/** Build the WhatsApp Cloud API messages endpoint URL */
export function whatsappMessagesUrl(phoneNumberId: string): string {
  return `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${phoneNumberId}/messages`;
}

/**
 * Build the Graph API URL for retrieving WhatsApp media by ID.
 * The caller must include a valid access token in the Authorization header to fetch the actual binary.
 */
export function whatsappMediaUrl(mediaId: string): string {
  return `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${mediaId}`;
}

/**
 * Send a message via the WhatsApp Cloud API.
 *
 * @param phoneNumberId - The WhatsApp Business phone number ID
 * @param accessToken - The access token for authentication
 * @param to - The recipient phone number
 * @param body - The message payload (type, text, image, audio, document, etc.)
 * @returns The fetch Response
 */
export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(whatsappMessagesUrl(phoneNumberId), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      ...body,
    }),
  });
}
