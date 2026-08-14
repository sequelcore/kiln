export function recordAttempt(state, actorId, nowMs, requestId, limit, windowMs) {
  const attempts = state.attempts[actorId] ?? [];
  attempts.push(nowMs);
  state.attempts[actorId] = attempts;
  return { allowed: attempts.length <= limit, remaining: Math.max(0, limit - attempts.length) };
}
