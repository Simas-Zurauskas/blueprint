import { main } from './cli.ts';
import { makeCtx } from './context.ts';

// The executable entry point. The `bp` wrapper runs this file; tests import `main` from cli.ts, which has no side effect.
// (An "is this module the entry point?" test on import.meta.url fails when bp is reached through a symlink — the skills
// folder links to the skill — because Node resolves the module's real path and argv[1] keeps the linked one.)

// A reader that stops early (`bp render | head`) closes the pipe; that is not an error.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const ctx = makeCtx({
  out: (t) => process.stdout.write(`${t}\n`),
  err: (t) => process.stderr.write(`${t}\n`),
});
process.exitCode = main(process.argv.slice(2), ctx);
