# Speckit Frontend Stage Materializer

Generates a temporary frontend staging app from `spec-kit-open-design` design-context artifacts.

## Purpose

Creates a runnable Vite + React frontend app with static GraphQL fixtures, mock client, and route scaffolding before a real frontend repository exists.

## Ownership

- **opencode-environment** owns this package and its execution via `node-runner`.
- **workspace/frontend-staging/&lt;project-slug&gt;** owns the generated staging app.
- **workspace/design-context/&lt;project-slug&gt;** is the canonical source of truth — never modified by this tool.

## Usage

### Via the oe CLI

```bash
./bin/oe speckit:frontend-stage <project-slug> create
./bin/oe speckit:frontend-stage <project-slug> create --force
./bin/oe speckit:frontend-stage <project-slug> create --force-fixtures
./bin/oe speckit:frontend-stage <project-slug> create --template vite-react
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
| `--template <name>` | no | `vite-react` | Template name |
| `--package-manager <name>` | no | `pnpm` | Package manager |
| `--force` | no | `false` | Overwrite all generated source files |
| `--force-fixtures` | no | `false` | Overwrite existing fixture JSON files |
| `--help` | no | — | Print usage |

## Required Inputs

- `source-map.json` — screen-to-action-path mapping
- `data-mappings.json` — screen data and fixture suggestions

## Generated Output

```
workspace/frontend-staging/<project-slug>/
  package.json
  index.html
  tsconfig.json
  vite.config.ts
  src/
    main.tsx
    App.tsx
    routes/
      generatedRoutes.tsx
    components/
      DesignScreenShell.tsx
    mocks/
      graphql/
        fixtures/
          <screen-id>.query.json
        operations/
          <screen-id>.graphql
        screenFixtureMap.ts
        mockGraphqlClient.ts
        types.ts
    design/
      design-ir.json
      source-map.json
      route-map.json
      design-tokens.json
      frontend-implementation-brief.md
  README.md
```

## Overwrite Policy

- Source files are preserved by default (skipped if they exist). Use `--force` to overwrite.
- Fixture JSON files are preserved by default (skipped if they exist). Use `--force-fixtures` to overwrite.
- `--force` implies `--force-fixtures`.
- Missing files are always created.
