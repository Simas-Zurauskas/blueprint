import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SHA12,
  blockText,
  bodyFromWhy,
  hashBody,
  hashText,
  normaliseForHash,
  sha12,
  sha256,
  type Sha256,
} from '../src/core/hash.ts';
import { findMarkers, lines, normaliseWhitespace, quoteCount, quoteFound, type MarkerMatch } from '../src/core/text.ts';
import { FEATURE_BLOCKS, OVERVIEW_BLOCKS } from '../src/domain/vocab.ts';
import { tempDir, writeFile } from './support/index.ts';

// Scope: src/core/hash.ts (spec/targets.md §5 "Hashing", lines 262-273) and src/core/text.ts (SKILL.md rule 6(d),
// line 310; spec/notion-mechanics.md §3 "marker bracket escape", lines 97-104; spec/doc-shape.md §9, lines 392-433).
//
// Every digest below was computed outside the code under test, with `shasum -a 256` (macOS) over bytes written by
// `printf` or a quoted heredoc. The command is quoted next to each literal. sha256("abc") and sha256("") are the
// published FIPS 180-2 vectors.

/** sha256("abc"): the FIPS 180-2 test vector. */
const SHA_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
/** sha256(""): the published empty-input vector; `printf '' | shasum -a 256`. */
const SHA_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
/** `printf 'abc\n' | shasum -a 256` */
const SHA_ABC_LF = 'edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb';
/** `printf 'abc\r\n' | shasum -a 256` */
const SHA_ABC_CRLF = '552bab6864c7a7b69a502ed1854b9245c0e1a30f008aaa0b281da62585fdb025';
/** `printf '\xc3\xa9' | shasum -a 256`: "é" as UTF-8. */
const SHA_E_ACUTE_UTF8 = '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c';
/** `printf '\xe9' | shasum -a 256`: "é" as Latin-1, the wrong encoding. */
const SHA_E_ACUTE_LATIN1 = 'de2e331d891ae267a7009cb45b4e8830f170e0c937288ea2731a1941c7a53b0d';
/** `printf '\xe2\x86\x92' | shasum -a 256`: "→" as UTF-8. */
const SHA_ARROW_UTF8 = '161660030aa6c9e32470cc1c023dab32dc748d80b0e61882b368cb775d12638e';
/** `printf '\xff\xfe' | shasum -a 256`: two bytes that are not valid UTF-8. */
const SHA_FF_FE = 'b3d510ef04275ca8e698e5b3cbb0ece3949ef9252f0cdc839e9ee347409a2209';

/** A feature body, already normal: LF endings, no trailing whitespace. */
const BODY = '## Why\nCustomers pick a pickup slot.\n\n## Behaviour\n1. **FR-1** A slot is held for 10 minutes.\n';
/** `printf '## Why\nCustomers pick a pickup slot.\n\n## Behaviour\n1. **FR-1** A slot is held for 10 minutes.\n' | shasum -a 256` */
const SHA_BODY = '90c3cbf8f2da120f00b17f6ccab2eefc6a93b53ea8c204aa488d2d3aaaee1442';
/** The Why block of BODY: its heading through the blank line before `## Behaviour`.
 * `printf '## Why\nCustomers pick a pickup slot.\n' | shasum -a 256` */
const SHA_WHY_BLOCK = 'b71f63efcba7f040ce220e5e8a98d735d0a744fe787cb0bf9d996852bb66a988';

const MARKER_QUESTION = 'can a customer change a pickup slot after paying? → Question: carried';
/** A body holding one marker as a Notion fetch returns it, brackets escaped (notion-mechanics §3). Written with a quoted
 * heredoc (`cat > esc.txt <<'EOF'`, which adds the final newline), then `shasum -a 256 < esc.txt`. */
const ESCAPED_MARKER_BODY = `## Why\n\\[NEEDS CLARIFICATION: ${MARKER_QUESTION}\\]\n`;
const SHA_ESCAPED_MARKER_BODY = 'f241e2aaa7a3a2a5137a0f7ed696d17c4c248650999f2a60c1d65a6918b8dcc3';
/** The same body with the marker unescaped, hashed the same way. */
const SHA_PLAIN_MARKER_BODY = 'ba458ea2b591a684ac7ebb22afd524355a58ab2b83b726eb7ee9c8c723770fb0';

/** The read-out line (targets §4): a projection prepended on read, never body text. */
const READ_OUT = '«Checkout» · Ordering';

// ---- sha256 / sha12 / SHA12 ----------------------------------------------------------------------------------------

void describe('sha256: SHA-256 over UTF-8 bytes (targets §5)', () => {
  void test('hashes "abc" to the published SHA-256 test vector', () => {
    assert.equal(sha256('abc'), SHA_ABC);
  });

  void test('hashes the empty string to the published empty-input digest', () => {
    assert.equal(sha256(''), SHA_EMPTY);
  });

  void test('encodes a non-ASCII string as UTF-8 before hashing', () => {
    assert.equal(sha256('é'), SHA_E_ACUTE_UTF8);
    assert.notEqual(sha256('é'), SHA_E_ACUTE_LATIN1);
  });

  void test('encodes a character outside Latin-1 as UTF-8 before hashing', () => {
    assert.equal(sha256('→'), SHA_ARROW_UTF8);
  });

  void test('hashes a string exactly as given, with no line-ending normalisation', () => {
    assert.equal(sha256('abc\r\n'), SHA_ABC_CRLF);
  });

  void test('hashes a byte source as raw bytes, even when they are not valid UTF-8', () => {
    assert.equal(sha256(new Uint8Array([0xff, 0xfe])), SHA_FF_FE);
  });

  void test('hashes a captured file source by its bytes exactly, CRLF included', () => {
    const path = writeFile(join(tempDir(), 'sources', 'run-1', 'notes.txt'), 'abc\r\n');
    assert.equal(sha256(readFileSync(path)), SHA_ABC_CRLF);
  });

  void test('writes the digest as 64 lowercase hex characters', () => {
    assert.match(sha256('Customers pick a pickup slot.'), /^[0-9a-f]{64}$/);
  });
});

void describe('sha12: the run-log form of a hash (targets §5)', () => {
  void test('is the first 12 hex characters of the full digest', () => {
    assert.equal(sha12(SHA_ABC as Sha256), 'ba7816bf8f01');
  });

  void test('shortens a body hash to its first 12 characters', () => {
    assert.equal(sha12(SHA_BODY as Sha256), '90c3cbf8f2da');
  });
});

void describe('SHA12: the shape check for a 12-hex run-log hash', () => {
  void test('accepts twelve lowercase hex characters', () => {
    assert.equal(SHA12.test('ba7816bf8f01'), true);
  });

  void test('rejects uppercase hex', () => {
    assert.equal(SHA12.test('BA7816BF8F01'), false);
  });

  void test('rejects eleven or thirteen characters', () => {
    assert.equal(SHA12.test('ba7816bf8f0'), false);
    assert.equal(SHA12.test('ba7816bf8f01c'), false);
  });

  void test('rejects a full 64-character digest', () => {
    assert.equal(SHA12.test(SHA_ABC), false);
  });

  void test('rejects non-hex characters and the elided sample form', () => {
    assert.equal(SHA12.test('ba7816bf8f0g'), false);
    assert.equal(SHA12.test('9f2c…41d'), false);
  });
});

// ---- normaliseForHash ----------------------------------------------------------------------------------------------

void describe('normaliseForHash: line endings to \\n, trailing whitespace stripped (targets §5)', () => {
  void test('turns CRLF line endings into LF', () => {
    assert.equal(normaliseForHash('a\r\nb\r\nc'), 'a\nb\nc');
  });

  void test('turns a lone CR into LF', () => {
    assert.equal(normaliseForHash('a\rb'), 'a\nb');
  });

  void test('strips trailing spaces and tabs from every line', () => {
    assert.equal(normaliseForHash('a  \nb\t\nc \t '), 'a\nb\nc');
  });

  void test('strips trailing whitespace that sits before a CRLF', () => {
    assert.equal(normaliseForHash('a \t\r\nb'), 'a\nb');
  });

  void test('keeps leading indentation and whitespace inside a line', () => {
    assert.equal(normaliseForHash('  a  b\t c'), '  a  b\t c');
  });

  void test('keeps blank lines and the final newline', () => {
    assert.equal(normaliseForHash('a\n\n\nb\n'), 'a\n\n\nb\n');
  });

  void test('reduces a whitespace-only line to an empty line', () => {
    assert.equal(normaliseForHash('a\n \t \nb'), 'a\n\nb');
  });

  void test('leaves text that is already normal unchanged', () => {
    assert.equal(normaliseForHash(BODY), BODY);
  });
});

// ---- bodyFromWhy ---------------------------------------------------------------------------------------------------

void describe('bodyFromWhy: the feature body is from ## Why to the end (targets §5)', () => {
  void test('returns everything from the ## Why line to the end of the content', () => {
    assert.equal(bodyFromWhy('## Why\nw\n## Behaviour\nb'), '## Why\nw\n## Behaviour\nb');
  });

  void test('never includes the read-out line above ## Why', () => {
    assert.equal(bodyFromWhy(`${READ_OUT}\n## Why\nw\n`), '## Why\nw\n');
  });

  void test('drops any other text that stands above ## Why', () => {
    assert.equal(bodyFromWhy('stray preamble\n\n## Why\nw'), '## Why\nw');
  });

  void test('returns undefined when the content has no ## Why heading', () => {
    assert.equal(bodyFromWhy('## Behaviour\n1. **FR-1** b\n'), undefined);
  });

  void test('returns undefined for empty content', () => {
    assert.equal(bodyFromWhy(''), undefined);
  });

  void test('does not take a ### Why sub-heading as the start of the body', () => {
    assert.equal(bodyFromWhy('### Why\nw\n'), undefined);
  });

  void test('does not take a heading that only begins with the word Why', () => {
    assert.equal(bodyFromWhy('## Why not\nw\n'), undefined);
  });

  void test('does not take ## Why written in the middle of a line', () => {
    assert.equal(bodyFromWhy('see ## Why below\n'), undefined);
  });

  void test('accepts trailing whitespace on the ## Why heading line', () => {
    assert.equal(bodyFromWhy(`${READ_OUT}\n## Why \t\nw`), '## Why \t\nw');
  });

  void test('starts at the first ## Why when the content has two', () => {
    assert.equal(bodyFromWhy('x\n## Why\none\n## Why\ntwo'), '## Why\none\n## Why\ntwo');
  });

  void test('returns the body with CRLF line endings turned into LF', () => {
    assert.equal(bodyFromWhy(`${READ_OUT}\r\n## Why\r\nw\r\n`), '## Why\nw\n');
  });
});

// ---- hashBody ------------------------------------------------------------------------------------------------------

void describe('hashBody: SHA-256 of the normalised body (targets §5)', () => {
  void test('hashes the body from ## Why to the end', () => {
    assert.equal(hashBody(BODY), SHA_BODY);
  });

  void test('gives the same digest when the read-out line is prepended', () => {
    assert.equal(hashBody(`${READ_OUT}\n${BODY}`), SHA_BODY);
  });

  void test('gives the same digest when the target returns CRLF line endings', () => {
    assert.equal(hashBody(BODY.replace(/\n/g, '\r\n')), SHA_BODY);
  });

  void test('gives the same digest when lines carry trailing spaces and tabs', () => {
    const padded =
      '## Why  \nCustomers pick a pickup slot.\t\n \n## Behaviour \t\n1. **FR-1** A slot is held for 10 minutes. \n';
    assert.equal(hashBody(padded), SHA_BODY);
  });

  void test('hashes a Notion-escaped marker as returned, backslashes included', () => {
    assert.equal(hashBody(ESCAPED_MARKER_BODY), SHA_ESCAPED_MARKER_BODY);
    assert.notEqual(hashBody(ESCAPED_MARKER_BODY), SHA_PLAIN_MARKER_BODY);
  });

  void test('hashes an unescaped marker body to its own digest', () => {
    assert.equal(hashBody(`## Why\n[NEEDS CLARIFICATION: ${MARKER_QUESTION}]\n`), SHA_PLAIN_MARKER_BODY);
  });

  void test('returns undefined for content with no ## Why heading', () => {
    assert.equal(hashBody(`${READ_OUT}\n## Behaviour\n1. **FR-1** b\n`), undefined);
  });
});

// ---- blockText -----------------------------------------------------------------------------------------------------

/** A body with a read-out line, a sub-heading inside Behaviour, and CR-free endings. */
const BLOCKS_BODY = `${READ_OUT}\n## Why\nw1\nw2\n\n## Behaviour\n1. **FR-1** b\n### Detail\nd\n## Edge cases\ne\n`;

void describe('blockText: a block is its ## heading up to the next ## heading (targets §5, DESIGN §6)', () => {
  void test('returns the first block from its heading to the line before the next ## heading', () => {
    assert.equal(blockText(BLOCKS_BODY, 'Why'), '## Why\nw1\nw2\n');
  });

  void test('does not end a block at a ### sub-heading', () => {
    assert.equal(blockText(BLOCKS_BODY, 'Behaviour'), '## Behaviour\n1. **FR-1** b\n### Detail\nd');
  });

  void test('returns the last block through to the end of the content', () => {
    assert.equal(blockText(BLOCKS_BODY, 'Edge cases'), '## Edge cases\ne\n');
  });

  void test('returns undefined for a heading the content does not have', () => {
    assert.equal(blockText(BLOCKS_BODY, 'Not doing'), undefined);
  });

  void test('matches the heading name exactly, not as a prefix', () => {
    assert.equal(blockText('## Behaviour notes\nb\n', 'Behaviour'), undefined);
  });

  void test('does not match a ### heading of the same name', () => {
    assert.equal(blockText('## Why\nw\n### Behaviour\nb\n', 'Behaviour'), undefined);
  });

  void test('finds a heading line that carries trailing whitespace', () => {
    assert.equal(blockText('## Why \t\nw\n## Behaviour\nb', 'Why'), '## Why \t\nw');
  });

  void test('returns the block with CRLF line endings turned into LF', () => {
    assert.equal(blockText('## Why\r\nw\r\n## Behaviour\r\nb', 'Why'), '## Why\nw');
  });

  void test('finds every feature-body block by its doc-shape §5 name', () => {
    const body = FEATURE_BLOCKS.map((b) => `## ${b}\n${b} text`).join('\n');
    for (const b of FEATURE_BLOCKS) assert.equal(blockText(body, b), `## ${b}\n${b} text`, b);
  });

  void test('finds overview blocks whose names carry punctuation', () => {
    const overview = OVERVIEW_BLOCKS.map((b) => `## ${b}\nabout ${b}`).join('\n');
    for (const b of OVERVIEW_BLOCKS) assert.equal(blockText(overview, b), `## ${b}\nabout ${b}`, b);
  });

  void test('a block hash is the SHA-256 of the normalised block text', () => {
    const why = blockText(BODY, 'Why');
    assert.equal(why, '## Why\nCustomers pick a pickup slot.\n');
    assert.equal(hashText(why ?? ''), SHA_WHY_BLOCK);
  });
});

// ---- hashText ------------------------------------------------------------------------------------------------------

void describe('hashText: a property or block hashed with the same normalisation (targets §5)', () => {
  void test('hashes text that is already normal to its plain SHA-256', () => {
    assert.equal(hashText('abc'), SHA_ABC);
  });

  void test('strips trailing whitespace before hashing', () => {
    assert.equal(hashText('abc \t '), SHA_ABC);
  });

  void test('turns CRLF into LF before hashing', () => {
    assert.equal(hashText('abc\r\n'), SHA_ABC_LF);
  });

  void test('turns a lone CR into LF before hashing', () => {
    assert.equal(hashText('abc\r'), SHA_ABC_LF);
  });

  void test('strips trailing whitespace before a CRLF before hashing', () => {
    assert.equal(hashText('abc  \r\n'), SHA_ABC_LF);
  });

  void test('hashes the empty string to the empty-input digest', () => {
    assert.equal(hashText(''), SHA_EMPTY);
  });
});

// ---- normaliseWhitespace / quoteFound / quoteCount (SKILL.md rule 6(d)) --------------------------------------------

void describe('normaliseWhitespace: rule 6(d) collapses runs of spaces, newlines and tabs', () => {
  void test('collapses a run of spaces to one space', () => {
    assert.equal(normaliseWhitespace('a    b'), 'a b');
  });

  void test('collapses a mixed run of newlines and tabs to one space', () => {
    assert.equal(normaliseWhitespace('a\n\t\n  b\tc'), 'a b c');
  });

  void test('counts a carriage return as whitespace', () => {
    assert.equal(normaliseWhitespace('a\r\nb\rc'), 'a b c');
  });

  void test('drops leading and trailing whitespace', () => {
    assert.equal(normaliseWhitespace('\n\t a b \n'), 'a b');
  });

  void test('folds nothing else: case, punctuation and escapes stand', () => {
    assert.equal(normaliseWhitespace('Slot,  \\[NEEDS\\]  ok?'), 'Slot, \\[NEEDS\\] ok?');
  });

  void test('reduces whitespace-only text to the empty string', () => {
    assert.equal(normaliseWhitespace(' \n\t\r '), '');
  });
});

/** An entity's text with the line breaks and runs of spaces a target returns. */
const ENTITY = 'Customers pick a\npickup   slot.\n\n1. **FR-1** A slot is\theld for 10 minutes.';

void describe('quoteFound: a citation stands when the quote occurs in the entity (rule 6(d))', () => {
  void test('matches a quote whose whitespace differs from the entity', () => {
    assert.equal(quoteFound(ENTITY, 'a pickup slot. 1. **FR-1** A slot is held'), true);
  });

  void test('matches a quote copied with surrounding line breaks', () => {
    assert.equal(quoteFound(ENTITY, '\n  Customers pick a pickup slot.\n'), true);
  });

  void test('does not match when the quote has whitespace the entity lacks', () => {
    assert.equal(quoteFound('pickupslot', 'pickup slot'), false);
  });

  void test('does not match when the quote drops whitespace the entity has', () => {
    assert.equal(quoteFound(ENTITY, 'pickupslot'), false);
  });

  void test('does not match when the case differs', () => {
    assert.equal(quoteFound(ENTITY, 'customers pick a pickup slot'), false);
  });

  void test('does not match when the punctuation differs', () => {
    assert.equal(quoteFound(ENTITY, 'pickup slot!'), false);
  });

  void test('does not match a quote against its Notion-escaped form', () => {
    assert.equal(quoteFound('\\[NEEDS CLARIFICATION: x\\]', '[NEEDS CLARIFICATION: x]'), false);
  });

  void test('matches a quote containing non-ASCII characters', () => {
    assert.equal(quoteFound(`slot?  →\nQuestion: carried`, 'slot? → Question: carried'), true);
  });

  void test('never matches an empty quote', () => {
    assert.equal(quoteFound(ENTITY, ''), false);
  });

  void test('never matches a whitespace-only quote', () => {
    assert.equal(quoteFound(ENTITY, ' \n\t '), false);
  });

  void test('does not match a quote longer than the entity', () => {
    assert.equal(quoteFound('slot', 'pickup slot'), false);
  });
});

void describe('quoteCount: how many times a quote occurs under rule 6(d)', () => {
  void test('counts every occurrence across whitespace variants', () => {
    assert.equal(quoteCount('pickup slot\npickup  slot\tpickup\n\nslot', 'pickup slot'), 3);
  });

  void test('counts occurrences without overlap', () => {
    assert.equal(quoteCount('aaaa', 'aa'), 2);
    assert.equal(quoteCount('ababab', 'abab'), 1);
  });

  void test('returns 0 when the quote is absent', () => {
    assert.equal(quoteCount(ENTITY, 'refund'), 0);
  });

  void test('returns 0 for an empty quote', () => {
    assert.equal(quoteCount(ENTITY, ''), 0);
  });

  void test('returns 0 for a whitespace-only quote', () => {
    assert.equal(quoteCount(ENTITY, '\n \t'), 0);
  });

  void test('returns 1 for a quote that is the whole entity', () => {
    assert.equal(quoteCount(ENTITY, ENTITY.replace(/\s+/g, ' ')), 1);
  });
});

// ---- findMarkers (notion-mechanics §3, doc-shape §9) ---------------------------------------------------------------

void describe('findMarkers: anchored on the words NEEDS CLARIFICATION, never on a literal [NEEDS', () => {
  void test('finds a marker whose brackets Notion escaped on the round trip', () => {
    const text = `Intro. \\[NEEDS CLARIFICATION: ${MARKER_QUESTION}\\]`;
    const expected: MarkerMatch[] = [
      // "Intro. " is 7 characters, so the escaping backslash sits at offset 7.
      { raw: `\\[NEEDS CLARIFICATION: ${MARKER_QUESTION}\\]`, inner: MARKER_QUESTION, index: 7, terminated: true },
    ];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('finds a plain-bracket marker as a local target writes it', () => {
    const text = `[NEEDS CLARIFICATION: ${MARKER_QUESTION}]`;
    const expected: MarkerMatch[] = [{ raw: text, inner: MARKER_QUESTION, index: 0, terminated: true }];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('finds the doc-shape §9 example marker', () => {
    const inner = 'can a customer change a pickup slot after paying? → Question: <link to the row>';
    const text = `[NEEDS CLARIFICATION: ${inner}]`;
    const expected: MarkerMatch[] = [{ raw: text, inner, index: 0, terminated: true }];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('finds a marker that opens escaped and closes with a plain bracket', () => {
    const text = '\\[NEEDS CLARIFICATION: x → Question: carried]';
    const expected: MarkerMatch[] = [{ raw: text, inner: 'x → Question: carried', index: 0, terminated: true }];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('finds a marker whose opening bracket is missing, and reports it unterminated', () => {
    const text = 'Gap: NEEDS CLARIFICATION: who approves refunds? → Question: carried';
    const expected: MarkerMatch[] = [
      // "Gap: " is 5 characters; with no bracket the marker starts at the N.
      {
        raw: 'NEEDS CLARIFICATION: who approves refunds? → Question: carried',
        inner: 'who approves refunds? → Question: carried',
        index: 5,
        terminated: false,
      },
    ];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('does not end a marker whose opening bracket is missing at the closing bracket of a link inside it', () => {
    // The question link is what C5 follows (doc-shape §9); a bracketless marker must keep it whole, exactly as the
    // bracketed marker in the next test does. The line ends with no closing bracket, so it is unterminated.
    const text = 'NEEDS CLARIFICATION: x → Question: [q-04](https://app.notion.com/p/0123abcd)';
    const expected: MarkerMatch[] = [
      { raw: text, inner: 'x → Question: [q-04](https://app.notion.com/p/0123abcd)', index: 0, terminated: false },
    ];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('ends a marker whose opening bracket is missing at the first unmatched closing bracket, after its link', () => {
    // The link's own "]" is matched by its "["; the next "]" has no partner, so it closes the marker.
    const marker = 'NEEDS CLARIFICATION: x → Question: [q-04](https://app.notion.com/p/0123abcd)]';
    const text = `Gap: ${marker} after`;
    const expected: MarkerMatch[] = [
      // "Gap: " is 5 characters.
      { raw: marker, inner: 'x → Question: [q-04](https://app.notion.com/p/0123abcd)', index: 5, terminated: true },
    ];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('ends a marker whose opening bracket is missing at an escaped closing bracket, escape included', () => {
    const text = 'NEEDS CLARIFICATION: who approves refunds?\\] tail';
    const expected: MarkerMatch[] = [
      {
        raw: 'NEEDS CLARIFICATION: who approves refunds?\\]',
        inner: 'who approves refunds?',
        index: 0,
        terminated: true,
      },
    ];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('does not end a marker at the closing bracket of a markdown link inside it', () => {
    const inner = `${MARKER_QUESTION.replace(' carried', '')} [q-04](https://app.notion.com/p/0123abcd)`;
    const text = `[NEEDS CLARIFICATION: ${inner}]`;
    const expected: MarkerMatch[] = [{ raw: text, inner, index: 0, terminated: true }];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('does not end an escaped marker at the closing bracket of a markdown link inside it', () => {
    const inner = 'slot change after paying? → Question: [q-04](https://app.notion.com/p/0123abcd)';
    const text = `\\[NEEDS CLARIFICATION: ${inner}\\]`;
    const expected: MarkerMatch[] = [{ raw: text, inner, index: 0, terminated: true }];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('counts escaped link brackets inside an escaped marker by depth', () => {
    const inner = 'slot change? → Question: \\[q-04\\](https://app.notion.com/p/0123abcd)';
    const text = `\\[NEEDS CLARIFICATION: ${inner}\\] after`;
    const expected: MarkerMatch[] = [{ raw: `\\[NEEDS CLARIFICATION: ${inner}\\]`, inner, index: 0, terminated: true }];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('finds a marker whose question link is a Notion mention', () => {
    const inner = 'slot change? → Question: <mention-page url="https://www.notion.so/0123abcd"/>';
    const text = `\\[NEEDS CLARIFICATION: ${inner}\\]`;
    const expected: MarkerMatch[] = [{ raw: text, inner, index: 0, terminated: true }];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('keeps balanced plain brackets inside the marker', () => {
    const inner = 'FR-2 says [TBD] for the cap → Question: carried';
    const text = `[NEEDS CLARIFICATION: ${inner}]`;
    const expected: MarkerMatch[] = [{ raw: text, inner, index: 0, terminated: true }];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('finds a carried marker that cites a contradiction and its run-log entry', () => {
    const inner = 'pickup window length for FR-4 → Question: carried (CON-7 · run-log 2026-08-04-init-1)';
    const text = `\\[NEEDS CLARIFICATION: ${inner}\\]`;
    const expected: MarkerMatch[] = [{ raw: text, inner, index: 0, terminated: true }];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('finds a marker patched to a defaults-ledger line', () => {
    const inner = 'currency display for FR-2 → Default: ledger 2026-08-04-questions-1 #3, awaiting ratification';
    const text = `\\[NEEDS CLARIFICATION: ${inner}\\]`;
    const expected: MarkerMatch[] = [{ raw: text, inner, index: 0, terminated: true }];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('finds several markers on one line, in order, with their offsets', () => {
    const text =
      'A [NEEDS CLARIFICATION: one → Question: carried] B \\[NEEDS CLARIFICATION: two → Question: carried\\] C';
    const expected: MarkerMatch[] = [
      // "A " puts the first bracket at 2; the first marker is 46 characters, so it ends before offset 48, and " B " moves
      // the second marker's backslash to 51.
      {
        raw: '[NEEDS CLARIFICATION: one → Question: carried]',
        inner: 'one → Question: carried',
        index: 2,
        terminated: true,
      },
      {
        raw: '\\[NEEDS CLARIFICATION: two → Question: carried\\]',
        inner: 'two → Question: carried',
        index: 51,
        terminated: true,
      },
    ];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('finds every escaped marker in a multi-line body', () => {
    const one = '\\[NEEDS CLARIFICATION: one → Question: carried\\]';
    const two = '\\[NEEDS CLARIFICATION: two → Question: carried\\]';
    const text = `## Why\nw ${one}\n## Behaviour\n1. **FR-1** x ${two}\n`;
    const expected: MarkerMatch[] = [
      // "## Why\nw " is 9 characters. The first marker is 48 characters (ends at 57), then "\n## Behaviour\n" (14) and
      // "1. **FR-1** x " (14) put the second at 85.
      { raw: one, inner: 'one → Question: carried', index: 9, terminated: true },
      { raw: two, inner: 'two → Question: carried', index: 85, terminated: true },
    ];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('reports a marker whose line ends before its closing bracket as unterminated', () => {
    const text = '[NEEDS CLARIFICATION: who owns the refund? → Question: carried\nThe next line has a bracket]';
    const expected: MarkerMatch[] = [
      {
        raw: '[NEEDS CLARIFICATION: who owns the refund? → Question: carried',
        inner: 'who owns the refund? → Question: carried',
        index: 0,
        terminated: false,
      },
    ];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('reports a marker cut off at the end of the text as unterminated', () => {
    const expected: MarkerMatch[] = [
      { raw: '\\[NEEDS CLARIFICATION: dangling', inner: 'dangling', index: 0, terminated: false },
    ];
    assert.deepEqual(findMarkers('\\[NEEDS CLARIFICATION: dangling'), expected);
  });

  void test('reports a marker whose inner link never closes the outer bracket as unterminated', () => {
    const text = '[NEEDS CLARIFICATION: x → Question: [q-04](https://app.notion.com/p/0123abcd)';
    const expected: MarkerMatch[] = [
      { raw: text, inner: 'x → Question: [q-04](https://app.notion.com/p/0123abcd)', index: 0, terminated: false },
    ];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('stops an unterminated marker at a CRLF line break', () => {
    const [m, ...rest] = findMarkers('[NEEDS CLARIFICATION: dangling\r\nnext]');
    assert.equal(rest.length, 0);
    assert.equal(m?.terminated, false);
    assert.equal(m?.inner, 'dangling');
  });

  void test('finds a marker after an unterminated one on the next line', () => {
    const text = '[NEEDS CLARIFICATION: first\n[NEEDS CLARIFICATION: second]';
    const expected: MarkerMatch[] = [
      { raw: '[NEEDS CLARIFICATION: first', inner: 'first', index: 0, terminated: false },
      // "[NEEDS CLARIFICATION: first" is 27 characters, then the newline: the second marker starts at 28.
      { raw: '[NEEDS CLARIFICATION: second]', inner: 'second', index: 28, terminated: true },
    ];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('leaves text after the closing bracket out of the marker', () => {
    const text = '[NEEDS CLARIFICATION: x → Question: carried] and the rest of the line.';
    const expected: MarkerMatch[] = [
      {
        raw: '[NEEDS CLARIFICATION: x → Question: carried]',
        inner: 'x → Question: carried',
        index: 0,
        terminated: true,
      },
    ];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('counts a marker that mentions the words NEEDS CLARIFICATION inside it once', () => {
    const text = '[NEEDS CLARIFICATION: the old NEEDS CLARIFICATION on FR-3 was vague → Question: carried]';
    const expected: MarkerMatch[] = [
      {
        raw: text,
        inner: 'the old NEEDS CLARIFICATION on FR-3 was vague → Question: carried',
        index: 0,
        terminated: true,
      },
    ];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('gives an empty inner text for a bare [NEEDS CLARIFICATION]', () => {
    const expected: MarkerMatch[] = [{ raw: '[NEEDS CLARIFICATION]', inner: '', index: 0, terminated: true }];
    assert.deepEqual(findMarkers('[NEEDS CLARIFICATION]'), expected);
  });

  void test('offsets a marker after the read-out line by its UTF-16 position', () => {
    const text = `${READ_OUT}\n## Why\n[NEEDS CLARIFICATION: x → Question: carried]`;
    // "«Checkout» · Ordering" is 21 UTF-16 units, "\n## Why\n" adds 8: the marker opens at 29.
    const expected: MarkerMatch[] = [
      {
        raw: '[NEEDS CLARIFICATION: x → Question: carried]',
        inner: 'x → Question: carried',
        index: 29,
        terminated: true,
      },
    ];
    assert.deepEqual(findMarkers(text), expected);
  });

  void test('finds nothing in text without the marker words', () => {
    assert.deepEqual(findMarkers('Plain text with [brackets] and \\[escapes\\], and no gap.'), []);
  });

  void test('finds nothing in empty text', () => {
    assert.deepEqual(findMarkers(''), []);
  });

  void test('does not treat the lowercase words as a marker', () => {
    assert.deepEqual(findMarkers('[needs clarification: x → Question: carried]'), []);
  });
});

// ---- lines ---------------------------------------------------------------------------------------------------------

void describe('lines: split after normalising line endings', () => {
  void test('splits on LF, CRLF and a lone CR alike', () => {
    assert.deepEqual(lines('a\nb\r\nc\rd'), ['a', 'b', 'c', 'd']);
  });

  void test('keeps a trailing empty element after a final newline', () => {
    assert.deepEqual(lines('a\r\n'), ['a', '']);
  });

  void test('returns one empty line for empty text', () => {
    assert.deepEqual(lines(''), ['']);
  });
});
