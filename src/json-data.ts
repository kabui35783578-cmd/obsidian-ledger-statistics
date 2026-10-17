/** Compare plain persisted data: object key order and omitted optional fields
 * are irrelevant; array order and actual values remain significant. */
export function jsonDataEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => jsonDataEqual(value, b[i]));
  }
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter(key => left[key] !== undefined);
  if (keys.length !== Object.keys(right).filter(key => right[key] !== undefined).length) return false;
  return keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && jsonDataEqual(left[key], right[key]));
}
