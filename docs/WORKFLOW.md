# WORKFLOW — All actions must be planned, then documented

**Effective:** 2026-07-11 (mid-session rule from Aayaan)

## The Iron Rule

> "Generate a plan before fixing any bug or doing stuff. After every change, log
> the exact line, why, and a diff." — Aayaan (2026-07-11)

For every code change and every non-trivial action in this project, follow these three phases **in order**:

### Step 1 — PLAN (mandatory BEFORE any code is touched)
Write a markdown plan first, with a unique plan ID (`PLAN-001`, `PLAN-002`, …) saved
to `docs/PLAN-NNN-short-title.md`. Use the structure already established:

- **Title & Meta** — what is being changed, which version, who owns.
- **⚡ LIVE PARITY STATUS** — pre-state vs. post-state table.
- **0. STRICT RULES OF ENGAGEMENT** — what we will NOT touch.
- **Master Plan** — Root Cause / Logic, The Code Fix (exact file paths + a
  `git diff`-style snippet showing OLD → NEW), Native iOS Work, Future-Proofing.
- **Validation & Acceptance Checklist** — boolean list, exact commands.
- **Version Table & Handoff** — what shipped, what's still open.

The plan's "The Code Fix" section must contain the **exact lines** that will be
touched — not paraphrases. If the plan cannot show exact lines, the change isn't
small enough to skip measuring them.

### Step 2 — APPLY
Make the change only after the plan exists on disk (this file or a sibling
spec). **Code without a plan is forbidden.** If mid-flight you discover you need
to deviate, STOP and either amend the existing plan or split into `PLAN-NNN+1`
before continuing. Cite the `PLAN-NNN` id in the commit message.

### Step 3 — LOG (immediately after every successful APPLY)
Update `docs/CHANGES_LOG.md` with the strict format documented in
[`docs/LOG-ENTRY-TEMPLATE.md`](./LOG-ENTRY-TEMPLATE.md). At a minimum the entry
must contain:

- **`PLAN-NNN`** reference.
- **Exact file path** (relative to project root).
- **Exact BEFORE line numbers** (e.g. `lines 67–75`).
- **Exact AFTER line numbers** (e.g. `lines 67–79`, after the insert).
- The **OLD line(s)** being removed.
- The **NEW line(s)** being added — shown as a `git diff`-style snippet.
- **WHY** — root cause + reasoning, 2–3 sentences.
- **Validation evidence** — the command + result that proved the fix works.
- **Status** — ✅ Verified / ⚠️ Pending / ❌ Reverted.

If the change is not on a single contiguous line range, list every range.
Approximate line numbers (`~lines`) are allowed ONLY for entries made before
this workflow was put in force (entries that pre-date the addition of this file
to the repo).

## Where Plans Live

Each plan is its own `.md` file at the repo root or `docs/`:
- `docs/PLAN-001-prayerdata-explicit-init.md` — explicit memberwise init for PrayerData.swift
- `docs/PLAN-002-ios-deployment-target-bump.md` — IPHONEOS_DEPLOYMENT_TARGET 15 → 16 for App target
- `docs/PLAN-003-spm-cache-recovery-script.md` — `scripts/ios-fix-pkg-cache.mjs` & npm hook
- `docs/PLAN-003.1-ios-fix-spm-pkg-hardening.md` — AppleScript quit-saving-no + macOS guard
- `docs/PLAN-004-apple-stt-elevenlabs-fallback.md` — AppleSTT probe + AAPLESTT_UNAVAILABLE + App.jsx isFallback

Bigger specs (`docs/noor-ios-bugfix-2026-07-11.md`) are the human-readable narrative; plan files are the formal contracts.

## Living Documents

These update as work progresses, never get deleted:

- **`docs/CHANGES_LOG.md`** — append-only, every code change after this rule binds us.
- **`docs/WORKFLOW.md`** — this file. Read it before doing anything.
- **`docs/noor-ios-bugfix-2026-07-11.md`** — current iOS parity spec.
- **`docs/noor-ios-restart-prompt.md`** — paste into a new chat to restore context.

## Exceptions (no plan needed)

- One-line typo fixes in markdown prose, comments, or `console.log` text.
- Read-only investigations (`grep`, file reads, `nm`, `xcodebuild -showBuildSettings`).
- Reverting a single line to its pre-plan state.

Everything else requires a `PLAN-NNN`.
