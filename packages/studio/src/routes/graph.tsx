import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge, Position } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useAppGraph, type AppGraphTeam, type AppGraphAgent } from "../hooks/use-app-graph.js";

function teamToNodes(team: AppGraphTeam, index: number): Node[] {
  const baseX = 300;
  const baseY = index * 350;
  const nodes: Node[] = [];

  nodes.push({
    id: `team-${team.name}`,
    type: "default",
    position: { x: baseX, y: baseY },
    data: { label: `Team: ${team.name}` },
    style: { background: "#1a2744", border: "1px solid #2a4a7a", color: "#e0e0e0", borderRadius: 8, padding: 12, minWidth: 180 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  });

  team.agents.forEach((agent, i) => {
    nodes.push({
      id: `agent-${team.name}-${agent.name}`,
      type: "default",
      position: { x: baseX + 280, y: baseY + i * 80 },
      data: { label: `${agent.name} (${agent.tier})` },
      style: { background: "#1a3a2a", border: "1px solid #2a6a4a", color: "#e0e0e0", borderRadius: 8, padding: 10, fontSize: 12 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });
  });

  return nodes;
}

function teamToEdges(team: AppGraphTeam): Edge[] {
  return team.agents.map((agent) => ({
    id: `edge-${team.name}-${agent.name}`,
    source: `team-${team.name}`,
    target: `agent-${team.name}-${agent.name}`,
    animated: true,
    style: { stroke: "#2a4a7a" },
  }));
}

export function GraphView(): ReactNode {
  const { data: graph, isLoading, error } = useAppGraph();
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };

    const allNodes: Node[] = [];
    const allEdges: Edge[] = [];

    // Router node
    allNodes.push({
      id: "router",
      type: "default",
      position: { x: 50, y: 100 },
      data: { label: `Router (fallback: ${graph.router.fallback})` },
      style: { background: "#2a1a44", border: "1px solid #4a2a7a", color: "#e0e0e0", borderRadius: 8, padding: 12, minWidth: 200 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });

    // Teams and agents
    graph.teams.forEach((team, i) => {
      allNodes.push(...teamToNodes(team, i));
      allEdges.push(...teamToEdges(team));

      // Router -> Team edge
      allEdges.push({
        id: `edge-router-${team.name}`,
        source: "router",
        target: `team-${team.name}`,
        style: { stroke: "#4a2a7a" },
      });
    });

    return { nodes: allNodes, edges: allEdges };
  }, [graph]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node.id);
  }, []);

  if (isLoading) return <div className="empty-state">Loading app graph...</div>;
  if (error) return <div className="empty-state">Failed to load app graph</div>;
  if (!graph || graph.teams.length === 0) return <div className="empty-state">No app graph available</div>;

  const selectedTeam = graph.teams.find((t) => selectedNode === `team-${t.name}`);
  const selectedAgent = !selectedTeam
    ? graph.teams
        .flatMap((t) => t.agents.map((a) => ({ team: t.name, agent: a })))
        .find((x) => selectedNode === `agent-${x.team}-${x.agent.name}`)
    : undefined;

  return (
    <div style={{ display: "flex", height: "calc(100vh - 48px)", gap: 16 }}>
      <div style={{ flex: 1 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodeClick={onNodeClick}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#222" gap={20} />
          <Controls />
        </ReactFlow>
      </div>
      {(selectedTeam || selectedAgent) && (
        <div className="card" style={{ width: 320, overflow: "auto" }}>
          <div className="card-header">Inspector</div>
          {selectedTeam && <TeamDetail team={selectedTeam} />}
          {selectedAgent && <AgentDetail agent={selectedAgent.agent} team={selectedAgent.team} />}
        </div>
      )}
    </div>
  );
}

function TeamDetail({ team }: { team: AppGraphTeam }): ReactNode {
  return (
    <div className="flex-col gap-8">
      <div><strong>Team:</strong> {team.name}</div>
      {team.mode && <div><strong>Mode:</strong> <span className="badge badge-info">{team.mode}</span></div>}
      <div><strong>Phases:</strong> <span className="mono text-secondary">{team.phases.join(" -> ")}</span></div>
      <div><strong>Capabilities:</strong></div>
      <ul style={{ paddingLeft: 16 }}>
        {team.capabilities.map((c) => <li key={c} className="mono" style={{ fontSize: 12 }}>{c}</li>)}
      </ul>
      <div><strong>Agents:</strong> {team.agents.length}</div>
    </div>
  );
}

function AgentDetail({ agent, team }: { agent: AppGraphAgent; team: string }): ReactNode {
  return (
    <div className="flex-col gap-8">
      <div><strong>Agent:</strong> {agent.name}</div>
      <div><strong>Team:</strong> {team}</div>
      <div><strong>Role:</strong> {agent.role}</div>
      {agent.goal && <div><strong>Goal:</strong> {agent.goal}</div>}
      <div><strong>Tier:</strong> <span className="badge badge-info">{agent.tier}</span></div>
      {agent.tools.length > 0 && (
        <>
          <div><strong>Tools:</strong></div>
          <ul style={{ paddingLeft: 16 }}>
            {agent.tools.map((t) => <li key={t} className="mono" style={{ fontSize: 12 }}>{t}</li>)}
          </ul>
        </>
      )}
      {agent.modalities && (
        <div><strong>Modalities:</strong> {agent.modalities.join(", ")}</div>
      )}
    </div>
  );
}
