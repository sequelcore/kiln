import { ThinkingOrb, type OrbSize, type OrbState } from "thinking-orbs";

interface AgentActivityOrbProps {
  readonly state: Extract<OrbState, "solving" | "working">;
  readonly size?: OrbSize;
}

export function AgentActivityOrb({ size = 20, state }: AgentActivityOrbProps) {
  return (
    <ThinkingOrb
      aria-hidden="true"
      data-orb-state={state}
      data-role="activity-orb"
      role="presentation"
      size={size}
      speed={0.82}
      state={state}
      theme="auto"
    />
  );
}
