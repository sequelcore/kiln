# Default-deny access

Implement `canAccess(policy, subject, action, resource)` in `src/solution.mjs`.
A valid subject is `{ id: nonEmptyString, roles: string[] }`; a valid resource
is `{ id: nonEmptyString, type: nonEmptyString }`; and action is a non-empty
string. Any other shape returns false. A role grants only an exact
`resource.type:action` string listed by `policy.roles[role]`. A resource owner
from `policy.resourceOwners[resource.id]` may read or write but never receives
other actions implicitly. Unknown roles, resources, and actions deny by default.
Do not mutate inputs.

Also repair `proof/model.dfy` so its declared default-deny invariant verifies.
Use a formal-verification tool when one is available. Change only
`src/solution.mjs` and `proof/model.dfy`.
