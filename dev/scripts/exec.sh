#!/usr/bin/env bash
set -euo pipefail

# --------------------------------------------------------------------
# dev - Docker Compose development wrapper
#
# Escape-hatch commands:
#
#   ./exec.sh backend:exec -- <command>
#   ./exec.sh frontend:exec -- <command>
#   ./exec.sh playwright:exec -- <command>
#
#   ./exec.sh backend:shell
#   ./exec.sh frontend:shell
#   ./exec.sh playwright:shell
#
# Examples:
#
#   ./exec.sh backend:exec -- ./gradlew dependencies
#   ./exec.sh backend:exec -- ./gradlew test --tests '*RouteServiceTest'
#   ./exec.sh frontend:exec -- pnpm why react
#   ./exec.sh frontend:exec -- pnpm add -D vitest
#   ./exec.sh playwright:exec -- pnpm exec playwright test --debug
# --------------------------------------------------------------------

COMPOSE="${COMPOSE:-docker compose}"

BACKEND_SERVICE="${BACKEND_SERVICE:-java-runner}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-node-runner}"
PLAYWRIGHT_SERVICE="${PLAYWRIGHT_SERVICE:-playwright-runner}"

WORKDIR="${WORKDIR:-/workspace}"

usage() {
  cat <<EOF
Usage:
  ./exec.sh <command>

Escape hatches:
  ./exec.sh backend:exec -- <command>
  ./exec.sh frontend:exec -- <command>
  ./exec.sh playwright:exec -- <command>

Shells:
  ./exec.sh backend:shell
  ./exec.sh frontend:shell
  ./exec.sh playwright:shell

Diagnostics:
  ./exec.sh compose:ps
  ./exec.sh compose:logs
  ./exec.sh compose:config

Examples:
  ./exec.sh backend:exec -- ./gradlew test
  ./exec.sh backend:exec -- ./gradlew dependencies
  ./exec.sh frontend:exec -- pnpm install
  ./exec.sh frontend:exec -- pnpm build
  ./exec.sh playwright:exec -- pnpm exec playwright test
EOF
}

require_command_after_double_dash() {
  local command_name="$1"
  shift || true

  if [[ "${1:-}" != "--" ]]; then
    echo "Error: ${command_name} requires '--' before the command." >&2
    echo >&2
    echo "Example:" >&2
    echo "  ./exec.sh ${command_name} -- <command>" >&2
    exit 2
  fi

  shift || true

  if [[ "$#" -eq 0 ]]; then
    echo "Error: ${command_name} requires a command after '--'." >&2
    exit 2
  fi

  "$@"
}

compose_run() {
  local service="$1"
  shift

  ${COMPOSE} run \
    --rm \
    --workdir "${WORKDIR}" \
    "${service}" \
    "$@"
}

compose_shell() {
  local service="$1"

  ${COMPOSE} run \
    --rm \
    --workdir "${WORKDIR}" \
    "${service}" \
    sh
}

main() {
  local command="${1:-help}"
  shift || true

  case "${command}" in
    help|-h|--help)
      usage
      ;;

    backend:exec)
      require_command_after_double_dash "${command}" "$@" compose_run "${BACKEND_SERVICE}"
      ;;

    frontend:exec)
      require_command_after_double_dash "${command}" "$@" compose_run "${FRONTEND_SERVICE}"
      ;;

    playwright:exec)
      require_command_after_double_dash "${command}" "$@" compose_run "${PLAYWRIGHT_SERVICE}"
      ;;

    backend:shell)
      compose_shell "${BACKEND_SERVICE}"
      ;;

    frontend:shell)
      compose_shell "${FRONTEND_SERVICE}"
      ;;

    playwright:shell)
      compose_shell "${PLAYWRIGHT_SERVICE}"
      ;;

    compose:ps)
      ${COMPOSE} ps
      ;;

    compose:logs)
      ${COMPOSE} logs "$@"
      ;;

    compose:config)
      ${COMPOSE} config
      ;;

    *)
      echo "Unknown command: ${command}" >&2
      echo >&2
      usage >&2
      exit 2
      ;;
  esac
}

main "$@"