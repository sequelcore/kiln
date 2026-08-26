type AccessDecision = "allow" | "deny";

//@ ensures \result === "allow" ==> (authenticated && canRead)
//@ ensures (authenticated && canRead) ==> \result === "allow"
export function accessPolicy(authenticated: boolean, canRead: boolean): AccessDecision {
  if (authenticated && canRead) return "allow";
  return "deny";
}
