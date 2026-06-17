#!/usr/bin/env python3
"""Check blueprint repositories for new tags and update blueprints.yaml."""

import json
import os
import re
import sys
import urllib.request
from pathlib import Path


BLUEPRINTS_FILE = Path(".opencode/blueprints.yaml")
GITHUB_API = "https://api.github.com/repos"
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")


def parse_semver(tag):
    """Extract (major, minor, patch) from a tag like 'v1.2.3'."""
    m = re.match(r"v?(\d+)\.(\d+)\.(\d+)", tag)
    if not m:
        return (0, 0, 0)
    return tuple(int(x) for x in m.groups())


def get_latest_tag(repo_full):
    """Fetch the latest tag from GitHub API for a repository."""
    url = f"{GITHUB_API}/{repo_full}/tags?per_page=1"
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if GITHUB_TOKEN:
        req.add_header("Authorization", f"Bearer {GITHUB_TOKEN}")

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            if isinstance(data, list) and data:
                return data[0]["name"]
    except Exception as e:
        print(f"  [WARN] API error for {repo_full}: {e}", file=sys.stderr)
    return None


def main():
    import yaml

    text = BLUEPRINTS_FILE.read_text(encoding="utf-8")
    data = yaml.safe_load(text)

    blueprints = data.get("blueprints", {})
    updates = []

    for area, area_blueprints in blueprints.items():
        for name, bp in area_blueprints.items():
            if not isinstance(bp, dict):
                continue
            if bp.get("ref_type") != "tag":
                continue

            repo = bp.get("repository", "")
            current_ref = bp.get("default_ref", "")
            current_semver = parse_semver(current_ref)

            latest_tag = get_latest_tag(repo)
            if not latest_tag:
                print(f"  [SKIP] {bp['id']}: could not fetch tags")
                continue

            latest_semver = parse_semver(latest_tag)

            if latest_semver > current_semver:
                updates.append((bp["id"], repo, current_ref, latest_tag))
                print(f"  [UPDATE] {bp['id']}: {current_ref} -> {latest_tag}")
            else:
                print(f"  [OK] {bp['id']}: {current_ref} (latest: {latest_tag})")

    if not updates:
        print("\nNo blueprint updates found.")
        return 0

    for bp_id, repo, old_ref, new_ref in updates:
        repo_marker = f'repository: "{repo}"'
        repo_idx = text.find(repo_marker)
        if repo_idx == -1:
            print(f"  [ERROR] Could not find repository '{repo}' in file", file=sys.stderr)
            continue

        tail = text[repo_idx:]
        default_match = re.search(r'default_ref:\s*"([^"]*)"', tail)
        if not default_match:
            print(f"  [ERROR] Could not find default_ref for {bp_id}", file=sys.stderr)
            continue

        abs_start = repo_idx + default_match.start(1)
        abs_end = repo_idx + default_match.end(1)
        text = text[:abs_start] + new_ref + text[abs_end:]
        print(f"  Applied: {bp_id}: {old_ref} -> {new_ref}")

    BLUEPRINTS_FILE.write_text(text, encoding="utf-8")
    print(f"\nUpdated {BLUEPRINTS_FILE} with {len(updates)} blueprint(s).")

    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a") as f:
            f.write("changes=true\n")
    print("changes=true")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
