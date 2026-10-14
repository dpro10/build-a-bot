/**
 * Keyboard behavior for the builder's custom radio groups (cards with role="radio"),
 * matching native radio buttons: Tab lands on the picked option, and the arrow keys
 * (plus Home and End) move to the next option and pick it.
 */
import type * as React from "react";

const KEYS = new Set(["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"]);

/** Put on the element with role="radiogroup". */
export function onRadioGroupKeyDown(e: React.KeyboardEvent<HTMLElement>) {
  if (!KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')];
  const current = radios.indexOf(document.activeElement as HTMLButtonElement);
  if (current < 0 || radios.length < 2) return;
  e.preventDefault();
  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
  const next = e.key === "Home" ? 0 : e.key === "End" ? radios.length - 1 : (current + step + radios.length) % radios.length;
  radios[next].focus();
  radios[next].click();
}

/** Only the picked option is in the Tab order (or the first one, when nothing in the group is picked). */
export function radioTabIndex(active: boolean, index: number, noneActive: boolean): 0 | -1 {
  return active || (noneActive && index === 0) ? 0 : -1;
}
