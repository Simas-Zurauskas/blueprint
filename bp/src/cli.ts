import { parseArgs, type Args } from './core/args.ts';
import { BpError, EXIT, errorMessage, type ExitCode } from './core/errors.ts';
import { BoundaryError } from './core/schema.ts';
import type { Ctx } from './context.ts';
import {
  hashCommand,
  preflightCommand,
  progressCommand,
  quoteCommand,
  runidCommand,
  versionCommand,
} from './commands/basic.ts';
import { logCommand } from './commands/log.ts';
import { statusCommand } from './commands/status.ts';
import { renderCommand } from './commands/render.ts';
import { addCommand } from './commands/add.ts';
import { initCommand } from './commands/init.ts';
import { challengeCommand } from './commands/challenge.ts';
import { canonicalCommand } from './domain/vocab.ts';
import { resolveCommand } from './commands/resolve.ts';

// bp — the blueprint skill's executor. This module parses the command line, dispatches, and turns errors into exit codes
// (DESIGN.md §7). It is the one place that writes to the terminal.

type Handler = (ctx: Ctx, args: Args) => ExitCode;

/** Flags every command accepts. */
const GLOBAL_FLAGS = ['json', 'help', 'workspace', 'home'];

const COMMANDS: Record<string, { run: Handler; help: string; flags: string[] }> = {
  version: { run: (ctx) => versionCommand(ctx), help: 'print the skill version', flags: [] },
  preflight: {
    run: preflightCommand,
    help: 'SKILL.md pre-flight: home, target, concurrent run, version, ignore file  --command c [--run id] [--json]',
    flags: ['command', 'run'],
  },
  runid: { run: runidCommand, help: 'draw an unused 6-hex run id', flags: [] },
  hash: {
    run: hashCommand,
    help: 'hash body|text --file f|--stdin · hash file <path> · hash fetch --page <id>  (targets §5)',
    flags: ['file', 'stdin', 'page', 'after', 'transcript'],
  },
  quote: {
    run: quoteCommand,
    help: 'quote check --quote q (--file f | --page id) [--block B] · --batch <json>  (rule 6(d))',
    flags: ['quote', 'file', 'page', 'block', 'batch', 'after', 'transcript'],
  },
  log: {
    run: logCommand,
    help: 'log open|add|counts|hashes|funnel|close|state|validate  (resolve.md R5)',
    flags: [
      'run',
      'sitting',
      'command',
      'mode',
      'extra',
      'title',
      'kind',
      'text',
      'reconciliation',
      'group',
      'drafted',
      'defaults',
      'fixes',
      'slots',
      'questions',
      'discarded',
      'detail',
      'state',
      'reason',
      'today',
      'all',
    ],
  },
  progress: {
    run: progressCommand,
    help: 'render the progress block from --json-file <path|->  (run-progress.md)',
    flags: ['json-file'],
  },
  render: {
    run: renderCommand,
    help: 'the Blueprint for reading: --format md|txt|json|html [--feature F] [--packet F] [--questions open|all|none] [--out file]',
    flags: [
      'format',
      'feature',
      'packet',
      'questions',
      'out',
      'title',
      'provenance',
      'fresh',
      'deep',
      'replay',
      'transcript',
    ],
  },
  init: {
    run: initCommand,
    help: 'init.md end to end — a new Blueprint  --target notion:<url>|local[:folder] --source <file|folder>… --text <file> [--text-name n] · at I3: --reply <file> --decision confirm|edit|decline',
    flags: ['target', 'source', 'text', 'text-name', 'reply', 'decision', 'run', 'no-second-dispatch', 'transcript'],
  },
  add: {
    run: addCommand,
    help: 'add.md end to end — new material into a Blueprint  --source <file|folder>… --text <file> [--text-name n] [--soft] [--mode word] [--no-second-dispatch]',
    flags: ['source', 'text', 'text-name', 'soft', 'force', 'mode', 'run', 'no-second-dispatch', 'transcript'],
  },
  challenge: {
    run: challengeCommand,
    help: 'challenge.md end to end — grill, dispose, write  [--full] [--act "<the human\'s words>"] [--sample-answer "<words>"] [--no-second-dispatch]',
    flags: ['full', 'act', 'sample-answer', 'run', 'no-second-dispatch', 'transcript'],
  },
  resolve: {
    run: resolveCommand,
    help: 'resolve.md end to end — run it, do what it prints, run it again  [--soft] [--run id] [--no-second-dispatch] [--trust-source run/file --trust-words "…"]',
    flags: ['run', 'soft', 'no-second-dispatch', 'transcript', 'trust-source', 'trust-words'],
  },
  status: {
    run: statusCommand,
    help: 'status.md end to end — one screen, writes nothing  [--workspace w] [--json] [--fresh] [--deep]',
    flags: ['title', 'fresh', 'deep', 'replay', 'transcript', 'full'],
  },
};

function help(ctx: Ctx): ExitCode {
  ctx.out('bp — the blueprint skill executor\n');
  for (const [name, c] of Object.entries(COMMANDS)) ctx.out(`  bp ${name.padEnd(10)} ${c.help}`);
  ctx.out('\nEvery command takes --json. Exit codes: 0 ok · 1 findings · 2 usage · 3 halt · 4 waiting.');
  return EXIT.ok;
}

export function main(argv: readonly string[], ctx: Ctx): ExitCode {
  try {
    const args = parseArgs(argv);
    const raw = args.positionals[0];
    if (!raw || raw === 'help' || args.bools.has('help')) return help(ctx);
    const name = canonicalCommand(raw);
    const cmd = COMMANDS[name];
    if (!cmd) {
      ctx.err(`bp: unknown command "${name}" — run bp help`);
      return EXIT.usage;
    }
    const allowed = new Set([...GLOBAL_FLAGS, ...cmd.flags]);
    const unknown = [...args.flags.keys(), ...args.bools].filter((f) => !allowed.has(f));
    if (unknown.length) {
      ctx.err(
        `bp ${name}: unknown flag${unknown.length > 1 ? 's' : ''} ${unknown.map((f) => `--${f}`).join(', ')} — bp ${name} takes ${[...allowed].map((f) => `--${f}`).join(' ')}`,
      );
      return EXIT.usage;
    }
    return cmd.run(ctx, args);
  } catch (err) {
    if (err instanceof BpError) {
      ctx.err(`bp: ${err.message}${err.hint ? `\n  → ${err.hint}` : ''}`);
      return err.code;
    }
    if (err instanceof BoundaryError) {
      ctx.err(`bp: ${err.message}`);
      return EXIT.usage;
    }
    ctx.err(`bp: internal error: ${errorMessage(err)}`);
    if (err instanceof Error && err.stack) ctx.err(err.stack);
    return EXIT.halt;
  }
}
