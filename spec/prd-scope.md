# Spec — what belongs in this document, and what does not

**This file is the single home of the scope boundary.** It is read at question-generation time and
applied to one candidate at a time. Companions: [`doc-shape.md`](doc-shape.md) ·
[`databases.md`](databases.md) · [`targets.md`](targets.md) ·
[`notion-mechanics.md`](notion-mechanics.md) · [`run-progress.md`](run-progress.md).

**Why it exists.** A three-cycle simulation put 36 generated questions to an **LLM operator persona**
standing in for the client. The persona kept **9 of 36**: *"the other twenty-six were you talking to
each other with my name on it."* `[persona-generated]` The generator had no model of its own subject
matter, so it could not tell a question that changes a requirement from one that merely sounds
important. Every rule below is a test, applied to one candidate, that a run can actually run.

**What that evidence is and is not.** No human labelled any of it. The quotations in this file are
persona output, marked `[persona-generated]` where they are quoted as evidence, and they justify a
*test* rather than certifying a result. Whether a real client wants these questions is **not
measured** — see §9.

---

## 1. The delta test — the spine, and it is unconditional

**A question earns a client's attention only if two competing answers to it produce two different
specification sentences.** Write both. If the two sentences are the same sentence with different
adjectives, there is no question.

This is *value of information* in its plain form: a question whose answer cannot change a decision has
value exactly zero, however true or interesting it is (Howard, *Information Value Theory*, IEEE Trans.
SSC-2(1):22–26, 1966). It is also ISO/IEC/IEEE 29148:2018 §5.2.5's **Necessary** characteristic
inverted — *"If it is not included in the set of requirements, a deficiency in capability or
characteristic will exist, which cannot be fulfilled by implementing other requirements."*

**No topic is exempt from this test.** Being client-owned, undefaultable, legally weighty or
commercially sensitive does not substitute for a delta — those properties say *who decides*, never
*whether a decision changes anything here*. **That substitution is the exact leak this file was written
to close.**

**The one exemption, and it is narrow:** a **contradiction between two sources — or inside one
source** is admitted without a delta, because the conflict itself is the defect. Quote both spans with
their locations. *Inside one source counts: a speaker who says thirty minutes and then says something
longer in the same answer has left two readings standing, and which governs is not the run's to pick.*

## 2. The five dispositions — a candidate takes exactly one

| | When | What happens |
|---|---|---|
| **ASK** | It passes §1 and §3, and only the client holds the answer | A question row |
| **DECIDE** | The client stated the **outcome**; only the **mechanism** is open | The builders decide. Recorded as a stated assumption |
| **PROPOSE** | As DECIDE, but the client will want to react to the result | A draft they can correct in one sentence — never a question |
| **RECORD** | The answer is content, a document, or a professional's determination | A named slot in the dependency register: what, what shape, **who supplies it**, by when |

**The professional-determination test, because it is the one that looks most like a requirement**
(v26.1): where the correct answer is fixed by a **professional standard the client does not set** —
an accounting rule, a statutory regime, an auditor's requirement — it is **RECORD with the adviser
named**, even when the answer would land in a named field. *"Does the invoice carry a number from the
bookkeeping series?"* and *"does a withdrawn invoice stay on record?"* both look like schema questions
and are both the accountant's rule; the client cannot answer them and would be guessing if she tried.
**Test: could the person answering this get it right without consulting the profession that owns it?
If not, RECORD with the owner named.**

**The owner may be inside the client's own organisation** (v26.4 — a held-out project failed here:
every example above is an outsider, and that project's owner was its own compliance officer, on the
payroll). **The test is expertise, not employment.** A compliance officer, an in-house counsel or a
finance controller owns their determination exactly as an external adviser does, and *"the client"*
is not one person — it is an organisation with several people in it, only some of whom own any given
answer.

**And split the fact from the posture.** Where a regulated area produces both, they are two
candidates (§7a): the **legal fact** — what the limit is, what the law requires — is the
profession's, RECORD. The **system's posture toward that fact** — does it refuse, warn, or record
after the event — is the client's, ASK. Collapsing them loses the posture question, which is usually
the one that decides the build.
| **DROP** | It fails §1, or §4's materiality floor, **or any §5 out-of-scope row whose destination is not one of the four dispositions above** — a candidate whose home is the design document, the statement of work or the business case leaves this document, and leaving is a DROP with the destination named (v26.4) | One report line with its filter, its destination and a counter-case |

**Where the client has described their own operational handling, a candidate asking how the SYSTEM
supports that handling is a PROPOSE** (v26.2). *"I sort it by hand — I look at the board"* and *"I deal
with it myself"* answer what the **operator** does; they leave open what the **product** shows and
records, which is a real gap. But the client has already told you the shape of the answer, so the
useful move is a drafted screen they can correct — not a question asking them to design it.

**Test, and it has two parts (v29): (1) does the material describe the client's own handling of this
situation, and (2) can the draft's CONTENT be written from what they said, without inventing something
they never gave? Both yes — draft, do not ask. Either one no — ASK.**

**Part (2) is not optional, and this rule was measured failing without it.** On two held-out projects
`ASK -> PROPOSE` was **34 of 47** wrong dispositions, and eleven of the twenty missed questions were
missed by every grader. The route fires on part (1) alone, and part (1) is satisfied by almost all
discovery material — describing how the work is done now is what a discovery call *is*.

**What counts as inventing the content**, each measured in that set: a **closed list** of outcomes they
never enumerated · a **threshold, count or duration** they never named · **what must survive as a
record**, for a purpose they raised but never specified · an **exception** to their own described flow.
*"Ticks, no answer, left with neighbour at 14"* describes the handling and settles none of these. A
draft that guesses one is not something a client corrects in a sentence — they have to design it, which
is the ASK the route was avoiding.

**DECIDE or PROPOSE — the discriminator:** *has the client expressed a preference, a constraint or a
way of working that this mechanism has to honour?* If yes, **PROPOSE** — draft it against what they
said and let them correct it in a sentence. If they have expressed nothing that bears on it,
**DECIDE** — record the assumption and move on.

*This replaced "would the client see the result", which produced zero DECIDEs in twenty candidates on
a held-out project: in an internal operations tool every surface is one the client sees, so visibility
discriminated nothing. Expressed preference does — and it is quotable from the material rather than
predicted.*

**PROPOSE is not a softer ASK.** The simulated corpus is explicit: the persona put a *"your job"* item
in its own top-ten list, wanting *"a draft of what a late boat looks like on the screen"*
`[persona-generated]` — to react to, not to answer. **A question whose likely answer is "whatever you think" or "show me and I'll
tell you if it's wrong" is a PROPOSE, and asking it as a question wastes the exchange.**

## 3. What is in scope — each with the test that admits it

A candidate must land in one of these. Naming the category is not enough; the test is what admits.

| In scope | The test |
|---|---|
| **Undecided handling of a reachable operational state** | Enumerate states the *business* can be in — closed for weather, arriving after hours, two claims on one asset, everything cancelled at once. Does the material say what the system does? If not, and a wrong guess costs money, safety or a promise, it is in |
| **Triggered behaviour** | Complete *"When ⟨trigger⟩, ⟨actor⟩ shall ⟨response⟩"* under answer A and under answer B. In only if the completions differ and each names an actor, a modal verb and a verb |
| **Actor × capability** | Name two roles and one action. In only if the answer fills a cell — one role may, the other may not |
| **Data the system must hold** | In only if the answer adds, removes or constrains a named field, entity or relationship — something a schema reviewer could diff |
| **Record lifecycle** | In only if the answer names a state a record can occupy, or a transition, that an operator could tell by looking at a screen |
| **External interface and source of truth** | In only if the answer changes what crosses a boundary: direction, trigger, cadence, **which side is authoritative on conflict**, or behaviour when the far side is down |
| **Off-nominal, invalid and mass events** | In only if the happy path does not cover it **and** at least two responses are plausible. *(**Generation-side, not a per-candidate test:** sweep the mass form of every single-record operation — the mass event in §7 is what no lens found in three cycles)* |
| **Numeric thresholds carrying a refusal** | In only if the answer is a number or an enumerated limit **and** you can name the acceptance check that fails without it. If the honest answer is *"as fast as possible"*, that is a wish |
| **Externally imposed constraints** | In only if the answer names an authority **outside the build team** that forces the choice, and conformance is a condition of acceptance. A preference is not a constraint |
| **In / out / later** | In only if the answer moves a **named** capability across a line. *"Is X important?"* is not a question; *"is X in this release?"* is |
| **Assumptions the build rests on** | In only if (a) discovering it false after build forces rework, not a settings change, **and** (b) the client can confirm it in one sentence with no research |
| **Contradictions between sources** | Quote both spans. Exempt from §1 and from de-duplication by construction — *the topic being already covered is the reason to ask* |
| **Operating volume and human absorption** | **Exactly one per project, asked early**: order of magnitude, peak, and **who fixes a wrong outcome by hand**. It sets §4's materiality floor for every later candidate. *(Generation-side: a run confirms this question exists rather than testing a candidate against it.)* **Where only part of it is on record — a scale but no peak — the floor stands on what is known and the run says which part it lacks**, rather than refusing to apply the floor at all |

## 4. Materiality — the floor, and it is set by the client's scale

**A gap whose worst outcome the client absorbs by hand, at their scale, is not a requirement.**

The measured corpus is where this came from, in the client's own words: *"Nobody books forty nights, and
if they did I'd ring them."* · *"Forty berths and I know most of these people; if someone holds five
I'll pick up the phone."* · *"Sometimes I write it up next morning with a coffee. Don't put a clock on
my own ledger."* Five of the 36 were real, correct, and immaterial.

**The floor is not a constant and must never be hardcoded.** It is set by §3's volume question. Forty
berths and an operator who knows the voices is a different floor from four thousand and a call centre.
**A run that has not asked the volume question has no floor and must not apply this rule** — it fails
toward asking, which is the safe direction here.

**Two things the floor never drops, and they OUTRANK the floor rather than competing with it**
(v26.3 — a grader found the section contradicting itself on one candidate and reported *"the section
contradicts itself on this candidate and gives no precedence rule"*). **Where a candidate is both below
the floor and inside a guard below, the guard wins and it is not dropped.** **A candidate the client raised themselves** — insistence
is evidence of a delta, and dropping their own topic on a floor they did not set is how a tool teaches
a client it is not listening. **And a candidate whose answer changes what the organisation is exposed to** — money owed or billed,
a safety outcome, or a compliance breach (v26.4: written as *"billed or owed"* until a held-out
project whose product touched no money at all rendered the guard inert, while its sharpest candidates
were exposure of the other two kinds) —
*"is that one invoice or two?"* is a cardinality question with money attached, and the operator
absorbing the *booking* by hand says nothing about the *invoice*.

**One exception, and it is the failure mode of every per-item threshold: individually immaterial items
that are collectively material.** *(**Generation-side, not a per-candidate test** — it reads across the
batch; run it once over the surviving set.)* **Merging is not only for immaterial items** (v26.4): where three or more candidates would all be
settled by one convention **at any materiality**, they merge into that one question and it is asked —
a held-out project produced three separate candidates that were one question, *does the system refuse a
non-compliant assignment, warn, or record it after the fact*, and the merge rule could not reach them
because it was gated on being individually too small. **Merge on shared convention, then dispose the
merged question on its own merits.** Where three or more candidates would all be settled by one
convention
— date handling, rounding, timezone, name formatting, what a soft delete does — **do not drop them
individually. Merge them into one project-level convention question and ask that.**

## 5. What is out of scope — with the test, and where it goes instead

The two structural tests, both from IEEE Std 830-1998, whose §4.8 reads: ***"The SRS should address the
software product, not the process of producing the software product."***

- **Product or project?** Cost, schedules, reporting procedures, development methods, QA, verification
  criteria and acceptance procedures are §4.8's own named exclusions → the project plan or statement of
  work.
- **Externally visible or internally constructed?** §4.7 excludes partitioning into modules, allocating
  functions to them, inter-module flow and data structures → the design description.

| Out of scope | The test | Where it belongs |
|---|---|---|
| **Wording of documents the system stores or displays** | Does the requirement line change if the wording changes? If the line is *"the system displays ⟨doc⟩ at ⟨location⟩, content client-supplied"*, the wording is an **input with an owner** | RECORD — a named slot, with who supplies it |
| **Standards conformance asked as a category** | If the answer is the name of a standard with **no party who would refuse acceptance without it**, drop. It re-enters only through the constraint test | The constraint register, or nowhere |
| **Business outcomes, market position, the case for building** | Write the delta. If it is a slide rather than a screen, drop. Nothing the system does changes between *"we expect £200k"* and *"we expect £400k"* | The business case. 29148 §9.3 puts *Mission, goals and objectives* and *Business model* in the **Business Requirements Specification**, never the SRS |
| **Facts about the builder** — staffing, budget, process, tooling, cadence | Is the answer a fact about the **system** or about the **organisation producing it**? | The statement of work |
| **Internal construction** | Could a user or an integrating system tell answer A from answer B **without being told**? If not, it is design | The design document |
| **Verification procedure** | Separate the acceptance **condition** (in) from the acceptance **procedure** — who runs which test, when, who signs (out) | The test plan |
| **Rollout, migration mechanics, training, support** | Is the capability still needed once the change is complete? If it expires at launch it is a transition requirement | The launch plan. Narrow carve-out: if the **system** must permanently contain the mechanism, it is in |
| **Already answered in the material** | Quote the span. If you can quote it, this is an extraction with a provenance line, not a question. **"The material" includes every answer the client has already given, in any round, not only the sources they first handed over** — an answer joins the material the moment it is given, and a candidate the client has already settled is not made new by a later run finding it again | The spec itself |
| **Answered by a principle the client stated** | A principle answers its instances (v26.4). *"A driver must never be rostered past the limit"*, *"payroll is not changing"*, *"nothing gets deleted, we are audited"* each settle a family of candidates, and a candidate that merely applies the principle to one case adds a scenario, not a decision. **Test: quote the principle and the candidate side by side — does the principle already decide it?** The exception is where the principle is silent on the *posture*: a rule saying what must never happen does not say whether the system refuses it, warns, or records it afterwards, and that posture is a live question | The spec itself, as a stated consequence |
| **Answered by consequence of something the client stated** | Where the client stated a rule, a candidate asking what that rule implies in an obvious instance is not a second question. *"An arrival can be undone"* answers *"can an arrival recorded against the wrong reservation be undone?"* — the candidate adds a scenario, not a decision. **Test: write the client's statement and the candidate's answer side by side. If the answer is entailed rather than chosen, drop it** | The spec itself, as a stated consequence |
| **Mechanism where the outcome is stated** | Locate the stated outcome. **Then write the candidate's two competing answers and check each against that outcome: if BOTH deliver it, the choice between them is the builder's and there is no question.** **Two answers do not both deliver a stated outcome if they differ in what gets recorded, in who may act, or in what happens when the flow fails** (v29) — check those three before concluding the choice is the builder's, because this route was the second-largest source of missed questions. *"Hide the unusable berths or grey them out"* — both deliver *"don't offer a berth a boat can't float in"*, so both are mechanisms | DECIDE or PROPOSE, by the test below |
| **Conventional default, cheap to reverse** | Name the default. If shipping it wrong changes no stored data, no money taken and no agreement signed — ship it and log it. **Reversibility, not importance** | The assumptions log |
| **Unbounded catch-alls** | Try to write two specific competing answers. *"Anything else we should know?"* buys no decision | Delete. Convert unease into a reachable-state sweep |
| **Speculative future releases** | Does the answer change something shipping in **this** release? | One line on the Later list, no follow-ups |

## 6. The boundaries that actually decide cases

**Precedence, because these rulings and §2's tests can point different ways on one candidate**
(v26.3): **§2's professional-determination test outranks every topic ruling below.** Where §6 says a
topic is IN — a retention period, an invoice field — but the correct answer is fixed by a profession
the client does not practise, it is **RECORD** with the adviser named. A topic being in scope for the
*document* does not make the client the right person to *answer* it, and those are different questions
this file kept conflating.

**Legal and regulatory.** IN when the answer flips the existence or behaviour of a **named screen,
field, endpoint or scheduled job**. OUT when it changes only a document or the client's posture.
*"Must a customer be able to export everything we hold on them?"* is in — it is an endpoint. *"What
should the privacy policy say?"* is out — RECORD it. **This is the exact leak: legal topics are
client-owned and undefaultable, so a gate keyed on ownership admits them, and they still produce no
requirement.**

**Accessibility, specifically.** Reject *"what accessibility standards should we follow?"* outright —
the paradigm case of an important-sounding question with no delta, and one the client cannot answer.
Accept **exactly one** project-level question phrased for a refusal: *is there a procurement,
contractual or statutory accessibility obligation, and would conformance be a condition of acceptance?*

**Money, split three ways.** OUT: revenue targets, pricing strategy, market size, project budget. IN:
what the system **does** with money — which capabilities a tier unlocks, when a charge is raised, what
happens when a payment fails, what a refund does to a record. RECORD: the tariff itself, as a
client-supplied slot.

**Data retention.** The **period** is in — it is a number, a scheduled job, usually a soft-delete flag
and often a restore surface. The **policy document** is out. Scope it per entity.

**Two client-supplied documents can take different dispositions, and the professional-determination
test is what separates them** (v26.3). A privacy notice is the **solicitor's** determination → RECORD.
Cancellation terms are the client's own commercial policy, so their *placement* is a screen she will
see → PROPOSE, while their *wording* stays a RECORD slot. Without this line a grader applying the
wording row alone lands both on RECORD and loses a real screen decision.

**Content the client supplies.** The **wording** is out. The **shape, volume, source, owner and change
cadence** are in — *"who edits the welcome email, and does it need an editing surface?"* changes whether
a whole screen exists.

**Non-functional attributes.** IN only when the answer is a number or an enumerated limit, you can name
the acceptance check that fails without it, **and a plausible refusal exists**. *"Is performance
important?"* — no client says no.

**Security.** IN: who can see what, the authentication the user **experiences**, session behaviour,
whether an audit trail exists and who reads it, what happens on repeated failure. OUT: algorithms, key
management, network topology.

**Integrations.** IN: the fact of it, direction, trigger, cadence, **which side is authoritative on
conflict**, what the user sees when the far side is down. OUT: credentials, VPNs, licence seats.

**User segments.** IN only when a segment produces **different behaviour**: name two segments and write
one requirement line that differs. *"Who are your users?"* is a persona exercise.

**Success metrics.** The **target** is out. The **instrumentation** is in, and only when an event or
field must be captured that the system would not otherwise emit **and** a named person will look at it.

**The as-is.** Out as an open question — *"walk me through your current process"* is already in the
transcripts. In as a targeted one: *"which columns of the current spreadsheet must survive into the new
record, and which are dead?"*

**Deadlines.** A date is in only as a constraint that forces a scope cut, or is externally imposed with
a nameable source. If it only tells the builder when to work, it is the project plan's.

**When the client keeps raising a topic and no delta can be found.** Insistence is evidence of a delta
**not yet located** — never a licence to ask an unbounded question about the topic. Enumerate the
reachable states within it and find the one whose handling is undecided. If you still cannot construct
two competing answers, say so in the report rather than manufacturing a question.

## 7. What a good question looks like, from the measured corpus

The client's own top three, and the pattern they share:

> *"**clearance margin.** You were one line of code from putting a boat on the bottom on a spring low.
> Nobody had asked me that and **I'd never have thought to volunteer it**."*
> *"**bounding the stated arrival time.** My two-hour rule has a hole in it **I hadn't seen**."*
> *"**the first night of a multi-night booking.** I don't know what I want there, and it's the kind of
> thing that'll cause a row on a Friday in August if you guess."*

Each names a **reachable operational state** whose handling is undecided and whose wrong answer costs
money, safety or a customer relationship. **Two of the three surfaced a hole the persona said it did not
know it had** `[persona-generated]` — so this file must
never be read as *ask only what the client already knows they must decide*. A generator tuned only to
the client's stated agenda would have found none of the three.

**And the one nobody asked**: *what the product does on a night the harbour is shut for weather and
forty confirmed bookings become nothing at once.* The mass form of a single-record operation, which is
why §3 sweeps for it by name. **It was named by the persona when the persona was asked to name a
miss** `[persona-generated]`, so it is a prompted gap, not a discovered one — it earns a sweep rule,
not a claim about recall.

## 7a. A candidate carrying two decisions is split before it is disposed

**Split first, dispose each half separately** (v26.1). *"What is a berth charged at, and does the
invoice cover nights reserved or nights slept?"* is two: the **rate** is a client-supplied tariff
(RECORD) and the **billing basis** changes what the system computes (ASK). Disposing the pair as one
forces a wrong answer either way, and every disposition below assumes one decision per candidate.
**Test: can you write two independent competing-answer pairs? Then it is two candidates.**

**A disposition attaches to a decision, not to a sentence** (v26.3). Where a candidate splits, **it
stops being one candidate**: each half is disposed on its own and reported on its own line. A run whose
output shape carries one verdict per candidate **disposes on the half that would be ASKed and says in
the report that the candidate was bundled** — losing a real question to a bundling artefact is the
worse error of the two.

## 8. Phrasing — a rejected question and an accepted one can be the same topic

The corpus shows phrasing deciding the outcome. She rejected *"does the late-cancellation charge still
apply once the berth was released?"* as *"the same unset charge from question three, **asked
sideways**"* — the topic was live, the phrasing re-asked a hole she had already declared open.

- **Name the state, not the topic.** *"What about cancellations?"* is a topic. *"When a cancellation
  arrives after the berth was released, which of the two outcomes applies?"* is a state.
- **A question whose answer is blocked by an already-open question is not a second question.** It is a
  consequence of the first, and it waits.
- **One decision per question**, unless one answer genuinely closes both — and then say so.

## 8a. How to read the worked examples in this file

**Every example here comes from one of two simulated projects — a 40-berth marina and a 400-driver
haulage firm, both persona-played — and an example transfers its TEST, never its conclusion** (v26.4).
**Both are burned as measurement corpora**: because their text is quoted here, no score against either
can be evidence about this file, and a run that scores this file uses a domain it has never seen. A held-out grading
found *"does a withdrawn invoice stay on record?"* steering a structurally identical question about a
cancelled shift to the same answer, when the premise that made the invoice case a professional's
determination — an accountant's rule — had no counterpart there. **Where an example's shape matches
but its premise does not, run the test and discard the example.** If two candidates look alike and the
tests disagree, the tests win.

## 9. What this file does not settle

- **It judges one candidate at a time.** Nothing here bounds a chain across runs; that is
  [`../questions.md`](../questions.md) Q3's depth filter, and the two are independent.
- **It presumes material to test against.** On a thin corpus most tests are unrunnable, and a run in
  that state says so rather than admitting everything by default.
- **The materiality floor is unusable until the volume question is answered**, and until then this file
  fails toward asking.
- **It does not rank.** Where more candidates pass than a sitting can carry,
  [`../questions.md`](../questions.md) Q4's re-gate and its filters decide, not this file (v30: that
  phase carries no row budget).
- **No human has ever labelled this.** The tests are grounded in published standards and in two
  simulated corpora whose labels are an LLM persona's, not a client's. The persona has never been
  compared against real practitioners, so **nothing here is validated against what a paying client
  wants**, and no accuracy figure for this file should be quoted until it has been.
- **Two simulated projects, one domain family.** Both are small owner-operated UK service businesses.
  Nothing here speaks to regulated enterprise, multi-stakeholder procurement, or non-English work.
