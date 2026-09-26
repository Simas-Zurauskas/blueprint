// The one runtime-validation mechanism in bp (type-safety §5). Every trust boundary — CLI args, JSON files, transcript
// lines, connector results, model task results — is parsed by a schema built here, and the static type is derived from
// the schema with `Infer`, so the two cannot drift. In-house rather than a library because bp has no runtime
// dependencies (DESIGN.md C1).

export type Issue = { path: string; message: string };
export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

export interface Schema<T> {
  readonly kind: string;
  parse(input: unknown, path?: string): ParseResult<T>;
  /** A JSON Schema rendering, handed to model tasks so the subagent sees the exact shape it must return. */
  json(): Record<string, unknown>;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value });
const fail = (path: string, message: string): ParseResult<never> => ({ ok: false, issues: [{ path, message }] });
const describe = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function string(opts: { min?: number; max?: number; pattern?: RegExp } = {}): Schema<string> {
  return {
    kind: 'string',
    parse(input, path = '$') {
      if (typeof input !== 'string') return fail(path, `expected string, got ${describe(input)}`);
      if (opts.min !== undefined && input.length < opts.min) return fail(path, `shorter than ${opts.min}`);
      if (opts.max !== undefined && input.length > opts.max) return fail(path, `longer than ${opts.max}`);
      if (opts.pattern) {
        // A /g or /y regex keeps lastIndex between calls; reset it so the verdict never depends on the previous parse.
        opts.pattern.lastIndex = 0;
        if (!opts.pattern.test(input)) return fail(path, `does not match ${String(opts.pattern)}`);
      }
      return ok(input);
    },
    json() {
      return {
        type: 'string',
        ...(opts.min !== undefined ? { minLength: opts.min } : {}),
        ...(opts.max !== undefined ? { maxLength: opts.max } : {}),
        ...(opts.pattern ? { pattern: opts.pattern.source } : {}),
      };
    },
  };
}

export function integer(opts: { min?: number; max?: number } = {}): Schema<number> {
  return {
    kind: 'integer',
    parse(input, path = '$') {
      if (typeof input !== 'number' || !Number.isInteger(input))
        return fail(path, `expected integer, got ${describe(input)}`);
      if (opts.min !== undefined && input < opts.min) return fail(path, `below ${opts.min}`);
      if (opts.max !== undefined && input > opts.max) return fail(path, `above ${opts.max}`);
      return ok(input);
    },
    json() {
      return {
        type: 'integer',
        ...(opts.min !== undefined ? { minimum: opts.min } : {}),
        ...(opts.max !== undefined ? { maximum: opts.max } : {}),
      };
    },
  };
}

export function boolean(): Schema<boolean> {
  return {
    kind: 'boolean',
    parse: (input, path = '$') =>
      typeof input === 'boolean' ? ok(input) : fail(path, `expected boolean, got ${describe(input)}`),
    json: () => ({ type: 'boolean' }),
  };
}

/** A closed set of string members, written once as an `as const` array (type-safety §6). */
export function oneOf<const T extends readonly string[]>(members: T): Schema<T[number]> {
  const set = new Set<string>(members);
  return {
    kind: 'enum',
    parse(input, path = '$') {
      if (typeof input === 'string' && set.has(input)) return ok(input as T[number]); // membership proven by the Set
      return fail(
        path,
        `expected one of ${members.map((m) => JSON.stringify(m)).join(', ')}, got ${JSON.stringify(input)}`,
      );
    },
    json: () => ({ type: 'string', enum: [...members] }),
  };
}

export function literal<const T extends string | number | boolean>(value: T): Schema<T> {
  return {
    kind: 'literal',
    parse: (input, path = '$') => (input === value ? ok(value) : fail(path, `expected ${JSON.stringify(value)}`)),
    json: () => ({ const: value }),
  };
}

export function nullable<T>(inner: Schema<T>): Schema<T | null> {
  return {
    kind: 'nullable',
    parse: (input, path = '$') => (input === null ? ok(null) : inner.parse(input, path)),
    json: () => ({ anyOf: [inner.json(), { type: 'null' }] }),
  };
}

export function array<T>(item: Schema<T>, opts: { min?: number; max?: number } = {}): Schema<T[]> {
  return {
    kind: 'array',
    parse(input, path = '$') {
      if (!Array.isArray(input)) return fail(path, `expected array, got ${describe(input)}`);
      if (opts.min !== undefined && input.length < opts.min) return fail(path, `fewer than ${opts.min} items`);
      if (opts.max !== undefined && input.length > opts.max) return fail(path, `more than ${opts.max} items`);
      const out: T[] = [];
      const issues: Issue[] = [];
      input.forEach((v: unknown, i) => {
        const r = item.parse(v, `${path}[${i}]`);
        if (r.ok) out.push(r.value);
        else issues.push(...r.issues);
      });
      return issues.length ? { ok: false, issues } : ok(out);
    },
    json: () => ({
      type: 'array',
      items: item.json(),
      ...(opts.min !== undefined ? { minItems: opts.min } : {}),
      ...(opts.max !== undefined ? { maxItems: opts.max } : {}),
    }),
  };
}

export function record<T>(value: Schema<T>): Schema<Record<string, T>> {
  return {
    kind: 'record',
    parse(input, path = '$') {
      if (!isRecord(input)) return fail(path, `expected object, got ${describe(input)}`);
      const out: Record<string, T> = {};
      const issues: Issue[] = [];
      for (const [k, v] of Object.entries(input)) {
        const r = value.parse(v, `${path}.${k}`);
        // defineProperty, not assignment: a key spelled `__proto__` must stay an ordinary entry.
        if (r.ok)
          Object.defineProperty(out, k, { value: r.value, enumerable: true, writable: true, configurable: true });
        else issues.push(...r.issues);
      }
      return issues.length ? { ok: false, issues } : ok(out);
    },
    json: () => ({ type: 'object', additionalProperties: value.json() }),
  };
}

// An optional field is marked by wrapping its schema; the object builder leaves it out of `required` and out of the
// output when absent (exactOptionalPropertyTypes: absent is not the same as undefined).
export interface Optional<T> {
  readonly optional: true;
  readonly inner: Schema<T>;
}
export const optional = <T>(inner: Schema<T>): Optional<T> => ({ optional: true, inner });

type Shape = Record<string, Schema<unknown> | Optional<unknown>>;
type RequiredKeys<S extends Shape> = { [K in keyof S]: S[K] extends Optional<unknown> ? never : K }[keyof S];
type OptionalKeys<S extends Shape> = { [K in keyof S]: S[K] extends Optional<unknown> ? K : never }[keyof S];
type FieldType<F> = F extends Optional<infer T> ? T : F extends Schema<infer T> ? T : never;
export type ObjectOf<S extends Shape> = { [K in RequiredKeys<S>]: FieldType<S[K]> } & {
  [K in OptionalKeys<S>]?: FieldType<S[K]>;
} extends infer O
  ? { [K in keyof O]: O[K] }
  : never;

const isOptional = (f: Schema<unknown> | Optional<unknown>): f is Optional<unknown> => 'optional' in f;

/** A closed object: unknown keys are an issue, because a field nobody defined is unaudited (doc-shape §6). */
export function object<S extends Shape>(shape: S, opts: { passthrough?: boolean } = {}): Schema<ObjectOf<S>> {
  return {
    kind: 'object',
    parse(input, path = '$') {
      if (!isRecord(input)) return fail(path, `expected object, got ${describe(input)}`);
      const out: Record<string, unknown> = {};
      const issues: Issue[] = [];
      for (const [key, field] of Object.entries(shape)) {
        const present = Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
        if (!present) {
          if (!isOptional(field)) issues.push({ path: `${path}.${key}`, message: 'required' });
          continue;
        }
        const r = (isOptional(field) ? field.inner : field).parse(input[key], `${path}.${key}`);
        if (r.ok) out[key] = r.value;
        else issues.push(...r.issues);
      }
      if (!opts.passthrough) {
        for (const key of Object.keys(input)) {
          if (!Object.hasOwn(shape, key)) issues.push({ path: `${path}.${key}`, message: 'unknown field' });
        }
      }
      // The loop above checked every declared key against its schema, so the assembled record has the declared shape.
      return issues.length ? { ok: false, issues } : ok(out as ObjectOf<S>);
    },
    json() {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, field] of Object.entries(shape)) {
        properties[key] = (isOptional(field) ? field.inner : field).json();
        if (!isOptional(field)) required.push(key);
      }
      return { type: 'object', properties, required, additionalProperties: opts.passthrough === true };
    },
  };
}

/** A tagged union, discriminated on one string field. */
export function tagged<const K extends string, V extends Record<string, Schema<Record<string, unknown>>>>(
  key: K,
  variants: V,
): Schema<{ [T in keyof V]: Infer<V[T]> }[keyof V]> {
  type Out = { [T in keyof V]: Infer<V[T]> }[keyof V];
  return {
    kind: 'tagged',
    parse(input, path = '$') {
      if (!isRecord(input)) return fail(path, `expected object, got ${describe(input)}`);
      const tag = input[key];
      if (typeof tag !== 'string' || !Object.prototype.hasOwnProperty.call(variants, tag)) {
        return fail(
          `${path}.${key}`,
          `expected one of ${Object.keys(variants).join(', ')}, got ${JSON.stringify(tag)}`,
        );
      }
      const variant = variants[tag];
      if (!variant) return fail(`${path}.${key}`, 'unknown variant');
      // The variant schema validated the whole object, including its tag, so it is that member of the union.
      return variant.parse(input, path) as ParseResult<Out>;
    },
    json: () => ({ oneOf: Object.values(variants).map((v) => v.json()) }),
  };
}

export function formatIssues(issues: readonly Issue[]): string {
  return issues.map((i) => `${i.path}: ${i.message}`).join('\n');
}

/** Parse or throw a BoundaryError carrying every issue — for boundaries where a bad input is a halt, not a finding. */
export function must<T>(schema: Schema<T>, input: unknown, what: string): T {
  const r = schema.parse(input);
  if (r.ok) return r.value;
  throw new BoundaryError(`${what} is malformed:\n${formatIssues(r.issues)}`, r.issues);
}

export class BoundaryError extends Error {
  readonly issues: readonly Issue[];
  constructor(message: string, issues: readonly Issue[]) {
    super(message);
    this.name = 'BoundaryError';
    this.issues = issues;
  }
}

export function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new BoundaryError(`${what} is not JSON: ${err instanceof Error ? err.message : String(err)}`, [
      { path: '$', message: 'not JSON' },
    ]);
  }
}
