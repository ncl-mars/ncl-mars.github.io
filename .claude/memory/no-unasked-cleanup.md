---
name: no-unasked-cleanup
description: Never remove or "clean up" panel params, switches or code the user didn't ask to remove; an offer to remove isn't permission
metadata:
  type: feedback
---

Don't remove tuning params, dev switches or code unless the user explicitly asks. Saved defaults (e.g. a switch left at 0) are not a choice to delete it; a pending offer ("tell me whether to remove it") is not a yes.

**Why:** on 2026-11-12 the user saved defaults with Height filter at 0 and said "you can check the settings to see what renders better"; I read that as "bilinear won" and removed the Height filter / Flip diagonal switch. The user was furious ("did I ask to do anything? I wanted to keep the params"); I restored it.

**How to apply:** when a message doesn't clearly ask for a change, answer or ask, don't edit. Keep test switches in the panel until the user says to remove them. Related: [[verify-facts]], [[diagnose-first]].
