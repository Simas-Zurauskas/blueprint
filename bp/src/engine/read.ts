import { join } from 'node:path';
import { flag, type Args } from '../core/args.ts';
import { usage } from '../core/errors.ts';
import type { Ctx } from '../context.ts';
import type { Snapshot } from '../snapshot.ts';
import { readLocal } from '../target/local.ts';
import { loadPull, newPull, savePull, stepPull, toSnapshot } from '../target/relay.ts';
import { sessionTranscripts } from '../tasks/tasks.ts';
import type { Pages } from './writes.ts';
import type { Owed, RunState } from './state.ts';

// Reading the Blueprint for a write run: the local folder directly, or Notion through the relay — one pull per sitting,
// kept under cache/runs/<run>/ (rebuildable from the target, never the record). The pull's data sources are kept too:
// row creation needs them.

export interface Read {
  snapshot: Snapshot;
  featuresDs: string | null;
  questionsDs: string | null;
}

export function readBlueprint(
  ctx: Ctx,
  args: Args,
  home: string,
  st: RunState,
  target: { kind: 'notion' | 'local'; address: string },
): Read | { owed: Owed } {
  if (target.kind === 'local')
    return { snapshot: readLocal(target.address, st.sittingStartedAt), featuresDs: null, questionsDs: null };
  const path = join(home, 'cache', 'runs', st.runId, `pull-s${st.sitting}.json`);
  let pull = loadPull(path);
  if (!pull) {
    pull = newPull(target.address, st.sittingStartedAt);
    savePull(path, pull);
  }
  if (pull.stage !== 'done' || pull.pending.length) {
    const t = sessionTranscripts(ctx.env, flag(args, 'transcript'));
    if (!t)
      throw usage(
        'the relay needs the session transcript to read Notion results, and none was found',
        'run inside Claude Code, or pass --transcript <path>',
      );
    stepPull(pull, t);
    savePull(path, pull);
    if (pull.stage !== 'done' || pull.pending.length)
      return { owed: { tasks: [], calls: pull.pending.map((p) => ({ tool: p.tool, input: p.input })), waiting: [] } };
  }
  return {
    snapshot: toSnapshot(pull, st.sittingStartedAt),
    featuresDs: pull.featuresDs,
    questionsDs: pull.questionsDs,
  };
}

/** The pages a run starts from: every feature and the overview, by key, with their addresses and current text. */
export function pagesOf(s: Snapshot, docDir?: string): Pages {
  const pages: Pages = { address: {}, name: {}, content: {} };
  for (const f of s.features) {
    pages.address[f.id] = s.target.kind === 'local' ? f.source : f.id;
    pages.content[f.id] = f.content;
    pages.name[f.name] = f.id;
  }
  if (s.overview) {
    pages.address['overview'] =
      s.target.kind === 'local' ? join(docDir ?? s.target.address, 'README.md') : s.overview.id;
    pages.content['overview'] = s.overview.content;
  }
  return pages;
}
