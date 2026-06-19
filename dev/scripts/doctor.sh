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
fail()        { log_error "$*"; exit 1; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

# --------------------------------------------------------------------
# Global counters
# --------------------------------------------------------------------

FAIL_COUNT=0
WARN_COUNT=0

report_ok()   { log_success "$*"; }
report_warn() { log_warn "$*";   WARN_COUNT=$((WARN_COUNT + 1)); }
report_fail() { log_error "$*";  FAIL_COUNT=$((FAIL_COUNT + 1)); }

# --------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------

read_env_value() {
    local key="$1"
    local file="$REPO_ROOT/.env"
    [[ -f "$file" ]] || return 1
    local val
    val=$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n1 | sed 's|^[^=]*=||')
    val="${val#\"}"
    val="${val%\"}"
    echo "$val"
}

is_shell_expression() {
    local val="$1"
    [[ "$val" == *'$(openssl'* ]]
}

is_placeholder() {
    local val="$1"
    [[ "$val" == "<"*">" ]]
}

# --------------------------------------------------------------------
# Port checking (ss → lsof → bash /dev/tcp)
# --------------------------------------------------------------------

port_in_use() {
    local port="$1"
    if command_exists ss; then
        ss -tln 2>/dev/null | grep -qE ":$port\b" && return 0
    fi
    if command_exists lsof; then
        lsof -i ":$port" -sTCP:LISTEN &>/dev/null && return 0
    fi
    (echo >/dev/tcp/127.0.0.1/$port) 2>/dev/null && return 0
    return 1
}

# --------------------------------------------------------------------
# Check sections
# --------------------------------------------------------------------

check_repository() {
    echo
    echo "Repository:"

    # Repo root
    if [[ -d "$REPO_ROOT" ]]; then
        report_ok "Repository root found"
    else
        report_fail "Repository root not found"
    fi

    # .env.template
    if [[ -f "$REPO_ROOT/.env.template" ]]; then
        report_ok ".env.template found"
    else
        report_fail ".env.template not found"
    fi

    # .env
    if [[ -f "$REPO_ROOT/.env" ]]; then
        report_ok ".env found"
    else
        report_fail ".env not found"
    fi

    # docker-compose.yaml
    if [[ -f "$REPO_ROOT/docker-compose.yaml" ]] || [[ -f "$REPO_ROOT/compose.yaml" ]]; then
        report_ok "Docker Compose file found"
    else
        report_fail "Docker Compose file not found (docker-compose.yaml / compose.yaml)"
    fi

    # bin/oe
    if [[ -x "$REPO_ROOT/bin/oe" ]]; then
        report_ok "bin/oe is executable"
    else
        report_fail "bin/oe is missing or not executable"
    fi

    # Dev scripts
    if [[ -f "$REPO_ROOT/dev/scripts/wrapper.sh" ]]; then
        report_ok "dev/scripts/wrapper.sh found"
    else
        report_warn "dev/scripts/wrapper.sh not found"
    fi

    if [[ -f "$REPO_ROOT/dev/scripts/exec.sh" ]]; then
        report_ok "dev/scripts/exec.sh found"
    else
        report_warn "dev/scripts/exec.sh not found"
    fi

    # Workspace dirs
    local ws_ok=true
    for sub in backend frontend infrastructure; do
        if [[ ! -d "$REPO_ROOT/workspace/$sub" ]]; then
            ws_ok=false
            break
        fi
    done
    if $ws_ok; then
        report_ok "Workspace directories found"
    else
        report_fail "Workspace directories missing — run ./bin/oe setup"
    fi
}

check_configuration() {
    echo
    echo "Configuration:"

    # Only run if .env exists
    if [[ ! -f "$REPO_ROOT/.env" ]]; then
        report_fail ".env missing — run ./bin/oe setup"
        return
    fi

    # HOST_PROJECT_DIR
    local host_dir
    host_dir=$(read_env_value HOST_PROJECT_DIR || true)
    if [[ -z "$host_dir" ]]; then
        report_fail "HOST_PROJECT_DIR is not set"
    elif [[ "$host_dir" != "$REPO_ROOT" ]]; then
        report_fail "HOST_PROJECT_DIR is set incorrectly (got: $host_dir, expected: $REPO_ROOT)"
    else
        report_ok "HOST_PROJECT_DIR is set correctly"
    fi

    # OPEN_DESIGN_API_TOKEN
    local token
    token=$(read_env_value OPEN_DESIGN_API_TOKEN || true)
    if [[ -z "$token" ]]; then
        report_fail "OPEN_DESIGN_API_TOKEN is missing or empty"
    elif is_shell_expression "$token"; then
        report_fail "OPEN_DESIGN_API_TOKEN contains an unresolved shell expression — run ./bin/oe setup"
    else
        report_ok "OPEN_DESIGN_API_TOKEN is configured"
    fi

    # COMPOSE_PROJECT_NAME
    local project_name
    project_name=$(read_env_value COMPOSE_PROJECT_NAME || true)
    if [[ -z "$project_name" ]]; then
        report_fail "COMPOSE_PROJECT_NAME is missing or empty"
    elif is_placeholder "$project_name"; then
        report_fail "COMPOSE_PROJECT_NAME is not configured — run ./bin/oe setup"
    else
        report_ok "COMPOSE_PROJECT_NAME is configured"
    fi

    # Optional credentials (warn only)
    local opt_creds="DEEPSEEK_API_KEY CONTEXT7_API_KEY GITHUB_TOKEN GITHUB_USERNAME"
    local opt_labels="DEEPSEEK_API_KEY:opencode provider setup may be incomplete
CONTEXT7_API_KEY:Context7 integration may be unavailable
GITHUB_TOKEN:GitHub integration may be unavailable
GITHUB_USERNAME:GitHub integration may be unavailable"

    for cred in $opt_creds; do
        local val
        val=$(read_env_value "$cred" || true)
        if [[ -z "$val" ]] || is_placeholder "$val"; then
            local label
            label=$(echo "$opt_labels" | grep "^${cred}:" | sed "s|^${cred}:||")
            report_warn "${cred} is not set; ${label}"
        fi
    done
}

check_host_tools() {
    echo
    echo "Host:"

    local required_tools="bash git docker"
    for tool in $required_tools; do
        if command_exists "$tool"; then
            report_ok "$tool found"
        else
            report_fail "$tool is required but not found"
        fi
    done

    # Docker daemon
    if command_exists docker; then
        if docker info &>/dev/null; then
            report_ok "Docker daemon reachable"
        else
            report_fail "Docker daemon not reachable — is Docker running?"
        fi
    fi

    # Docker Compose
    if docker compose version &>/dev/null; then
        report_ok "Docker Compose available"
    elif command_exists docker-compose && docker-compose version &>/dev/null; then
        report_ok "Docker Compose available (docker-compose)"
    elif command_exists docker; then
        report_fail "Docker Compose not available (tried docker compose and docker-compose)"
    fi
}

check_docker_socket() {
    echo
    echo "Docker socket:"

    if [[ -S /var/run/docker.sock ]]; then
        report_ok "/var/run/docker.sock found"
    else
        if command_exists docker && docker info &>/dev/null; then
            report_warn "/var/run/docker.sock not found — Docker may be using a different socket path"
        else
            report_fail "/var/run/docker.sock not found"
        fi
    fi
}

check_ports() {
    echo
    echo "Ports:"

    # Format: ENV_VAR|default_port|label
    local entries=(
        "POSTGRES_PORT|5432|PostgreSQL"
        "MINIO_PORT|9000|MinIO API"
        "MINIO_CONSOLE_PORT|9001|MinIO Console"
        "PROMETHEUS_PORT|9090|Prometheus"
        "OPEN_DESIGN_PORT|7456|Open Design"
    )

    for entry in "${entries[@]}"; do
        local env_var="${entry%%|*}"
        local rest="${entry#*|}"
        local default_port="${rest%%|*}"
        local label="${rest#*|}"

        local port
        port=$(read_env_value "$env_var" 2>/dev/null || true)
        port="${port:-$default_port}"

        if port_in_use "$port"; then
            report_warn "Port $port ($label) is already in use"
        else
            report_ok "Port $port available for $label"
        fi
    done
}

check_scripts_executable() {
    echo
    echo "Scripts:"

    local scripts="bin/oe dev/scripts/setup.sh dev/scripts/doctor.sh"
    local all_ok=true
    for script in $scripts; do
        if [[ -x "$REPO_ROOT/$script" ]]; then
            report_ok "$script is executable"
        else
            report_warn "$script is not executable"
            all_ok=false
        fi
    done

    if ! $all_ok; then
        log_info "  Fix: chmod +x bin/oe dev/scripts/setup.sh dev/scripts/doctor.sh"
    fi
}

check_compose_config() {
    # Only run if Docker is available and .env exists
    if ! command_exists docker; then
        return
    fi
    if [[ ! -f "$REPO_ROOT/.env" ]]; then
        return
    fi

    echo
    echo "Compose:"

    local output
    if output=$(cd "$REPO_ROOT" && docker compose config 2>&1); then
        report_ok "Docker Compose config is valid"
    else
        report_warn "Docker Compose config validation failed:"
        echo "$output" | while IFS= read -r line; do
            printf '    %s\n' "$line" >&2
        done
    fi
}

print_result() {
    echo
    echo "Result:"

    if [[ $FAIL_COUNT -gt 0 ]]; then
        log_error "Environment is not ready."
        echo
        log_info "Fix:"
        log_info "  ./bin/oe setup"
        log_info "  ./bin/oe doctor"
        return 1
    fi

    if [[ $WARN_COUNT -gt 0 ]]; then
        log_success "Environment looks ready (with warnings)."
    else
        log_success "Environment looks ready."
    fi

    echo
    log_info "Next:"
    log_info "  ./bin/oe start"
    echo
    return 0
}

# --------------------------------------------------------------------
# Main
# --------------------------------------------------------------------

main() {
    cd "$REPO_ROOT"

    echo
    echo "opencode-environment doctor"

    check_repository
    check_configuration
    check_host_tools
    check_docker_socket
    check_ports
    check_scripts_executable
    check_compose_config

    if ! print_result; then
        exit 1
    fi
}

main "$@"
