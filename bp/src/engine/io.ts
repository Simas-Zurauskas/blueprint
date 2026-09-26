import { join } from 'node:path';
import { bool, type Args } from '../core/args.ts';
import { listDir, readTextIfExists } from '../core/fsx.ts';
import type { Ctx } from '../context.ts';
import type { WriteCommand } from '../domain/vocab.ts';
import { admitToken, appendLine, appendRunsLine, formatLine, recordPaths, routeOf } from '../log/entry.ts';
import type { Owed } from './state.ts';

// What every engine command shares at its edges: the run log's routing (R5), the barred terms captured at source time, and
// the one shape a run's owed work is printed in — connector calls, subagent prompts, what it is still waiting on.

/** One log line, routed as R5 routes its kind: the log, or record/runs/<run-id>.md. */
export function logLine(home: string, command: WriteCommand, runId: string, kind: string, text: string): void {
  const paths = recordPaths(home);
  const k = admitToken(kind, command, { computed: true });
  const line = formatLine(kind, text);
  if (routeOf(k, { versionReconciliation: false }) === 'runs')
    appendRunsLine(paths, runId, `${command} · run ${runId}`, line);
  else appendLine(paths, runId, line);
}

/** Terms the content rule bars, recorded per run at source capture (`sources/<run>/barred-terms.json`). */
export function barredTerms(home: string): string[] {
  const out: string[] = [];
  for (const run of listDir(join(home, 'sources'))) {
    const raw = readTextIfExists(join(home, 'sources', run, 'barred-terms.json'));
    if (!raw) continue;
    try {
      const v: unknown = JSON.parse(raw);
      if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === 'string'));
    } catch {
      // unreadable: the sweep still runs its other classes
    }
  }
  return out;
}

/** Print what a run is owed — or its JSON — and how to continue. */
export function printOwed(
  ctx: Ctx,
  args: Args,
  o: { owed: Owed; command: string; header: string; stage: string; run: string; preface?: string[] },
): void {
  if (bool(args, 'json')) {
    ctx.out(
      JSON.stringify(
        {
          status: 'waiting',
          run: o.run,
          stage: o.stage,
          ...(o.preface?.length ? { printed: o.preface } : {}),
          tasks: o.owed.tasks.map((t) => ({ id: t.id, kind: t.kind, prompt: t.prompt })),
          calls: o.owed.calls,
          waiting: o.owed.waiting,
        },
        null,
        2,
      ),
    );
    return;
  }
  const out: string[] = [...(o.preface?.length ? [...o.preface, ''] : []), o.header];
  if (o.owed.calls.length) {
    out.push(
      '',
      `CALLS — make these ${o.owed.calls.length} Notion connector call(s), at most 3 in flight, each input exactly as written:`,
    );
    o.owed.calls.forEach((c, i) => out.push(`  ${i + 1}. ${c.tool}  ${JSON.stringify(c.input)}`));
  }
  if (o.owed.tasks.length) {
    out.push(
      '',
      `DISPATCH — ${o.owed.tasks.length} task(s). Give each prompt, verbatim, to its own subagent (the Agent tool), in parallel; a checker on a different model from the writer where you can (SKILL.md rule 6). Do not answer them yourself.`,
    );
    for (const t of o.owed.tasks) out.push('', `--- task ${t.id} (${t.kind}) ---`, t.prompt);
  }
  if (o.owed.waiting.length)
    out.push('', `WAITING on ${o.owed.waiting.length} dispatched task(s): ${o.owed.waiting.join(' · ')}`);
  out.push('', `Then run \`bp ${o.command}\` again.`);
  ctx.out(out.join('\n'));
}
