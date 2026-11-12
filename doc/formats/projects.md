# Project folder format

What a project shows: its label's title and its card (text, credits, images, videos), opened from its label and the menu. One folder per POI, named by its id ([pois.md](pois.md) says where it stands). Read by `web/src/lib/content/projects.ts`, through the build-time reader in `web/vite.config.ts`.

## Folder

```
web/src/lib/assets/projects/trench-a/
  project.md
  wide.jpg
  clip.mp4
  clip.jpg      ← the video's poster: same name, image extension (optional)
```

## `project.md`

A header in YAML between two `---` lines, then the presentation: paragraphs separated by a blank line. Line breaks inside a paragraph don't count (it's one paragraph). Plain text: no Markdown formatting.

```markdown
---
title: Trench A
credits:
  Direction: Name Surname
  Lookdev, lighting: Name Surname, Name Surname
media:
  - wide.jpg: "Spheres at dusk: lookdev test"
  - clip.mp4: Fly-through
---
First paragraph of the presentation.

Second paragraph.
```

| Key | Meaning |
|-----|---------|
| `title` | **required**: the label in the scene, the menu entry, the card's title |
| `credits` | optional: one `Role: names` line per role, indented, in order |
| `media` | optional: one `- file: what it shows` line per file of the folder, in order. Images: png, jpg, webp (resized and converted at build). Videos: mp4, webm, copied as they are (encode for the web first: H.264 MP4 with `-movflags +faststart`, about 1080 px tall), played muted and looping while visible. The text after the colon describes the file for screen readers |

A project with no presentation and no media has **no card**: its POI's label and menu entry are plain text, and it has no page.

## YAML, the few rules that matter

- Indent with spaces, never tabs. The lines under `credits:` and `media:` are indented the same amount (two spaces).
- A value containing `: ` (colon then space), or starting with `"`, `'`, `[`, `{`, `#`, `&`, `*`, `!`, `|`, `>`, `%` or `@`, goes in double quotes: `"Spheres at dusk: lookdev test"`.
- `#` after a space starts a comment.

## Checks

When the site loads (and at build), these stop the page with a message naming the file: no header, a key other than the three above, no title, a malformed `credits` or `media`, a media file that isn't in the folder. A YAML syntax error is reported the same way, with its line.
