# Lessons

- When changing runtime-driven provider/model selection, include a startup-path regression for the no-provider-configured command flow. Passing provider-switch tests is not enough if the surface still rejects startup before discovery can run.
- When replacing a provider/model contract, remove transitional flattened helpers and stale exports in the same slice once structured consumers are in place. Do not preserve compatibility aliases unless there is an explicit external contract requirement.
- When a user names a specific skill, do not substitute a similarly named skill. If the named skill is unavailable, state that and proceed with the closest project-native workflow instead of applying an adjacent skill.
- In chat surfaces, transient assistant response state such as thinking, streaming, or tool progress belongs in the transcript near the assistant turn, while durable runtime metadata belongs in an inspector or activity log.
- When diagnosing tool execution from filesystem side effects, do not attribute an existing untracked file to the latest run unless its name, content, timestamp, and requested operation match the reported attempt.
- When a replacement feature has no external consumers yet, do not design migrations, compatibility readers, dual-write paths, or legacy shims. Replace the model cleanly and delete obsolete code in the same slice.
- Memory and lifecycle roadmap work must be framed as surface-neutral core and
  runtime capability. GUI can be the first consumer for practical local testing
  and visual inspection, but plans must explicitly preserve CLI, TUI, YAML app,
  SDK, MCP, IDE, remote-surface, and managed-agent projection paths.
