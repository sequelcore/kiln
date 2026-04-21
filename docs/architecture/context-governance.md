# Context Governance

## Purpose

Context governance controls what enters the model context window, in what
order, under what budget, and with what policy.

This is not formatting. It is a control function.

## Canonical Owner

`ContextGovernor` is the intended owner of context assembly.

Current runtime stop point:

- admitted-turn runtime context assembly already converges on explicit
  runtime-owned seams for context projection, turn system-prompt assembly, and
  runtime continuity presentation
- the remaining architectural question is whether a shared cross-package
  governance contract is worth introducing later
- runtime bypass is no longer the problem; hidden secondary policy owners are
  the problem

Context policy should not remain fragmented across:

- prompt builders
- formatters
- loaders
- session managers
- orchestration helpers
- route handlers
- transport gateways

## Inputs

- current session state
- episodic memory
- semantic knowledge
- skill and procedural context
- complexity signals
- token budget
- operational mode

## Core Duties

- allocate the turn budget
- rank context blocks by salience
- merge blocks in governed order
- enforce truncation and compression rules
- preserve safety-critical context

## Attention And Salience

The context window is an attentional bottleneck.

Important consequences:

- complexity should influence budget allocation
- context ranking should consider relevance, recency, and task utility
- retrieval and context injection should not be separate ungoverned decisions

The control-plane version of attention is explicit budget allocation and ranked
selection, not implicit LLM luck.

## Budget Policy

- context is budgeted, not best-effort
- overflow should trigger truncation or summary by rule
- safety-critical context is protected from arbitrary truncation
- lower-priority layers should be reduced before higher-priority control data

## Current Problems

- no literal single cross-package owner is implemented end to end yet
- context decisions are still spread across some legacy seams
- complexity scoring does not fully govern context allocation
- tool and knowledge relevance are not yet unified under one bottleneck owner

## Target Design

The target design is:

- one `ContextGovernor`
- one explicit per-turn `ContextBudget`
- one ranking policy
- one truncation policy
- one audit trail for context assembly decisions

## Boundary Rules

- ingress and route layers may normalize input, but they must not own lasting
  turn context assembly after admission
- session managers may surface continuity artifacts, but they must not become a
  second context-policy center
- runtime support seams should emit context and continuity presentation from
  dedicated owners, not from local helper formatting

## Invariants

- assembled context never exceeds budget
- truncation follows declared order
- memory sparsity or retrieval failure is explicit
- context policy is not hidden in helper utilities
