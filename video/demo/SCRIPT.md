# The demo video: script and shot list

2:52, for the hackathon's Devpost page and YouTube (under 3 minutes, public). Everything on screen is the real product: build-a-bot.site in a browser, the real desktop app, and a real call through the voice server. The promo (`video/STORYBOARD.md`) sells the idea in a minute; this one shows it working. The cut is in `edit.mjs`; how it's made is in `README.md`.

Diego asked for it to start with him signing in and building a bot: a glance at the ready-made recipes, then his own bot, named by him. He's **Diego** in the video; his bot is **Juno** (Nimbus the cloud, in grape).

**Narrator:** a calm, neutral voice reading the lines below, third person ("Juno", "you"). Diego can read them himself instead (see README.md): one take, and `vo/split.py` cuts it into the sentences the edit places.

**What the hackathon asks for:** under 3 minutes, public on YouTube, the app actually working, and how it uses Nebius and NVIDIA. The video names each one aloud and on screen: NVIDIA Nemotron on Nebius Token Factory (the thinking), NVIDIA Parakeet and Magpie (hearing and speaking, on our voice server and on your computer), and Tavily (web search). The judges score Technological Implementation, Design, Potential Impact and Quality of the Idea.

## Beat by beat

| # | Time | Picture | Sound |
| - | - | - | - |
| 1 | 0:00 | **Cold open, a real call.** Juno's call panel beside big captions ("A REAL CALL"; chips: Parakeet hears, Magpie speaks, Nemotron thinks). | The call. Diego: "Hey Juno, when's my bio midterm?" Juno: "Let me check." … "Your BIO 101 midterm 2 is on Thursday, November 12, during your regular lecture time (9:30–10:45 AM in Science Hall 204)." (from the syllabus in its files) Narrator: "That's Juno." |
| 2 | 0:17 | **Meet Build-a-bot** (the promo's reveal): the characters, the logo, "Your own AI assistant, in about a minute." | "A personal AI you can actually call. And you can build one like it in about a minute on Build-a-bot." |
| 3 | 0:23 | **Sign in** with an email (the magic link's click is skipped). | "Sign in with just your email." |
| 4 | 0:27 | **The builder.** The ready-made recipes (Tutor, Job applier, Language partner, Fitness coach), then his own: Nimbus the cloud, grape, "Juno", "Diego". | "Start from a ready-made bot, or make your own. Pick a face, and a name." |
| 5 | 0:35 | **The brain:** Open models on Nebius; "Served from Nebius Token Factory … Every account starts with $5.00 of credit"; Nemotron 3.5 Lightning, ≈ $0.00042 a message (a push-in on the price). | "For its brain: NVIDIA Nemotron, running on Nebius Token Factory. You pay what it costs, and every account starts with five dollars. That's about twelve thousand messages." |
| 6 | 0:47 | **Apps, then trust:** School, Meetings, Research; Ask me first; "Always on, at every level — enforced in code". | "Tell it what to help with, and how much it can do on its own. On 'Ask me first,' it waits for your OK before it sends or changes anything, and that rule is enforced in code." |
| 7 | 0:58 | **Born:** the review, 18+, "Bring Juno to life", its first message. | "Then, bring it to life." |
| 8 | 1:03 | **Files:** a syllabus, a lecture and a photo of handwritten notes dropped on the chat; "Make me flashcards for my midterm."; it reads each file; 26 flashcards; a card's answer shows its source ("Lecture 9, p. 1"). | "Give Juno your files, even a photo of handwritten notes. It reads every page, and makes flashcards that show where each answer came from." |
| 9 | 1:15 | **Web search:** "Find me three AI internships for summer 2027 that are still taking applications." The search row with its sources; the answer, each with its source. | "It searches the web with Tavily, and shows its sources." |
| 10 | 1:22 | **Just call it:** the call opening (title "Just call it."), then back to the call: Juno explains what the midterm covers, Diego cuts in with a question, Juno answers, Diego asks for a reminder, Juno sets it. | "And you can just call it. NVIDIA Parakeet hears you, and NVIDIA Magpie talks back, on our own voice server. You can cut in anytime." Then the call: "Perfect. Quick one: what's the first stable molecule in the Calvin cycle?" "… 3-phosphoglycerate (3-PGA)." "Got it. Remind me to study tomorrow at 7 p.m." "I've set a reminder for 7:00 PM tomorrow." |
| 11 | 1:49 | **Voice typing** in the desktop app: an email to the lab group; hold Right Ctrl and talk; a subtitle shows what he said (with an "um" and a "Thursday. Actually, Wednesday."); the words land cleaned up; the pill says Private. | "The desktop app types for you, in any app. Hold one key, and talk." (his words) "Parakeet runs right on your computer, so your voice never leaves it." |
| 12 | 2:08 | **Meeting notes:** a call starts; Juno pops up and asks; Take notes; Maya: "Diego, you're on the methods section, right?" Diego: "Yeah, I'll have methods done by Thursday." (subtitled); "Writing your notes…"; "Your notes are ready!"; the notes: summary, decisions, action items with who owns each. | "In a meeting, Juno asks before it takes notes." (the meeting) "Parakeet hears the call on your computer, and Nemotron writes up what was decided, and who's doing what." |
| 13 | 2:26 | **Under the hood:** four columns: Nemotron 3.5 Lightning on Nebius Token Factory ($5 to start: about 12,000 messages); Parakeet and Magpie (our voice server; Parakeet on your computer); Tavily (answers show their sources); open source, Apache 2.0. | "Under the hood: NVIDIA Nemotron on Nebius Token Factory does the thinking. NVIDIA Parakeet and Magpie hear and speak on our voice server, and Parakeet runs right on your computer, too. Tavily searches the web. And all of it is open source." |
| 14 | 2:42 | **End card** (the promo's): the logo, "Own your AI.", build-a-bot.site. | "Build-a-bot. Your own AI, built in a minute, that you can just call. Try it free at build-a-bot dot site." |

## Every claim, and where it's true

- **Everything was recorded on 2026-10-28** on build-a-bot.site with a fresh account, signed in by email (`record/signin.mjs`), and the desktop app from `desktop/` paired to it.
- **The call (beats 1 and 10):** a real call in the browser through the voice server: NVIDIA Parakeet hears, Magpie speaks, Nemotron 3.5 Lightning talks, and Juno's own agent does the work (it read the syllabus for the midterm, and set the reminder). The edit trims waiting: the lookups (the panel still shows "Answered in 5.3 s", 3.8 s, 4.8 s) and the pauses Magpie leaves between sentences on the server's CPU. Diego's half of the call is a stand-in voice played into the page's microphone; it's heard by the real call, turn by turn.
- **"In about a minute":** the builder is seven short steps; the take was 61 seconds, and the edit speeds the clicking up.
- **"Every account starts with five dollars … about twelve thousand messages":** the brain step says "Every account starts with $5.00 of credit" and "≈ $0.00042 a message" for Nemotron 3.5 Lightning ($5 ÷ $0.00042 ≈ 11,900). Prices are Token Factory's, with nothing added.
- **"Ask me first … enforced in code":** the policy engine (`src/lib/policy/engine.ts`), not the prompt.
- **Files:** read once into passages with their page; the photo of notes through a vision model on Token Factory; each flashcard keeps its source. The class files are made up for the video (`props/`): BIO 101 and its syllabus aren't real.
- **Web search:** Tavily, on for every bot; each lookup costs 0.8¢ from the credit.
- **Voice typing:** NVIDIA Parakeet in the desktop app (NeMo-Speech.cpp) hears you; only the words go to the server, which cleans them up (the "um", and "Thursday. Actually, Wednesday." becomes "Wednesday"). The pill says Private.
- **Meeting notes:** the bot asks every time; the call is heard on the computer by Parakeet; Nemotron writes the notes. Notes don't tell voices apart yet, so in the meeting people say whose task is whose; the notes then name them right. The voices of Maya, Sam and Diego are stand-ins.
- **The desktop scenes** are the real desktop app (Electron) on Linux, recorded at 2× on a made-up desktop: a compose window and a video call window drawn for the video (`desktop/scene.cjs`), with the app's speech heard through a test microphone. The app runs the same way on a Mac or a PC.
- **What's hidden while recording:** the site's "save your account" nudges, and Chromium's link-preview bubble in one shot of the builder (patched with the same spot a moment later; it isn't part of the app).
- **Open source:** Apache 2.0.

## If Diego records his own narration

Read the whole script top to bottom in one take (a quiet room, a hand's width from the mic, a short pause between sentences), save it as a WAV, and `README.md` has the three commands that cut it into sentences and place them. The cut's timing allows for a slightly slower read; much slower and a beat gets a little longer.
