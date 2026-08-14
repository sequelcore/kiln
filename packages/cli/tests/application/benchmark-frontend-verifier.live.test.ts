import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { verifyFrontendBenchmarkLease } from "../../src/application/benchmark-frontend-verifier.js";
import type { FrontendBenchmarkCaseId } from "../../src/application/benchmark-frontend-cases.js";
import { createBenchmarkWriteWorkspaceLease } from "../../src/application/benchmark-write-workspace.js";
import { resolveProjectRoot } from "../../src/application/project-root-resolver.js";

const REFERENCES: Readonly<Record<FrontendBenchmarkCaseId, string>> = {
  "modal-focus": `import { useEffect, useRef, useState } from "react";
export function Challenge(){const[open,setOpen]=useState(false);const trigger=useRef(null);const confirm=useRef(null);useEffect(()=>{if(open)confirm.current?.focus()},[open]);const close=()=>{setOpen(false);queueMicrotask(()=>trigger.current?.focus())};const keys=(event)=>{if(event.key==="Escape")close();if(event.key==="Tab"){event.preventDefault();const actions=[...event.currentTarget.querySelectorAll("button")];const index=actions.indexOf(document.activeElement);actions[(index+(event.shiftKey?-1:1)+actions.length)%actions.length]?.focus()}};return <main><h1>Order queue</h1><button ref={trigger} onClick={()=>setOpen(true)}>Review order A-104</button>{open&&<div className="backdrop"><section role="dialog" aria-modal="true" aria-labelledby="title" onKeyDown={keys}><h2 id="title">Review order A-104</h2><div className="actions"><button ref={confirm}>Confirm review</button><button onClick={close}>Cancel</button></div></section></div>}</main>}`,
  "tabs-keyboard": `import { useRef, useState } from "react";
const names=["Profile","Security","Billing"];export function Challenge(){const[selected,setSelected]=useState(0);const refs=useRef([]);const choose=(index)=>{setSelected(index);queueMicrotask(()=>refs.current[index]?.focus())};const keys=(event,index)=>{if(event.key==="ArrowRight")choose((index+1)%3);if(event.key==="ArrowLeft")choose((index+2)%3);if(event.key==="Home")choose(0);if(event.key==="End")choose(2)};return <main><h1>Account settings</h1><div role="tablist" aria-label="Account sections">{names.map((name,index)=><button key={name} ref={(node)=>refs.current[index]=node} role="tab" id={"tab-"+index} aria-controls={"panel-"+index} aria-selected={selected===index} tabIndex={selected===index?0:-1} onClick={()=>setSelected(index)} onKeyDown={(event)=>keys(event,index)}>{name}</button>)}</div><section role="tabpanel" id={"panel-"+selected} aria-labelledby={"tab-"+selected}>{names[selected]} settings</section></main>}`,
  "form-errors": `import { useRef, useState } from "react";
export function Challenge(){const[email,setEmail]=useState("");const[error,setError]=useState("");const[status,setStatus]=useState("");const input=useRef(null);const submit=(event)=>{event.preventDefault();if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)){setStatus("");setError("Enter a valid email address");queueMicrotask(()=>input.current?.focus());return}setError("");setEmail("");setStatus("Invitation sent")};return <main><h1>Invite teammate</h1><form onSubmit={submit}><label htmlFor="email">Email address</label><input ref={input} id="email" value={email} onChange={(event)=>setEmail(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error?"email-error":undefined}/>{error&&<p id="email-error" className="error" role="alert">{error}</p>}<button>Send invitation</button></form><p role="status">{status}</p></main>}`,
  "disclosure": `import { useState } from "react";export function Challenge(){const[open,setOpen]=useState(false);return <main><h1>Deployment details</h1><button aria-expanded={open} aria-controls="environment" onClick={()=>setOpen(!open)}>Show environment details</button>{open&&<section id="environment" role="region" aria-labelledby="environment-title"><h2 id="environment-title">Environment details</h2><p>Region: us-west-2</p></section>}</main>}`,
  "sortable-table": `import { useState } from "react";const builds=[{id:"B-2",duration:"30 seconds"},{id:"B-1",duration:"10 seconds"},{id:"B-3",duration:"20 seconds"}];export function Challenge(){const[direction,setDirection]=useState("none");const rows=[...builds].sort((a,b)=>direction==="descending"?b.id.localeCompare(a.id):direction==="ascending"?a.id.localeCompare(b.id):0);const sort=()=>setDirection(direction==="ascending"?"descending":"ascending");return <main><h1>Build history</h1><table aria-label="Recent builds"><thead><tr><th scope="col" aria-sort={direction}><button onClick={sort}>Build</button></th><th scope="col">Duration</th></tr></thead><tbody>{rows.map((row)=><tr key={row.id}><td>{row.id}</td><td>{row.duration}</td></tr>)}</tbody></table></main>}`,
  "menu-button": `import { useEffect, useRef, useState } from "react";export function Challenge(){const[open,setOpen]=useState(false);const trigger=useRef(null);const items=useRef([]);useEffect(()=>{if(open)items.current[0]?.focus()},[open]);const close=()=>{setOpen(false);queueMicrotask(()=>trigger.current?.focus())};const keys=(event)=>{const index=items.current.indexOf(document.activeElement);if(event.key==="ArrowDown"){event.preventDefault();items.current[(index+1)%2]?.focus()}if(event.key==="ArrowUp"){event.preventDefault();items.current[(index+1)%2]?.focus()}if(event.key==="Escape")close()};return <main><h1>Project actions</h1><button ref={trigger} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(!open)}>More actions</button>{open&&<div role="menu" aria-label="Project actions menu" onKeyDown={keys}><button role="menuitem" ref={(node)=>items.current[0]=node}>Rename</button><button role="menuitem" ref={(node)=>items.current[1]=node}>Archive</button></div>}</main>}`,
  "live-status": `import { useRef, useState } from "react";export function Challenge(){const[status,setStatus]=useState("");const[pending,setPending]=useState(false);const timer=useRef(null);const sync=()=>{setPending(true);setStatus("Syncing");timer.current=setTimeout(()=>{setStatus("Sync complete");setPending(false)},50)};return <main><h1>Sync status</h1><button disabled={pending} onClick={sync}>Sync now</button><p role="status">{status}</p></main>}`,
  "pagination": `import { useRef, useState } from "react";export function Challenge(){const[page,setPage]=useState(1);const heading=useRef(null);const move=(next)=>{setPage(next);queueMicrotask(()=>heading.current?.focus())};return <main><h1 ref={heading} tabIndex={-1}>Audit events</h1><nav aria-label="Audit pagination"><button disabled={page===1} onClick={()=>move(page-1)}>Previous</button><span>Page {page} of 3</span><button disabled={page===3} onClick={()=>move(page+1)}>Next</button></nav></main>}`,
};

describe("frontend benchmark Docker verifier v2", () => {
  it.each(Object.entries(REFERENCES) as [FrontendBenchmarkCaseId, string][])(
    "proves the %s case is solvable in isolated Chromium",
    async (benchmarkCaseId, implementation) => {
      const lease = createBenchmarkWriteWorkspaceLease(
        resolveProjectRoot().rootPath,
        "packages/core/evals/fixtures/model-roster-frontend-render-v2",
      );
      try {
        await writeFile(join(lease.rootPath, "src", "Challenge.jsx"), `${implementation}\n`, "utf8");
        const result = await verifyFrontendBenchmarkLease({ lease, benchmarkCaseId });
        expect(result.process.stderr).toBe("");
        expect(result).toMatchObject({
          status: "passed",
          benchmarkCaseId,
          violations: [],
          render: {
            benchmarkCaseId,
            accessibility: { engine: "axe-core", version: "4.12.1", violationCount: 0 },
          },
          screenshot: { sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u), bytes: expect.any(Number) },
        });
      } finally {
        lease.cleanup();
      }
    },
    90_000,
  );
});
