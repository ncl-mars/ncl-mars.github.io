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

A header in YAML between two `---` lines, then the text: paragraphs separated by a blank line. Line breaks inside a paragraph don't count (it's one paragraph). Plain text: no Markdown formatting, except one line to place an image or a video between paragraphs.

```markdown
---
title: Trench A
credits:
  Direction: Name Surname
  Lookdev, lighting: Name Surname, Name Surname
---
First paragraph of the presentation.

![Spheres at dusk: lookdev test](wide.jpg)

Second paragraph.

![Fly-through](clip.mp4)

A last paragraph, under the film.
```

**A file in the text:** a line of its own, between blank lines, that is exactly `![what it shows](file)`: that image or video of the folder, at that place. The text in the brackets describes it for screen readers (it can be empty: `![](file.jpg)`). No spaces in the file name; a line that isn't exactly that, or such a link inside a sentence, stays text. Text, images and videos come in any order.

The card shows the text (with its files), then the credits, then the `media` list. The lightbox goes through every image of the card, in that order.

| Key | Meaning |
|-----|---------|
| `title` | **required**: the label in the scene, the menu entry, the card's title |
| `credits` | optional: one `Role: names` line per role, indented, in order. A value that is a web address becomes a link: `Website: https://example.com` (shown as `example.com`). No date field: a `Year: 2025` line does it |
| `media` | optional: files shown at the end of the card, after the credits: one `- file: what it shows` line per file, in order. The text after the colon describes the file for screen readers. A file placed in the text doesn't need to be listed here |

Files, in the text or in `media`: images png, jpg, webp (resized and converted at build); videos mp4, webm, copied as they are (encode for the web first: H.264 MP4 with `-movflags +faststart`, about 1080 px tall), played muted and looping while visible.

A project with no text and no media has **no card**: its POI's label and menu entry are plain text, and it has no page.

## YAML, the few rules that matter

- Indent with spaces, never tabs. The lines under `credits:` and `media:` are indented the same amount (two spaces).
- A value containing `: ` (colon then space), or starting with `"`, `'`, `[`, `{`, `#`, `&`, `*`, `!`, `|`, `>`, `%` or `@`, goes in double quotes: `"Spheres at dusk: lookdev test"`.
- `#` after a space starts a comment.

## Checks

When the site loads (and at build), these stop the page with a message naming the file: no header, a key other than the three above, no title, a malformed `credits` or `media`, a file (in the text or in `media`) that isn't in the folder. A YAML syntax error is reported the same way, with its line.
