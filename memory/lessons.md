# Lessons

- Do not add singleton-to-pool migration paths unless real external consumers
  or user data require them. For single-operator/internal-only features, prefer
  a clean canonical storage shape and let the operator relink credentials.
- Do not document or reference a migration command unless the repo has a real
  current producer/consumer pair that requires it. Historical internal config
  shapes alone are not enough; fail fast and point to the canonical contract.
- For Kiln roadmap work, do not frame foundational professional features as
  "MVP" plans. Use foundation, first production increment, and long-term
  expansion language so the plan respects Kiln's control-plane thesis and
  Sequel engineering standards.
