---
description: >
  Use when building WebView activities, games, or SDK integrations for the Loop
  hardware device. Encodes all hardware constraints, SDK patterns, build toolchain,
  and design rules so they don't need to be rediscovered each session. Trigger on:
  "build a game", "add SDK feature", "build for Loop", "WebView activity", or any
  work targeting the panda device.

install: >
  To install this skill in Claude Code, copy this file to your project's
  .claude/commands/loop-dev.md or to ~/.claude/commands/loop-dev.md for
  global use. In Claude Code CLI: /loop-dev will invoke it.

  Quick install (global):
    curl -sL https://gist.githubusercontent.com/michaelatdopple/4ff90dd0aac5c03217fba861987d6c0b/raw/loop-dev.md \
      -o ~/.claude/commands/loop-dev.md
---

# Loop Hardware Development Reference

## Device & Form Factor

| Property | Value |
|---|---|
| Model | Qualcomm Panda, Android 14 |
| Screen | 800×800px circular, 320 DPI |
| Physical form | Round display + handle — like a magnifying glass |
| Serial | Dynamic — always run `droid devices` |

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

**`loop:ready` fires after all native bridge objects are injected.** If you wait for `loop:ready` before calling any SDK method you will always have a consistent state.

## SDK Type Reference

Source: `sdk/loop-sdk-dx.d.ts` — authoritative. Condensed below for quick reference.

```ts
// Core types
interface Vector3    { x: number; y: number; z: number; }
interface Quaternion { x: number; y: number; z: number; w: number; }

// Motion
interface MotionData {
  gravity: Vector3; smoothGravity: Vector3; orientation: Quaternion;
  delta: Vector3; timestamp: number; sequenceNumber: number;
}
interface MotionSubscription {
  on(event: 'data', handler: (data: MotionData) => void): this;
  stop(): void;
}
interface MotionAPI {
  isSupported(): boolean;
  start(options?: { frequency?: number; smoothing?: number }): Promise<MotionSubscription>;
  getStatus(): { active: boolean; frequencyHz: number; smoothingAlpha: number };
  getLatest(): MotionData | null;
  stopAll(): void;
}

// Buttons
type ButtonId    = 'A' | 'B' | 'C';
type ButtonState = 'down' | 'up';
// ButtonEventType: 'press' | 'release' | 'A' | 'B' | 'C'
interface ButtonEvent { button: ButtonId; state: ButtonState; timestamp: number; sequenceNumber: number; }
interface ButtonsAPI  { on(event: string, handler: (e: ButtonEvent) => void): void; off(...): void; }

// Haptics
interface HapticsAPI {
  getStatus(): { available: boolean; hasAmplitudeSupport: boolean; };
  pulse(intensity?: number): { success: boolean; durationMs?: number; };
  playCurve(curve: { keys: { time: number; value: number; }[] }): { success: boolean; };
  stop(): { success: boolean; };
}

// BLE
type BLEConnectionState = 'idle' | 'negotiating' | 'hosting' | 'scanning' | 'connecting' | 'connected' | 'reconnecting';
interface BLEAPI {
  createGame(gameId: string, token?: string): string;   // sync, returns token
  joinGame(hostToken: string, playerName?: string): Promise<{ id: string; name: string; }>;
  playGame(seed: string, playerName?: string, options?: { timeoutMs?: number }): Promise<{ role: string; token: string }>;
  getState(): BLEConnectionState;
  endGame(): void; leaveGame(): void;
  send(data: unknown, options?: { to?: string }): void;
  on(event: string, handler: Function): void;
  off(event: string, handler: Function): void;
}

// System
interface SystemAPI {
  on(event: 'pause',  handler: (e: { reason: 'sleep' | 'settings' }) => void): void;
  on(event: 'resume', handler: (e: { reason: string; pausedMs: number }) => void): void;
}

// Pack
interface PackAPI {
  getStatus(): { ready: boolean; state: number; };
  getAsset(packName: string, path: string): Promise<ArrayBuffer>;
  assetExists(packName: string, path: string): boolean;
  getCacheSize(): number;
}

// Root
interface LoopSDK {
  isAvailable(): boolean;
  readonly version: string;
  readonly motion: MotionAPI; readonly buttons: ButtonsAPI; readonly haptics: HapticsAPI;
  readonly match: MatchAPI;   readonly pack: PackAPI;     readonly ble: BLEAPI;
  readonly system: SystemAPI;
}
declare const Loop: LoopSDK;
```

## SDK Patterns

### Motion — async subscription

```js
const sub = await Loop.motion.start({ frequency: 60, smoothing: 0.1 });
sub.on('data', data => {
  // data.orientation: Quaternion { x, y, z, w }  — from gyro + gravity correction
  // data.smoothGravity: Vector3 { x, y, z }
  // data.sequenceNumber: number
});
sub.stop(); // when done
```

### Buttons

```js
Loop.buttons.on('press',   e => { /* e.button 'A'|'B'|'C', e.state 'down' */ });
Loop.buttons.on('release', e => { /* e.state 'up' */ });
```

### Haptics

```js
Loop.haptics.pulse(0.8);                  // 0.0–1.0

Loop.haptics.playCurve({
  keys: [
    { time: 0.0, value: 0.0 },
    { time: 0.1, value: 1.0 },
    { time: 1.0, value: 0.0 },
  ]
});
```

### BLE

```js
// Host — returns token string synchronously; display it for the joiner
const token = Loop.ble.createGame('my-game');

// Join
await Loop.ble.joinGame(token, 'PlayerName');

// Events
Loop.ble.on('message',      e => { /* e.data, e.from */ });
Loop.ble.on('playerJoined', e => { /* e.player */ });
Loop.ble.on('connected',    e => { /* e.host */ });
Loop.ble.on('disconnected', e => { /* e.reason */ });
```

### System lifecycle

```js
Loop.system.on('pause',  e => { /* e.reason: 'sleep' | 'settings' */ });
Loop.system.on('resume', e => { /* e.reason, e.pausedMs */ });
```

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
# Build (orbital delegates to gradle on host — no local Android SDK needed)
orbital build /home/claude/gt/native_webview/crew/babbage assembleDebug --sign aosp

# Install
SERIAL=$(adb devices | awk 'NR==2{print $1}')
adb -s $SERIAL install -r build/outputs/apk/debug/*.apk

# Launch (gallery)
droid start-activity --component com.dopple.webview/.MainActivity

# Launch a specific game directly
droid start-activity --action android.intent.action.VIEW \
  --data "dopple://launch?manifest=http://127.0.0.1:8088/games/<name>/manifest.json"

# Verify SDK via WebView DevTools (CDP over adb)
# Find the WebView devtools socket:
SERIAL=$(adb devices | awk 'NR==2{print $1}')
adb -s $SERIAL shell cat /proc/net/unix | grep webview_devtools
# Forward it to localhost:
adb -s $SERIAL forward tcp:9222 localabstract:webview_devtools_remote_<PID>
# Then run JS via the CDP /json endpoint + WebSocket, or use a helper:
curl -s http://localhost:9222/json | python3 -m json.tool   # list targets
# To evaluate JS (requires a CDP WebSocket client — use chrome://inspect on host, or curl+wscat):
#   Loop.isAvailable()       → true
#   Loop.version             → "1.3.0"
#   Loop.motion.getStatus()  → { active, frequencyHz, smoothingAlpha, ... }
#   Loop.haptics.getStatus() → { available, hasAmplitudeSupport }
#   Loop.ble.getState()      → "idle"
#   Loop.pack.getStatus()    → { ready, state }

# Screenshot
droid capture
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
