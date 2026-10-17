# Build-a-bot in the Nebius × NVIDIA Global AI Hackathon (draft)

Diego (2026-10-15): "im in the nvidia x nebius hackathon and the more we create build-a-bot, the more i see how well it could fit there."

**Deadline:** Friday, October 30, 2026, 10:00 am Pacific, on Devpost
([nebiusglobalaihackathon.devpost.com](https://nebiusglobalaihackathon.devpost.com/)).
**Judging:** December 1–15. The demo has to keep working until then.

## Does it qualify?

| Rule | Build-a-bot |
| - | - |
| Runs on Nebius Token Factory or Nebius AI Cloud (a runtime call to Token Factory, or deployed on Serverless AI) | Yes. Every included brain, the talker on calls, the meeting notes, and voice typing's cleanup are Token Factory calls. The optional speech server (for computers that can't run Parakeet) runs as a Nebius Serverless AI endpoint (`speech/README.md`). |
| Uses at least one NVIDIA open model | Yes, six: Nemotron 3.5 Lightning (the default brain, and the talker on calls), Nemotron 3 Super and Nemotron 3 Ultra (for harder jobs), Parakeet TDT 0.6B v3 (speech to text: on the user's own computer, and on calls), Magpie TTS Multilingual (the bot's voice on calls), both through NVIDIA NeMo-Speech.cpp, and Nemotron 3.5 ASR (the speech server's other languages). |
| New, or "significantly updated" during the submission period (from August 26) | New: the first commit is 2026-10-13. |
| More than one entry | Not needed: Build-a-bot is Diego's only entry (Diego, 2026-10-16: "we're only going to enter build a bot. Not chef."). |
| Public repository with an open-source license shown on the repo page | **Not yet.** `dpro10/build-a-bot` is private, with no license. Diego decides (below). |
| A working demo URL, free to use for judges until judging ends | build-a-bot.site. Still in demo mode; see "For the judges". |
| A public YouTube video under 3 minutes, no copyrighted music | To record (script below). |
| README with setup steps and how NVIDIA models, Token Factory and Nebius were used | Done: README → *Built on NVIDIA and Nebius*. |
| Feedback on Token Factory, AI Cloud and NVIDIA tools | Drafted below. |

**Track:** **Personal AI** fits best. Its brief is "an always-on, private assistant that works for you while keeping your data under your control", with persistent memory, reusable skills, the tools you choose, and tasks across your day. That is Build-a-bot almost word for word. **Best Apps and Agents** is the second choice.

**Prizes it can reach:** the top three ($20,000, $10,000, $6,000), the Personal AI track (a Jetson Orin Nano), **Best Use of Tavily** ($3,000: the bots' web search and page reader run on Tavily), and Most Valuable Feedback ($100, ten of them).

## Diego's decisions

1. **Make the repository public, with a license.** It's required. Suggested: Apache 2.0, the license NVIDIA's NeMo-Speech.cpp uses (it includes a patent grant). Before going public:
   - The full history was scanned on 2026-10-16 for keys and tokens: none. The only key-shaped strings are test placeholders like `sk-test-not-a-real-key-1234567890`.
   - Diego's email is in the commit history as the author, as with any public repository.
   - Anyone could then run their own copy. The brand and the hosted service stay his; the license covers the code.
2. **Speech costs nothing now** (2026-10-16): the desktop app hears voice typing and meetings on the computer with NVIDIA Parakeet, so neither needs a speech server. Both are in the app only, like Wispr Flow and Granola: the website doesn't listen or record. A Together AI key or the Nebius endpoint is only a fallback now, for computers where Parakeet can't run.
3. **What judges can use:** the site is still in demo mode. Options:
   - leave demo mode on (the included Nemotron brain is real, sign-in links show on screen, channels are simulated);
   - or finish real mode first (the beta checklist in DECISIONS).
   - Either way it's free to try: there are no plans (Diego, 2026-10-16: people pay for what they use, at cost), and every account starts with $1 of credit, about 2,400 messages on Nemotron 3.5 Lightning. In demo mode, judges can add more credit for free from Credit & usage. `STARTER_CREDIT_USD` raises the starter credit if judges need more.
4. **Who records the video**, and whether Diego appears in it.

## For the judges (testing instructions draft)

1. Open [build-a-bot.site](https://build-a-bot.site) and click **Build your bot**. No account is needed to build one.
2. Pick a face and a name, keep **Nemotron 3.5 Lightning** as the brain, add a couple of apps, choose **Ask me first**, and finish. The bot greets you. Every account starts with $1 of credit, so nothing needs a card; **Credit & usage** shows what each message cost, at Token Factory's price.
3. Ask it something that needs the web ("what's the weather in Austin this weekend and anything fun to do?"), then something that needs a yes from you ("email Sam that I'm running late"): it asks first.
4. **Call it:** click **Call** in the bot's header and allow the microphone. NVIDIA Parakeet hears you and NVIDIA Magpie answers, both on our own server; Nemotron 3.5 Lightning holds the conversation and hands real work to the bot ("what's on my calendar tomorrow?", "remind me at five to call Sam"). Cut in whenever you like: it stops mid-word and listens. When you hang up, the transcript is in the chat.
5. **Voice typing:** in the desktop app: pair it, turn on voice typing, and let it download NVIDIA Parakeet (about 0.7 GB, once). Then hold the shortcut in any app and talk; the pill says *private* when it was heard on the computer. Get it from [build-a-bot.site/download](https://build-a-bot.site/download): on a Mac, open the disk image and double-click Build-a-bot (it moves itself into Applications); on Windows, open the installer (no questions, no admin). Both are signed and update themselves. Until the signed builds are published (`docs/DEPLOY.md` §9), the repository's **Desktop app (test build)** pre-release has both, unsigned. On the web, **Voice typing** shows what it does, gets you the app and pairs it.
6. **Meeting notes:** in the same app, with meeting notes on for the bot (its **Meetings** tab). Start a Zoom, Meet or Teams call, or choose **Take notes in the room** in the app's menu. The bot asks first, stays at the bottom of the screen with live captions, and when you stop, the notes (a summary, decisions, action items) are in the **Meetings** tab and in chat. Ask the bot "what did we decide?".

## Demo video script (about 2 minutes 55 seconds)

| Time | On screen | Said |
| - | - | - |
| 0:00 | The landing page | "Everyone wants their own AI assistant. Most people can't build one, and the ones you can buy can't do much, or can do too much. This is Build-a-bot." |
| 0:12 | The builder: face, name, brain, apps, trust | "Pick a face, a name and a brain: by default NVIDIA Nemotron 3.5 Lightning on Nebius Token Factory, so cheap that a message costs a twenty-fifth of a cent, and you pay only what the models cost. Give it your apps, then decide how much it does on its own. A policy engine enforces that in code, not in the prompt." |
| 0:35 | Chat: a web question, then an email that needs approval | "It searches the web with Tavily, and when it wants to send something, it asks first. Every action leaves a receipt." |
| 0:50 | Diego, away from his desk, calls his bot; the call view on screen: the bot's face talking, live transcript | "But the best part is you don't need a screen. Call it." *(On the call:)* "Hey Otto, what's on my calendar tomorrow?" … "Move the three o'clock to Friday and let Sam know." *(He cuts in mid-sentence; it stops and listens.)* |
| 1:20 | One slide: Parakeet, Magpie, Nemotron, the bot's agent | "NVIDIA Parakeet hears you and NVIDIA Magpie answers, both on our own server with NVIDIA's NeMo-Speech.cpp, so no speech API ever hears your voice. Nemotron 3.5 Lightning holds the conversation and hands the real work to your bot, with the same approvals as the chat. About a second and a quarter from when you stop talking to its first word." |
| 1:40 | Voice typing in Slack (the pill says *private*) | "On your computer, it types for you by voice in any app, with Parakeet running right on your laptop. Start with its name, and you're asking your bot instead." |
| 2:00 | A Zoom call; the bot peeks up and asks; then the notes in the Meetings tab | "It takes your meeting notes too, asking first. The audio never leaves your computer; Nemotron writes the summary, decisions and action items." |
| 2:20 | Memory: "Bring my memories" | "It remembers what matters, on any brain, and you can bring your memories from ChatGPT, Claude or Gemini." |
| 2:32 | One slide: Nemotron on Token Factory, Parakeet and Magpie on our server and your computer, Tavily | "Everything that thinks runs on NVIDIA's open models on Nebius, and everything that hears and speaks runs on NVIDIA's open models on hardware we control. Build-a-bot: your own AI, built in a minute, that you can just call." |

## Devpost write-up draft

**Tagline:** Your own AI agent in a minute, under your control: call it and it gets things done with your apps, asking before it acts. It also lives in your chats, takes your meeting notes and types for you by voice, and NVIDIA's open speech models hear you on hardware we control, never a speech API.

**What it does:** Build-a-bot lets anyone make a personal AI agent in about a minute: pick one of five characters, name it, choose a brain, give it apps, decide how much it can do on its own, and talk to it on Telegram, texts, email, Slack, Discord or the web. Or just call it: from the app, or from your phone, and it answers in its own voice in about a second, with your calendar, email and other apps behind it. It remembers what matters, keeps reminders and routines, reaches out first with a daily check-in, takes meeting notes, and types for you by voice in any app on your computer.

**How we built it:**
- **NVIDIA Nemotron on Nebius Token Factory** runs the included brains. Nemotron 3.5 Lightning is the default, chosen because it's fast and cheap: about $0.0004 for a typical message. There are no plans: people pay for what they use at Token Factory's price, with nothing added, and every account starts with $1 of credit. Nemotron 3 Super and Ultra take the harder jobs.
- **NVIDIA Parakeet TDT 0.6B v3 on the user's own computer** turns speech into text for voice typing and meeting notes. The desktop app downloads NVIDIA's NeMo-Speech.cpp runtime and the model once (about 0.7 GB, each checked against NVIDIA's published hash) and runs it on 127.0.0.1 behind a random key: on the GPU with Metal on Apple silicon, on the CPU elsewhere. For voice typing, only the words go to the server, to be cleaned up by Nemotron. For a meeting, each piece of the call (about 20 seconds, ending at a pause) is heard with each word's time, and only the transcript lines go to the server, where Nemotron writes the notes. The audio never leaves the computer, and there's no speech server to pay for.
- **Calls on NVIDIA's speech models, on our own server:** a voice server (TypeScript on Node, plus a small C++ program on NeMo-Speech.cpp's C API) keeps Parakeet and **NVIDIA Magpie TTS** loaded on a Google Cloud CPU machine, built from source for AVX-512 and AMX, with Magpie requantized to Q8_0. Silero VAD and a turn detector decide when you've finished. Nemotron 3.5 Lightning on Token Factory holds the conversation and hands real work to the bot's own agent (apps, memory, approvals, receipts), the front and back agents of NVIDIA's voice agent blueprint. It starts an answer at your first pause and holds it until you've really finished; Magpie's audio streams as it's made, and stops mid-word when you cut in. Measured on 4 vCPUs: about 1.3 seconds from when you stop talking to the bot's first word, on the phone and in the browser. Phone calls come in over Twilio Media Streams; who's calling decides what the bot will do (the owner, verified by the carrier or a spoken PIN, or anyone else, who can only leave a message). The audio is never kept.
- **The same models in the cloud, as a fallback:** Parakeet and Nemotron 3.5 ASR on NeMo-Speech.cpp in our own container for a Nebius Serverless AI endpoint, behind an OpenAI-compatible API, for computers that can't run Parakeet.
- **Tavily** is the bots' web search and page reader.
- Next.js on Vercel, Postgres, an Electron desktop app for voice typing and meeting notes, and a Google Compute Engine VM for calls.
- **Safety in code:** four trust levels enforced by a policy engine, a prompt-injection guard that asks before anything goes to someone new after the bot has read outside content, approvals and receipts for every action.

**Challenges:**
- Keeping an agent with real access safe without making it useless.
- Making speech-to-text good enough to beat dedicated dictation apps. We tested NVIDIA's models against each other on the same clips and found three quirks worth fixing (below).
- Shipping a 0.7 GB model inside a consumer app without making anyone wait: it downloads in the background as soon as the computer is paired (resuming if the connection drops). A call that starts before it's here is still recorded; the pieces wait on the computer and are heard once it arrives, and the notes are written only once every piece is in.
- Sharing one engine between voice typing and a meeting: a dictation goes ahead of the meeting's pieces, because the owner is waiting at their cursor.
- A call that feels like a conversation on CPUs alone. Magpie on NVIDIA's prebuilt binary was slower than real time on our machine; a build for the CPU's AVX-512 and AMX, Q8_0 weights and splitting the cores between Magpie and its codec made it fast enough to stream. Then turn-taking: starting the answer at the first pause, knowing when someone has really finished, and remembering exactly what the caller heard before they cut in, so the bot never claims to have said what it didn't.

**What's next:**
- The bot calls you back when a long job is done, and a call can start your other agents: your own coding agent on your computer, research, the cloud browser.
- Calls heard and spoken on your own computer's GPU when it's on, with the server as the fallback.
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
- Nemotron 3.5 Lightning's price made pay-as-you-go at cost possible: $1 of starter credit is about 2,400 messages.
- Parakeet was word-perfect on our test clips, about 5× faster than real time on four CPU cores, and never invented words in silence.
