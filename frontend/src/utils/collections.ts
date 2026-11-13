export function groupBy<T>(items: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const it of items) (out[key(it)] ??= []).push(it)
  return out
}
