# Your files, for your bot (plan, 2026-10-17; stage 1 built the same day)

Diego: "i would be down to allow the bot get your files though, or atleast there needs to be a way for yout o upload your files to the bot. think of the tutor bot for example, it needs to acess you study materials, syllbuses, slide decks, notes, etc. In order to make a good study materials for you. it should be able to make flash cards, practice quizes, etc. look into this, plan this out, dont build yet."

## Where things stand

- No file goes in anywhere: the web chat has no upload, and attachments sent on Telegram, Slack, Discord or email are dropped.
- The closest things: **notes** (the bot's own text notes, like the tutor's "Learning log"), **memories** (short facts, picked per turn by keyword, no embeddings), and Drive, OneDrive and Dropbox **connectors** (Composio or MCP), which reach files in the cloud but not ones on a laptop.
- What helps: outside content is already marked as information, not instructions (`<untrusted_content>`), so a file can't steer the bot. Billing is already "pay for what you use, at cost". The included model has a 1M-token context.

## The idea: a Library for each bot

Everything you give a bot lands in its **Library**: one list of your files, wherever they came from, read once and searchable. The bot uses it when it helps ("make flashcards from chapter 3", "what's on the midterm?") and says which file and page it used.

### Ways in (first to last)

1. **The web chat.** A paperclip and drag-and-drop in the chat, plus a **Files** tab on each bot. Several at once. Uploads go straight to storage from the browser, since Vercel functions take at most 4.5 MB.
2. **Chat apps.** Send a PDF to your bot on Telegram, Discord or Slack and it goes into the Library ("Got it: Bio 101 syllabus, 6 pages. Want flashcards?"). Email attachments too. Only from the owner: files from other people the bot talks to are read for that conversation, never kept.
3. **The desktop app: "Give my bot a folder."** You pick a folder (say *Fall 2026 classes*). The app keeps the bot's Library in step with it: new and changed files go up, and deleted ones are removed. It never sees anything else on the disk. This is the safe form of "let the bot get your files". It works with every brain, and the bot can still use the files from your phone while the laptop sleeps.
4. **From Drive, OneDrive or Dropbox.** Pick files or a folder through the connectors you already have.
5. **Later:** a link (a web page, a YouTube lecture's captions), and **lectures recorded with *Take notes in the room***. Meeting notes already turn a lecture into a transcript, so it can join the Library on its own.

**Why a folder, not Claude Code reading the disk:** the Bridge keeps every built-in tool off so the AI can't read, write or run anything on the computer. Giving it disk access would bring back that risk, through a prompt injection in a downloaded PDF or a message from someone else, and it would only work for bots on a subscription brain. A synced folder gets the same result for every bot, with nothing for the AI to wander into.

### Reading the files

Done once, in the background, after upload. The file shows *Reading… → Ready (42 pages)*.

| Kind | How |
| --- | --- |
| PDF with text | Text and page numbers (`unpdf`) |
| Word (.docx) | `mammoth` |
| PowerPoint (.pptx) | The slides' XML, with speaker notes, kept by slide number |
| Text, Markdown, CSV | As is |
| Photos of notes or a whiteboard, scanned PDFs | A vision model reads them page by page. **NVIDIA Nemotron Nano 2 VL on Nebius** is built for OCR and charts and fits the hackathon (check it's in Token Factory's catalog). Paid from credit, at cost. |

The text is split into passages of about a page, each tagged with its file and page or slide, and indexed with Postgres full-text search. That works on Supabase and on the local PGlite, with no new service. Embeddings (pgvector, with an embedding model on Nebius) come later, if search misses too often.

### What the bot can do with them

New tools, which bots on the owner's plan also get through the Bridge (over MCP):
- `list_files`
- `search_files(query)`: the best passages, with file and page
- `read_file(name, pages)`

The prompt also says what's in the Library ("Your Library: Bio 101 syllabus, Lecture 4 slides, …"), so the bot knows to look. Everything read from a file is untrusted content, like a web page.

### Study tools (the tutor's side)

- **Flashcards and practice quizzes as real objects**, not a wall of text. A new `study_sets` table: `{ kind: flashcards | quiz, title, items, source files and pages }`. The tool asks the model for a strict shape (checked with zod): each card has a front, a back and a source page; each quiz question is multiple choice, true/false or short answer, with the answer and why.
- **In the web chat they're interactive.** Flip a card, then *Got it* or *Again*. Answer a question and see right or wrong with the explanation and page. A score at the end.
- **Spaced repetition.** *Again* cards come back sooner. The tutor already keeps a "Learning log" and brings mistakes back, and bots already reach out first, so a daily "5 cards due — 3 minutes?" can arrive on Telegram, or by phone call for oral practice.
- **Elsewhere:** in Telegram, Discord and Slack, one question at a time as plain messages (buttons later). **Export** to CSV, which Anki and Quizlet import, and a printable page.
- **From a syllabus:** exam and due dates become reminders, with the owner's yes.

### Privacy and safety

- Files are private to their owner. Storage is never public, and links to a file expire after minutes. People who message the bot (contacts) can't search the owner's Library.
- Deleting a file deletes it, its text and its passages. Account export includes the files, and deleting the account removes them.
- A file's text goes only to the bot's own model, and only when the bot uses it. Nothing is used for training. The log records file names and sizes, never contents.
- Course materials are for the owner's own studying. The bot doesn't send them anywhere unless the owner asks, and outbound actions keep their approvals.
- Limits for the beta: 25 MB a file, about 500 MB an owner, and a page cap per file. File types are checked by their contents, not their names.

### Storage

**Recommended: Vercel Blob, private.** It's already part of the Vercel project, its browser uploads get around the 4.5 MB limit, and there's no new account. It costs about 2 cents a GB a month.
**Alternative: Supabase Storage.** Same database host, 1 GB free, and the same pausing risk as the free database.
In local demo mode, files go to disk under `DATA_DIR`.

## In stages

1. **First (about 2 to 3 days; good for the hackathon video):**
   - Upload in the web chat and a Files tab: PDF, Word, PowerPoint, text, photos.
   - Reading, with vision for photos and scans.
   - The three Library tools.
   - The tutor making flashcards and quizzes that work right in the web chat.
   - CSV export.
   - Files sent on Telegram and Discord.
2. **Next:**
   - The desktop app's folder.
   - Import from Drive, OneDrive and Dropbox.
   - The daily review.
   - Slack and email attachments.
   - Dates from a syllabus.
3. **Later:**
   - Embeddings.
   - One Library shared by several bots.
   - Links and lecture recordings.
   - Buttons for quizzes in chat apps.

## Decided (Diego, 2026-10-17)

"Besides that I like all of your decisons, make sure the ui ux stays clean and simple."

1. **Storage:** Vercel Blob, private (store `build-a-bot-library`, connected to the project).
2. **A Library per bot.**
3. **Limits:** 25 MB a file, 500 MB an owner.
4. **Stage 1 now**, then the desktop folder.
5. **The desktop folder** is how the bot gets files from a computer; the AI never gets the disk.
6. **No rule against doing graded work.** Diego: "dont try and engineer some limit for this. sometimes we try to be to restrictive and end up over engineering things. at the end of the day its not our job to monitor this, it is the users choice." The tutor's old "never write graded work" line is gone.

## What was built (stage 1)

- `src/lib/library/`: storage (`storage.ts`), reading (`read/`: sniffing, PDF with scanned pages through the vision model, Word, PowerPoint, text and HTML, a small PNG encoder for scans), passages and search (`index.ts`, `search.ts`), study sets with spaced repetition (`study.ts`), attachments and chat-app files (`attachments.ts`, `inbound.ts`).
- Tools (`src/lib/tools/builtin/library.ts`): `list_files`, `search_files`, `read_file`, `make_flashcards`, `make_quiz`, `study_progress`. Reading taints the turn; making study sets is owner-only. Bots on the owner's plan get them through the Bridge too, and cards made there show with the answer.
- The web app: the paperclip, drag-and-drop and pasting in the chat, file chips, study cards that open a focused study window (flip cards, Again / Got it; quizzes scored with explanations and "Go over them with {bot}"), and the Library tab (files, study sets, cards due, CSV export).
- Telegram (files and photos) and Discord (`/ask` with a file; the app re-registers its commands by itself, at most every 6 hours).
- Deleting a bot or an account deletes its files from storage; the export lists them.
- Tests: `tests/library.test.ts`, `tests/library-channels.test.ts`.
