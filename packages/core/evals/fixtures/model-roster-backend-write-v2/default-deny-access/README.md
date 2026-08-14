# Default-deny access

Implement `canAccess(policy, subject, action, resource)` in `src/solution.mjs`.
A valid subject is `{ id: nonEmptyString, roles: string[] }`; a valid resource
is `{ id: nonEmptyString, type: nonEmptyString }`; and action is a non-empty
string. Any other shape returns false. A role grants only an exact
`resource.type:action` string listed by `policy.roles[role]`. A resource owner
from `policy.resourceOwners[resource.id]` may read or write but never receives
other actions implicitly. Unknown roles, resources, and actions deny by default.
Do not mutate inputs. Change only the implementation file.
