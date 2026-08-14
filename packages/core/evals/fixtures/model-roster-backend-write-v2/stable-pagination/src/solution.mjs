export function pageAfter(records, afterId, limit) {
  const start = afterId ? records.findIndex((record) => record.id === afterId) + 1 : 0;
  return { items: records.slice(start, start + limit), nextCursor: null };
}
