import { WsClient } from "./ws-client.js";
import { getStyles } from "./styles.js";
import type { WidgetConfig, ChatMessage, WsInboundFrame, ConnectionStatus } from "./types.js";

const CHAT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const CLOSE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const SEND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

/**
 * Converts simple markdown patterns to safe DOM nodes for assistant messages.
 * Bold, inline code, and line breaks only. No innerHTML for user-content.
 */
function renderMarkdown(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();

  // Split on bold (**text**), inline code (`text`), and newlines
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\n)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Plain text before this match
    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    const token = match[0];
    if (token === "\n") {
      fragment.appendChild(document.createElement("br"));
    } else if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      fragment.appendChild(strong);
    } else if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      fragment.appendChild(code);
    }

    lastIndex = match.index + token.length;
  }

  // Remaining plain text
  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  return fragment;
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

  // Cached DOM refs set during render()
  private panelEl!: HTMLDivElement;
  private messagesEl!: HTMLDivElement;
  private typingEl!: HTMLDivElement;
  private inputEl!: HTMLTextAreaElement;
  private sendEl!: HTMLButtonElement;
  private statusDotEl!: HTMLSpanElement;
  private launcherEl!: HTMLButtonElement;

  constructor(config: WidgetConfig) {
    this.config = config;
    this.client = new WsClient(config.gatewayUrl, config.appName, config.widgetId);

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

    panel.appendChild(header);
    panel.appendChild(messagesDiv);
    panel.appendChild(inputArea);

    this.panelEl = panel;

    this.shadow.appendChild(launcher);
    this.shadow.appendChild(panel);
  }

  private autoResizeTextarea(): void {
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 120)}px`;
  }

  open(): void {
    this.isOpen = true;
    this.panelEl.classList.remove("hidden");
    this.launcherEl.setAttribute("aria-expanded", "true");
    this.inputEl.focus();
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

  sendMessage(): void {
    const content = this.inputEl.value.trim();
    if (!content || this.isLoading) return;

    this.addMessage({
      id: String(++this.idCounter),
      role: "user",
      content,
      timestamp: Date.now(),
    });

    this.inputEl.value = "";
    this.inputEl.style.height = "auto";
    this.setLoading(true);

    this.client.send(content);
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
      this.renderErrorMessage(frame.message);
    }
  }

  private updateStatus(status: ConnectionStatus): void {
    this.statusDotEl.className = status;
  }

  destroy(): void {
    this.client.disconnect();
    this.container.remove();
  }
}
