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

// --- Template message types (WhatsApp Business API) ---

/** Parameter for a template component (text, image, document, video) */
export interface WhatsAppTemplateParameter {
  readonly type: "text" | "image" | "document" | "video";
  readonly text?: string;
  readonly image?: { readonly link: string };
  readonly document?: { readonly link: string; readonly filename: string };
  readonly video?: { readonly link: string };
}

/** Component within a template message (header, body, or button) */
export interface WhatsAppTemplateComponent {
  readonly type: "header" | "body" | "button";
  readonly parameters: readonly WhatsAppTemplateParameter[];
  readonly sub_type?: "quick_reply" | "url";
  readonly index?: string;
}

/** Response from WhatsApp Cloud API after sending a message */
export interface WhatsAppSendResult {
  readonly whatsappMessageId: string;
}

/**
 * Send a message via the WhatsApp Cloud API.
 *
 * @param phoneNumberId - The WhatsApp Business phone number ID
 * @param accessToken - The access token for authentication
 * @param to - The recipient phone number
 * @param body - The message payload (type, text, image, audio, document, template, etc.)
 * @returns The fetch Response
 */
export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const res = await fetch(whatsappMessagesUrl(phoneNumberId), {
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
  if (!res.ok) {
    const text = await res.text().catch(() => "(unreadable)");
    throw new Error(`WhatsApp API error ${res.status}: ${text}`);
  }
  return res;
}

export async function sendWhatsAppAudioMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  publicAudioUrl: string,
): Promise<WhatsAppSendResult> {
  const res = await sendWhatsAppMessage(phoneNumberId, accessToken, to, {
    type: "audio",
    audio: { link: publicAudioUrl },
  });

  const json = (await res.json()) as { messages?: Array<{ id: string }> };
  const messageId = json.messages?.[0]?.id;
  if (!messageId) {
    throw new Error("WhatsApp API returned no message ID for audio send");
  }
  return { whatsappMessageId: messageId };
}

/**
 * Send a pre-approved template message via WhatsApp Cloud API.
 * Used for business-initiated messages outside the 24-hour service window.
 *
 * @param phoneNumberId - The WhatsApp Business phone number ID
 * @param accessToken - The access token for authentication
 * @param to - The recipient phone number (E.164 format)
 * @param templateName - The approved template name (snake_case)
 * @param languageCode - BCP 47 language code (e.g., "en_US", "es_MX")
 * @param components - Optional resolved template components with variable values
 * @returns The WhatsApp message ID (wamid) for delivery tracking
 */
export async function sendWhatsAppTemplate(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateName: string,
  languageCode: string,
  components?: readonly WhatsAppTemplateComponent[],
): Promise<WhatsAppSendResult> {
  const template: Record<string, unknown> = {
    name: templateName,
    language: { code: languageCode },
  };
  if (components && components.length > 0) {
    template.components = components;
  }

  const res = await sendWhatsAppMessage(phoneNumberId, accessToken, to, {
    type: "template",
    template,
  });

  const json = (await res.json()) as { messages?: Array<{ id: string }> };
  const messageId = json.messages?.[0]?.id;
  if (!messageId) {
    throw new Error("WhatsApp API returned no message ID for template send");
  }
  return { whatsappMessageId: messageId };
}
