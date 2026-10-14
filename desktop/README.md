# Build-a-bot for your computer

A small tray / menu-bar app. When a call starts (Zoom, Google Meet, Teams, Webex, Slack, Discord, WhatsApp, or a call in your browser), your bot peeks up from the very bottom of the screen and asks: **"Want me to take notes?"** Say yes and it stays there the whole time it listens, with a red dot, a timer, a level meter and the latest line it heard. When the call ends, it writes your notes (summary, decisions, action items) and tells you they're ready.

It's the desktop half of Meeting notes in the web app (`src/lib/meetings`, `/desktop/buddy`). Electron 44.7.2, plain JavaScript (ESM main process, sandboxed CommonJS preloads), no runtime dependencies.

## What it does

1. **Pairs with your account** using the same pairing codes as the Bridge: open Build-a-bot → **Bridge (your computer)** → Desktop app, and type the code into the app. The device token is stored with your system keychain (Electron `safeStorage`).
2. **Notices calls.** Every few seconds it asks the operating system which app has the microphone open (only who, never what's said). A meeting app has to hold the mic for 5 seconds (15 for a browser) before it counts.
3. **Asks first, every time.** The bot pops up at the bottom-center of the screen with *Take notes*, *Not now*, *Don't ask in Zoom* and *Copy a heads-up* (a message for the call chat: "Heads-up: I'm using my AI assistant Inky to take notes on this call…"). No answer in 15 seconds counts as *Not now*. After *Not now* it won't ask again during that call, or for 5 minutes.
4. **Takes notes** after a yes: your microphone ("You") and the call's audio ("Others") are recorded as two tracks, cut into short standalone chunks and uploaded as it goes. Hover over the bot for **Pause**, **Stop** and **Stop and delete** (for when someone on the call objects).
5. **Stops** when you click Stop, when the call ends (the app lets go of the mic for 15 seconds), after 15 minutes of silence, at 4 hours, when your screen locks or the computer sleeps, or if the bot can't stay on screen.
6. **Tells you when the notes are ready**, at the bottom of the screen and with a notification that opens the meeting in your browser.

The tray menu has: status, Take notes now, Stop, Pause call detection for 1 hour, Show live captions, which bot takes notes, apps it won't ask in, Open Build-a-bot, This computer…, Start at login, Quit.

## What it never does

- **Never records without a yes.** There is no auto-record setting. Nothing is captured before you tap *Take notes* (or *Take notes now* in the menu); the capture window doesn't even exist until then.
- **Never records out of sight.** Capture starts only after the bot is on screen. Every second (and on window events) it checks the bot is visible, not minimized and on a screen; if it can't put it back, it stops and finishes the meeting. It also stops on screen lock, sleep and quit. The bot is never hidden from screen sharing (no content protection), so people on the call can see it too.
- **Never keeps audio.** Audio goes from memory straight to the server, which turns it into text and throws it away. The only place audio ever touches this computer's disk is a small upload spool, used only while uploads are failing (or when you quit mid-upload), and each file is deleted the moment it's uploaded. *Stop and delete* deletes everything captured so far, on this computer and on the server.
- **Never shares your token.** It lives in the main process only: encrypted at rest, never logged (logs scrub it as a backstop), never put in a URL, never given to a web page. The bot at the bottom of the screen is a web page from the server, but it only gets four functions (`onState`, `act`, `setInteractive`, `copy`). It can't navigate elsewhere, open windows or use the mic.
- **No analytics.** Logs stay on this computer (`<userData>/logs/main.log`).
- **No FaceTime or phone calls** in this version: macOS doesn't let apps record FaceTime, and phone calls bring stricter consent laws (research §3.2, §5.5).

## Permissions, per OS

| | What it asks for | Why | If you say no |
|---|---|---|---|
| **macOS** | **Microphone** (asked the first time you take notes) | your side of the call | it can't take notes, and says how to fix it |
| | **Screen & System Audio Recording** (asked the first time you take notes) | the other people on the call. Electron's system-audio loopback uses Core Audio taps on macOS 14.2+ and needs a screen source too | it keeps going on your mic only and says so above the bot ("I can only hear your mic…") |
| | **Automation** for Chrome/Safari (only if you turn on *Recognize Meet and Teams in browser tabs*) | to tell a Google Meet tab from any other use of the mic in a browser | calls in a browser are just "a call in your browser" |
| **Windows** | Settings › Privacy › Microphone › *Let desktop apps access your microphone* must be on | your side of the call | it can't take notes, and opens that settings page |
| | nothing for the call's audio | system-audio loopback needs no prompt on Windows | |
| **Linux** | nothing; needs PulseAudio or PipeWire (`pactl`, from `pulseaudio-utils`) | call detection reads PulseAudio "source outputs" | the tray says "Can't notice calls"; *Take notes now* still works |

Detection needs no permission on any OS. The app reads only which program has the microphone open, never audio.

## How call detection works

| | Signal | Notes |
|---|---|---|
| macOS | The Swift helper `native/macos` lists Core Audio's process objects (macOS 14+: `kAudioHardwarePropertyProcessObjectList` → `IsRunningInput`, PID, bundle ID) and the app's on-screen window, so the bot appears on the display the call is on | No permission. Without the helper (or on macOS 13) it falls back to Zoom's in-meeting process (`CptHost`) and, if you allow it, meeting tabs via AppleScript; the tray says detection is limited |
| Windows | The privacy ConsentStore: `HKCU\…\CapabilityAccessManager\ConsentStore\microphone` (`LastUsedTimeStop == 0` means in use), checked against running processes because values can stick; browser window titles name Meet/Teams calls | `reg query` and `tasklist`, no native code. **TODO:** a small WASAPI helper (`IAudioSessionManager2` → active capture sessions → `GetProcessId`) is the better long-term signal (research §2.3, §6.1) |
| Linux | `pactl --format=json list source-outputs` (text format on older pactl), skipping corked streams and level meters | |

Rules everywhere: meeting apps only (allowlist in `src/main/detect/catalog.mjs`), our own processes ignored, 2 checks in a row and 5 s (browsers 15 s) to start, 15 s without the mic to end. Each OS's parsing is a pure function with tests on real-looking output (`test/fixtures`).

## System audio

Electron 44's `session.setDisplayMediaRequestHandler` grants `{ video: <screen>, audio: 'loopback' }` to the hidden capture page; the page drops the video track at once. Never `loopbackWithMute` (it would mute the call for you). `restrictOwnAudio` keeps the app's own sounds out.

- **Windows:** works.
- **macOS 14.2+:** works through Core Audio taps (needs `NSAudioCaptureUsageDescription`, set in `electron-builder.yml`). If permission is missing, macOS hands over an audio track that's already ended, with no error. The app checks for that and goes mic-only with a message.
- **Linux:** needs Chromium's `PulseaudioLoopbackForScreenShare` feature, which the app turns on. Mic-only is acceptable here.
- **Recommended for macOS (not wired up yet):** `bab-audio-helper tap` in the Swift helper captures the call's audio with a Core Audio tap that needs only the system-audio permission (not Screen Recording, which macOS 15 re-asks about monthly). Next step: spawn it from `capture-window.mjs`, pipe its 16 kHz PCM into the capture page through an AudioWorklet, and record that as the "system" track.

## Run it

```sh
cd desktop
npm install          # Electron 44.7.2 (its binary downloads on first use; `npx install-electron` fetches it now)
npm start            # pairs with https://build-a-bot.site
```

Against a local server (the web app's `npm run dev`):

```sh
npm run dev          # same as: npx electron . --server=http://localhost:3000
```

The pairing window also has a **Server** field (plain `http://` is allowed only for `localhost`). In the web app, open **Bridge (your computer)** to get a code, and turn on **Meeting notes** in your bot's apps.

Running as root (CI containers) needs `--no-sandbox`: `npx electron --no-sandbox .`

### Switches for development and tests

| | |
|---|---|
| `--server=<url>` or `BAB_SERVER` | server to pair with |
| `BAB_USER_DATA=<dir>` | a separate settings folder |
| `BAB_FAKE_MEETING=zoom` | pretend a Zoom call is going on |
| `BAB_FAKE_MEETING_FILE=<path>` | a call is going on while this file names an app (`zoom`, `meet`, …); re-read on every check, so a test can start and end calls |
| `BAB_FAKE_MEDIA=1` | Chromium's fake mic (same as `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`) |
| `BAB_ALLOW_PLAINTEXT_TOKEN=1` | **testing only**: on a machine with no keychain (Linux CI), store the device token unencrypted. Without it, such a machine keeps the token in memory only and you pair again after quitting |
| `BAB_SYSTEM_AUDIO=off` | mic only |
| `BAB_TEST_DENY_SYSTEM_AUDIO=1` | behave like a computer that refuses system audio (tests the mic-only path) |
| `BAB_DETECT_INTERVAL_MS`, `BAB_DETECT_SUSTAIN_MS`, `BAB_CALL_END_GRACE_MS`, `BAB_ASK_TIMEOUT_MS`, `BAB_NOT_NOW_COOLDOWN_MS`, `BAB_SILENCE_STOP_MS`, `BAB_SLOW_NOTES_MS` | shorter timings for tests |
| `BAB_TEST=1` | a read-only state probe for the e2e test (never includes the token) |

## Tests

```sh
npm test             # unit tests (node --test): detectors per OS, the call state machine,
                     # the controller's safety rules, the upload queue, placement, token storage, tray menu
npm run test:e2e     # end to end under Xvfb with Playwright's Electron driver
```

The e2e test needs the web app's dev server running in demo mode at http://localhost:3000 (`BAB_E2E_SERVER` to change it), `xvfb-run`, and Playwright (it uses the web app's `node_modules/playwright`; outside this repo, `npm i -D playwright`). It creates a demo owner and bot, turns on Meeting notes, gets a pairing code, pairs through the pairing window, fakes calls and the mic, then clicks through the bot: ask → copy the heads-up → Take notes → live captions → pause → resume → stop → notes ready (checked through the API), then *Stop and delete* (the meeting is gone from the server), *Not now*, a call that ends on its own, and a second launch where system audio is refused (mic-only, with the message). Screenshots of each phase go to `BAB_E2E_SHOTS` (default `<tmp>/bab-desktop-e2e`), plus a `sheet.png` of the bot over a fake call.

Not testable here: real call detection on macOS and Windows (the parsers are unit-tested on captured-style output), the Swift helper (it needs a Mac to build), real system-audio permissions, notifications and tray clicks.

## Packaging and signing

`electron-builder.yml` is ready; installers aren't built in this repo. On each OS:

```sh
bash native/macos/build.sh   # macOS only: the helper (Xcode 15.4+), copied into Resources/bin
npm run dist                 # npx electron-builder@26 --config electron-builder.yml
```

- **macOS:** a hardened-runtime, Developer ID–signed, notarized `.dmg`/`.zip` (`notarize: true`; set `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, and `CSC_LINK`/`CSC_KEY_PASSWORD` for the certificate; the Apple Developer Program is 99 USD a year). `LSUIElement` keeps it out of the Dock. `NSMicrophoneUsageDescription` and `NSAudioCaptureUsageDescription` must be in the **main app's** Info.plist (macOS asks on behalf of the app responsible for the process). Entitlements: `build/entitlements.mac.plist` (JIT for Electron, audio input, Apple Events). Sign the helper with the same identity (`BAB_CODESIGN_IDENTITY=… bash native/macos/build.sh`).
- **Windows:** an NSIS per-user installer. Sign it (a code-signing certificate via `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`, or Azure Trusted Signing with `azureSignOptions`); unsigned builds trip SmartScreen. Notifications use the app ID `site.build-a-bot.desktop`.
- **Linux:** AppImage and `.deb` (the `.deb` depends on `pulseaudio-utils` or `pipewire-pulse` for `pactl`).
- Icons: `npm run icons` renders `assets/tray/*` (template images for the macOS menu bar, colored ones for Windows/Linux), `assets/icon.png` and `build/icon.png` from the SVGs in `assets/svg` with Playwright.

## Layout

```
src/main/main.mjs            app lifecycle, IPC, tray actions, links, notifications
src/main/controller.mjs      runs the call state machine; safety checks every second
src/main/call-machine.mjs    the state machine (pure): idle → asking → listening ⇄ paused → saving → done
src/main/detect/             per-OS call detection (pure parsers + the polling loop + debounce)
src/main/buddy-window.mjs    the bot at the bottom of the screen (transparent, click-through)
src/main/capture-window.mjs  hidden window: mic + system audio, 2 MediaRecorders
src/main/upload-queue.mjs    uploads with retries; spool.mjs keeps chunks only while offline
src/main/account.mjs, api.mjs, store.mjs   pairing, the server API, settings and the encrypted token
src/main/pairing-window.mjs  the local pairing window (bab-app://pairing)
src/preload/*.cjs            sandboxed preloads (buddy: window.babDesktop, exactly desktop-api.ts)
src/renderer/                the app's own pages (pairing, capture)
native/macos/                Swift helper (mic use per app; Core Audio tap) and its build script
```

On Linux, where click-through can't forward mouse moves to the page, the app hit-tests the cursor against the page's clickable parts itself.
