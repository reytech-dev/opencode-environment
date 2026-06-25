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
# Global compose command (array for two-word "docker compose")
# --------------------------------------------------------------------

COMPOSE_CMD=()

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
    printf '%s' "$val"
}

is_shell_expression() {
    local val="$1"
    [[ "$val" == *'$(openssl'* ]]
}

compose_file() {
    if [[ -f "$REPO_ROOT/docker-compose.yaml" ]]; then
        printf '%s' "$REPO_ROOT/docker-compose.yaml"
    elif [[ -f "$REPO_ROOT/compose.yaml" ]]; then
        printf '%s' "$REPO_ROOT/compose.yaml"
    fi
}

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

# Returns 0 if the port is occupied by a container belonging to this Compose project.
port_used_by_our_project() {
    local port="$1"

    local our_containers
    our_containers=$("${COMPOSE_CMD[@]}" ps -q 2>/dev/null || true)
    [[ -z "$our_containers" ]] && return 1

    # Method 1: docker port shows port mappings reliably without root.
    for cid in $our_containers; do
        if docker port "$cid" 2>/dev/null | grep -qE "(0\.0\.0\.0:|\[::\]|:::?)${port}$"; then
            return 0
        fi
    done

    # Method 2: PID-based matching (needs permissions to list process PIDs).
    local pids=""
    if command_exists ss; then
        pids=$(ss -tlnp 2>/dev/null | grep -E ":$port\b" | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' || true)
    fi
    if [[ -z "$pids" ]] && command_exists lsof; then
        pids=$(lsof -i ":$port" -sTCP:LISTEN -t 2>/dev/null || true)
    fi
    [[ -z "$pids" ]] && return 1

    for cid in $our_containers; do
        local container_pids
        container_pids=$(docker top "$cid" 2>/dev/null | tail -n+2 | awk '{print $2}' || true)
        for pid in $pids; do
            if echo "$container_pids" | grep -qE "^${pid}$"; then
                return 0
            fi
        done
    done

    return 1
}

service_in_config() {
    local service="$1"
    "${COMPOSE_CMD[@]}" config --services 2>/dev/null | grep -qxF "$service"
}

container_id_for_service() {
    local service="$1"
    "${COMPOSE_CMD[@]}" ps -q "$service" 2>/dev/null || true
}

container_state() {
    local container_id="$1"
    [[ -z "$container_id" ]] && { echo "missing"; return; }
    docker inspect -f '{{.State.Status}}' "$container_id" 2>/dev/null || echo "missing"
}

container_health_status() {
    local container_id="$1"
    [[ -z "$container_id" ]] && { echo "missing"; return; }
    docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || echo "missing"
}

has_healthcheck() {
    local container_id="$1"
    [[ -z "$container_id" ]] && return 1
    local health
    health=$(container_health_status "$container_id")
    [[ "$health" != "none" ]] && [[ "$health" != "missing" ]]
}

wait_for_service() {
    local service="$1"
    local timeout="${2:-120}"
    local interval="${3:-2}"

    local container_id
    container_id=$(container_id_for_service "$service")
    if [[ -z "$container_id" ]]; then
        log_warn "$service: no container found"
        return 1
    fi

    if has_healthcheck "$container_id"; then
        local elapsed=0
        while [[ $elapsed -lt $timeout ]]; do
            local status
            status=$(container_health_status "$container_id")
            if [[ "$status" == "healthy" ]]; then
                log_success "$service healthy"
                return 0
            fi
            local state
            state=$(container_state "$container_id")
            if [[ "$state" != "running" ]]; then
                log_error "$service container is not running (state: $state)"
                log_info "  Suggestion: ${COMPOSE_CMD[*]} logs $service"
                return 1
            fi
            sleep "$interval"
            elapsed=$((elapsed + interval))
        done
        log_error "$service: not healthy after ${timeout}s"
        log_info "  Suggestion: ${COMPOSE_CMD[*]} logs $service"
        return 1
    else
        local elapsed=0
        while [[ $elapsed -lt $timeout ]]; do
            if [[ "$(container_state "$container_id")" == "running" ]]; then
                log_success "$service running"
                return 0
            fi
            sleep "$interval"
            elapsed=$((elapsed + interval))
        done
        log_warn "$service: not running after ${timeout}s"
        return 1
    fi
}

# --------------------------------------------------------------------
# Fail with structured output
# --------------------------------------------------------------------

fail_start() {
    local reason="$1"
    shift
    echo
    printf '\033[0;31m✗ Cannot start opencode-environment.\033[0m\n' >&2
    echo >&2
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
# Preflight checks
# --------------------------------------------------------------------

preflight() {
    echo "Preflight:"
    local failed=false

    # .env
    if [[ -f "$REPO_ROOT/.env" ]]; then
        log_success ".env found"
    else
        log_error ".env is missing"
        failed=true
    fi

    # .env.template
    if [[ -f "$REPO_ROOT/.env.template" ]]; then
        log_success ".env.template found"
    else
        log_error ".env.template not found"
        failed=true
    fi

    # Compose file
    if [[ -n "$(compose_file)" ]]; then
        log_success "Docker Compose file found"
    else
        log_error "Docker Compose file not found (docker-compose.yaml / compose.yaml)"
        failed=true
    fi

    # If .env is missing, skip env-value checks and Docker checks can still run.
    if [[ -f "$REPO_ROOT/.env" ]]; then
        local host_dir
        host_dir=$(read_env_value HOST_PROJECT_DIR || true)
        if [[ -z "$host_dir" ]]; then
            log_error "HOST_PROJECT_DIR is not set"
            failed=true
        elif [[ "$host_dir" != "$REPO_ROOT" ]]; then
            log_error "HOST_PROJECT_DIR is set incorrectly (got: $host_dir, expected: $REPO_ROOT)"
            failed=true
        else
            log_success "HOST_PROJECT_DIR is set correctly"
        fi

        local token
        token=$(read_env_value OPEN_DESIGN_API_TOKEN || true)
        if [[ -z "$token" ]]; then
            log_error "OPEN_DESIGN_API_TOKEN is missing or empty"
            failed=true
        elif is_shell_expression "$token"; then
            log_error "OPEN_DESIGN_API_TOKEN contains an unresolved shell expression — run ./bin/oe setup"
            failed=true
        else
            log_success "OPEN_DESIGN_API_TOKEN is configured"
        fi
    fi

    # Docker
    if command_exists docker; then
        log_success "Docker found"
    else
        log_error "Docker is not installed"
        failed=true
    fi

    if command_exists docker; then
        if docker info &>/dev/null; then
            log_success "Docker daemon reachable"
        else
            log_error "Docker daemon not reachable — is Docker running?"
            failed=true
        fi
    fi

    # Docker Compose
    if detect_compose_cmd; then
        log_success "Docker Compose available"
    else
        log_error "Docker Compose not available (tried docker compose and docker-compose)"
        failed=true
    fi

    [[ "$failed" == "false" ]]
}

# --------------------------------------------------------------------
# Ensure workspace directories exist defensively
# --------------------------------------------------------------------

ensure_workspace_dirs() {
    local needed=false
    for sub in backend frontend infrastructure design-context; do
        if [[ ! -d "$REPO_ROOT/workspace/$sub" ]]; then
            mkdir -p "$REPO_ROOT/workspace/$sub"
            needed=true
        fi
    done
    if $needed; then
        log_warn "Workspace directories were missing and have been created."
    fi
}

# --------------------------------------------------------------------
# Pre-start port conflict detection
# --------------------------------------------------------------------

check_ports() {
    local entries=(
        "POSTGRES_PORT|5432|PostgreSQL"
        "MINIO_PORT|9000|MinIO API"
        "MINIO_CONSOLE_PORT|9001|MinIO Console"
        "PROMETHEUS_PORT|9090|Prometheus"
        "OPEN_DESIGN_PORT|7456|Open Design"
    )

    local failed=false

    for entry in "${entries[@]}"; do
        local env_var="${entry%%|*}"
        local rest="${entry#*|}"
        local default_port="${rest%%|*}"
        local label="${rest#*|}"

        local port
        port=$(read_env_value "$env_var" 2>/dev/null || true)
        port="${port:-$default_port}"

        if port_in_use "$port"; then
            if port_used_by_our_project "$port"; then
                log_warn "Port $port ($label) in use by existing Compose project, continuing"
            else
                log_error "Port $port ($label) is already in use by another process"
                failed=true
            fi
        fi
    done

    [[ "$failed" == "false" ]]
}

# --------------------------------------------------------------------
# Compose config validation
# --------------------------------------------------------------------

validate_compose_config() {
    local output
    output=$("${COMPOSE_CMD[@]}" config 2>&1) || {
        log_error "Compose configuration validation failed:"
        printf '    %s\n' "$output" >&2
        return 1
    }
    log_success "Compose configuration valid"
}

# --------------------------------------------------------------------
# Start Docker Compose stack
# --------------------------------------------------------------------

start_stack() {
    set +e
    "${COMPOSE_CMD[@]}" up -d postgres minio prometheus mailpit
    local ec=$?
    set -e
    if [[ $ec -eq 0 ]]; then
        log_success "Docker Compose stack started"
    else
        log_warn "Docker Compose reported errors (exit code: $ec). Proceeding with readiness checks."
    fi
}

# --------------------------------------------------------------------
# Wait for services to be ready
# --------------------------------------------------------------------

check_readiness() {
    echo
    echo "Readiness:"

    local services=(
        "postgres"
        "minio"
        "prometheus"
    )

    local failed=false

    for svc in "${services[@]}"; do
        if ! service_in_config "$svc"; then
            log_warn "$svc: not defined in Compose configuration"
            continue
        fi
        wait_for_service "$svc" || failed=true
    done

    [[ "$failed" == "false" ]]
}

# --------------------------------------------------------------------
# Print service URLs
# --------------------------------------------------------------------

print_urls() {
    echo
    echo "Useful URLs:"

    local open_design_port
    open_design_port=$(read_env_value OPEN_DESIGN_PORT || true)
    open_design_port="${open_design_port:-7456}"
    log_info "Open Design:    http://localhost:${open_design_port}"

    local minio_console_port
    minio_console_port=$(read_env_value MINIO_CONSOLE_PORT || true)
    minio_console_port="${minio_console_port:-9001}"
    log_info "MinIO Console:  http://localhost:${minio_console_port}"

    local minio_api_port
    minio_api_port=$(read_env_value MINIO_PORT || true)
    minio_api_port="${minio_api_port:-9000}"
    log_info "MinIO API:      http://localhost:${minio_api_port}"

    local prometheus_port
    prometheus_port=$(read_env_value PROMETHEUS_PORT || true)
    prometheus_port="${prometheus_port:-9090}"
    log_info "Prometheus:     http://localhost:${prometheus_port}"

    if service_in_config "mailpit"; then
        local mailpit_http_port
        mailpit_http_port=$(read_env_value MAILPIT_HTTP_PORT || true)
        mailpit_http_port="${mailpit_http_port:-8025}"
        log_info "Mailpit:        http://localhost:${mailpit_http_port}"
    fi
}

# --------------------------------------------------------------------
# Next steps hint
# --------------------------------------------------------------------

print_next_steps() {
    echo
    echo "Next:"
    log_info "./bin/oe enter -- opencode"
    echo
}

# --------------------------------------------------------------------
# Main
# --------------------------------------------------------------------

main() {
    cd "$REPO_ROOT"

    echo
    echo "opencode-environment start"

    # 1. Preflight
    if ! preflight; then
        fail_start \
            ".env is missing or misconfigured." \
            "./bin/oe setup" \
            "./bin/oe doctor" \
            "./bin/oe start"
    fi

    # 2. Ensure workspace directories
    ensure_workspace_dirs

    # 3. Port conflict check
    check_ports || fail_start \
        "Required ports are already in use by other processes." \
        "Stop conflicting processes and try again:  ./bin/oe start"

    # 4. Validate Compose configuration
    echo
    validate_compose_config || fail_start \
        "Compose configuration is invalid." \
        "Check the errors above and fix your .env or docker-compose.yaml."

    # 5. Start stack
    echo
    echo "Starting:"
    start_stack

    # 6. Readiness checks
    check_readiness || true

    # 7. Print URLs
    print_urls

    # 8. Next steps
    print_next_steps
}

main "$@"
