// Email HTML template rendering with inline CSS
// Produces responsive, client-safe HTML for email delivery

export interface EmailBranding {
  readonly businessName?: string;
  readonly primaryColor?: string;
  readonly unsubscribeUrl?: string;
}

/** Render text content into a responsive HTML email template */
export function renderEmailHtml(text: string, branding?: EmailBranding): string {
  const primaryColor = branding?.primaryColor ?? "#333333";
  const fontStack = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

  const header = branding?.businessName
    ? `<tr><td style="padding:24px 32px 16px;background:${primaryColor};color:#ffffff;font-family:${fontStack};font-size:18px;font-weight:600;border-radius:8px 8px 0 0;">${escapeHtml(branding.businessName)}</td></tr>`
    : "";

  const topRadius = branding?.businessName ? "0" : "8px";

  const footer = branding?.unsubscribeUrl
    ? `<tr><td style="padding:16px 32px;text-align:center;font-family:${fontStack};font-size:12px;color:#999999;"><a href="${escapeHtml(branding.unsubscribeUrl)}" style="color:#999999;text-decoration:underline;">Unsubscribe</a></td></tr>`
    : "";

  const bodyHtml = textToHtml(text);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
${header}<tr><td style="padding:24px 32px;font-family:${fontStack};font-size:15px;line-height:1.6;color:#333333;border-radius:${topRadius} ${topRadius} 0 0;">${bodyHtml}</td></tr>
${footer}</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Render text as a plain text email body, stripping markdown */
export function renderEmailPlainText(text: string): string {
  return stripMarkdown(text);
}

/** Convert newlines to HTML, wrapping in paragraphs */
function textToHtml(text: string): string {
  const paragraphs = text.split(/\n{2,}/);
  return paragraphs
    .map((p) => {
      const inner = escapeHtml(p.trim()).replace(/\n/g, "<br>");
      return `<p style="margin:0 0 16px 0;">${inner}</p>`;
    })
    .filter((p) => p !== '<p style="margin:0 0 16px 0;"></p>')
    .join("\n");
}

/** Escape HTML special characters */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Strip basic markdown formatting for plain text */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "[code block]")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/#+\s/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*]\s/gm, "- ");
}
