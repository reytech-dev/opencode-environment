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
    run_cmd_ports java-runner "${2:-}" ./gradlew bootRun
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

  frontend:e2e)
    run_cmd playwright-runner "${2:-}" npx playwright test
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

  *)
    echo "Usage: $0 {backend:test|backend:run|frontend:install|frontend:test|frontend:build|frontend:e2e|infrastructure:validate|infrastructure:apply|backend:version|infrastructure:version|infrastructure:plan|stack:logs|stack:logs:database|stack:logs:filestore|stack:logs:metrics|stack:logs:mailer} [subdir]"
    exit 1
    ;;
esac