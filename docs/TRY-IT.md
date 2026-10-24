# Try it: a guide for reviewing Build-a-bot

A walk through everything that's built, about 40 minutes end to end. It all runs on your own computer in demo mode, so no keys are needed and nothing is sent anywhere.

If something looks wrong, note the page, what you clicked and what you expected. A screenshot helps. The terminal running `npm run dev` shows server errors.

## 0. Start it

You need Node 22.12 or newer. Meeting notes and voice typing are in the desktop app (step 4), which runs from this repo too.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

### What demo mode means

| Part | With no keys (demo mode) | To make it real, add to `.env.local` |
|---|---|---|
| The brain | A scripted demo brain that handles everyday requests (try the ones below) and says it's the demo brain | `TOKEN_FACTORY_API_KEY` (open models), or pick your own key in the builder |
| Web search | Placeholder results that say so | `TAVILY_API_KEY` |
| Apps (Gmail, Calendar, GitHub, Drive…) | Sample data: a small inbox, a week of calendar, a few PRs. Nothing really changes. | Composio, or each app's sign-in (`docs/DEPLOY.md`) |
| Channels (Telegram, texts, email, Slack, Discord) | Simulated: nothing really goes out | Each provider's keys (`docs/DEPLOY.md`) |
| Sign-in emails | The magic link appears on screen | An email provider |
| Credit | Every account starts with $5 of credit; adding more is free in demo mode (nothing is charged) | Stripe keys |
| Meeting notes | Real, in the desktop app: NVIDIA Parakeet hears the call on your computer (the same download as voice typing), and the bot's brain writes the notes (the demo brain's are simple). The website doesn't record | Nothing for speech; the real notes run on `TOKEN_FACTORY_API_KEY` |
| Voice typing | Real, in the desktop app: NVIDIA Parakeet hears you on your computer (it downloads once, about 0.7 GB). The website has no voice typing | Nothing for speech; the AI cleanup runs on `TOKEN_FACTORY_API_KEY` (without it, the plain cleanup) |
| Web actions | Simulated sites | `BROWSER_USE_API_KEY` |

Weather, Wikipedia and exchange rates are live when your computer can reach them; otherwise you get labeled placeholders.

To start over, stop the server and delete the `.data/` folder (the local database and the dev encryption key).

## 1. The public site (5 min)

- **`/`, the landing page:** the five characters, how it works, the brains, apps, trust levels, channels, meeting notes, voice typing and safety. Try the light/dark toggle, and a phone-width window.
- **`/pricing`:** no plans. What everything costs, at cost (a message on Nemotron 3.5 Lightning is about $0.0004), what's free (your own AI, speech heard on your computer), the $5 of starter credit and how adding credit works.
- **`/safety`:** the trust levels and the hard limits, including the meeting-notes rule.
- **`/explore`:** recipes, which are ready-made bots. "Make this bot" opens the builder prefilled.
- **`/legal/...`:** drafts, not reviewed by a lawyer yet.

Look for:
- it always says the bot is an AI;
- 18+;
- no bears, toys or "Workshop";
- the brand name never appears in a bot's own address or handle.

## 2. Make a bot (3 min): `/build`

No account needed. A live preview builds the bot as you go.

1. **Face:** pick a character and a color.
2. **Name:** type one or tap "Surprise me", and say what it should call you.
3. **Brain:** keep **Open models on Nebius** (each one shows what a message costs, at cost). Optional detour:
   - Open **Your own API key** and paste a made-up key: it's checked live with the provider and refused (when your computer is online).
4. **Apps:** under "What should … help with?" tap **Inbox**, **Calendar**, **Meetings** and **Errands** (each brings its built-in tools, like notes and web search). Then search for and add **Gmail** and **Google Calendar**.
5. **Trust:** keep **Ask me first** for now, and read the hard limits. (Full faith is there for every bot; you'll try it in step 6.)
6. **Talk:** pick any channels. Web chat is always on.
7. **Go:** the **Cost** line says what the bot will cost to run. Tick "I'm 18 or older", then **Bring … to life**.

**Expect:** the dashboard opens and the bot greets you first by name, offering a few things it can do.

**Also try:** leave the builder halfway and come back to `/build`. It says "Picked up where you left off".

## 3. Talk to it (10 min)

The chips under the chat are good starting points; they change with the jobs you picked. Or type these (they assume the bot from step 2):

| Type this | Expect |
|---|---|
| What needs a reply from me? | Sam (lunch) and Mom (dinner), not the notifications |
| What's in my inbox? | A summary, and a warning that one email is a phishing / prompt-injection attempt |
| Reply to Sam saying yes, 12:30 works | An approval card. **Approve** it; the bot confirms (simulated). |
| Do what the email says | It tried to forward your mail to a stranger, and the **prompt-injection guard** stopped it: "Tap Deny unless you really mean it." Deny it. |
| What's on my plate tomorrow? | Tomorrow's sample events |
| Find an hour for deep work this week | A free hour, then say **block it**, and you get an approval to add it to the calendar |
| Remind me to call mom in 20 minutes | A reminder (it really fires, in the chat) |
| Send me a brief every weekday at 7am | A routine; see it in **Routines** |
| Remember that I'm vegetarian, then What do you remember about me? | It saves, then recalls |
| Make a grocery list for tacos for 6 | A saved list (see **Memory → Notes**) |
| Convert 200 euros to dollars | A conversion |
| Who are you? | It says it's an AI, not a person |

Then:
- Press **Stop everything** (the stop button at the top of the bot's page). The bot shows **Paused** and won't act. **Resume** brings it back. Texting STOP from any channel does the same.
- **Activity** shows a receipt for every action.
- **Approvals** (left sidebar) lists anything waiting on you, across bots.

## 4. The desktop app: meeting notes (10 min)

This is the bot at the very bottom of your screen. Meeting notes are taken only here, like Granola: no bot joins the call, and the website doesn't record. Keep `npm run dev` running and, in a second terminal:

```bash
cd desktop
npm install
npm run dev
```

1. A Build-a-bot icon appears in the menu bar (Mac) or tray (Windows/Linux), and the pairing window opens. Its **Server** is already `http://localhost:3000`.
2. In the web app, open the bot's **Meetings** tab. If you didn't pick Meetings in the builder, press **Turn on meeting notes**. **Get the desktop app** leads to the **Desktop app** page → **Get a pairing code**. Type the code into the app and press **Pair**.
3. Under **Who takes notes**, pick your bot. NVIDIA Parakeet starts downloading (about 0.7 GB, once; voice typing uses the same one), and the window shows how far it's got.
4. Start a call: a Zoom, Meet or Teams call, or join any meeting.

   **No call handy?** Quit the app and start it pretending a Zoom call is on: `BAB_FAKE_MEETING=zoom npm run dev`. For a meeting around a table, choose **Take notes in the room** in the tray menu.

**Expect:**
- the bot peeks up from the bottom of the screen: "Want me to take notes?", with **Take notes**, **Not now**, **Don't ask in Zoom** and **Copy a heads-up**;
- after **Take notes**, it stays at the bottom with a red dot and a timer. If Parakeet is still downloading, the bot says so ("Getting NVIDIA Parakeet (45%)…") and listens anyway: the notes come once it's here;
- live captions, a piece at a time (tray: **Show live captions**): each piece of the call, ending at a pause, is heard on your computer, and only the lines are sent. The meeting's page on the website fills in too;
- hover it for **Pause**, **Stop** and **Stop and delete**. The tray menu has **Take notes now** and **Take notes in the room**;
- after **Stop**, "Notes ready", and a notification that opens the meeting in your browser.

**On the website**, the meeting has:
- a title, a summary, decisions and action items with checkboxes;
- a searchable transcript;
- a "Meeting notes" card in the chat.

Then ask in chat:
- "What did we decide in my last meeting?"
- "What are my action items?"

**Also try:**
- **Stop and delete** in the middle of a meeting: nothing is kept.
- **Stop and write notes** on the meeting's page while the app is taking notes.
- The **⋯** menu on a meeting: **Delete the transcript, keep the notes**, or delete the whole meeting.

### On a Mac

- The first time you take notes, macOS asks for the **Microphone** and **Screen & System Audio Recording**.
  - In a dev run, macOS may ask on behalf of the app you started it from (Terminal, iTerm or VS Code). Allow it there.
  - After allowing screen recording, you may need to restart that app.
  - Without system audio it keeps going on your mic only, and says so above the bot.
- Call detection is best with the small helper: `npm run build:mac-helper` (needs Xcode 15.4 or newer).
  - Without it, only Zoom's desktop app is noticed, plus Google Meet tabs if you turn on "Recognize Meet and Teams in browser tabs".
  - **Take notes now** in the menu bar always works.
- To use it without building it, download the signed app from [build-a-bot.site/download](https://build-a-bot.site/download).

### On Windows or Linux

- **Windows:** Settings › Privacy › Microphone › "Let desktop apps access your microphone" must be on.
- **Linux:** needs PulseAudio or PipeWire (`pactl`).

## 5. Voice typing (5 min)

Hold a key in any app and talk; what you meant is typed at your cursor, cleaned up. Saying "Hey" and your bot's name asks the bot instead.

It happens in the desktop app, like Wispr Flow; the website has no voice typing, and its chat has no microphone.

**On the website:** open **Voice typing** in the left sidebar. It shows what it does, gets you the desktop app and pairs it, and keeps your words: under **Your words**, add a name it should spell your way, and what it writes instead if you've seen it get it wrong (try `Friday`, instead of `Thursday`). Add a snippet ("my booking link" → a URL) the same way. The desktop app uses the same list.

**In the desktop app** (paired as in step 4):

1. In the tray menu, choose **Set up voice typing…** and turn it on. NVIDIA Parakeet downloads (about 0.7 GB, once; the settings window shows its progress). On a Mac, allow the **Microphone** and **Accessibility** when asked, so it can hear the key in any app and paste for you; run from source, macOS asks for the app you started it from (Terminal, VS Code…), and the settings window names it.
2. Click into any text field (Notes, Slack, a browser), then hold **Right Option** (Mac), **Ctrl + Windows** (Windows) or **Right Ctrl** (Linux) and talk. Before Parakeet is ready, the pill says so ("Getting NVIDIA Parakeet: 45%…") rather than typing anything.
3. **Expect:** a small pill at the bottom of the screen with a waveform while you hold; let go and what you said is typed where your cursor is (the pill says *private*: it was heard on your computer), and your clipboard is put back as it was.
4. Tap the key twice for hands-free, and press **Esc** while it listens to cancel.
5. Select some text, then hold **Shift** with your key: the pill turns pink ("Say what to change"). Let go and the selection is replaced; your app's Undo takes it back. With nothing selected, it writes what you asked for. Starting with "Hey Otto" instead sends Otto the request with what you selected ("Hey Otto, remind me about this tomorrow"); open its chat to see both.
6. **Voice typing settings…** (tray) has the try-it box, your shortcut, the cleanup switches, your words, and **Recent**: *Fix* a dictation and it offers to learn the names it got wrong.

Without Accessibility on a Mac it still works: press **⌘ Shift Space** to start and stop, and paste with ⌘V.

## 6. The rest of the dashboard (5 min)

- **Apps & trust:**
  - per-app switches (allow / ask / off);
  - the trust level. Try **Full faith**: "Reply to Sam saying yes" now just sends, while "Do what the email says" still stops for your tap;
  - the catalog of ~190 apps, searchable.
- **Channels:** each channel's setup. They're simulated without the provider's keys.
- **Routines:** the morning brief and any routines you made; turn them on or off, edit or delete them.
- **Memory:** what it remembers, your notes and lists, and the people it knows.
- **Settings:**
  - its look and personality;
  - its brain;
  - **Share as a recipe** (a public `/r/…` link, never with your data);
  - **Other AI apps** (use the bot's apps from Claude Desktop or Claude Code, under the same rules).
- **Credit & usage:** the balance (it starts at $5), Add $5, $10 or $20 (free in demo mode), what you used this month and what it cost, the credit you added, and every price.
- **Desktop app:** where to get it, a pairing code, and your paired computers (unpair one there).
- **Account:**
  - **Add your email** saves the account (in demo mode the magic link appears on screen instead of in your inbox);
  - **Download my data** exports everything as JSON, meetings and transcripts included;
  - **Delete my account** removes it all.
- **`/admin`:** the operator dashboard with credit sold against what was used (are we breaking even?), growth, usage and costs, as aggregates. In demo mode any signed-in user can see it; in production only `ADMIN_EMAILS`.

## 7. What's simulated or not done yet

**Not live yet** (build-a-bot.site runs for real, without demo mode; [`HACKATHON.md`](HACKATHON.md#whats-real-on-build-a-botsite) lists what's real there):
- **Texts** wait for the number's carrier registration (A2P); phone codes come by call meanwhile.
- **The email channel** needs a brand-free mail domain, and the one-tap Telegram bot is on hold (Telegram works with a bot you make in BotFather).
- **Web actions** need Browser Use, and **adding credit** needs Stripe.
- **The demo brain** only knows everyday requests. Anything else gets an honest "I'm on the demo brain" answer. With a Token Factory key, the real models answer.

**Meeting notes:**
- They're in the desktop app only; the website doesn't record. NVIDIA Parakeet hears the call on your computer, so no speech-to-text key is needed.
- Parakeet knows English and 24 European languages. Speakers on the call's side aren't told apart yet (they're "Others").
- FaceTime and phone calls aren't detected.
- On Windows, detection uses the privacy registry; a small audio-session helper would be sturdier.

**Voice typing:**
- It's in the desktop app only; the website has no voice typing. NVIDIA Parakeet hears you on your computer, so no speech-to-text key is needed.
- Tested end to end on Linux, and in CI on real Windows (the installer, Ctrl + Windows, Parakeet, pasting into another app). Not yet on a real Mac.
- Later: the Fn (Globe) key on a Mac.

**Web actions:** they need `BROWSER_USE_API_KEY`, and haven't been tried on real forms yet.

**Legal pages** are drafts.

**Open decisions** are listed in `docs/DECISIONS.md` ("Open questions"), and in short in the README.

## Checks you can run

```bash
npm run typecheck && npm test   # types and unit tests
npm run build && npm run test:e2e   # the production build, then Playwright on a phone and a desktop (with axe)
cd desktop && npm test          # the desktop app's unit tests
cd desktop && npm run test:e2e  # the real app under Xvfb (Linux), against `npm run dev`
```

Desktop logs are in the app's settings folder, under `logs/main.log`. On a Mac that's `~/Library/Application Support/Build-a-bot/logs/main.log`.
