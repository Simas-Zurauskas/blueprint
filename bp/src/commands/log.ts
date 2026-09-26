import { basename } from 'node:path';
import { bool, flag, flagAll, intFlag, oneOfFlag, requireFlag, requireInt, type Args } from '../core/args.ts';
import { localDate, localTime } from '../core/clock.ts';
import { EXIT, usage, type ExitCode } from '../core/errors.ts';
import { readTextIfExists } from '../core/fsx.ts';
import { homeOf, type Ctx } from '../context.ts';
import { canonicalCommand, MODES, STOP_REASONS, WRITE_COMMANDS } from '../domain/vocab.ts';
import {
  admitToken,
  appendLine,
  appendRunsLine,
  findEntry,
  formatLine,
  openEntry,
  recordPaths,
  routeOf,
} from '../log/entry.ts';
import { formatCounts, formatFunnel, formatHashesRollup, parseParts } from '../log/lines.ts';
import { entryState, parseLog } from '../log/parse.ts';
import { validateLog } from '../log/validate.ts';
import { skillVersion } from '../preflight.ts';

// `bp log …` — the run log's only writer from v38 on. Every line's kind is checked against resolve.md R5's closed list
// for the entry's command and routed to the file R5 names; arithmetic lines are composed here.

function loadEntryCommand(home: string, runId: string, sitting?: number) {
  const paths = recordPaths(home);
  const text = readTextIfExists(paths.log);
  if (text === undefined) throw usage(`no run log at ${paths.log}`);
  const log = parseLog(text);
  const entry = findEntry(log, runId, sitting);
  if (!entry) throw usage(`no entry for run ${runId}`);
  const command = entry.heading.command;
  if (!(WRITE_COMMANDS as readonly string[]).includes(command))
    throw usage(`run ${runId}'s entry is a "${command}" entry, not a write command's`);
  return { paths, log, entry, command: command as (typeof WRITE_COMMANDS)[number] }; // membership checked above
}

function write(
  ctx: Ctx,
  home: string,
  runId: string,
  token: string,
  text: string,
  opts: { sitting?: number; reconciliation?: boolean; computed?: boolean } = {},
): string {
  const { paths, command, entry } = loadEntryCommand(home, runId, opts.sitting);
  // `computed` is set only by the subcommands that compose the line themselves (counts, hashes, funnel, close).
  const kind = admitToken(token, command, { computed: opts.computed === true });
  const line = formatLine(token, text);
  const route = routeOf(kind, opts.reconciliation ? { versionReconciliation: true } : {});
  if (route === 'runs') {
    appendRunsLine(paths, runId, `${command} · ${entry.heading.date} · skill v${entry.heading.version ?? '?'}`, line);
  } else {
    appendLine(paths, runId, line, opts.sitting === undefined ? {} : { sitting: opts.sitting });
  }
  ctx.out(`${route === 'runs' ? `record/runs/${runId}.md` : 'record/run-log.md'} ← ${line}`);
  return line;
}

export function logCommand(ctx: Ctx, args: Args): ExitCode {
  const sub = args.positionals[1];
  const home = homeOf(ctx, args);
  const runId = flag(args, 'run');
  const sitting = intFlag(args, 'sitting');
  const sittingOpt = sitting === undefined ? {} : { sitting };
  switch (sub) {
    case 'open': {
      const given = flag(args, 'command');
      if (!given) throw usage('--command is required (init, add, challenge or resolve)');
      const command = WRITE_COMMANDS.find((c) => c === canonicalCommand(given));
      if (!command) throw usage(`--command must be one of ${WRITE_COMMANDS.join(', ')}, got "${given}"`);
      const mode = oneOfFlag(args, 'mode', MODES);
      const extra = flag(args, 'extra');
      const now = ctx.clock.now();
      openEntry(
        recordPaths(home),
        {
          date: localDate(now),
          time: localTime(now),
          command,
          runId: requireFlag(args, 'run'),
          version: skillVersion(ctx.skillRoot),
          sitting: sitting ?? 1,
          ...(mode ? { mode } : {}),
          ...(extra ? { extra } : {}),
        },
        flag(args, 'title') ?? basename(ctx.workspace),
      );
      ctx.out(`opened run ${requireFlag(args, 'run')} sitting ${sitting ?? 1} at ${localDate(now)} ${localTime(now)}`);
      return EXIT.ok;
    }
    case 'add': {
      write(ctx, home, requireFlag(args, 'run'), requireFlag(args, 'kind'), requireFlag(args, 'text'), {
        ...sittingOpt,
        reconciliation: bool(args, 'reconciliation'),
      });
      return EXIT.ok;
    }
    case 'counts': {
      const groups = flagAll(args, 'group').map((g) => {
        const colon = g.indexOf(':');
        if (colon < 0) throw usage(`--group "${g}" is not "label: name=n, name=n"`);
        return { label: g.slice(0, colon).trim(), parts: parseParts(g.slice(colon + 1)) };
      });
      if (!groups.length) throw usage('at least one --group "label: name=n, …" is required');
      write(ctx, home, requireFlag(args, 'run'), 'COUNTS', formatCounts(groups), { ...sittingOpt, computed: true });
      return EXIT.ok;
    }
    case 'hashes': {
      const id = requireFlag(args, 'run');
      const { entry } = loadEntryCommand(home, id, sitting);
      write(ctx, home, id, 'HASHES', formatHashesRollup(entry), { ...sittingOpt, computed: true });
      return EXIT.ok;
    }
    case 'funnel': {
      const text = formatFunnel({
        drafted: requireInt(args, 'drafted'),
        defaults: requireInt(args, 'defaults'),
        fixes: requireInt(args, 'fixes'),
        slots: requireInt(args, 'slots'),
        questions: requireInt(args, 'questions'),
        discarded: requireInt(args, 'discarded'),
      });
      const suffix = flag(args, 'detail');
      write(ctx, home, requireFlag(args, 'run'), 'funnel', suffix ? `${text} · ${suffix}` : text, {
        ...sittingOpt,
        computed: true,
      });
      return EXIT.ok;
    }
    case 'close': {
      const state = oneOfFlag(args, 'state', ['CLOSED', 'PAUSED'] as const) ?? 'CLOSED';
      const reason = oneOfFlag(args, 'reason', STOP_REASONS);
      if (state === 'CLOSED' && !reason)
        throw usage(`a CLOSED line names its stop reason: --reason ${STOP_REASONS.join('|')} (R5)`);
      if (state === 'PAUSED' && reason)
        throw usage("a PAUSED line names no stop reason — only the last sitting's CLOSED line carries one (R5)");
      const detail = flag(args, 'text');
      const time = localTime(ctx.clock.now());
      const text = [state === 'CLOSED' ? `CLOSED ${time}` : `PAUSED ${time}`, reason, detail]
        .filter(Boolean)
        .join(' · ');
      write(ctx, home, requireFlag(args, 'run'), 'closing', text, { ...sittingOpt, computed: true });
      return EXIT.ok;
    }
    case 'state': {
      const text = readTextIfExists(recordPaths(home).log);
      if (text === undefined) {
        ctx.out(bool(args, 'json') ? JSON.stringify({ entries: [] }) : 'no run log yet');
        return EXIT.ok;
      }
      const log = parseLog(text);
      const today = localDate(ctx.clock.now());
      const rows = log.entries
        .filter((e) => !bool(args, 'today') || e.heading.date === today)
        .map((e) => ({ ...e.heading, state: entryState(e), lines: e.lines.length }));
      if (bool(args, 'json')) ctx.out(JSON.stringify({ entries: rows }, null, 2));
      else
        rows.forEach((r) =>
          ctx.out(
            `${r.date} ${r.time} · ${r.command} · run ${r.runId} · v${r.version ?? '?'} · sitting ${r.sitting ?? '?'} · ${r.state} · ${r.lines} lines`,
          ),
        );
      return EXIT.ok;
    }
    case 'validate': {
      const text = readTextIfExists(recordPaths(home).log);
      if (text === undefined) throw usage('no run log to validate');
      const findings = validateLog(parseLog(text), runId ? { runId } : {});
      const errors = findings.filter((f) => f.severity === 'error');
      const shown = bool(args, 'all') ? findings : errors;
      if (bool(args, 'json'))
        ctx.out(
          JSON.stringify({ errors: errors.length, legacy: findings.length - errors.length, findings: shown }, null, 2),
        );
      else {
        shown.forEach((f) => ctx.out(`${f.severity === 'error' ? 'x' : '~'} run ${f.runId} l.${f.line}: ${f.message}`));
        ctx.out(
          `${errors.length} error(s)${findings.length - errors.length ? `, ${findings.length - errors.length} legacy finding(s) (skill < 38; --all shows them)` : ''}`,
        );
      }
      return errors.length ? EXIT.findings : EXIT.ok;
    }
    default:
      throw usage(`unknown "bp log ${sub ?? ''}"`, 'open | add | counts | hashes | funnel | close | state | validate');
  }
}
