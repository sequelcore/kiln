import { WsClient } from "./ws-client.js";
import { getStyles } from "./styles.js";
import { renderMarkdown } from "./markdown.js";
import type { WidgetConfig, ChatMessage, WsInboundFrame, ConnectionStatus, VisitorInfo, PreChatFormFrame } from "./types.js";

const CHAT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const CLOSE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const SEND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

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
  private statusDotEl!: HTMLSpanElement;
  private launcherEl!: HTMLButtonElement;
  private formEl: HTMLDivElement | null = null;
  private chatAreaEl!: HTMLDivElement;

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

    inputArea.appendChild(textarea);
    inputArea.appendChild(sendBtn);

    chatArea.appendChild(messagesDiv);
    chatArea.appendChild(inputArea);

    panel.appendChild(header);
    panel.appendChild(chatArea);

    this.panelEl = panel;

    this.shadow.appendChild(launcher);
    this.shadow.appendChild(panel);
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

    if (loading) {
      this.typingEl.classList.remove("hidden");
      this.scrollToBottom();
    } else {
      this.typingEl.classList.add("hidden");
    }
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
