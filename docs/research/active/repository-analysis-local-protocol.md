# Local Reference Workflow Protocol v1

Status: preregistered research integration, 2026-09-05.
Owner: [Repository Analysis Evaluation](repository-analysis.md).
Predecessor: [Durable retrieval results](repository-analysis-durable-results.md).

Connect save/read/check as an opt-in research command. Save uses the existing
project capture and TypeScript adapter, artifact store, reversible service and
context governor. Read verifies the retained canonical hash but always labels
the result historical. Check reopens saved evidence and reruns its exact query
using the owning project configuration. It may label the result current only
if fresh analysis is complete/current and every saved evidence field matches,
excluding elapsed query time and cold/warm cache state. Hash-only integrity is
insufficient. A current verdict applies at the check, not indefinitely.

Use the canonical CLI private project-state resolver and Runtime file store.
Default storage is the private project's `evidence/repository-analysis` directory;
do not create a repository `.kiln` directory or a competing project identity.
Isolated tests supply a temporary Kiln home through the existing resolver seam.

Tests must demonstrate fresh-process save/read/check, unchanged evidence current,
source mutation after an already-dirty save historical, changed configuration
historical, new project source historical, wrong artifact hash unavailable,
incomplete original evidence never current, and retrieval still exact after
source changes. Retain the original artifacts; check must not replace them.

Run a real-package smoke through separate command processes for the previously
frozen resolver query (test file 19:3, owning test tsconfig). Retain the complete
save, check and read outputs plus implementation identities and command exits.
Use temporary XDG configuration storage, removed only after verifying its
resolved root; no operator-private production state is touched by the smoke.
There are no retries or dropped failures. This is developmental integration
evidence, not a controlled efficiency comparison.

Focused tests, scripts typecheck, documentation and whitespace checks are the
gates. No production registration, provider requests, live Gateway admission,
concurrent writer guarantees or crash recovery changes. Conservative invalidation
from unrelated Git-status changes is acceptable; it must not become a false
current verdict. Reanalysis cost remains visible as a limitation.

Commands from a Git repository root:

```sh
bun run research:references:local save packages/operator-appearance/tsconfig.test.json packages/operator-appearance/tests/operator-appearance.test.ts 19 3
bun run research:references:local read <handle> <hash>
bun run research:references:local check <handle> <hash>
```

Keep the handle and hash returned by save. Read success means authentic historical
retrieval under that expected hash; check success means current at that check.
Historical check results and unavailable evidence use exit status 1.
