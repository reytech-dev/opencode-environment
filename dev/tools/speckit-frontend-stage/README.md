# Speckit Frontend Stage Materializer

Generates a temporary frontend staging app from `spec-kit-open-design` design-context artifacts using the workbench frontend blueprint.

## Purpose

Materializes a frontend staging app from the configured frontend blueprint (default: `frontend/ui-apollo`) and overlays design-derived GraphQL fixtures, mock helpers, routes, and design references. The staging app is blueprint-compatible with the eventual final frontend repository.

## Ownership

- **opencode-environment** owns this package and its execution via `node-runner`.
- **workspace/frontend-staging/&lt;project-slug&gt;** owns the generated staging app.
- **workspace/design-context/&lt;project-slug&gt;** is the canonical source of truth — never modified by this tool.

## Usage

### Via the oe CLI

```bash
# Default blueprint mode (frontend/ui-apollo)
./bin/oe speckit:frontend-stage <project-slug> create

# With explicit blueprint and ref
./bin/oe speckit:frontend-stage <project-slug> create \
  --blueprint frontend/ui-apollo \
  --blueprint-ref v1.2.0

# Force re-materialize the blueprint base
./bin/oe speckit:frontend-stage <project-slug> create --force-blueprint

# Force overlay file regeneration (preserves blueprint base)
./bin/oe speckit:frontend-stage <project-slug> create --force

# Force fixture regeneration only
./bin/oe speckit:frontend-stage <project-slug> create --force-fixtures

# Explicit fallback synthetic mode (not recommended)
./bin/oe speckit:frontend-stage <project-slug> create \
  --no-blueprint \
  --fallback-template vite-react

# Lifecycle commands
./bin/oe speckit:frontend-stage <project-slug> install
./bin/oe speckit:frontend-stage <project-slug> start
./bin/oe speckit:frontend-stage <project-slug> build
./bin/oe speckit:frontend-stage <project-slug> test
./bin/oe speckit:frontend-stage <project-slug> clean
./bin/oe speckit:frontend-stage <project-slug> copy-to <frontend-repo>
```

### Directly (inside the node-runner)

```bash
cd /tools/speckit-frontend-stage
npm install
node materialize-frontend-stage.mjs \
  --project my-project \
  --design-root /workspace/design-context/my-project \
  --stage-root /workspace/frontend-staging/my-project
```

## CLI Arguments

| Argument | Required | Default | Description |
|---|---|---|---|
| `--project <slug>` | yes | `SPECKIT_PROJECT` env | Project slug |
| `--design-root <path>` | yes | `/workspace/design-context/<project>` | Design context root |
| `--stage-root <path>` | yes | `/workspace/frontend-staging/<project>` | Staging output root |
| `--blueprint <id>` | no | `frontend/ui-apollo` | Blueprint ID to use |
| `--blueprint-ref <ref>` | no | catalog `default_ref` | Override blueprint ref (branch/tag) |
| `--blueprint-catalog <path>` | no | auto-resolved | Path to `.opencode/blueprints.yaml` |
| `--force-blueprint` | no | `false` | Delete and re-clone blueprint base |
| `--fallback-template <name>` | no | — | Explicit synthetic mode (e.g., `vite-react`) |
| `--no-blueprint` | no | `false` | Disable blueprint; requires `--fallback-template` |
| `--patch-blueprint-app` | no | `false` | Modify App.tsx to wire generated routes |
| `--patch-apollo-client` | no | `false` | Patch Apollo client for static fixtures |
| `--force` | no | `false` | Overwrite generated overlay files only |
| `--force-fixtures` | no | `false` | Overwrite existing fixture JSON files |
| `--help` | no | — | Print usage |

## Blueprint-Based Materialization (Default)

### How It Works

1. **Resolve blueprint** from `.opencode/blueprints.yaml` (default: `frontend/ui-apollo`)
2. **Clone** or copy the blueprint repository into `workspace/frontend-staging/<project-slug>`
3. **Overlay** design-derived artifacts (fixtures, operations, routes, mocks, design references)
4. **Preserve** existing implementation files by default

### What Comes from the Blueprint

All project-shell and tooling files come from the blueprint repository:

- `package.json` — dependencies and scripts
- `tsconfig.json` — TypeScript configuration
- `vite.config.ts` — Vite configuration
- `index.html` — HTML entry point
- `src/main.tsx` — React entry point
- `src/App.tsx` — Application shell

These files are **never synthesized** in blueprint mode.

### What Is Overlaid

Only design-derived files are generated as overlays:

```
src/mocks/graphql/fixtures/<screen-id>.query.json     ← static GraphQL fixtures
src/mocks/graphql/operations/<screen-id>.graphql       ← GraphQL operation stubs
src/mocks/graphql/screenFixtureMap.ts                  ← fixture import map
src/mocks/graphql/mockGraphqlClient.ts                 ← mock GraphQL client helper
src/mocks/graphql/types.ts                             ← shared mock types
src/routes/generatedDesignRoutes.tsx                   ← generated design routes
src/components/DesignScreenShell.tsx                   ← staging screen shell
src/design/design-ir.json                              ← design IR reference
src/design/source-map.json                             ← source map reference
src/design/route-map.json                              ← route map reference
src/design/design-tokens.json                          ← design tokens reference
src/design/frontend-implementation-brief.md            ← implementation brief
.speckit/frontend-stage.json                           ← staging metadata
README.speckit.md                                      ← staging overlay README
```

### Existing Stage Preservation

- If `.speckit/frontend-stage.json` exists, the blueprint base is **not re-cloned**
- Missing overlay files are created; existing overlay files are preserved
- Use `--force` to overwrite overlay files only (never blueprint base files)
- Use `--force-blueprint` to delete and re-materialize the entire stage

## Required Inputs

- `source-map.json` — screen-to-action-path mapping
- `data-mappings.json` — screen data and fixture suggestions

## Generated Output

```
workspace/frontend-staging/<project-slug>/
  (all blueprint files: package.json, vite.config.ts, tsconfig.json, etc.)
  src/
    (blueprint source files preserved)
    mocks/graphql/                      ← overlay
      fixtures/<screen-id>.query.json   ← overlay
      operations/<screen-id>.graphql    ← overlay
      screenFixtureMap.ts                ← overlay
      mockGraphqlClient.ts               ← overlay
      types.ts                           ← overlay
    routes/generatedDesignRoutes.tsx     ← overlay
    components/DesignScreenShell.tsx     ← overlay
    design/                              ← overlay (design references)
  .speckit/frontend-stage.json           ← overlay (metadata)
  README.speckit.md                      ← overlay
```

## Overwrite Policy

- **Blueprint files** are never overwritten by this tool
- **Overlay source files** are preserved by default. Use `--force` to overwrite
- **Fixture JSON files** are preserved by default. Use `--force-fixtures` to overwrite
- `--force` implies `--force-fixtures`
- `--force-blueprint` deletes and re-clones the entire blueprint base, then regenerates all overlays
- Missing overlay files are always created

## Fallback Mode

Synthetic app generation is only available with explicit flags:

```bash
--fallback-template vite-react
--no-blueprint --fallback-template vite-react
```

Fallback mode generates a standalone Vite+React+TypeScript app from scratch. It prints a clear warning and is not recommended for production staging.

## Blueprint Catalog

The tool reads `.opencode/blueprints.yaml` from:
1. `--blueprint-catalog <path>` if provided
2. `/opencode-catalog/.opencode/blueprints.yaml` (Docker mount)
3. `/workspace/.opencode/blueprints.yaml`
4. `.opencode/blueprints.yaml` (CWD)

## Copy to Final Frontend Repo

When the final frontend repo exists, `copy-to` copies the blueprint-derived staging app. The destination receives the same package/tooling shape as the configured frontend blueprint — no drift.

```bash
./bin/oe speckit:frontend-stage <project-slug> copy-to <frontend-repo>
```
