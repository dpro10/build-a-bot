# Try it: a guide for reviewing Build-a-bot

A walk through everything that's built, about 45 minutes end to end. It all runs on your own computer in demo mode, so no keys are needed and nothing is sent anywhere.

If something looks wrong, note the page, what you clicked and what you expected. A screenshot helps. The terminal running `npm run dev` shows server errors.

## 0. Start it

You need Node 22.12 or newer. For meeting notes in the browser, use Chrome or Edge on a computer.

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
| Payments | Plans switch without paying | Stripe keys |
| Meeting transcripts | A scripted meeting plays, whatever is said | The speech server (`speech/`, run it locally with Docker) and `TRANSCRIBE_PROVIDER=nvidia`, `TRANSCRIBE_BASE_URL`, `TRANSCRIBE_API_KEY`; or a Together AI or Groq key |
| Voice typing | It types sample sentences, whatever is said (marked *Demo*) | The same speech-to-text settings; the AI cleanup runs on `TOKEN_FACTORY_API_KEY` |
| Web actions | Simulated sites | `BROWSER_USE_API_KEY` |

Weather, Wikipedia and exchange rates are live when your computer can reach them; otherwise you get labeled placeholders.

To start over, stop the server and delete the `.data/` folder (the local database and the dev encryption key).

## 1. The public site (5 min)

- **`/`, the landing page:** the five characters, how it works, the brains, apps, trust levels, channels, meeting notes, voice typing and safety. Try the light/dark toggle, and a phone-width window.
- **`/pricing`:** Free, Plus ($12) and Pro ($39), monthly or yearly.
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
3. **Brain:** keep **Free open models**. Optional detours:
   - Open **Your own API key** and paste a made-up key: it's checked live with the provider and refused (when your computer is online).
   - Open **Your Claude or ChatGPT plan** to see how the Bridge works.
4. **Apps:** under "What should … help with?" tap **Inbox**, **Calendar**, **Meetings** and **Errands** (each brings its built-in tools, like notes and web search). Then search for and add **Gmail** and **Google Calendar**.
5. **Trust:** keep **Ask me first** for now, and read the hard limits. (Full faith is a Plus feature; demo mode lets you try it without paying, in step 6.)
6. **Talk:** pick any channels. Web chat is always on.
7. **Go:** tick "I'm 18 or older", then **Bring … to life**.

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

## 4. Meeting notes in the browser (5 min, Chrome or Edge)

1. Open the bot's **Meetings** tab and press **Turn on meeting notes** (if you didn't pick Meetings in the builder).
2. Press **Start taking notes**. The first time, a short consent note appears: tick it, then **Got it**.
3. Choose **A call in another tab** (share the call's tab, with "Also share tab audio" on) or **In person, or on speaker** (the mic only). **Copy** gives you a heads-up to paste into the call's chat.
4. Press **Start taking notes**. A small floating window opens with the bot listening: a red dot, a timer and a level meter. The tab shows live captions.
5. In demo mode a scripted meeting about a launch plan plays as the transcript, whatever you actually say. With `TRANSCRIBE_API_KEY` set, it's your real words.
6. After a minute, press **Stop and write notes**.

**Expect:**
- a title, a summary, decisions and action items with checkboxes;
- a searchable transcript;
- a "Meeting notes" card in the chat.

Then ask in chat:
- "What did we decide in my last meeting?"
- "What are my action items?"

**Also try:**
- **Stop and delete** in the middle of a meeting: nothing is kept.
- Close the floating window: recording stops and the notes get written. It never listens out of sight.
- The **⋯** menu on a meeting: **Delete the transcript, keep the notes**, or delete the whole meeting.
- Safari, or a phone: it explains that it needs Chrome or Edge on a computer, or the desktop app.

## 5. The desktop app (10 min)

This is the bot at the very bottom of your screen. Keep `npm run dev` running and, in a second terminal:

```bash
cd desktop
npm install
npm run dev
```

1. A Build-a-bot icon appears in the menu bar (Mac) or tray (Windows/Linux), and the pairing window opens. Its **Server** is already `http://localhost:3000`.
2. In the web app, open **Bridge (your computer)** → **Desktop app** → **Get a pairing code**. Type the code into the app and press **Pair**.
3. Under **Who takes notes**, pick your bot. If it says so, press **Turn on meeting notes**.
4. Start a call: a Zoom, Meet or Teams call, or join any meeting.

   **No call handy?** Quit the app and start it pretending a Zoom call is on: `BAB_FAKE_MEETING=zoom npm run dev`.

**Expect:**
- the bot peeks up from the bottom of the screen: "Want me to take notes?", with **Take notes**, **Not now**, **Don't ask in Zoom** and **Copy a heads-up**;
- after **Take notes**, it stays at the bottom with a red dot and a timer;
- hover it for **Pause**, **Stop** and **Stop and delete**. The tray menu has **Show live captions** and **Take notes now**;
- after **Stop**, "Notes ready", and a notification that opens the meeting in your browser.

### On a Mac

- The first time you take notes, macOS asks for the **Microphone** and **Screen & System Audio Recording**.
  - In a dev run, macOS may ask on behalf of the app you started it from (Terminal, iTerm or VS Code). Allow it there.
  - After allowing screen recording, you may need to restart that app.
  - Without system audio it keeps going on your mic only, and says so above the bot.
- Call detection is best with the small helper: `npm run build:mac-helper` (needs Xcode 15.4 or newer).
  - Without it, only Zoom's desktop app is noticed, plus Google Meet tabs if you turn on "Recognize Meet and Teams in browser tabs".
  - **Take notes now** in the menu bar always works.
- The app isn't signed yet (see "What's not done"), so this only works as a dev run for now.

### On Windows or Linux

- **Windows:** Settings › Privacy › Microphone › "Let desktop apps access your microphone" must be on.
- **Linux:** needs PulseAudio or PipeWire (`pactl`).

## 6. Voice typing (5 min)

Hold a key in any app and talk; what you meant is typed at your cursor, cleaned up. Saying "Hey" and your bot's name asks the bot instead.

**In the browser:** open **Voice typing** in the left sidebar.

1. Under **Try it**, hold the mic button for a few seconds (say anything; demo mode doesn't hear you yet) and let go.
2. **Expect:** one of four sample sentences, with its ums, repeats and "no wait" taken out, typed into the box at the cursor, like "I was thinking we could move the team meeting to Friday at 3." **You said** / **It typed** shows the before and after. Hold again: the next one lands where the cursor is.
3. Click the button once instead of holding: it keeps listening (hands-free) until you click again.
4. Press **Try "Hey …"** (next to *Demo*): your bot is asked "Remind me to call Mom tomorrow at 5." and answers right there, with a link to its chat, where the exchange is kept.
5. Select some text in the box and hold the mic: the demo hears "Make this friendlier." and changes the selection in place (**It changed it to** shows the result). The new text stays selected, so you can change it again.
6. Under **Your words**, add a name it should spell your way, and what it writes instead if you've seen it get it wrong (try `Friday`, instead of `Thursday`). Add a snippet ("my booking link" → a URL) the same way. The desktop app uses the same list.

**In the desktop app** (paired as in step 5):

1. In the tray menu, choose **Set up voice typing…** and turn it on. On a Mac, allow **Accessibility** when asked (in a dev run it's listed as **Electron**), so it can hear the key in any app and paste for you.
2. Click into any text field (Notes, Slack, a browser), then hold **Right Option** (Mac), **Ctrl + Windows** (Windows) or **Right Ctrl** (Linux) and talk.
3. **Expect:** a small pill at the bottom of the screen with a waveform while you hold; let go and the sentence is typed where your cursor is, and your clipboard is put back as it was.
4. Tap the key twice for hands-free, and press **Esc** while it listens to cancel.
5. Select some text, then hold **Shift** with your key: the pill turns pink ("Say what to change"). Let go and the selection is replaced; your app's Undo takes it back. With nothing selected, it writes what you asked for. Starting with "Hey Otto" instead sends Otto the request with what you selected ("Hey Otto, remind me about this tomorrow"); open its chat to see both.
6. **Voice typing settings…** (tray) has the try-it box, your shortcut, the cleanup switches, your words, and **Recent**: *Fix* a dictation and it offers to learn the names it got wrong.

Without Accessibility on a Mac it still works: press **⌘ Shift Space** to start and stop, and paste with ⌘V.

## 7. The rest of the dashboard (5 min)

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
- **Plan & usage:** switch plans (free in demo mode) and watch the meters, meeting minutes and voice typing words included.
- **Bridge (your computer):** pairing for the Bridge (subscription brains) and the desktop app.
- **Account:**
  - **Add your email** saves the account (in demo mode the magic link appears on screen instead of in your inbox);
  - **Download my data** exports everything as JSON, meetings and transcripts included;
  - **Delete my account** removes it all.
- **`/admin`:** the operator dashboard with revenue, growth, usage and costs, as aggregates. In demo mode any signed-in user can see it; in production only `ADMIN_EMAILS`.

## 8. What's simulated or not done yet

**Not live yet:**
- build-a-bot.site is live, but in demo mode until the last keys are in.
- **Real channels** need accounts: a Telegram manager bot, a Twilio number (plus A2P registration for texts), a brand-free email domain, and Slack and Discord apps.
- **The demo brain** only knows everyday requests. Anything else gets an honest "I'm on the demo brain" answer. With a Token Factory key, the real models answer.
- **Subscriptions (the Bridge):** it runs on a computer that has the `claude` or `codex` CLI installed and signed in.
  - Pair it from **Bridge (your computer)**.
  - On your own computer the app shows commands that run from this folder, like `node bridge/bab-bridge.mjs pair ABCD-1234 --server http://localhost:3000`, then `node bridge/bab-bridge.mjs` to start it.
  - On a deployment it shows `npx -y https://build-a-bot.site/downloads/build-a-bot-bridge-0.1.0.tgz …`: the site serves its own copy of the Bridge, so it works without the repo or anything on npm.

**Meeting notes:**
- The Mac app isn't signed or notarized yet. That needs a Developer ID certificate and notarization credentials in CI secrets, built on a Mac.
- FaceTime and phone calls aren't detected.
- On Windows, detection uses the privacy registry; a small audio-session helper would be sturdier.
- In a browser, the floating window can't be placed at the bottom of the screen (browsers don't allow it). The desktop app can.

**Voice typing:**
- Real speech-to-text needs `TRANSCRIBE_API_KEY`; in demo mode it types sample sentences.
- Tested end to end on Linux (real key presses, pasting into another app). Not yet on a Mac or Windows.
- Later: the Fn (Globe) key on a Mac, and rewriting selected text by voice.

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
