import type { AnyToolSpec } from "../types";
import { newsHeadlines, readWebpage, webSearch, wikipediaLookup } from "./web";
import { checkFacts, findCourseSources } from "./check";
import { getWeather } from "./weather";
import { calculateTool, convertCurrency } from "./money";
import { cancelReminder, createReminder, listReminders, scheduleRoutine } from "./reminders";
import { forget, recall, remember } from "./memory";
import { listNotes, readNote, writeNote } from "./notes";
import { readInbox, sendEmail } from "./inbox";
import { messageOwnerTool } from "./owner";
import { browserTools } from "./browser";
import { meetingTools } from "./meetings";
import { libraryTools } from "./library";

/** Built-in connector id → its tools. */
export const BUILTIN_TOOLS: Record<string, AnyToolSpec[]> = {
  // Checking facts and finding a course online are Tavily searches too: they come with web search.
  web_search: [webSearch, checkFacts, findCourseSources],
  web_reader: [readWebpage],
  news: [newsHeadlines],
  wikipedia: [wikipediaLookup],
  weather: [getWeather],
  currency: [convertCurrency, calculateTool],
  reminders: [createReminder, scheduleRoutine, listReminders, cancelReminder],
  memory: [remember, recall, forget, messageOwnerTool],
  notes: [listNotes, readNote, writeNote],
  bot_inbox: [readInbox, sendEmail],
  browser: browserTools,
  meetings: meetingTools,
  library: libraryTools,
};

export { botEmailAddress } from "./inbox";
