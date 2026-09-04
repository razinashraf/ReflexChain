/**
 * Deterministic JSON serialization.
 *
 * Every hash and every signature in REFLEXCHAIN is computed over the output of
 * this function. If two nodes serialized the same object differently they
 * would derive different hashes and the network would fork for no reason, so
 * key order is sorted and undefined values are dropped rather than left to
 * JSON.stringify's insertion-order behaviour.
 */
export function canonicalJSON(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null) return 'null';

  const t = typeof value;

  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new TypeError('canonicalJSON: non-finite number is not serializable');
    }
    return JSON.stringify(value);
  }

  if (t === 'string' || t === 'boolean') return JSON.stringify(value);
  if (t === 'bigint') return JSON.stringify((value as bigint).toString());

  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalJSON(v)).join(',') + ']';
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      if (v === undefined) continue; // omit rather than emit null
      parts.push(JSON.stringify(key) + ':' + canonicalJSON(v));
    }
    return '{' + parts.join(',') + '}';
  }

  throw new TypeError(`canonicalJSON: unsupported type ${t}`);
}
