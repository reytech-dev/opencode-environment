# AGENTS.md

## Project Overview

`opencode-environment` is a **development environment blueprint** by Reytech. It provides a Docker Compose-based setup that orchestrates 10 containerized services for full-stack development. The `workspace/` directory is a staging area where external application repositories are checked out for agents to work on.

## Workspace Layout

| Directory | Purpose | Tooling |
|---|---|---|
| `workspace/backend/` | Clone Java backend repositories here | Gradle wrapper required (`./gradlew`) — no global Gradle installed |
| `workspace/frontend/` | Clone Node.js/JavaScript frontend repositories here | pnpm 11.5.2 pre-installed |
| `workspace/infrastructure/` | Clone OpenTofu IaC repositories here | OpenTofu CLI pre-installed |
| `workspace/frontend-staging/` | Temporary frontend staging implementations generated from design-context artifacts | Node runner has full workspace access |
| `workspace/design-context/` | Open Design processing artifacts (canonical screenshots, design IR, visual regression) | Playwright runner has full workspace access |

These directories are mounted into their respective Docker runner containers at `/workspace`. Any changes made inside a runner container are reflected directly on the host filesystem.

## Golden Rules

Before making any changes to project code, follow these rules to avoid wasting test cycles on known, preventable issues.

### Rule 0: Never rewrite blueprint build files — extend incrementally

The cloned blueprint's `build.gradle.kts`, `package.json`, etc. are verified working baselines. Change only `group` and `rootProject.name` first, add dependencies one at a time, and compile after each change. Never change the Java toolchain version without first verifying the runner's JDK version:

```bash
./dev/scripts/wrapper.sh backend:version
# Ensure build.gradle.kts languageVersion matches the runner (currently JDK 25)
```

### Rule 1: Files under `workspace/` must be verified on the container-visible path

The `Write` tool writes to the opencode container's filesystem, not the Docker volume mount visible to runner containers. Any file created under `workspace/` must be verifiable from the container-visible path:

```bash
ls -la workspace/backend/$PROJECT/src/main/java/com/example/MyFile.java
```

Prefer heredocs for `workspace/` source files. Reserve the `Write` tool for files outside workspace mounts (`specs/`, `docs/`, root configuration).

### Rule 2: Verify the baseline compiles BEFORE adding any project code

```bash
./dev/scripts/exec.sh backend:exec $PROJECT -- ./gradlew compileJava
./dev/scripts/exec.sh frontend:exec $PROJECT -- pnpm build
```

If the baseline doesn't compile with zero changes, the blueprint or environment is broken — debug that first.

### Rule 3: Execute the blueprint's own initialization checklist

Every blueprint includes an `AGENTS.md` with a `## Blueprint Initialization` checklist. Execute it mechanically before writing any project code:

```bash
cat workspace/backend/$PROJECT/AGENTS.md    # Find "## Blueprint Initialization"
cat workspace/frontend/$PROJECT/AGENTS.md   # Same section in frontend blueprints
```

For Spring GraphQL blueprints, remove the boilerplate schema immediately after cloning:

```bash
rm -f workspace/backend/$PROJECT/src/main/resources/graphql/*.graphqls
find workspace/backend/$PROJECT/src/main/resources/graphql -name '*.graphql*'
# Expected: exactly one file — your project schema
```

### Rule 4: Keep `application.yml` defaults aligned with infrastructure services

Blueprint defaults (`host: postgres`, `username: backend`, `password: backend`) are designed to work with the Docker Compose infrastructure services. Keep them as-is. Override through environment variables when necessary — never change defaults to project-specific names like `postgresql`.

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

#### Speckit Visual Processing

| Command | Action |
|---|---|
| `./bin/oe speckit:visual <slug> capture` | Capture canonical Open Design screenshots (no frontend repo required) |
| `./bin/oe speckit:visual <slug> compare <repo>` | Compare frontend implementation against canonical screenshots |
| `./bin/oe speckit:visual <slug> update` | Update visual snapshots/reference artifacts |
| `./bin/oe speckit:visual <slug> all <repo>` | Run capture then compare |

#### Stack Management

| Command | Action |
|---|---|
| `./dev/scripts/wrapper.sh stack:logs` | All service logs |
| `./dev/scripts/wrapper.sh stack:logs:database` | PostgreSQL logs |
| `./dev/scripts/wrapper.sh stack:logs:filestore` | MinIO logs |
| `./dev/scripts/wrapper.sh stack:logs:metrics` | Prometheus logs |
| `./dev/scripts/wrapper.sh stack:logs:mailer` | Mailpit logs |
| `./dev/scripts/wrapper.sh stack:reset` | Force-remove all runner containers (clean up orphans from failed commands) |

#### Database

| Command | Action |
|---|---|
| `./dev/scripts/wrapper.sh database:psql` | Open interactive psql session against the postgres service |
| `./dev/scripts/wrapper.sh database:psql "SELECT ..."` | Execute a single SQL query and print results |

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

### Speckit Visual Processing

Capture canonical screenshots before a frontend repository exists:

```bash
./bin/oe speckit:visual my-project capture
```

After the frontend implementation exists, compare against the canonical artifacts:

```bash
./bin/oe speckit:visual my-project compare my-web
```

Or run the full pipeline:

```bash
./bin/oe speckit:visual my-project all my-web
```

Visual regression packages are stored in `workspace/design-context/<project-slug>/visual-regression/`.

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

## Known Pitfalls by Stack

### Java / Spring Boot 4.x

**Toolchain version.** `build.gradle.kts` must match the Docker image's JDK. Set `languageVersion = JavaLanguageVersion.of(25)` or remove the toolchain block entirely and rely on `sourceCompatibility` / `targetCompatibility`. The runner uses `eclipse-temurin:25-jdk`. Verify with `./dev/scripts/wrapper.sh backend:version`.

**Test API.** Spring Boot 4.x removed `@AutoConfigureGraphQlTester` and `@AutoConfigureWebTestClient`. The confirmed working test pattern:

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class MyControllerTest {

    @LocalServerPort
    private int port;

    private WebTestClient client;

    @BeforeEach
    void setup() {
        client = WebTestClient.bindToServer()
                .baseUrl("http://localhost:" + port)
                .build();
    }

    @Test
    void test() {
        byte[] body = client.post().uri("/graphql")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(query)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .returnResult()
                .getResponseBody();
        String response = new String(body);
        assertTrue(response.contains("expected value"));
    }
}
```

No `@AutoConfigureGraphQlTester` — use raw HTTP via `WebTestClient.bindToServer()` + `@LocalServerPort`. Prefer raw body assertions over `.jsonPath(...)`.

**Test properties.** `@Value`-annotated constructor parameters fail hard if properties cannot be resolved — Spring may not evaluate `${VAR:default}` in test contexts the same way. Use one of:

- **Option A**: Create `src/test/resources/application-test.yml` with explicit values and annotate tests with `@ActiveProfiles("test")`.
- **Option B**: Set every required property in `@DynamicPropertySource`:

```java
@DynamicPropertySource
static void props(DynamicPropertyRegistry r) {
    r.add("jwt.secret", () -> "test-secret-key-for-jwt-that-is-long-enough-12345");
    r.add("minio.endpoint", () -> "http://localhost:9000");
    r.add("minio.access-key", () -> "test");
    r.add("minio.secret-key", () -> "test");
    r.add("minio.bucket", () -> "test-bucket");
}
```

### Spring GraphQL

**Schema conflicts.** Spring GraphQL loads all `*.graphqls` files under `classpath:graphql/**/`. A cloned blueprint's boilerplate schema defining its own `Mutation` type will conflict with your project schema. Delete it immediately:

```bash
rm -f workspace/backend/$PROJECT/src/main/resources/graphql/*.graphqls
find workspace/backend/$PROJECT/src/main/resources/graphql -name '*.graphql*'
# Expected: exactly one file — your project schema
```

**Custom scalars.** `graphql-java` requires a `graphql.schema.Coercing<?,?>` bean for every custom scalar. Without them, the context refuses to start. For MVP, replace custom scalars with standard types:

```bash
sed -i '/^scalar DateTime$/d; /^scalar JSON$/d; /^scalar PositiveInt$/d' \
  workspace/backend/$PROJECT/src/main/resources/graphql/schema.graphqls
sed -i 's/: DateTime!/: String!/g; s/: DateTime/: String/g' \
  workspace/backend/$PROJECT/src/main/resources/graphql/schema.graphqls
```

For production, register a `RuntimeWiringConfigurer` bean with `ExtendedScalars.DateTime`, etc.

### React / esbuild

**JSX arrow function closures.** esbuild's JSX parser rejects `}}>` patterns (double-brace closures in inline arrow function attributes):

```tsx
// Avoid — double-brace closure
<button onClick={() => { setRole(r.id); setMode('signup'); }}>

// Preferred — function expression
<button onClick={function() { setRole(r.id); setMode('signup'); }}>

// Preferred — extract handler
const handleSelect = () => { setRole(r.id); setMode('signup'); };
<button onClick={handleSelect}>
```

Check for this pattern before building:

```bash
grep -rn '}}>' workspace/frontend/$PROJECT/src/
```

## Runner Environments

### Java Runner (`java-runner`)
- Eclipse Temurin JDK 25
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
- Used for E2E tests against the frontend and speckit visual regression (canonical screenshot capture and comparison)
- Full workspace mounted at `/workspace`
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

## Pre-Implementation Checklist

Before running tests after any blueprint clone or project scaffold, verify:

- [ ] Blueprint initialization checklist executed: follow the `## Blueprint Initialization` steps mechanically
- [ ] Baseline compiles: `./dev/scripts/exec.sh backend:exec $PROJECT -- ./gradlew compileJava` returns `BUILD SUCCESSFUL`
- [ ] Build file modifications are incremental (not a full rewrite); `group` and `rootProject.name` changed first, dependencies added one at a time
- [ ] Java toolchain version in `build.gradle.kts` matches `./dev/scripts/wrapper.sh backend:version` output
- [ ] All source files exist on the container-visible path (`ls workspace/backend/$PROJECT/src/main/java/...`)
- [ ] Blueprint schema file removed (only project schema remains): `find workspace/backend/$PROJECT/src/main/resources/graphql -name '*.graphql*'`
- [ ] Custom GraphQL scalars either have coercion beans OR are replaced with standard types
- [ ] Test classes use `WebTestClient.bindToServer()` + `@LocalServerPort`, not autowired WebTestClient
- [ ] No `}}>` patterns in `.tsx` files (`grep -rn '}}>' workspace/frontend/$PROJECT/src/`)
- [ ] Test properties either in `application-test.yml` OR every `@Value`-dependent property set in `@DynamicPropertySource`
- [ ] `application.yml` defaults match `docker-compose.yaml`: host=`postgres`, DB/user/password=`backend`

## File Exclusions

- `.env` is in `.gitignore` — never commit secrets or credentials
- `workspace/` subdirectories are intentionally empty in this blueprint; application code lives in external repositories
