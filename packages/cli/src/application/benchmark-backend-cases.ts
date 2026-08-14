import { createHash } from "node:crypto";

export const BACKEND_BENCHMARK_CASE_IDS = [
  "idempotent-reservation",
  "atomic-transfer",
  "optimistic-revision",
  "event-deduplication",
  "stable-pagination",
  "rate-window",
  "default-deny-access",
  "bounded-retry",
] as const;

export type BackendBenchmarkCaseId = typeof BACKEND_BENCHMARK_CASE_IDS[number];

export interface BackendBenchmarkCase {
  readonly id: BackendBenchmarkCaseId;
  readonly allowedChangedPath: "src/solution.mjs";
  readonly hiddenTestSource: string;
  readonly testCount: number;
  readonly testDigest: string;
}

const TESTS: Readonly<Record<BackendBenchmarkCaseId, { readonly source: string; readonly count: number }>> = {
  "idempotent-reservation": {
    count: 4,
    source: String.raw`import test from "node:test";
import assert from "node:assert/strict";
import { reserveStock } from "/workspace/src/solution.mjs";
test("reserves and reports remaining stock", () => { const state={stock:{kiln:5},reservations:{}}; assert.deepEqual(reserveStock(state,"kiln",2,"r1"),{sku:"kiln",quantity:2,remaining:3,requestId:"r1"}); assert.equal(state.stock.kiln,3); });
test("replays the same request without a second decrement", () => { const state={stock:{kiln:5},reservations:{}}; const first=reserveStock(state,"kiln",2,"r1"); assert.deepEqual(reserveStock(state,"kiln",2,"r1"),first); assert.equal(state.stock.kiln,3); });
test("rejects invalid quantities without mutation", () => { for (const quantity of [0,-1,1.5,NaN]) { const state={stock:{kiln:5},reservations:{}}; assert.throws(()=>reserveStock(state,"kiln",quantity,"bad")); assert.deepEqual(state,{stock:{kiln:5},reservations:{}}); } });
test("rejects unknown and insufficient stock atomically", () => { const state={stock:{kiln:1},reservations:{}}; assert.throws(()=>reserveStock(state,"missing",1,"u")); assert.throws(()=>reserveStock(state,"kiln",2,"i")); assert.deepEqual(state,{stock:{kiln:1},reservations:{}}); });`,
  },
  "atomic-transfer": {
    count: 4,
    source: String.raw`import test from "node:test";
import assert from "node:assert/strict";
import { transferFunds } from "/workspace/src/solution.mjs";
test("transfers atomically and journals the result",()=>{const state={balances:{a:10,b:2},transfers:{}};assert.deepEqual(transferFunds(state,"a","b",4,"t1"),{requestId:"t1",from:"a",to:"b",amount:4});assert.deepEqual(state,{balances:{a:6,b:6},transfers:{t1:{requestId:"t1",from:"a",to:"b",amount:4}}});});
test("replays an existing request",()=>{const state={balances:{a:10,b:2},transfers:{}};const first=transferFunds(state,"a","b",4,"t1");assert.deepEqual(transferFunds(state,"a","b",4,"t1"),first);assert.deepEqual(state.balances,{a:6,b:6});});
test("rejects invalid accounts and amounts without mutation",()=>{for(const args of [["x","b",1],["a","x",1],["a","b",0],["a","b",1.5]]){const state={balances:{a:10,b:2},transfers:{}};assert.throws(()=>transferFunds(state,...args,"bad"));assert.deepEqual(state,{balances:{a:10,b:2},transfers:{}});}});
test("rejects insufficient funds without mutation",()=>{const state={balances:{a:1,b:2},transfers:{}};assert.throws(()=>transferFunds(state,"a","b",2,"t1"));assert.deepEqual(state,{balances:{a:1,b:2},transfers:{}});});`,
  },
  "optimistic-revision": {
    count: 4,
    source: String.raw`import test from "node:test";
import assert from "node:assert/strict";
import { applyRevision } from "/workspace/src/solution.mjs";
test("applies an allowed patch and increments revision",()=>{const state={documents:{a:{revision:2,title:"Old",status:"draft"}}};assert.deepEqual(applyRevision(state,"a",2,{title:"New"}),{revision:3,title:"New",status:"draft"});assert.deepEqual(state.documents.a,{revision:3,title:"New",status:"draft"});});
test("rejects revision conflict without mutation",()=>{const state={documents:{a:{revision:2,title:"Old",status:"draft"}}};assert.throws(()=>applyRevision(state,"a",1,{title:"New"}));assert.equal(state.documents.a.title,"Old");});
test("rejects missing documents and empty patches",()=>{const state={documents:{a:{revision:2,title:"Old",status:"draft"}}};assert.throws(()=>applyRevision(state,"x",2,{title:"New"}));assert.throws(()=>applyRevision(state,"a",2,{}));});
test("rejects protected or unknown fields",()=>{for(const patch of [{revision:9},{owner:"x"},{__proto__:{polluted:true}}]){const state={documents:{a:{revision:2,title:"Old",status:"draft"}}};assert.throws(()=>applyRevision(state,"a",2,patch));assert.deepEqual(state.documents.a,{revision:2,title:"Old",status:"draft"});}});`,
  },
  "event-deduplication": {
    count: 4,
    source: String.raw`import test from "node:test";
import assert from "node:assert/strict";
import { applyInventoryEvent } from "/workspace/src/solution.mjs";
test("applies a valid increment",()=>{const state={stock:{kiln:2},processedEventIds:{}};assert.equal(applyInventoryEvent(state,{id:"e1",sku:"kiln",delta:3}),5);assert.deepEqual(state,{stock:{kiln:5},processedEventIds:{e1:true}});});
test("deduplicates event ids",()=>{const state={stock:{kiln:2},processedEventIds:{}};applyInventoryEvent(state,{id:"e1",sku:"kiln",delta:3});assert.equal(applyInventoryEvent(state,{id:"e1",sku:"kiln",delta:3}),5);assert.equal(state.stock.kiln,5);});
test("rejects malformed events atomically",()=>{for(const event of [{id:"",sku:"kiln",delta:1},{id:"e",sku:"",delta:1},{id:"e",sku:"kiln",delta:1.5}]){const state={stock:{kiln:2},processedEventIds:{}};assert.throws(()=>applyInventoryEvent(state,event));assert.deepEqual(state,{stock:{kiln:2},processedEventIds:{}});}});
test("rejects an event that would make stock negative",()=>{const state={stock:{kiln:2},processedEventIds:{}};assert.throws(()=>applyInventoryEvent(state,{id:"e1",sku:"kiln",delta:-3}));assert.deepEqual(state,{stock:{kiln:2},processedEventIds:{}});});`,
  },
  "stable-pagination": {
    count: 4,
    source: String.raw`import test from "node:test";
import assert from "node:assert/strict";
import { pageAfter } from "/workspace/src/solution.mjs";
const records=[{id:"b",value:2},{id:"a",value:1},{id:"d",value:4},{id:"c",value:3}];
test("returns a stable id-ordered first page without mutating input",()=>{const before=structuredClone(records);assert.deepEqual(pageAfter(records,null,2),{items:[{id:"a",value:1},{id:"b",value:2}],nextCursor:"b"});assert.deepEqual(records,before);});
test("continues after an existing cursor",()=>{assert.deepEqual(pageAfter(records,"b",2),{items:[{id:"c",value:3},{id:"d",value:4}],nextCursor:null});});
test("rejects invalid limits",()=>{for(const limit of [0,-1,1.5,101])assert.throws(()=>pageAfter(records,null,limit));});
test("rejects duplicate ids and unknown cursors",()=>{assert.throws(()=>pageAfter([{id:"a"},{id:"a"}],null,1));assert.throws(()=>pageAfter(records,"x",1));});`,
  },
  "rate-window": {
    count: 4,
    source: String.raw`import test from "node:test";
import assert from "node:assert/strict";
import { recordAttempt } from "/workspace/src/solution.mjs";
test("records attempts inside the window",()=>{const state={attempts:{},requests:{}};assert.deepEqual(recordAttempt(state,"u",1000,"r1",2,100),{allowed:true,remaining:1});assert.deepEqual(recordAttempt(state,"u",1050,"r2",2,100),{allowed:true,remaining:0});});
test("denies over-limit attempts without recording them",()=>{const state={attempts:{u:[1000,1050]},requests:{}};assert.deepEqual(recordAttempt(state,"u",1060,"r3",2,100),{allowed:false,remaining:0});assert.deepEqual(state.attempts.u,[1000,1050]);});
test("expires old attempts and replays request ids",()=>{const state={attempts:{u:[900,950]},requests:{}};const first=recordAttempt(state,"u",1051,"r1",2,100);assert.deepEqual(first,{allowed:true,remaining:1});assert.deepEqual(recordAttempt(state,"u",9999,"r1",2,100),first);assert.deepEqual(state.attempts.u,[1051]);});
test("validates inputs without mutation",()=>{const state={attempts:{},requests:{}};assert.throws(()=>recordAttempt(state,"",1000,"r",2,100));assert.throws(()=>recordAttempt(state,"u",NaN,"r",2,100));assert.throws(()=>recordAttempt(state,"u",1000,"r",0,100));assert.deepEqual(state,{attempts:{},requests:{}});});`,
  },
  "default-deny-access": {
    count: 4,
    source: String.raw`import test from "node:test";
import assert from "node:assert/strict";
import { canAccess } from "/workspace/src/solution.mjs";
const policy={roles:{viewer:["document:read"],editor:["document:read","document:write"]},resourceOwners:{doc1:"u1"}};
test("allows an explicitly granted role action",()=>{assert.equal(canAccess(policy,{id:"u2",roles:["viewer"]},"read",{type:"document",id:"doc1"}),true);});
test("denies unknown roles, actions, and resources by default",()=>{assert.equal(canAccess(policy,{id:"u2",roles:["missing"]},"read",{type:"document",id:"doc1"}),false);assert.equal(canAccess(policy,{id:"u2",roles:["viewer"]},"delete",{type:"document",id:"doc1"}),false);});
test("owner access is limited to read and write",()=>{assert.equal(canAccess(policy,{id:"u1",roles:[]},"write",{type:"document",id:"doc1"}),true);assert.equal(canAccess(policy,{id:"u1",roles:[]},"delete",{type:"document",id:"doc1"}),false);});
test("malformed identities fail closed",()=>{assert.equal(canAccess(policy,{id:"",roles:["editor"]},"write",{type:"document",id:"doc1"}),false);assert.equal(canAccess(policy,{id:"u",roles:"editor"},"write",{type:"document",id:"doc1"}),false);});`,
  },
  "bounded-retry": {
    count: 4,
    source: String.raw`import test from "node:test";
import assert from "node:assert/strict";
import { planRetry } from "/workspace/src/solution.mjs";
test("uses bounded exponential delay",()=>{assert.deepEqual(planRetry(1,4,100,1000),{retry:true,delayMs:100,nextAttempt:2});assert.deepEqual(planRetry(3,4,100,250),{retry:true,delayMs:250,nextAttempt:4});});
test("stops at maximum attempts",()=>{assert.deepEqual(planRetry(4,4,100,1000),{retry:false,delayMs:0,nextAttempt:null});});
test("honors a larger retry-after value but preserves the cap",()=>{assert.deepEqual(planRetry(2,4,100,1000,700),{retry:true,delayMs:700,nextAttempt:3});assert.deepEqual(planRetry(2,4,100,500,900),{retry:true,delayMs:500,nextAttempt:3});});
test("rejects invalid bounds",()=>{for(const args of [[0,4,100,1000],[1,0,100,1000],[1,4,0,1000],[1,4,100,50],[1,4,100,1000,-1]])assert.throws(()=>planRetry(...args));});`,
  },
};

export const BACKEND_BENCHMARK_CASES: Readonly<Record<BackendBenchmarkCaseId, BackendBenchmarkCase>> =
  Object.fromEntries(BACKEND_BENCHMARK_CASE_IDS.map((id) => {
    const test = TESTS[id];
    return [id, {
      id,
      allowedChangedPath: "src/solution.mjs",
      hiddenTestSource: test.source,
      testCount: test.count,
      testDigest: `sha256:${createHash("sha256").update(test.source).digest("hex")}`,
    }];
  })) as unknown as Readonly<Record<BackendBenchmarkCaseId, BackendBenchmarkCase>>;

export function requireBackendBenchmarkCase(value: unknown): BackendBenchmarkCase {
  if (typeof value !== "string" || !BACKEND_BENCHMARK_CASE_IDS.includes(value as BackendBenchmarkCaseId)) {
    throw new Error("Backend benchmark case must identify an admitted v2 case.");
  }
  return BACKEND_BENCHMARK_CASES[value as BackendBenchmarkCaseId];
}
