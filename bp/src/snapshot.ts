import { hashBody, sha12, type Sha12, type Sha256 } from './core/hash.ts';
import { parseBody, type ParsedBody } from './domain/feature.ts';
import { parseOverview, type ParsedOverview } from './domain/overview.ts';
import type { Question } from './domain/question.ts';
import type { TargetInfo } from './home.ts';

// A Snapshot is one complete read of the target (DESIGN.md §3.1). Every check and every plan works from one; a read
// that is not complete says so in `incomplete`, and nothing downstream treats it as complete (targets §1 operation 4).

export interface FeatureRec {
  id: string;
  name: string;
  whatItDoes: string;
  area: string;
  created: string | null;
  /** Question ids the feature's own relation lists — read for cross-checking only; `Touches` is the mapping. */
  questionRefs: string[];
  /** The body exactly as the target returned it. */
  content: string;
  body: ParsedBody;
  hash: Sha256 | undefined;
  hash12: Sha12 | undefined;
  /** Where it was read from: a file path, or a transcript call id. */
  source: string;
  /** Fields the row carries that databases.md §1 does not define. */
  adHoc: string[];
}

export interface OverviewRec {
  id: string;
  content: string;
  parsed: ParsedOverview;
  /** Child databases named in the page (Notion): used for pre-flight 5's Board test and to find the data sources. */
  databases: { title: string; dataSourceUrl: string | null; inline: boolean }[];
}

export interface Snapshot {
  target: { kind: TargetInfo['kind']; address: string };
  readAt: string;
  overview: OverviewRec | null;
  features: FeatureRec[];
  questions: Question[];
  /** Every reason the read is not complete; empty means complete. */
  incomplete: string[];
  /** Pre-flight 5: a `Board` database beneath the overview means the superseded skill built this. */
  legacyBoard: boolean;
  /** The Open Questions data source carries a `Why flagged` property (v34's register row). */
  hasWhyFlagged: boolean | null;
}

export function makeFeature(opts: Omit<FeatureRec, 'body' | 'hash' | 'hash12'>): FeatureRec {
  const hash = hashBody(opts.content);
  return { ...opts, body: parseBody(opts.content), hash, hash12: hash ? sha12(hash) : undefined };
}

export function makeOverview(id: string, content: string, databases: OverviewRec['databases'] = []): OverviewRec {
  return { id, content, parsed: parseOverview(content), databases };
}

/** Resolve a question's `Touches` entries to features: by id (Notion), else by exact name (local). */
export function touchedFeatures(s: Snapshot, q: Question): { found: FeatureRec[]; missing: string[] } {
  const found: FeatureRec[] = [];
  const missing: string[] = [];
  for (const t of q.touches) {
    const f = s.features.find((x) => x.id === t) ?? s.features.find((x) => x.name === t);
    if (f) found.push(f);
    else missing.push(t);
  }
  return { found, missing };
}

export function featureByRef(s: Snapshot, ref: string): FeatureRec | undefined {
  return s.features.find((f) => f.id === ref || f.name === ref);
}
