import type { SpecObject } from './types';

/** JSON pointer lookup ("#/components/schemas/Charge"); undefined when it doesn't exist. */
export function lookupPointer(spec: SpecObject, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  const parts = ref
    .slice(2)
    .split('/')
    .map((p) => decodeURIComponent(p).replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = spec;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as SpecObject)[part];
  }
  return current;
}

/**
 * Follows local $ref chains. A chain that comes back to a ref it already followed
 * (A → B → A) stops instead of looping; external refs are left as they are.
 */
export function resolveRef<T = unknown>(spec: SpecObject, value: T): T {
  let current: unknown = value;
  const seen = new Set<string>();
  while (current && typeof current === 'object' && typeof (current as SpecObject).$ref === 'string') {
    const ref = (current as SpecObject).$ref as string;
    if (seen.has(ref)) break;
    seen.add(ref);
    const target = lookupPointer(spec, ref);
    if (target === undefined) break;
    current = target;
  }
  return current as T;
}

/** The name a $ref points to ("#/components/schemas/Charge" → "Charge"). */
export function refName(value: unknown): string | undefined {
  const ref = value && typeof value === 'object' ? (value as SpecObject).$ref : undefined;
  return typeof ref === 'string' ? ref.split('/').pop() : undefined;
}
