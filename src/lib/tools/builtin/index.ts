import type { AnyToolSpec } from "../types";
import { newsHeadlines, readWebpage, webSearch, wikipediaLookup } from "./web";
import { getWeather } from "./weather";
import { calculateTool, convertCurrency } from "./money";
import { cancelReminder, createReminder, listReminders, scheduleRoutine } from "./reminders";
import { recall, remember } from "./memory";
import { listNotes, readNote, writeNote } from "./notes";
import { readInbox, sendEmail } from "./inbox";
import { messageOwnerTool } from "./owner";

/** Built-in connector id → its tools. */
export const BUILTIN_TOOLS: Record<string, AnyToolSpec[]> = {
  web_search: [webSearch],
  web_reader: [readWebpage],
  news: [newsHeadlines],
  wikipedia: [wikipediaLookup],
  weather: [getWeather],
  currency: [convertCurrency, calculateTool],
  reminders: [createReminder, scheduleRoutine, listReminders, cancelReminder],
  memory: [remember, recall, messageOwnerTool],
  notes: [listNotes, readNote, writeNote],
  bot_inbox: [readInbox, sendEmail],
};

export { botEmailAddress } from "./inbox";
