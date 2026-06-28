# Speckit Visual Crawler

A static Playwright-based visual crawler that discovers pages from Open Design / Claude Design single-page prototype exports via the built-in **Prototype Map** UI, and compares frontend implementations against reference screenshots.

It writes all visual artifacts needed by `spec-kit-open-design` into `workspace/design-context/<project-slug>/`.

## Purpose

The crawler eliminates the need for per-project visual configuration. All project-specific behavior comes from CLI arguments, environment variables, and discovered prototype state. No project-local config files are read or written.

## Ownership

- **opencode-environment** owns the crawler package, Playwright dependency, Playwright runner execution, and `design-preview` Nginx access.
- **workspace/design-context/<project-slug>** owns the generated artifacts: prototype-map.json, source-map.json, screenshots, design-ir.json, comparison reports.
- **spec-kit-open-design** consumes these artifacts to generate normalized specification artifacts.

## Prerequisites

- The workbench is running (`./bin/oe start`).
- An Open Design prototype exists at `workspace/design-context/<project-slug>/index.html`.
- The prototype includes a **Prototype Map** UI (a button or link labeled "Prototype Map" that, when clicked, reveals screen navigation entries).

## Usage

### Via the oe CLI

```bash
# Discover screens from the prototype
./bin/oe speckit:visual <project-slug> discover
./bin/oe speckit:visual <project-slug> capture
./bin/oe speckit:visual <project-slug> all

# Compare frontend implementation against reference screenshots
./bin/oe speckit:visual <project-slug> compare --frontend-url http://node-runner:5173
```

### With extra arguments

```bash
./bin/oe speckit:visual <project-slug> discover --prototype-map-text "Flow Map"
./bin/oe speckit:visual <project-slug> capture --viewports desktop=1920x1080@1,mobile=390x844@2
./bin/oe speckit:visual <project-slug> all --full-page --headful --timeout-ms 60000
./bin/oe speckit:visual <project-slug> compare --frontend-url http://node-runner:5173 --fail-on-diff
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

### compare

Reads `route-map.json`, opens each frontend route in the configured viewport, captures actual screenshots, compares them against reference screenshots using `pixelmatch`, and writes:

- `visual-regression/test-results/comparison-report.json`
- `visual-regression/test-results/comparison-report.md`
- `visual-regression/test-results/actual/<entry-id>.png`
- `visual-regression/test-results/diff/<entry-id>.png`

**Required inputs:**

- `route-map.json` with `implementationRoute`, `referenceScreenshot`, and `viewport` per entry
- Reference screenshots from `visual-regression/screenshots/`

### all

Runs `discover` then `capture`.

## CLI Arguments

### Common (discover, capture, compare, all)

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

### Compare-only

| Argument | Required | Default | Description |
|---|---|---|---|
| `--frontend-url <url>` | no | `FRONTEND_URL` env, then `http://node-runner:5173` | Frontend base URL to compare |
| `--route-map <path>` | no | `<output-root>/visual-regression/fixtures/route-map.json` | Explicit route-map path |
| `--test-results-dir <path>` | no | `<output-root>/visual-regression/test-results` | Results output directory |
| `--fail-on-diff` | no | `true` for compare | Exit non-zero when comparison fails |
| `--no-fail-on-diff` | no | `false` | Always exit 0 even on visual diffs |
| `--update-actual` | no | `false` | Capture actuals and write report, exit 0 |
| `--compare-timeout-ms <num>` | no | `--timeout-ms` or `30000` | Timeout per frontend route |
| `--settle-ms <num>` | no | `500` | Extra wait after network/font ready |
| `--skip-frontend-healthcheck` | no | `false` | Skip frontend base URL reachability check |

## Environment Variables

| Variable | Fallback for |
|---|---|
| `SPECKIT_PROJECT` | `--project` |
| `DESIGN_PREVIEW_URL` | `--canonical-url` |
| `SPECKIT_VISUAL_OUTPUT_ROOT` | `--output-root` |
| `SPECKIT_PROTOTYPE_MAP_TEXT` | `--prototype-map-text` |
| `FRONTEND_URL` | `--frontend-url` |

## Generated Artifacts

```
workspace/design-context/<project-slug>/
  visual-regression/
    fixtures/
      prototype-map.json    # Discovered screens and entry metadata
      source-map.json       # Screen-to-action-path mapping with viewports
      route-map.json        # Frontend route mapping (created by design processing)
    screenshots/
      <screen-id>__desktop.png
      <screen-id>__tablet.png
      <screen-id>__mobile.png
    test-results/
      comparison-report.json  # Machine-readable comparison results
      comparison-report.md    # Human-readable comparison report
      actual/
        <entry-id>.png        # Actual frontend screenshots
      diff/
        <entry-id>.png        # Pixel difference images
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
| "route-map.json not found" | Run design processing to create route-map.json after `capture`. |
| "Failed to load URL" | Ensure `design-preview` service is running (`./bin/oe start`). Check the URL in a browser. |
| "Frontend URL is not reachable" | Start the frontend staging app first: `./bin/oe speckit:frontend-stage <slug> start`. |
| Zero entries found | The Prototype Map panel may not have rendered. Try increasing `--timeout-ms`. |
| Screenshots are blank | The prototype may use auth or have a loading state. Ensure it's fully static. |
