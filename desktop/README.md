# Build-a-bot for your computer

A small tray / menu-bar app. When a call starts (Zoom, Google Meet, Teams, Webex, Slack, Discord, WhatsApp, or a call in your browser), your bot peeks up from the very bottom of the screen and asks: **"Want me to take notes?"** Say yes and it stays there the whole time it listens, with a red dot, a timer, a level meter and the latest line it heard. When the call ends, it writes your notes (summary, decisions, action items) and tells you they're ready. It hears the call **on your computer** too, with NVIDIA Parakeet: only the transcript's lines are sent, never the audio. Meeting notes are taken only here; the website shows them but doesn't record. See [Meetings heard on this computer](#meetings-heard-on-this-computer).

It also does **voice typing**: hold a key in any app, talk, let go, and what you meant is typed where your cursor is, cleaned up (no ums, the right punctuation, your corrections kept) and with your names spelled your way. Start with "Hey" and your bot's name and it asks your bot instead. It hears you **on your computer**, with NVIDIA's Parakeet speech model, so your voice never leaves it. See [Voice typing](#voice-typing).

And it has **the Bridge** built in: bots whose brain is **Your Claude** or **Your ChatGPT** think on your computer, with your own Claude Code or Codex, signed in by you. No terminal. See [Your Claude or ChatGPT plan](#your-claude-or-chatgpt-plan-the-bridge).

And you can **give a bot a folder**, like your class files: its PDFs, Word files, slides, text and photos go to the bot's Library and stay in step as you add, change and delete them. Nothing else on the computer is read. See [A folder for your bot](#a-folder-for-your-bot).

It's the desktop half of Meeting notes (`src/lib/meetings`, `/desktop/buddy`), Voice typing (`src/lib/dictation`, `/app/voice`) and the Bridge (`src/lib/bridge`, `/app/bridge`) in the web app. Electron 44.7.2, plain JavaScript (ESM main process, sandboxed CommonJS preloads). One runtime dependency: `uiohook-napi`, the keyboard hook for voice typing, loaded only once you turn voice typing on.

## What it does

1. **Pairs with your account** using the same pairing codes as the Bridge: open Build-a-bot → **Bridge (your computer)** → Desktop app, and type the code into the app. The device token is stored with your system keychain (Electron `safeStorage`).
2. **Notices calls.** Every few seconds it asks the operating system which app has the microphone open (only who, never what's said). A meeting app has to hold the mic for 5 seconds (15 for a browser) before it counts.
3. **Asks first, every time.** The bot pops up at the bottom-center of the screen with *Take notes*, *Not now*, *Don't ask in Zoom* and *Copy a heads-up* (a message for the call chat: "Heads-up: I'm using my AI assistant Inky to take notes on this call…"). No answer in 15 seconds counts as *Not now*. After *Not now* it won't ask again during that call, or for 5 minutes.
4. **Takes notes** after a yes: your microphone ("You") and the call's audio ("Others") are recorded as two tracks, cut into standalone pieces of about 20 seconds (each ends at a pause in the talking when there's one near), and each piece is heard on this computer as it goes. Hover over the bot for **Pause**, **Stop** and **Stop and delete** (for when someone on the call objects). For a meeting around a table, *Take notes in the room* in the menu records the mic only, and its lines are labeled "Room".
5. **Stops** when you click Stop, when the call ends (the app lets go of the mic for 15 seconds), after 15 minutes of silence, at 4 hours, when your screen locks or the computer sleeps, or if the bot can't stay on screen.
6. **Tells you when the notes are ready**, at the bottom of the screen and with a notification that opens the meeting in your browser.

The tray menu has: status, Take notes now, Take notes in the room, Stop (and, while it takes notes, Hide the bot / Show the bot), Pause call detection for 1 hour, Show live captions, which bot takes notes, apps it won't ask in, voice typing (Set up voice typing… / its status, Paste last dictation, Voice typing settings…), your Claude or ChatGPT plan (its status, *Think with my Claude plan here*, and *Get Claude Code…* when a bot needs it), *Give a bot a folder…* (or the folder's status, with Open, Choose another folder… and Stop syncing), Open Build-a-bot, This computer…, Start at login, Quit.

## What it never does

- **Never records without a yes.** There is no auto-record setting. Nothing is captured before you tap *Take notes* (or *Take notes now* in the menu); the capture window doesn't even exist until then.
- **Never records out of sight.** Capture starts only after the bot is on screen. Every second (and on window events) it checks the bot is visible, not minimized and on a screen; if it can't put it back, it stops and finishes the meeting. It also stops on screen lock, sleep and quit.
- **You can hide it for a screen share.** Hover the pill and click the crossed-out eye (or pick "Hide the bot" in the menu-bar or tray menu): the bot goes away and keeps taking notes, and the Build-a-bot icon keeps its recording dot. "Show the bot" in the same menu brings it back. It stays hidden for the rest of that meeting (the "notes are ready" notification comes as usual) and is back on screen for the next one. Only on macOS and Windows, where that icon is always there. It isn't done with content protection: macOS lets Zoom, Meet and Teams capture windows that ask not to be, so the bot really leaves the screen.
- **Never sends a call's audio, with Private speech on** (the default): NVIDIA Parakeet turns each piece into text on this computer, in memory, and only its lines go to the server. With it off, on a server that hears audio itself, the pieces go to the server, which turns them into text and throws them away.
- **Never keeps audio.** The only place audio touches this computer's disk is the upload spool: pieces waiting to be heard (while Parakeet downloads) or sent (while offline, or when you quit mid-upload), 200 MB at most, each deleted the moment it's done. *Stop and delete* deletes everything captured so far, on this computer and on the server.
- **Never shares your token.** It lives in the main process only: encrypted at rest, never logged (logs scrub it as a backstop), never put in a URL, never given to a web page. The bot at the bottom of the screen is a web page from the server, but it only gets four functions (`onState`, `act`, `setInteractive`, `copy`). It can't navigate elsewhere, open windows or use the mic.
- **Never listens for voice typing unless you hold the key.** The keyboard hook sees key presses only to spot your shortcut; nothing about other keys is kept or logged. The mic opens when you press the shortcut and closes when you let go (or tap it again, hands-free), and the pill on screen shows it the whole time.
- **Never sends your voice, with Private speech on** (the default, once it has downloaded): NVIDIA Parakeet turns it into text on this computer, in memory, and only the words go to the server, once, to be cleaned up. Until then (or with it off) a dictation's audio is sent once, turned into text and thrown away.
- **Never keeps your words on the server.** A dictation is cleaned up and thrown away; the server counts the words for your usage, nothing else. Your history of dictations stays on this computer, encrypted with the system keychain (memory only if there's none), 100 at most for 30 days, and you can turn it off or clear it.
- **Never keeps what you select.** Editing by voice sends the selected text once, to make the change you asked for; the server doesn't store it, and the local history keeps only what you said and the result.
- **Never sends what's on your screen.** To fit the words to the app (casual in chats, proper in email), only its kind (`chat`, `email`, `code`…) and, for apps on the built-in list, its name (`Slack`) are sent, worked out on this computer from the front app and, in a browser, the tab's title. Never the window's text, the title itself, what's around your cursor, or the name of an app that isn't on the list.
- **Reads only the box it just typed into, and only to learn from your fixes.** For two minutes after voice typing pastes, it reads that one text box on this computer (macOS Accessibility, Windows UI Automation), so that when you fix a word it got wrong right there ("pro zee" → "Prozzi"), it learns it. Never a password box, never another box, never more than 20,000 characters, never logged, and it stops as soon as the box is sent, cleared or rewritten. Only the word you fixed (and what it heard) goes to your dictionary, and a notification says so. *Learn from my fixes* in Voice typing settings turns it off.
- **No analytics.** Logs stay on this computer (`<userData>/logs/main.log`). A dictation logs one line with its kind, size and timings (`voice: text (12 words, cleaned up) in 410 + 380 ms, 4.2 s recorded`), never what was said.
- **Never gives Claude Code or Codex your files, shell or browser.** A turn runs with every built-in tool off, in an empty folder of its own, with only your bot's tools (from Build-a-bot, where each call follows your trust level and approvals); a turn whose CLI shows any built-in tool, or runs a shell command, is refused. Your Claude or ChatGPT sign-in is never read, copied or sent, and API keys in your environment are kept from the CLI so it uses your plan.
- **Never keeps a turn.** The bot's instructions, the conversation, the answer and the turn's short-lived tool token exist only while it runs, in that folder, which is emptied after every turn. The log says a turn ran and how long it took, never what it said.
- **No FaceTime or phone calls** in this version: macOS doesn't let apps record FaceTime, and phone calls bring stricter consent laws (research §3.2, §5.5).

## Meetings heard on this computer

`src/main/meeting-speech.mjs`, `decoder-window.mjs`, and the same NVIDIA Parakeet engine and *Private speech* setting as voice typing (below).

- **Getting it.** Pairing with a bot whose meeting notes are on downloads Parakeet right away, without voice typing being on, so the first call doesn't wait for it. The pairing window says how far it's got.
- **Each piece.** A piece is a standalone webm/opus file. A hidden, sandboxed page (`bab-app://decode`: no network, no permissions, no preload) turns it into 16 kHz mono WAV with Chromium's own decoder. Parakeet hears it with each word's time (`verbose_json`), and the words become transcript lines at a pause of 1.2 s or more, or where a sentence ends. Only the lines go to the server (`POST …/audio` with `{ heard: [...] }`); a silent piece sends only its time. The server shows them as the live transcript and writes the notes from them.
- **Ending at a pause.** Each piece is heard on its own, so a word cut in two at a piece's edge comes out mangled. The capture page ends a piece at the first moment both tracks have been quiet for 0.3 s, from 2.5 s before its length to 5 s after; with no pause by then, it ends anyway.
- **Voice typing goes first.** A meeting's pieces are heard one at a time, and wait while a dictation is heard: the owner is waiting at their cursor.
- **Before Parakeet is here,** the bot listens anyway and says so ("Getting NVIDIA Parakeet (45%). I'm listening, and I'll write your notes once it's here."), again every couple of minutes. The pieces wait in the spool and are heard once it arrives. The notes are written only once every piece is in, not from part of the meeting; meanwhile the app tells the server every few minutes that the meeting is still being heard (`PATCH { hearing: true }`), so it isn't wrapped up as abandoned. After 12 hours it gives up and the notes are written from what arrived.
- **When it can't.** Private speech off, or a computer Parakeet can't run on: the pieces' audio goes to the server, when the server hears audio itself (`meetings.available` in `/api/desktop/session`); when it doesn't (build-a-bot.site), notes can't be taken and the tray says why ("Turn on Private speech to take notes"). An engine that keeps stopping: the pieces go to such a server, or wait until it runs again. A piece the engine refuses four times, or a piece cut off by a crash that can't be read, counts as nothing heard, and the meeting goes on.

Measured on a 4-core Linux server with no GPU: 37 s of speech heard in about 8 s, so it keeps up with a call. End to end with NVIDIA's real engine and real speech (`e2e/meeting-parakeet.e2e.mjs`): the first live caption 27 s after *Take notes* (one 20-second piece, plus hearing it), and the notes ready 6 s after *Stop*.

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

- **Getting it.** The first time voice typing is on (or a bot takes notes on this computer), it downloads, in the background: NVIDIA's runtime for this platform, [NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp) 0.2.0 from its GitHub release (about 7 MB), its number rules ("three thirty" → 3:30; not on Windows) and the model, [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), 8-bit, from Hugging Face (714 MB): about 0.7 GB in all, into `<userData>/speech`. Each file is pinned to one version and checked against its SHA-256 before it's used (a file that doesn't match is deleted). A cut-off download picks up where it stopped, and keeps going as long as each try gets further; one that fails tries again on its own half an hour later, or from **Try again** in settings. Downloads go through the app's network stack, so the system's proxy and certificates work. It checks for about 1.1 GB free first.
- **Running it.** `nemo-speech serve` on 127.0.0.1, on a free port, behind a random key passed in its environment (not on its command line), so other programs on the computer can't use it. It runs in its own folder and gets its files' paths relative to it, so a user name with letters from outside English (`C:\Users\José\…`) can't trip a native program's command line. On a Mac with Apple silicon it uses the GPU (Metal); if the GPU fails there (it crashes or hangs while loading), it switches to the CPU at once, for that same start, and stays on the CPU until NVIDIA's runtime changes (`engine.json`). It starts when you press the shortcut (the model loads while you talk), and right after the first download, and stops after 20 minutes unused, so it isn't in memory all day. A dictation waits at most 15 s for it to load. If the app was force-quit and left one running, the next start stops it (only after checking that process is still the engine). The pill hands over the recording as 16 kHz mono WAV, decoded and resampled by Chromium with a second of silence after it (without it, a clip that stops mid-word loses its last word); it's posted to the engine from memory and never written to disk. A clock time Parakeet writes British-style after "at"/"by"/… ("at 3.30") and the hour's leading zero from the number rules ("03:30") become "3:30".
- **When it can't.** Not downloaded yet, turned off, a language Parakeet doesn't speak (it has English and 24 European languages; Japanese and the rest go to the server), a server too old to take text, or the engine failing: then the recording goes to the server, when the server turns recordings into text (`voice.available` in `/api/desktop/session`). When it doesn't (build-a-bot.site has no speech-to-text of its own), nothing is sent and the pill says why instead: "Getting NVIDIA Parakeet: 45%. Voice typing works as soon as it's done.", "Turn on Private speech…", or try again. Nothing ever types words you didn't say. If the engine stops on its own three times in 10 minutes, or can't be run at all, it's left alone until the app restarts.
- **Removing it.** *Remove it from this computer* in settings stops it and deletes the folder; it downloads again only if you turn it back on.

Measured on a 4-vCPU Linux box with no GPU (`e2e/local-speech.e2e.mjs`): the download checked and unpacked in under 10 s from a local copy; a 3.4 s sentence typed about 1.5 s after letting go, including the cleanup on the server and pasting; Parakeet's own part was 1.2–1.7 s per dictation on that CPU. A Mac's GPU is faster.

### What the server does

`src/lib/dictation`: speech-to-text, unless this computer already did it and sent the words (`{ heard }`) instead of audio (NVIDIA Parakeet on our speech server, `speech/`; Whisper providers get your words and your bots' names as a hint), then guards against the known failures of Whisper-family models (silence that becomes "Thank you.", the hint echoed back), then the plain cleanup (fillers, stutters, "new line", "scratch that"), then the AI cleanup (the included model on Token Factory, or `openai/gpt-oss-120b` on Groq when speech-to-text runs there, with a strict prompt, rejected if it answers instead of transcribing, invents words or loses a snippet; skipped for short, clean messages it has nothing to fix, which saves the model's half second), then your dictionary. Editing by voice goes to `/api/voice/edit` (`edit.ts`): the instruction is dictated with the AI cleanup and "Hey {bot}" off, then one call to the same model gets the selection as text to work on (inside tags, never instructions) and must answer in the expected shape (`<replace>` or `<answer>`), or nothing is typed. With no speech-to-text key, a recording isn't turned into text at all (only what Parakeet heard on the computer is typed); run locally in demo mode, it "hears" sample lines instead (`DEMO_SPEECH`), and with no model at all, edits are done by simple rules; the pill says *demo*. There's no word limit: what costs money (a recording heard on the server, the AI cleanup) is paid from the owner's credit, at cost, and without credit the plain cleanup is typed.

### Your words

Shared with the web page (`/app/voice` → *Your words*): names and terms spelled your way (and what speech-to-text writes instead), and snippets (say "my booking link", get the link). Names your bots remember are used too. In **Voice typing settings → Recent**, *Fix* a dictation and it offers the words to teach it (`learn.mjs` diffs the two), so it learns from your corrections.

**Learning from a fix where you typed it** (macOS and Windows; on by default, *Learn from my fixes*). Fix a word it got wrong right in the app ("Meet pro zee at the lab." → "Meet Prozzi at the lab.") and from then on it types "Prozzi" (the dictionary applies it after the cleanup, whether Parakeet heard it on this computer or the server did). How (`fix-watch.mjs`, `text-reader.mjs`):

- When it pastes, it reads the box that has the focus (macOS: the app's Swift helper, `bab-audio-helper text`, with the Accessibility permission voice typing already has; Windows: UI Automation, from one small PowerShell kept running while you dictate) and finds the words it typed there. Chrome and Electron apps (Slack, Discord, Teams, VS Code…) build their accessibility tree only when asked, so while you talk the app in front is asked to, as assistive apps do.
- Then it reads that same box a few times a second, for up to two minutes, comparing the words it typed with what's there now (`learnFromFix`). It follows them as you edit around them: each reading is compared with the last, so text added before them (a greeting) or after them (another dictation) only moves them, and a change inside them is the fix. Up to the last three dictations are followed at once. It stops when the box is sent, cleared or rewritten over them, when you dictate into another box, or when it's turned off.
- A fix is learned once it has held still for 3 seconds (or for a moment before you send the message or dictate into another box), so a word you're still typing ("Proz…") isn't. A word is learned once; up to three from one fix.
- Only clear cases: a word replaced by one that sounds like it ("pro zee" → "Prozzi", "cooper nettie's" → "Kubernetes", "Jon" → "John"), or a word spelled its own way ("github" → "GitHub"). Never a different name ("Mark" → "Sarah"), an everyday word ("Tuesday" → "Thursday"), the same word changed ("Prozzi" → "Prozzi's"), added words, a rewrite, or a word that's already in your dictionary turned into another.
- The word is added to your dictionary as a correction (it shows under *Your words*, where you can remove it), and a notification says "Learned “Prozzi”: from now on it types “Prozzi”, not “pro zee”."

### Settings

A try-it box; *Private speech* (*Hear me on this computer*, the download's progress, *Try again*, *Remove it from this computer*); the shortcut (presets, or record your own); *Clean up my words*, *Match each app's style*, *Edit by voice*, *Talk to your bot*, *Sounds*, *Put my clipboard back*, *Learn from my fixes* (macOS and Windows); language (detect it, or one of 33) and microphone; your words and snippets; *Recent* (keep a history or not, fix, clear); and this week's words, minutes saved and words a minute. Stats are numbers only.

## Your Claude or ChatGPT plan (the Bridge)

`src/main/bridge/`. A bot whose brain is **Your Claude** or **Your ChatGPT** (Settings → Brain on the website) thinks on its owner's computer: Build-a-bot queues the turn, and this app runs it with the owner's own Claude Code (`claude -p`) or Codex (`codex exec`). It's the same runner as the terminal Bridge (`bridge/runner.mjs`; `runner.mjs` here is a copy, and a test keeps them identical).

- **On by itself.** Once paired, the app looks for Claude Code and Codex (`program-path.mjs`: the login shell's PATH, since an app opened from the Finder gets a bare one; the registry's on Windows; and the usual install folders) and tells the server which it found, every 30 seconds. While one of the owner's bots uses their plan (or turns are waiting), it listens for turns and runs them one at a time. *Think with my Claude plan here* in the menu (or *Turn off here* in the pairing window) turns it off on this computer; the server then hears it has none, so no bot waits on it.
- **No shell.** Each CLI runs as its own program, even on Windows: a `.exe` directly, and the program an npm or pnpm `.cmd` shim points at (Node scripts with Node, or the app's own Node when there's none). `cmd.exe` would drop the empty `--tools ""` and mangle JSON and line breaks. Windows get no console window.
- **When something's wrong**, the bot says so in the chat, and the menu says how to fix it: *Claude Code isn't signed in: run claude in Terminal* (with one notification), *Claude Code isn't on this computer* (with *Get Claude Code…*), the plan's usage limit, or no connection. Quitting mid-turn stops the CLI and tells the bot why there's no answer.
- **Several computers?** Whichever is online takes the next turn.

## A folder for your bot

`src/main/library/`. *Give a bot a folder…* in the menu (or **Choose a folder** in the pairing window, which asks which bot when you have several) opens the system's folder picker. The folder's files then go to that bot's Library on the website, where the bot reads them like any file it's given: it answers from them and makes flashcards and quizzes. The AI never gets the disk; it only sees what's in its Library.

- **What goes:** PDFs, Word (`.docx`), PowerPoint (`.pptx`), text, Markdown, CSV, JSON, HTML and photos, up to 25 MB each and 300 files, in subfolders too. Hidden files, app folders (`node_modules`, `.git`, …), Office's `~$` lock files and links are skipped, so nothing outside the folder is opened (`scan.mjs`).
- **Staying in step:** the app watches the folder (and looks again every 10 minutes, in case a change was missed). A file whose size or time changed is hashed; if the bytes really changed it's uploaded straight to private storage with a one-file token and read on the server, replacing its old copy. A deleted file leaves the Library. One file at a time; what it sent is remembered in `library-sync.json`.
- **Careful by default:** a folder that suddenly looks empty (a drive that isn't connected, a cloud folder still syncing) removes nothing. A file that can't be read is skipped until it changes. No connection: it tries again in a few minutes. A full Library (500 MB) says so.
- **Stop syncing** keeps what was already added. **Pairing again** takes over the copies it sent before (same path, same bytes) instead of uploading them twice.
- Server side: `src/app/api/desktop/library/` (device token; only the owner's own bots; paths can't leave the folder) and `src/lib/library/desktop.ts`.

## Permissions, per OS

| | What it asks for | Why | If you say no |
|---|---|---|---|
| **macOS** | **Microphone** (asked the first time you take notes or use voice typing) | your side of the call; your voice | it can't take notes or type by voice, and says how to fix it |
| | **Screen & System Audio Recording** (asked the first time you take notes) | the other people on the call. Electron's system-audio loopback uses Core Audio taps on macOS 14.2+ and needs a screen source too | it keeps going on your mic only and says so above the bot ("I can only hear your mic…") |
| | **Automation** for Chrome/Safari (only if you turn on *Recognize Meet and Teams in browser tabs*) | to tell a Google Meet tab from any other use of the mic in a browser | calls in a browser are just "a call in your browser" |
| | **Accessibility** (asked when you turn on voice typing; macOS may also ask for **Input Monitoring**, "receive keystrokes") | to hear the voice typing shortcut in any app and press ⌘V for you; and to learn from a fix, to read the text box it just typed into | voice typing uses the toggle shortcut (⌘ Shift Space) and leaves the text on the clipboard for you to paste; it doesn't learn from fixes |
| **Windows** | Settings › Privacy & security › Microphone: *Microphone access* and *Let desktop apps access your microphone* must be on (they are unless someone turned them off) | your side of the call; your voice | it can't take notes or type by voice; the settings window says which switches, and opens that page |
| | nothing for the call's audio | system-audio loopback needs no prompt on Windows | |
| | nothing for voice typing | the keyboard hook, key presses and UI Automation (reading the box it typed into, to learn from a fix) need no permission | (none to refuse) but it doesn't work in apps running **as administrator**: Windows keeps the shortcut, the paste and the reading from crossing into them |
| **Linux** | nothing; needs PulseAudio or PipeWire (`pactl`, from `pulseaudio-utils`) | call detection reads PulseAudio "source outputs" | the tray says "Can't notice calls"; *Take notes now* still works |
| | voice typing: an X11 session, plus `xdotool` or `python3` with `libXtst` (both usually there) | to paste with real key presses | on Wayland the shortcut is heard only in some apps and pasting may not work; it says so |

Detection needs no permission on any OS. The app reads only which program has the microphone open, never audio. Voice typing uses the same microphone permission as notes.

**Run from source on a Mac** (`npm start`), macOS asks on behalf of the app you started it from, not Build-a-bot: Terminal, iTerm, VS Code, Cursor…. That's the one to turn on in Privacy & Security › Microphone and › Accessibility (and Input Monitoring, if asked), and the settings window names it. The installed app asks as Build-a-bot.

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

## Install it

From **[build-a-bot.site/download](https://build-a-bot.site/download)**, once signed builds are published (Packaging and signing, below). The page offers the visitor's own computer first.

- **Mac** (macOS 13 or later, Apple silicon or Intel: one app for both): open the `.dmg` and double-click Build-a-bot. It moves itself into Applications and opens again from there (`src/main/install-location.mjs`). It's signed with a Developer ID and notarized, so macOS only asks once whether to open something downloaded.
- **Windows** (10 and 11, x64): open `Build-a-bot-Setup-<version>.exe`. It installs for you only, in a few seconds, with no questions and no admin password, and opens. It's in the Start menu as **Build-a-bot** and lives in the system tray (the **^** by the clock). On Windows on ARM it should run through Windows' x64 emulation (not tested).

Then pair it with a code from the web app (**Bridge (your computer)**), and **Set up voice typing…** (after pairing, or from the tray): NVIDIA Parakeet downloads (about 0.7 GB), and holding the shortcut types what you say.

**Updates:** signed builds update themselves (`src/main/updates.mjs`). A minute after starting, and every four hours, the app asks build-a-bot.site for a newer version and downloads it in the background. It installs when the app quits, or right away from **Restart to update to …** at the top of the menu. That item is greyed out while it's taking notes or you're dictating, so it never restarts in the middle of a call. Installing over an older version keeps your pairing, settings and Parakeet; uninstalling removes them too.

**Test builds:** every push to main also replaces the **Desktop app (test build)** pre-release on GitHub: both apps, signed if the signing keys are set, otherwise not. An unsigned Windows build makes the browser ask you to **Keep** it and Windows say *"Windows protected your PC"* (**More info** → **Run anyway**); Smart App Control blocks it outright. An unsigned Mac build opens only after **System Settings → Privacy & Security → Open Anyway**. Test builds don't update themselves.

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
| `BAB_PRIVATE_SPEECH=off` | no Private speech at all: nothing downloaded, the server hears every dictation and meeting (the voice and meeting e2e tests use it, for a local demo server's sample lines and scripted meeting; a server with no speech-to-text can't hear you then, and the app says so) |
| `BAB_SMOKE=1` | check itself and quit: the tray, the pairing window, the keyboard hook (loads, starts, stops), the pill and settings pages, which app is in front, Private speech; exit code 0 when all is well, results in `BAB_SMOKE_OUT` (JSON). CI runs it on the installed Windows app |
| `BAB_STAY_PUT=1` | a packaged Mac app stays where it was opened instead of moving itself into Applications |
| `BAB_UPDATES=off` | a signed build doesn't look for updates |
| `BAB_LIBRARY_FOLDER=<dir>` | after pairing, give the first bot this folder (stands in for the folder picker in tests) |

## Tests

```sh
npm test             # unit tests (node --test): detectors per OS, the call state machine,
                     # the controller's safety rules, the upload queue, placement, token storage, tray menu,
                     # and voice typing: shortcut presets, the hold/tap/hands-free machine, Shift for editing,
                     # paste and clipboard restore, reading the selection, front-app categories, history,
                     # learning from fixes, the controller (typing, editing, answers, errors, Try again),
                     # and Private speech against a stand-in runtime: download, resume, hashes, disk space,
                     # the key, the idle stop, crashes, removing it, tidying times, falling back to the server;
                     # meetings heard here: Parakeet's timed words into lines, pieces that wait for it,
                     # dictations first, notes only once every piece is in, the bot saying why it waits;
                     # the Bridge: the CLI's exact arguments, refusing built-in tools and shell commands,
                     # sign-in and limit errors, Windows' npm shims, PATH from the login shell and the registry,
                     # a real run against a stand-in claude (in a folder named José Muñoz), stopping mid-turn,
                     # and the app's loop against a stand-in server (on, off, ready, quitting, unpaired);
                     # a folder for your bot: what's scanned and skipped, new / touched / changed / deleted files,
                     # remembering across restarts, the empty-folder guard, offline and refused files, the tray
npm run test:e2e     # end to end under Xvfb with Playwright's Electron driver (one file at a time)
```

`e2e/library.e2e.mjs` pairs the app with a dev server in demo mode and a folder of class files (`BAB_LIBRARY_FOLDER`), checks they arrive in the bot's Library, read, and the pairing window's card says so; then edits one, deletes one and adds one, checks the Library follows, asks the bot about the edited file in the web chat, and stops syncing (the files stay).

`e2e/bridge.e2e.mjs` (macOS and Linux) pairs the app with a dev server in demo mode, puts a bot on Your Claude, and waits for the answer to a web chat message, thought up on this computer. The app starts with the bare PATH an app opened from the Finder gets, so it has to find Claude Code through the login shell. By default a stand-in `claude` answers; `BAB_E2E_REAL_CLAUDE=1` uses the real, signed-in Claude Code (one short turn on your plan). macOS runs it with Chromium's mock keychain.

The e2e test (`e2e/meeting.e2e.mjs`) needs the web app's dev server running in demo mode at http://localhost:3000 (`BAB_E2E_SERVER` to change it; a production build there needs `DEMO_SPEECH=1` too, for the scripted meeting and sample dictations), `xvfb-run`, and Playwright (it uses the web app's `node_modules/playwright`; outside this repo, `npm i -D playwright`). It runs with Private speech off, so the server hears the pieces (its scripted meeting); each piece is checked to be a complete webm file, back to back with the last, ending at a pause near its length. It creates a demo owner and bot, turns on Meeting notes, gets a pairing code, pairs through the pairing window, fakes calls and the mic, then clicks through the bot: ask → copy the heads-up → Take notes → live captions → pause → resume → stop → notes ready (checked through the API), then *Stop and delete* (the meeting is gone from the server), *Not now*, a call that ends on its own, and a second launch where system audio is refused (mic-only, with the message). Screenshots of each phase go to `BAB_E2E_SHOTS` (default `<tmp>/bab-desktop-e2e`), plus a `sheet.png` of the bot over a fake call.

`e2e/voice.e2e.mjs` tests voice typing the same way: it presses and holds Right Ctrl with real X key events (XTest, `e2e/fixtures/xkey.py`) while a second app (`e2e/fixtures/target-app.cjs`) has focus, feeds Chromium's fake mic a voice-like tone, and checks that the demo server's cleaned-up line is pasted into that app and the clipboard is put back. Then the settings window and its try-it box, adding a dictionary word (and seeing it spelled that way), hands-free with two taps, Esc, "Hey Otto, …" with its reply and *Paste*, and editing by voice: select everything in the other app, hold Right Shift + Right Ctrl, and the demo's "Make this friendlier." replaces the selection (not next to it), with the clipboard put back. Pill screenshots go to the same folder.

**On real Windows and macOS** (`.github/workflows/desktop.yml`, on every change to `desktop/`): the unit tests on Linux and Windows; `scripts/check-private-speech.mjs` on Windows and macOS (NVIDIA's runtime and Parakeet downloaded from NVIDIA's pages the way the app does, a sentence the system's own voice says heard right, an engine left by a force-quit stopped, everything removed; in a folder named `José Muñoz`); then the Windows installer, built, installed silently, checking itself (`BAB_SMOKE=1`), and `e2e/windows-voice.e2e.mjs` in the installed app: paired with a stand-in server, Parakeet downloaded and loaded, Windows' own voice saying a sentence into the fake mic while the real **Ctrl + Windows** is held with `SendInput` (`e2e/fixtures/winkey.py`), and the words pasted into another app, with only the words sent, the Start menu shut and the clipboard put back; then installed again over itself (the app's data stays) and uninstalled with an engine still running from the data folder (stopped, and everything removed). On main, the installer becomes the **Desktop app (test build)** pre-release.

**Learning from a fix, for real:** `e2e/text-reader.e2e.mjs` runs on Windows (the unit tests' job) and on the Mac (with the packaged app's own helper, after the Mac app is built): the reader finds the text and the caret in an Electron app's box and in Notepad or TextEdit; a fix typed there with real keys (`winkey.py`'s `SendInput`, `mackey.swift`'s Quartz events) is seen by `FixWatcher` and learned, "Mark" → "Sarah" isn't, and a password box is refused. On the Mac, CI first allows Accessibility for the processes it runs (the system's TCC database), as an owner does once for the app. `e2e/windows-learn.e2e.mjs` runs in the installed Windows app: the real **Ctrl + Windows**, a stand-in server that "mishears" a name, the app types it into another app, the name fixed there with real keys, and the stand-in server gets `{ kind: "word", text: "Prozzi", heard: ["pro zee"], source: "correction" }`; then "Mark" → "Sarah" teaches nothing, and nothing it read is in the app's log.

`e2e/meeting-parakeet.e2e.mjs` takes meeting notes with NVIDIA's real runtime and model, and real speech, against a dev server started with `DEMO_SPEECH=0` (no speech-to-text of its own, like build-a-bot.site). It needs NVIDIA's files (`BAB_E2E_SPEECH_FILES`, as below) and a WAV of someone talking for about half a minute (`BAB_E2E_MEETING_WAV`; `BAB_E2E_MEETING_EXPECT` lists words to look for). The website can't start a meeting (403); pairing downloads Parakeet without voice typing on, and the pairing window shows it; a fake Zoom call, *Take notes*, the WAV plays into the fake mic, a live caption appears, *Stop*, the notes are ready, no piece went as audio, nothing is left on disk, and the server's transcript has the words that were said. Then the same call with Parakeet's download held back until it's over: the bot listens and says why there are no captions, the pieces wait on disk with nothing sent, the server writes no notes from part of the meeting, and once Parakeet is here every piece is heard and the notes come.

`e2e/local-speech.e2e.mjs` runs Private speech with NVIDIA's real runtime and model, and real speech. It needs NVIDIA's three files in a folder (`BAB_E2E_SPEECH_FILES`; it serves them to the app, cutting the model's download off once) and WAVs of someone saying a sentence (`BAB_E2E_SPEECH_DICTATION`, `BAB_E2E_SPEECH_COMMAND`); without them it's skipped. Voice typing turns on, the app downloads and checks the files (the settings card shows the progress, then *On*) and loads the engine, and each sentence plays into the fake mic while Right Ctrl is held: it's typed into the other app with the pill marked *private*, again with the engine already running, and "Hey Otto, …" reaches Otto, all without sending audio.

Not tested automatically: real call detection on macOS and Windows (the parsers are unit-tested on captured-style output), the Swift helper's call detection and audio tap (its text box reading is tested on CI's Mac), real system-audio permissions, notifications and tray clicks; for voice typing, the macOS Accessibility prompt and NVIDIA's Metal engine on a real Mac's GPU (GitHub's Macs are virtual machines, where it crashes, so CI sees the switch to the CPU instead).

## Packaging and signing

CI does it (`.github/workflows/desktop.yml`, on every change to `desktop/`):

- **Windows:** the NSIS installer (one click, per user, no admin), installed on a real Windows computer and tested there (above). With the signing settings below, builds on main are signed with **Azure Artifact Signing**, and CI checks the signature.
- **Mac:** one universal app (arm64 + x86_64) as a `.dmg` and a `.zip` (what updates download), with the call-detection helper built universal too. With the keys below, builds on main are signed with a **Developer ID** under the hardened runtime and **notarized**, and CI checks what a Mac will say when it's opened (`spctl`: notarized Developer ID) and the stapled ticket. Without them, and on pull requests, it's signed ad hoc, for testing. Either way the packaged app checks itself (`BAB_SMOKE=1`).
- **Versions:** each build is `0.1.<run number>` (`-c.extraMetadata.version`), so an installed app can tell a newer one.
- **Publishing (main only):** every build replaces the **Desktop app (test build)** pre-release. A signed build is also published as the release `desktop-v<version>`, with `latest.yml` / `latest-mac.yml` and the block maps. Signed builds alone carry `babUpdates` in their package.json, which is what switches updates on.
- **Where downloads and updates come from:** build-a-bot.site. `/download` shows the newest signed build for each computer, `/download/mac` and `/download/windows` send people to the file, and `/desktop/updates/<file>` is the update feed (`electron-builder.yml` › `publish`). They read the repository's releases (`src/lib/desktop/releases.ts`), so **the repository has to be public** for anyone to download them, and the files can move later without a new app.

**Setting up signing** (once, by the owner of the Apple and Azure accounts; the values go in the repository's Settings → Secrets and variables → Actions):

| | Secrets | Variables |
|---|---|---|
| Mac | `MAC_CERTIFICATE_P12` (the Developer ID Application certificate with its private key, exported as .p12, base64), `MAC_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_P8` (the App Store Connect API key's .p8 text), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | |
| Windows | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (an app registration with the *Artifact Signing Certificate Profile Signer* role on the certificate profile) | `AZURE_SIGNING_ENDPOINT` (the account's region endpoint, like `https://eus.codesigning.azure.net`), `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`, `AZURE_SIGNING_PUBLISHER` (the name on the certificate, exactly) |

The step-by-step is in `docs/DEPLOY.md` §9. On a Mac that has the Developer ID certificate in its Keychain, `bash scripts/set-mac-signing-secrets.sh <issuer ID>` sets the Mac's five secrets. A platform whose keys are missing still builds, unsigned, and isn't published as a release.

By hand, on each OS:

```sh
bash native/macos/build.sh   # macOS only: the helper (Xcode 15.4+), copied into Resources/bin
npm run dist                 # npx electron-builder@26 --config electron-builder.yml
```

- **Private speech** isn't in the installer: NVIDIA's runtime and model are downloaded the first time voice typing is on, or a bot takes notes on this computer (above), so the app stays small and the model isn't redistributed. NeMo-Speech.cpp is Apache 2.0; Parakeet TDT 0.6B v3 is CC BY 4.0, credited in the settings card. NVIDIA's macOS runtime is ad-hoc signed and runs as its own process, outside the app's hardened runtime; once it matches NVIDIA's published hash, the app clears the download quarantine flag if macOS set one, so Gatekeeper doesn't stop it.
- **Voice typing's hook** (`uiohook-napi`) ships N-API prebuilds for macOS (x64, arm64), Windows (x64, arm64) and Linux (x64, arm64), so there's nothing to compile (`npmRebuild: false`); `asarUnpack` keeps the `.node` file loadable. On macOS, Accessibility trust belongs to the signed app: a re-signed build with a new identity has to be allowed again.
- **macOS:** `LSUIElement` keeps it out of the Dock. `NSMicrophoneUsageDescription` and `NSAudioCaptureUsageDescription` must be in the **main app's** Info.plist (macOS asks on behalf of the app responsible for the process). Entitlements: `build/entitlements.mac.plist` (JIT for Electron, audio input, Apple Events). electron-builder signs the helper again with the app's identity. An ad hoc build has no hardened runtime (it would refuse Electron's own libraries without a real identity).
- **Windows:** installing over an older version keeps the app's data; uninstalling deletes it (`deleteAppDataOnUninstall`), after `build/installer.nsh` stops Private speech's engine if it's still running and clears *Start at login*. NVIDIA's `nemo-speech.exe` isn't signed (it brings its own Visual C++ runtime, so nothing else needs installing), so a PC with Smart App Control on may not let it run; then the server hears instead, where it can. Notifications use the app ID `site.build-a-bot.desktop`.
- **Linux:** AppImage and `.deb` (the `.deb` depends on `pulseaudio-utils` or `pipewire-pulse` for `pactl`). They don't update themselves.
- Icons: `npm run icons` renders `assets/tray/*` (template images for the macOS menu bar, colored ones for Windows/Linux), `assets/icon.png` and `build/icon.png` from the SVGs in `assets/svg` with Playwright.

## Layout

```
src/main/main.mjs            app lifecycle, IPC, tray actions, links, notifications
src/main/controller.mjs      runs the call state machine; safety checks every second
src/main/call-machine.mjs    the state machine (pure): idle → asking → listening ⇄ paused → saving → done
src/main/detect/             per-OS call detection (pure parsers + the polling loop + debounce)
src/main/buddy-window.mjs    the bot at the bottom of the screen (transparent, click-through)
src/main/capture-window.mjs  hidden window: mic + system audio, 2 MediaRecorders, pieces that end at a pause
src/main/meeting-speech.mjs  each piece: heard here (Parakeet's timed words → lines), sent as audio, or waiting
src/main/decoder-window.mjs  hidden, sandboxed page: a piece's webm/opus → 16 kHz mono WAV
src/main/upload-queue.mjs    uploads with retries; spool.mjs keeps pieces on disk only while they wait or fail
src/main/account.mjs, api.mjs, store.mjs   pairing, the server API, settings and the encrypted token
src/main/pairing-window.mjs  the local pairing window (bab-app://pairing)
src/main/bridge/             the Bridge: bots on the owner's Claude or ChatGPT plan think here
  index.mjs                  when to listen, the turn loop, heartbeats, the menu's words
  runner.mjs                 one turn with Claude Code or Codex (a copy of bridge/runner.mjs)
  program-path.mjs           where the owner's programs are (login shell, registry, install folders)
src/main/library/            a folder for your bot: scan.mjs (what's in it), index.mjs (keeping the Library in step)
src/main/voice/              voice typing:
  index.mjs                  wiring: hold vs toggle, permissions, IPC for the pill and settings, tray info
  controller.mjs             one dictation: record → send → paste, "Hey {bot}" replies, errors, history
  keys.mjs, hotkey.mjs       shortcut presets per OS; the keyboard hook (uiohook-napi) and the toggle fallback
  hotkey-machine.mjs         the pure state machine: hold, tap, double tap for hands-free, chords left alone
  paste.mjs                  clipboard snapshot, paste per OS, restore
  front-app.mjs              which kind of app is in front (chat, email, code, terminal, docs, browser)
  history.mjs, learn.mjs     the encrypted local history and stats; words to learn from a fix
  fix-watch.mjs              learning from a fix where it was typed: find the words, follow them, settle
  text-reader.mjs            reading that box: the Swift helper (macOS), UI Automation in PowerShell (Windows)
  local-speech.mjs           Private speech: NVIDIA Parakeet on this computer (download, run, fall back)
  pill-window.mjs, pill-layout.mjs, settings-window.mjs   the pill and the settings window
src/preload/*.cjs            sandboxed preloads (buddy: window.babDesktop, exactly desktop-api.ts)
src/renderer/                the app's own pages (pairing, capture, decode, dictation = the pill, voice = its settings)
native/macos/                Swift helper (mic use per app; Core Audio tap; the box typed into) and its build script
```

On Linux, where click-through can't forward mouse moves to the page, the app hit-tests the cursor against the page's clickable parts itself.
