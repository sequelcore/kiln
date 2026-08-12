# Model Gateway Operations

Model Gateway is the user-scoped loopback ingress for virtual models configured
in `~/.kiln/config.yaml`. Its principals expose OpenAI Responses or Anthropic
Messages while Runtime remains the only account, credential, capacity, and
dispatch authority.

## Prerequisites

- Global config is V2 and declares `executionCatalog`, `executionRouting`, and
  `modelGateway`.
- Every replay and principal `*Env` reference exists in the user environment
  available to supervised processes. Secret values never belong in YAML,
  command output, issue evidence, or scheduled-task arguments.
- Each virtual model references one canonical `executionRouteId`.

Validate without printing secrets:

```powershell
kiln model-gateway doctor --json
```

`ready` is valid only when the listener identity, PID, version, port, and config
digest match owned state and `diagnostics` is empty.

## Lifecycle

```powershell
kiln model-gateway start
kiln model-gateway status
kiln model-gateway restart
kiln model-gateway stop
```

`start` is idempotent. `restart` first waits for graceful resource settlement
and process exit, then launches the replacement. Every mutating command refuses
a foreign listener or stale state whose PID is still alive.

## Windows Autostart And Recovery

```powershell
kiln model-gateway install-autostart
kiln model-gateway autostart-status
```

The installed current-user task starts `model-gateway ensure` at logon, runs at
least privilege, ignores duplicate starts, and has no scheduler execution time
limit. Run `install-autostart` again after changing the installed CLI entrypoint
or version; the ownership digest makes this an exact update. Then run:

```powershell
kiln model-gateway restart
kiln model-gateway doctor --json
```

Recovery proof consists of stopping the service, running the owned task (or
logging into a fresh operator session), and observing `ready` with the expected
version and config digest.

## Exact Uninstall

```powershell
kiln model-gateway uninstall
```

This command preflights ownership, stops only the exact owned listener, removes
the owned scheduled task, and deletes only `~/.kiln/runtime/model-gateway`.
It refuses foreign task or listener state. It does not modify global config,
provider credentials, harness-native configuration, or other Kiln runtime
directories.

To remove only automatic startup while leaving the service and runtime evidence
available, use `kiln model-gateway uninstall-autostart`.
