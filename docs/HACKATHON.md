# Build-a-bot: the judges' guide

Build-a-bot lets anyone make their own AI assistant in about a minute, then chat with it, call it, give it files, and have it take meeting notes and type by voice on their computer. It's our entry in the Nebius × NVIDIA Global AI Hackathon.

- **Try it:** [build-a-bot.site](https://build-a-bot.site). Every account starts with $5 of credit, no card needed.
- **Demo video (2:56):** [youtu.be/pamiWbqzm_s](https://youtu.be/pamiWbqzm_s)
- **Desktop app** for Mac and Windows (voice typing and meeting notes): [build-a-bot.site/download](https://build-a-bot.site/download)
- **The code:** this repository, open source under Apache 2.0. The overview is the [README](../README.md).

## For the judges (testing instructions)

1. Open [build-a-bot.site](https://build-a-bot.site) and click **Build your bot**. No account is needed to build one.
2. **Build it:**
   - Pick a face and a name.
   - Keep **Nemotron 3.5 Lightning** as the brain.
   - Add a couple of apps (Gmail and Google Calendar), and choose **Ask me first**.
   - Finish, and the bot greets you. Then sign in to the apps you added, with one click each, in its **Apps & channels** tab.

   Your first five messages are free. Then sign in with your email (it's free, and the link comes back to the same chat): your $5 of credit comes with it, and so do calls, routines, meeting notes and the desktop app. **Sign in before steps 4 to 6.** Each message's cost is on its receipt in **Settings › Activity**, at Token Factory's price; **Credit & usage** has the totals.
3. **Try it:** ask something that needs the web ("what's the weather in Austin this weekend and anything fun to do?"). Then, with Gmail added, ask for something that needs a yes from you ("email Sam that I'm running late"): it shows you the email and asks first.
4. **Call it:** click **Call** in the bot's header and allow the microphone.
   - NVIDIA Parakeet hears you and NVIDIA Magpie answers, both on our own server.
   - Nemotron 3.5 Lightning holds the conversation and hands real work to the bot ("what's on my calendar tomorrow?" with Google Calendar added, "remind me at five to call Sam").
   - Cut in whenever you like: it stops mid-word and listens.
   - When you hang up, the transcript is in the chat.
   - The voice server takes one call at a time. If someone else is on it, the bot's phone number still answers, on Twilio's own speech.
5. **Voice typing**, in the desktop app:
   - **Get it** from [build-a-bot.site/download](https://build-a-bot.site/download). On a Mac, open the disk image and double-click Build-a-bot (it moves itself into Applications). On Windows, open the installer (no questions, no admin).
   - **Pair it** from the **Desktop app** page.
   - **Turn on voice typing**, and let it download NVIDIA Parakeet once (about 0.7 GB).
   - **Use it:** hold the shortcut in any app and talk. The pill says *private* when it was heard on the computer.
6. **Meeting notes**, in the same app, with meeting notes on for the bot (its **Meetings** tab):
   - **Start a call** in Zoom, Meet or Teams, or choose **Take notes in the room** in the app's menu.
   - **The bot asks first.** While it listens, it sits at the bottom of the screen with live captions. Hide it to share your screen; the Build-a-bot icon then shows it's recording.
   - **When you stop**, the notes arrive in the chat and the **Meetings** tab: a summary, the decisions, and the action items, each with who and by when, as a checklist. Ask the bot to set reminders for your action items, or to draft a recap email for everyone, or "what did we decide?".

## What's real on build-a-bot.site

Nothing on the live site is simulated. Each service that isn't set up says "Coming soon". Demo mode simulates channels and apps that have no keys, for running a copy locally and for the end-to-end tests. It's off on build-a-bot.site.

| What | On build-a-bot.site |
| - | - |
| Building a bot, and chatting with it on the web | **Real.** The included brains are NVIDIA Nemotron and other open models on Token Factory. Five free messages come before signing in. Then you sign in with your email (a real link, sent by Resend), and the chat picks up where it was. |
| Your own AI key (Anthropic, OpenAI, Google Gemini, OpenRouter, any OpenAI-compatible endpoint) | **Real**, and free here: the provider bills you. |
| Web search, reading pages, the tutor's fact checks | **Real**, on Tavily, paid from credit at Tavily's price. Every bot can search. |
| Apps | **Real** wherever there's a way to sign in: about 100 apps, Gmail, Google Calendar and Drive among them: about 60 through Composio's one-click sign-in and about 40 through the app's own MCP sign-in. The rest say "Coming soon". |
| Your own MCP server | **Real.** Private addresses are refused. |
| Memory, reminders, routines, approvals, receipts, STOP | **Real.** |
| Files for your bot (Memory › Files) | **Real.** Files are stored privately and read into passages. Photos and scanned pages are read by a vision model on Token Factory. |
| Calls | **Real**: the **Call** button in the app (your browser's microphone), or the bot's phone number. Both use our voice server on a Google Cloud machine, with NVIDIA Parakeet and Magpie. When it can't take a call, Twilio's own speech does. Answers usually start about 3 seconds after you stop talking, and you can cut in. Calls aren't recorded. |
| Telegram | **Waitlist**, like WhatsApp and iMessage: not switched on for build-a-bot.site. The code is there. |
| Discord and Slack | **Real.** |
| Texts | **Coming soon**: the number waits for carrier registration (A2P). Phone codes come by call meanwhile. |
| The email channel, and the bot's own inbox | **Coming soon**: they need a brand-free mail domain. |
| Web actions (filling in forms in a cloud browser) | **Coming soon**: Browser Use isn't set up. |
| Adding credit | **Coming soon**, until Stripe is set up. Every account that signs in has $5 of starter credit. |
| The desktop app (Mac and Windows): voice typing and meeting notes | **Real**: signed, self-updating, from [build-a-bot.site/download](https://build-a-bot.site/download). NVIDIA Parakeet hears everything on the user's computer. build-a-bot.site has no speech-to-text of its own, so the audio never leaves the computer. |

## Does it qualify?

| Rule | Build-a-bot |
| - | - |
| Runs on Nebius Token Factory or Nebius AI Cloud (a runtime call to Token Factory, or deployed on Serverless AI) | Yes. Every included brain, the talker on calls, the meeting notes, voice typing's cleanup and reading photos of pages in a bot's files are Token Factory calls. The optional speech server (for computers that can't run Parakeet) is built to run as a Nebius Serverless AI endpoint (`speech/README.md`). |
| Uses at least one NVIDIA open model | Yes: Nemotron 3.5 Lightning (the default brain, and the talker on calls), Nemotron 3 Super and Nemotron 3 Ultra (harder jobs), Parakeet TDT 0.6B v3 (speech to text on the user's own computer, and on calls) and Magpie TTS Multilingual (the bot's voice on calls), both on NVIDIA NeMo-Speech.cpp, and Nemotron 3.5 ASR in the optional speech server. |
| New, or "significantly updated" during the submission period (from August 26) | New: the first commit is 2026-10-13. |
| Public repository with an open-source license shown on the repo page | Yes: `dpro10/build-a-bot` is public under Apache 2.0 since 2026-10-17, its history scanned for keys first. |
| A working demo URL, free to use for judges until judging ends | [build-a-bot.site](https://build-a-bot.site), in real mode (nothing simulated). Every account starts with $5 of credit, about 12,000 messages on Nemotron 3.5 Lightning, and no card is needed. |
| A public YouTube video under 3 minutes, no copyrighted music | Yes: [youtu.be/pamiWbqzm_s](https://youtu.be/pamiWbqzm_s), 2:56 of the real product recorded on 2026-10-28 and 29, with how NVIDIA and Nebius are used named aloud and on screen, over an original score. The script, and where each claim is true: [`video/demo/SCRIPT.md`](../video/demo/SCRIPT.md). |
| README with setup steps and how NVIDIA models, Token Factory and Nebius were used | Yes: the README's *Try it*, *Built on NVIDIA and Nebius* and *Run it on your own computer*. |
| Feedback on Token Factory, AI Cloud and NVIDIA tools | Below. |

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

Our drafts for Devpost and YouTube, and the checklist before submitting: [`docs/history/hackathon-submission.md`](history/hackathon-submission.md).
