import { appendFileSync } from 'node:fs';
import { normaliseId } from '../../src/target/notion.ts';
import { fetchResult } from './index.ts';

// A small in-memory Notion that answers the connector calls bp owes, in the result shapes the real connector returns
// (DESIGN.md §5.3). It applies update_content edits exactly once, sets properties, and adds data-source columns — so a
// test can drive a relay run end to end: bp plans a call, the "model" makes it here, the result lands in the transcript.

export interface FakePage {
  title: string;
  properties: Record<string, unknown>;
  content: string;
}

export interface FakeDataSource {
  url: string;
  title: string;
  schema: Record<string, { name: string; type: string }>;
  rows: string[];
}

export class FakeNotion {
  readonly pages = new Map<string, FakePage>();
  readonly sources: FakeDataSource[] = [];
  /** Every call made, in order — for assertions about what bp asked for. */
  readonly log: { tool: string; input: Record<string, unknown> }[] = [];
  /** Views created over the API: the database, the name and the configure DSL. */
  readonly views: { database: string; name: string; configure: string }[] = [];
  /** A view whose configure contains this text fails, as a DSL the API rejects would. */
  failView: string | null = null;
  private created = 0;
  private databases = 0;

  page(id: string): FakePage {
    const p = this.pages.get(normaliseId(id));
    if (!p) throw new Error(`fake Notion has no page ${id}`);
    return p;
  }

  answer(tool: string, input: Record<string, unknown>): { text: string; isError?: boolean } {
    this.log.push({ tool, input });
    const name = tool.replace(/^.*notion-/, 'notion-');
    if (name === 'notion-fetch') {
      const id = str(input['id']);
      const ds = this.sources.find((d) => id.includes(d.url.replace(/^collection:\/\//, '')));
      if (ds) return { text: dsResult(ds) };
      const p = this.pages.get(normaliseId(id));
      if (!p) return { text: 'Could not find page', isError: true };
      return {
        text: fetchResult({ id: normaliseId(id), properties: p.properties, content: p.content, title: p.title }),
      };
    }
    if (name === 'notion-query-data-sources') {
      const data = input['data'] as { data_source_urls?: string[] } | undefined;
      const ds = this.sources.find((d) => data?.data_source_urls?.includes(d.url));
      if (!ds) return { text: 'no such data source', isError: true };
      const rows = ds.rows.map((id) => ({ url: `https://app.notion.com/${id}`, ...this.page(id).properties }));
      return { text: JSON.stringify({ results: rows, has_more: false }) };
    }
    if (name === 'notion-update-page') {
      const p = this.page(str(input['page_id']));
      if (input['command'] === 'update_content') {
        for (const u of (input['content_updates'] as { old_str: string; new_str: string }[] | undefined) ?? []) {
          const at = p.content.indexOf(u.old_str);
          // notion-mechanics §3: an old_str not found is skipped silently — the read-back is what catches it.
          if (at >= 0) p.content = `${p.content.slice(0, at)}${u.new_str}${p.content.slice(at + u.old_str.length)}`;
        }
        return { text: JSON.stringify({ page_id: input['page_id'] }) };
      }
      if (input['command'] === 'replace_content') {
        // The real connector refuses to drop a child database the new content does not name (allow_deleting_content).
        const next = str(input['new_str']);
        const dropped = [...p.content.matchAll(/<database url="([^"]+)"/g)].filter((m) => !next.includes(m[1] ?? '§'));
        if (dropped.length && input['allow_deleting_content'] !== true)
          return {
            text: `would delete ${dropped.length} child database(s) not referenced in the new content`,
            isError: true,
          };
        p.content = next;
        return { text: JSON.stringify({ page_id: input['page_id'] }) };
      }
      if (input['command'] === 'update_properties') {
        Object.assign(p.properties, input['properties'] as Record<string, unknown>);
        return { text: JSON.stringify({ page_id: input['page_id'] }) };
      }
    }
    if (name === 'notion-create-pages') {
      const parent = input['parent'] as { data_source_id?: string } | undefined;
      const ds = this.sources.find((d) => d.url.includes(str(parent?.data_source_id)));
      if (!ds) return { text: 'no such data source', isError: true };
      const pages = (input['pages'] as { properties: Record<string, unknown>; content?: string }[] | undefined) ?? [];
      const ids = pages.map((pg) => {
        this.created += 1;
        const id = `c${String(this.created).padStart(31, '0')}`;
        const title = str(pg.properties['Name'] ?? pg.properties['Question']);
        this.pages.set(id, { title, properties: { ...pg.properties }, content: pg.content ?? '' });
        ds.rows.push(id);
        return id;
      });
      return { text: JSON.stringify({ pages: ids.map((id) => ({ id, url: `https://app.notion.com/p/${id}` })) }) };
    }
    if (name === 'notion-update-data-source') {
      const ds = this.sources.find((d) => d.url.includes(str(input['data_source_id'])));
      const col = /ADD COLUMN "([^"]+)"/.exec(str(input['statements']))?.[1];
      if (!ds || !col) return { text: 'bad statement', isError: true };
      ds.schema[col] = { name: col, type: 'text' };
      for (const id of ds.rows) this.page(id).properties[col] ??= null;
      return { text: JSON.stringify({ ok: true }) };
    }
    if (name === 'notion-create-database') {
      const parent = this.page(str((input['parent'] as { page_id?: string } | undefined)?.page_id));
      this.databases += 1;
      const hex = this.databases.toString(16).padStart(31, '0');
      const db = `d${hex}`;
      const raw = `a${hex}`;
      const url = `collection://${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
      const title = str(input['title']);
      const ddl = str(input['schema']);
      const kinds: Record<string, string> = {
        TITLE: 'title',
        RICH_TEXT: 'text',
        SELECT: 'select',
        CREATED_TIME: 'created_time',
        PEOPLE: 'person',
        RELATION: 'relation',
      };
      const schema: FakeDataSource['schema'] = {};
      for (const m of ddl.matchAll(/"([^"]+)" ([A-Z_]+)/g)) {
        const col = m[1] ?? '';
        schema[col] = { name: col, type: kinds[m[2] ?? ''] ?? 'text' };
      }
      // A two-way relation adds its synced property to the other data source.
      const dual = /RELATION\('([^']+)', DUAL '([^']+)'\)/.exec(ddl);
      if (dual) {
        const other = this.sources.find((d) => d.url.includes(dual[1] ?? '§'));
        if (other) other.schema[dual[2] ?? ''] = { name: dual[2] ?? '', type: 'relation' };
      }
      this.sources.push({ url, title, schema, rows: [] });
      parent.content = `${parent.content}\n<database url="https://app.notion.com/p/${db}" inline="false" data-source-url="${url}">${title}</database>`;
      return {
        text: `Created the database.\n<database url="https://app.notion.com/p/${db}">${title}</database>\n<data-source url="${url}">\n${ddl}\n</data-source>`,
      };
    }
    if (name === 'notion-create-view') {
      const configure = str(input['configure']);
      if (this.failView && configure.includes(this.failView))
        return { text: `Invalid filter: ${this.failView}`, isError: true };
      this.views.push({ database: str(input['database_id']), name: str(input['name']), configure });
      return { text: JSON.stringify({ view: { name: input['name'] } }) };
    }
    return { text: `fake Notion does not know ${tool}`, isError: true };
  }
}

function dsResult(ds: FakeDataSource): string {
  const text = [
    `<data-source url="{{${ds.url}}}">`,
    `The title of this Data Source is: ${ds.title}`,
    '',
    '<data-source-state>',
    JSON.stringify({ name: ds.title, schema: ds.schema }),
    '</data-source-state>',
    '</data-source>',
  ].join('\n');
  return JSON.stringify({ metadata: { type: 'data_source' }, title: ds.title, url: ds.url, text });
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

let seq = 0;

/** Append one tool call and its result to a session transcript, stamped at the given instant. */
export function appendCall(
  transcript: string,
  tool: string,
  input: unknown,
  result: { text: string; isError?: boolean },
  at: string,
): void {
  seq += 1;
  const id = `toolu_fake_${String(seq).padStart(5, '0')}`;
  appendFileSync(
    transcript,
    `${[
      JSON.stringify({
        type: 'assistant',
        timestamp: at,
        message: { role: 'assistant', content: [{ type: 'tool_use', id, name: `mcp__notion__${tool}`, input }] },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: at,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: id,
              content: result.text,
              ...(result.isError ? { is_error: true } : {}),
            },
          ],
        },
      }),
    ].join('\n')}\n`,
  );
}
