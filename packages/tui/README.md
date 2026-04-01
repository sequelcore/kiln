# @kilnai/tui

Terminal interface adapter foundation for Kiln.

This package is intentionally minimal at Phase 7 foundation time.
It exists to provide a clean package boundary for terminal presentation
without introducing business logic, orchestration rules, or duplicated
session models.

Non-goals for this package:

- provider selection
- permission translation
- session persistence
- orchestration state machine logic
- backend-specific execution logic

Those responsibilities stay in `@kilnai/core`, `@kilnai/runtime`, and
`@kilnai/cli`.
