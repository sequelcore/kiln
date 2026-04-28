# Lessons

- When changing runtime-driven provider/model selection, include a startup-path regression for the no-provider-configured command flow. Passing provider-switch tests is not enough if the surface still rejects startup before discovery can run.
- When replacing a provider/model contract, remove transitional flattened helpers and stale exports in the same slice once structured consumers are in place. Do not preserve compatibility aliases unless there is an explicit external contract requirement.
