export function getStyles(theme: string): string {
  const isDark = theme === "dark";
  const isAuto = theme === "auto";

  return `
    :host {
      --kiln-bg: ${isDark ? "#1a1a2e" : "#ffffff"};
      --kiln-bg-secondary: ${isDark ? "#2a2a3e" : "#f0f0f0"};
      --kiln-text: ${isDark ? "#e8e8f0" : "#1a1a1a"};
      --kiln-text-secondary: ${isDark ? "#a0a0b8" : "#6b7280"};
      --kiln-border: ${isDark ? "#3a3a5c" : "#e5e7eb"};
      --kiln-accent: #1a1a2e;
      --kiln-accent-text: #ffffff;
      --kiln-user-bubble: #1a1a2e;
      --kiln-user-text: #ffffff;
      --kiln-assistant-bubble: ${isDark ? "#2a2a3e" : "#f0f0f0"};
      --kiln-assistant-text: ${isDark ? "#e8e8f0" : "#1a1a1a"};
      --kiln-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
      --kiln-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --kiln-radius: 16px;
      --kiln-status-connected: #22c55e;
      --kiln-status-connecting: #f59e0b;
      --kiln-status-disconnected: #6b7280;
      --kiln-status-error: #ef4444;
    }

    ${isAuto ? `
    @media (prefers-color-scheme: dark) {
      :host {
        --kiln-bg: #1a1a2e;
        --kiln-bg-secondary: #2a2a3e;
        --kiln-text: #e8e8f0;
        --kiln-text-secondary: #a0a0b8;
        --kiln-border: #3a3a5c;
        --kiln-assistant-bubble: #2a2a3e;
        --kiln-assistant-text: #e8e8f0;
      }
    }` : ""}

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* Launcher button */
    #kiln-launcher {
      position: fixed;
      bottom: 24px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--kiln-accent);
      color: var(--kiln-accent-text);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: var(--kiln-shadow);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      z-index: 999998;
      font-family: var(--kiln-font);
    }

    #kiln-launcher.position-bottom-right {
      right: 24px;
    }

    #kiln-launcher.position-bottom-left {
      left: 24px;
    }

    #kiln-launcher:hover {
      transform: scale(1.08);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
    }

    #kiln-launcher:active {
      transform: scale(0.96);
    }

    #kiln-launcher svg {
      width: 24px;
      height: 24px;
      flex-shrink: 0;
    }

    /* Chat panel */
    #kiln-panel {
      position: fixed;
      bottom: 92px;
      width: 380px;
      height: min(520px, calc(100vh - 100px));
      border-radius: var(--kiln-radius);
      background: var(--kiln-bg);
      box-shadow: var(--kiln-shadow);
      display: flex;
      flex-direction: column;
      z-index: 999997;
      font-family: var(--kiln-font);
      border: 1px solid var(--kiln-border);
      overflow: hidden;
      transform-origin: bottom center;
      animation: kiln-slide-up 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    #kiln-panel.position-bottom-right {
      right: 24px;
    }

    #kiln-panel.position-bottom-left {
      left: 24px;
    }

    #kiln-panel.hidden {
      display: none;
    }

    @keyframes kiln-slide-up {
      from {
        opacity: 0;
        transform: translateY(16px) scale(0.96);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @media (max-width: 639px) {
      #kiln-panel {
        width: 100vw;
        height: 100vh;
        bottom: 0;
        right: 0 !important;
        left: 0 !important;
        border-radius: 0;
        animation: kiln-slide-up-mobile 0.22s ease;
      }

      @keyframes kiln-slide-up-mobile {
        from {
          opacity: 0;
          transform: translateY(24px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    }

    /* Header */
    #kiln-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--kiln-border);
      flex-shrink: 0;
    }

    #kiln-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--kiln-status-disconnected);
      transition: background 0.3s ease;
    }

    #kiln-status-dot.connected { background: var(--kiln-status-connected); }
    #kiln-status-dot.connecting { background: var(--kiln-status-connecting); }
    #kiln-status-dot.disconnected { background: var(--kiln-status-disconnected); }
    #kiln-status-dot.error { background: var(--kiln-status-error); }

    #kiln-title {
      flex: 1;
      font-size: 15px;
      font-weight: 600;
      color: var(--kiln-text);
    }

    #kiln-close {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--kiln-text-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      transition: background 0.15s ease, color 0.15s ease;
    }

    #kiln-close:hover {
      background: var(--kiln-bg-secondary);
      color: var(--kiln-text);
    }

    #kiln-close svg {
      width: 16px;
      height: 16px;
    }

    /* Messages area */
    #kiln-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      scroll-behavior: smooth;
    }

    #kiln-messages::-webkit-scrollbar {
      width: 4px;
    }

    #kiln-messages::-webkit-scrollbar-track {
      background: transparent;
    }

    #kiln-messages::-webkit-scrollbar-thumb {
      background: var(--kiln-border);
      border-radius: 2px;
    }

    /* Message bubbles */
    .kiln-msg {
      display: flex;
      flex-direction: column;
      max-width: 80%;
      animation: kiln-msg-in 0.18s ease;
    }

    @keyframes kiln-msg-in {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .kiln-msg.user {
      align-self: flex-end;
      align-items: flex-end;
    }

    .kiln-msg.assistant {
      align-self: flex-start;
      align-items: flex-start;
    }

    .kiln-bubble {
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 14px;
      line-height: 1.5;
      word-break: break-word;
    }

    .kiln-msg.user .kiln-bubble {
      background: var(--kiln-user-bubble);
      color: var(--kiln-user-text);
      border-bottom-right-radius: 4px;
    }

    .kiln-msg.assistant .kiln-bubble {
      background: var(--kiln-assistant-bubble);
      color: var(--kiln-assistant-text);
      border-bottom-left-radius: 4px;
    }

    .kiln-bubble code {
      font-family: "Courier New", Courier, monospace;
      font-size: 13px;
      background: rgba(0, 0, 0, 0.08);
      padding: 1px 5px;
      border-radius: 4px;
    }

    .kiln-msg.user .kiln-bubble code {
      background: rgba(255, 255, 255, 0.15);
    }

    /* Error message */
    .kiln-msg.error .kiln-bubble {
      background: #fee2e2;
      color: #dc2626;
      border: 1px solid #fca5a5;
    }

    /* Info message (amber, for budget exhaustion) */
    .kiln-msg.info .kiln-bubble {
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fcd34d;
    }

    /* Suggestion chips */
    .kiln-suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 4px 0;
      align-self: flex-start;
      max-width: 90%;
      animation: kiln-msg-in 0.18s ease;
    }

    .kiln-chip {
      background: var(--kiln-bg-secondary);
      color: var(--kiln-text);
      border: 1px solid var(--kiln-border);
      border-radius: 14px;
      padding: 6px 12px;
      font-size: 13px;
      font-family: var(--kiln-font);
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease;
    }

    .kiln-chip:hover {
      border-color: var(--kiln-accent);
      background: var(--kiln-bg);
    }

    .kiln-chip:active {
      transform: scale(0.97);
    }

    /* Typing indicator */
    #kiln-typing {
      display: flex;
      align-self: flex-start;
      padding: 10px 14px;
      background: var(--kiln-assistant-bubble);
      border-radius: 14px;
      border-bottom-left-radius: 4px;
      gap: 4px;
      animation: kiln-msg-in 0.18s ease;
    }

    #kiln-typing.hidden {
      display: none;
    }

    .kiln-typing-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--kiln-text-secondary);
      animation: kiln-bounce 1.2s infinite;
    }

    .kiln-typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .kiln-typing-dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes kiln-bounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-5px); }
    }

    /* Input area */
    #kiln-input-area {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--kiln-border);
      flex-shrink: 0;
    }

    #kiln-input {
      flex: 1;
      padding: 9px 12px;
      border: 1px solid var(--kiln-border);
      border-radius: 10px;
      background: var(--kiln-bg);
      color: var(--kiln-text);
      font-family: var(--kiln-font);
      font-size: 14px;
      line-height: 1.5;
      resize: none;
      outline: none;
      max-height: 120px;
      min-height: 40px;
      transition: border-color 0.15s ease;
      overflow-y: auto;
    }

    #kiln-input::-webkit-scrollbar {
      width: 4px;
    }

    #kiln-input::-webkit-scrollbar-track {
      background: transparent;
    }

    #kiln-input::-webkit-scrollbar-thumb {
      background: var(--kiln-border);
      border-radius: 2px;
    }

    #kiln-input::placeholder {
      color: var(--kiln-text-secondary);
    }

    #kiln-input:focus {
      border-color: var(--kiln-accent);
    }

    #kiln-send {
      background: var(--kiln-accent);
      color: var(--kiln-accent-text);
      border: none;
      border-radius: 10px;
      width: 38px;
      height: 38px;
      flex-shrink: 0;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.15s ease, transform 0.1s ease;
    }

    #kiln-send:hover {
      opacity: 0.88;
    }

    #kiln-send:active {
      transform: scale(0.94);
    }

    #kiln-send:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    #kiln-send svg {
      width: 18px;
      height: 18px;
    }

    /* Chat area wrapper */
    #kiln-chat-area {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }

    #kiln-chat-area.hidden {
      display: none;
    }

    /* Pre-chat form */
    #kiln-prechat-form {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 24px 20px;
      overflow-y: auto;
    }

    .kiln-form-title {
      font-size: 14px;
      color: var(--kiln-text-secondary);
      line-height: 1.5;
    }

    .kiln-form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .kiln-form-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--kiln-text);
    }

    .kiln-form-required {
      color: var(--kiln-status-error);
    }

    .kiln-form-input {
      padding: 9px 12px;
      border: 1px solid var(--kiln-border);
      border-radius: 8px;
      background: var(--kiln-bg);
      color: var(--kiln-text);
      font-family: var(--kiln-font);
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s ease;
    }

    .kiln-form-input:focus {
      border-color: var(--kiln-accent);
    }

    .kiln-form-input.kiln-form-error {
      border-color: var(--kiln-status-error);
    }

    .kiln-form-submit {
      margin-top: auto;
      padding: 10px 16px;
      background: var(--kiln-accent);
      color: var(--kiln-accent-text);
      border: none;
      border-radius: 10px;
      font-family: var(--kiln-font);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.15s ease;
    }

    .kiln-form-submit:hover {
      opacity: 0.88;
    }

    .kiln-form-submit:active {
      transform: scale(0.98);
    }
  `;
}
