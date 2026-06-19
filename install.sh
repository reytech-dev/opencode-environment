#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/reytech-dev/opencode-environment.git"
REPO_SLUG="reytech-dev/opencode-environment"

# --------------------------------------------------------------------
# Help
# --------------------------------------------------------------------

print_help() {
    cat <<EOF
Usage:
  install.sh [DIRECTORY] [--version <tag>]
  install.sh --help

Bootstrap an opencode-environment workbench.

Arguments:
  DIRECTORY           Target directory for the workbench (optional when running interactively).
  --version <tag>     Install a specific version, or "latest" for the newest GitHub tag.
                      Defaults to latest if not provided and terminal is not interactive.
  --help              Show this help message.

Examples:
  # Interactive (prompts for directory and version):
  curl -fsSL https://raw.githubusercontent.com/${REPO_SLUG}/main/install.sh | bash

  # Non-interactive with directory (prompts for version):
  curl -fsSL https://raw.githubusercontent.com/${REPO_SLUG}/main/install.sh | bash -s -- my-workbench

  # Install a specific version:
  ./install.sh my-workbench --version v1.0.0

  # Install latest release:
  ./install.sh my-workbench --version latest
EOF
}

# --------------------------------------------------------------------
# Utility functions
# --------------------------------------------------------------------

log()   { printf '\033[0;36m  >\033[0m %s\n' "$*"; }
warn()  { printf '\033[0;33m  [WARN]\033[0m %s\n' "$*" >&2; }
fail()  { printf '\033[0;31m  [ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

# --------------------------------------------------------------------
# Argument parsing
# --------------------------------------------------------------------

parse_args() {
    TARGET_DIR=""
    VERSION_ARG=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --help|-h|help)
                print_help
                exit 0
                ;;
            --version)
                if [[ $# -lt 2 ]]; then
                    fail "Missing value for --version"
                fi
                VERSION_ARG="$2"
                shift 2
                ;;
            -*)
                fail "Unknown option: $1"
                ;;
            *)
                if [[ -z "$TARGET_DIR" ]]; then
                    TARGET_DIR="$1"
                else
                    fail "Unexpected argument: $1"
                fi
                shift
                ;;
        esac
    done
}

# --------------------------------------------------------------------
# Interactive prompts (read from /dev/tty to work with pipes)
# --------------------------------------------------------------------

prompt_missing_values() {
    local interactive=false
    [[ -t 1 ]] && [[ -e /dev/tty ]] && interactive=true

    if [[ -z "$TARGET_DIR" ]]; then
        if $interactive; then
            printf 'Target directory name: ' > /dev/tty
            read -r TARGET_DIR < /dev/tty
            if [[ -z "$TARGET_DIR" ]]; then
                fail "No target directory provided"
            fi
        else
            fail "No target directory provided. Usage: install.sh <directory> [--version <tag>]"
        fi
    fi

    if [[ -z "$VERSION_ARG" ]]; then
        if $interactive; then
            printf 'Version/tag to install (default: latest): ' > /dev/tty
            read -r VERSION_ARG < /dev/tty
        fi
        VERSION_ARG="${VERSION_ARG:-latest}"
    fi
}

# --------------------------------------------------------------------
# Resolve latest version
# --------------------------------------------------------------------

resolve_latest_version() {
    [[ "$VERSION_ARG" != "latest" ]] && return

    log "Resolving latest version from GitHub..."

    local latest_tag
    latest_tag=$(git ls-remote --tags --sort=-v:refname "$REPO_URL" 2>/dev/null \
        | grep 'refs/tags/v' \
        | grep -v '\^{}$' \
        | sed 's|.*refs/tags/||' \
        | head -n1 || true)

    if [[ -n "$latest_tag" ]]; then
        VERSION_ARG="$latest_tag"
        log "Latest version: $VERSION_ARG"
    else
        log "No release tags found, defaulting to main branch"
        VERSION_ARG="main"
    fi
}

# --------------------------------------------------------------------
# Validate version
# --------------------------------------------------------------------

validate_version() {
    log "Verifying version: $VERSION_ARG"

    local ref_exists

    if [[ "$VERSION_ARG" == "main" ]]; then
        ref_exists=$(git ls-remote --heads "$REPO_URL" refs/heads/main 2>/dev/null || true)
        if [[ -z "$ref_exists" ]]; then
            fail "main branch not found on remote repository"
        fi
        return
    fi

    ref_exists=$(git ls-remote --tags --heads "$REPO_URL" \
        "refs/tags/$VERSION_ARG" "refs/heads/$VERSION_ARG" 2>/dev/null || true)

    if [[ -z "$ref_exists" ]]; then
        log "Version $VERSION_ARG not found on remote."

        local available_tags
        available_tags=$(git ls-remote --tags --sort=-v:refname "$REPO_URL" 2>/dev/null \
            | grep 'refs/tags/v' \
            | grep -v '\^{}$' \
            | sed 's|.*refs/tags/||' \
            | head -n5 || true)

        if [[ -n "$available_tags" ]]; then
            printf '\n  Available tags:\n' >&2
            while IFS= read -r tag; do
                printf '    %s\n' "$tag" >&2
            done <<< "$available_tags"
        else
            printf '\n  No tags available for this repository.\n' >&2
        fi

        fail "Version $VERSION_ARG not found."
    fi
}

# --------------------------------------------------------------------
# Clone
# --------------------------------------------------------------------

clone_repository() {
    log "Cloning $REPO_SLUG into $TARGET_DIR..."

    if [[ -d "$TARGET_DIR" ]]; then
        if [[ -n "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]]; then
            fail "Target directory '$TARGET_DIR' already exists and is not empty."
        fi
    fi

    if git clone --depth 1 --branch "$VERSION_ARG" "$REPO_URL" "$TARGET_DIR"; then
        :
    else
        log "Shallow clone with --branch $VERSION_ARG failed; trying full clone..."
        rm -rf "$TARGET_DIR" 2>/dev/null || true
        git clone "$REPO_URL" "$TARGET_DIR"
        git -C "$TARGET_DIR" checkout "$VERSION_ARG"
    fi
}

# --------------------------------------------------------------------
# Post-clone setup
# --------------------------------------------------------------------

run_setup() {
    local dir="$1"

    local project_name
    project_name=$(basename "$TARGET_DIR")

    if [[ -x "$dir/bin/oe" ]]; then
        log "Running setup..."
        (cd "$dir" && COMPOSE_PROJECT_NAME="$project_name" ./bin/oe setup) || warn "./bin/oe setup exited with code $?"
        log "Running doctor..."
        (cd "$dir" && ./bin/oe doctor) || warn "./bin/oe doctor exited with code $?"
    else
        warn "./bin/oe not available yet — using fallback setup"

        if [[ ! -f "$dir/.env" ]] && [[ -f "$dir/.env.template" ]]; then
            cp "$dir/.env.template" "$dir/.env"
            log "Created .env from .env.template"
        fi

        if [[ -f "$dir/.env" ]]; then
            sed -i "s|^COMPOSE_PROJECT_NAME=.*|COMPOSE_PROJECT_NAME=\"${project_name}\"|" "$dir/.env"
            log "Set COMPOSE_PROJECT_NAME to ${project_name}"
        fi

        mkdir -p "$dir/workspace/backend" "$dir/workspace/frontend" "$dir/workspace/infrastructure"
        log "Created workspace directories"
    fi
}

# --------------------------------------------------------------------
# Next steps
# --------------------------------------------------------------------

print_next_steps() {
    local location="$TARGET_DIR"
    if [[ "$TARGET_DIR" == /* ]]; then
        location="$TARGET_DIR"
    else
        location="./$TARGET_DIR"
    fi

    echo
    echo "opencode-environment installed successfully."
    echo
    echo "Location:"
    echo "  $location"
    echo
    echo "Version:"
    echo "  $VERSION_ARG"
    echo
    echo "Next:"
    echo "  cd $TARGET_DIR"
    echo "  ./bin/oe start"
    echo "  ./bin/oe enter -- opencode"
    echo
}

# --------------------------------------------------------------------
# Main
# --------------------------------------------------------------------

main() {
    command_exists git || fail "git is required but not installed. Install git and try again."
    command_exists bash || fail "bash is required but not installed."

    parse_args "$@"
    prompt_missing_values

    resolve_latest_version
    validate_version
    clone_repository
    run_setup "$TARGET_DIR"
    print_next_steps
}

main "$@"
