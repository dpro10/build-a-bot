/** The buddy page URL, with enough in the query for a correct first paint (name, avatar, color, app, phase). */
export function buddyUrl(server, state) {
  const q = new URLSearchParams({
    phase: state.phase,
    name: String(state.bot?.name ?? "").slice(0, 32),
    avatar: state.bot?.avatar ?? "",
    color: state.bot?.color ?? "",
    level: "0",
  });
  if (state.app?.id) q.set("app", state.app.id);
  if (state.elapsedMs) q.set("elapsed", String(Math.floor(state.elapsedMs / 1000)));
  if (state.message) q.set("message", String(state.message).slice(0, 200));
  if (typeof state.minutesLeft === "number") q.set("left", String(state.minutesLeft));
  return `${server}/desktop/buddy?${q}`;
}
