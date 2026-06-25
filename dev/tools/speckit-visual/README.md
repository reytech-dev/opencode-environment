# Speckit Visual Crawler

A static Playwright-based visual crawler that discovers pages from Open Design / Claude Design single-page prototype exports via the built-in **Prototype Map** UI.

It writes all visual artifacts needed by `spec-kit-open-design` into `workspace/design-context/<project-slug>/`.

## Purpose

The crawler eliminates the need for per-project visual configuration. All project-specific behavior comes from CLI arguments, environment variables, and discovered prototype state. No project-local config files are read or written.

## Ownership

- **opencode-environment** owns the crawler package, Playwright dependency, Playwright runner execution, and `design-preview` Nginx access.
- **workspace/design-context/<project-slug>** owns the generated artifacts: prototype-map.json, source-map.json, screenshots, design-ir.json.
- **spec-kit-open-design** consumes these artifacts to generate normalized specification artifacts.

## Prerequisites

- The workbench is running (`./bin/oe start`).
- An Open Design prototype exists at `workspace/design-context/<project-slug>/index.html`.
- The prototype includes a **Prototype Map** UI (a button or link labeled "Prototype Map" that, when clicked, reveals screen navigation entries).

## Usage

### Via the oe CLI

```bash
./bin/oe speckit:visual <project-slug> discover
./bin/oe speckit:visual <project-slug> capture
./bin/oe speckit:visual <project-slug> all
```

### With extra arguments

```bash
./bin/oe speckit:visual <project-slug> discover --prototype-map-text "Flow Map"
./bin/oe speckit:visual <project-slug> capture --viewports desktop=1920x1080@1,mobile=390x844@2
./bin/oe speckit:visual <project-slug> all --full-page --headful --timeout-ms 60000
```

### Directly (inside the Playwright runner)

```bash
node prototype-map-crawler.mjs discover --project my-project --canonical-url http://design-preview:80/design-context/my-project/index.html --output-root /workspace/design-context/my-project
```

## Commands

### discover

Opens the prototype at the canonical URL, finds and clicks the Prototype Map button, extracts all visible navigation entries, and writes:

- `visual-regression/fixtures/prototype-map.json`
- `visual-regression/fixtures/source-map.json`

### capture

Reads `source-map.json`, replays the action path for each screen across each viewport, captures screenshots, extracts the rendered DOM with computed styles, and writes:

- `visual-regression/screenshots/<screen-id>__<viewport>.png`
- `design-processing/design-ir.json`

### all

Runs `discover` then `capture`.

## CLI Arguments

| Argument | Required | Default | Description |
|---|---|---|---|
| `--project <slug>` | yes | `SPECKIT_PROJECT` env | Project slug |
| `--canonical-url <url>` | yes | `DESIGN_PREVIEW_URL` env, or derived from project | Prototype preview URL |
| `--output-root <path>` | yes | `SPECKIT_VISUAL_OUTPUT_ROOT` env, or derived from project | Artifact output root |
| `--prototype-map-text <text>` | no | `"Prototype Map"` | Text of the Prototype Map button |
| `--viewports <def>` | no | `desktop=1440x1024@1,tablet=768x1024@1,mobile=390x844@2` | Viewport definitions |
| `--viewport <name>` | no | — | Restrict to one viewport |
| `--max-entries <number>` | no | `200` | Max Prototype Map entries |
| `--full-page` | no | `false` | Capture full-page screenshots |
| `--headful` | no | headless | Run browser visibly |
| `--timeout-ms <number>` | no | `30000` | Playwright timeout |
| `--help` | no | — | Print usage |

## Environment Variables

| Variable | Fallback for |
|---|---|
| `SPECKIT_PROJECT` | `--project` |
| `DESIGN_PREVIEW_URL` | `--canonical-url` |
| `SPECKIT_VISUAL_OUTPUT_ROOT` | `--output-root` |
| `SPECKIT_PROTOTYPE_MAP_TEXT` | `--prototype-map-text` |

## Generated Artifacts

```
workspace/design-context/<project-slug>/
  visual-regression/
    fixtures/
      prototype-map.json    # Discovered screens and entry metadata
      source-map.json       # Screen-to-action-path mapping with viewports
    screenshots/
      <screen-id>__desktop.png
      <screen-id>__tablet.png
      <screen-id>__mobile.png
  design-processing/
    design-ir.json          # Full visual IR: screenshot paths, DOM trees, computed styles
```

## Limitations

The crawler depends on the Prototype Map UI. It may miss:

- Modals not represented in the Prototype Map
- Hover-only states
- Form validation states
- Drag/swipe-only states
- Animation-only states
- Hidden keyboard-only interactions

These should be handled by manually editing `source-map.json` or by a supplemental interaction crawler.

## Troubleshooting

| Problem | Likely Cause |
|---|---|
| "Prototype Map button not found" | The button text doesn't match. Use `--prototype-map-text` to set the correct label. |
| "source-map.json not found" | Run `discover` before `capture`. |
| "Failed to load URL" | Ensure `design-preview` service is running (`./bin/oe start`). Check the URL in a browser. |
| Zero entries found | The Prototype Map panel may not have rendered. Try increasing `--timeout-ms`. |
| Screenshots are blank | The prototype may use auth or have a loading state. Ensure it's fully static. |
