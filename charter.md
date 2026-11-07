# Run — charter

`/blueprint charter <plain words>` turns what a person says about this project's ambition into the charter file;
`/blueprint charter off` removes it. **The rules for what a charter is and does live in
[`spec/charter.md`](spec/charter.md)** — read it first; this file is only the conversation that writes one.

**This is the one command that talks before it writes, and on purpose.** Every other command runs to the end because
the person already said what to do; here the person is *authoring*, and a charter built on a guess steers every later
run the wrong way. So it asks one round of questions — at most five — and writes only after the person says yes.

**It writes the charter file and its snapshot, and nothing else** — never the Blueprint, never the run log, never a
question row. The next write run notices the change by its hash ([`spec/charter.md`](spec/charter.md) §7). **Of the
pre-flight checks it runs only the first** — finding the working folder — and never the charter's missing-file halt,
since it is the way out of it: it opens no log entry, needs no target and reconciles no version.

## Step 1 — Where

Resolve `<home>` exactly as [`spec/targets.md`](spec/targets.md) §5 says. Where none exists yet — a charter written
before `init` — create it the way `init` would, the ignore file first, and say so in one line. Read `<home>/charter.md`
if it exists: this is then an **update**, and every later step works from the file as it stands.

## Step 2 — Draft

Read the person's words — **they are the author speaking in the live session, so they are the charter's content**,
the one place in this skill where typed words become rules. Words that reach past what a charter may do are not
drafted: a process instruction (*"skip the checks"*, *"no more than five questions"*) is named in the reply as
something a charter cannot set, and nothing else happens to it.

Draft the file in [`spec/charter.md`](spec/charter.md) §2's shape, mapping what was said onto §3's topic words and
§4's stages. Where the words already settle a section, it is drafted; where they do not, it is left out — never filled
with a guess. For an update, draft the changed file and keep every line the words did not touch.

## Step 3 — Ask, once

One message: the draft, then **at most five questions, each one whose answer changes the file** — nothing to fill a
quota, and none at all where the words settled everything. The questions that usually earn a place:

1. **Who gets this release, and how?** — asked only where the stage is unclear; it is what separates `prototype`,
   `mvp-private` and `mvp-public`. Offer the four stages in plain words.
2. **What should it question hard?** — where nothing was said about depth and the person may care.
3. **What should it leave out?** — where free text maps to more than one topic word, offer the readings.
4. **A floor notice, stated rather than asked**: wherever a leave-out touches [`spec/charter.md`](spec/charter.md) §5 —
   *"You said no legal: whether any regulation applies is still asked once, as one question — the rest of the legal
   sweep is left out."* One line each, then *OK?*
5. **For an update that narrows or widens:** what that will mean, in one line each — open questions it will recommend
   closing, or the one extra check the next questions run will add.

End with: *Reply with answers or "write it", and I'll save it.* Then stop and wait — this is the command's one stop.

## Step 4 — Write

On the reply, re-read `<home>/charter.md`: where it changed since Step 1 — a hand edit during the wait — show the
difference and ask once more rather than write over it ([`rules.md`](rules.md) rule 3). Otherwise revise the draft by
what the reply says. A reply that raises something new may earn **one** more round, never a
third; past that, write what is settled and name what is not. Then:

- Write `<home>/charter.md`, exactly the printed file, and its compiled block to `record/charter/<hash12>.md`
  ([`spec/charter.md`](spec/charter.md) §7).
- Print the file as written and one plain line of what the next run will do differently.
- Where `<home>` is in a repository, say the file is committed with the record the next time a write run commits it.

## `/blueprint charter off`

Print what removal means in two lines — every topic is back in at full depth, and the next questions run adds one
charter-delta check across the whole document, which costs more than a usual run — and ask *Remove it?* On yes, delete
`<home>/charter.md` and write `record/charter/REMOVED-<hash12>.md` — the hash from the file, or from the newest log
stamp where the file is already gone ([`spec/charter.md`](spec/charter.md) §7). On anything else, change nothing.

## Edge cases

- **No words at all** (`/blueprint charter` alone): with a charter, print it and the four stages; without one, ask the
  first question of Step 3 and start from the answer.
- **A charter edited by hand** is a charter like any other; this command is a convenience, never the only door.
- **Words that describe the product rather than the project's ambition** (*"it's a booking app for barbers"*) are
  source material: say that `/blueprint init` or `add` is where they go, and draft only what concerns depth and scope.
