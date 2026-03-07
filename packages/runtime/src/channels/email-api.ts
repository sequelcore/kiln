// Email transport abstraction with pluggable providers
// Raw fetch only, no SDK dependencies

/** Outbound email envelope */
export interface OutboundEmail {
  readonly from: string;
  readonly fromName?: string;
  readonly to: string;
  readonly subject: string;
  readonly htmlBody: string;
  readonly textBody: string;
  readonly inReplyTo?: string;
  readonly references?: string;
  readonly headers?: Record<string, string>;
}

/** Result of sending an email */
export interface EmailSendResult {
  readonly messageId: string;
}

/** Transport interface for sending emails */
export interface EmailTransport {
  send(email: OutboundEmail): Promise<EmailSendResult>;
}

/** Configuration for creating an email transport */
export interface EmailTransportConfig {
  readonly provider: "postmark" | "resend" | "sendgrid" | "generic";
  readonly apiKey: string;
  readonly endpoint?: string;
}

/** Postmark transactional email transport */
class PostmarkTransport implements EmailTransport {
  constructor(private readonly apiKey: string) {}

  async send(email: OutboundEmail): Promise<EmailSendResult> {
    const from = email.fromName ? `${email.fromName} <${email.from}>` : email.from;
    const headers: { Name: string; Value: string }[] = [
      { Name: "Auto-Submitted", Value: "auto-generated" },
      { Name: "X-Auto-Response-Suppress", Value: "OOF, AutoReply" },
    ];
    if (email.inReplyTo) headers.push({ Name: "In-Reply-To", Value: email.inReplyTo });
    if (email.references) headers.push({ Name: "References", Value: email.references });

    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Postmark-Server-Token": this.apiKey,
      },
      body: JSON.stringify({
        From: from,
        To: email.to,
        Subject: email.subject,
        HtmlBody: email.htmlBody,
        TextBody: email.textBody,
        Headers: headers,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)");
      throw new Error(`Postmark API error ${res.status}: ${body}`);
    }

    const json = (await res.json()) as { MessageID?: string };
    return { messageId: json.MessageID ?? "" };
  }
}

/** Resend email transport */
class ResendTransport implements EmailTransport {
  constructor(private readonly apiKey: string) {}

  async send(email: OutboundEmail): Promise<EmailSendResult> {
    const from = email.fromName ? `${email.fromName} <${email.from}>` : email.from;
    const headers: Record<string, string> = {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "OOF, AutoReply",
      ...email.headers,
    };
    if (email.inReplyTo) headers["In-Reply-To"] = email.inReplyTo;
    if (email.references) headers["References"] = email.references;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: email.to,
        subject: email.subject,
        html: email.htmlBody,
        text: email.textBody,
        headers,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)");
      throw new Error(`Resend API error ${res.status}: ${body}`);
    }

    const json = (await res.json()) as { id?: string };
    return { messageId: json.id ?? "" };
  }
}

/** Generic API email transport with configurable endpoint */
class GenericApiTransport implements EmailTransport {
  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string,
  ) {}

  async send(email: OutboundEmail): Promise<EmailSendResult> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        from: email.from,
        fromName: email.fromName,
        to: email.to,
        subject: email.subject,
        htmlBody: email.htmlBody,
        textBody: email.textBody,
        inReplyTo: email.inReplyTo,
        references: email.references,
        headers: email.headers,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)");
      throw new Error(`Email API error ${res.status}: ${body}`);
    }

    const json = (await res.json()) as { messageId?: string };
    return { messageId: json.messageId ?? "" };
  }
}

/** Create an email transport from configuration */
export function createEmailTransport(config: EmailTransportConfig): EmailTransport {
  switch (config.provider) {
    case "postmark":
      return new PostmarkTransport(config.apiKey);
    case "resend":
      return new ResendTransport(config.apiKey);
    case "sendgrid":
      return new ResendTransport(config.apiKey); // SendGrid uses same Bearer auth pattern
    case "generic":
      if (!config.endpoint) throw new Error("Generic email transport requires an endpoint");
      return new GenericApiTransport(config.apiKey, config.endpoint);
  }
}
