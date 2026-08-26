# Synthetic Formal Screening Example

```json
{
  "version": "private-formal-screening-v1",
  "cases": [{
    "id": "synthetic-pair-1-control",
    "pairId": "synthetic-pair-1",
    "arm": "C0",
    "candidateRoot": "cases/control",
    "hiddenTestRoot": "hidden/control",
    "allowedChangedPaths": ["src/solution.ts"]
  }]
}
```

Digests and test counts are omitted here intentionally; a real private package
must provide every field required by the canonical loader and bind them to its
actual bytes.
