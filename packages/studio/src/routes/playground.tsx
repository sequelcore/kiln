import { useState, useRef, useEffect, type ReactNode, type FormEvent } from "react";
import { useKilnChat, useKilnEvents } from "@kilnai/react";

export function PlaygroundView(): ReactNode {
  const { messages, send, isLoading, error, clearMessages } = useKilnChat();
  const { events } = useKilnEvents();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    void send(input.trim());
    setInput("");
  };

  // Filter events to tool calls for the side panel
  const toolEvents = events.filter((e) => e.type === "tool_call" || e.type === "tool_result");

  return (
    <div style={{ display: "flex", height: "calc(100vh - 48px)", gap: 16 }}>
      <div className="card flex-col" style={{ flex: 1 }}>
        <div className="flex justify-between items-center mb-16">
          <div className="card-header" style={{ marginBottom: 0 }}>Playground</div>
          <button className="btn" onClick={clearMessages}>Clear</button>
        </div>

        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 12, padding: "8px 0" }}>
          {messages.length === 0 && (
            <div className="empty-state">Send a message to get started</div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "80%",
                padding: "10px 14px",
                borderRadius: 12,
                background: msg.role === "user" ? "var(--accent)" : "var(--bg-tertiary)",
                color: msg.role === "user" ? "#fff" : "var(--text-primary)",
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
              }}
            >
              {msg.content}
            </div>
          ))}
          {isLoading && (
            <div style={{ color: "var(--text-muted)", fontSize: 13, fontStyle: "italic" }}>
              Thinking...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {error && (
          <div style={{ color: "var(--error)", fontSize: 12, marginBottom: 8 }}>
            {error.message}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send a message..."
            disabled={isLoading}
          />
          <button className="btn btn-primary" type="submit" disabled={isLoading}>
            Send
          </button>
        </form>
      </div>

      <div className="card" style={{ width: 300, overflow: "auto" }}>
        <div className="card-header">Tool Calls</div>
        {toolEvents.length === 0 && (
          <div className="text-muted" style={{ fontSize: 12 }}>No tool calls yet</div>
        )}
        {toolEvents.map((event, i) => (
          <div key={i} style={{ marginBottom: 8, padding: 8, background: "var(--bg-tertiary)", borderRadius: 4, fontSize: 12 }}>
            <div className="mono" style={{ color: event.type === "tool_call" ? "var(--accent)" : "var(--success)" }}>
              {event.type}
            </div>
            <pre className="mono text-secondary" style={{ fontSize: 11, marginTop: 4, overflow: "auto", maxHeight: 100 }}>
              {JSON.stringify(event.data, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
