# The demo video: script and shot list

2:48, for the hackathon's Devpost page and YouTube (under 3 minutes). Everything on screen is the real product on build-a-bot.site, the real desktop app, or a real call. The promo (`video/STORYBOARD.md`) sells the idea in a minute; this one shows it working. The cut is in `edit.mjs`; how it's built is in `README.md`.

**Narrator:** Otto, in its own voice (NVIDIA Magpie TTS, voice Sofia, the voice it uses on calls and in the promo), in the first person. Diego can record the same lines himself instead (`vo/lines.json`); the timing works either way.

**What the judges score:** Technological Implementation, Design, Potential Impact, Quality of the Idea. Each beat earns at least one.

## Beat by beat

| # | Time | Picture | Sound |
| - | - | - | - |
| 1 | 0:00 | **Cold open, a real call.** The call panel beside big captions: "A REAL CALL". | The call itself. Diego: "Hey Otto, when's my bio midterm again?" Otto (from the syllabus in its Library): "Your bio midterm is on Thursday, October 29, during lecture time, 9:30 to 10:45 AM, in Science Hall 204." Diego cuts in: "Perfect. Quiz me on my Calvin cycle notes." |
| 2 | 0:14 | **Who that was.** The characters pop in; the logo; "Your own AI assistant, in about a minute." (the promo's reveal) | Otto: "Hi! I'm Otto, Diego's AI tutor. He made me in about a minute, on Build-a-bot." |
| 3 | 0:20 | **Building Otto.** The builder with the ready-made Tutor: a purple Otto, "Diego", the brain (Nemotron 3.5 Lightning), Credit & usage ("About 2,400 messages"), the apps, Ask me first, "Bring Otto to life", its first message. | Otto: "He picked my face, my name, and my brain: NVIDIA Nemotron, on Nebius Token Factory. A dollar of credit is about twenty-four hundred messages, at cost. Then, he chose my apps, and how much I can do, on my own. One tap, and I came to life." |
| 4 | 0:46 | **Asks first.** "Email Professor Okafor at mokafor@example.edu that I'll miss office hours Wednesday…" The drafted email waits on Approve / Deny; Approve; "Approved and done". | Otto: "On Ask me first, I ask before I act, and every action leaves a receipt. That rule lives in code, not just in my prompt." |
| 5 | 0:57 | **The Library.** The syllabus, the slides and a photo of handwritten notes dragged onto the chat; "Make me flashcards from these for my midterm." Otto reads each file (the tool rows), makes 11 flashcards (each cites its page); a card flips. A practice quiz: one right (with its explanation), one wrong (the right answer and why), the score. | Otto: "He gave me his class files: the syllabus, the slides, even a photo of his handwritten notes. I read every page, and I point to where each answer came from. Then I make flashcards that space out his reviews, and practice quizzes, scored, with an explanation for every answer." |
| 6 | 1:26 | **A folder that stays in step.** The desktop app's card ("'Bio 101' → Otto · 3 files"); the Library tab with the files and study sets. | Otto: "With the desktop app, he can give me a whole folder, and I keep up, as it changes." |
| 7 | 1:32 | **Just call it.** The call opening ("Just call it."), then back to the quiz: "Here's your first question: what is the first stable molecule produced during carbon fixation in the Calvin cycle?" "The stroma." Otto corrects him kindly (3-PGA; the stroma is where it happens). "Remind me to study at seven tonight." "Done! I've set a reminder…" | Otto (over the call opening): "And he can just call me: from the app, or from his phone. NVIDIA Parakeet hears him and NVIDIA Magpie is my voice, both on our own server. He can cut in anytime." Then the call. |
| 8 | 2:10 | **Voice typing.** *For now:* the app's Voice typing page, pushing in on "you say / it types". *Better:* Diego's own recording. | Otto: "On his computer, I type for him by voice, in any app. Parakeet runs right on his laptop, so his voice never leaves it." |
| 9 | 2:19 | **Meeting notes.** *For now:* the Meetings tab. *Better:* Diego's recording of Otto popping up on a call. | Otto: "When a meeting starts, I ask before I take notes. Then I write up the summary, the decisions, and who's doing what." |
| 10 | 2:26 | **How it's built.** Three columns: Nemotron on Nebius Token Factory (about 2,400 messages for $1); Parakeet and Magpie on NeMo-Speech.cpp, on our server and on your computer; open source, Apache 2.0. | Otto: "I think with NVIDIA Nemotron, on Nebius. I hear and speak with NVIDIA Parakeet and Magpie, on our own server, or right on your computer. And every line of me is open source." |
| 11 | 2:39 | **End card** (the promo's): the logo, "Own your AI.", build-a-bot.site, all five characters. | Otto: "Build-a-bot. Your own AI, built in a minute, that you can just call. Try it free at build-a-bot dot site." |

## Every claim, and where it's true

- **The call (beats 1 and 7):** a real browser call on build-a-bot.site through the voice server: NVIDIA Parakeet hears, Magpie speaks, Nemotron 3.5 Lightning holds the conversation. The midterm answer comes from the syllabus in Otto's Library, because the call hands the question to Otto's own agent, which reads the file. Since PRs #54 and #58, a quiz on a call is one short question out loud. The reminder is real. The edit trims dead air: the wait while Otto looks something up, and the pauses Magpie leaves between sentences on the server's CPU (live calls have them). Diego's half of the call is a stand-in voice (Magpie "Jason") until he records his own lines.
- **"In about a minute":** the builder is seven short steps; the edit speeds the clicking up.
- **"A dollar of credit is about twenty-four hundred messages, at cost":** Credit & usage turns the balance into messages: "About 2,400 messages on Nemotron 3.5 Lightning" for a dollar. The cut was recorded when accounts started with $1; since 2026-10-21 they start with $5, about 12,000 messages. Prices are Token Factory's, with nothing added.
- **"I ask before I act … lives in code":** the policy engine (`src/lib/policy/engine.ts`), not the prompt. It was recorded while the site still ran in demo mode, where the email send was simulated, so the cut ends at "Approved and done". On the live site (demo mode off since 2026-10-22), the same approval sends through the Gmail you connect.
- **The Library:** files are read once into passages with their page, photos and scans through a vision model on Token Factory; answers cite the file and page; flashcards use spaced repetition; quizzes are scored with an explanation for each answer.
- **The folder:** the desktop app keeps one folder in step with a bot's Library (desktop 0.1.40). The screenshot is the real app, paired with build-a-bot.site.
- **"From the app or his phone":** browser calls and phone calls (Twilio) both reach the voice server.
- **"His voice never leaves it":** voice typing hears you with NVIDIA Parakeet in the desktop app (Private speech); only the words go to the server.
- **Meeting notes:** the bot asks every time before taking notes; the call is heard on the computer; Nemotron writes the summary, decisions and action items.
- **Open source:** Apache 2.0 since 2026-10-17.
- **What's hidden while recording:** the demo site's yellow "Demo mode" strip and a guest account's "Save your account" nudges (`record/recorder.mjs`). Everything else is as the site shows it.
- **The class files** are made up for the video (`props/`): Dr. Maya Okafor and BIO 101 aren't real.

## What Diego records (about 20 minutes)

1. **His half of the call: 6 short files.** In a quiet room, a hand's width from the Mac's mic, in QuickTime (File › New Audio Recording) or Voice Memos, one file per line, half a second of silence before and after. Name them `line1.wav` … as below (any format; Claude converts):
   1. `line1`: "Hey Otto, when's my bio midterm again?"
   2. `line2`: "Perfect. Quiz me on my Calvin cycle notes." (said as an interruption: a little quicker)
   3. `line3a`: "The stroma."
   4. `line3b`: "Rubisco. It grabs carbon dioxide." (Otto's question varies; the recorder plays whichever answers it)
   5. `line4`: "Remind me to study at seven tonight."
   6. `line5`: "Thanks, Otto. Bye!"

   Claude plays them into a real call (`CALLER_DIR=… node video/demo/record/call.mjs`), so the call on screen is real and the voice is his.
2. **Voice typing, about 10 seconds.** A screen recording (Cmd+Shift+5, the whole screen) of Slack or Notes: hold the shortcut, say "Hey team, quick update: the demo's ready, and I'll send the link after class", let go, and let the words land. Do Not Disturb on, desktop tidy.
3. **Meeting notes, about 15 seconds.** A screen recording: start a Zoom or Google Meet test call (or the menu's *Take notes in the room*), wait for Otto to peek up, click *Take notes*, talk for 10 seconds, click *Stop*, then open the notes when they're ready.
4. **Optional, 5 seconds:** a phone video of him walking and calling Otto, for the cold open.
