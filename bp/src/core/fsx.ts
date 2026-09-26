import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
  existsSync,
  statSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { isNodeError, usage } from './errors.ts';

// File access in one place. Every write is atomic — a temp file beside the target, then a rename — because a
// half-written run log or body is the local equivalent of the half-written page nothing can read back (targets §3).

/** Read a file the caller named. A missing or unreadable path is a usage error naming it — never an internal crash. */
export function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (isNodeError(err) && (err.code === 'ENOENT' || err.code === 'EISDIR' || err.code === 'EACCES')) {
      throw usage(
        `cannot read ${path}: ${err.code === 'ENOENT' ? 'no such file' : err.code === 'EISDIR' ? 'it is a directory' : 'permission denied'}`,
      );
    }
    throw err;
  }
}

export function readTextIfExists(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return undefined;
    throw err;
  }
}

export function exists(path: string): boolean {
  return existsSync(path);
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function listDir(path: string): string[] {
  try {
    return readdirSync(path).sort();
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return [];
    throw err;
  }
}

let tmpCounter = 0;

/**
 * Write UTF-8 atomically: a temp file beside the target, then a rename. A symlinked target is written through to its real
 * file (the link survives), an existing file keeps its permissions, and a read-only file is refused rather than replaced.
 */
export function writeTextAtomic(path: string, content: string | Uint8Array): void {
  let target = path;
  let mode: number | undefined;
  try {
    target = realpathSync(path);
    const st = statSync(target);
    mode = st.mode & 0o777;
    if ((mode & 0o200) === 0) throw usage(`${path} is read-only — bp does not replace a file its owner protected`);
  } catch (err) {
    if (!(isNodeError(err) && err.code === 'ENOENT')) throw err;
  }
  mkdirSync(dirname(target), { recursive: true });
  tmpCounter += 1;
  const tmp = join(dirname(target), `.${process.pid}.${tmpCounter}.bp-tmp`);
  writeFileSync(tmp, content, 'utf8');
  try {
    if (mode !== undefined) chmodSync(tmp, mode);
    renameSync(tmp, target);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}
