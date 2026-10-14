import type * as React from "react";

/**
 * Arrow keys for button-based radio groups (role="radiogroup" > role="radio"):
 * moves focus to the next/previous option and selects it, like native radios.
 */
export function radioKeyDown(e: React.KeyboardEvent<HTMLElement>) {
  const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
  const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
  if (!forward && !back && e.key !== "Home" && e.key !== "End") return;
  const group = e.currentTarget.closest('[role="radiogroup"]');
  if (!group) return;
  const radios = [...group.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])')];
  const i = radios.indexOf(e.currentTarget);
  if (i < 0 || !radios.length) return;
  e.preventDefault();
  const next = e.key === "Home" ? 0 : e.key === "End" ? radios.length - 1 : (i + (forward ? 1 : -1) + radios.length) % radios.length;
  radios[next].focus();
  radios[next].click();
}

/** Roving tab stop: only the chosen option (or the first, if none) is in the tab order. */
export function radioTabIndex(checked: boolean, index: number, anyChecked: boolean): 0 | -1 {
  return checked || (!anyChecked && index === 0) ? 0 : -1;
}
