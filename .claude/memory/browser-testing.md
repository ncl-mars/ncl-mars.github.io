---
name: browser-testing
description: Browser smoke tests use the user's Brave, only after asking; never probe for or install other browsers
metadata:
  type: feedback
---

For browser checks (shader compile, smoke tests), the user has **Brave**. Ask before launching it, keep any profile in `.tmp/`. Don't look for Edge/Chrome or install anything.

**Why:** 2026-10-29, probing for Edge to run a headless shader test was read as installing software on their machine; they stopped it.

**How to apply:** default is to hand browser checks to the user; propose a Brave run only when a check really needs it. See [[commit-workflow]] for the other "user's machine" rules.
