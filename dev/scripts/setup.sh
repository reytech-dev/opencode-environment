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
# Helpers
# --------------------------------------------------------------------

repo_root() {
    echo "$REPO_ROOT"
}

ensure_dir() {
    local dir="$1"
    mkdir -p "$dir"
    if [[ ! -f "$dir/.gitkeep" ]]; then
        touch "$dir/.gitkeep"
    fi
}

read_env_value() {
    local key="$1"
    local file="${2:-.env}"
    local val
    val=$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n1 | sed 's|^[^=]*=||')
    val="${val#\"}"
    val="${val%\"}"
    echo "$val"
}

set_env_value() {
    local key="$1"
    local value="$2"
    local file="${3:-.env}"

    if grep -qE "^${key}=" "$file" 2>/dev/null; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s|^${key}=.*|${key}=\"${value}\"|" "$file"
        else
            sed -i "s|^${key}=.*|${key}=\"${value}\"|" "$file"
        fi
    else
        echo "${key}=\"${value}\"" >> "$file"
    fi
}

is_shell_expression() {
    local val="$1"
    [[ "$val" == *'$(openssl'* ]]
}

is_placeholder() {
    local val="$1"
    [[ "$val" == "<"*">" ]]
}

generate_token() {
    if command_exists openssl; then
        openssl rand -hex 32
    elif [[ -r /dev/urandom ]]; then
        od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
    else
        fail "Cannot generate a secure token: openssl not found and /dev/urandom not readable."
    fi
}

# --------------------------------------------------------------------
# Setup steps
# --------------------------------------------------------------------

setup_env_file() {
    local env_file="$REPO_ROOT/.env"
    local template="$REPO_ROOT/.env.template"

    if [[ ! -f "$template" ]]; then
        fail ".env.template not found at $template"
    fi

    if [[ ! -f "$env_file" ]]; then
        cp "$template" "$env_file"
        log_success "Created .env from .env.template"
    else
        log_success ".env already exists"
    fi
}

setup_workspace_dirs() {
    local changed=false
    for sub in backend frontend infrastructure; do
        local dir="$REPO_ROOT/workspace/$sub"
        if [[ ! -d "$dir" ]]; then
            mkdir -p "$dir"
            touch "$dir/.gitkeep"
            changed=true
        elif [[ ! -f "$dir/.gitkeep" ]]; then
            touch "$dir/.gitkeep"
            changed=true
        fi
    done

    if $changed; then
        log_success "Created workspace directories"
    else
        log_success "Workspace directories already present"
    fi
}

setup_host_project_dir() {
    local env_file="$REPO_ROOT/.env"
    local current
    current=$(read_env_value HOST_PROJECT_DIR "$env_file")

    if [[ "$current" == "$REPO_ROOT" ]]; then
        log_success "HOST_PROJECT_DIR is already correct"
        return
    fi

    set_env_value HOST_PROJECT_DIR "$REPO_ROOT" "$env_file"
    log_success "Set HOST_PROJECT_DIR to $REPO_ROOT"
}

setup_open_design_token() {
    local env_file="$REPO_ROOT/.env"
    local current
    current=$(read_env_value OPEN_DESIGN_API_TOKEN "$env_file")

    # Already has a concrete non-empty non-expression value → skip
    if [[ -n "$current" ]] && ! is_shell_expression "$current"; then
        log_success "OPEN_DESIGN_API_TOKEN is already configured"
        return
    fi

    local token
    token=$(generate_token)
    set_env_value OPEN_DESIGN_API_TOKEN "$token" "$env_file"

    if is_shell_expression "${current:-}"; then
        log_success "Replaced shell expression in OPEN_DESIGN_API_TOKEN"
    else
        log_success "Generated OPEN_DESIGN_API_TOKEN"
    fi
}

setup_state_file() {
    local state_dir="$REPO_ROOT/.opencodenv"
    local state_file="$state_dir/state"

    mkdir -p "$state_dir"
    cat > "$state_file" <<EOF
INITIALIZED=true
EOF
    log_success "Wrote state file: .opencodenv/state"
}

# --------------------------------------------------------------------
# Optional credentials
# --------------------------------------------------------------------

prompt_optional_credentials() {
    local interactive=false
    [[ -t 1 ]] && [[ -e /dev/tty ]] && interactive=true

    if ! $interactive; then
        log_info "Skipping optional credential prompts (non-interactive)"
        return
    fi

    local creds=(
        "DEEPSEEK_API_KEY|DeepSeek API key (opencode AI provider)"
        "CONTEXT7_API_KEY|Context7 API key (documentation integration)"
        "GITHUB_USERNAME|GitHub username"
        "GITHUB_TOKEN|GitHub personal access token"
    )

    echo
    log_info "Optional credentials (press Enter to skip):"
    echo

    for entry in "${creds[@]}"; do
        local key="${entry%%|*}"
        local label="${entry#*|}"
        local current
        current=$(read_env_value "$key" "$REPO_ROOT/.env" || true)

        if [[ -z "$current" ]] || is_placeholder "$current"; then
            printf '  %s (%s) []: ' "$key" "$label" > /dev/tty
        else
            printf '  %s (%s) [configured]: ' "$key" "$label" > /dev/tty
        fi

        read -r user_input < /dev/tty

        if [[ -n "$user_input" ]]; then
            set_env_value "$key" "$user_input" "$REPO_ROOT/.env"
            log_success "$key configured"
        fi
    done
}

# --------------------------------------------------------------------
# Main
# --------------------------------------------------------------------

main() {
    cd "$REPO_ROOT"

    echo
    log_info "opencode-environment setup"
    echo

    setup_env_file
    setup_workspace_dirs
    setup_host_project_dir
    setup_open_design_token
    prompt_optional_credentials
    setup_state_file

    echo
    log_success "Environment setup completed."
    echo
    log_info "Next:"
    log_info "  ./bin/oe doctor"
    log_info "  ./bin/oe start"
    echo
}

main "$@"
