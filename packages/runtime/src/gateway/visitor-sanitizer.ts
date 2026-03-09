// Gateway: Visitor input sanitization -- prevents prompt injection via identify frame
// Strips zero-width chars, enforces length limits, validates email/phone format

/** Sanitized visitor info safe for system prompt injection */
export interface SanitizedVisitorInfo {
  readonly displayName?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly custom?: Readonly<Record<string, string>>;
}

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_PHONE_LENGTH = 20;
const MAX_CUSTOM_VALUE_LENGTH = 200;
const MAX_CUSTOM_FIELDS = 10;

// Zero-width and invisible characters that can be used for injection
const INVISIBLE_CHARS = /[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g;

// Basic email format (RFC 5322 simplified)
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Phone: digits, spaces, dashes, parens, plus prefix
const PHONE_PATTERN = /^\+?[\d\s\-().]{4,20}$/;

/** Sanitize a single string value: strip invisible chars, trim, truncate */
function sanitizeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(INVISIBLE_CHARS, "").trim();
  if (cleaned.length === 0) return undefined;
  return cleaned.slice(0, maxLength);
}

/** Sanitize raw visitor data from an identify frame */
export function sanitizeVisitorInfo(raw: Record<string, unknown>): SanitizedVisitorInfo {
  const result: {
    displayName?: string;
    email?: string;
    phone?: string;
    custom?: Record<string, string>;
  } = {};

  const name = sanitizeString(raw.name, MAX_NAME_LENGTH);
  if (name) result.displayName = name;

  const email = sanitizeString(raw.email, MAX_EMAIL_LENGTH);
  if (email && EMAIL_PATTERN.test(email)) result.email = email;

  const phone = sanitizeString(raw.phone, MAX_PHONE_LENGTH);
  if (phone && PHONE_PATTERN.test(phone)) result.phone = phone;

  // Custom fields: sanitize keys and values, limit count
  if (raw.custom && typeof raw.custom === "object" && !Array.isArray(raw.custom)) {
    const entries = Object.entries(raw.custom as Record<string, unknown>);
    const custom: Record<string, string> = {};
    let count = 0;
    for (const [key, val] of entries) {
      if (count >= MAX_CUSTOM_FIELDS) break;
      const cleanKey = sanitizeString(key, 50);
      const cleanVal = sanitizeString(val, MAX_CUSTOM_VALUE_LENGTH);
      if (cleanKey && cleanVal) {
        custom[cleanKey] = cleanVal;
        count++;
      }
    }
    if (Object.keys(custom).length > 0) result.custom = custom;
  }

  return result;
}

/** Format sanitized visitor info for system prompt injection */
export function formatVisitorContext(visitor: SanitizedVisitorInfo): string | undefined {
  const parts: string[] = [];
  if (visitor.displayName) parts.push(`Name: ${visitor.displayName}`);
  if (visitor.email) parts.push(`Email: ${visitor.email}`);
  if (visitor.phone) parts.push(`Phone: ${visitor.phone}`);
  if (visitor.custom) {
    for (const [key, value] of Object.entries(visitor.custom)) {
      parts.push(`${key}: ${value}`);
    }
  }
  if (parts.length === 0) return undefined;
  return `The visitor has identified themselves:\n${parts.join("\n")}`;
}
