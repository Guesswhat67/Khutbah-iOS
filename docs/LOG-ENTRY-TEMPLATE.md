# LOG ENTRY TEMPLATE — canonical format for `docs/CHANGES_LOG.md`

**Effective:** 2026-07-11 (mid-session rule from Aayaan: "log exact line + why + diff")

Every entry appended to `docs/CHANGES_LOG.md` after this template was put in
force must follow the schema below, **exactly**. Any deviation is grounds to
revert the change and redo the log entry before merge.

---

## Required fields

| Field | Example | Notes |
|---|---|---|
| Heading | `## PLAN-NNN — <one-line summary>` | Reverse-chronological inside the file. |
| `- **Date:**` | `2026-07-11` | YYYY-MM-DD. |
| `- **File(s):**` | `src/HomePanel.jsx` | Comma-separated, each path relative to project root. |
| `- **BEFORE lines:**` | `412–415` | Exact. No `~`. Use `±N` only when N=0. |
| `- **AFTER lines:**` | `412–418` | Exact, post-insert. |
| `- **Status:**` | `✅ Verified` | One of `✅` / `⚠️` / `❌`. |
| `- **Why:**` | `…` paragraph | 2–3 sentences: root cause + decision. |
| `- **Diff:**` | `git diff`-style ``` block | Show OLD line(s) removed AND NEW line(s) added. |
| `- **Validation:**` | `node --check src/HomePanel.jsx → exit 0` | Evidence of the command that proved the fix. |
| `- **Plan:**` | `[PLAN-NNN](./PLAN-NNN-…md)` | Relative link to the spec doc. |

---

## Worked example (illustrative — not a real entry)

```markdown
## PLAN-005 — Prayer card title alignment fix on iPad
- **Date:** 2026-07-11
- **File:** `src/HomePanel.jsx`
- **BEFORE lines:** 412–415
- **AFTER lines:** 412–418
- **Status:** ✅ Verified
- **Why:** iPad in landscape shows the next-prayer title left-aligned, but the
  weekday counter underneath is right-aligned — the column looks ragged. The
  `styles.title` rule had no alignment; the wrapper `styles.prayerCard`
  container was left-to-right with `flex-end` only on the counter row.
  Decision: align both via the title-level rule for the smallest possible
  diff and to keep the counter rule untouched (Android depends on it elsewhere).
- **Diff:**
  ```diff
  - <Text style={styles.title}>
  -   {prayerName}
  - </Text>
  + <Text style={[styles.title, styles.rightAlign]}>
  +   {prayerName}
  + </Text>
  + ```
- **Validation:** `node --check src/HomePanel.jsx` exits 0; iPad simulator at
  1366×1024 in landscape renders the title right-aligned and the counter column
  intact.
- **Plan:** [PLAN-005](./PLAN-005-prayer-card-alignment.md)
```

---

## Multi-range changes

If a change spans MORE THAN ONE contiguous block in a single file (e.g. a
function is split or a flag is touched in two places), list both:

```markdown
- **BEFORE lines:** 67–72 and 1180–1190
- **AFTER lines:**  67–74 and 1180–1186
```

If a change spans MULTIPLE FILES, list each file's BEFORE / AFTER on its own
bullet:

```markdown
- **Files:**
  - `src/App.jsx` — BEFORE 1080–1090, AFTER 1080–1093
  - `src/plugins/AppleSTT.js` — BEFORE 50–55, AFTER 50–60
```

---

## Format reminders

- Use `git diff`-style **minus `-` / plus `+`** prefixes inside the fenced block.
- Don't fold or paraphrase the diff; copy verbatim from `git diff` so a reviewer
  can apply the change blindly if they revert.
- `BEFORE` and `AFTER` line numbers refer to the file as it was AT THE TIME OF
  THE CHANGE. If the file gets further edits later, they remain frozen to
  preserve history (don't renumber retroactively).
- **`~lines` is forbidden** for new entries. If you can't measure, write
  `BEFORE: unknown (pre-template entry)` and explain in `Why`.
