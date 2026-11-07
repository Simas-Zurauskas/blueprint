# The Blueprint charter — a two-minute guide

The rules live in [`spec/charter.md`](spec/charter.md). This page is for the person writing one.

## What it is

An optional note telling Blueprint how far this project is going, so it questions to the right depth. **No charter
means today's behaviour: everything at full depth.** It is yours, not the client's, and it never appears in the
Blueprint — clients see only the overview's `This release` block, which comes from the sources.

## When to write one

| You are… | stage | Typical Leave out |
|---|---|---|
| Shaping an idea, nothing built yet | `idea` | money, privacy, platforms, store, scale |
| Building a demo or clickable prototype | `prototype` | accessibility, analytics, money |
| Shipping an MVP to invited testers (TestFlight, internal links) | `mvp-private` | accessibility, analytics, scale |
| Launching publicly or on the app stores | `mvp-public` | only what you truly mean to skip, e.g. accessibility, analytics |

## How

- **Talk it through:** `/blueprint charter we're building a TestFlight MVP for 30 testers, no accessibility or analytics`.
  It drafts the file, asks you at most five questions, and writes it when you say so.
- **Or copy the template** [`templates/charter.md`](templates/charter.md) to `wiki-{project}/blueprint/charter.md` and fill it in.

Sections: `stage` · `Release` (who gets it, how) · `Go deep` (question hard) · `Leave out` (skip this release) ·
`Notes` (never read as rules). Use the topic words listed in the template; free text works, and every run tells you
how it read it.

## What it cannot switch off

Whether any regulation applies (asked once, as one question) · minors' data · retention where user data is stored ·
contradictions between sources · anything a source or the client asks for by name · any check. Writing *legal* in
Leave out does not mean zero legal questions — it means one, not a sweep.

## Changing it

Edit the file or run `/blueprint charter` again. **Narrowing** never deletes anything: the next run lists the open
questions you may want to close. **Widening** brings left-out topics back: the next questions run adds one extra
check across the whole document.

## Removing it

`/blueprint charter off`. Deleting the file by hand is not enough — the next run stops and asks, so a lost file never
silently turns a lean project back into a full-depth one.

## Checking it

`/blueprint status` shows the stage, when it last changed, and what was not examined because of it.
