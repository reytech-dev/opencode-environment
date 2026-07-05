#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# --------------------------------------------------------------------
# Output helpers
# --------------------------------------------------------------------

log_info()    { printf '  %s\n' "$*"; }
log_success() { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }
log_warn()    { printf '\033[0;33m  ! %s\033[0m\n' "$*" >&2; }
log_error()   { printf '\033[0;31m  ✗ %s\033[0m\n' "$*" >&2; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

# --------------------------------------------------------------------
# Global compose command
# --------------------------------------------------------------------

COMPOSE_CMD=()

detect_compose_cmd() {
    if command_exists docker && docker compose version &>/dev/null; then
        COMPOSE_CMD=(docker compose)
    elif command_exists docker-compose && docker-compose version &>/dev/null; then
        COMPOSE_CMD=(docker-compose)
    else
        return 1
    fi
    return 0
}

compose_file_exists() {
    [[ -f "$REPO_ROOT/docker-compose.yaml" ]] || [[ -f "$REPO_ROOT/compose.yaml" ]]
}

service_exists() {
    local service="$1"
    "${COMPOSE_CMD[@]}" config --services 2>/dev/null | grep -qxF "$service"
}

# --------------------------------------------------------------------
# Fail helpers
# --------------------------------------------------------------------

fail_enter() {
    local reason="$1"
    shift
    echo
    printf '\033[0;31m✗ Cannot enter opencode environment.\033[0m\n\n' >&2
    echo "Reason:" >&2
    printf '  \033[0;31m✗ %s\033[0m\n' "$reason" >&2
    if [[ $# -gt 0 ]]; then
        echo >&2
        echo "Fix:" >&2
        for line in "$@"; do
            printf '  %s\n' "$line" >&2
        done
    fi
    echo >&2
    exit 1
}

# --------------------------------------------------------------------
# Welcome message
# --------------------------------------------------------------------

print_welcome() {
    echo
    log_success "Entering opencode environment."
    echo
    log_info "Repository root is mounted at:"
    log_info "  /project"
    echo
    log_info "Application repositories will later live in:"
    log_info "  /workspace/backend"
    log_info "  /workspace/frontend"
    log_info "  /workspace/infrastructure"
    echo
    log_info "Reminder:"
    log_info "  Use the project runner scripts for backend, frontend, infrastructure, and E2E tooling."
    log_info "  Do not install or run project toolchains directly on the host machine."
    echo
    log_info "Leaving:"
    log_info '  Type "exit" to return to your host shell.'
    echo
}

# --------------------------------------------------------------------
# Entry
# --------------------------------------------------------------------

enter_shell() {
    print_welcome
    exec "${COMPOSE_CMD[@]}" run --rm opencode bash
}

run_command() {
    exec "${COMPOSE_CMD[@]}" run --rm opencode "$@"
}

# --------------------------------------------------------------------
# Pre-enter checks
# --------------------------------------------------------------------

enter() {
    cd "$REPO_ROOT"

    # 1. .env
    if [[ ! -f "$REPO_ROOT/.env" ]]; then
        fail_enter \
            ".env is missing." \
            "./bin/oe setup" \
            "./bin/oe doctor" \
            "./bin/oe start" \
            "./bin/oe enter"
    fi

    # 2. Docker Compose file
    if ! compose_file_exists; then
        fail_enter \
            "Docker Compose file not found (docker-compose.yaml / compose.yaml)." \
            "./bin/oe setup" \
            "./bin/oe doctor"
    fi

    # 3. Docker installed
    if ! command_exists docker; then
        fail_enter \
            "Docker is not installed." \
            "./bin/oe doctor"
    fi

    # 4. Docker reachable
    if ! docker info &>/dev/null; then
        fail_enter \
            "Docker daemon is not reachable — is Docker running?" \
            "./bin/oe doctor"
    fi

    # 5. Docker Compose available
    if ! detect_compose_cmd; then
        fail_enter \
            "Docker Compose is not available (tried docker compose and docker-compose)." \
            "./bin/oe doctor"
    fi

    # 6. opencode service exists in config
    if ! service_exists "opencode"; then
        fail_enter \
            "The \"opencode\" service is not defined in the Docker Compose configuration." \
            "Check your docker-compose.yaml / compose.yaml" \
            "./bin/oe doctor"
    fi

    # Interactive shell or command mode
    if [[ $# -gt 0 ]]; then
        run_command "$@"
    else
        enter_shell
    fi
}

# --------------------------------------------------------------------
# Main
# --------------------------------------------------------------------

main() {
    # Strip leading "--" separator if present (command mode)
    if [[ "${1:-}" == "--" ]]; then
        shift
        enter "$@"
    else
        enter "$@"
    fi
}

main "$@"
