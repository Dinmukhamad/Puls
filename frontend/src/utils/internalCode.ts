/** Stable internal identifiers are generated once when a creation form opens. */
export function createInternalCode(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}
