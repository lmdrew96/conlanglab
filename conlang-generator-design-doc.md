# Conlang Generator — Design Doc

*Status: All sections drafted — pending reader testing*
*Audience: Nae (thinking/reference) + Cody (implementation)*

---

## 1. Overview

**CLL (ConLangLab)** is a tool that generates complete, internally-consistent constructed languages — phonology, morphology, lexicon, basic syntax, and orthography — from real linguistic typology rather than random word-soup or templates.

It exists for two reasons, both genuine:

- **A personal linguistics playground.** A space to explore how sound systems, grammar, and vocabulary interlock — informed by actual typological patterns (why certain sounds cluster together, why certain grammatical strategies co-occur) rather than guesswork.
- **A deliberate technical stretch.** The first from-scratch build into procedural generation — formal grammars, constraint-based generation, phonological rule systems — as a genuine leap into new algorithmic territory, independent of any existing app in the Chaos ecosystem.

CLL is not an ML product. Every language it produces comes from deterministic, seedable, rule-based generation — the same seed and parameters always reproduce the same language, and every choice the system makes is traceable to an explicit rule, not a black box.

## 2. Design Principles

These are the non-negotiables. Every generation decision, every UI choice, every scope cut should trace back to one of these.

1. **Phonological elegance over pure typological validity.** A language can be typologically "correct" and still feel arbitrary or unpleasant in execution — regardless of what sounds it uses (harsh/guttural inventories are not the problem; incoherent or grating execution is). CLL optimizes for sound systems that feel intentional and cohesive, whatever their sound palette — elegance is a first-class goal, not a side effect of correctness.
2. **Steerable, not just "hit generate."** The user can lock choices, nudge parameters ("more agglutinative," "fewer clusters"), and regenerate the rest. Generation is a conversation, not a slot machine.
3. **Deterministic and seedable.** The same seed and parameters always reproduce the same language. Every output is reproducible and diffable — no silent randomness.
4. **Internal consistency over exhaustiveness.** A language that's coherent in the features it has beats one that shallowly covers every typological category. Depth of the parts present matters more than breadth of coverage.
5. **Every generated feature is traceable to a rule.** No unexplainable "why does this language do that" moments. If CLL made a choice, there's a linguistic reason a user could look up.
6. **Typology as guardrails, not cages.** Real linguistic universals (implicational hierarchies, Greenberg's universals, etc.) inform and constrain generation — but the system should never feel like it's mechanically filling out a WALS survey. Typology serves elegance and plausibility; it doesn't dictate them.
7. **Depth over breadth in v1.** Better to nail a few pipeline stages thoroughly than ship five mediocre ones. Concretely, this favors Phonology, Lexicon, and Morphology getting real depth while Syntax stays deliberately lightweight (v1-lite) — scope cuts favor doing fewer things well over spreading effort evenly across every stage.
8. **A conlang is a living object.** Languages are persisted, revisited, and iterated on — not one-and-done outputs to be regenerated from scratch. This principle is what motivates a future (v2) capability: languages that age over time — adopting loanwords, dropping obsolete forms, blending with other conlangs in the library through simulated contact. Out of scope for v1, but the data model and generation approach should not foreclose it.
9. **No black-box magic.** Every output should be explainable in linguistic terms a curious user could learn from — never "the algorithm decided" with no further explanation available.

## 3. Core Generation Pipeline

CLL's generation is organized as five stages, walked through as a **wizard flow** — the user generates phonology, then reviews/steers it, then moves to lexicon, then morphology, then syntax, then orthography. Each stage produces a distinct artifact that later stages consume.

### Stage order and dependencies

```
Phonology ──┬──▶ Lexicon ──▶ Morphology ──▶ Syntax
            └──▶ Orthography ◀── Morphology
```

- **Phonology** is the foundation: sound inventory + phonotactics (valid syllable shapes, cluster rules).
- **Lexicon** depends on Phonology (roots are built from its sound inventory + phonotactic rules).
- **Morphology** depends on Phonology directly (affixes are themselves phonologically valid strings) and conceptually informs how the Lexicon's roots inflect/derive.
- **Syntax** (v1-lite) depends on Morphology (what grammatical categories exist to arrange) but is otherwise the lightest-weight stage.
- **Orthography** depends on **both** Phonology (mapping sounds to symbols) and Morphology (deciding how affix/word boundaries are represented in writing — e.g., hyphenation, spacing, ligatures at morpheme joins). The **syllabic** and **logographic** script categories specifically also read Lexicon (a syllabary's glyph set is bounded to the CV/V syllables actually attested in generated roots, and a logographic script's glyphs are keyed one-per-concept) — already safe given Lexicon generates well before Orthography in pipeline order (§15), just not previously called out in this diagram.

### Not a sealed pipeline

Phonology is **not sealed** once later stages begin. A user can go back and revise the sound inventory or phonotactics after lexicon or morphology already exist. This is a deliberate consequence of Design Principle 8 (a conlang is a living object) — the whole system should tolerate revision, not just first-pass generation.

Because of this, downstream artifacts can go **stale** relative to an edited upstream stage (e.g., a lexicon root using a phoneme that phonology no longer includes). CLL surfaces staleness explicitly rather than silently invalidating or silently ignoring it — see "Independent regeneration" below.

### Independent regeneration per stage

Each stage's output can be **locked** or **regenerated independently**, rather than any single change cascading and force-regenerating everything downstream automatically:

- Locking a stage protects it from being altered by later regeneration actions.
- Regenerating an unlocked upstream stage (e.g., Phonology) does **not** automatically regenerate downstream stages (e.g., Lexicon). Instead, downstream artifacts that depend on changed upstream data are flagged **stale**, and the user chooses when (or whether) to regenerate them.
- This preserves user control (Design Principle 2 — steerable) and avoids destructive surprises when experimenting with an early stage.

### Generation parameters

Each stage has its own parameter set the user tunes at that stage in the wizard (e.g., Phonology's params include cluster complexity and vowel inventory size; Morphology's include isolating/agglutinative/fusional/polysynthetic lean). There is no single global config object — parameters are scoped to the stage they govern, since steering decisions at each stage are conceptually distinct.

### Wizard flow summary

1. Generate/steer **Phonology** → lock when satisfied
2. Generate/steer **Lexicon** (consumes locked or current Phonology)
3. Generate/steer **Morphology** (consumes locked or current Phonology; informs Lexicon's derivational relationships)
4. Generate/steer **Syntax** (v1-lite; consumes Morphology)
5. Generate/steer **Orthography** (consumes Phonology + Morphology)

At any point, the user can jump back to an earlier stage, revise it, and return — with staleness indicators guiding what may need a refresh downstream.

## 4. Phonology Engine

The Phonology Engine is the foundation of the pipeline (Section 3) and the primary home of Design Principle 1 (elegance over pure validity). Its output is a **sound inventory + phonotactic rule set** — no words yet (that's Lexicon, Section 6).

### 4.1 Sound Inventory Generation

Consonants and vowels are generated using real implicational universals, not uniform-random selection from the IPA chart. Concretely:

- **Implicational hierarchies drive selection.** Certain sounds cross-linguistically imply others (e.g., a language with a voiced stop series is far more likely to also have the corresponding voiceless series; a language with front rounded vowels is likely to also have their unrounded counterparts). Generation should consult a hierarchy/frequency table (informed by cross-linguistic databases like UPSID/PHOIBLE-style frequency data) rather than sample sounds independently.
- **Generation proceeds core-outward:** a small "always likely" core inventory is selected first (the cross-linguistically common stops/nasals/vowels), then rarer sounds are added probabilistically, gated by whether their implicational prerequisites are already present.
- **Fine-tuning controls (user-facing):** inventory size targets (small/medium/large consonant and vowel inventories), presence/absence toggles for marked features (ejectives, clicks, front rounded vowels, tone-adjacent phonation types), and a "typological strictness" slider — how closely generation must adhere to attested universals vs. allowing rarer/more speculative combinations.

### 4.2 Phonotactics & Syllable Structure — Max Control

Phonotactics get the deepest user control in the engine, per your "max control" preference:

- **Syllable template control:** user can constrain allowed syllable shapes directly (e.g., restrict to CV/CVC, or permit complex onsets/codas like CCVCC), rather than the system picking a template for them.
- **Cluster controls:** explicit max onset cluster size, max coda cluster size, and which consonant classes may combine in a cluster.
- **Position-sensitive rules:** different constraints for word-initial, word-medial, and word-final position (a common real-world pattern — many languages allow codas medially that they disallow finally, etc.).
- **Output is a rule set, not just examples:** the engine should produce an explicit, inspectable phonotactic grammar (a set of rules a user or Cody can read directly), not a black-box generator that merely samples "valid-looking" syllables.

### 4.3 The Elegance Heuristic: Sonority + Deliberate Override

This operationalizes "avoid harsh clusters unless deliberately chosen" (Design Principle 1, corrected per your Dothraki clarification — harshness of the sound palette itself is never the target; incoherent cluster construction is):

- **Sonority Sequencing Principle (SSP) as the default grader.** Consonant clusters are evaluated against the sonority hierarchy (roughly: obstruents < nasals < liquids < glides < vowels). Clusters that rise in sonority toward the syllable nucleus and fall away from it (the cross-linguistically unmarked pattern) are treated as the "elegant default" and are generated freely.
- **Sonority-violating clusters are suppressed by default**, not banned outright. A cluster that violates SSP (e.g., stop+stop clusters, "harsh" sequences with no clear sonority rise) is excluded from default generation.
- **Deliberate override, not accidental inclusion.** If a user explicitly wants marked/harsh clusters (a legitimate aesthetic choice — nothing wrong with a harsh-sounding language chosen on purpose), there's an explicit toggle/slider to allow sonority-violating clusters at a controlled rate. The point is that harshness should only appear as a result of the user's deliberate choice, never as generation noise.
- This is the concrete, implementable version of "elegant" for v1. It's a real, citable linguistic principle (SSP) rather than a vague aesthetic judgment — which satisfies Design Principle 5 (traceable to a rule) and Design Principle 9 (no black-box magic).

### 4.4 Suprasegmentals: Stress and Tone (in scope for v1)

- **Stress systems:** user selects (or the system proposes, then user can override) a stress assignment rule — common typological patterns include fixed initial/final/penultimate stress, and weight-sensitive stress (heavy syllables attract stress).
- **Tone systems:** optional — user can enable a tonal system with a configurable number of contrastive tone levels or contour tones. When enabled, tone becomes a property carried into the Lexicon stage (roots carry tone specifications) and needs representation in Orthography (Section 8).
- Stress and tone are mutually non-exclusive in the model (some real languages have both), but the UI should make clear which is currently active for a given language.

### 4.5 Engine Output

The Phonology Engine's output artifact consists of:
- Full consonant + vowel inventory (with articulatory feature data, not just symbols)
- Phonotactic rule set (syllable template(s), cluster rules, position-sensitive constraints)
- Sonority-based cluster grading data (which clusters are "default-elegant" vs. "deliberate override only")
- Stress/tone system specification

No example words are generated at this stage — this output is pure sound-system data, consumed by Lexicon, Morphology, and Orthography downstream.

## 5. Morphology Engine

This is one of the deepest engines in CLL — broad grammatical coverage, every major affixation strategy, and phonologically-conditioned allomorphy are all in v1 scope. That's a real, substantial build (worth reflecting honestly in Section 15's phasing), but it's depth concentrated in one engine rather than shallow breadth across the pipeline — consistent with Design Principle 7.

### 5.1 Typology Selection (Guided, Not Blind)

The user selects the morphological type directly — **isolating, agglutinative, fusional, or polysynthetic** — but the selection UI is informed, not a blind dropdown:

- Given the user's current Phonology choices (and any other prior decisions), the system generates **live preview examples** of what a word would look like under each typological option, so the choice is made with a concrete sense of "this is what agglutinative would sound/look like for *this* language" rather than in the abstract.
- The system may suggest a lean (e.g., "your phonotactics suggest agglutinative fits naturally") but never forces it — user choice is final, per Design Principle 2 (steerable).

### 5.2 Affix Strategies — Full Coverage

All major morphological strategies are in scope for v1, not just linear affixation:

- **Prefixation and suffixation** (the baseline)
- **Infixation** (affix inserted within the root)
- **Circumfixation** (affix material wraps both sides of the root simultaneously)
- **Reduplication** (full or partial copying of the root/stem — a genuinely fun one to generate well, and common cross-linguistically for plurality, intensity, aspect)
- **Non-concatenative strategies**: templatic/apophonic patterns (root-and-pattern morphology, à la Semitic languages) and ablaut/vowel-gradation (stem-internal vowel change, e.g., sing/sang/sung-style alternation)
- **Suppletion** (irregular, unpredictable forms) as a controlled, low-frequency "spice" the generator can sprinkle in deliberately — real languages have a handful of these, and total regularity can feel sterile

### 5.3 Grammatical Categories — Broad Coverage

As much typologically plausible coverage as feasible, including but not limited to:

- **Nominal categories:** case, number, gender/noun class, definiteness, possession
- **Verbal categories:** tense, aspect, mood, evidentiality, polarity (negation), voice (active/passive/etc.)
- **Agreement:** person/number agreement between predicates and arguments
- Not every language generated needs to mark every category (real languages don't) — the system should select a **plausible subset** per language (informed by typological co-occurrence patterns) rather than mechanically maximizing coverage in every output. "As much coverage as possible" describes the *system's capability*, not a mandate that every generated language use everything.

### 5.4 Phonologically-Conditioned Allomorphy (v1)

Affixes are not fixed strings — their surface form can vary based on phonological environment, generated as an integrated extension of the Phonology Engine's rule set:

- Common patterns to support: vowel harmony-driven allomorphy (an affix's vowel matches the harmony class of the stem), consonant assimilation at morpheme boundaries, and environment-conditioned insertion/deletion (e.g., an epenthetic vowel breaking up an illegal cluster created by affixation).
- This is what makes Phonology and Morphology feel like one integrated system rather than two independent generators bolted together — allomorphy rules should be expressed using the same phonotactic rule representation established in Section 4.2, not a separate ad hoc mechanism.

### 5.5 Derivation and Inflection — Both in Scope

- **Inflectional morphology**: grammatical marking that doesn't change a word's core category (case, tense, agreement, etc. — Section 5.3's categories).
- **Derivational morphology**: word-formation that creates new lexemes, often changing category (verb → agent noun, adjective → abstract noun, etc.). This is also the mechanism that gives the Lexicon Engine (Section 6) related-word families instead of independently generated roots — e.g., "run" and "runner" sharing a root with a derivational affix applied, rather than being two unrelated random words.

### 5.6 Engine Output

The Morphology Engine's output artifact consists of:
- Selected morphological type + the affix inventory realizing it
- Full affix strategy set in use (which strategies from 5.2 this language employs, and where)
- Selected grammatical category subset (5.3) and how each is marked
- Allomorphy rules (5.4), expressed in the shared phonotactic rule format
- Derivational rule set (5.5) — the patterns Lexicon will use to generate related word families

This output feeds Lexicon (root/word generation + derivation), Syntax (what categories exist to arrange), and Orthography (how morpheme boundaries are represented in writing).

## 6. Lexicon Generator

### 6.1 Scale

Target: **~500 roots** for a "complete" v1 lexicon. Roots are built from the Phonology Engine's inventory + phonotactic rules (Section 4), and expand into full word families via the Morphology Engine's derivational rules (Section 5.5).

### 6.2 Semantic Assignment — Core List + Domain Weighting

Semantic coverage combines two layers:

- **Core list:** a broad default set of foundational meanings — extending well past a traditional Swadesh list (~100-200 basic-vocabulary concepts) into everyday domains: emotions, abstract concepts, social roles, basic technology, common objects — enough breadth that a generated language doesn't feel like a linguistics-textbook toy vocabulary.
- **Domain weighting (optional, user-facing):** the user can weight or emphasize specific semantic domains to imply something about the language's (fictional) speakers — e.g., weighting toward nautical/maritime vocabulary for a seafaring culture, or agricultural terms for a farming culture. This doesn't replace the core list; it shapes *which* additional ~500-root budget gets spent where, and can enrich the core list's flavor within a domain (e.g., more granular boat/weather/tide vocabulary than a generic core list would include).
- The core list ensures baseline completeness even with no domain input; domain weighting is where culture-flavor and personality enter the lexicon.

### 6.3 Derivation and Non-Literal Meaning

- Word families are generated via Morphology's derivational rules (Section 5.5), so related concepts share roots rather than being independently random (e.g., "teach" / "teacher" / "teaching").
- **Non-literal, compound, and idiomatic meanings are in scope.** Compounding two roots can yield a meaning that isn't a simple sum of its parts (e.g., a "hand" + "shoe" compound meaning "glove") — this is how real lexicons build vocabulary economically and is part of what makes a generated lexicon feel like a real language rather than a dictionary of independently invented words.

### 6.4 Engine Output

- ~500 roots with phonological form, core meaning, and part of speech
- Derivational relationships between roots (word families)
- Any non-literal/compound formations and their derivation path
- Domain-weighting metadata (which semantic domains were emphasized, for later reference/regeneration)

---

## 7. Syntax Engine (v1-lite)

Per Design Principle 7 (depth over breadth), Syntax is intentionally the shallowest engine in v1 — functional, not exhaustive.

### 7.1 v1 Scope

- **Word order typology:** the system selects/generates a basic constituent order (SOV, SVO, VSO, etc.), consistent with Morphology's typological choices where cross-linguistic correlations exist (e.g., certain word orders correlate with certain adposition/affix-ordering patterns — Greenberg-style universals).
- **Basic constituent structure:** simple sentence construction — subject/object/verb arrangement, basic noun phrases (noun + modifiers in the right order for the chosen typology), simple adpositional phrases.
- **Explicitly out of scope for v1:** complex clauses, subordination, relative clauses, coordination strategies, and other higher-order syntactic phenomena. These are natural v2+ candidates once the rest of the pipeline is proven out.

### 7.2 Engine Output

- Selected word order typology
- Basic phrase-structure rules (noun phrase, verb phrase, adpositional phrase construction)
- A small set of example simple sentences demonstrating the rules in action

---

## 8. Orthography Generator

In scope for v1, with **visual rendering** — generated glyphs actually appear in the UI and PDF export, not just a described system.

### 8.1 Script Type Selection

The user chooses the **script category** (alphabetic, syllabic/moraic, logographic, abjad, abugida, etc.) — this determines the sound-to-symbol mapping logic and depends on Phonology (Section 4) for the sound inventory being represented and Morphology (Section 5) for how morpheme/word boundaries are handled in writing (per Section 3's dependency graph). The syllabic and logographic categories additionally read Lexicon (Section 6) — see Section 3's dependency note.

### 8.2 Invented vs. Real-Like Aesthetic

Independent of script *category*, the user chooses the **visual aesthetic** the generated glyphs lean toward:

- **Invented/alien:** glyph shapes generated from scratch with no visual reference to existing scripts — a wholly novel-looking writing system.
- **Real-like:** glyph shapes generated to evoke the visual logic/aesthetic of real-world script families (e.g., Latin-esque, Cyrillic-esque, Arabic-esque, Devanagari-esque strokes and construction principles) without reproducing actual existing letterforms — inspired by real scripts' visual grammar, not copied from them.

This choice is orthogonal to script category (e.g., a syllabary could be generated in either an invented or real-like visual style).

### 8.3 Engine Output

- Complete sound-to-symbol (or morpheme-to-symbol, for logographic) mapping
- Rendered glyph set (actual visual glyphs, not just a described mapping)
- Rules for representing morpheme/word boundaries in writing (spacing, ligatures, diacritics at affix junctions, etc. — informed by Morphology's allomorphy rules from Section 5.4)

## 9. Steering & Interactivity

This section makes Design Principle 2 (steerable, not a slot machine) concrete as UI/interaction mechanics.

**Settings vs. steering — the distinction:** Parameters (9.3) are knobs set *before* generating — they shape what comes out, but a slider alone is just configuration. **Steering** is what happens *after*: the ability to keep a piece you like while regenerating the rest (item-level locks, 9.1), choose how much a regeneration should vary from what exists (nudge vs. reroll, 9.2), and undo if the result isn't better (history, 9.4). A settings panel produces a language; steering lets you have a conversation with the generation process about a language you're already building.

### 9.1 Locking Granularity: Item-Level, Not Just Stage-Level

Locking works at two levels:

- **Stage-level locking** (established in Section 3): protects an entire stage's output from being affected by regeneration.
- **Item-level locking**: within an unlocked stage, individual items can be locked independently — e.g., keep one specific root or affix fixed while regenerating the rest of the lexicon/morphology around it. This lets a user "rescue" a piece they like without having to lock (and thus freeze) an entire stage.

Item-level locks persist even if the parent stage is later regenerated — a locked root survives a lexicon reroll; only the unlocked items are replaced.

### 9.2 Regeneration Modes: Nudge vs. Reroll

Two distinct regeneration actions are available wherever regeneration applies (stage-level or item-level):

- **Nudge:** produces a small variation on the current output — same general shape/character, minor changes. Good for "close, but tweak it" moments.
- **Reroll:** produces a fully fresh output for the unlocked scope, generated independently of the current result. Good for "start over on this part."

Both respect current parameter settings (Section 9.3) and any active locks (Section 9.1) — nudge and reroll differ in *how much* they vary from the current state, not in what constraints they honor.

### 9.3 Parameter Controls: Sliders and Toggles

Every tunable parameter across all engines (Sections 4-8) is exposed as a slider (continuous/graded settings — e.g., cluster complexity, typological strictness, domain-weighting emphasis) or toggle (binary/categorical settings — e.g., tone on/off, invented vs. real-like orthography aesthetic). No freeform text-interpreted input for v1 — direct, explicit controls only, so every parameter's effect stays traceable (Design Principle 5) rather than routed through an interpretation layer.

### 9.4 History & Undo

Beyond locking as a safety net, each stage maintains a **history of past generations** the user can step back through — not just a single undo, but a stepped history per stage, so experimenting with several rerolls doesn't risk losing a good earlier result. Locking, undo, and history work together: locking prevents accidental overwrite going forward, history recovers from an already-made change.

### 9.5 Live Previews — Broad Coverage

Live preview (established for Morphology's typology choice in Section 5.1) extends to essentially every stage where parameters affect output shape:

- **Phonology:** preview syllable/cluster examples updating live as phonotactic sliders (cluster complexity, allowed shapes) are adjusted.
- **Morphology:** typology preview (Section 5.1), plus live examples of affix behavior as strategy toggles (Section 5.2) are changed.
- **Lexicon:** preview example roots/words as domain-weighting sliders (Section 6.2) shift.
- **Syntax:** preview example sentences updating as word-order typology changes.
- **Orthography:** preview rendered glyphs updating as script category or invented/real-like aesthetic (Section 8.2) is adjusted.

The goal throughout: no parameter change should require a full commit to "see" its effect — steering should feel immediate and legible.

## 10. Data Model & Persistence

**Why a library, not just a list of saved files:** persistence here enables three things a flat list of saved languages couldn't. First, stage-per-table storage with item-level locks (10.1) means editing one root updates just that root, not a whole rewritten snapshot — languages are living, granularly-editable records, not frozen files. Second, `stageHistory` (10.3) gives each language an actual timeline, reconstructable to earlier points, not just a single current state. Third, `languageShares` and `languageRelations` (10.4, 10.5) reserve room for languages to reference and eventually influence *each other* — directly serving Design Principle 8 (a conlang is a living object) in a way a pile of independent saved files never could.

### 10.1 Architecture Decision: Stage-Per-Table

Given item-level locking (Section 9.1), broad per-stage parameter sets (Sections 4-8), and live previews needing fast partial reads/writes (Section 9.5), **each generation stage gets its own Convex table**, referencing a parent `languages` document — rather than one large nested document per language.

Rationale: Convex documents are most efficient when updates are scoped and targeted. A single nested "language blob" would mean rewriting (and re-syncing to every subscribed client) the *entire* language object every time one root gets nudged — expensive and unnecessary. Stage-per-table lets a single root regeneration touch only the `lexiconItems` table, not phonology, morphology, or the parent language record.

For stages with **many discrete, individually-lockable items** (lexicon roots, and potentially morphology affixes), items get their **own table** (not an array field on the stage document) so individual item locks/regeneration are targeted writes, not read-modify-write cycles on a large array. For stages that are more "single coherent object" (phonology's inventory + phonotactic rule set, orthography's script system), the stage's data lives directly on its stage document.

### 10.2 Core Tables (v1)

- **`languages`** — top-level record per conlang: id, owner (user reference), name, visibility (private/shared/public — see 10.4), created/updated timestamps, and a summary of which stages are currently locked (for quick UI state without joining every stage table).
- **`phonology`** — one per language: sound inventory, phonotactic rule set, sonority-based cluster grading, stress/tone system, stage-level lock flag, `staleSince` timestamp (null when current — see below).
- **`morphology`** — one per language: typological type, affix strategy configuration, grammatical category selections, allomorphy rules, derivational rule set, stage-level lock flag, `staleSince` timestamp.
- **`morphologyItems`** (if affix count warrants item-level locking, per Section 9.1's general principle) — individual affixes/patterns, each with its own lock flag, referencing parent language + morphology record.
- **`lexiconItems`** — individual roots (~500 per language, per Section 6.1), each with phonological form, meaning, part of speech, derivational relationships, and its own item-level lock flag, referencing parent language. Downstream stages don't get a blanket `staleSince` on the parent stage document alone when only a subset of items is affected — see the staleness mechanism below.
- **`syntax`** — one per language: word order typology, phrase-structure rules, example sentences, stage-level lock flag, `staleSince` timestamp.
- **`orthography`** — one per language: script category, aesthetic style (invented/real-like), sound-to-symbol mapping, rendered glyph data, stage-level lock flag, `staleSince` timestamp.

### 10.2a Staleness Mechanism

Section 3 establishes that editing an unlocked upstream stage flags downstream artifacts stale rather than cascading a regeneration automatically. Concretely:

- Each stage document carries a **`staleSince` timestamp** (null when current). When an upstream stage an item depends on is edited, the affected downstream stage document's `staleSince` is set to the edit time — a simple flag write, not a full diff computation on every edit.
- For item-collection stages (`lexiconItems`), staleness is tracked **per affected item**, not as one blanket flag on the whole collection — an upstream Phonology edit that removes one phoneme only marks the specific roots using that phoneme as stale, leaving the other ~499 roots untouched. This requires the edit operation to check which items reference the changed upstream data (e.g., which roots use a given phoneme) at write time.
- The UI surfaces staleness as a visible badge/indicator on affected stages or items; the user decides whether and when to regenerate.

### 10.3 History: Snapshot-Anchored Diffs

Pure diff-chains (replaying every diff from the beginning to reconstruct current state) get expensive and fragile as history grows. The practical version of "diffs" — balancing your storage preference against reliability — is **periodic snapshots with diffs in between** (the same strategy version-control systems use): store a full snapshot at meaningful checkpoints (e.g., every Nth regeneration, or whenever a stage is locked), and store lightweight diffs for changes between checkpoints. Reconstructing any historical state means starting from the nearest prior snapshot and replaying a short diff chain — bounded work, not unbounded replay.

- **`stageHistory`** — per stage-instance (referencing language + stage type), an ordered log of entries, each either a full snapshot or a diff relative to the prior entry, with a timestamp and whether it resulted from a nudge or reroll (Section 9.2).

### 10.4 Sharing & Multi-User (Structural, Not Full UI in v1)

The schema anticipates sharing from the start, even if v1's UI surface for it is minimal:

- **`languages.owner`** and **`languages.visibility`** (private/shared/public) exist from the start rather than being retrofitted later.
- **`languageShares`** — reserved table for explicit share grants (language ID, shared-with user, permission level) — supports future collaborative/shared access without a schema migration when that feature actually gets built.

### 10.5 Reserved: Inter-Language Relations (v2 Groundwork)

Per Design Principle 8 (languages as living objects — future aging, borrowing, blending), the schema reserves a structural place for relationships between languages, populated by no v1 feature but avoiding a breaking migration later:

- **`languageRelations`** — reserved table: source language ID, related language ID, relation type (open-ended/enum-extendable — e.g., "descendant," "contact," "blend" — to be defined when v2 actually specs this out), timestamps. Empty in v1; exists so contact/blending (explicitly called out as exciting to you) has somewhere to attach when it's built, rather than requiring new tables plus data backfill later.

## 11. Export (PDF)

### 11.1 Content Scope: User's Choice

At export time, the user chooses between:

- **Complete** — the full generated language: entire phonology + phonotactic rules, full morphology (all affixes, categories, allomorphy rules), the complete ~500-root lexicon, syntax rules, and orthography.
- **Summary** — a curated subset: core grammar rules plus a representative lexicon sample, rather than all 500 roots.

Both options pull from the same underlying stage data (Section 10.2); "summary" is a filtered/abridged view, not a separately maintained artifact.

### 11.2 Transliteration Choice: IPA vs. Romanization

The generated script (rendered glyphs from Section 8) **always displays** in the PDF — it's never omitted. What the user chooses is which transliteration accompanies it: **IPA** (phonetic transcription) or **romanization** (a Latin-alphabet approximation). Example words and sentences throughout the document show the rendered glyphs alongside whichever transliteration style the user selected.

### 11.3 Structure: Profile Page + Academic Reference

The PDF is organized in two parts:

1. **Language profile (one-pager)** — a fun, front-facing summary: the language's name, a snapshot of its typological "personality" (word order, morphological type, notable phonological features), a handful of example words/sentences (rendered in script if enabled), and whatever flavor details make the language feel distinct at a glance.
2. **Academic reference (detailed appendix)** — a structured grammar reference mirroring this design doc's engine order: phonology (inventory + phonotactics), morphology (typology, affixes, categories, allomorphy), lexicon (full or sample, per 11.1), syntax (word order + phrase rules), and orthography (script system + mapping). Written in the register of a real reference grammar — the kind of document a linguist (or you, months later) could actually use to learn the language's rules.

### 11.4 Regeneratable, Not a One-Time Snapshot

The PDF is **updatable**, not a permanent snapshot frozen at first export:

- Re-exporting after further generation/editing produces an updated PDF reflecting current stage data.
- Since stage history is tracked (Section 10.3), export could optionally target a specific historical point in a language's evolution, not just "current state" — worth keeping in mind for the export UI, even if v1's default is simply "export current state."

## 12. Visual Design / Theming

Four themes, purely aesthetic (no functional/typological tie-in — a harsh guttural language and a soft flowing one can both use any theme), applied globally as a user preference — not per-language.

**On the naming:** themes are named with linguistics terminology (Vernacular, Isogloss, Glossolalia, Prosody) not because any theme corresponds to a linguistic concept mechanically, but for brand cohesion — a linguistics tool should feel like a linguistics tool throughout its UI, even in the parts (like color themes) that have no functional connection to the generation engines. The names carry mood associations (see table below), not typological rules.

### 12.1 The Four Themes

| Theme | Mood | Core Colors |
|---|---|---|
| **Vernacular** | Warm, earthy, autumnal — cozy and grounded | Matterhorn `#4f4046`, Teak `#af8c62`, Tobacco Brown `#6f4f43`, Corduroy `#596361`, Baltic Sea `#252226` |
| **Isogloss** | Sunset drama — warm oranges against cool dark blues, high contrast | Dark Purple `#3d2228`, Burnt Sienna `#dd7057`, Sandy Brown `#f4a971`, Gunmetal `#213241`, Raisin Black `#272233` |
| **Glossolalia** | Nature meets nightfall — yellow-greens against deep violet-black, a little witchy | Lime Cream `#f4fdaf`, Light Gold `#efdd8d`, Fern `#65743a`, Dark Slate Grey `#394f49`, Midnight Violet `#210124` |
| **Prosody** | Elegant, romantic — cool pastels against deep wine | Baby Blue Ice `#afcefd`, Soft Periwinkle `#9f8def`, Dusk Blue `#3a5874`, Vintage Grape `#4e3459`, Rich Mahogany `#420404` |

### 12.2 Theme Selection

On first visit, the user is presented with a **theme picker** — all four shown side by side (ideally with a live preview of actual UI elements, not just color swatches) so the choice is made seeing real interface context, not abstract colors. The selection is stored as a global user preference and applied app-wide; it can be changed anytime from settings, not locked in after onboarding.

A sensible fallback default (e.g., Vernacular, as the most neutral/versatile of the four) should render before the user's first choice is made, to avoid an unstyled flash on initial load — but this is a technical fallback, not a "default theme" the user is nudged toward.

### 12.3 Contrast & Accessibility

Before implementation, each theme's specific color pairings (text-on-background combinations actually used in the UI) need a contrast-ratio check against WCAG AA standards, not just an eyeball pass. A few pairings worth flagging as likely needing adjustment based on the raw hex values alone:

- **Glossolalia**: Lime Cream and Light Gold are both light, low-contrast-with-each-other colors — if either is used as text on the other as background, that pairing will likely fail contrast checks and need a darker text color substituted for actual UI text (even if the swatch itself stays as an accent color).
- **Isogloss** and **Prosody**: several colors sit in a similar mid-tone range (Sandy Brown/Burnt Sienna; Dusk Blue/Vintage Grape) — fine as accents against a dark background, but risky if any pair is used together as text/background.

This is a v1 implementation task, not a v2 deferral — accessible contrast should be verified per theme before ship, using the palette hues as a starting aesthetic target rather than the literal exact hex-to-hex pairing wherever that pairing would be illegible.

## 13. Tech Stack & Architecture

Stays in your established lane — no new tooling paradigm beyond what the generation engines themselves demand.

### 13.1 Core Stack

- **Framework:** Next.js + TypeScript
- **Backend/data:** Convex (schema per Section 10)
- **Auth:** Clerk — needed for the ownership/sharing model in Section 10.4 (`languages.owner`, `languageShares`)
- **Deployment:** Vercel

### 13.2 Seeded Randomness

Every generation stage (Sections 4-8) runs on a seedable PRNG per Design Principle 3 (deterministic and seedable) — no specific library mandated; Cody can select a standard, well-tested seedable generator (e.g., a PRNG with a documented seed → sequence guarantee) as an implementation detail. The requirement that matters architecturally: the seed (plus current parameters) must be stored per language/stage so any generation is exactly reproducible later, not just "random but consistent within a session."

### 13.3 PDF Generation: Client-Side

PDF export (Section 11) renders client-side, consistent with a simpler Next.js/Convex setup than standing up server-side rendering infrastructure for what's fundamentally a data-to-document transform the client already has all the data for.

### 13.4 Glyph Rendering: Procedural SVG

Orthography's rendered glyphs (Section 8) are **procedurally generated SVG** — glyph shapes built from stroke/shape composition rules, not selected from existing font glyphs or generated as an actual installable font file. This keeps glyph generation consistent with the rest of the system's philosophy (Design Principle 5 — traceable to a rule; Design Principle 9 — no black-box magic): a glyph's shape should be explainable as "these strokes, composed this way," not an opaque generated image.

- Both invented and real-like aesthetic modes (Section 8.2) are implemented as different stroke/composition rule sets feeding the same SVG-generation approach — not two separate rendering systems.

### 13.5 Live Preview Data Flow

Concrete mechanism for how a preview updates as a parameter control (Section 9.3) moves, closing the gap left by an earlier draft that only asserted previews "should be fast" without specifying where computation happens:

- **Preview generation runs client-side, against in-memory (unsaved) parameter values.** Dragging a slider does not round-trip to a Convex function on every tick — the relevant generation function (e.g., Phonology's phonotactics/cluster-grading logic from Section 4) runs directly in-browser against the current draft parameter state, since all generation is deterministic and rule-based (no server-only data or API calls required to produce a preview).
- **Debouncing:** slider input is debounced (a short delay, e.g. ~100-150ms after the last change) before triggering preview regeneration, so a drag produces one preview update after motion settles rather than firing on every pixel of movement. This is a real requirement, not an assumption to revisit later — cheap to implement and avoids unnecessary recomputation regardless of how fast the underlying generation turns out to be.
- **Commit vs. preview state:** the in-browser preview state is separate from the persisted Convex document. Only an explicit user action (e.g., confirming a generation, not just previewing one) writes the result to the relevant stage table (Section 10.2). This keeps rapid slider exploration cheap and keeps `stageHistory` (10.3) free of noise from every intermediate preview tick.
- **When persisted data is actually needed for a preview** (e.g., Lexicon's preview needs the current Phonology document to build example roots against), it's fetched once per stage-entry, not re-fetched on every parameter tick — parameter changes only re-run the client-side generation function against already-loaded upstream data.

### 13.6 Live Preview Performance

Since all generation is deterministic/rule-based (no external API calls, no ML inference latency) and previews run client-side per 13.5, performance should be comfortably fast without additional infrastructure. This is a reasonable default assumption, not a guarantee — if a specific engine's preview generation turns out to be slow enough to feel laggy during real testing, that's an implementation-time fix (heavier memoization, or moving specific preview computations to a Convex function), not a fundamental architecture blocker.

## 14. Open Questions

Unresolved items flagged throughout this doc, collected here rather than left buried in individual sections. Organized by category — not all carry equal urgency; some need resolving before implementation starts, others can wait until there's a working prototype to react to.

### 14.1 Linguistic Design

- **Is SSP-based cluster grading (Section 4.3) sufficient for "elegance," or are there other dimensions worth formalizing** — e.g., inventory balance/symmetry (does a lopsided consonant-to-vowel ratio feel less elegant regardless of cluster behavior?), vowel harmony aesthetics, or rhythm/prosodic "feel" beyond stress placement alone? SSP is a solid, real starting mechanism — but likely not the whole story once real outputs can be heard.
- **Concrete semantic domain list for Lexicon (Section 6.2)** — the core list + domain-weighting system is designed, but the actual curated list of domains and core concepts needs real content authoring before the engine has anything to draw from. This is a content task, not just an architecture one.
- **Word-order/morphology correlation rules for Syntax (Section 7.1)** — which specific Greenberg-style universals actually get implemented to keep word order consistent with morphological typology needs a concrete, scoped rule set, not just "informed by cross-linguistic correlations" in the abstract.

### 14.2 Technical / Architecture

- **Does affix count actually warrant a separate `morphologyItems` table (Section 10.2)?** — flagged as conditional; needs a real decision once affix-strategy scope (Section 5.2) is fleshed out enough to estimate typical counts.
- **Snapshot cadence for history (Section 10.3)** — "periodic checkpoints" was proposed, but how often (every Nth regeneration? time-based? user-triggered only?) isn't pinned down yet.
- **Procedural SVG glyph generation quality (Section 8, 13.4)** — this is a genuinely hard sub-problem on its own: making stroke/shape-composition rules produce glyphs that look *coherent as a script* (not just individually valid shapes) may need its own mini design pass once work starts here.
- **Exact WCAG-compliant color adjustments per theme (Section 12.3)** — flagged pairings (especially Glossolalia's light-on-light risk) need real adjusted values chosen, not just flagged as risky.

### 14.3 Content & Scope Depth

- **How deep should domain-weighting go (Section 6.2)** — current design treats it as flavoring an existing core list. Worth revisiting once there's a working prototype: does it want to grow into something closer to lightweight worldbuilding/culture inputs, or stay a vocabulary-emphasis dial?
- **Reduplication and allomorphy interaction complexity (Sections 4.3, 5.2, 5.4)** — reduplication combined with phonologically-conditioned allomorphy could get genuinely gnarly to generate correctly (a reduplicated form needs to still obey phonotactics and allomorphy rules) — worth a focused design pass when this part of Morphology is actually built.

### 14.4 v2 and Beyond

- **Language aging/evolution mechanics (Design Principle 8)** — the schema reserves space (`languageRelations`, Section 10.5) but the actual algorithm for how a language plausibly "ages" (which words drop, which get borrowed, how sound change propagates over simulated time) is entirely undesigned. A substantial v2 design effort on its own.
- **Blending/contact mechanics** — similarly reserved but undesigned: what does it mean, mechanically, for two conlangs to "blend" or influence each other through simulated contact?
- **Sharing permission granularity (Section 10.4)** — `languageShares` reserves the concept, but permission levels (view-only vs. collaborative editing vs. forking someone else's language) aren't defined yet.

## 15. Roadmap / Phasing

This is a genuinely multi-month build — the original ask was "something big," and Morphology alone (Section 5) is a substantial engine on its own. Phasing below sequences work by dependency order (Section 3's pipeline) while surfacing early, demoable milestones rather than one long march to a single "done."

### Milestone 0: Foundation
- Next.js + Convex + Clerk scaffold
- Core schema from Section 10 (`languages`, stage tables, `stageHistory`, reserved `languageShares` / `languageRelations`)
- Theming system (Section 12) — genuinely independent of the generation engines, good candidate to build early as a low-risk, visible win
- Basic library UI shell (list/create/open a language)

### Milestone 1: Phonology + the Steering Paradigm
- Full Phonology Engine (Section 4): inventory generation via implicational hierarchies, phonotactics with max control, SSP-based elegance grading, stress/tone
- This milestone also stands up the **general steering mechanics** (Section 9) — locking, nudge/reroll, live preview, history — against Phonology first, since it's the pipeline's foundation. Getting steering right here means Lexicon/Morphology/Syntax/Orthography reuse a proven pattern rather than each reinventing it.

### Milestone 2: Lexicon (Core)
- ~500-root generation (Section 6) against the core semantic list
- Domain-weighting as a v1 feature, but reasonable to ship the core list first and layer weighting in as a fast follow within this milestone

### Milestone 3: Morphology (Core)
- Typology selection with live previews (Section 5.1)
- Baseline affixation: prefixation/suffixation + a first pass at grammatical categories (Section 5.3)
- This is a deliberate internal split within Morphology's large scope — core linear affixation and categories first, before the harder non-linear strategies

### Milestone 4: Morphology (Full Coverage)
- Full affix strategy set (Section 5.2): infixation, circumfixation, reduplication, templatic/apophonic patterns, ablaut, suppletion
- Phonologically-conditioned allomorphy (Section 5.4) — the deepest integration point between Phonology and Morphology, reasonably sequenced last within this engine since it depends on both being stable
- Derivational morphology (Section 5.5) feeding word families back into Lexicon

### Milestone 5: Syntax (v1-lite)
- Word order typology + basic constituent structure (Section 7) — the lightest engine, should move quickly once Morphology's categories exist to arrange

### Milestone 6: Orthography
- Script category + invented/real-like aesthetic selection (Section 8)
- Procedural SVG glyph generation (Section 13.4) — flagged in Open Questions (14.2) as a real sub-problem worth its own design attention when this milestone starts

### Milestone 7: Export
- PDF generation (Section 11): complete/summary toggle, IPA/romanization choice, profile-page + academic-reference structure, script always rendered

### Milestone 8: Library Polish & Sharing
- Multi-user visibility/sharing surfaces (Section 10.4) beyond the reserved schema — actual UI for sharing a language, viewing shared languages

### v2 Candidates (Explicitly Out of Scope for v1)
- Language aging/evolution (Design Principle 8, Open Questions 14.4) — sound change over time, vocabulary loss/borrowing
- Inter-language blending/contact (Open Questions 14.4)
- Deeper domain-weighting → lightweight culture/worldbuilding inputs (Open Questions 14.3)
- Complex syntax: subordination, relative clauses, coordination (Section 7.1's explicit v1 exclusions)
- Granular sharing permissions (view/edit/fork distinctions, Open Questions 14.4)
