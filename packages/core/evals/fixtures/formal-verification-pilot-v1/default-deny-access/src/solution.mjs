export function canAccess(policy, subject) {
  return Boolean(subject?.roles?.length);
}
