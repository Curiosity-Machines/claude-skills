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
npm install --omit=dev
npm run build

# Link globally
npm link 2>/dev/null || {
  echo ""
  echo "Could not link globally (may need sudo)."
  echo "You can either:"
  echo "  sudo npm link"
  echo "  OR add an alias to your shell config:"
  echo "    alias dopple=\"node $CLI_DIR/dist/cli.js\""
  exit 0
}

echo ""
echo "Done! Run 'dopple login' to authenticate with GitHub."
echo "Then 'dopple deploy' from any project with a dopple.toml."
