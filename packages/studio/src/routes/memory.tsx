import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { useKilnMemory } from "@kilnai/react";

const SCOPES = ["user", "agent", "team", "project", "org"];

export function MemoryView(): ReactNode {
  const [activeScope, setActiveScope] = useState("user");
  const { entries, isLoading, error, refresh, create, remove } = useKilnMemory(activeScope);
  const [newContent, setNewContent] = useState("");
  const [newTags, setNewTags] = useState("");

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;
    const tags = newTags.trim() ? newTags.split(",").map((t) => t.trim()) : undefined;
    void create({ scope: activeScope, content: newContent.trim(), tags });
    setNewContent("");
    setNewTags("");
  };

  return (
    <div>
      <div className="card-header mb-16">Memory Inspector</div>

      <div className="tab-bar">
        {SCOPES.map((scope) => (
          <button
            key={scope}
            className={`tab ${activeScope === scope ? "active" : ""}`}
            onClick={() => setActiveScope(scope)}
          >
            {scope}
          </button>
        ))}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">Entries ({entries.length})</div>
          {isLoading && <div className="text-muted">Loading...</div>}
          {error && <div style={{ color: "var(--error)", fontSize: 12 }}>{error.message}</div>}
          {entries.length === 0 && !isLoading && (
            <div className="text-muted" style={{ fontSize: 13 }}>No entries in this scope</div>
          )}
          {entries.map((entry) => (
            <div key={entry.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <div className="flex justify-between items-center">
                <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>{entry.id}</span>
                <button
                  className="btn"
                  style={{ fontSize: 11, padding: "2px 8px" }}
                  onClick={() => void remove(entry.id)}
                >
                  Delete
                </button>
              </div>
              <div style={{ marginTop: 4, fontSize: 13 }}>{entry.content}</div>
              {entry.tags && entry.tags.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  {entry.tags.map((tag) => (
                    <span key={tag} className="badge badge-info" style={{ marginRight: 4 }}>{tag}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-header">Add Entry</div>
          <form onSubmit={handleCreate} className="flex-col gap-8">
            <textarea
              className="input"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Memory content..."
              rows={4}
              style={{ resize: "vertical" }}
            />
            <input
              className="input"
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              placeholder="Tags (comma-separated)"
            />
            <button className="btn btn-primary" type="submit">Add</button>
          </form>
        </div>
      </div>
    </div>
  );
}
