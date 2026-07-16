# docs/CHECKPOINTS

Archived checkpoint blocks + the user's verdict, one file per feature (`F0X.md`), per
`DEVELOPMENT-PLAN.md` SS1.3. Appended to (not overwritten) each time that feature returns to
CHECKPOINT after a CHANGES verdict, so the history of what was reviewed and decided is preserved.

`PHASE0.md` covers the Phase 0 foundation checkpoint, since it predates any F0X feature.

## Checkbox rule

YOUR TESTS / YOUR TASKS / DESIGN REVIEW items are `- [ ]` checkboxes (per `DEVELOPMENT-PLAN.md`
SS1.2). Check them off (`- [x]`) as you complete/answer each one directly in the file. Every box
must be checked before a PASS is valid - if you want to proceed with one left unchecked, say why
and Claude Code will append `— SKIPPED (<date>): <reason>` to that line rather than checking it.
A checkpoint file with open, unexplained boxes and a plain `PASS` reply is not a completed gate.
