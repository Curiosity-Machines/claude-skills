---
name: loop-dev
description: >
  Use when building WebView activities, games, or SDK integrations for the Loop
  hardware device (Qualcomm Panda, Android 14, 800×800px circular display). Covers
  hardware constraints, SDK patterns, build toolchain, design rules, and complete
  type reference. Trigger on: "build a game", "add SDK feature", "build for Loop",
  "WebView activity", motion controls, haptics, BLE multiplayer, IMU, or any work
  targeting the panda device. Always invoke this skill before writing any Loop game code.
---

# Loop Hardware Development Reference

## Install

```bash
# Latest (from main)
curl -sL https://raw.githubusercontent.com/Curiosity-Machines/claude-skills/main/loop-dev/SKILL.md \
  -o ~/.claude/commands/loop-dev.md

# Pinned to a release (replace tag as needed)
curl -sL https://raw.githubusercontent.com/Curiosity-Machines/claude-skills/v0.0.3-alpha/loop-dev/SKILL.md \
  -o ~/.claude/commands/loop-dev.md
```

Or copy to your project's `.claude/commands/loop-dev.md` for project-local use.

**TypeScript types** — copy `references/loop-sdk-dx.d.ts` to your project for full TS support:
```bash
curl -sL https://raw.githubusercontent.com/Curiosity-Machines/claude-skills/main/loop-dev/references/loop-sdk-dx.d.ts \
  -o loop-sdk-dx.d.ts
```

Releases: https://github.com/Curiosity-Machines/claude-skills/releases

## Device & Form Factor

| Property | Value |
|---|---|
| Model | Qualcomm Panda, Android 14 |
| Screen | 800×800px circular, 320 DPI |
| Physical form | Round display + handle — like a magnifying glass |
| Serial | Dynamic — always run `adb devices` |

The Loop is **not a phone on a stick**. It has a round display, a handle, and physical buttons on the front and rear of the handle. Design for it accordingly.

**Physical button layout:**
- **A** — front of handle (right-click semantics: "what can this do?", show options/info)
- **B** — rear of handle (left-click / trigger semantics: "do this", commit action)
- **C** — top/side — NATIVE ONLY (tap=sleep, hold=settings panel)

**Display:**
- Auto-leveling: content stays parallel with the ground plane regardless of how the user holds it. The round screen has no preferred orientation. Apps can disable auto-level.
- Treat the screen as a **porthole** into a larger canvas. Size the virtual canvas larger than 800px and use the IMU to pan — this creates the "looking through" effect rather than "looking at" a phone screen.

## Coordinate Space

Use DPR 1: `<meta name="viewport" content="width=800">`.
CSS pixels = physical pixels = 800×800. Circular clip — corners are invisible.

## 320 DPI Sizing Rules

| Element | Minimum |
|---|---|
| Tap target | 140px diameter |
| Body / label text | 28px |
| Section titles | 34–36px |
| Hero / readout values | 72–140px |
| Icon glyphs | 44px |

## HCI Philosophy

**Movement is the interface.** Interactions should begin with the body, not the finger. Touching and swiping at "pictures under glass" is discouraged. Prefer whole-device gestures, IMU-driven navigation, and physical movement.

**Three UX patterns (least → most body engagement):**
1. **Pictures under glass** — fingertips only, phone-style. Avoid.
2. **Diegetic/mimetic** — marbles or bubbles inside a vessel. Good.
3. **3DoF spatial computing** — IMU as d-pad, reticle + buttons as mouse. Best.

**Reticle + buttons pattern** (core navigation):
- Reticle is always at center of display
- User aims device at things; IMU controls the "cursor"
- A (front) = "what can this do?" — reveal options, context
- B (rear) = "do this" — commit / trigger action
- Long-press A = zoom out; Long-press B = zoom in

**Anti-patterns to avoid:**
- Designing as if it were a phone (no spatial awareness)
- Requiring precise finger taps as primary interaction
- Content that begins and ends on the device (ideal activities interact with the physical world)

## Hardware Buttons (SDK / Game Context)

In `GAME` context (WebView activities), ButtonRouter maps:

| Button | Game context | Notes |
|---|---|---|
| A | Confirm / action | Reaches JS as press/release events |
| B | Settings overlay / cycle sections | In hub: cycle next section |
| C | **NEVER reaches JS** | Tap=sleep, Hold=native settings panel — consumed natively always |

```js
Loop.buttons.on('A', e => { if (e.state === 'down') doAction(); });
// C events will never fire — do not show C as interactive in game UI
```

## Loop-Ready Gate

```js
let started = false;
function init() { if (started) return; started = true; /* setup */ }
window.addEventListener('loop:ready', init);
setTimeout(init, 500); // browser testing fallback
```

## SDK Availability Gotchas

**`Loop.isAvailable()` is not a namespace availability check.** It returns `true` if ANY single namespace is defined. Individual namespaces can still be `undefined`.

```js
// WRONG — isAvailable() can be true even if Loop.buttons is undefined
if (Loop.isAvailable()) { Loop.buttons.on('press', handler); }  // may throw

// CORRECT — check the namespace you actually need
if (Loop.buttons) { Loop.buttons.on('press', handler); }
if (Loop.motion)  { Loop.motion.start({ frequency: 60, smoothing: 0.1 }); }
```

**Namespace listeners are lazy-initialized.** The first call to `.on()` registers a single global window event listener internally. No explicit subscribe/init is needed before calling `.on()`.

**`loop:ready` fires after all native bridge objects are injected.** Waiting for `loop:ready` before calling any SDK method guarantees a consistent state.

## SDK Type Reference

Source of truth: `sdk/loop-sdk-dx.d.ts` (v1.3.0). Full types below.

```ts
// ── Core ─────────────────────────────────────────────────────────────────
interface Vector3    { x: number; y: number; z: number; }
interface Quaternion { x: number; y: number; z: number; w: number; }

// ── Motion ───────────────────────────────────────────────────────────────
interface MotionOptions {
  frequency?: number;   // Hz, 1–240 (default 60)
  smoothing?: number;   // 0.0=max smooth, 1.0=raw (default 0.1)
}
interface MotionData {
  gravity: Vector3; smoothGravity: Vector3; orientation: Quaternion;
  delta: Vector3; timestamp: number; sequenceNumber: number;
}
interface MotionStatus {
  active: boolean; subscriptions: number;
  frequencyHz: number; smoothingAlpha: number; paused: boolean;
}
interface MotionSubscription {
  readonly id: string; readonly active: boolean;
  on(event: 'data', handler: (data: MotionData) => void): this;
  off(event: 'data', handler: (data: MotionData) => void): this;
  stop(): void;
}
interface MotionAPI {
  isSupported(): boolean;
  start(options?: MotionOptions): Promise<MotionSubscription>;
  setFrequency(hz: number): MotionAPI;      // chainable
  setSmoothingAlpha(alpha: number): MotionAPI;  // chainable
  getStatus(): MotionStatus;
  getLatest(): MotionData | null;
  stopAll(): void;
}

// ── Buttons ──────────────────────────────────────────────────────────────
type ButtonId        = 'A' | 'B' | 'C';
type ButtonState     = 'down' | 'up';
type ButtonEventType = 'press' | 'release' | 'A' | 'B' | 'C';
interface ButtonEvent { button: ButtonId; state: ButtonState; timestamp: number; sequenceNumber: number; }
interface ButtonsAPI  { on(event: ButtonEventType, handler: (e: ButtonEvent) => void): void; off(event: ButtonEventType, handler: (e: ButtonEvent) => void): void; }

// ── Haptics ──────────────────────────────────────────────────────────────
interface HapticCurve   { keys: { time: number; value: number; }[]; strength?: number; }
interface HapticsResult { success: boolean; error?: string; durationMs?: number; }
interface HapticsAPI {
  isSupported(): boolean;
  getStatus(): { available: boolean; hasAmplitudeSupport: boolean; };
  pulse(intensity?: number): HapticsResult;        // 0.0–1.0
  playCurve(curve: HapticCurve): HapticsResult;
  stop(): HapticsResult;
}

// ── Match (object recognition) ───────────────────────────────────────────
interface MatchAPI {
  getStatus(): { ready: boolean; status: string; };
  isBusy(): boolean;
  captureFrame(videoElement?: HTMLVideoElement): Promise<{ item: unknown; distance: number; }>;
}

// ── Pack (asset bundles) ─────────────────────────────────────────────────
interface PackAPI {
  getStatus(): { ready: boolean; state: number; };
  getAsset(packName: string, path: string): Promise<ArrayBuffer>;
  getModelUrl(itemId: string): Promise<string>;
  assetExists(packName: string, path: string): boolean;
  clearCache(): void;
  getCacheSize(): number;
}

// ── BLE (multiplayer) ────────────────────────────────────────────────────
type BLEConnectionState = 'idle' | 'negotiating' | 'hosting' | 'scanning' | 'connecting' | 'connected' | 'reconnecting';
type BLEEventType = 'message' | 'playerJoined' | 'playerLeft' | 'connected' | 'disconnected' | 'reconnecting' | 'roleResolved';
interface BLEPlayerInfo { id: string; name: string; }
interface BLEAPI {
  createGame(gameId: string, token?: string): string;  // sync, returns token
  joinGame(hostToken: string, playerName?: string): Promise<BLEPlayerInfo>;
  playGame(seed: string, playerName?: string, options?: { timeoutMs?: number }): Promise<{ role: string; token: string }>;
  getState(): BLEConnectionState;
  endGame(): void; leaveGame(): void;
  send(data: unknown, options?: { to?: string }): void;
  on(event: 'message',     handler: (e: { data: unknown; from: BLEPlayerInfo }) => void): void;
  on(event: 'playerJoined' | 'playerLeft', handler: (e: { player: BLEPlayerInfo }) => void): void;
  on(event: 'connected',   handler: (e: { host: BLEPlayerInfo }) => void): void;
  on(event: 'disconnected', handler: (e: { reason: string }) => void): void;
  on(event: 'roleResolved', handler: (e: { role: string; token: string }) => void): void;
  on(event: 'reconnecting', handler: () => void): void;
  off(event: BLEEventType, handler: Function): void;
}

// ── System ───────────────────────────────────────────────────────────────
interface SystemAPI {
  isFreeRotateEnabled(): boolean;
  setFreeRotate(enabled: boolean): { success: boolean };
  on(event: 'pause',  handler: (e: { reason: 'sleep' | 'settings' }) => void): void;
  on(event: 'resume', handler: (e: { reason: string; pausedMs: number }) => void): void;
  off(event: 'pause' | 'resume', handler: Function): void;
}

// ── Root SDK ─────────────────────────────────────────────────────────────
interface LoopSDK {
  isAvailable(): boolean;
  readonly version: string;
  readonly motion: MotionAPI;   readonly buttons: ButtonsAPI;
  readonly haptics: HapticsAPI; readonly match: MatchAPI;
  readonly pack: PackAPI;       readonly ble: BLEAPI;
  readonly system: SystemAPI;
}
declare const Loop: LoopSDK;

// ── Custom Window Events (low-level, prefer SDK API) ─────────────────────
// 'loop:ready'        → { version: string }
// 'loop:motion'       → MotionData
// 'loop:button'       → ButtonEvent
// 'loop:pause'        → { reason: 'sleep' | 'settings' }
// 'loop:resume'       → { reason: string; pausedMs: number }
// 'loop:ble:message'  → { data, from: BLEPlayerInfo }
// 'loop:ble:playerJoined' / 'loop:ble:playerLeft' → { player: BLEPlayerInfo }
// 'loop:ble:connected' → { host: BLEPlayerInfo }
// 'loop:ble:disconnected' → { reason: string }
// 'loop:ble:roleResolved' → { role, token }
```

## SDK Patterns

### Motion — async subscription

```js
const sub = await Loop.motion.start({ frequency: 60, smoothing: 0.1 });
sub.on('data', data => {
  // data.orientation: Quaternion { x, y, z, w }  — from gyro + gravity correction
  // data.smoothGravity: Vector3 { x, y, z }       — low-pass filtered gravity
  // data.delta: Vector3                            — frame-to-frame change
  // data.sequenceNumber: number
});
sub.stop(); // when done; or Loop.motion.stopAll()
```

### Buttons

```js
Loop.buttons.on('press',   e => { /* e.button 'A'|'B'|'C', e.state 'down' */ });
Loop.buttons.on('release', e => { /* e.state 'up' */ });
Loop.buttons.on('A', e => { /* fires on A press/release only */ });
```

### Haptics

```js
Loop.haptics.pulse(0.8);   // quick pulse at 80% intensity

Loop.haptics.playCurve({
  keys: [
    { time: 0.0, value: 0.0 },
    { time: 0.1, value: 1.0 },
    { time: 1.0, value: 0.0 },
  ],
  strength: 0.8,  // optional overall multiplier
});
```

### BLE Multiplayer

```js
// Host — returns token string synchronously; display it for the joiner
const token = Loop.ble.createGame('my-game');

// Join
await Loop.ble.joinGame(token, 'PlayerName');

// Symmetric role resolution (both devices call this, SDK negotiates)
const { role, token: myToken } = await Loop.ble.playGame('seed-string', 'PlayerName');

// Events
Loop.ble.on('message',      e => { /* e.data, e.from.id */ });
Loop.ble.on('playerJoined', e => { /* e.player */ });
Loop.ble.on('playerLeft',   e => { /* e.player */ });
Loop.ble.on('connected',    e => { /* e.host */ });
Loop.ble.on('disconnected', e => { /* e.reason */ });
Loop.ble.on('roleResolved', e => { /* e.role, e.token */ });
```

### System lifecycle

```js
Loop.system.on('pause',  e => { /* e.reason: 'sleep' | 'settings' */ });
Loop.system.on('resume', e => { /* e.reason, e.pausedMs */ });
```

### Display rotation (free rotate)

```js
// Query whether display auto-rotation is enabled
const rotating = Loop.system.isFreeRotateEnabled();

// Lock rotation for a game that needs fixed orientation
const result = Loop.system.setFreeRotate(false);
if (result.success) {
  console.log('Rotation locked');
}

// Re-enable (or just let native restore — game exit auto-restores)
Loop.system.setFreeRotate(true);
```

**Native auto-restore:** The native layer saves rotation state when a game opens and restores it on game exit. Games don't need to clean up. The settings overlay also saves/restores independently — opening settings disables rotation, closing it restores the pre-settings state.

## Rim Swipe Gesture

Touch zone: r >= 320px from center (400, 400). Gestures inside r < 320px are ignored.

```js
const CX = 400, CY = 400, RIM_R = 320, MIN_ARC = 30;
let rim = null;
el.addEventListener('touchstart', e => {
  const t = e.touches[0], dx = t.clientX-CX, dy = t.clientY-CY;
  if (Math.sqrt(dx*dx+dy*dy) >= RIM_R) {
    rim = { lastAngle: Math.atan2(dy,dx), arc: 0 };
    e.preventDefault();
  }
}, { passive: false });
el.addEventListener('touchmove', e => {
  if (!rim) return;
  const t = e.touches[0], dx = t.clientX-CX, dy = t.clientY-CY;
  const a = Math.atan2(dy,dx);
  let d = a - rim.lastAngle;
  if (d > Math.PI) d -= 2*Math.PI;
  if (d < -Math.PI) d += 2*Math.PI;
  rim.arc += d * Math.sqrt(dx*dx+dy*dy);
  rim.lastAngle = a;
  e.preventDefault();
}, { passive: false });
el.addEventListener('touchend', () => {
  if (rim) { if (rim.arc>MIN_ARC) onCW(); else if (rim.arc<-MIN_ARC) onCCW(); rim=null; }
});
```

## Build + Deploy

```bash
# Build
./gradlew assembleDebug

# Install
SERIAL=$(adb devices | awk 'NR==2{print $1}')
adb -s $SERIAL install -r app/build/outputs/apk/debug/*.apk

# Launch (gallery)
adb -s $SERIAL shell am start -n com.dopple.webview/.MainActivity

# Launch a specific game directly
adb -s $SERIAL shell am start \
  -a android.intent.action.VIEW \
  -d "dopple://launch?manifest=http://127.0.0.1:8088/games/<name>/manifest.json"

# Screenshot
adb -s $SERIAL shell screencap -p /sdcard/screen.png
adb -s $SERIAL pull /sdcard/screen.png ./screen.png
```

## Debug: CDP / WebView DevTools

Evaluate JS in the running WebView — useful for SDK verification, live state inspection, and rapid iteration without rebuilding.

```bash
# 1. Find the WebView devtools socket (shows PID in path)
adb -s $SERIAL shell cat /proc/net/unix | grep webview_devtools

# 2. Forward to localhost (replace <PID> with process ID from above)
adb -s $SERIAL forward tcp:9222 localabstract:webview_devtools_remote_<PID>

# 3. List open WebView targets (get the webSocketDebuggerUrl)
curl -s http://localhost:9222/json | python3 -m json.tool

# 4a. Interactive: open chrome://inspect in Chrome
# 4b. Scripted: use wscat or a CDP client
wscat -c ws://localhost:9222/devtools/page/<TARGET_ID>
```

**Useful CDP eval commands:**
```js
Loop.isAvailable()         // → true
Loop.version               // → "1.3.0"
Loop.motion.getStatus()    // → { active, subscriptions, frequencyHz, smoothingAlpha, paused }
Loop.haptics.getStatus()   // → { available, hasAmplitudeSupport }
Loop.ble.getState()        // → "idle"
Loop.pack.getStatus()      // → { ready, state }
Loop.buttons               // → ButtonsAPI object (check truthy)
Loop.system.isFreeRotateEnabled() // → true/false
```

**One-liner CDP eval via curl + wscat:**
```bash
# Install wscat: npm install -g wscat
WS=$(curl -s http://localhost:9222/json | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['webSocketDebuggerUrl'])")
echo '{"id":1,"method":"Runtime.evaluate","params":{"expression":"Loop.version"}}' | wscat -c "$WS" --no-color
```

## Game File Structure

```
app/src/main/assets/games/<name>/
  index.html      # self-contained, no build step required
  manifest.json
```

manifest.json:
```json
{ "projectId": "my-game", "activityName": "My Game",
  "url": "http://127.0.0.1:8088/games/my-game/index.html" }
```

## Design Rules

- Circular canvas — radial layouts feel native
- All text >= 28px — 320 DPI makes smaller text hard to read at arm's length
- Haptic on every meaningful interaction
- Dark background #080812 (OLED-friendly)
- Primary accent: #00d4ff (cyan)
- Minimum tap target: 140px diameter
- Pre-render HTML; update DOM via textContent/classList/style only
