# Claude Skills — Curiosity Machines

Claude Code skills for Loop hardware development and Dopple Studio.

## Skills

### `/loop-dev`

Reference skill for building WebView activities, games, and SDK integrations for the **Loop** — a circular 800×800px, 320 DPI Android device with physical buttons and IMU.

Encodes: device specs, HCI philosophy, full SDK types, button routing, rim swipe implementation, build toolchain, and CDP eval patterns.

**Install globally:**
```bash
curl -sL https://raw.githubusercontent.com/Curiosity-Machines/claude-skills/main/loop-dev.md \
  -o ~/.claude/commands/loop-dev.md
```

**Install project-level:**
```bash
curl -sL https://raw.githubusercontent.com/Curiosity-Machines/claude-skills/main/loop-dev.md \
  -o .claude/commands/loop-dev.md
```

Once installed, type `/loop-dev` in Claude Code to load the full reference.

### `dopple-deploy`

Deploy activities to Dopple Studio from the command line. Wraps the `dopple` CLI (bundled) which handles: build, smoke-test (headless Chromium), ZIP, and upload to Supabase via a two-phase edge function. Optionally posts deploy notifications to Slack via MCP.

**Setup:**
```bash
cd dopple-deploy/scripts/dopple
npm install && npm run build
```

**Usage** (from a project with `dopple.toml`):
```bash
node <path-to>/dopple-deploy/scripts/dopple/dist/cli.js deploy --no-smoke --token "$DOPPLE_TOKEN"
```

See `dopple-deploy/SKILL.md` for full invocation details and Slack integration.
