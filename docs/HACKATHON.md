# Build-a-bot in the Nebius × NVIDIA Global AI Hackathon

Diego (2026-10-15): "im in the nvidia x nebius hackathon and the more we create build-a-bot, the more i see how well it could fit there."

**Deadline:** Friday, October 30, 2026, 10:00 am Pacific, on Devpost
([nebiusglobalaihackathon.devpost.com](https://nebiusglobalaihackathon.devpost.com/)).
**Judging:** December 1–15. The demo has to keep working until then.

## Does it qualify?

| Rule | Build-a-bot |
| - | - |
| Runs on Nebius Token Factory or Nebius AI Cloud (a runtime call to Token Factory, or deployed on Serverless AI) | Yes. Every included brain, the talker on calls, the meeting notes, voice typing's cleanup and the Library's reading of photos are Token Factory calls. The optional speech server (for computers that can't run Parakeet) is built to run as a Nebius Serverless AI endpoint (`speech/README.md`). |
| Uses at least one NVIDIA open model | Yes: Nemotron 3.5 Lightning (the default brain, and the talker on calls), Nemotron 3 Super and Nemotron 3 Ultra (harder jobs), Parakeet TDT 0.6B v3 (speech to text on the user's own computer, and on calls) and Magpie TTS Multilingual (the bot's voice on calls), both on NVIDIA NeMo-Speech.cpp, and Nemotron 3.5 ASR in the optional speech server. |
| New, or "significantly updated" during the submission period (from August 26) | New: the first commit is 2026-10-13. |
| More than one entry | Not needed: Build-a-bot is Diego's only entry (Diego, 2026-10-16: "we're only going to enter build a bot. Not chef."). |
| Public repository with an open-source license shown on the repo page | Yes: `dpro10/build-a-bot` is public under Apache 2.0 since 2026-10-17, its history scanned for keys first. |
| A working demo URL, free to use for judges until judging ends | [build-a-bot.site](https://build-a-bot.site), in real mode (nothing simulated). Every account starts with $5 of credit, about 12,000 messages on Nemotron 3.5 Lightning, and no card is needed. |
| A public YouTube video under 3 minutes, no copyrighted music | To record (script below). The one-minute promo in `video/` (Otto's own Magpie voice, an original score) can open it. |
| README with setup steps and how NVIDIA models, Token Factory and Nebius were used | Done: README → *Built on NVIDIA and Nebius*. |
| Feedback on Token Factory, AI Cloud and NVIDIA tools | Below. |

**Track:** **Personal AI** fits best. Its brief is "an always-on, private assistant that works for you while keeping your data under your control", with persistent memory, reusable skills, the tools you choose, and tasks across your day. That is Build-a-bot almost word for word. **Best Apps and Agents** is the second choice.

**Prizes it can reach:**
- The top three: $20,000, $10,000 and $6,000.
- The Personal AI track: a Jetson Orin Nano.
- **Best Use of Tavily** ($3,000). The bots' web search and page reader run on Tavily, and the tutor checks its flashcards and quizzes against the student's course with it.
- Most Valuable Feedback: $100, ten of them.

## Before submitting (Diego)

1. **Demo mode off** on the live site: **done** on 2026-10-22. `DEMO_MODE` is deleted in Vercel, the site was redeployed, and nothing simulated is left (`docs/DECISIONS.md`, "demo mode off on the live site").
2. **The support email:** **done** on 2026-10-23. diegoprozzi@gmail.com is the site's default (`src/lib/site.ts`), shown on the legal, safety, pricing and contact pages.
3. **Zero data retention** for the included models, in the Token Factory console.
4. **The repository page:** the website (build-a-bot.site), a description and topics. Delete the old "Desktop app (test build)" pre-release: the signed builds replaced it.
5. **The video:** record it from the script below and put it on YouTube.
6. **Submit on Devpost** by October 30, 10:00 am Pacific.

## What's real on build-a-bot.site

Nothing on the live site is simulated. Each service that isn't set up says "Coming soon". Demo mode simulates channels and apps that have no keys, for running a copy locally and for the end-to-end tests. It's off on build-a-bot.site.

| What | On build-a-bot.site |
| - | - |
| Building a bot, and chatting with it on the web | **Real.** The included brains are NVIDIA Nemotron and other open models on Token Factory. Five free messages come before signing in. Then you sign in with your email (a real link, sent by Resend), and the chat picks up where it was. |
| Your own AI key (Anthropic, OpenAI, Google Gemini, OpenRouter, any OpenAI-compatible endpoint) | **Real**, and free here: the provider bills you. |
| Web search, reading pages, the tutor's fact checks | **Real**, on Tavily, paid from credit at Tavily's price. |
| Apps | **Real** wherever there's a way to sign in: about 70 apps through Composio's one-click sign-in, and about 35 through the app's own MCP sign-in. The rest say "Coming soon". So do Gmail, Calendar and Drive through Google's own MCP servers, until Google approves a client. |
| Your own MCP server | **Real.** Private addresses are refused. |
| Memory, reminders, routines, approvals, receipts, STOP | **Real.** |
| The Library (your files, for your bot) | **Real.** Files are stored privately and read into passages. Photos and scanned pages are read by a vision model on Token Factory. |
| Calls | **Real**: the **Call** button in the app (your browser's microphone), or the bot's phone number. Both use our voice server on a Google Cloud machine, with NVIDIA Parakeet and Magpie. When it can't take a call, Twilio's own speech does. Answers usually start about 3 seconds after you stop talking, and you can cut in. Calls aren't recorded. |
| Telegram | **Real**, with a bot you make in BotFather (the one-tap managed bot is on hold). |
| Discord and Slack | **Real.** |
| Texts | **Coming soon**: the number waits for carrier registration (A2P). Phone codes come by call meanwhile. |
| The email channel, and the bot's own inbox | **Coming soon**: they need a brand-free mail domain. |
| Web actions (filling in forms in a cloud browser) | **Coming soon**: Browser Use isn't set up. |
| Adding credit | **Coming soon**, until Stripe is set up. Every account has its $5 of starter credit. |
| The desktop app (Mac and Windows): voice typing and meeting notes | **Real**: signed, self-updating, from [build-a-bot.site/download](https://build-a-bot.site/download). NVIDIA Parakeet hears everything on the user's computer. build-a-bot.site has no speech-to-text of its own, so the audio never leaves the computer. |

## For the judges (testing instructions)

1. Open [build-a-bot.site](https://build-a-bot.site) and click **Build your bot**. No account is needed to build one.
2. **Build it:**
   - Pick a face and a name.
   - Keep **Nemotron 3.5 Lightning** as the brain.
   - Add a couple of apps, and choose **Ask me first**.
   - Finish, and the bot greets you.

   Your first five messages are free. After that, sign in with your email (the link comes back to the same chat), and your $5 of credit takes over. **Credit & usage** shows what each message cost, at Token Factory's price.
3. **Try it:** ask something that needs the web ("what's the weather in Austin this weekend and anything fun to do?"). Then ask something that needs a yes from you ("email Sam that I'm running late"): it asks first.
4. **Call it:** click **Call** in the bot's header and allow the microphone.
   - NVIDIA Parakeet hears you and NVIDIA Magpie answers, both on our own server.
   - Nemotron 3.5 Lightning holds the conversation and hands real work to the bot ("what's on my calendar tomorrow?", "remind me at five to call Sam").
   - Cut in whenever you like: it stops mid-word and listens.
   - When you hang up, the transcript is in the chat.
5. **Voice typing**, in the desktop app:
   - **Get it** from [build-a-bot.site/download](https://build-a-bot.site/download). On a Mac, open the disk image and double-click Build-a-bot (it moves itself into Applications). On Windows, open the installer (no questions, no admin).
   - **Pair it** from the **Desktop app** page.
   - **Turn on voice typing**, and let it download NVIDIA Parakeet once (about 0.7 GB).
   - **Use it:** hold the shortcut in any app and talk. The pill says *private* when it was heard on the computer.
6. **Meeting notes**, in the same app, with meeting notes on for the bot (its **Meetings** tab):
   - **Start a call** in Zoom, Meet or Teams, or choose **Take notes in the room** in the app's menu.
   - **The bot asks first.** While it listens, it sits at the bottom of the screen with live captions. Hide it to share your screen; the Build-a-bot icon then shows it's recording.
   - **When you stop**, the notes (a summary, decisions, action items) are in the **Meetings** tab and in the chat. Ask the bot "what did we decide?".

## Demo video script (about 2 minutes 55 seconds)

| Time | On screen | Said |
| - | - | - |
| 0:00 | The landing page | "Everyone wants their own AI assistant. Most people can't build one, and the ones you can buy can't do much, or can do too much. This is Build-a-bot." |
| 0:12 | The builder: face, name, brain, apps, trust | "Pick a face, a name and a brain: by default NVIDIA Nemotron 3.5 Lightning on Nebius Token Factory, so cheap that a message costs a twenty-fifth of a cent, and you pay only what the models cost. Give it your apps, then decide how much it does on its own. A policy engine enforces that in code, not in the prompt." |
| 0:35 | Chat: a web question, then an email that needs approval | "It searches the web with Tavily, and when it wants to send something, it asks first. Every action leaves a receipt." |
| 0:50 | Diego, away from his desk, calls his bot; the call view on screen: the bot's face talking, live transcript | "But the best part is you don't need a screen. Call it." *(On the call:)* "Hey Otto, what's on my calendar tomorrow?" … "Move the three o'clock to Friday and let Sam know." *(He cuts in mid-sentence; it stops and listens.)* |
| 1:20 | One slide: Parakeet, Magpie, Nemotron, the bot's agent | "NVIDIA Parakeet hears you and NVIDIA Magpie answers, both on our own server with NVIDIA's NeMo-Speech.cpp. Nemotron 3.5 Lightning holds the conversation and hands the real work to your bot, with the same approvals as the chat. Cut in whenever you like." |
| 1:40 | Voice typing in Slack (the pill says *private*) | "On your computer, it types for you by voice in any app, with Parakeet running right on your laptop. Start with its name, and you're asking your bot instead." |
| 2:00 | A Zoom call; the bot peeks up and asks; then the notes in the Meetings tab | "It takes your meeting notes too, asking first, and the audio stays on your computer; Nemotron writes the summary, decisions and action items." |
| 2:20 | Memory: "Bring my memories" | "It remembers what matters, on any brain, and you can bring your memories from ChatGPT, Claude or Gemini." |
| 2:32 | One slide: Nemotron on Token Factory, Parakeet and Magpie on our server and your computer, Tavily | "Everything that thinks runs on NVIDIA's open models on Nebius. What hears and speaks runs on NVIDIA's open models too: on our own server for calls, and on your own computer for voice typing and meetings. Build-a-bot: your own AI, built in a minute, that you can just call." |

## Devpost write-up draft

**Tagline:** Your own AI agent in a minute, under your control: call it and it gets things done with your apps, asking before it acts. It also lives in your chats, takes your meeting notes and types for you by voice, with NVIDIA's open speech models hearing you on your own computer or our own server.

**What it does:** Build-a-bot lets anyone make a personal AI agent in about a minute.
- **Make it:** pick one of five characters, name it, choose a brain and give it apps. Then decide how much it can do on its own.
- **Talk to it** on the web, Slack, Discord or Telegram (texts and email are coming).
- **Or just call it,** from the app or from your phone. It answers in its own voice, usually about three seconds after you stop talking, with your calendar, email and other apps behind it.
- **It keeps up with you:** it remembers what matters, keeps reminders and routines, and reaches out first with a daily check-in.
- **On your computer,** it takes meeting notes and types for you by voice in any app.

**How we built it:**
- **NVIDIA Nemotron on Nebius Token Factory** runs the included brains.
  - Nemotron 3.5 Lightning is the default, chosen because it's fast and cheap: about $0.0004 for a typical message.
  - There are no plans: people pay for what they use at Token Factory's price, with nothing added, and every account starts with $5 of credit.
  - Nemotron 3 Super and Ultra take the harder jobs.
- **NVIDIA Parakeet TDT 0.6B v3 on the user's own computer** turns speech into text for voice typing and meeting notes.
  - **Setup:** the desktop app downloads NVIDIA's NeMo-Speech.cpp runtime and the model once (about 0.7 GB, each checked against NVIDIA's published hash). It runs them on 127.0.0.1 behind a random key, on the GPU with Metal on Apple silicon and on the CPU elsewhere.
  - **Voice typing:** only the words go to the server, to be cleaned up by Nemotron.
  - **Meetings:** each piece of the call (about 20 seconds, ending at a pause) is heard with each word's time. Only the transcript lines go to the server, where Nemotron writes the notes.
  - On build-a-bot.site the audio never leaves the computer, and there's no speech server to pay for.
- **Calls on NVIDIA's speech models, on our own server.**
  - **The server:** TypeScript on Node, plus a small C++ program on NeMo-Speech.cpp's C API. It keeps Parakeet and **NVIDIA Magpie TTS** loaded on a Google Cloud CPU machine, built from source for AVX-512 and AMX, with Magpie requantized to Q8_0.
  - **Turn-taking:** Silero VAD and a turn detector decide when you've finished.
  - **The agents:** Nemotron 3.5 Lightning on Token Factory holds the conversation and hands real work to the bot's own agent (apps, memory, approvals, receipts). These are the front and back agents of NVIDIA's voice agent blueprint.
  - **Streaming:** it starts an answer at your first pause and holds it until you've really finished. Magpie's audio streams as it's made, and stops mid-word when you cut in.
  - **Speed:** in our benchmark, with a scripted talker on 4 vCPUs, the bot's first word comes about 1.3 seconds after you stop. On live calls, where Nemotron thinks first, it's usually about 3 seconds.
  - **Phone calls** come in over Twilio Media Streams; when the voice server can't take one, Twilio's own speech does.
  - **Who's calling** decides what the bot will do. The owner is verified by the carrier or a spoken PIN; anyone else can only leave a message.
  - Calls aren't recorded.
- **The same models in the cloud, as a fallback:** Parakeet and Nemotron 3.5 ASR on NeMo-Speech.cpp, in our own container for a Nebius Serverless AI endpoint, behind an OpenAI-compatible API, for computers that can't run Parakeet.
- **Tavily** is the bots' web search and page reader, and the tutor's fact checker.
  - **Finding the course:** from a syllabus, the tutor finds the course online once: its pages on the school's site, and open textbooks on the subject. It keeps them in a note the student can edit.
  - **Checking answers:** before it saves flashcards or a quiz, it checks every answer that isn't from the student's files, one search per claim. It prefers the course's own sites and open textbooks, and leaves out homework-answer and pirated-book sites.
  - **Sources:** each card shows its source, and a link is kept only if Tavily really returned that page.
  - **When the web disagrees with the class,** it says both and goes with the class for exams.
- **The stack:** Next.js on Vercel, Postgres, an Electron desktop app for voice typing and meeting notes, and a Google Compute Engine VM for calls.
- **Safety in code:**
  - four trust levels, enforced by a policy engine;
  - a prompt-injection guard that asks before anything goes to someone new after the bot has read outside content;
  - approvals and receipts for every action;
  - addresses other people choose kept off our own network;
  - daily ceilings shared out, so no one account can use up a day for everyone.

**Challenges:**
- Keeping an agent with real access safe without making it useless.
- Making speech-to-text good enough to beat dedicated dictation apps. We tested NVIDIA's models against each other on the same clips and found three quirks worth fixing (below).
- **Shipping a 0.7 GB model inside a consumer app without making anyone wait.** It downloads in the background as soon as the computer is paired, and resumes if the connection drops. A call that starts before it arrives is still recorded: the pieces wait on the computer and are heard once it's there. The notes are written only once every piece is in.
- Sharing one engine between voice typing and a meeting: a dictation goes ahead of the meeting's pieces, because the owner is waiting at their cursor.
- **A call that feels like a conversation on CPUs alone.**
  - On NVIDIA's prebuilt binary, Magpie was slower than real time on our machine.
  - Three changes made it fast enough to stream: a build for the CPU's AVX-512 and AMX, Q8_0 weights, and splitting the cores between Magpie and its codec.
  - Then turn-taking: starting the answer at the first pause, knowing when someone has really finished, and remembering exactly what the caller heard before they cut in, so the bot never claims to have said what it didn't.

**What's next:**
- The bot calls you back when a long job is done.
- A call can start your other agents: your own coding agent on your computer, research, the cloud browser.
- Calls heard and spoken on your own computer's GPU when it's on, with the server as the fallback.
- Faster answers on calls: a bigger voice machine, and starting Nemotron while you're still talking.
- Stream the audio while you talk, with NVIDIA's realtime WebSocket, for near-instant typing.
- Telling the call's speakers apart, with NVIDIA's Sortformer in the same engine.
- A front desk for small businesses.

## Feedback for Nebius and NVIDIA (from building this)

**NVIDIA NeMo-Speech.cpp 0.2.0:**
- Its HTTP transcription endpoint reads only WAV. Browsers and Electron record Opus in WebM or Ogg, so every web app needs a conversion step. Accepting those would make it a drop-in OpenAI replacement.
- The published Nemotron 3.5 ASR GGUF has no embedded tokenizer, so word boosting is silently disabled. The only sign is a log line: "RNNT word boosting requested but no phrases could be tokenized". A reconverted GGUF, or a 400 error, would help.
- The OpenAI-style `prompt` field becomes one boosted phrase. Clients written for Whisper send a sentence of context there, so it's quietly misread.
- Language codes: bare `ko` works but bare `ja`, `zh`, `vi` and `tr` fall back to English without an error. Accepting ISO 639-1 codes, or refusing unknown ones, would avoid silent mistakes.
- The cache-aware Nemotron model drops the last word of a clip ("ten A" for "ten AM") unless silence is added after it. Flushing at the end of the input would fix that.
- English inverse text normalization writes "three thirty" as "03:30". Parakeet itself sometimes writes "3.30".
- **Magpie on a CPU server, for calls:**
  - The prebuilt Linux binaries are built for AVX2 only. On 4 Sapphire Rapids vCPUs, Magpie F16 on them ran at 0.53× real time, too slow to stream. Built from source for AVX-512 and AMX, with Q8_0 weights, it ran at 0.93×. A prebuilt with CPU variants picked at run time (ggml can do this) would make CPU servers fast out of the box.
  - `pull magpie` gets the F16 GGUF, while NVIDIA's own benchmarks use Q8_0, and the converter that makes Q8_0 needs PyTorch and the 1.5 GB `.nemo`. (We requantize the F16 GGUF's projection tensors with the `gguf` package, matching `conversion/tts.py`. NVIDIA has since put a Q8_0 GGUF on Hugging Face, on 2026-10-15.)
  - The Magpie GGUF that v0.2.0's model index pins names its voices in the wrong order. Its `speaker_names` say John, Sofia, Aria, Jason, Leo, but the voices are Aria, Jason, John, Leo and Sofia (the `.nemo`'s own speakers.json), so `--voice Aria` speaks as John. Hugging Face has the fix (2026-10-15, same weights), but v0.2.0's `pull` still gets the old file. We found out because a tester said "Leo" sounded like a woman.
  - Classifier-free guidance is on by default, and it's worth keeping. We turned it off to save time, and Magpie read noticeably slower, with longer pauses: one voice went from 183 words a minute to 147. On a CPU it costs almost nothing, because the codec sets the speed (1.03× real time with it, 1.04× without, on 4 vCPUs). A note saying so would save others the same mistake.
  - Magpie's decoder and its codec run at the same time and compete for cores. `codec_threads` exists; a word on splitting them (2 + 2 was best on 4 vCPUs) would save others the search.
  - The HTTP server's `/v1/audio/speech` sends audio only once a whole sentence is made. The C API's PCM callback streams as it goes and can cancel mid-word, which is what a call needs; streaming over HTTP would make that available without C++.
  - Cancelling a synthesis from the callback logs it as an error.
- **Parakeet for calls:** TDT 0.6B v3 hears whole utterances only, so we run it at the caller's first pause (to start an answer early) and again when they finish. The ASR C API also has no thread setting, unlike TTS's.
- **What made the call server easy:** a stable C API (`asr.h`, `tts.h`) with a streaming PCM callback and cancel; word boosting through speech contexts (the bot's and owner's names); and a model index with every file's revision, size and SHA-256, which let our container fetch exactly what `pull` would, with no NVIDIA binary in the loop.
- **What made on-device easy:** prebuilt releases for macOS (Metal), Windows and Linux with published SHA-256s, an OpenAI-style `serve` with a `/ready` check, and the API key taken from the environment (so it isn't visible in the process list). `verbose_json` gives each word's time, after inverse text normalization, so the words match the text: that made meeting transcripts with timed lines easy. A signed macOS build (it's ad-hoc signed) and an official "download the model" manifest would make it easier still.

**Nebius:**
- **Token Factory** has no speech-to-text models. Parakeet and Nemotron ASR as serverless models would let apps like ours skip running a server.
- **Serverless AI endpoints** were easy to fit (any container, a managed HTTPS URL, token auth). They don't scale to zero yet, so a bursty workload like voice typing pays for an always-on machine (about $190 a month for a small one). That's why voice typing and meeting notes moved onto the user's computer; per-request billing or scale-to-zero would have kept them in the cloud.

**What worked well:**
- Token Factory's OpenAI-compatible API meant one client for every included model.
- Nemotron 3.5 Lightning's price made pay-as-you-go at cost possible: $5 of starter credit is about 12,000 messages.
- Parakeet was word-perfect on our test clips, about 5× faster than real time on four CPU cores, and never invented words in silence.
