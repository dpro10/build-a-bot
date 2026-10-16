# Build-a-bot for your computer

A small tray / menu-bar app. When a call starts (Zoom, Google Meet, Teams, Webex, Slack, Discord, WhatsApp, or a call in your browser), your bot peeks up from the very bottom of the screen and asks: **"Want me to take notes?"** Say yes and it stays there the whole time it listens, with a red dot, a timer, a level meter and the latest line it heard. When the call ends, it writes your notes (summary, decisions, action items) and tells you they're ready.

It also does **voice typing**: hold a key in any app, talk, let go, and what you meant is typed where your cursor is, cleaned up (no ums, the right punctuation, your corrections kept) and with your names spelled your way. Start with "Hey" and your bot's name and it asks your bot instead. It hears you **on your computer**, with NVIDIA's Parakeet speech model, so your voice never leaves it. See [Voice typing](#voice-typing).

It's the desktop half of Meeting notes (`src/lib/meetings`, `/desktop/buddy`) and Voice typing (`src/lib/dictation`, `/app/voice`) in the web app. Electron 44.7.2, plain JavaScript (ESM main process, sandboxed CommonJS preloads). One runtime dependency: `uiohook-napi`, the keyboard hook for voice typing, loaded only once you turn voice typing on.

## What it does

1. **Pairs with your account** using the same pairing codes as the Bridge: open Build-a-bot → **Bridge (your computer)** → Desktop app, and type the code into the app. The device token is stored with your system keychain (Electron `safeStorage`).
2. **Notices calls.** Every few seconds it asks the operating system which app has the microphone open (only who, never what's said). A meeting app has to hold the mic for 5 seconds (15 for a browser) before it counts.
3. **Asks first, every time.** The bot pops up at the bottom-center of the screen with *Take notes*, *Not now*, *Don't ask in Zoom* and *Copy a heads-up* (a message for the call chat: "Heads-up: I'm using my AI assistant Inky to take notes on this call…"). No answer in 15 seconds counts as *Not now*. After *Not now* it won't ask again during that call, or for 5 minutes.
4. **Takes notes** after a yes: your microphone ("You") and the call's audio ("Others") are recorded as two tracks, cut into short standalone chunks and uploaded as it goes. Hover over the bot for **Pause**, **Stop** and **Stop and delete** (for when someone on the call objects).
5. **Stops** when you click Stop, when the call ends (the app lets go of the mic for 15 seconds), after 15 minutes of silence, at 4 hours, when your screen locks or the computer sleeps, or if the bot can't stay on screen.
6. **Tells you when the notes are ready**, at the bottom of the screen and with a notification that opens the meeting in your browser.

The tray menu has: status, Take notes now, Stop, Pause call detection for 1 hour, Show live captions, which bot takes notes, apps it won't ask in, voice typing (Set up voice typing… / its status, Paste last dictation, Voice typing settings…), Open Build-a-bot, This computer…, Start at login, Quit.

## What it never does

- **Never records without a yes.** There is no auto-record setting. Nothing is captured before you tap *Take notes* (or *Take notes now* in the menu); the capture window doesn't even exist until then.
- **Never records out of sight.** Capture starts only after the bot is on screen. Every second (and on window events) it checks the bot is visible, not minimized and on a screen; if it can't put it back, it stops and finishes the meeting. It also stops on screen lock, sleep and quit. The bot is never hidden from screen sharing (no content protection), so people on the call can see it too.
- **Never keeps audio.** Audio goes from memory straight to the server, which turns it into text and throws it away. The only place audio ever touches this computer's disk is a small upload spool, used only while uploads are failing (or when you quit mid-upload), and each file is deleted the moment it's uploaded. *Stop and delete* deletes everything captured so far, on this computer and on the server.
- **Never shares your token.** It lives in the main process only: encrypted at rest, never logged (logs scrub it as a backstop), never put in a URL, never given to a web page. The bot at the bottom of the screen is a web page from the server, but it only gets four functions (`onState`, `act`, `setInteractive`, `copy`). It can't navigate elsewhere, open windows or use the mic.
- **Never listens for voice typing unless you hold the key.** The keyboard hook sees key presses only to spot your shortcut; nothing about other keys is kept or logged. The mic opens when you press the shortcut and closes when you let go (or tap it again, hands-free), and the pill on screen shows it the whole time.
- **Never sends your voice, with Private speech on** (the default, once it has downloaded): NVIDIA Parakeet turns it into text on this computer, in memory, and only the words go to the server, once, to be cleaned up. Until then (or with it off) a dictation's audio is sent once, turned into text and thrown away.
- **Never keeps your words on the server.** A dictation is cleaned up and thrown away; the server counts words for your plan, nothing else. Your history of dictations stays on this computer, encrypted with the system keychain (memory only if there's none), 100 at most for 30 days, and you can turn it off or clear it.
- **Never keeps what you select.** Editing by voice sends the selected text once, to make the change you asked for; the server doesn't store it, and the local history keeps only what you said and the result.
- **Never reads your screen.** To fit the words to the app (casual in chats, proper in email), only its kind (`chat`, `email`, `code`…) and, for apps on the built-in list, its name (`Slack`) are sent, worked out on this computer from the front app and, in a browser, the tab's title. Never the window's text, the title itself, what's around your cursor, or the name of an app that isn't on the list.
- **No analytics.** Logs stay on this computer (`<userData>/logs/main.log`). A dictation logs one line with its kind, size and timings (`voice: text (12 words, cleaned up) in 410 + 380 ms, 4.2 s recorded`), never what was said.
- **No FaceTime or phone calls** in this version: macOS doesn't let apps record FaceTime, and phone calls bring stricter consent laws (research §3.2, §5.5).

## Voice typing

Turn it on from the tray (**Set up voice typing…**); it needs a paired computer. Then, in any app:

1. **Hold the shortcut and talk.** A small pill appears at the bottom-center of the screen with a waveform and a timer (above the meeting bot if that's showing). A soft chime marks start and stop (*Sounds* in settings).
2. **Let go.** NVIDIA Parakeet turns it into text on this computer, the words go to `/api/voice/dictate` to be cleaned up, and the clean text is pasted at your cursor; the pill shows what it typed for a moment, marked *private*. Missed where it went? **Paste last dictation** in the tray.
3. **Tap twice** to keep talking hands-free; tap once more (or click *Done* on the pill) to finish. **Esc** while it's listening cancels, and nothing is sent. A recording stops by itself at 10 minutes.
4. **Edit by voice:** select text in any app, hold **Shift** with the shortcut (before it or while holding it), and say what to do: "make this friendlier", "turn it into a list", "translate it to Spanish". The pill turns pink; let go and the selection is replaced (the app's own Undo takes it back, and the pill says so). With nothing selected, it writes what you ask for at the cursor ("write a short thank-you to Sam"). A question about the selection ("is this clear?") is answered in the pill instead. Not in terminals: copying there is Ctrl+C, which stops the running program.
5. **"Hey Otto, …"** (your bot's name, after hey/hi/hello/okay) asks that bot instead of typing. The pill shows what it's doing (*Otto is thinking…*, then each tool it uses), with *Type it instead* in case you meant to dictate, then its answer with **Paste**, **Copy**, **Reply** (talk again to answer it) and **Open chat**. The exchange is in that bot's chat on the web too.
   - **With text selected** (hold Shift too), Otto gets what you selected with the request: "Hey Otto, add this to my calendar", "Hey Otto, remind me about this tomorrow", "Hey Otto, remember this". It's in the chat with the request. Since what you select is often someone else's words (an email, a web page), it counts as outside content: Otto asks before sending anything to someone new because of it. No *Paste* or *Type it instead* then, so nothing types over the selection.

Holding for less than 250 ms is a tap, not a dictation; a shortcut pressed together with other keys (⌥ + a letter, say) is left to the app you're in. Paste waits until you've let go of the shortcut's keys, so ⌥ still down doesn't turn ⌘V into ⌥⌘V.

| | Default shortcut | Also offered | Pastes with |
|---|---|---|---|
| macOS | Right Option (⌥) | Right Command, Control + Option, Right Control, or keys you record | ⌘V, as a key press through the hook |
| Windows | Ctrl + Windows | Right Ctrl, Ctrl + Alt, Right Alt, or keys you record | Ctrl+V, through the hook. When the shortcut includes the Windows key, a harmless F24 tap keeps the Start menu from opening on release |
| Linux (X11) | Right Ctrl | Ctrl + Super, Ctrl + Alt, Right Alt, or keys you record | Ctrl+V (Ctrl+Shift+V in terminals) through XTest: `xdotool` if installed, else `python3` with `libXtst`. The hook's own key presses are synthetic X events many apps ignore |

What was on the clipboard is put back 450 ms after pasting (all its formats, not just text), unless something else changed it in the meantime (*Put my clipboard back* in settings). If it can't paste (no permission yet, or Wayland), the text is left on the clipboard and the pill says so.

**Reading the selection** (`Paster.copySelection`): it puts a marker on the clipboard, presses copy (⌘C, Ctrl+C; XTest on Linux), and reads what replaced the marker; the marker still there means nothing was selected. Then the clipboard goes back exactly as it was, before anything is sent. Code editors copy the whole line when nothing is selected, so there a single line ending in a newline doesn't count as a selection.

**If the hook can't run** (macOS without Accessibility, or a system where the hook fails to start) it falls back to a toggle: press **⌘ Shift Space** (Ctrl + Shift + Space elsewhere) to start and again to stop, and paste yourself. The settings window says why and, on a Mac, opens the Accessibility pane; the app notices the switch and moves to holding without a restart.

### Private speech: NVIDIA Parakeet on this computer

`src/main/voice/local-speech.mjs`. On by default (*Hear me on this computer* in settings), on macOS (Apple silicon on the GPU with Metal, Intel on the CPU), Windows x64 and Linux x64; other computers use the server.

- **Getting it.** The first time voice typing is on, it downloads, in the background: NVIDIA's runtime for this platform, [NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp) 0.2.0 from its GitHub release (about 7 MB), its number rules ("three thirty" → 3:30; not on Windows) and the model, [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), 8-bit, from Hugging Face (714 MB): about 0.7 GB in all, into `<userData>/speech`. Each file is pinned to one version and checked against its SHA-256 before it's used (a file that doesn't match is deleted). A cut-off download picks up where it stopped, and keeps going as long as each try gets further; one that fails tries again on its own half an hour later, or from **Try again** in settings. Downloads go through the app's network stack, so the system's proxy and certificates work. It checks for about 1.1 GB free first.
- **Running it.** `nemo-speech serve` on 127.0.0.1, on a free port, behind a random key passed in its environment (not on its command line), so other programs on the computer can't use it. It starts when you press the shortcut (the model loads while you talk), and right after the first download, and stops after 20 minutes unused, so it isn't in memory all day. A dictation waits at most 15 s for it to load. If the app was force-quit and left one running, the next start stops it (only after checking that process is still the engine). The pill hands over the recording as 16 kHz mono WAV, decoded and resampled by Chromium with a second of silence after it (without it, a clip that stops mid-word loses its last word); it's posted to the engine from memory and never written to disk. A clock time Parakeet writes British-style after "at"/"by"/… ("at 3.30") and the hour's leading zero from the number rules ("03:30") become "3:30".
- **When it can't.** Not downloaded yet, turned off, a language Parakeet doesn't speak (it has English and 24 European languages; Japanese and the rest go to the server), a server too old to take text, or the engine failing: then the recording goes to the server as before, so voice typing never stops working. If the engine stops on its own three times in 10 minutes, or can't be run at all, it's left alone until the app restarts.
- **Removing it.** *Remove it from this computer* in settings stops it and deletes the folder; it downloads again only if you turn it back on.

Measured on a 4-vCPU Linux box with no GPU (`e2e/local-speech.e2e.mjs`): the download checked and unpacked in under 10 s from a local copy; a 3.4 s sentence typed about 1.5 s after letting go, including the cleanup on the server and pasting; Parakeet's own part was 1.2–1.7 s per dictation on that CPU. A Mac's GPU is faster.

### What the server does

`src/lib/dictation`: speech-to-text, unless this computer already did it and sent the words (`{ heard }`) instead of audio (NVIDIA Parakeet on our speech server, `speech/`; Whisper providers get your words and your bots' names as a hint), then guards against the known failures of Whisper-family models (silence that becomes "Thank you.", the hint echoed back), then the plain cleanup (fillers, stutters, "new line", "scratch that"), then the AI cleanup (the included model on Token Factory, or `openai/gpt-oss-120b` on Groq when speech-to-text runs there, with a strict prompt, rejected if it answers instead of transcribing, invents words or loses a snippet; skipped for short, clean messages it has nothing to fix, which saves the model's half second), then your dictionary. Editing by voice goes to `/api/voice/edit` (`edit.ts`): the instruction is dictated with the AI cleanup and "Hey {bot}" off, then one call to the same model gets the selection as text to work on (inside tags, never instructions) and must answer in the expected shape (`<replace>` or `<answer>`), or nothing is typed. In demo mode (no speech-to-text key) it "hears" sample lines, and with no model at all, edits are done by simple rules; the pill says *demo*. Free plans get 8,000 words a month; Plus and Pro have no monthly limit.

### Your words

Shared with the web page (`/app/voice` → *Your words*): names and terms spelled your way (and what speech-to-text writes instead), and snippets (say "my booking link", get the link). Names your bots remember are used too. In **Voice typing settings → Recent**, *Fix* a dictation and it offers the words to teach it (`learn.mjs` diffs the two), so it learns from your corrections.

### Settings

A try-it box; *Private speech* (*Hear me on this computer*, the download's progress, *Try again*, *Remove it from this computer*); the shortcut (presets, or record your own); *Clean up my words*, *Match each app's style*, *Edit by voice*, *Talk to your bot*, *Sounds*, *Put my clipboard back*; language (detect it, or one of 33) and microphone; your words and snippets; *Recent* (keep a history or not, fix, clear); and this week's words, minutes saved and words a minute. Stats are numbers only.

## Permissions, per OS

| | What it asks for | Why | If you say no |
|---|---|---|---|
| **macOS** | **Microphone** (asked the first time you take notes or use voice typing) | your side of the call; your voice | it can't take notes or type by voice, and says how to fix it |
| | **Screen & System Audio Recording** (asked the first time you take notes) | the other people on the call. Electron's system-audio loopback uses Core Audio taps on macOS 14.2+ and needs a screen source too | it keeps going on your mic only and says so above the bot ("I can only hear your mic…") |
| | **Automation** for Chrome/Safari (only if you turn on *Recognize Meet and Teams in browser tabs*) | to tell a Google Meet tab from any other use of the mic in a browser | calls in a browser are just "a call in your browser" |
| **Windows** | Settings › Privacy › Microphone › *Let desktop apps access your microphone* must be on | your side of the call | it can't take notes, and opens that settings page |
| | nothing for the call's audio | system-audio loopback needs no prompt on Windows | |
| | **Accessibility** (asked when you turn on voice typing) | to hear the voice typing shortcut in any app and press ⌘V for you | voice typing uses the toggle shortcut (⌘ Shift Space) and leaves the text on the clipboard for you to paste |
| **Linux** | nothing; needs PulseAudio or PipeWire (`pactl`, from `pulseaudio-utils`) | call detection reads PulseAudio "source outputs" | the tray says "Can't notice calls"; *Take notes now* still works |
| | voice typing: an X11 session, plus `xdotool` or `python3` with `libXtst` (both usually there) | to paste with real key presses | on Wayland the shortcut is heard only in some apps and pasting may not work; it says so |

Detection needs no permission on any OS. The app reads only which program has the microphone open, never audio. Voice typing uses the same microphone permission as notes; during development on a Mac, Accessibility lists the app as **Electron**.

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
| `BAB_VOICE_ENABLE=1` | turn voice typing on at start (skips the setup window) |
| `BAB_VOICE_DEMO=<n>` or `command` | with a demo-mode server: which sample line it "hears" (`0`–`3`), or a "Hey {bot}" command |
| `BAB_VOICE_DEMO_FILE=<path>` | the same, re-read from this file on every dictation, so a test can change it |
| `BAB_SPEECH_RUNTIME_URL`, `BAB_SPEECH_ITN_URL`, `BAB_SPEECH_MODEL_URL` | download Private speech's files from somewhere else (a test server, a mirror); they still have to match the pinned hashes |
| `BAB_PRIVATE_SPEECH=off` | no Private speech at all: nothing downloaded, the server hears every dictation (the voice e2e uses it, for the demo server's sample lines) |

## Tests

```sh
npm test             # unit tests (node --test): detectors per OS, the call state machine,
                     # the controller's safety rules, the upload queue, placement, token storage, tray menu,
                     # and voice typing: shortcut presets, the hold/tap/hands-free machine, Shift for editing,
                     # paste and clipboard restore, reading the selection, front-app categories, history,
                     # learning from fixes, the controller (typing, editing, answers, errors, Try again),
                     # and Private speech against a stand-in runtime: download, resume, hashes, disk space,
                     # the key, the idle stop, crashes, removing it, tidying times, falling back to the server
npm run test:e2e     # end to end under Xvfb with Playwright's Electron driver (one file at a time)
```

The e2e test needs the web app's dev server running in demo mode at http://localhost:3000 (`BAB_E2E_SERVER` to change it), `xvfb-run`, and Playwright (it uses the web app's `node_modules/playwright`; outside this repo, `npm i -D playwright`). It creates a demo owner and bot, turns on Meeting notes, gets a pairing code, pairs through the pairing window, fakes calls and the mic, then clicks through the bot: ask → copy the heads-up → Take notes → live captions → pause → resume → stop → notes ready (checked through the API), then *Stop and delete* (the meeting is gone from the server), *Not now*, a call that ends on its own, and a second launch where system audio is refused (mic-only, with the message). Screenshots of each phase go to `BAB_E2E_SHOTS` (default `<tmp>/bab-desktop-e2e`), plus a `sheet.png` of the bot over a fake call.

`e2e/voice.e2e.mjs` tests voice typing the same way: it presses and holds Right Ctrl with real X key events (XTest, `e2e/fixtures/xkey.py`) while a second app (`e2e/fixtures/target-app.cjs`) has focus, feeds Chromium's fake mic a voice-like tone, and checks that the demo server's cleaned-up line is pasted into that app and the clipboard is put back. Then the settings window and its try-it box, adding a dictionary word (and seeing it spelled that way), hands-free with two taps, Esc, "Hey Otto, …" with its reply and *Paste*, and editing by voice: select everything in the other app, hold Right Shift + Right Ctrl, and the demo's "Make this friendlier." replaces the selection (not next to it), with the clipboard put back. Pill screenshots go to the same folder.

`e2e/local-speech.e2e.mjs` runs Private speech with NVIDIA's real runtime and model, and real speech. It needs NVIDIA's three files in a folder (`BAB_E2E_SPEECH_FILES`; it serves them to the app, cutting the model's download off once) and WAVs of someone saying a sentence (`BAB_E2E_SPEECH_DICTATION`, `BAB_E2E_SPEECH_COMMAND`); without them it's skipped. Voice typing turns on, the app downloads and checks the files (the settings card shows the progress, then *On*) and loads the engine, and each sentence plays into the fake mic while Right Ctrl is held: it's typed into the other app with the pill marked *private*, again with the engine already running, and "Hey Otto, …" reaches Otto, all without sending audio.

Not testable here: real call detection on macOS and Windows (the parsers are unit-tested on captured-style output), the Swift helper (it needs a Mac to build), real system-audio permissions, notifications and tray clicks; for voice typing, the macOS Accessibility prompt and Windows key presses (the hook's paste path is unit-tested), and NVIDIA's macOS and Windows runtimes (the Linux one is what the e2e runs).

## Packaging and signing

`electron-builder.yml` is ready; installers aren't built in this repo. On each OS:

```sh
bash native/macos/build.sh   # macOS only: the helper (Xcode 15.4+), copied into Resources/bin
npm run dist                 # npx electron-builder@26 --config electron-builder.yml
```

- **Private speech** isn't in the installer: NVIDIA's runtime and model are downloaded the first time voice typing is on (above), so the app stays small and the model isn't redistributed. NeMo-Speech.cpp is Apache 2.0; Parakeet TDT 0.6B v3 is CC BY 4.0, credited in the settings card. NVIDIA's macOS runtime is ad-hoc signed and runs as its own process, outside the app's hardened runtime; once it matches NVIDIA's published hash, the app clears the download quarantine flag if macOS set one, so Gatekeeper doesn't stop it.
- **Voice typing's hook** (`uiohook-napi`) ships N-API prebuilds for macOS (x64, arm64), Windows (x64, arm64) and Linux (x64, arm64), so there's nothing to compile (`npmRebuild: false`); `asarUnpack` keeps the `.node` file loadable. On macOS, Accessibility trust belongs to the signed app: a re-signed build with a new identity has to be allowed again.
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
src/main/voice/              voice typing:
  index.mjs                  wiring: hold vs toggle, permissions, IPC for the pill and settings, tray info
  controller.mjs             one dictation: record → send → paste, "Hey {bot}" replies, errors, history
  keys.mjs, hotkey.mjs       shortcut presets per OS; the keyboard hook (uiohook-napi) and the toggle fallback
  hotkey-machine.mjs         the pure state machine: hold, tap, double tap for hands-free, chords left alone
  paste.mjs                  clipboard snapshot, paste per OS, restore
  front-app.mjs              which kind of app is in front (chat, email, code, terminal, docs, browser)
  history.mjs, learn.mjs     the encrypted local history and stats; words to learn from a fix
  local-speech.mjs           Private speech: NVIDIA Parakeet on this computer (download, run, fall back)
  pill-window.mjs, pill-layout.mjs, settings-window.mjs   the pill and the settings window
src/preload/*.cjs            sandboxed preloads (buddy: window.babDesktop, exactly desktop-api.ts)
src/renderer/                the app's own pages (pairing, capture, dictation = the pill, voice = its settings)
native/macos/                Swift helper (mic use per app; Core Audio tap) and its build script
```

On Linux, where click-through can't forward mouse moves to the page, the app hit-tests the cursor against the page's clickable parts itself.
