import type { TenantConfig } from "@kiln/core";

export function buildTenantSystemPrompt(tenant: TenantConfig): string {
  const parts: string[] = [];

  // Opening line
  parts.push(`Eres el asistente virtual de "${tenant.name}".`);

  // Description
  if (tenant.description) {
    parts.push(tenant.description);
  }

  // Tone instruction
  const lang = tenant.language ?? "es-MX";
  switch (tenant.tone) {
    case "formal":
      parts.push("Usa un tono formal y profesional en todas tus respuestas.");
      break;
    case "casual":
      parts.push("Usa un tono casual y relajado en tus respuestas.");
      break;
    case "friendly":
      parts.push("Usa un tono amigable y cercano en tus respuestas.");
      break;
    default:
      parts.push("Usa un tono amigable y cercano en tus respuestas.");
      break;
  }

  // Services
  if (tenant.services && tenant.services.length > 0) {
    parts.push("");
    parts.push("## Servicios");
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
    parts.push("## Horarios");
    for (const [day, hours] of Object.entries(tenant.hours)) {
      parts.push(`- ${day}: ${hours}`);
    }
  }

  // FAQ
  if (tenant.faqEntries && tenant.faqEntries.length > 0) {
    parts.push("");
    parts.push("## Preguntas frecuentes");
    for (const faq of tenant.faqEntries) {
      parts.push(`**P:** ${faq.q}`);
      parts.push(`**R:** ${faq.r}`);
    }
  }

  // Escalation
  if (tenant.escalationContact) {
    parts.push("");
    let escalation = `Si no puedes resolver algo, escala con: ${tenant.escalationContact.name}`;
    if (tenant.escalationContact.phone) escalation += ` (${tenant.escalationContact.phone})`;
    if (tenant.escalationContact.email) escalation += ` <${tenant.escalationContact.email}>`;
    parts.push(escalation);
  }

  // Closing instructions
  parts.push("");
  parts.push(`Responde siempre en ${lang}.`);
  parts.push("Se conciso. No inventes informacion que no conoces. Responde solo sobre este negocio.");

  return parts.join("\n");
}
