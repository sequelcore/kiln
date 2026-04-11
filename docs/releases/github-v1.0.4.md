# Kiln 1.0.4

Kiln `1.0.4` fixes timezone-aware cron scheduling.

## Highlights

- Fixed a core scheduler bug affecting named IANA timezones such as
  `America/Tijuana`.
- Preserved existing behavior for schedules without an explicit timezone.
- Added regression coverage so gateway trigger registration no longer depends
  on a workaround.

## Compatibility note

This is a runtime hotfix on top of the existing `1.x` baseline. No config
workaround is required for affected gateway apps after upgrading.

## Verification

- `bun run typecheck`
- `bun run test`
- `bun run build`
