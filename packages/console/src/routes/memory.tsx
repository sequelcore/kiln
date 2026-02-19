import { useState } from "react";

export function MemoryPage() {
  const [query, setQuery] = useState("");

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h2 className="text-lg font-semibold mb-4">Memory Browser</h2>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search memories..."
        className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm text-[#fafafa] placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
      />
      <p className="mt-6 text-sm text-neutral-500">Memory browser coming soon</p>
    </div>
  );
}
