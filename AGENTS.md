# AGENTS.md

## Project Overview

`opencode-environment` is a **development environment blueprint** by Reytech. It provides a Docker Compose-based setup that orchestrates 10 containerized services for full-stack development. The `workspace/` directory is a staging area where external application repositories are checked out for agents to work on.

## Workspace Layout

| Directory | Purpose | Tooling |
|---|---|---|
| `workspace/backend/` | Clone Java backend repositories here | Gradle wrapper required (`./gradlew`) — no global Gradle installed |
| `workspace/frontend/` | Clone Node.js/JavaScript frontend repositories here | pnpm 11.5.2 pre-installed |
| `workspace/infrastructure/` | Clone OpenTofu IaC repositories here | OpenTofu CLI pre-installed |

These directories are mounted into their respective Docker runner containers at `/workspace`. Any changes made inside a runner container are reflected directly on the host filesystem.

## Command Policy

### Environment management

Use `./bin/oe` from the project root to control the workbench lifecycle:

```bash
./bin/oe <command>
```

### Agent tooling

**All project tooling commands must run inside the appropriate Docker runner container.** Do NOT invoke `pnpm`, `npm`, `node`, `npx`, `gradlew`, `tofu`, or similar project tooling binaries directly on the host or opencode container. Always route through the project scripts executed from the project root:

- **`./dev/scripts/wrapper.sh <command>`** — Preferred. Use for named, predefined operations (test, build, run, etc.).
- **`./dev/scripts/exec.sh <command>`** — Fallback. Use when the wrapper doesn't cover the needed operation. Also provides shell access and compose diagnostics.

**Never run raw `docker compose` commands directly.**

Both scripts are executed from the **project root** (`/workspace` inside the opencode container, or the repository root on the host).

## Environment Management

`./bin/oe` manages the workbench lifecycle from the project root:

| Command | Action |
|---|---|
| `./bin/oe setup` | Initialize `.env` from template, create workspace dirs, configure required variables, generate tokens |
| `./bin/oe doctor` | Validate Docker daemon, Docker Compose, port availability, `.env` configuration, scripts, and Compose config |
| `./bin/oe start` | Start the workbench (preflight → port check → `docker compose up -d` → service readiness checks → URLs) |
| `./bin/oe cleanup` | Remove bootstrap artifacts from the workbench |
| `./bin/oe help` | Show help message |

## Commands Reference

All commands are run from the project root.

Each wrapper command accepts an optional second argument — a subdirectory within the workspace mount (e.g., a specific project folder under `workspace/backend/`). When provided, the command executes with that subdirectory as the container's working directory. When omitted, the command runs at the root of the mount (backward-compatible).

```bash
# Target a specific sub-project
./dev/scripts/wrapper.sh backend:test my-app
./dev/scripts/wrapper.sh frontend:build web-client
./dev/scripts/wrapper.sh infrastructure:plan staging

# Falls back to the mount root (existing behavior)
./dev/scripts/wrapper.sh backend:test
```

### Wrapper Script (`./dev/scripts/wrapper.sh`)

#### Backend (Java)

| Command | Action |
|---|---|
| `./dev/scripts/wrapper.sh backend:version` | Print Java version |
| `./dev/scripts/wrapper.sh backend:test` | Run `./gradlew test` |
| `./dev/scripts/wrapper.sh backend:run` | Run `./gradlew bootRun` with service ports exposed |
| `./dev/scripts/wrapper.sh backend:start` | Start backend in background (ensures PostgreSQL is healthy first). PID → `/tmp/backend.pid`, logs → `/tmp/backend.log` |
| `./dev/scripts/wrapper.sh backend:stop` | Stop the background backend process |

#### Frontend (Node.js)

| Command | Action |
|---|---|
| `./dev/scripts/wrapper.sh frontend:version` | Print pnpm version |
| `./dev/scripts/wrapper.sh frontend:install` | Run `pnpm install` |
| `./dev/scripts/wrapper.sh frontend:test` | Run `pnpm test` |
| `./dev/scripts/wrapper.sh frontend:build` | Run `pnpm build` |
| `./dev/scripts/wrapper.sh frontend:start` | Start frontend dev server in background (`pnpm dev`). PID → `/tmp/frontend.pid`, logs → `/tmp/frontend.log` |
| `./dev/scripts/wrapper.sh frontend:stop` | Stop the background frontend process |
| `./dev/scripts/wrapper.sh frontend:e2e` | Run `npx playwright test` in the Playwright runner |

#### Infrastructure (OpenTofu)

| Command | Action |
|---|---|
| `./dev/scripts/wrapper.sh infrastructure:version` | Print OpenTofu version |
| `./dev/scripts/wrapper.sh infrastructure:plan` | Run `tofu plan` |
| `./dev/scripts/wrapper.sh infrastructure:validate` | Run `tofu validate` |
| `./dev/scripts/wrapper.sh infrastructure:apply` | Run `tofu apply` |

#### Stack Management

| Command | Action |
|---|---|
| `./dev/scripts/wrapper.sh stack:logs` | All service logs |
| `./dev/scripts/wrapper.sh stack:logs:database` | PostgreSQL logs |
| `./dev/scripts/wrapper.sh stack:logs:filestore` | MinIO logs |
| `./dev/scripts/wrapper.sh stack:logs:metrics` | Prometheus logs |
| `./dev/scripts/wrapper.sh stack:logs:mailer` | Mailpit logs |
| `./dev/scripts/wrapper.sh stack:reset` | Force-remove all runner containers (clean up orphans from failed commands) |

## Workflows

### E2E Testing

Requires the backend and frontend running. Run these commands in order:

```bash
./dev/scripts/wrapper.sh backend:start my-app        # 1. Start backend in background
./dev/scripts/wrapper.sh frontend:start web-client   # 2. Start frontend in background
./dev/scripts/wrapper.sh frontend:e2e web-client     # 3. Run Playwright tests
```

Clean up after:

```bash
./dev/scripts/wrapper.sh frontend:stop
./dev/scripts/wrapper.sh backend:stop
```

Backend and frontend logs are written to `/tmp/backend.log` and `/tmp/frontend.log` respectively.

### Escape-Hatch Script (`./dev/scripts/exec.sh`)

#### Arbitrary Commands

Use `--` to separate the runner name from the command. An optional subdirectory can be placed before the `--`:

```bash
# Target a specific sub-project
./dev/scripts/exec.sh backend:exec my-app -- ./gradlew test --tests '*RouteServiceTest'
./dev/scripts/exec.sh frontend:exec web-client -- pnpm add -D vitest

# Fall back to the mount root (existing behavior)
./dev/scripts/exec.sh backend:exec -- ./gradlew dependencies
./dev/scripts/exec.sh frontend:exec -- pnpm why react
./dev/scripts/exec.sh playwright:exec -- npx playwright test --debug
```

#### Shell Access

An optional subdirectory can be passed to open a shell in a specific project:

```bash
./dev/scripts/exec.sh backend:shell my-app
./dev/scripts/exec.sh frontend:shell web-client
./dev/scripts/exec.sh playwright:shell
```

#### Compose Diagnostics

| Command | Action |
|---|---|
| `./dev/scripts/exec.sh compose:ps` | List running services |
| `./dev/scripts/exec.sh compose:logs` | View all service logs |
| `./dev/scripts/exec.sh compose:config` | Print resolved compose configuration |

## Runner Environments

### Java Runner (`java-runner`)
- Eclipse Temurin JDK 21
- Git, Curl, Docker CLI (for Testcontainers)
- **No global Gradle or Maven** — repositories must include a Gradle wrapper (`gradlew`)
- `~/.gradle` and `~/.m2` directories are persisted in Docker volumes
- Environment: `SPRING_PROFILES_ACTIVE=local`, Testcontainers host override configured

### Node Runner (`node-runner`)
- Node.js 22 (Bookworm)
- pnpm 11.5.2
- pnpm store persisted in Docker volume

### OpenTofu Runner (`opentofu-runner`)
- OpenTofu CLI (Alpine 3.20)
- Git, Curl

### Playwright Runner (`playwright-runner`)
- Microsoft Playwright image
- Used for E2E tests against the frontend
- Environment: `FRONTEND_URL=http://node-runner:5173`, `CI=true`

### Opencode Runner (`opencode`)
- Node.js 22 + Docker CLI + Docker Compose plugin
- opencode-ai CLI 1.16.2
- Configured with Context7 MCP and DeepSeek provider
- Has access to `/var/run/docker.sock` for spawning sibling containers

## Configuration

| File | Purpose |
|---|---|
| `.env` | All configurable values (API keys, ports, credentials, versions). **Excluded from git.** |
| `.env.template` | Template for `.env` with placeholder values; committed to git |
| `docker-compose.yaml` | Service definitions, volume mounts, environment variables with `${VAR:-default}` interpolation |
| `dev/runners/opencode/opencode.json` | Opencode AI configuration (Context7 MCP remote, DeepSeek provider) |

## Infrastructure Services

| Service | Port(s) | Notes |
|---|---|---|
| PostgreSQL 18 | `5432` (configurable via `POSTGRES_PORT`) | Credentials in `.env`; healthcheck enabled |
| MinIO (S3-compatible) | `9000` (API), `9001` (console) | Console port configurable via `MINIO_CONSOLE_PORT`; healthcheck enabled |
| Mailpit (SMTP capture) | `1025` (SMTP), `8025` (web UI, configurable via `MAILPIT_HTTP_PORT`) | Catches all outbound email; web UI available |
| Prometheus | `9090` (configurable via `PROMETHEUS_PORT`) | Scrapes backend `/actuator/prometheus` |
| Open Design | `7456` (configurable via `OPEN_DESIGN_PORT`) | Design/review tool; uses host network mode |

## File Exclusions

- `.env` is in `.gitignore` — never commit secrets or credentials
- `workspace/` subdirectories are intentionally empty in this blueprint; application code lives in external repositories
