# opencode-environment

A reproducible local development environment for agentic software development with [opencode](https://opencode.ai/).

This repository is not an application template.

It is a Docker Compose-based **agentic development workbench**. It gives you a controlled local environment with dedicated runner containers, shared workspace folders, infrastructure services, and an opencode runtime. Application repositories are created or attached later in the workflow.

## What this gives you

* An isolated opencode runtime
* Docker-based runner containers for backend, frontend, infrastructure, and E2E workflows
* Local infrastructure services for development
* A predictable workspace layout for future application repositories
* A command policy that keeps project tooling out of the host machine

## 5-minute quickstart

### 1. Bootstrap the environment

```bash
curl -fsSL https://raw.githubusercontent.com/reytech-dev/opencode-environment/main/install.sh | bash
```

This downloads the bootstrap script, clones the repository, and sets up your local workbench. Follow the interactive prompts to choose a directory name and version.

To skip prompts, pass the directory and version directly:

```bash
curl -fsSL https://raw.githubusercontent.com/reytech-dev/opencode-environment/main/install.sh | bash -s -- my-workbench --version latest
```

### 2. Run setup

```bash
./bin/oe setup
```

The setup command initializes your local environment.

It should:

* create `.env` from `.env.template`
* generate local tokens where possible
* create required workspace folders
* configure the absolute project path
* configure the Compose project name
* prepare the environment for Docker Compose

Setup does not create application repositories or start Docker services. Backend, frontend, and infrastructure repositories come later.

### 3. Check your machine

```bash
./bin/oe doctor
```

The doctor command validates that the local environment can run.

It should check:

* Docker is installed and reachable
* Docker Compose is available
* required ports are free
* `.env` exists and required variables (HOST_PROJECT_DIR, COMPOSE_PROJECT_NAME) are configured
* workspace folders exist
* runner scripts are executable

Doctor does not start Docker containers and does not require application repositories.

### 4. Start the environment

```bash
./bin/oe start
```

This starts the local development workbench.

The environment includes services such as:

* PostgreSQL
* MinIO
* Mailpit
* Prometheus
* opencode
* backend runner
* frontend runner
* infrastructure runner
* Playwright runner

At this point, no application repositories need to exist yet. You can use the environment to plan the product, define architecture, create repositories, attach existing repositories, or start an agent-driven implementation workflow.

## Install a specific version

By default the bootstrap installs the latest GitHub release. To pin a specific version, use the `--version` flag:

```bash
# Interactive prompt (press Enter for latest tag):
curl -fsSL https://raw.githubusercontent.com/reytech-dev/opencode-environment/main/install.sh | bash

# Direct install of a specific version:
./install.sh my-workbench --version v1.0.0

# Install the latest release:
./install.sh my-workbench --version latest
```

If you already cloned the repository manually, you can also check out a specific tag:

```bash
git fetch --tags
git checkout v1.0.0
./bin/oe setup
./bin/oe doctor
```

## Workspace layout

Application code does not live directly in the root of this repository.

Use the `workspace/` directory as the staging area for application repositories:

```text
workspace/
  backend/             Java backend repositories go here later
  frontend/            Node.js / frontend repositories go here later
  frontend-staging/    Temporary frontend staging apps from design-context artifacts
  infrastructure/      OpenTofu / infrastructure repositories go here later
  design-context/      Open Design processing artifacts before application repositories exist
```

These folders are intentionally empty in the blueprint.

Later in the workflow, repositories may be created or attached like this:

```text
workspace/backend/my-api
workspace/frontend/my-web
workspace/infrastructure/my-infra
```

## Command policy

Do not run project tooling directly on the host machine.

Do not run commands such as these directly from your laptop shell:

```bash
pnpm install
npm test
npx playwright test
./gradlew test
tofu plan
docker compose up
```

Instead, use the environment commands and runner scripts from the project root.

Preferred entrypoint:

```bash
./bin/oe <command>
```

Lower-level script entrypoints:

```bash
./dev/scripts/wrapper.sh <command>
./dev/scripts/exec.sh <command>
```

This keeps tooling versions reproducible and ensures commands run inside the appropriate container.

## Common commands

```bash
./bin/oe setup      # Initialize local configuration
./bin/oe doctor     # Validate the local machine and environment
./bin/oe start      # Start the Docker Compose workbench
./bin/oe cleanup    # Remove bootstrap artifacts
./bin/oe help       # Show help message
```

## Frontend Staging from Open Design

The frontend repository does not need to exist during early design implementation.

The staging app is materialized from the configured frontend blueprint (default: `frontend/ui-apollo`) and overlaid with design-derived artifacts. The staging app is blueprint-compatible with the eventual final frontend repository.

Flow:

1. Generate visual artifacts:
   ```bash
   ./bin/oe speckit:visual <project-slug> all
   ```

2. Process design artifacts:
   ```text
   /speckit.open-design.process --project <project-slug>
   ```

3. Create temporary frontend staging app from blueprint:
   ```bash
   ./bin/oe speckit:frontend-stage <project-slug> create
   ```

4. Start frontend staging app:
   ```bash
   ./bin/oe speckit:frontend-stage <project-slug> install
   ./bin/oe speckit:frontend-stage <project-slug> start
   ```

5. Implement UI against static GraphQL fixtures.

6. Compare against the design screenshots:
   ```bash
   ./bin/oe speckit:visual <project-slug> compare --frontend-url http://node-runner:5173
   ```

7. Copy to final frontend repo later:
   ```bash
   ./bin/oe speckit:frontend-stage <project-slug> copy-to <frontend-repo>
   ```

The staging app uses the same blueprint package, tooling, Apollo, Vite, TypeScript, lint, test, and codegen configuration as the final frontend repository. Generated files are overlays atop the blueprint — core project-shell files come from the blueprint, not from a synthetic generator.

## Working with future repositories

Backend, frontend, and infrastructure repositories are added later.

Until then, the environment can still be used for:

* product planning
* architecture design
* agent workflow validation
* tool verification
* local infrastructure testing
* repository creation planning
* onboarding new developers into the agentic workflow

When repositories exist, commands should target the correct workspace lane.

Example backend command:

```bash
./dev/scripts/wrapper.sh backend:test my-api
```

Example frontend command:

```bash
./dev/scripts/wrapper.sh frontend:build my-web
```

Example infrastructure command:

```bash
./dev/scripts/wrapper.sh infrastructure:plan my-infra
```

## Configuration

Local configuration lives in:

```text
.env
```

Create it from:

```text
.env.template
```

The `.env` file may contain local credentials and must not be committed.

Typical configuration includes:

* PostgreSQL settings
* MinIO settings
* opencode provider keys
* Context7 API key
* GitHub username and token
* Compose project name
* local service ports

## Local services

Default service ports:

| Service       | Default port | Purpose                      |
| ------------- | -----------: | ---------------------------- |
| PostgreSQL    |         5432 | Local database               |
| MinIO API     |         9000 | S3-compatible object storage |
| MinIO Console |         9001 | Object storage UI            |
| Mailpit       |         8025 | Email capture and testing    |
| Prometheus    |         9090 | Metrics                      |

Ports can be changed in `.env`.

## Runner environments

The environment provides dedicated runners for different work types.

| Runner                | Purpose                        |
| --------------------- | ------------------------------ |
| opencode              | Agentic development runtime    |
| backend runner        | Java backend development       |
| frontend runner       | Node.js / frontend development |
| infrastructure runner | OpenTofu infrastructure work   |
| Playwright runner     | End-to-end browser tests       |

Use the matching runner for the work you are doing.

## First successful onboarding

You are successfully onboarded when this works:

```bash
./bin/oe setup
./bin/oe doctor
./bin/oe start
```

After that, the environment is ready for the next stage: creating or attaching application repositories.

## Troubleshooting

### Docker is not reachable

Start Docker Desktop or your local Docker daemon, then run:

```bash
./bin/oe doctor
```

### A port is already in use

Change the conflicting port in `.env`, then restart the environment:

```bash
docker compose down
./bin/oe start
```

### The workspace folders are missing

Run setup again:

```bash
./bin/oe setup
```

### Containers are in a broken state

Reset local runner/container state:

```bash
./bin/oe cleanup
./bin/oe start
```

## Mental model

Think of this repository as the **workbench**, not the product.

The workbench starts first.

Product repositories come later.

Agents then use the workbench to inspect, create, modify, test, and operate those repositories in a reproducible local environment.

## Comand workflow

```bash
curl -fsSL https://raw.githubusercontent.com/reytech-dev/opencode-environment/main/install.sh | bash -s -- Workbench --version latest
cd Workbench
./bin/oe start
export PROJECT=workbench
mkdir -p "workspace/design-context/$PROJECT"
# Copy Open Design / Claude Design export to:
# workspace/design-context/$PROJECT/index.html
./bin/oe speckit:visual "$PROJECT" all
./bin/oe enter -- opencode
/speckit.open-design.process --project workbench
./bin/oe speckit:frontend-stage "$PROJECT" clean
./bin/oe speckit:frontend-stage "$PROJECT" create \
  --patch-blueprint-app \
  --patch-apollo-client
./bin/oe speckit:frontend-stage "$PROJECT" install
./bin/oe speckit:frontend-stage "$PROJECT" build
./bin/oe speckit:frontend-stage "$PROJECT" test
./bin/oe speckit:frontend-stage "$PROJECT" start
./bin/oe enter -- opencode
Implement the static pixel-perfect frontend UI in workspace/frontend-staging/workbench using workspace/design-context/workbench. Use static GraphQL fixtures only. Match the screenshots.
```