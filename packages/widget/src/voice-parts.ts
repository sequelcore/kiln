import { projectVoiceAudioOutputParts } from "@kilnai/gateway-contracts/voice-output-parts";

export function renderVoiceAudioParts(container: HTMLElement, parts: readonly unknown[]): void {
  const projected = projectVoiceAudioOutputParts(parts);
  if (projected.length === 0) {
    return;
  }

  const list = document.createElement("div");
  list.className = "kiln-voice-parts";

  for (const part of projected) {
    const item = document.createElement("div");
    item.className = "kiln-voice-part";

    if (part.src) {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "none";
      audio.src = part.src;
      audio.setAttribute("aria-label", part.label);
      item.appendChild(audio);
    }

    if (part.artifactUri) {
      const link = document.createElement("a");
      link.className = "kiln-voice-artifact";
      link.href = part.artifactUri;
      link.textContent = "Artifact";
      item.appendChild(link);
    }

    list.appendChild(item);
  }

  container.appendChild(list);
}
