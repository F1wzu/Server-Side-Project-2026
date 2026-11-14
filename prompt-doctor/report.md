# Prompt Doctor report — Fable 5.2 (13 Nov 2026)

## Files found

| File | Lines | Notes |
|---|---|---|
| `CLAUDE.md` (project) | ~75 (64 non-blank) | well under the 200-line limit (#11 not hit) |
| `~/.claude/agents/critic.md` | 8 | model: opus |
| `~/.claude/agents/scout.md` | 8 | model: haiku |
| `~/.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, `AGENTS.md` | — | do not exist |
| auto memory (`~/.claude/projects/*/memory/`) | — | empty |
| user / project skills | — | none |
| plugin skills (72 `SKILL.md`) | — | searched for the stale phrases (double-check, step by step, never retry, think less, word/token caps): 0 matches. Not edited: plugin files are overwritten on update. |

Backups of all three edited-candidate files are in `prompt-doctor/backup/`. Nothing outside `prompt-doctor/` has been changed.

## Findings

No line costs money or does nothing for Fable 5.2. No contradictions between rules.
Everything below is "keep"; two are marked "your call".

| # | File:line | Exact line | Matches | Cost | Proposal |
|---|---|---|---|---|---|
| 1 | CLAUDE.md:31 | `Don't commit unless asked.` | #4 / #10 | none; the exception is already in the rule | **keep, your call.** Optional: name the approval ("commit only when I say commit; a 'go' for a step is not a commit approval") |
| 2 | CLAUDE.md:32 | `Stop after each step with a report…` | — | adds a report per step, which you want | keep |
| 3 | CLAUDE.md:35 | `Large steps may use subagents (the user allowed it). Give each one exclusive files…` | #5 | none; already limited to large steps, with ownership rules | keep |
| 4 | CLAUDE.md:34 | `Write the user-facing reply in plain language…` | #8 | none; not a hard length limit | keep |
| 5 | CLAUDE.md:41 | `…never copy it into this repo wholesale or edit it` | #3 | protects the reference app | keep |
| 6 | CLAUDE.md:54 | `Never change the schema outside a migration.` | #4 | protects the database; reason still holds | keep |
| 7 | CLAUDE.md:66 | `…never print or commit it` (.env) | #3 | protects secrets | keep |
| 8 | CLAUDE.md:9-25 | "Where things stand" block (dated 13 Nov, admin account, seeded-place counts) | — | goes stale and costs tokens every session if not updated | **keep, your call.** Update it after each step, or move the facts to PLAN.md |
| 9 | critic.md:8 | `Assume this change is broken. Find how it fails. One line per issue…` | #8 (mild) | none; a format hint, not a sentence-length cap | keep |
| 10 | scout.md:8 | `…No fixes, no opinions.` | #3 | none; matches the agent's job | keep |

## Counts

- Lines to delete: **0**
- Lines to rewrite: **0** (2 optional, your call: #1 and #8)
- Lines to keep: **10**
