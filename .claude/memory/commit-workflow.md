---
name: commit-workflow
description: The user commits; Claude hands over one final PowerShell commit block when the user is about to commit
metadata:
  type: feedback
---

The user runs every git command and likes it: it lets them batch follow-up fixes into one clean commit and review `git status` first. When a piece of work is done, give the commit as one PowerShell block (`git add` of explicit paths + `git commit -F .tmp\commit-msg.txt`). Heavy assets stay out unless the user asks: the terrain exports (`web/src/lib/assets/terrain/*.bin`, `.png` and their `.json`) and `hou/*.hiplc`, with the terrain-tied tuning (`defaults.json`) kept with them; so never `git add -A` while they're modified. The user said "I don't want to pack heavy assets" (2026-11-03): try terrains without filling the history; saved sets go in `hou/geo/terrains/<name>/` instead ([[terrain-sets]]). If more changes land before they commit, re-send the full updated block rather than a diff of the message. Suggest branch names when asked (`feature/<milestone>-<topic>`, they also used `dev-panel`).

**Why:** The user confirmed the workflow ("me doing the commit allows better commits") after a dev-panel commit that absorbed three follow-up tweaks.

**How to apply:** No commits, no `Co-Authored-By` (see CLAUDE.md). Messages: a short summary line, a blank line, then bullets grouped by what changed. Plain ASCII only: no apostrophes (write "of the POI", not "POI's"), no curly quotes or dashes. On 2026-10-29 a message with apostrophes broke the commit twice while the user thought it had landed. On 2026-11-03 a pasted here-string got the terminal's paste marker `[200~` at the start of the summary line: since then the message goes into `.tmp/commit-msg.txt` (written by Claude) and the block runs `git commit -F .tmp\commit-msg.txt`, so nothing multi-line is pasted. After a commit, a read-only `git log --oneline -1` confirms it. Before suggesting any merge, checkout or branch command, run a read-only `git branch --show-current` / `git log --oneline -3` / `git branch --merged develop` and only suggest what is still needed: on 2026-10-29 the user had merged a branch and was annoyed to be handed the merge again ("can you keep up?"). Related: [[user-profile]].
