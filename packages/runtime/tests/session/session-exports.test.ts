import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DefaultEscalationDetector,
  InMemorySessionStore,
  RedisSessionStore,
  RuntimeSession,
  RuntimeSessionOrchestrator,
  SessionRegistry,
  isValidTransition,
} from "../../src/session/index.js";
import {
  InMemorySessionStore as PersistenceInMemorySessionStore,
  RedisSessionStore as PersistenceRedisSessionStore,
  SessionRegistry as PersistenceSessionRegistry,
  deserializeSession,
  serializeSession,
} from "../../src/session/persistence/index.js";
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
    expect(RuntimeSession).toBe(DirectRuntimeSession);
    expect(RuntimeSessionOrchestrator).toBe(DirectRuntimeSessionOrchestrator);
    expect(SessionRegistry).toBe(DirectSessionRegistry);
    expect(InMemorySessionStore).toBe(DirectInMemorySessionStore);
    expect(RedisSessionStore).toBe(DirectRedisSessionStore);
    expect(isValidTransition).toBe(DirectIsValidTransition);
    expect(DefaultEscalationDetector).toBe(DirectDefaultEscalationDetector);
  });

  it("persistence seam exports match legacy session wrapper exports", () => {
    expect(PersistenceSessionRegistry).toBe(DirectSessionRegistry);
    expect(PersistenceInMemorySessionStore).toBe(DirectInMemorySessionStore);
    expect(PersistenceRedisSessionStore).toBe(DirectRedisSessionStore);
    expect(serializeSession).toBe(DirectSerializeSession);
    expect(deserializeSession).toBe(DirectDeserializeSession);
  });

  it("runtime root barrel references the session barrel", () => {
    const runtimeIndexPath = join(process.cwd(), "src", "index.ts");
    const source = readFileSync(runtimeIndexPath, "utf-8");
    expect(source).toContain('} from "./session/index.js";');
  });
});
