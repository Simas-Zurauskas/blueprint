import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemClock, type Clock } from './core/clock.ts';
import { systemRand, type Rand } from './core/rand.ts';
import { flag, type Args } from './core/args.ts';
import { halt } from './core/errors.ts';
import { currentHome } from './home.ts';

// Everything a command needs from its environment, injected so tests run hermetically (testing §2.1, §2.4).

export interface Ctx {
  /** The skill root: the folder holding SKILL.md, VERSION and bp/. */
  skillRoot: string;
  /** The workspace the command was run in (the folder holding the project's repos and wiki). */
  workspace: string;
  clock: Clock;
  rand: Rand;
  env: Readonly<Record<string, string | undefined>>;
  out: (text: string) => void;
  err: (text: string) => void;
}

export const defaultSkillRoot = (): string => resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function makeCtx(overrides: Partial<Ctx> & Pick<Ctx, 'out' | 'err'>): Ctx {
  return {
    skillRoot: overrides.skillRoot ?? defaultSkillRoot(),
    workspace: overrides.workspace ?? process.cwd(),
    clock: overrides.clock ?? systemClock,
    rand: overrides.rand ?? systemRand,
    env: overrides.env ?? process.env,
    // Document text reaches the terminal: control characters (cursor moves, OSC 52 clipboard writes, OSC 8 links) are
    // shown as visible escapes, never executed. JSON output is already escaped by JSON.stringify.
    out: (t) => overrides.out(printable(t)),
    err: (t) => overrides.err(printable(t)),
  };
}

/** A text with every C0/C1 control character but newline and tab replaced by a visible `\xNN` escape. */
export function printable(t: string): string {
  const bad = (c: number): boolean => (c < 0x20 && c !== 0x0a && c !== 0x09) || (c >= 0x7f && c <= 0x9f);
  let i = 0;
  while (i < t.length && !bad(t.charCodeAt(i))) i++;
  if (i === t.length) return t;
  let out = t.slice(0, i);
  for (; i < t.length; i++) {
    const c = t.charCodeAt(i);
    out += bad(c) ? `\\x${c.toString(16).padStart(2, '0')}` : t[i];
  }
  return out;
}

/**
 * Where the record is for a command: `--home` wins; otherwise targets §5's resolution from `--workspace` (or the
 * context's workspace), reading a pre-v33 location while a write run has yet to move it — the same place pre-flight reads.
 */
export function homeOf(ctx: Ctx, args: Args): string {
  const explicit = flag(args, 'home');
  if (explicit !== undefined) {
    if (!explicit.trim()) throw halt('--home is empty');
    return resolve(ctx.workspace, explicit);
  }
  const ws = flag(args, 'workspace');
  if (ws !== undefined && !ws.trim()) throw halt('--workspace is empty');
  const res = currentHome(ws ? resolve(ctx.workspace, ws) : ctx.workspace);
  if ('ambiguous' in res) throw halt(`several real wikis — ${res.ambiguous.join(', ')}; pass --home`);
  return res.current;
}
