import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as sessionBarrel from "../../src/session/index.js";

import { ModeBSession as DirectModeBSession } from "../../src/session/mode-b-session.js";
import { ModeBOrchestrator as DirectModeBOrchestrator } from "../../src/session/mode-b-orchestrator.js";
import { SessionRegistry as DirectSessionRegistry } from "../../src/session/session-registry.js";
import { InMemorySessionStore as DirectInMemorySessionStore } from "../../src/session/in-memory-session-store.js";
import { RedisSessionStore as DirectRedisSessionStore } from "../../src/session/redis-session-store.js";
import { isValidTransition as DirectIsValidTransition } from "../../src/session/session-mode.js";
import { DefaultEscalationDetector as DirectDefaultEscalationDetector } from "../../src/session/escalation-detector.js";

describe("session exports", () => {
  it("session barrel exposes the current session boundary", () => {
    expect(sessionBarrel.ModeBSession).toBe(DirectModeBSession);
    expect(sessionBarrel.ModeBOrchestrator).toBe(DirectModeBOrchestrator);
    expect(sessionBarrel.SessionRegistry).toBe(DirectSessionRegistry);
    expect(sessionBarrel.InMemorySessionStore).toBe(DirectInMemorySessionStore);
    expect(sessionBarrel.RedisSessionStore).toBe(DirectRedisSessionStore);
    expect(sessionBarrel.isValidTransition).toBe(DirectIsValidTransition);
    expect(sessionBarrel.DefaultEscalationDetector).toBe(DirectDefaultEscalationDetector);
  });

  it("runtime root barrel references the session barrel", () => {
    const runtimeIndexPath = join(process.cwd(), "src", "index.ts");
    const source = readFileSync(runtimeIndexPath, "utf-8");
    expect(source).toContain('} from "./session/index.js";');
  });
});
