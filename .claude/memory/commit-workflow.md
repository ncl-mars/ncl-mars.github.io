---
name: commit-workflow
description: The user commits; Claude hands over one final PowerShell commit block when the user is about to commit
metadata:
  type: feedback
---

The user runs every git command and likes it: it lets them batch follow-up fixes into one clean commit and review `git status` first. When a piece of work is done, give the commit as one PowerShell block (`git add -A` + here-string piped to `git commit -F -`). If more changes land before they commit, re-send the full updated block rather than a diff of the message. Suggest branch names when asked (`feature/<milestone>-<topic>`, they also used `dev-panel`).

**Why:** The user confirmed the workflow ("me doing the commit allows better commits") after a dev-panel commit that absorbed three follow-up tweaks.

**How to apply:** No commits, no `Co-Authored-By` (see CLAUDE.md). Messages: a short summary line, a blank line, then bullets grouped by what changed. Plain ASCII only: no apostrophes (write "of the POI", not "POI's"), no curly quotes or dashes. On 2026-10-29 a message with apostrophes broke the commit twice while the user thought it had landed. After a commit, a read-only `git log --oneline -1` confirms it. Related: [[user-profile]].
