# Plan Mode

> Separate planning phase from execution. Best-of-three synthesis from Claude Code, Codex, and Hermes.

## Command

```bash
kiln plan <task>        # Start a planning session
kiln run --plan <task>  # Same, via run flag
```

## 3-Phase Workflow

### Phase 1: Explore (ground in environment)

- Run read-only exploration first — resolve unknowns from repo, not user
- Use `Read`, `glob`, `grep`, `rg` to discover facts
- Identify missing information only after exhausting exploration

### Phase 2: Intent Chat (clarify what they actually want)

- Ask until: goal + success criteria + constraints + scope are locked
- Use `request_user_input` tool for decisions that change the plan
- Bias toward questions over guessing for high-impact ambiguities

### Phase 3: Implementation Chat (design decision-complete solution)

- Explore approach, APIs, edge cases, testing
- Final plan must leave **zero decisions** for implementer

## Execution Boundaries (Enforced)

| Allowed (non-mutating) | Not Allowed (mutating) |
|------------------------|---------------------|
| `Read`, `glob`, `grep`, `rg` | `Edit`, `Write`, `apply_patch` |
| Static analysis, type inspection | Formatters, linters that rewrite |
| Dry-run commands | `Bun`/`npm` commands that mutate |
| Tests to `target/`, `.cache/` | Commits, pushes, external actions |

## Final Output Format

```markdown
<proposed_plan>
## Summary
[concise summary — what and why]

## Implementation Changes
[bullets by subsystem, not file-by-file — 3-5 sections max]

## Test Plan
[verification steps]

## Assumptions
[defaults chosen where ambiguous]
</proposed_plan>
```

## Exit Plan Mode

- User explicitly ends plan mode: "execute this" or "/exec"
- Or stays in plan mode and continues refining

## Integration with CLI Wrapper

Plan mode uses the existing `permissionMode: "plan"` from the CLI wrapper:

```typescript
// In wrapper/session-registry.ts
if (permissionMode === "plan") {
  return { approval: "untrusted", sandbox: "read-only" };
}
```

The orchestrator additionally blocks mutating tool calls at execution time.