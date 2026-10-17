/**
 * What the app shows of study sets: shared by the API routes and the client components (no
 * server-only imports here).
 */
import type { QuizQuestion, StudyCard } from "@/lib/db/schema";

export type StudySetView = {
  id: string;
  kind: "flashcards" | "quiz";
  title: string;
  /** Flashcards. */
  cards: StudyCard[];
  /** Quiz questions. */
  questions: QuizQuestion[];
  /** Flashcards due now, in order (never seen counts as due). */
  dueIds: string[];
  /** Per card: its box (1-5) and next review. */
  boxes: Record<string, { box: number; due: string }>;
  /** Quiz attempts, newest last. */
  attempts: { at: string; score: number; total: number; missed: string[] }[];
  sources: string[];
  createdAt: string;
};

/** A set in the Library's list. */
export type StudySetListItem = {
  id: string;
  kind: "flashcards" | "quiz";
  title: string;
  count: number;
  sources: string[];
  due: number;
  lastScore: { at: string; score: number; total: number } | null;
  createdAt: string;
};
