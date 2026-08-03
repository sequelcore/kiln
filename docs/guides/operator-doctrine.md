# Operator Doctrine

Use this guide to configure how Kiln should behave for an operator, team, or
project without turning one prompt file into the source of truth.

Kiln separates operator behavior into five contracts:

| Contract | Owns | Canonical location |
|---|---|---|
| Identity | Operator metadata such as name and timezone. | `~/.kiln/config.yaml#identity` |
| Instruction profiles | Durable standards, style, workflow, and review doctrine. | `~/.kiln/instructions/*.md`, `.kiln/instructions/*.md` |
| Work governance | Direct-vs-orchestrated posture and evidence expectations. | `workGovernance` in global or project config |
| Agent profiles | Executable roles and default profile-specific skills. | `~/.kiln/agents/*.md`, `.kiln/agents/*.md` |
| Skills | Reusable procedures and task-specific context. | `~/.kiln/skills/**`, `.kiln/skills/**`, built-ins |

Do not put durable doctrine directly in `AGENTS.md`, `CLAUDE.md`, native Codex
files, or OpenCode files. Those are projections. Edit Kiln config and
instruction profiles, then run `kiln sync` when native harnesses need updates.

## Fast Setup

Set global operator identity and activate your standards profile:

```bash
kiln config set --global identity.name Ricardo
kiln config set --global identity.timezone America/Tijuana
kiln config set --global activeInstructionProfiles sequel-engineering
```

Create or edit the profile at `~/.kiln/instructions/sequel-engineering.md`:

```markdown
---
name: sequel-engineering
displayName: Sequel Engineering
description: Engineering standards, workflow, and quality doctrine.
tags:
  - engineering
doctrine:
  principles:
    - No dead code.
    - No redundancy.
    - No legacy compatibility hacks without real consumers.
    - Respect DDD and Clean Architecture boundaries.
  workflow:
    - Scout before broad or architecture-sensitive changes.
    - Plan when work crosses contracts or bounded contexts.
    - Use TDD for behavior changes when practical.
  qualityGates:
    - Run focused checks before broad gates.
    - Verify before claiming complete.
  reviewPosture:
    - Findings before summaries.
    - Treat missing tests, hidden coupling, unclear authority, and boundary drift as real risks.
  delegation:
    - Use configured specialist profiles for architecture, TDD, implementation, and review.
---

Use direct, pragmatic engineering communication. Keep changes atomic, tested,
and aligned with repository architecture.
```

Set the global work posture:

```bash
kiln config set --global workGovernance.defaultPosture orchestrate
kiln config set --global workGovernance.directExecution.maxFiles 1
kiln config set --global workGovernance.directExecution.maxRisk low
kiln config set --global workGovernance.requireDelegationFor architecture,security,ui,runtime,provider-routing,managed-agents,config,multi-file,cross-surface,long-running,verification-heavy,formal-proof-candidate
kiln config set --global workGovernance.requiredEvidence surface-map,risk-hypothesis,plan,tests,typecheck,residual-risk
```

Enable task-aware skill admission when you want selected model/task
recommendations to become governed context automatically:

```bash
kiln config set --global skills.selection.mode auto
```

## Project Overrides

Use project config only for behavior that belongs to the repository. Project
values override global values for that repo:

```bash
kiln config set activeInstructionProfiles sequel-engineering,kiln-project
kiln config set workGovernance.defaultPosture orchestrate
kiln config set workGovernance.directExecution.maxFiles 1
kiln config set workGovernance.directExecution.maxRisk low
kiln config set skills.selection.mode advisory
```

Project-specific doctrine belongs in `.kiln/instructions/<profile>.md`.
Personal habits, language preferences, and private standards belong in
`~/.kiln/instructions/<profile>.md`.

## Verification

Inspect what Kiln resolved:

```bash
kiln config read effective
kiln config read setup
kiln config read projections
```

After changing profiles, agents, skills, or projection-relevant config, run:

```bash
kiln sync --all --dry-run
kiln sync --all
```

The expected result is one source of truth:

- global operator doctrine in `~/.kiln/config.yaml` and `~/.kiln/instructions`
- repo doctrine in `.kiln/kiln.yaml` and `.kiln/instructions`
- generated shims and native harness files as projections only
