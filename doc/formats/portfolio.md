# Portfolio file format

The portfolio's own text, the only text that isn't a project's: your name and the home page's description. Read by `web/src/lib/content/portfolio.ts`, through the build-time reader in `web/vite.config.ts`.

The sites (disciplines) aren't listed here: each POI carries its own, in Houdini ([pois.md](pois.md)).

## File

`web/src/lib/assets/portfolio.yaml`

```yaml
name: Your Name
description: One or two sentences for search engines and link previews.
```

| Key | Meaning |
|-----|---------|
| `name` | **required**: the masthead, the home page's browser tab, and the end of each project's tab title ("Trench A · Your Name") |
| `description` | optional: the home page's description for search engines and link previews |

## Checks

When the site loads (and at build), these stop the page with a message: a key other than these two, no name. YAML rules: see [projects.md](projects.md#yaml-the-few-rules-that-matter).
