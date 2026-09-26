import { usage } from './errors.ts';

// CLI arguments are a trust boundary (type-safety §5): parsed once into this shape, then read through typed accessors
// that fail with a usage error naming the flag.

export interface Args {
  positionals: string[];
  flags: Map<string, string[]>;
  bools: Set<string>;
}

/** Flags that never take a value. Everything else after `--name` takes the next token (or `--name=value`). */
const BOOLEAN_FLAGS = new Set([
  'json',
  'stdin',
  'full',
  'soft',
  'force',
  'reconciliation',
  'all',
  'today',
  'dry-run',
  'help',
  'deep',
  'strict',
  'fresh',
  'provenance',
  'no-second-dispatch',
]);

export function parseArgs(argv: readonly string[]): Args {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
      if (!name) throw usage(`malformed flag "${a}"`);
      if (BOOLEAN_FLAGS.has(name)) {
        if (eq >= 0) throw usage(`--${name} takes no value`);
        bools.add(name);
        continue;
      }
      let value: string | undefined;
      if (eq >= 0) value = a.slice(eq + 1);
      else {
        value = argv[i + 1];
        i += 1;
      }
      if (value === undefined) throw usage(`--${name} needs a value`);
      flags.set(name, [...(flags.get(name) ?? []), value]);
      continue;
    }
    positionals.push(a);
  }
  return { positionals, flags, bools };
}

export const flag = (a: Args, name: string): string | undefined => {
  const v = a.flags.get(name);
  if (v && v.length > 1) throw usage(`--${name} was given ${v.length} times; it takes one value`);
  return v?.[0];
};

export const flagAll = (a: Args, name: string): string[] => a.flags.get(name) ?? [];

export const requireFlag = (a: Args, name: string, hint?: string): string => {
  const v = flag(a, name);
  if (v === undefined || v === '') throw usage(`--${name} is required`, hint);
  return v;
};

export const intFlag = (a: Args, name: string): number | undefined => {
  const v = flag(a, name);
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v)) throw usage(`--${name} must be a non-negative integer, got "${v}"`);
  return Number(v);
};

export const requireInt = (a: Args, name: string): number => {
  const v = intFlag(a, name);
  if (v === undefined) throw usage(`--${name} is required`);
  return v;
};

export const bool = (a: Args, name: string): boolean => a.bools.has(name);

export function oneOfFlag<const T extends readonly string[]>(a: Args, name: string, allowed: T): T[number] | undefined {
  const v = flag(a, name);
  if (v === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(v))
    throw usage(`--${name} must be one of ${allowed.join(', ')}, got "${v}"`);
  return v;
}
