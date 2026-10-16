# Build-a-bot in the Nebius × NVIDIA Global AI Hackathon (draft)

Diego (2026-10-15): "im in the nvidia x nebius hackathon and the more we create build-a-bot, the more i see how well it could fit there."

**Deadline:** Friday, October 30, 2026, 10:00 am Pacific, on Devpost
([nebiusglobalaihackathon.devpost.com](https://nebiusglobalaihackathon.devpost.com/)).
**Judging:** December 1–15. The demo has to keep working until then.

## Does it qualify?

| Rule | Build-a-bot |
| - | - |
| Runs on Nebius Token Factory or Nebius AI Cloud (a runtime call to Token Factory, or deployed on Serverless AI) | Yes. Every included brain is a Token Factory call. Speech-to-text runs as a Nebius Serverless AI endpoint once it's deployed (`speech/README.md`). |
| Uses at least one NVIDIA open model | Yes, five: Nemotron 3.5 Lightning (the default brain), Nemotron 3 Super (Plus), Nemotron 3 Ultra (Pro), Parakeet TDT 0.6B v3 and Nemotron 3.5 ASR (speech). |
| New, or "significantly updated" during the submission period (from August 26) | New: the first commit is 2026-10-13. |
| More than one entry | Allowed if each is "unique and substantially different". Diego's other entry (the Nemotron worker in cookbook-dispatch) is a different product. |
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
2. **Turn speech on:** create the Nebius endpoint (`speech/README.md`, about 10 minutes), then add three variables in Vercel. About $190 a month on a CPU machine, so roughly $380 through the end of judging (less if it's stopped when not needed).
3. **What judges can use:** the site is still in demo mode. Options:
   - leave demo mode on (the included Nemotron brain is real, sign-in links show on screen, channels are simulated);
   - or finish real mode first (the beta checklist in DECISIONS).
4. **Who records the video**, and whether Diego appears in it.

## For the judges (testing instructions draft)

1. Open [build-a-bot.site](https://build-a-bot.site) and click **Build your bot**. No account is needed to build one.
2. Pick a face and a name, keep **Nemotron 3.5 Lightning** as the brain, add a couple of apps, choose **Ask me first**, and finish. The bot greets you.
3. Ask it something that needs the web ("what's the weather in Austin this weekend and anything fun to do?"), then something that needs a yes from you ("email Sam that I'm running late"): it asks first.
4. **Voice typing:** sign in (the link appears on screen), open **Voice typing**, hold the mic and talk.

## Demo video script (about 2 minutes 50 seconds)

| Time | On screen | Said |
| - | - | - |
| 0:00 | The landing page | "Everyone wants their own AI assistant. Most people can't build one, and the ones you can buy can't do much, or can do too much. This is Build-a-bot." |
| 0:15 | The builder: face, name, brain | "Pick a face, give it a name, and choose its brain. By default that's NVIDIA Nemotron 3.5 Lightning on Nebius Token Factory: fast and cheap enough to include for free. Bigger jobs can use Nemotron 3 Super or Ultra." |
| 0:35 | Apps and trust | "Give it your apps: Gmail, calendar, GitHub, about 190 of them. Then decide how much it does on its own. A policy engine enforces that in code, not in the prompt." |
| 0:55 | Chat: a web question, then an email that needs approval | "It searches the web with Tavily. When it wants to send something, it asks first, and every action leaves a receipt." |
| 1:15 | Telegram on a phone | "It lives where you talk: Telegram, texts, email, Slack, Discord." |
| 1:30 | Voice typing in Slack, then "Hey Otto, add this to my calendar" with text selected | "It types for you by voice in any app. Speech-to-text is NVIDIA Parakeet, on our own server at Nebius, so your voice never goes to a third-party API, and it's thrown away once it's text. Start with its name, and you're asking your bot instead." |
| 2:00 | Memory: "Bring my memories" | "It remembers what matters, on any brain, and you can bring your memories from ChatGPT, Claude or Gemini." |
| 2:15 | Meeting notes | "It can sit in on your calls and write the notes, again with NVIDIA's speech models." |
| 2:30 | One slide: Nemotron on Token Factory, Parakeet and Nemotron ASR on Nebius Serverless AI, Tavily | "Everything that thinks or listens runs on NVIDIA's open models on Nebius. Build-a-bot: your own AI, built in a minute, under your control." |

## Devpost write-up draft

**Tagline:** Your own AI agent in a minute, under your control: it lives where you talk, uses your apps, asks before it acts, and types for you by voice.

**What it does:** Build-a-bot lets anyone make a personal AI agent in about a minute: pick one of five characters, name it, choose a brain, give it apps, decide how much it can do on its own, and talk to it on Telegram, texts, email, Slack, Discord or the web. It remembers what matters, keeps reminders and routines, reaches out first with a daily check-in, takes meeting notes, and types for you by voice in any app on your computer.

**How we built it:**
- **NVIDIA Nemotron on Nebius Token Factory** runs the included brains. Nemotron 3.5 Lightning is the default, chosen because it's fast and cheap enough (about $4–5 a month per active bot) to include on the free plan; Nemotron 3 Super and Ultra serve the paid plans' harder jobs.
- **NVIDIA Parakeet TDT 0.6B v3 and Nemotron 3.5 ASR** turn speech into text for voice typing and meeting notes. They run on NVIDIA's NeMo-Speech.cpp in our own container on a Nebius Serverless AI endpoint, behind an OpenAI-compatible API.
- **Tavily** is the bots' web search and page reader.
- Next.js on Vercel, Postgres, and an Electron desktop app for voice typing and meeting notes.
- **Safety in code:** four trust levels enforced by a policy engine, a prompt-injection guard that asks before anything goes to someone new after the bot has read outside content, approvals and receipts for every action.

**Challenges:**
- Keeping an agent with real access safe without making it useless.
- Making speech-to-text good enough to beat dedicated dictation apps. We tested NVIDIA's models against each other on the same clips and found three quirks worth fixing (below).

**What's next:**
- Stream the audio while you talk, with NVIDIA's realtime WebSocket, for near-instant typing.
- An on-device mode with the same NVIDIA runtime in the desktop app.
- A front desk for small businesses.

## Feedback for Nebius and NVIDIA (from building this)

**NVIDIA NeMo-Speech.cpp 0.2.0:**
- Its HTTP transcription endpoint reads only WAV. Browsers and Electron record Opus in WebM or Ogg, so every web app needs a conversion step. Accepting those would make it a drop-in OpenAI replacement.
- The published Nemotron 3.5 ASR GGUF has no embedded tokenizer, so word boosting is silently disabled. The only sign is a log line: "RNNT word boosting requested but no phrases could be tokenized". A reconverted GGUF, or a 400 error, would help.
- The OpenAI-style `prompt` field becomes one boosted phrase. Clients written for Whisper send a sentence of context there, so it's quietly misread.
- Language codes: bare `ko` works but bare `ja`, `zh`, `vi` and `tr` fall back to English without an error. Accepting ISO 639-1 codes, or refusing unknown ones, would avoid silent mistakes.
- The cache-aware Nemotron model drops the last word of a clip ("ten A" for "ten AM") unless silence is added after it. Flushing at the end of the input would fix that.
- English inverse text normalization writes "three thirty" as "03:30". Parakeet itself sometimes writes "3.30".

**Nebius:**
- **Token Factory** has no speech-to-text models. Parakeet and Nemotron ASR as serverless models would let apps like ours skip running a server.
- **Serverless AI endpoints** were easy to fit (any container, a managed HTTPS URL, token auth). They don't scale to zero yet, so a bursty workload like voice typing pays for an always-on machine; per-request billing or scale-to-zero would suit it.

**What worked well:**
- Token Factory's OpenAI-compatible API meant one client for every included model.
- Nemotron 3.5 Lightning's price made a free plan possible.
- Parakeet was word-perfect on our test clips, about 5× faster than real time on four CPU cores, and never invented words in silence.
