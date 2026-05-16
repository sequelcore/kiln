import { WsClient } from "./ws-client.js";
import { getStyles } from "./styles.js";
import { renderMarkdown } from "./markdown.js";
import { renderVoiceAudioParts } from "./voice-parts.js";
import {
  createVoiceInputParts,
  selectVoiceInputCaptureMimeType,
  voiceInputDisplayText,
} from "@kilnai/gateway-contracts/voice-input-parts";
import type { WidgetConfig, ChatMessage, WsInboundFrame, ConnectionStatus, VisitorInfo, PreChatFormFrame } from "./types.js";

const CHAT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const CLOSE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const SEND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
const MIC_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`;
const STOP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1"/></svg>`;
const FILE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 6-8.4 8.4a2 2 0 0 0 2.8 2.8L19 8.6a4 4 0 0 0-5.7-5.7L4.7 11.5a6 6 0 0 0 8.5 8.5l7.8-7.8"/></svg>`;

const VISITOR_STORAGE_PREFIX = "kiln_visitor_";

function loadStoredVisitor(widgetId: string): VisitorInfo | null {
  try {
    const raw = localStorage.getItem(`${VISITOR_STORAGE_PREFIX}${widgetId}`);
    return raw ? (JSON.parse(raw) as VisitorInfo) : null;
  } catch {
    return null;
  }
}

function saveVisitor(widgetId: string, visitor: VisitorInfo): void {
  try {
    localStorage.setItem(`${VISITOR_STORAGE_PREFIX}${widgetId}`, JSON.stringify(visitor));
  } catch {
    // Storage full or unavailable -- non-critical
  }
}

export class KilnWidget {
  private readonly config: WidgetConfig;
  private readonly client: WsClient;
  private readonly container: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private messages: ChatMessage[] = [];
  private isOpen = false;
  private isLoading = false;
  private idCounter = 0;
  private greetingShown = false;
  private identified = false;

  // Cached DOM refs set during render()
  private panelEl!: HTMLDivElement;
  private messagesEl!: HTMLDivElement;
  private typingEl!: HTMLDivElement;
  private inputEl!: HTMLTextAreaElement;
  private sendEl!: HTMLButtonElement;
  private fileEl!: HTMLButtonElement;
  private fileInputEl!: HTMLInputElement;
  private voiceEl!: HTMLButtonElement;
  private statusDotEl!: HTMLSpanElement;
  private launcherEl!: HTMLButtonElement;
  private formEl: HTMLDivElement | null = null;
  private chatAreaEl!: HTMLDivElement;
  private recorder: MediaRecorder | null = null;
  private voiceStream: MediaStream | null = null;
  private voiceChunks: Blob[] = [];
  private voiceStartedAt = 0;
  private voiceState: "idle" | "recording" | "encoding" = "idle";

  constructor(config: WidgetConfig) {
    this.config = config;
    this.client = new WsClient(config.gatewayUrl, config.appName, config.widgetId);

    // Check if visitor already identified (returning visitor skips form)
    const stored = loadStoredVisitor(config.widgetId);
    if (stored) this.identified = true;

    this.container = document.createElement("div");
    this.container.id = "kiln-widget-root";
    this.shadow = this.container.attachShadow({ mode: "closed" });
    document.body.appendChild(this.container);

    const style = document.createElement("style");
    style.textContent = getStyles(this.resolveTheme());
    this.shadow.appendChild(style);

    this.render();

    this.client.onMessage((frame) => this.handleFrame(frame));
    this.client.onStatusChange((status) => this.updateStatus(status));
    this.client.connect();

    if (config.greeting) {
      this.addMessage({
        id: String(++this.idCounter),
        role: "assistant",
        content: config.greeting,
        timestamp: Date.now(),
      });
      this.greetingShown = true;
    }

    // Re-identify on reconnect if we have stored visitor data
    if (stored) {
      this.client.onStatusChange((status) => {
        if (status === "connected" && this.identified) {
          const visitor = loadStoredVisitor(config.widgetId);
          if (visitor) this.client.identify(visitor);
        }
        this.updateStatus(status);
      });
    }
  }

  private resolveTheme(): string {
    const theme = this.config.theme ?? "auto";
    if (theme === "auto") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return theme;
  }

  private render(): void {
    const position = this.config.position ?? "bottom-right";

    // Launcher button
    const launcher = document.createElement("button");
    launcher.id = "kiln-launcher";
    launcher.className = `position-${position}`;
    launcher.setAttribute("aria-label", "Open chat");
    launcher.innerHTML = CHAT_ICON_SVG;
    launcher.addEventListener("click", () => this.toggle());
    this.launcherEl = launcher;

    // Panel
    const panel = document.createElement("div");
    panel.id = "kiln-panel";
    panel.className = `position-${position} hidden`;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Chat");

    // Header
    const header = document.createElement("div");
    header.id = "kiln-header";

    if (this.config.logoUrl) {
      const logo = document.createElement("img");
      logo.id = "kiln-logo";
      logo.src = this.config.logoUrl;
      logo.alt = this.config.logoAlt ?? this.config.appName;
      logo.decoding = "async";
      header.appendChild(logo);
    }

    const statusDot = document.createElement("span");
    statusDot.id = "kiln-status-dot";
    statusDot.className = "disconnected";
    this.statusDotEl = statusDot;

    const title = document.createElement("span");
    title.id = "kiln-title";
    title.textContent = this.config.appName;

    const closeBtn = document.createElement("button");
    closeBtn.id = "kiln-close";
    closeBtn.setAttribute("aria-label", "Close chat");
    closeBtn.innerHTML = CLOSE_ICON_SVG;
    closeBtn.addEventListener("click", () => this.close());

    header.appendChild(statusDot);
    header.appendChild(title);
    header.appendChild(closeBtn);

    // Chat area wrapper (messages + input)
    const chatArea = document.createElement("div");
    chatArea.id = "kiln-chat-area";
    this.chatAreaEl = chatArea;

    // Messages area
    const messagesDiv = document.createElement("div");
    messagesDiv.id = "kiln-messages";
    this.messagesEl = messagesDiv;

    // Typing indicator
    const typing = document.createElement("div");
    typing.id = "kiln-typing";
    typing.className = "hidden";
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("span");
      dot.className = "kiln-typing-dot";
      typing.appendChild(dot);
    }
    this.typingEl = typing;
    messagesDiv.appendChild(typing);

    // Input area
    const inputArea = document.createElement("div");
    inputArea.id = "kiln-input-area";

    const textarea = document.createElement("textarea");
    textarea.id = "kiln-input";
    textarea.rows = 1;
    textarea.placeholder = this.config.placeholder ?? "Type a message...";
    textarea.setAttribute("aria-label", "Message input");
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    textarea.addEventListener("input", () => this.autoResizeTextarea());
    this.inputEl = textarea;

    const sendBtn = document.createElement("button");
    sendBtn.id = "kiln-send";
    sendBtn.setAttribute("aria-label", "Send message");
    sendBtn.innerHTML = SEND_ICON_SVG;
    sendBtn.addEventListener("click", () => this.sendMessage());
    this.sendEl = sendBtn;

    const fileInput = document.createElement("input");
    fileInput.id = "kiln-audio-file-input";
    fileInput.type = "file";
    fileInput.accept = "audio/*";
    fileInput.setAttribute("aria-label", "Audio file input");
    fileInput.addEventListener("change", () => this.handleAudioFileChange());
    this.fileInputEl = fileInput;

    const fileBtn = document.createElement("button");
    fileBtn.id = "kiln-file";
    fileBtn.type = "button";
    fileBtn.setAttribute("aria-label", "Attach audio file");
    fileBtn.innerHTML = FILE_ICON_SVG;
    fileBtn.addEventListener("click", () => this.fileInputEl.click());
    this.fileEl = fileBtn;

    const voiceBtn = document.createElement("button");
    voiceBtn.id = "kiln-voice";
    voiceBtn.type = "button";
    voiceBtn.setAttribute("aria-label", "Record voice");
    voiceBtn.innerHTML = MIC_ICON_SVG;
    voiceBtn.addEventListener("click", () => this.toggleVoiceCapture());
    this.voiceEl = voiceBtn;

    inputArea.appendChild(textarea);
    inputArea.appendChild(fileInput);
    inputArea.appendChild(fileBtn);
    inputArea.appendChild(voiceBtn);
    inputArea.appendChild(sendBtn);

    chatArea.appendChild(messagesDiv);
    chatArea.appendChild(inputArea);

    panel.appendChild(header);
    panel.appendChild(chatArea);

    this.panelEl = panel;

    this.shadow.appendChild(launcher);
    this.shadow.appendChild(panel);
    this.updateFileButton();
    this.updateVoiceButton();
  }

  private renderPreChatForm(formConfig: PreChatFormFrame): void {
    if (this.formEl) return; // Already rendered

    const form = document.createElement("div");
    form.id = "kiln-prechat-form";

    const formTitle = document.createElement("p");
    formTitle.className = "kiln-form-title";
    formTitle.textContent = "Before we start, tell us a bit about yourself";
    form.appendChild(formTitle);

    const inputs: Array<{ key: string; input: HTMLInputElement; required: boolean }> = [];

    for (const field of formConfig.fields) {
      const group = document.createElement("div");
      group.className = "kiln-form-group";

      const label = document.createElement("label");
      label.className = "kiln-form-label";
      label.textContent = field.label;
      if (field.required) {
        const req = document.createElement("span");
        req.className = "kiln-form-required";
        req.textContent = " *";
        label.appendChild(req);
      }

      const input = document.createElement("input");
      input.className = "kiln-form-input";
      input.type = field.type === "phone" ? "tel" : field.type;
      input.name = field.key;
      input.required = field.required;
      input.setAttribute("aria-label", field.label);

      inputs.push({ key: field.key, input, required: field.required });

      group.appendChild(label);
      group.appendChild(input);
      form.appendChild(group);
    }

    const submitBtn = document.createElement("button");
    submitBtn.className = "kiln-form-submit";
    submitBtn.textContent = formConfig.submitLabel ?? "Start Chat";
    submitBtn.addEventListener("click", () => this.submitPreChatForm(inputs));
    form.appendChild(submitBtn);

    // Allow Enter to submit
    form.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submitPreChatForm(inputs);
      }
    });

    this.formEl = form;

    // Hide chat area, show form
    this.chatAreaEl.classList.add("hidden");
    this.panelEl.insertBefore(form, this.chatAreaEl);
  }

  private submitPreChatForm(inputs: Array<{ key: string; input: HTMLInputElement; required: boolean }>): void {
    // Validate required fields
    for (const { input, required } of inputs) {
      if (required && !input.value.trim()) {
        input.classList.add("kiln-form-error");
        input.focus();
        return;
      }
      input.classList.remove("kiln-form-error");
    }

    // Build visitor info from form data
    const visitor: Record<string, string | Record<string, string>> = {};
    const custom: Record<string, string> = {};

    for (const { key, input } of inputs) {
      const value = input.value.trim();
      if (!value) continue;

      if (key === "name" || key === "email" || key === "phone") {
        visitor[key] = value;
      } else {
        custom[key] = value;
      }
    }
    if (Object.keys(custom).length > 0) visitor["custom"] = custom;

    const visitorInfo = visitor as unknown as VisitorInfo;

    // Persist and send
    saveVisitor(this.config.widgetId, visitorInfo);
    this.identified = true;
    this.client.identify(visitorInfo);

    // Transition to chat
    this.formEl?.remove();
    this.formEl = null;
    this.chatAreaEl.classList.remove("hidden");
    this.inputEl.focus();
  }

  private autoResizeTextarea(): void {
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 120)}px`;
  }

  open(): void {
    this.isOpen = true;
    this.panelEl.classList.remove("hidden");
    this.launcherEl.setAttribute("aria-expanded", "true");
    if (!this.formEl) this.inputEl.focus();
    this.scrollToBottom();
  }

  close(): void {
    this.isOpen = false;
    this.panelEl.classList.add("hidden");
    this.launcherEl.setAttribute("aria-expanded", "false");
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  sendMessage(content?: string): void {
    const text = content ?? this.inputEl.value.trim();
    if (!text || this.isLoading) return;

    this.removeSuggestions();

    this.addMessage({
      id: String(++this.idCounter),
      role: "user",
      content: text,
      timestamp: Date.now(),
    });

    this.inputEl.value = "";
    this.inputEl.style.height = "auto";
    this.setLoading(true);

    this.client.send(text);
  }

  private sendVoiceParts(parts: readonly unknown[], displayContent: string): void {
    if (this.isLoading) return;

    this.removeSuggestions();
    this.addMessage({
      id: String(++this.idCounter),
      role: "user",
      content: displayContent,
      parts,
      timestamp: Date.now(),
    });
    this.setLoading(true);
    this.client.sendParts(parts, displayContent);
  }

  private voiceCaptureAvailable(): boolean {
    return typeof navigator !== "undefined"
      && Boolean(navigator.mediaDevices?.getUserMedia)
      && typeof MediaRecorder !== "undefined";
  }

  private async startVoiceCapture(): Promise<void> {
    if (!this.voiceCaptureAvailable() || this.isLoading) return;
    try {
      const mimeType = selectVoiceInputCaptureMimeType((candidate) => MediaRecorder.isTypeSupported(candidate));
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.voiceStream = stream;
      this.voiceChunks = [];
      this.voiceStartedAt = performance.now();
      this.recorder = new MediaRecorder(stream, { mimeType });
      this.recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.voiceChunks.push(event.data);
        }
      };
      this.recorder.onstop = () => {
        void this.finishVoiceCapture(this.recorder?.mimeType || mimeType);
      };
      this.recorder.start();
      this.voiceState = "recording";
      this.updateFileButton();
      this.updateVoiceButton();
    } catch {
      this.stopVoiceStream();
      this.voiceState = "idle";
      this.updateFileButton();
      this.updateVoiceButton();
    }
  }

  private async finishVoiceCapture(mimeType: string): Promise<void> {
    const durationMs = Math.max(0, Math.round(performance.now() - this.voiceStartedAt));
    this.voiceState = "encoding";
    this.updateFileButton();
    this.updateVoiceButton();
    try {
      const blob = new Blob(this.voiceChunks, { type: mimeType });
      const parts = await createVoiceInputParts({ audio: blob, durationMs });
      this.sendVoiceParts(parts, voiceInputDisplayText(durationMs));
    } finally {
      this.voiceChunks = [];
      this.recorder = null;
      this.stopVoiceStream();
      this.voiceState = "idle";
      this.updateFileButton();
      this.updateVoiceButton();
    }
  }

  private stopVoiceStream(): void {
    for (const track of this.voiceStream?.getTracks() ?? []) {
      track.stop();
    }
    this.voiceStream = null;
  }

  private toggleVoiceCapture(): void {
    if (this.voiceState === "recording") {
      this.recorder?.stop();
      return;
    }
    void this.startVoiceCapture();
  }

  private async sendAudioFile(file: File): Promise<void> {
    if (this.isLoading || this.voiceState !== "idle") return;
    try {
      const parts = await createVoiceInputParts({ audio: file });
      this.sendVoiceParts(parts, voiceInputDisplayText());
    } catch {
      // Invalid or unreadable audio files are ignored; runtime policy only applies after canonical parts exist.
    }
  }

  private handleAudioFileChange(): void {
    const [file] = Array.from(this.fileInputEl.files ?? []);
    this.fileInputEl.value = "";
    if (!file) return;
    void this.sendAudioFile(file);
  }

  private addMessage(msg: ChatMessage): void {
    this.messages.push(msg);
    this.renderMessage(msg);
    this.scrollToBottom();
  }

  private renderMessage(msg: ChatMessage): void {
    const wrapper = document.createElement("div");
    wrapper.className = `kiln-msg ${msg.role}`;
    wrapper.dataset["msgId"] = msg.id;

    const bubble = document.createElement("div");
    bubble.className = "kiln-bubble";

    if (msg.role === "assistant") {
      bubble.appendChild(renderMarkdown(msg.content));
      renderVoiceAudioParts(bubble, msg.parts ?? []);
    } else {
      // User content: plain text only (XSS prevention)
      bubble.textContent = msg.content;
    }

    wrapper.appendChild(bubble);
    // Insert before the typing indicator
    this.messagesEl.insertBefore(wrapper, this.typingEl);
  }

  private renderErrorMessage(text: string): void {
    const wrapper = document.createElement("div");
    wrapper.className = "kiln-msg error";

    const bubble = document.createElement("div");
    bubble.className = "kiln-bubble";
    bubble.textContent = text;

    wrapper.appendChild(bubble);
    this.messagesEl.insertBefore(wrapper, this.typingEl);
    this.scrollToBottom();
  }

  private setLoading(loading: boolean): void {
    this.isLoading = loading;
    this.sendEl.disabled = loading;
    this.inputEl.disabled = loading;
    this.updateFileButton();
    this.updateVoiceButton();

    if (loading) {
      this.typingEl.classList.remove("hidden");
      this.scrollToBottom();
    } else {
      this.typingEl.classList.add("hidden");
    }
  }

  private updateVoiceButton(): void {
    if (!this.voiceEl) return;
    const recording = this.voiceState === "recording";
    this.voiceEl.disabled = (!recording && this.isLoading) || this.voiceState === "encoding" || !this.voiceCaptureAvailable();
    this.voiceEl.setAttribute("aria-label", recording ? "Stop voice recording" : "Record voice");
    this.voiceEl.classList.toggle("recording", recording);
    this.voiceEl.innerHTML = recording ? STOP_ICON_SVG : MIC_ICON_SVG;
  }

  private updateFileButton(): void {
    if (!this.fileEl || !this.fileInputEl) return;
    const disabled = this.isLoading || this.voiceState !== "idle";
    this.fileEl.disabled = disabled;
    this.fileInputEl.disabled = disabled;
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }

  private handleFrame(frame: WsInboundFrame): void {
    if (frame.type === "done") {
      this.setLoading(false);
      this.addMessage({
        id: String(++this.idCounter),
        role: "assistant",
        content: frame.content,
        ...(frame.parts ? { parts: frame.parts } : {}),
        timestamp: Date.now(),
      });
    } else if (frame.type === "error") {
      this.setLoading(false);
      if (frame.code === "BUDGET_EXHAUSTED") {
        this.renderInfoMessage(frame.message);
      } else {
        this.renderErrorMessage(frame.message);
      }
    } else if (frame.type === "welcome") {
      if (frame.greeting && !this.greetingShown) {
        this.addMessage({
          id: String(++this.idCounter),
          role: "assistant",
          content: frame.greeting,
          timestamp: Date.now(),
        });
        this.greetingShown = true;
      }
      if (frame.suggestions && frame.suggestions.length > 0) {
        this.renderSuggestions([...frame.suggestions]);
      }
      // Show pre-chat form if configured and visitor not yet identified
      if (frame.preChatForm?.enabled && !this.identified) {
        this.renderPreChatForm(frame.preChatForm);
      }
      // Re-identify returning visitors so gateway has displayName
      if (this.identified) {
        const stored = loadStoredVisitor(this.config.widgetId);
        if (stored) this.client.identify(stored);
      }
    } else if (frame.type === "suggestions") {
      this.renderSuggestions([...frame.items]);
    }
  }

  private renderSuggestions(items: string[]): void {
    this.removeSuggestions();

    const container = document.createElement("div");
    container.className = "kiln-suggestions";

    for (const item of items) {
      const chip = document.createElement("button");
      chip.className = "kiln-chip";
      chip.textContent = item;
      chip.addEventListener("click", () => {
        this.sendMessage(item);
      });
      container.appendChild(chip);
    }

    this.messagesEl.insertBefore(container, this.typingEl);
    this.scrollToBottom();
  }

  private removeSuggestions(): void {
    const existing = this.messagesEl.querySelector(".kiln-suggestions");
    if (existing) existing.remove();
  }

  private renderInfoMessage(text: string): void {
    const wrapper = document.createElement("div");
    wrapper.className = "kiln-msg info";

    const bubble = document.createElement("div");
    bubble.className = "kiln-bubble";
    bubble.textContent = text;

    wrapper.appendChild(bubble);
    this.messagesEl.insertBefore(wrapper, this.typingEl);
    this.scrollToBottom();
  }

  private updateStatus(status: ConnectionStatus): void {
    this.statusDotEl.className = status;
  }

  destroy(): void {
    this.client.disconnect();
    this.container.remove();
  }
}
