import type { TenantConfig } from "@kilnai/core";

export function buildTenantSystemPrompt(tenant: TenantConfig): string {
  const parts: string[] = [];

  // Opening line
  parts.push(`You are the virtual assistant for "${tenant.name}".`);

  // Description
  if (tenant.description) {
    parts.push(tenant.description);
  }

  // Tone instruction
  const lang = tenant.language ?? "es-MX";
  switch (tenant.tone) {
    case "formal":
      parts.push("Use a formal and professional tone in all your responses.");
      break;
    case "casual":
      parts.push("Use a casual and relaxed tone in your responses.");
      break;
    case "friendly":
      parts.push("Use a friendly and approachable tone in your responses.");
      break;
    default:
      parts.push("Use a friendly and approachable tone in your responses.");
      break;
  }

  // Services
  if (tenant.services && tenant.services.length > 0) {
    parts.push("");
    parts.push("## Services");
    for (const svc of tenant.services) {
      let line = `- ${svc.name}`;
      const details: string[] = [];
      if (svc.price) details.push(svc.price);
      if (svc.duration) details.push(svc.duration);
      if (details.length > 0) line += ` — ${details.join(", ")}`;
      if (svc.description) line += `: ${svc.description}`;
      parts.push(line);
    }
  }

  // Hours
  if (tenant.hours && Object.keys(tenant.hours).length > 0) {
    parts.push("");
    parts.push("## Business Hours");
    for (const [day, hours] of Object.entries(tenant.hours)) {
      parts.push(`- ${day}: ${hours}`);
    }
  }

  // FAQ
  if (tenant.faqEntries && tenant.faqEntries.length > 0) {
    parts.push("");
    parts.push("## Frequently Asked Questions");
    for (const faq of tenant.faqEntries) {
      parts.push(`**Q:** ${faq.q}`);
      parts.push(`**A:** ${faq.r}`);
    }
  }

  // Escalation
  if (tenant.escalationContact) {
    let escalation = `If you cannot resolve something, escalate to: ${tenant.escalationContact.name}`;
    if (tenant.escalationContact.phone) escalation += ` (${tenant.escalationContact.phone})`;
    if (tenant.escalationContact.email) escalation += ` <${tenant.escalationContact.email}>`;
    parts.push("");
    parts.push(escalation);
  }

  // Closing instructions: language directive and guardrails
  parts.push("");
  parts.push(`Always respond in ${lang}.`);
  parts.push("Be concise. Do not fabricate information you do not know. Only respond about this business.");

  return parts.join("\n");
}
