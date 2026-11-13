/** Plain-object helpers. Pure. */

export type PlainObject = Record<string, unknown>;

/** A plain object: not null, not an array. */
export const isObject = (v: unknown): v is PlainObject =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** `obj` as dotted keys to its leaves (arrays are leaves), under `prefix`. */
export function flatten(obj: PlainObject, prefix = ''): PlainObject {
  const out: PlainObject = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isObject(value)) Object.assign(out, flatten(value, path));
    else out[path] = value;
  }
  return out;
}

/** Deep merge of `over` into a copy of `base` (objects merge, the rest replaces). */
export function deepMerge(base: PlainObject, over: PlainObject): PlainObject {
  const out: PlainObject = { ...base };
  for (const [key, value] of Object.entries(over))
    out[key] = isObject(value) && isObject(out[key]) ? deepMerge(out[key], value) : value;
  return out;
}
