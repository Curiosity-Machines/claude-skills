#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="$SCRIPT_DIR/scripts/dopple"

echo "Installing dopple CLI..."

# Check for Node.js
if ! command -v node &>/dev/null; then
  echo "Error: Node.js is required. Install it from https://nodejs.org" >&2
  exit 1
fi

NODE_VERSION=$(node -v | cut -d. -f1 | tr -d v)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "Error: Node.js 18+ required (found $(node -v))" >&2
  exit 1
fi

# Install dependencies and build
cd "$CLI_DIR"
npm install
npm run build

# Link globally — try npm link first, fall back to ~/bin symlink
if npm link 2>/dev/null; then
  echo ""
  echo "Done! Run 'dopple login' to authenticate with GitHub."
  echo "Then 'dopple deploy' from any project with a dopple.toml."
else
  mkdir -p "$HOME/bin"
  ln -sf "$CLI_DIR/dist/cli.js" "$HOME/bin/dopple"

  if echo "$PATH" | tr ':' '\n' | grep -q "$HOME/bin"; then
    echo ""
    echo "Done! Run 'dopple login' to authenticate with GitHub."
    echo "Then 'dopple deploy' from any project with a dopple.toml."
  else
    echo ""
    echo "Done! Installed to ~/bin/dopple."
    echo "Add ~/bin to your PATH by adding this to your shell config:"
    echo "  export PATH=\"\$HOME/bin:\$PATH\""
    echo ""
    echo "Then run 'dopple login' to authenticate with GitHub."
  fi
fi
