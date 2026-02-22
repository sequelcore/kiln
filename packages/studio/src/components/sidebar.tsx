import type { ReactNode } from "react";

interface SidebarProps {
  activeView: string;
  onNavigate: (view: "graph" | "playground" | "timeline" | "memory" | "eval") => void;
}

const NAV_ITEMS = [
  { id: "graph" as const, label: "App Graph", icon: "\u25C9" },
  { id: "playground" as const, label: "Playground", icon: "\u25B6" },
  { id: "timeline" as const, label: "Timeline", icon: "\u2261" },
  { id: "memory" as const, label: "Memory", icon: "\u25A0" },
  { id: "eval" as const, label: "Eval", icon: "\u2605" },
];

export function Sidebar({ activeView, onNavigate }: SidebarProps): ReactNode {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-logo">Kiln Studio</span>
      </div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`sidebar-item ${activeView === item.id ? "active" : ""}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="sidebar-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
      <style>{`
        .sidebar {
          background: var(--bg-secondary);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
        }
        .sidebar-header {
          padding: 20px 16px;
          border-bottom: 1px solid var(--border);
        }
        .sidebar-logo {
          font-size: 16px;
          font-weight: 700;
          color: var(--accent);
        }
        .sidebar-nav {
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .sidebar-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border: none;
          background: none;
          color: var(--text-secondary);
          font-size: 13px;
          cursor: pointer;
          border-radius: var(--radius-sm);
          text-align: left;
          transition: all 0.15s;
        }
        .sidebar-item:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .sidebar-item.active {
          background: rgba(74, 158, 255, 0.1);
          color: var(--accent);
        }
        .sidebar-icon {
          font-size: 14px;
          width: 20px;
          text-align: center;
        }
      `}</style>
    </aside>
  );
}
