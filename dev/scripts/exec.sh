#!/usr/bin/env bash
set -euo pipefail

# --------------------------------------------------------------------
# dev - Docker Compose development wrapper
#
# Escape-hatch commands:
#
#   ./exec.sh backend:exec [subdir] -- <command>
#   ./exec.sh frontend:exec [subdir] -- <command>
#   ./exec.sh playwright:exec [subdir] -- <command>
#
#   ./exec.sh backend:shell [subdir]
#   ./exec.sh frontend:shell [subdir]
#   ./exec.sh playwright:shell [subdir]
#
# Examples:
#
#   ./exec.sh backend:exec -- ./gradlew dependencies
#   ./exec.sh backend:exec my-app -- ./gradlew test --tests '*RouteServiceTest'
#   ./exec.sh frontend:exec -- pnpm why react
#   ./exec.sh frontend:exec web-client -- pnpm add -D vitest
#   ./exec.sh playwright:exec -- pnpm exec playwright test --debug
#   ./exec.sh backend:shell my-app
# --------------------------------------------------------------------

COMPOSE="${COMPOSE:-docker compose}"

BACKEND_SERVICE="${BACKEND_SERVICE:-java-runner}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-node-runner}"
PLAYWRIGHT_SERVICE="${PLAYWRIGHT_SERVICE:-playwright-runner}"

usage() {
  cat <<EOF
Usage:
  ./exec.sh <command>

Escape hatches:
  ./exec.sh backend:exec [subdir] -- <command>
  ./exec.sh frontend:exec [subdir] -- <command>
  ./exec.sh playwright:exec [subdir] -- <command>

Shells:
  ./exec.sh backend:shell [subdir]
  ./exec.sh frontend:shell [subdir]
  ./exec.sh playwright:shell [subdir]

Diagnostics:
  ./exec.sh compose:ps
  ./exec.sh compose:logs
  ./exec.sh compose:config

Examples:
  ./exec.sh backend:exec -- ./gradlew test
  ./exec.sh backend:exec my-app -- ./gradlew dependencies
  ./exec.sh frontend:exec -- pnpm install
  ./exec.sh frontend:exec web-client -- pnpm build
  ./exec.sh playwright:exec -- pnpm exec playwright test
  ./exec.sh backend:shell my-app
EOF
}

compose_run() {
  local service="$1"
  local subdir="${2:-}"
  shift 2

  local workdir="/workspace"
  if [ -n "$subdir" ]; then
    workdir="/workspace/$subdir"
  fi

  ${COMPOSE} run \
    --rm \
    --workdir "${workdir}" \
    "${service}" \
    "$@"
}

compose_shell() {
  local service="$1"
  local subdir="${2:-}"

  local workdir="/workspace"
  if [ -n "$subdir" ]; then
    workdir="/workspace/$subdir"
  fi

  ${COMPOSE} run \
    --rm \
    --workdir "${workdir}" \
    "${service}" \
    sh
}

# Parses an optional subdir followed by '--'.
# On success: sets SUBDIR global (empty if not provided), shifts past subdir/--,
# leaves the inner command in $@.
# Returns 1 if '--' is missing, 2 if no command follows '--'.
parse_runner_args() {
  SUBDIR=""
  if [[ $# -gt 0 && "${1:-}" != "--" ]]; then
    SUBDIR="$1"
    shift
  fi
  if [[ "$#" -eq 0 || "${1:-}" != "--" ]]; then
    return 1
  fi
  shift
  if [[ "$#" -eq 0 ]]; then
    return 2
  fi
  return 0
}

main() {
  local command="${1:-help}"
  shift || true

  local subdir

  case "${command}" in
    help|-h|--help)
      usage
      ;;

    backend:exec)
      if ! parse_runner_args "$@"; then
        echo "Error: backend:exec requires '--' followed by a command." >&2
        echo "Usage: ./exec.sh backend:exec [subdir] -- <command>" >&2
        exit 2
      fi
      [ -n "${SUBDIR}" ] && shift
      shift
      compose_run "${BACKEND_SERVICE}" "${SUBDIR}" "$@"
      ;;

    frontend:exec)
      if ! parse_runner_args "$@"; then
        echo "Error: frontend:exec requires '--' followed by a command." >&2
        echo "Usage: ./exec.sh frontend:exec [subdir] -- <command>" >&2
        exit 2
      fi
      [ -n "${SUBDIR}" ] && shift
      shift
      compose_run "${FRONTEND_SERVICE}" "${SUBDIR}" "$@"
      ;;

    playwright:exec)
      if ! parse_runner_args "$@"; then
        echo "Error: playwright:exec requires '--' followed by a command." >&2
        echo "Usage: ./exec.sh playwright:exec [subdir] -- <command>" >&2
        exit 2
      fi
      [ -n "${SUBDIR}" ] && shift
      shift
      compose_run "${PLAYWRIGHT_SERVICE}" "${SUBDIR}" "$@"
      ;;

    backend:shell)
      subdir="${1:-}"
      compose_shell "${BACKEND_SERVICE}" "${subdir}"
      ;;

    frontend:shell)
      subdir="${1:-}"
      compose_shell "${FRONTEND_SERVICE}" "${subdir}"
      ;;

    playwright:shell)
      subdir="${1:-}"
      compose_shell "${PLAYWRIGHT_SERVICE}" "${subdir}"
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
