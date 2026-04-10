# Tool Execution

## Purpose

Tool execution is the controlled actuator layer for external action.

It must stay separate from:

- tool policy
- coordination logic
- context assembly

These systems interact, but they are not the same concern.

## Execution Sequence

The canonical sequence is:

1. authorization
2. rate-limit evaluation
3. sandbox validation
4. execution
5. result sanitization
6. reinjection or response

## Core Rules

- authorization happens before execution
- destructive actions require explicit approval unless policy says otherwise
- sandbox violations are denied and audited
- results are sanitized before re-entry
- retries and fallbacks are bounded

## Operational Concerns

- timeout handling
- retry strategy
- fallback strategy
- result sanitization
- dangerous command detection
- command and path safety checks

## Current Strength

Tool execution is already operationally strong relative to other areas. The
main architectural need is clearer separation between:

- tool policy
- tool routing
- execution resilience

## Invariants

- deny-by-default authorization
- explicit rate-limit behavior
- explicit timeout behavior
- explicit error classification
- no silent fallback that bypasses safety or policy
