---
name: hosting-assets
description: No Git LFS; everything the site serves is tracked in the repo; GitHub's real limits; Proton Drive can't serve files
metadata:
  type: project
---

The user doesn't want Git LFS (2026-11-03). Everything the site serves (terrain exports, project images and videos, content) is tracked in the repo: the deploy workflow builds from a checkout, and enhanced-img resizes the images at build time.

GitHub's limits (checked 2026-11-03): git warns on files over 50 MiB, GitHub blocks files over 100 MiB; a Pages source repo is recommended under 1 GB; a published Pages site is at most 1 GB, with a soft 100 GB/month of bandwidth. There is no 50 MB repo ceiling (the user believed there was). At 2026-11-03 the history was about 30 MB (37 with an undone commit's objects), 86 % of it terrain versions.

Proton Drive can't host the site's files: public links open Proton's page, which decrypts in the browser (end-to-end encryption), so there's no direct file URL. If videos grow the total toward several hundred MB, the escape hatch is a GitHub Release (files up to 2 GB each, outside the repo's size) downloaded by the deploy workflow before the build.

**How to apply:** keep media compressed and avoid committing many versions of the same big file; don't suggest LFS. Relates to [[deploy-later]], [[commit-workflow]].
