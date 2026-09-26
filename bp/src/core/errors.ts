// Exit codes are part of bp's contract with the orchestrating model (DESIGN.md §7).
export const EXIT = {
  ok: 0,
  findings: 1,
  usage: 2,
  halt: 3,
  waiting: 4,
} as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** An expected failure with a code and a message meant for the orchestrator to read and act on. */
export class BpError extends Error {
  readonly code: ExitCode;
  readonly hint: string | undefined;
  constructor(code: ExitCode, message: string, opts: { hint?: string; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'BpError';
    this.code = code;
    this.hint = opts.hint;
  }
}

export const usage = (message: string, hint?: string): BpError =>
  new BpError(EXIT.usage, message, hint === undefined ? {} : { hint });
export const halt = (message: string, hint?: string): BpError =>
  new BpError(EXIT.halt, message, hint === undefined ? {} : { hint });

export function errorMessage(err: unknown, fallback = 'unknown error'): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
}

export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
