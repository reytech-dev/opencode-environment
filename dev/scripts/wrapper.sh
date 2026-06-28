#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

run_cmd() {
    local runner="$1"
    local subdir="${2:-}"
    shift 2
    if [ -n "$subdir" ]; then
        docker compose run --rm -w "/workspace/$subdir" "$runner" "$@"
    else
        docker compose run --rm "$runner" "$@"
    fi
}

run_cmd_ports() {
    local runner="$1"
    local subdir="${2:-}"
    shift 2
    if [ -n "$subdir" ]; then
        docker compose run --rm --service-ports -w "/workspace/$subdir" "$runner" "$@"
    else
        docker compose run --rm --service-ports "$runner" "$@"
    fi
}

case "${1:-}" in
  backend:version)
    docker compose run --rm java-runner java -version
    ;;

  backend:test)
    run_cmd java-runner "${2:-}" ./gradlew test
    ;;

  backend:run)
    subdir="${2:-}"
    if [ -n "$subdir" ]; then
        docker compose run --rm --service-ports --use-aliases -w "/workspace/$subdir" java-runner ./gradlew bootRun
    else
        docker compose run --rm --service-ports --use-aliases java-runner ./gradlew bootRun
    fi
    ;;

  backend:start)
    subdir="${2:-}"
    docker compose up -d postgres
    echo "Waiting for postgres to be healthy..."
    until docker compose ps postgres | grep -q "healthy"; do sleep 1; done
    echo "Postgres is healthy. Starting backend..."
    if [ -n "$subdir" ]; then
        nohup docker compose run --rm --service-ports --use-aliases -w "/workspace/$subdir" java-runner ./gradlew bootRun --no-daemon > /tmp/backend.log 2>&1 &
    else
        nohup docker compose run --rm --service-ports --use-aliases java-runner ./gradlew bootRun --no-daemon > /tmp/backend.log 2>&1 &
    fi
    PID=$!
    disown $PID
    echo $PID > /tmp/backend.pid
    echo "Backend started (PID: $PID, logs: /tmp/backend.log)"
    ;;

  backend:stop)
    CONTAINERS=$(docker ps -q -f "name=workspace-java-runner" -f "status=running" 2>/dev/null)
    if [ -n "$CONTAINERS" ]; then
        echo "$CONTAINERS" | xargs -r docker stop
        echo "Backend stopped."
    else
        echo "Backend container not found. Is the backend running?" >&2
        exit 1
    fi
    rm -f /tmp/backend.pid
    ;;

  frontend:version)
    docker compose run --rm node-runner pnpm --version
    ;;

  frontend:install)
    subdir="${2:-}"
    if [ -n "$subdir" ]; then
      docker compose run --rm -w "/workspace/frontend/$subdir" node-runner pnpm install
    else
      docker compose run --rm -w "/workspace/frontend" node-runner pnpm install
    fi
    ;;

  frontend:test)
    subdir="${2:-}"
    if [ -n "$subdir" ]; then
      docker compose run --rm -w "/workspace/frontend/$subdir" node-runner pnpm test
    else
      docker compose run --rm -w "/workspace/frontend" node-runner pnpm test
    fi
    ;;

  frontend:build)
    subdir="${2:-}"
    if [ -n "$subdir" ]; then
      docker compose run --rm -w "/workspace/frontend/$subdir" node-runner pnpm build
    else
      docker compose run --rm -w "/workspace/frontend" node-runner pnpm build
    fi
    ;;

  frontend:start)
    subdir="${2:-}"
    if [ -n "$subdir" ]; then
        nohup docker compose run --rm --service-ports --use-aliases -w "/workspace/frontend/$subdir" node-runner pnpm dev > /tmp/frontend.log 2>&1 &
    else
        nohup docker compose run --rm --service-ports --use-aliases -w "/workspace/frontend" node-runner pnpm dev > /tmp/frontend.log 2>&1 &
    fi
    PID=$!
    disown $PID
    echo $PID > /tmp/frontend.pid
    echo "Frontend started (PID: $PID, logs: /tmp/frontend.log)"
    ;;

  frontend:stop)
    CONTAINERS=$(docker ps -q -f "name=workspace-node-runner" -f "status=running" 2>/dev/null)
    if [ -n "$CONTAINERS" ]; then
        echo "$CONTAINERS" | xargs -r docker stop
        echo "Frontend stopped."
    else
        echo "Frontend container not found. Is the frontend running?" >&2
        exit 1
    fi
    rm -f /tmp/frontend.pid
    ;;

  frontend:e2e)
    subdir="${2:-}"
    if [ -n "$subdir" ]; then
        docker compose run --rm --use-aliases -w "/workspace/frontend/$subdir" playwright-runner npm run e2e
    else
        docker compose run --rm --use-aliases -w "/workspace/frontend" playwright-runner npm run e2e
    fi
    ;;

  infrastructure:version)
    docker compose run --rm opentofu-runner tofu version
    ;;

  infrastructure:plan)
    run_cmd opentofu-runner "${2:-}" tofu plan
    ;;

  infrastructure:validate)
    run_cmd opentofu-runner "${2:-}" tofu validate
    ;;

  infrastructure:apply)
    run_cmd opentofu-runner "${2:-}" tofu apply
    ;;

  stack:logs)
    docker compose logs
    ;;

  stack:logs:database)
    docker compose logs postgres
    ;;

  stack:logs:filestore)
    docker compose logs minio
    ;;

  stack:logs:metrics)
    docker compose logs prometheus
    ;;

  stack:logs:mailer)
    docker compose logs mailpit
    ;;

  database:psql)
    if [ -n "${2:-}" ]; then
      docker compose exec postgres psql -U "${POSTGRES_USER:-backend}" -d "${POSTGRES_DB:-backend}" -c "$2"
    else
      docker compose exec -it postgres psql -U "${POSTGRES_USER:-backend}" -d "${POSTGRES_DB:-backend}"
    fi
    ;;

  stack:reset)
    echo "Stopping and removing all project runner containers..."
    docker ps -a --format '{{.ID}} {{.Image}} {{.Names}}' | grep ' workspace-.*-runner' | awk '{print $1}' | sort -u | xargs -r docker rm -f
    echo "Done."
    ;;

  speckit:visual)
    project="${2:-}"
    if [ -z "$project" ]; then
      echo "Usage: $0 speckit:visual <project-slug> <discover|capture|compare|all> [extra-args]" >&2
      exit 1
    fi
    shift 2

    canonical_url="http://design-preview:80/design-context/$project/index.html"
    output_root="/workspace/design-context/$project"
    host_design_dir="$REPO_ROOT/workspace/design-context/$project"

    mkdir -p "$host_design_dir/visual-regression/fixtures" \
             "$host_design_dir/visual-regression/screenshots" \
             "$host_design_dir/visual-regression/test-results" \
             "$host_design_dir/design-processing"
    chmod -R 777 "$host_design_dir/visual-regression" "$host_design_dir/design-processing" 2>/dev/null || true

    docker compose up -d design-preview

    docker compose run --rm --use-aliases \
      -e SPECKIT_PROJECT="$project" \
      -e DESIGN_PREVIEW_URL="$canonical_url" \
      -e SPECKIT_VISUAL_OUTPUT_ROOT="$output_root" \
      playwright-runner \
      bash -lc "cp -r /tools/speckit-visual /tmp/crawler && cd /tmp/crawler && npm install && node prototype-map-crawler.mjs $* \
        --project '$project' \
        --canonical-url '$canonical_url' \
        --output-root '$output_root'"
    ;;

  speckit:frontend-stage)
    project="${2:-}"
    action="${3:-create}"

    if [ -z "$project" ]; then
      echo "Usage: $0 speckit:frontend-stage <project-slug> <create|install|start|build|test|copy-to|clean> [args]" >&2
      exit 1
    fi

    shift 3

    design_root="/workspace/design-context/$project"
    stage_root="/workspace/frontend-staging/$project"

    case "$action" in
      create)
        catalog_arg=""
        if ! echo "$*" | grep -q -- '--blueprint-catalog'; then
          catalog_arg="--blueprint-catalog /opencode-catalog/.opencode/blueprints.yaml"
        fi
        docker compose run --rm --use-aliases \
          -w /tools/speckit-frontend-stage \
          node-runner \
          bash -lc "npm install && node materialize-frontend-stage.mjs \
            --project '$project' \
            --design-root '$design_root' \
            --stage-root '$stage_root' \
            $catalog_arg \
            $*"
        ;;

      install)
        docker compose run --rm --use-aliases \
          -w "$stage_root" \
          node-runner \
          pnpm install
        ;;

      start)
        docker compose run --rm --service-ports --use-aliases \
          -w "$stage_root" \
          node-runner \
          pnpm dev --host 0.0.0.0
        ;;

      build)
        docker compose run --rm --use-aliases \
          -w "$stage_root" \
          node-runner \
          pnpm build
        ;;

      test)
        docker compose run --rm --use-aliases \
          -w "$stage_root" \
          node-runner \
          pnpm test
        ;;

      clean)
        rm -rf "$REPO_ROOT/workspace/frontend-staging/$project"
        echo "Cleaned workspace/frontend-staging/$project"
        ;;

      copy-to)
        frontend_repo="${1:-}"
        if [ -z "$frontend_repo" ]; then
          echo "Usage: $0 speckit:frontend-stage <project-slug> copy-to <frontend-repo>" >&2
          exit 1
        fi

        src="$REPO_ROOT/workspace/frontend-staging/$project"
        dest="$REPO_ROOT/workspace/frontend/$frontend_repo"

        if [ ! -d "$src" ]; then
          echo "Frontend staging directory not found: $src" >&2
          exit 1
        fi

        mkdir -p "$dest"
        if command -v rsync >/dev/null 2>&1; then
          rsync -a --exclude node_modules --exclude dist --exclude .git "$src"/ "$dest"/
        else
          cp -R "$src"/* "$dest"/ 2>/dev/null || true
        fi
        echo "Copied frontend staging project to $dest"
        ;;

      *)
        echo "Unknown speckit:frontend-stage action: $action" >&2
        exit 1
        ;;
    esac
    ;;

  *)
    echo "Usage: $0 {backend:test|backend:run|backend:start|backend:stop|frontend:install|frontend:test|frontend:build|frontend:start|frontend:stop|frontend:e2e|infrastructure:validate|infrastructure:apply|backend:version|infrastructure:version|infrastructure:plan|database:psql|stack:logs|stack:logs:database|stack:logs:filestore|stack:logs:metrics|stack:logs:mailer|stack:reset|speckit:visual|speckit:frontend-stage} [subdir|query]"
    exit 1
    ;;
esac