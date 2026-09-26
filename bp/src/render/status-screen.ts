import type { StatusReport } from '../checks/status.ts';

// status.md S3 — one screen, fixed order, worst first; at most 5 rows a section then `+N more`; an empty section is
// omitted; every line ends in a move; a clean Blueprint gets two lines.

const MAX_ROWS = 5;

export function renderStatus(r: StatusReport): string {
  const top = `BLUEPRINT STATUS · ${r.title} · ${r.today}`;
  // A clean Blueprint is said in two lines and stops (status.md S3).
  if (r.clean) return `${top}\nClean — ${r.header} · nothing flagged, nothing waiting, nothing stale.`;
  const out: string[] = [top, r.header];
  for (const s of r.sections) {
    if (!s.lines.length && !s.notComputed) continue;
    out.push('');
    out.push(s.check === 'C5' ? s.title : `${s.title} (${s.count})`);
    if (s.notComputed) {
      out.push(`  ? could not be computed — ${s.notComputed}`);
      out.push('      → pull record/ from the repository, then run status again');
      continue;
    }
    // At most five rows, then "+N more" — except a pinned line, which the section ends with whatever the cap.
    const rows = s.lines.filter((l) => !l.pinned);
    const row = (l: (typeof rows)[number]): void => {
      const [first, ...rest] = l.text.split('\n');
      out.push(`  ${l.mark} ${first ?? ''}`);
      rest.forEach((x) => out.push(`  ${x}`));
      out.push(`      → ${l.move}`);
    };
    rows.slice(0, MAX_ROWS).forEach(row);
    if (rows.length > MAX_ROWS) out.push(`  +${rows.length - MAX_ROWS} more — bp status --json lists every row`);
    s.lines.filter((l) => l.pinned).forEach(row);
  }
  out.push('', 'WHAT IS STILL UNSETTLED');
  r.unsettled.forEach((u) => out.push(`  ${u}`));
  out.push('  None of it blocks anything. This is the document as it stands, said out loud.');
  out.push('', r.next);
  if (r.residue.length) {
    out.push(
      '',
      `Not read by code — a reader checks these: ${r.residue.map((x) => `${x.check} ${x.what}`).join(' · ')}`,
    );
  }
  return out.join('\n');
}
