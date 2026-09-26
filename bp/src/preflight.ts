import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { exists, readTextIfExists } from './core/fsx.ts';
import { localDate, type Clock } from './core/clock.ts';
import { SHAPE_REGISTER, type RegisterRoute, type Command } from './domain/vocab.ts';
import { legacyLocations, readTarget, resolveHome, type TargetInfo } from './home.ts';
import { entryState, parseLog } from './log/parse.ts';
import { recordPaths } from './log/entry.ts';

// SKILL.md's six pre-flight checks, as far as code can make them; and resolve.md R1's version classification (its single
// home). Pre-flight 2 (is the target reachable?) and 5 (was this built by the superseded skill — a Board database?) need
// a read of the target and are made when the target is first read, not here.

export interface VersionCheck {
  stamped: number | null;
  current: number;
  relation: 'none' | 'equal' | 'older' | 'newer';
  crossed: { version: number; route: RegisterRoute; note: string }[];
}

/** R1: a register version n is crossed when stamped < n ≤ VERSION. */
export function classifyVersion(stamped: number | null, current: number): VersionCheck {
  if (stamped === null) return { stamped, current, relation: 'none', crossed: [] };
  if (stamped === current) return { stamped, current, relation: 'equal', crossed: [] };
  if (stamped > current) return { stamped, current, relation: 'newer', crossed: [] };
  const crossed = SHAPE_REGISTER.filter((r) => stamped < r.version && r.version <= current).map((r) => ({
    version: r.version,
    route: r.route,
    note: r.note,
  }));
  return { stamped, current, relation: 'older', crossed };
}

export interface Preflight {
  workspace: string;
  /** Where the working folder belongs (targets §5). */
  home: string;
  /** Where the record is now — `home`, or a pre-v33 location a write run has yet to move. */
  current: string;
  homeVia: string;
  homeNote?: string;
  target?: TargetInfo;
  legacyAt: string[];
  concurrent: { runId: string; date: string; time: string; command: string }[];
  version: VersionCheck;
  ignore: { repo: boolean; inForce: boolean | null; detail: string };
  halts: string[];
  notes: string[];
}

/** VERSION of the skill: the single integer in the skill root's VERSION file. */
export function skillVersion(skillRoot: string): number {
  const raw = readTextIfExists(join(skillRoot, 'VERSION'));
  const t = raw?.trim() ?? '';
  if (!/^\d+$/.test(t)) throw new Error(`${join(skillRoot, 'VERSION')} is not a bare integer`);
  return Number(t);
}

function gitIgnoreInForce(home: string): { repo: boolean; inForce: boolean | null; detail: string } {
  try {
    execFileSync('git', ['-C', home, 'rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' });
  } catch {
    return {
      repo: false,
      inForce: null,
      detail: 'not inside a git repository — the record lives on this machine only',
    };
  }
  const ignored = (p: string): boolean => {
    try {
      execFileSync('git', ['-C', home, 'check-ignore', '-q', p], { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  };
  // One path per call — `-q` takes a single pathname (v38). The trailing slash makes git read each as a directory, so a
  // seeded `sources/` pattern matches before the folder exists.
  const missing = ['sources/', 'cache/'].filter((p) => !ignored(p));
  if (missing.length) {
    return {
      repo: true,
      inForce: false,
      detail: `not ignored: ${missing.join(', ')} — the ignore file is not in force, so a commit holds (targets §3)`,
    };
  }
  if (ignored('record/run-log.md')) {
    return {
      repo: true,
      inForce: false,
      detail: 'record/ is ignored too — never ignore the whole folder: record/ is committed (targets §5)',
    };
  }
  return { repo: true, inForce: true, detail: 'sources/ and cache/ are ignored, and record/ is not' };
}

export function preflight(opts: {
  workspace: string;
  skillRoot: string;
  command: Command;
  clock: Clock;
  runId?: string;
  named?: string;
}): Preflight {
  const halts: string[] = [];
  const notes: string[] = [];
  const res = resolveHome(opts.workspace, opts.named);
  if (res.kind === 'ambiguous') {
    return {
      workspace: opts.workspace,
      home: '',
      current: '',
      homeVia: 'ambiguous',
      legacyAt: [],
      concurrent: [],
      version: classifyVersion(null, skillVersion(opts.skillRoot)),
      ignore: { repo: false, inForce: null, detail: '' },
      halts: [
        `several real wikis — ${res.candidates.join(', ')} — never pick between two silently (targets §5); name one`,
      ],
      notes,
    };
  }
  const home = res.home;
  let target = readTarget(home);
  // Where the record is *now*. Until a write run performs the rename route, a pre-v33 folder is still the one every
  // check must read — the concurrent-run check and the version check included.
  let current = home;
  const legacyAt = legacyLocations(opts.workspace, home);
  if (!target && legacyAt[0]) {
    const legacy = legacyAt[0];
    notes.push(
      `the working folder is at its pre-v33 location ${legacy}; ${opts.command === 'status' ? 'status reads it there and a write run will move it' : `this write run moves it to ${home} first (targets §5 rename route)`}`,
    );
    current = legacy;
    target = readTarget(legacy);
  }
  if (!target && opts.command !== 'status' && opts.command !== 'init') {
    halts.push('no target.md — ask the human once where the Blueprint lives, and record it (pre-flight 1)');
  }

  const skill = skillVersion(opts.skillRoot);
  const paths = recordPaths(current);
  const logText = readTextIfExists(paths.log);
  const log = logText === undefined ? null : parseLog(logText);
  const today = localDate(opts.clock.now());
  const concurrent = (log?.entries ?? [])
    .filter((e) => e.heading.date === today && entryState(e) === 'open' && e.heading.runId !== opts.runId)
    .map((e) => ({ runId: e.heading.runId, date: e.heading.date, time: e.heading.time, command: e.heading.command }));
  if (opts.command !== 'status' && concurrent.length) {
    halts.push(
      `another run is in flight: ${concurrent.map((c) => `${c.command} ${c.runId} (opened ${c.date} ${c.time})`).join(', ')} — the target is last-write-wins (pre-flight 4, R1). If it crashed, a human confirms it is dead and writes CLOSED (crashed) under it by hand`,
    );
  }
  const stamped = log?.entries.find((e) => e.heading.version !== null)?.heading.version ?? null;
  const version = classifyVersion(stamped, skill);
  if (version.relation === 'newer') {
    const msg = `the Blueprint was last written by skill v${String(stamped)}, newer than this skill's v${skill} — update the skill, or confirm a lost lineage (R1)`;
    // status reads and reports the mismatch but never reconciles (SKILL.md pre-flight 6); only a write run halts.
    if (opts.command === 'status') notes.push(msg);
    else halts.push(msg);
  }
  for (const c of version.crossed) {
    if (opts.command === 'status') continue;
    if (c.route === 'untouched') notes.push(`crosses v${c.version}: ${c.note} — nothing to do`);
    else notes.push(`crosses v${c.version}: this write run performs the migration — ${c.note}`);
  }
  if (log && logText && !log.entries.length && /\n(?:## |```\n)?\d{4}-\d{2}-\d{2}/.test(logText)) {
    const msg = `${paths.log} holds dated entries bp cannot read — the concurrent-run and version checks cannot be made`;
    if (opts.command === 'status') notes.push(msg);
    else halts.push(msg);
  }
  const newest = log?.entries[0];
  if (newest && newest.heading.version === null && stamped !== null)
    notes.push(`the newest entry carries no skill version; the check read the newest stamped one (v${stamped})`);
  const ignore = exists(current)
    ? gitIgnoreInForce(current)
    : { repo: false, inForce: null, detail: 'the working folder does not exist yet' };
  return {
    workspace: opts.workspace,
    home,
    current,
    homeVia: current === home ? res.via : 'legacy',
    ...(res.note ? { homeNote: res.note } : {}),
    ...(target ? { target } : {}),
    legacyAt,
    concurrent,
    version,
    ignore,
    halts,
    notes,
  };
}
