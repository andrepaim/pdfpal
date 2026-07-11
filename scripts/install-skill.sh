#!/usr/bin/env bash
# Symlinks skills/pdfpal-cli into Claude Code's and Codex's user skill
# directories so either agent can discover it. Re-run to update after
# editing the skill; pass --uninstall to remove the symlinks.
set -euo pipefail

SKILL_NAME="pdfpal-cli"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_SRC="$REPO_DIR/skills/$SKILL_NAME"

CLAUDE_SKILLS_DIR="$HOME/.claude/skills"
CODEX_SKILLS_DIR="${CODEX_HOME:-$HOME/.codex}/skills"

if [ ! -d "$SKILL_SRC" ]; then
  echo "error: $SKILL_SRC not found" >&2
  exit 1
fi

link_skill() {
  local target_dir="$1"
  local dest="$target_dir/$SKILL_NAME"
  mkdir -p "$target_dir"
  if [ -L "$dest" ]; then
    rm "$dest"
  elif [ -e "$dest" ]; then
    echo "warning: $dest already exists and isn't a symlink — leaving it alone" >&2
    return
  fi
  ln -s "$SKILL_SRC" "$dest"
  echo "linked $dest -> $SKILL_SRC"
}

unlink_skill() {
  local target_dir="$1"
  local dest="$target_dir/$SKILL_NAME"
  if [ -L "$dest" ]; then
    rm "$dest"
    echo "removed $dest"
  elif [ -e "$dest" ]; then
    echo "warning: $dest exists and isn't a symlink — leaving it alone" >&2
  fi
}

if [ "${1:-}" = "--uninstall" ]; then
  unlink_skill "$CLAUDE_SKILLS_DIR"
  unlink_skill "$CODEX_SKILLS_DIR"
else
  link_skill "$CLAUDE_SKILLS_DIR"
  link_skill "$CODEX_SKILLS_DIR"
fi
