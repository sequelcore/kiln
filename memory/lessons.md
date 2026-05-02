# Lessons

- Do not add singleton-to-pool migration paths unless real external consumers
  or user data require them. For single-operator/internal-only features, prefer
  a clean canonical storage shape and let the operator relink credentials.
