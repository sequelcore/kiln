import type { ReactNode } from "react";
import type { View } from "../types.js";
import "./sidebar.css";

interface SidebarProps {
  activeView: string;
  onNavigate: (view: View) => void;
}

const NAV_ITEMS: { id: View; label: string; icon: string }[] = [
  { id: "graph", label: "App Graph", icon: "\u25C9" },
  { id: "playground", label: "Playground", icon: "\u25B6" },
  { id: "timeline", label: "Timeline", icon: "\u2261" },
  { id: "memory", label: "Memory", icon: "\u25A0" },
  { id: "eval", label: "Eval", icon: "\u2605" },
  { id: "cost", label: "Cost", icon: "\u25CE" },
  { id: "safety", label: "Safety", icon: "\u26A0" },
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
    </aside>
  );
}
