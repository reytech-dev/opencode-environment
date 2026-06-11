#!/usr/bin/env bash
set -euo pipefail

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
    run_cmd node-runner "${2:-}" pnpm install
    ;;

  frontend:test)
    run_cmd node-runner "${2:-}" pnpm test
    ;;

  frontend:build)
    run_cmd node-runner "${2:-}" pnpm build
    ;;

  frontend:start)
    subdir="${2:-}"
    if [ -n "$subdir" ]; then
        nohup docker compose run --rm --service-ports --use-aliases -w "/workspace/$subdir" node-runner pnpm dev > /tmp/frontend.log 2>&1 &
    else
        nohup docker compose run --rm --service-ports --use-aliases node-runner pnpm dev > /tmp/frontend.log 2>&1 &
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
        docker compose run --rm --use-aliases -w "/workspace/$subdir" playwright-runner npm run e2e
    else
        docker compose run --rm --use-aliases playwright-runner npm run e2e
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

  stack:reset)
    echo "Stopping and removing all project runner containers..."
    docker ps -a --format '{{.ID}} {{.Image}} {{.Names}}' | grep ' workspace-.*-runner' | awk '{print $1}' | sort -u | xargs -r docker rm -f
    echo "Done."
    ;;

  *)
    echo "Usage: $0 {backend:test|backend:run|backend:start|backend:stop|frontend:install|frontend:test|frontend:build|frontend:start|frontend:stop|frontend:e2e|infrastructure:validate|infrastructure:apply|backend:version|infrastructure:version|infrastructure:plan|stack:logs|stack:logs:database|stack:logs:filestore|stack:logs:metrics|stack:logs:mailer|stack:reset} [subdir]"
    exit 1
    ;;
esac