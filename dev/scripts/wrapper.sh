#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  backend:version)
    docker compose run --rm java-runner java -version
    ;;

  backend:test)
    docker compose run --rm java-runner ./gradlew test
    ;;

  backend:run)
    docker compose run --rm --service-ports java-runner ./gradlew bootRun
    ;;

  frontend:version)
    docker compose run --rm node-runner pnpm --version
    ;;

  frontend:install)
    docker compose run --rm node-runner pnpm install
    ;;

  frontend:test)
    docker compose run --rm node-runner pnpm test
    ;;

  frontend:build)
    docker compose run --rm node-runner pnpm build
    ;;

  frontend:e2e)
    docker compose run --rm playwright-runner npm exec playwright test
    ;;

  infrastructure:version)
    docker compose run --rm opentofu-runner tofu version
    ;;

  infrastructure:plan)
    docker compose run --rm opentofu-runner tofu plan
    ;;

  infrastructure:validate)
    docker compose run --rm opentofu-runner tofu validate
    ;;

  infrastructure:apply)
    docker compose run --rm opentofu-runner tofu apply
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
    echo "Usage: $0 {backend:test|backend:run|frontend:install|frontend:test|frontend:build|frontend:e2e|infrastructure:validate|infrastructure:apply|backend:version|infrastructure:version|infrastructure:plan|stack:logs|stack:logs:database|stack:logs:filestore|stack:logs:metrics|stack:logs:mailer}"
    exit 1
    ;;
esac