// testing §2.4: a committed .only or .skip fails lint. node:test has no eslint plugin, so this is the check.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const bad = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'private' || name === 'node_modules') continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.test.ts')) {
      readFileSync(p, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/\b(?:test|it|describe)\.(?:only|skip|todo)\b|\{\s*(?:only|skip|todo)\s*:\s*true/.test(line))
            bad.push(`${p}:${i + 1}: ${line.trim()}`);
        });
    }
  }
};
walk('test');
if (bad.length) {
  process.stderr.write(`focused or skipped tests are not committed (testing §2.4):\n${bad.join('\n')}\n`);
  process.exit(1);
}
