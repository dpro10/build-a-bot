# The hackathon submission (2026-10-30)

Our drafts for Devpost and YouTube in the Nebius × NVIDIA Global AI Hackathon, and the checklist before submitting. Diego submitted Build-a-bot on 2026-10-30. The judges' guide is [`docs/HACKATHON.md`](../HACKATHON.md).

Diego (2026-10-15): "im in the nvidia x nebius hackathon and the more we create build-a-bot, the more i see how well it could fit there."

**Deadline:** Friday, October 30, 2026, 10:00 am Pacific, on Devpost
([nebiusglobalaihackathon.devpost.com](https://nebiusglobalaihackathon.devpost.com/)).
**Judging:** December 1–15. The demo has to keep working until then.

**More than one entry:** not needed: Build-a-bot is Diego's only entry (Diego, 2026-10-16: "we're only going to enter build a bot. Not chef.").

**Track:** **Personal AI** fits best. Its brief is "an always-on, private assistant that works for you while keeping your data under your control", with persistent memory, reusable skills, the tools you choose, and tasks across your day. That is Build-a-bot almost word for word. **Best Apps and Agents** is the second choice.

**Prizes it can reach:**
- The top three: $20,000, $10,000 and $6,000.
- The Personal AI track: a Jetson Orin Nano.
- **Best Use of Tavily** ($3,000). The bots' web search and page reader run on Tavily, and the tutor checks its flashcards and quizzes against the student's course with it.
- Most Valuable Feedback: $100, ten of them.

## Before submitting (Diego)

1. **Demo mode off** on the live site: **done** on 2026-10-22. `DEMO_MODE` is deleted in Vercel, the site was redeployed, and nothing simulated is left (`docs/DECISIONS.md`, "demo mode off on the live site").
2. **The support email:** **done** on 2026-10-23. diegoprozzi@gmail.com is the site's default (`src/lib/site.ts`), shown on the legal, safety, pricing and contact pages.
3. **Zero data retention** for the included models: **done** on 2026-10-24, in Token Factory's settings ("Enable zero data retention").
   - It applies to the whole organization (every project and key). Prompts and replies are no longer kept: by default Token Factory keeps them in Finland to speed up answers.
   - It may make answers a little slower, and Data Lab stops collecting logs (build-a-bot doesn't use it).
   - Nebius support can confirm it in writing.
   - The promo's "zero data retention" line is true now.
4. **The repository page:** **done** on 2026-10-24. The description is the elevator pitch (below), the website is `https://build-a-bot.site`, and the topics are set.

   The old "Desktop app (test build)" pre-release goes on its own: the desktop workflow removes it now that both apps are signed.
5. **The video:** **done** on 2026-10-30. It's public on YouTube: https://youtu.be/pamiWbqzm_s (2:56, narrated; the narrator, the caller and the meeting voices are synthesized stand-ins). The link goes in Devpost's video field.
6. **Submit on Devpost** by October 30, 10:00 am Pacific: **done** on 2026-10-30.

## Demo video

On YouTube: https://youtu.be/pamiWbqzm_s. The cut, beat by beat, with where each claim is true: [`video/demo/SCRIPT.md`](../../video/demo/SCRIPT.md). How it's recorded and rebuilt, and how to swap in Diego's own voice: [`video/demo/README.md`](../../video/demo/README.md).

**For YouTube** (Public; Audience: "No, it's not made for kids"; Category: Science & Technology; Language: English):

- **Title:** `Build-a-bot: your own AI, built in a minute, that you can just call (NVIDIA × Nebius demo)`
- **Description:**

  ```text
  Build-a-bot lets anyone make a personal AI assistant in about a minute, then call it, give it files, have it search the web, type for you by voice, and take meeting notes. Everything in this video is the real product: build-a-bot.site and its desktop app, recorded on October 28 and 29, 2026.

  How it uses NVIDIA and Nebius
  • Thinking: NVIDIA Nemotron 3.5 Lightning, served from Nebius Token Factory at cost. Every account starts with $5 of credit, about 12,000 messages.
  • Calls: NVIDIA Parakeet (speech to text) and NVIDIA Magpie (text to speech) on our own voice server.
  • Desktop app: NVIDIA Parakeet runs on your computer for voice typing and meeting notes, so your voice never leaves it.
  • Web search: Tavily, with sources.

  0:00 Build-a-bot: the website and its recipes
  0:17 Sign in and build a bot: a face and a name
  0:32 Its brain: 12 open models on Nebius (NVIDIA Nemotron), with zero data retention
  0:47 Apps, "Ask me first", and where you talk to it
  1:12 Files into flashcards, and web search with Tavily
  1:32 Just call it: NVIDIA Parakeet + Magpie
  2:04 Voice typing on your computer
  2:21 Meeting notes
  2:38 Under the hood

  Try it: https://build-a-bot.site
  Open source (Apache 2.0): https://github.com/dpro10/build-a-bot

  About this video: the narrator, the caller and the people in the meeting are synthesized stand-in voices. Waiting (lookups, notes being written) is trimmed; the call panel shows the real response times.
  ```

- **Thumbnail:** `video/out/demo/thumbnail.jpg` ("Just call it.": Juno's call panel picking up), or a frame YouTube offers.

## Devpost write-up draft

**For the form:**
- **Elevator pitch** (195 of Devpost's 200 characters): `Your own AI agent in a minute: NVIDIA Nemotron on Nebius, your apps, approvals enforced in code. Call it or chat with it; it turns meetings into action items and types by voice, on your computer.`
- **Try it out:** https://build-a-bot.site, https://github.com/dpro10/build-a-bot and https://build-a-bot.site/download
- **Video:** https://youtu.be/pamiWbqzm_s
- **Track:** Personal AI. Also enter **Best Use of Tavily**.
- **Built with:** `nvidia-nemotron`, `nvidia-parakeet`, `nvidia-magpie`, `nemo-speech.cpp`, `nebius-token-factory`, `tavily`, `composio`, `mcp`, `next.js`, `react`, `typescript`, `postgresql`, `vercel`, `electron`, `twilio`, `google-cloud`

The sections below fill in **About the project**.

**What it does:** Build-a-bot lets anyone make a personal AI agent in about a minute.
- **Make it:** pick one of five characters, name it, choose a brain and give it apps. Then decide how much it can do on its own.
- **Talk to it** on the web, Slack or Discord (texts and email are coming).
- **Or just call it,** from the app or from your phone. It answers in its own voice, usually about three seconds after you stop talking, with your calendar, email and other apps behind it.
- **It keeps up with you:** it remembers what matters, keeps reminders and routines, and reaches out first with a daily check-in.
- **After a meeting, your action items are waiting.** On your computer, it takes notes in Zoom, Meet or Teams (it asks first). When the call ends it sends you the summary, the decisions and the action items: who does what, by when, as a checklist you tick off. Ask it to set reminders for yours, or to email everyone a recap.
- **It types for you by voice** in any app on your computer.

**How we built it:**
- **NVIDIA Nemotron on Nebius Token Factory** runs the included brains.
  - Nemotron 3.5 Lightning is the default, chosen because it's fast and cheap: about $0.0004 for a typical message.
  - There are no plans: people pay for what they use at Token Factory's price, with nothing added, and every account starts with $5 of credit.
  - Nemotron 3 Super and Ultra take the harder jobs.
  - **Zero data retention** is on for our Token Factory organization: Nebius keeps none of the included models' prompts or replies.
- **NVIDIA Parakeet TDT 0.6B v3 on the user's own computer** turns speech into text for voice typing and meeting notes.
  - **Setup:** the desktop app downloads the model once (about 0.7 GB, checked against NVIDIA's published hash) and runs it with NVIDIA's NeMo-Speech.cpp on 127.0.0.1 behind a random key, on the GPU with Metal on Apple silicon and on the CPU elsewhere. On the Mac the runtime is downloaded the same way. On Windows it comes inside our installer, and we sign NVIDIA's program files with our own certificate: Windows 11's Smart App Control won't run unsigned code it doesn't know.
  - **Voice typing:** only the words go to the server, to be cleaned up by Nemotron.
  - **Meetings:** each piece of the call (about 20 seconds, ending at a pause) is heard with each word's time. Only the transcript lines go to the server, where Nemotron writes the notes: a summary, decisions, open questions and the action items (who, what, by when), turned into a checklist. That call has no tools at all, so nothing said in a meeting can make the bot act. Reminders and recap emails come when you ask, through the bot's usual approvals.
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
- **Built, not switched on: the same models in the cloud.** Parakeet and Nemotron 3.5 ASR on NeMo-Speech.cpp, in our own container for a Nebius Serverless AI endpoint, behind an OpenAI-compatible API, for computers that can't run Parakeet and the languages it doesn't speak. build-a-bot.site doesn't run it: there, everything is heard on the user's own computer.
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
- Asking your bot by name in voice typing ("Hey Otto, …") for every name: names written as one word ("BotTest") and names the speech model mishears.
- The bot calls you back when a long job is done.
- A call can start your other agents: your own coding agent on your computer, research, the cloud browser.
- Calls heard and spoken on your own computer's GPU when it's on, with the server as the fallback.
- Faster answers on calls: a bigger voice machine, and starting Nemotron while you're still talking.
- Stream the audio while you talk, with NVIDIA's realtime WebSocket, for near-instant typing.
- Telling the people on a call apart, with NVIDIA's Sortformer in the same engine, and naming each one from what's said ("Thanks, Maria"), so every action item has the right name.
- A front desk for small businesses.
