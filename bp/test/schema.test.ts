import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  array,
  boolean,
  BoundaryError,
  formatIssues,
  integer,
  isRecord,
  literal,
  must,
  nullable,
  object,
  oneOf,
  optional,
  parseJson,
  record,
  string,
  tagged,
  type Infer,
  type Issue,
  type ParseResult,
} from '../src/core/schema.ts';
import { bool, flag, flagAll, intFlag, oneOfFlag, parseArgs, requireFlag, requireInt } from '../src/core/args.ts';
import { BpError, EXIT } from '../src/core/errors.ts';
import { MODES, STATUSES, type Mode, type Status } from '../src/domain/vocab.ts';
import { run, tempDir, writeFile } from './support/index.ts';

// src/core/schema.ts is the one runtime-validation mechanism at every trust boundary (DESIGN.md C8, type-safety §5), and
// src/core/args.ts is the CLI-argument boundary. Expected values below are written by hand from the module contracts
// (the doc comments in the two files, DESIGN.md §1/§7, spec/doc-shape.md §6), never computed by the code under test.

// ---- helpers -----------------------------------------------------------------------------------------------------------

function issuesOf<T>(r: ParseResult<T>): Issue[] {
  if (r.ok) assert.fail(`expected issues, got ok with ${JSON.stringify(r.value)}`);
  return r.issues;
}

function valueOf<T>(r: ParseResult<T>): T {
  if (!r.ok) assert.fail(`expected ok, got issues ${JSON.stringify(r.issues)}`);
  return r.value;
}

const pathsOf = <T>(r: ParseResult<T>): string[] => issuesOf(r).map((i) => i.path);

/** Assert `fn` throws bp's usage error (exit 2) whose message matches `message`. */
function assertUsage(fn: () => unknown, message: RegExp): BpError {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof BpError, `expected a BpError, got ${String(caught)}`);
  assert.equal(caught.code, EXIT.usage);
  assert.match(caught.message, message);
  return caught;
}

/** A skill root holding a VERSION file with exactly `content` (a trailing newline added). */
function writeVersionRoot(content: string): string {
  const d = tempDir('bp-skill-');
  writeFile(join(d, 'VERSION'), `${content}\n`);
  return d;
}

/** Assert `fn` throws a BoundaryError and hand it back for further checks. */
function assertBoundary(fn: () => unknown): BoundaryError {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof BoundaryError, `expected a BoundaryError, got ${String(caught)}`);
  return caught;
}

// ---- string ------------------------------------------------------------------------------------------------------------

void describe('string()', () => {
  void test('accepts a string and returns it unchanged', () => {
    assert.equal(valueOf(string().parse('hello')), 'hello');
  });

  void test('accepts the empty string when no minimum is set', () => {
    assert.equal(valueOf(string().parse('')), '');
  });

  void test('rejects a non-string and names the type it received', () => {
    const cases: [unknown, RegExp][] = [
      [42, /got number/],
      [null, /got null/],
      [undefined, /got undefined/],
      [['a'], /got array/],
      [{ a: 1 }, /got object/],
      [true, /got boolean/],
    ];
    for (const [input, got] of cases) {
      const issues = issuesOf(string().parse(input));
      assert.equal(issues.length, 1);
      assert.equal(issues[0]?.path, '$');
      assert.match(issues[0]?.message ?? '', /expected string/);
      assert.match(issues[0]?.message ?? '', got);
    }
  });

  void test('min and max length are inclusive bounds', () => {
    const s = string({ min: 2, max: 4 });
    assert.equal(valueOf(s.parse('ab')), 'ab');
    assert.equal(valueOf(s.parse('abcd')), 'abcd');
  });

  void test('rejects a string shorter than min', () => {
    const issues = issuesOf(string({ min: 2 }).parse('a'));
    assert.deepEqual(
      issues.map((i) => i.path),
      ['$'],
    );
    assert.match(issues[0]?.message ?? '', /shorter than 2/);
  });

  void test('rejects a string longer than max', () => {
    const issues = issuesOf(string({ max: 3 }).parse('abcd'));
    assert.deepEqual(
      issues.map((i) => i.path),
      ['$'],
    );
    assert.match(issues[0]?.message ?? '', /longer than 3/);
  });

  void test('rejects a string that does not match the pattern', () => {
    const s = string({ pattern: /^[0-9a-f]{6}$/ });
    assert.equal(valueOf(s.parse('a1b2c3')), 'a1b2c3');
    const issues = issuesOf(s.parse('a1b2c'));
    assert.match(issues[0]?.message ?? '', /does not match/);
  });

  void test('a pattern gives the same verdict for the same input on every parse, even with a global-flag regex', () => {
    // DESIGN.md C6: same inputs produce the same result. RegExp#test on a /g regex is stateful (lastIndex), so a schema
    // that reuses the caller's regex flips its verdict between calls.
    const s = string({ pattern: /^run-[0-9]+$/g });
    const verdicts = [s.parse('run-12').ok, s.parse('run-12').ok, s.parse('run-12').ok];
    assert.deepEqual(verdicts, [true, true, true]);
  });

  void test('a global-flag pattern the caller has already advanced still matches from the start', () => {
    const re = /^run-[0-9]+$/g;
    assert.equal(re.test('run-1'), true); // the caller's own use leaves lastIndex at 5
    assert.equal(string({ pattern: re }).parse('run-12').ok, true);
  });

  void test('a sticky-flag pattern gives the same verdict on every parse', () => {
    const s = string({ pattern: /run-[0-9]+/y });
    assert.deepEqual([s.parse('run-7').ok, s.parse('run-7').ok], [true, true]);
  });

  void test('a global-flag pattern rejects a non-match on every parse, not only the first', () => {
    const s = string({ pattern: /^[0-9a-f]{6}$/g });
    assert.deepEqual([s.parse('a1b2c3').ok, s.parse('zzzzzz').ok, s.parse('a1b2c3').ok], [true, false, true]);
  });

  void test('json() of a bare string is only the type', () => {
    assert.deepEqual(string().json(), { type: 'string' });
  });

  void test('json() renders minLength, maxLength and the pattern source', () => {
    assert.deepEqual(string({ min: 1, max: 12, pattern: /^[a-z]+$/ }).json(), {
      type: 'string',
      minLength: 1,
      maxLength: 12,
      pattern: '^[a-z]+$',
    });
  });

  void test('json() keeps a zero minimum rather than dropping it as falsy', () => {
    assert.deepEqual(string({ min: 0 }).json(), { type: 'string', minLength: 0 });
  });
});

// ---- integer -----------------------------------------------------------------------------------------------------------

void describe('integer()', () => {
  void test('accepts zero, positive and negative integers', () => {
    for (const n of [0, 7, -3, 1_000_000]) assert.equal(valueOf(integer().parse(n)), n);
  });

  void test('rejects a fractional number', () => {
    const issues = issuesOf(integer().parse(1.5));
    assert.deepEqual(
      issues.map((i) => i.path),
      ['$'],
    );
    assert.match(issues[0]?.message ?? '', /expected integer/);
  });

  void test('rejects NaN and the infinities', () => {
    for (const n of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.equal(integer().parse(n).ok, false, `${n} should be rejected`);
    }
  });

  void test('rejects a numeric string, a boolean and null', () => {
    assert.match(issuesOf(integer().parse('3'))[0]?.message ?? '', /got string/);
    assert.match(issuesOf(integer().parse(true))[0]?.message ?? '', /got boolean/);
    assert.match(issuesOf(integer().parse(null))[0]?.message ?? '', /got null/);
  });

  void test('min and max are inclusive bounds', () => {
    const s = integer({ min: 1, max: 3 });
    assert.equal(valueOf(s.parse(1)), 1);
    assert.equal(valueOf(s.parse(3)), 3);
  });

  void test('rejects a value below min', () => {
    assert.match(issuesOf(integer({ min: 1 }).parse(0))[0]?.message ?? '', /below 1/);
  });

  void test('rejects a value above max', () => {
    assert.match(issuesOf(integer({ max: 3 }).parse(4))[0]?.message ?? '', /above 3/);
  });

  void test('json() renders minimum and maximum, keeping a zero bound', () => {
    assert.deepEqual(integer().json(), { type: 'integer' });
    assert.deepEqual(integer({ min: 0, max: 9 }).json(), { type: 'integer', minimum: 0, maximum: 9 });
  });
});

// ---- boolean -----------------------------------------------------------------------------------------------------------

void describe('boolean()', () => {
  void test('accepts true and false', () => {
    assert.equal(valueOf(boolean().parse(true)), true);
    assert.equal(valueOf(boolean().parse(false)), false);
  });

  void test('rejects truthy and falsy non-booleans', () => {
    for (const input of ['true', 'false', 0, 1, null, undefined]) {
      assert.deepEqual(pathsOf(boolean().parse(input)), ['$'], `${String(input)} should be rejected`);
    }
  });

  void test('json() is the boolean type', () => {
    assert.deepEqual(boolean().json(), { type: 'boolean' });
  });
});

// ---- oneOf -------------------------------------------------------------------------------------------------------------

void describe('oneOf()', () => {
  void test('accepts every member of the closed list', () => {
    const s = oneOf(STATUSES);
    for (const m of STATUSES) assert.equal(valueOf(s.parse(m)), m);
  });

  void test('rejects a string outside the list, including a case variant of a member', () => {
    const s = oneOf(STATUSES);
    const issues = issuesOf(s.parse('open'));
    assert.deepEqual(
      issues.map((i) => i.path),
      ['$'],
    );
    assert.match(issues[0]?.message ?? '', /expected one of/);
    assert.match(issues[0]?.message ?? '', /"open"/);
  });

  void test('the rejection lists the allowed members', () => {
    const message = issuesOf(oneOf(MODES).parse('hard'))[0]?.message ?? '';
    for (const m of MODES) assert.ok(message.includes(`"${m}"`), `message should name ${m}: ${message}`);
  });

  void test('rejects a non-string even when its text would match a member', () => {
    const s = oneOf(['1', '2'] as const);
    assert.equal(s.parse(1).ok, false);
  });

  void test('json() is a string enum of exactly the members', () => {
    assert.deepEqual(oneOf(STATUSES).json(), { type: 'string', enum: [...STATUSES] });
  });

  void test('the parsed value is typed as the union', () => {
    const status: Status = must(oneOf(STATUSES), 'Applied', 'status');
    const mode: Mode = must(oneOf(MODES), 'soft', 'mode');
    assert.deepEqual([status, mode], ['Applied', 'soft']);
  });
});

// ---- literal -----------------------------------------------------------------------------------------------------------

void describe('literal()', () => {
  void test('accepts exactly the literal value', () => {
    assert.equal(valueOf(literal('item').parse('item')), 'item');
    assert.equal(valueOf(literal(3).parse(3)), 3);
    assert.equal(valueOf(literal(false).parse(false)), false);
  });

  void test('rejects values that are only loosely equal', () => {
    assert.equal(literal(3).parse('3').ok, false);
    assert.equal(literal(true).parse(1).ok, false);
    assert.equal(literal('item').parse('Item').ok, false);
    assert.equal(literal(0).parse(false).ok, false);
  });

  void test('the rejection names the expected value', () => {
    assert.match(issuesOf(literal('item').parse('x'))[0]?.message ?? '', /"item"/);
  });

  void test('json() is a const', () => {
    assert.deepEqual(literal('item').json(), { const: 'item' });
    assert.deepEqual(literal(7).json(), { const: 7 });
  });
});

// ---- nullable ----------------------------------------------------------------------------------------------------------

void describe('nullable()', () => {
  void test('accepts null', () => {
    assert.equal(valueOf(nullable(string()).parse(null)), null);
  });

  void test('passes a non-null value to the inner schema', () => {
    assert.equal(valueOf(nullable(string()).parse('x')), 'x');
    assert.match(issuesOf(nullable(string()).parse(1))[0]?.message ?? '', /expected string/);
  });

  void test('rejects undefined: absent is not null', () => {
    assert.equal(nullable(string()).parse(undefined).ok, false);
  });

  void test('an inner issue keeps the caller path', () => {
    const s = object({ note: nullable(string({ min: 1 })) });
    assert.deepEqual(pathsOf(s.parse({ note: '' })), ['$.note']);
  });

  void test('json() is anyOf the inner rendering and null', () => {
    assert.deepEqual(nullable(integer({ min: 1 })).json(), {
      anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }],
    });
  });
});

// ---- array -------------------------------------------------------------------------------------------------------------

void describe('array()', () => {
  void test('accepts an empty array when no minimum is set', () => {
    assert.deepEqual(valueOf(array(string()).parse([])), []);
  });

  void test('returns the items in order', () => {
    assert.deepEqual(valueOf(array(integer()).parse([3, 1, 2])), [3, 1, 2]);
  });

  void test('rejects a non-array, including an array-like object', () => {
    assert.match(
      issuesOf(array(string()).parse({ 0: 'a', length: 1 }))[0]?.message ?? '',
      /expected array, got object/,
    );
    assert.match(issuesOf(array(string()).parse('ab'))[0]?.message ?? '', /got string/);
    assert.match(issuesOf(array(string()).parse(null))[0]?.message ?? '', /got null/);
  });

  void test('reports every bad item at its own index path', () => {
    assert.deepEqual(pathsOf(array(string()).parse([1, 'ok', 2])), ['$[0]', '$[2]']);
  });

  void test('min and max item counts are inclusive bounds', () => {
    const s = array(integer(), { min: 1, max: 2 });
    assert.deepEqual(valueOf(s.parse([1])), [1]);
    assert.deepEqual(valueOf(s.parse([1, 2])), [1, 2]);
  });

  void test('rejects fewer items than min', () => {
    assert.match(issuesOf(array(integer(), { min: 1 }).parse([]))[0]?.message ?? '', /fewer than 1 items/);
  });

  void test('rejects more items than max', () => {
    assert.match(issuesOf(array(integer(), { max: 2 }).parse([1, 2, 3]))[0]?.message ?? '', /more than 2 items/);
  });

  void test('json() renders items, minItems and maxItems', () => {
    assert.deepEqual(array(string(), { min: 1, max: 5 }).json(), {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 5,
    });
    assert.deepEqual(array(boolean()).json(), { type: 'array', items: { type: 'boolean' } });
  });
});

// ---- record ------------------------------------------------------------------------------------------------------------

void describe('record()', () => {
  void test('accepts any keys and returns every entry', () => {
    assert.deepEqual(valueOf(record(integer()).parse({ a: 1, 'b c': 2 })), { a: 1, 'b c': 2 });
  });

  void test('accepts an empty object', () => {
    assert.deepEqual(valueOf(record(string()).parse({})), {});
  });

  void test('reports a bad value at its key path', () => {
    assert.deepEqual(pathsOf(record(integer()).parse({ good: 1, bad: 'x', worse: 1.5 })), ['$.bad', '$.worse']);
  });

  void test('rejects an array and null', () => {
    assert.match(issuesOf(record(string()).parse(['a']))[0]?.message ?? '', /expected object, got array/);
    assert.match(issuesOf(record(string()).parse(null))[0]?.message ?? '', /got null/);
  });

  void test('keeps a key spelled __proto__ as an ordinary entry rather than dropping it', () => {
    // JSON.parse makes "__proto__" an own property; a record parsed from a JSON file must return every entry it read.
    const input: unknown = JSON.parse('{"__proto__": 1, "k": 2}');
    const value = valueOf(record(integer()).parse(input));
    assert.deepEqual(Object.keys(value).sort(), ['__proto__', 'k']);
  });

  void test('a __proto__ entry keeps its value and does not replace the prototype of the result', () => {
    const input: unknown = JSON.parse('{"__proto__": {"polluted": 1}}');
    const value = valueOf(record(record(integer())).parse(input));
    assert.deepEqual(Object.getOwnPropertyDescriptor(value, '__proto__')?.value, { polluted: 1 });
    assert.equal(Object.getPrototypeOf(value), Object.prototype);
    assert.equal('polluted' in value, false);
  });

  void test('json() is an object whose additional properties follow the value schema', () => {
    assert.deepEqual(record(integer({ min: 0 })).json(), {
      type: 'object',
      additionalProperties: { type: 'integer', minimum: 0 },
    });
  });
});

// ---- object ------------------------------------------------------------------------------------------------------------

void describe('object()', () => {
  const Row = object({ id: string({ min: 1 }), count: integer({ min: 0 }), note: optional(string()) });

  void test('accepts the declared fields and returns them', () => {
    assert.deepEqual(valueOf(Row.parse({ id: 'F1', count: 2, note: 'n' })), { id: 'F1', count: 2, note: 'n' });
  });

  void test('a missing required field is an issue at its path, message "required"', () => {
    assert.deepEqual(issuesOf(Row.parse({ id: 'F1' })), [{ path: '$.count', message: 'required' }]);
  });

  void test('a required field present as undefined counts as missing', () => {
    assert.deepEqual(issuesOf(Row.parse({ id: 'F1', count: undefined })), [{ path: '$.count', message: 'required' }]);
  });

  void test('an absent optional field is left out of the output, not set to undefined', () => {
    const value = valueOf(Row.parse({ id: 'F1', count: 0 }));
    assert.equal(Object.hasOwn(value, 'note'), false);
    assert.deepEqual(value, { id: 'F1', count: 0 });
  });

  void test('an optional field present as undefined is treated as absent', () => {
    const value = valueOf(Row.parse({ id: 'F1', count: 0, note: undefined }));
    assert.equal(Object.hasOwn(value, 'note'), false);
  });

  void test('a present optional field is validated by its inner schema', () => {
    assert.deepEqual(pathsOf(Row.parse({ id: 'F1', count: 0, note: 5 })), ['$.note']);
  });

  void test('an optional field does not accept null unless its inner schema is nullable', () => {
    assert.deepEqual(pathsOf(Row.parse({ id: 'F1', count: 0, note: null })), ['$.note']);
  });

  void test('an unknown key is rejected as "unknown field" at its path', () => {
    assert.deepEqual(issuesOf(Row.parse({ id: 'F1', count: 0, Approved: 'yes' })), [
      { path: '$.Approved', message: 'unknown field' },
    ]);
  });

  void test('an unknown key named after an Object.prototype member is rejected like any other', () => {
    // schema.ts:166 and spec/doc-shape.md §6: no field exists outside the defined list. A key the shape does not declare
    // is unknown whatever it is called; JSON.parse makes each of these an own property of the input.
    for (const key of ['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__']) {
      const input: unknown = JSON.parse(`{"id": "F1", "count": 0, ${JSON.stringify(key)}: "x"}`);
      assert.deepEqual(issuesOf(Row.parse(input)), [{ path: `$.${key}`, message: 'unknown field' }], `key ${key}`);
    }
  });

  void test('passthrough accepts keys the shape does not declare', () => {
    const Open = object({ id: string() }, { passthrough: true });
    assert.equal(Open.parse({ id: 'F1', extra: 1, more: { deep: true } }).ok, true);
  });

  void test('passthrough still validates declared fields and requires required ones', () => {
    const Open = object({ id: string(), n: integer() }, { passthrough: true });
    const issues = issuesOf(Open.parse({ id: 3, extra: 1 }));
    assert.deepEqual(issues.map((i) => i.path).sort(), ['$.id', '$.n']);
    assert.match(issues.find((i) => i.path === '$.id')?.message ?? '', /expected string/);
    assert.equal(issues.find((i) => i.path === '$.n')?.message, 'required');
  });

  void test('every issue in the object is reported at once', () => {
    const issues = issuesOf(Row.parse({ id: '', stray: true }));
    assert.deepEqual(issues.map((i) => i.path).sort(), ['$.count', '$.id', '$.stray']);
  });

  void test('rejects an array, null and a string as the object itself', () => {
    for (const input of [[], null, 'F1'])
      assert.deepEqual(pathsOf(Row.parse(input)), ['$'], `${JSON.stringify(input)}`);
  });

  void test('nested issues carry the full path through arrays and objects', () => {
    const Doc = object({ items: array(object({ name: string() })) });
    assert.deepEqual(pathsOf(Doc.parse({ items: [{ name: 'ok' }, { name: 1 }, {}] })), [
      '$.items[1].name',
      '$.items[2].name',
    ]);
  });

  void test('a caller-supplied root path prefixes every issue', () => {
    assert.deepEqual(pathsOf(Row.parse({ id: 'F1' }, 'state')), ['state.count']);
  });

  void test('json() lists properties, only the required keys, and closes additional properties', () => {
    assert.deepEqual(Row.json(), {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1 },
        count: { type: 'integer', minimum: 0 },
        note: { type: 'string' },
      },
      required: ['id', 'count'],
      additionalProperties: false,
    });
  });

  void test('json() of a passthrough object opens additional properties', () => {
    assert.deepEqual(object({ id: string() }, { passthrough: true }).json(), {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: true,
    });
  });

  void test('json() of an all-optional object has an empty required list', () => {
    assert.deepEqual(object({ a: optional(boolean()) }).json(), {
      type: 'object',
      properties: { a: { type: 'boolean' } },
      required: [],
      additionalProperties: false,
    });
  });

  void test('json() composes nested schemas', () => {
    assert.deepEqual(object({ tags: array(oneOf(MODES)) }).json(), {
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string', enum: [...MODES] } } },
      required: ['tags'],
      additionalProperties: false,
    });
  });

  void test('the inferred type makes an optional field absent-or-present, never explicitly undefined', () => {
    type RowT = Infer<typeof Row>;
    const minimal: RowT = { id: 'F1', count: 0 };
    // @ts-expect-error -- exactOptionalPropertyTypes: an optional field may be absent but may not hold undefined
    const explicitUndefined: RowT = { id: 'F1', count: 0, note: undefined };
    // @ts-expect-error -- a required field may not be left out
    const missingRequired: RowT = { id: 'F1' };
    assert.deepEqual(valueOf(Row.parse(minimal)), minimal);
    assert.ok(isRecord(explicitUndefined) && isRecord(missingRequired));
  });
});

// ---- tagged ------------------------------------------------------------------------------------------------------------

void describe('tagged()', () => {
  const Event = tagged('kind', {
    item: object({ kind: literal('item'), id: string() }),
    note: object({ kind: literal('note'), text: string({ min: 1 }) }),
  });

  void test('routes to the variant named by the tag and returns it', () => {
    assert.deepEqual(valueOf(Event.parse({ kind: 'item', id: 'F1' })), { kind: 'item', id: 'F1' });
    assert.deepEqual(valueOf(Event.parse({ kind: 'note', text: 'hi' })), { kind: 'note', text: 'hi' });
  });

  void test('issues from the chosen variant surface at their field path', () => {
    assert.deepEqual(
      issuesOf(Event.parse({ kind: 'note', text: '' })).map((i) => i.path),
      ['$.text'],
    );
  });

  void test('the chosen variant is closed: a field from another variant is unknown', () => {
    assert.deepEqual(issuesOf(Event.parse({ kind: 'note', text: 'hi', id: 'F1' })), [
      { path: '$.id', message: 'unknown field' },
    ]);
  });

  void test('an unknown tag is an issue at the tag path that lists the variants', () => {
    const issues = issuesOf(Event.parse({ kind: 'other' }));
    assert.deepEqual(
      issues.map((i) => i.path),
      ['$.kind'],
    );
    assert.match(issues[0]?.message ?? '', /item/);
    assert.match(issues[0]?.message ?? '', /note/);
    assert.match(issues[0]?.message ?? '', /"other"/);
  });

  void test('a missing tag is an issue at the tag path', () => {
    assert.deepEqual(pathsOf(Event.parse({ id: 'F1' })), ['$.kind']);
  });

  void test('a non-string tag is an issue at the tag path', () => {
    assert.deepEqual(pathsOf(Event.parse({ kind: 1 })), ['$.kind']);
  });

  void test('a tag named after an Object.prototype member is not a variant', () => {
    for (const tag of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
      assert.deepEqual(pathsOf(Event.parse({ kind: tag })), ['$.kind'], `tag ${tag}`);
    }
  });

  void test('a non-object is an issue at the value path', () => {
    for (const input of [null, [], 'item']) assert.deepEqual(pathsOf(Event.parse(input)), ['$']);
  });

  void test('inside an array the tag path carries the index', () => {
    assert.deepEqual(pathsOf(array(Event).parse([{ kind: 'item', id: 'a' }, { kind: 'bogus' }])), ['$[1].kind']);
  });

  void test('json() is oneOf the variant renderings', () => {
    assert.deepEqual(Event.json(), {
      oneOf: [
        {
          type: 'object',
          properties: { kind: { const: 'item' }, id: { type: 'string' } },
          required: ['kind', 'id'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { kind: { const: 'note' }, text: { type: 'string', minLength: 1 } },
          required: ['kind', 'text'],
          additionalProperties: false,
        },
      ],
    });
  });

  void test('the inferred type narrows on the tag', () => {
    const e = must(Event, { kind: 'item', id: 'F9' }, 'event');
    const described = e.kind === 'item' ? `item ${e.id}` : `note ${e.text}`;
    assert.equal(described, 'item F9');
  });
});

// ---- isRecord, formatIssues, must, parseJson ---------------------------------------------------------------------------

void describe('isRecord()', () => {
  void test('is true only for non-null, non-array objects', () => {
    assert.deepEqual(
      [{}, { a: 1 }, [], null, 'x', 1, undefined].map((v) => isRecord(v)),
      [true, true, false, false, false, false, false],
    );
  });
});

void describe('formatIssues()', () => {
  void test('renders one "path: message" line per issue', () => {
    assert.equal(
      formatIssues([
        { path: '$.a', message: 'required' },
        { path: '$.b[0]', message: 'unknown field' },
      ]),
      '$.a: required\n$.b[0]: unknown field',
    );
  });

  void test('renders no issues as the empty string', () => {
    assert.equal(formatIssues([]), '');
  });
});

void describe('must()', () => {
  const Pair = object({ a: string(), b: integer() });

  void test('returns the parsed value when the input is valid', () => {
    assert.deepEqual(must(Pair, { a: 'x', b: 1 }, 'pair'), { a: 'x', b: 1 });
  });

  void test('throws a BoundaryError carrying every issue', () => {
    const err = assertBoundary(() => must(Pair, { c: true }, 'pair'));
    assert.deepEqual(
      [...err.issues].sort((x, y) => x.path.localeCompare(y.path)),
      [
        { path: '$.a', message: 'required' },
        { path: '$.b', message: 'required' },
        { path: '$.c', message: 'unknown field' },
      ],
    );
  });

  void test('the error message names what was malformed and lists each issue on its own line', () => {
    const err = assertBoundary(() => must(Pair, { a: 'x' }, 'progress state'));
    assert.equal(err.message, 'progress state is malformed:\n$.b: required');
  });

  void test('the BoundaryError is an Error named BoundaryError', () => {
    const err = assertBoundary(() => must(string(), 1, 'x'));
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'BoundaryError');
  });
});

void describe('parseJson()', () => {
  void test('returns the parsed value of valid JSON', () => {
    assert.deepEqual(parseJson('{"a":[1,2,{"b":null}]}', 'f.json'), { a: [1, 2, { b: null }] });
    assert.equal(parseJson('null', 'f.json'), null);
    assert.equal(parseJson(' 12 ', 'f.json'), 12);
  });

  void test('throws a BoundaryError naming the source when the text is not JSON', () => {
    const err = assertBoundary(() => parseJson('{a:1}', 'state.json'));
    assert.match(err.message, /^state\.json is not JSON: /);
    assert.deepEqual(err.issues, [{ path: '$', message: 'not JSON' }]);
  });

  void test('treats empty text, a trailing comma and a bare word as not JSON', () => {
    for (const text of ['', '[1,]', 'undefined', '{"a":1']) {
      assert.deepEqual(
        assertBoundary(() => parseJson(text, 'x')).issues,
        [{ path: '$', message: 'not JSON' }],
        `text ${JSON.stringify(text)}`,
      );
    }
  });
});

// ---- parseArgs ---------------------------------------------------------------------------------------------------------

void describe('parseArgs()', () => {
  void test('an empty argv has no positionals, flags or booleans', () => {
    const a = parseArgs([]);
    assert.deepEqual(a.positionals, []);
    assert.equal(a.flags.size, 0);
    assert.equal(a.bools.size, 0);
  });

  void test('collects positionals in order', () => {
    assert.deepEqual(parseArgs(['log', 'open', 'extra']).positionals, ['log', 'open', 'extra']);
  });

  void test('a boolean flag is recorded without consuming the next token', () => {
    const a = parseArgs(['status', '--json', 'more']);
    assert.deepEqual(a.positionals, ['status', 'more']);
    assert.deepEqual([...a.bools], ['json']);
    assert.equal(a.flags.size, 0);
  });

  void test('a value flag takes the next token as its value', () => {
    const a = parseArgs(['preflight', '--home', 'wiki/blueprint', 'tail']);
    assert.deepEqual(a.flags.get('home'), ['wiki/blueprint']);
    assert.deepEqual(a.positionals, ['preflight', 'tail']);
  });

  void test('--name=value gives the value after the first "="', () => {
    const a = parseArgs(['--home=wiki', '--quote=a=b=c']);
    assert.deepEqual(a.flags.get('home'), ['wiki']);
    assert.deepEqual(a.flags.get('quote'), ['a=b=c']);
  });

  void test('--name= gives an empty value', () => {
    assert.deepEqual(parseArgs(['--home=']).flags.get('home'), ['']);
  });

  void test('a value flag takes the next token even when it begins with dashes', () => {
    // args.ts:12: everything that is not a boolean flag "takes the next token".
    const a = parseArgs(['--quote', '--not-a-flag', '--json']);
    assert.deepEqual(a.flags.get('quote'), ['--not-a-flag']);
    assert.deepEqual([...a.bools], ['json']);
  });

  void test('a repeated value flag keeps every value in order, across both spellings', () => {
    assert.deepEqual(parseArgs(['--group', 'a', '--group=b', '--group', 'c']).flags.get('group'), ['a', 'b', 'c']);
  });

  void test('a repeated boolean flag is recorded once', () => {
    assert.deepEqual([...parseArgs(['--json', '--json']).bools], ['json']);
  });

  void test('"--" ends flag parsing: every later token is a positional, verbatim', () => {
    const a = parseArgs(['quote', '--', '--json', '--home=x', '-v', '--']);
    assert.deepEqual(a.positionals, ['quote', '--json', '--home=x', '-v', '--']);
    assert.equal(a.bools.size, 0);
    assert.equal(a.flags.size, 0);
  });

  void test('a trailing "--" adds no positional', () => {
    assert.deepEqual(parseArgs(['hash', '--']).positionals, ['hash']);
  });

  void test('single-dash tokens are positionals', () => {
    assert.deepEqual(parseArgs(['-', '-x']).positionals, ['-', '-x']);
  });

  void test('a value flag at the end with no value is a usage error naming the flag', () => {
    assertUsage(() => parseArgs(['preflight', '--home']), /^--home needs a value$/);
  });

  void test('a boolean flag given a value is a usage error', () => {
    assertUsage(() => parseArgs(['--json=true']), /^--json takes no value$/);
    assertUsage(() => parseArgs(['--force=']), /^--force takes no value$/);
  });

  void test('a flag with no name is a usage error', () => {
    assertUsage(() => parseArgs(['--=x']), /malformed flag "--=x"/);
  });
});

// ---- accessors ---------------------------------------------------------------------------------------------------------

void describe('flag()', () => {
  void test('is undefined when the flag is absent', () => {
    assert.equal(flag(parseArgs(['x']), 'home'), undefined);
  });

  void test('returns the single value', () => {
    assert.equal(flag(parseArgs(['--home', 'h']), 'home'), 'h');
  });

  void test('a flag given twice is a usage error naming the count', () => {
    assertUsage(
      () => flag(parseArgs(['--home', 'a', '--home', 'b']), 'home'),
      /--home was given 2 times; it takes one value/,
    );
  });
});

void describe('flagAll()', () => {
  void test('is empty when the flag is absent', () => {
    assert.deepEqual(flagAll(parseArgs([]), 'group'), []);
  });

  void test('returns every value in the order given', () => {
    assert.deepEqual(flagAll(parseArgs(['--group', 'z', '--group', 'a']), 'group'), ['z', 'a']);
  });
});

void describe('requireFlag()', () => {
  void test('returns the value when present', () => {
    assert.equal(requireFlag(parseArgs(['--page', 'abc']), 'page'), 'abc');
  });

  void test('an absent flag is a usage error that carries the hint', () => {
    const err = assertUsage(() => requireFlag(parseArgs([]), 'page', 'pass the page id'), /^--page is required$/);
    assert.equal(err.hint, 'pass the page id');
  });

  void test('an absent flag without a hint has no hint', () => {
    assert.equal(assertUsage(() => requireFlag(parseArgs([]), 'page'), /required/).hint, undefined);
  });

  void test('an empty value counts as missing', () => {
    assertUsage(() => requireFlag(parseArgs(['--page=']), 'page'), /^--page is required$/);
  });
});

void describe('intFlag()', () => {
  void test('is undefined when the flag is absent', () => {
    assert.equal(intFlag(parseArgs([]), 'sitting'), undefined);
  });

  void test('parses non-negative decimal integers, leading zeros included', () => {
    assert.deepEqual(
      ['0', '42', '007'].map((v) => intFlag(parseArgs(['--sitting', v]), 'sitting')),
      [0, 42, 7],
    );
  });

  void test('rejects anything that is not a run of decimal digits', () => {
    for (const v of ['-1', '+3', '1.5', '', ' 3', '3 ', '1e3', '0x10', 'three']) {
      assertUsage(() => intFlag(parseArgs([`--sitting=${v}`]), 'sitting'), /--sitting must be a non-negative integer/);
    }
  });

  void test('the rejection quotes the value it got', () => {
    assertUsage(() => intFlag(parseArgs(['--sitting', 'two']), 'sitting'), /got "two"/);
  });
});

void describe('requireInt()', () => {
  void test('returns the number when present', () => {
    assert.equal(requireInt(parseArgs(['--drafted', '12']), 'drafted'), 12);
  });

  void test('an absent flag is a usage error saying it is required', () => {
    assertUsage(() => requireInt(parseArgs([]), 'drafted'), /^--drafted is required$/);
  });

  void test('a non-integer value is a usage error, not "required"', () => {
    assertUsage(() => requireInt(parseArgs(['--drafted', 'x']), 'drafted'), /non-negative integer/);
  });
});

void describe('bool()', () => {
  void test('is true only when the boolean flag was given', () => {
    const a = parseArgs(['--soft']);
    assert.equal(bool(a, 'soft'), true);
    assert.equal(bool(a, 'json'), false);
  });

  void test('is false for a value flag of the same name', () => {
    assert.equal(bool(parseArgs(['--home', 'x']), 'home'), false);
  });
});

void describe('oneOfFlag()', () => {
  void test('is undefined when the flag is absent', () => {
    assert.equal(oneOfFlag(parseArgs([]), 'mode', MODES), undefined);
  });

  void test('returns an allowed value', () => {
    for (const m of MODES) assert.equal(oneOfFlag(parseArgs(['--mode', m]), 'mode', MODES), m);
  });

  void test('a value outside the list is a usage error that lists the allowed values', () => {
    const err = assertUsage(() => oneOfFlag(parseArgs(['--mode', 'hard']), 'mode', MODES), /--mode must be one of/);
    for (const m of MODES) assert.ok(err.message.includes(m), `message should list ${m}`);
    assert.match(err.message, /got "hard"/);
  });

  void test('the match is exact: a case variant is refused', () => {
    assertUsage(
      () => oneOfFlag(parseArgs(['--state', 'closed']), 'state', ['CLOSED', 'PAUSED'] as const),
      /must be one of/,
    );
  });

  void test('a flag given twice is refused before membership is checked', () => {
    assertUsage(() => oneOfFlag(parseArgs(['--mode', 'soft', '--mode', 'force']), 'mode', MODES), /given 2 times/);
  });
});

// ---- the CLI seam: boundary failures become usage exits (DESIGN.md §7) ------------------------------------------------

void describe('bp at the argument and JSON boundaries', () => {
  void test('a value flag missing its value exits 2 with the message on stderr', () => {
    const r = run(['preflight', '--home']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /--home needs a value/);
    assert.equal(r.out, '');
  });

  void test('a boolean flag given a value exits 2', () => {
    const r = run(['help', '--json=yes']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /--json takes no value/);
  });

  void test('a JSON file that does not parse exits 2 naming the file', () => {
    const path = writeFile(join(tempDir(), 'progress.json'), '{ not json');
    const r = run(['progress', '--json-file', path]);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /is not JSON/);
    assert.ok(r.err.includes(path));
  });

  void test('an unknown flag exits 2, naming it and the flags the command takes', () => {
    const r = run(['runid', '--bogus', 'x']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /bp runid: unknown flag --bogus/);
    assert.match(r.err, /takes .*--json/);
    assert.equal(r.out, '');
  });

  void test('a flag another command takes is still refused by a command that does not take it', () => {
    // --page belongs to hash and quote; progress takes --json-file and the global flags only (flags are per command).
    const r = run(['progress', '--page', 'x']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /unknown flag --page/);
  });

  void test('several unknown flags are all named in one refusal', () => {
    const r = run(['version', '--foo', '1', '--bar', '2']);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /unknown flags --foo, --bar/);
  });

  void test('a global flag is accepted by every command', () => {
    const r = run(['version', '--json'], { skillRoot: writeVersionRoot('38') });
    assert.equal(r.code, EXIT.ok, r.err);
  });

  void test('a JSON file of the wrong shape exits 2 listing the issues', () => {
    const path = writeFile(join(tempDir(), 'progress.json'), JSON.stringify({ command: 'resolve', surprise: 1 }));
    const r = run(['progress', '--json-file', path]);
    assert.equal(r.code, EXIT.usage);
    assert.match(r.err, /progress state is malformed/);
    assert.match(r.err, /\$\.runId: required/);
    assert.match(r.err, /\$\.surprise: unknown field/);
  });
});
