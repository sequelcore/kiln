import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as sessionBarrel from "../../src/session/index.js";
import * as persistenceBarrel from "../../src/session/persistence/index.js";

import { RuntimeSession as DirectRuntimeSession } from "../../src/session/runtime-session.js";
import { RuntimeSessionOrchestrator as DirectRuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { SessionRegistry as DirectSessionRegistry } from "../../src/session/session-registry.js";
import { InMemorySessionStore as DirectInMemorySessionStore } from "../../src/session/in-memory-session-store.js";
import { RedisSessionStore as DirectRedisSessionStore } from "../../src/session/redis-session-store.js";
import { serializeSession as DirectSerializeSession, deserializeSession as DirectDeserializeSession } from "../../src/session/session-serializer.js";
import { isValidTransition as DirectIsValidTransition } from "../../src/session/session-mode.js";
import { DefaultEscalationDetector as DirectDefaultEscalationDetector } from "../../src/session/support/escalation/escalation-detector.js";

describe("session exports", () => {
  it("session barrel exposes the current session boundary", () => {
    expect(sessionBarrel.RuntimeSession).toBe(DirectRuntimeSession);
    expect(sessionBarrel.RuntimeSessionOrchestrator).toBe(DirectRuntimeSessionOrchestrator);
    expect(sessionBarrel.SessionRegistry).toBe(DirectSessionRegistry);
    expect(sessionBarrel.InMemorySessionStore).toBe(DirectInMemorySessionStore);
    expect(sessionBarrel.RedisSessionStore).toBe(DirectRedisSessionStore);
    expect(sessionBarrel.isValidTransition).toBe(DirectIsValidTransition);
    expect(sessionBarrel.DefaultEscalationDetector).toBe(DirectDefaultEscalationDetector);
  });

  it("persistence seam exports match legacy session wrapper exports", () => {
    expect(persistenceBarrel.SessionRegistry).toBe(DirectSessionRegistry);
    expect(persistenceBarrel.InMemorySessionStore).toBe(DirectInMemorySessionStore);
    expect(persistenceBarrel.RedisSessionStore).toBe(DirectRedisSessionStore);
    expect(persistenceBarrel.serializeSession).toBe(DirectSerializeSession);
    expect(persistenceBarrel.deserializeSession).toBe(DirectDeserializeSession);
  });

  it("runtime root barrel references the session barrel", () => {
    const runtimeIndexPath = join(process.cwd(), "src", "index.ts");
    const source = readFileSync(runtimeIndexPath, "utf-8");
    expect(source).toContain('} from "./session/index.js";');
  });
});
