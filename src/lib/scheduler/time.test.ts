import { describe, expect, it } from "vitest";
import { computeNextRun, describeSchedule, parseOwnerDateTime, zonedToUtc } from "./time";

describe("schedule time math", () => {
  it("converts wall-clock times across DST correctly", () => {
    // Chicago is UTC-5 in October (CDT) and UTC-6 in December (CST).
    expect(zonedToUtc(2026, 10, 14, 8, 0, "America/Chicago").toISOString()).toBe("2026-10-14T13:00:00.000Z");
    expect(zonedToUtc(2026, 12, 14, 8, 0, "America/Chicago").toISOString()).toBe("2026-12-14T14:00:00.000Z");
  });

  it("finds the next daily run in the owner's timezone", () => {
    const after = new Date("2026-10-14T14:00:00Z"); // 9:00 CDT
    const next = computeNextRun({ type: "daily", time: "08:00" }, "America/Chicago", after);
    expect(next?.toISOString()).toBe("2026-10-15T13:00:00.000Z");
    const sameDay = computeNextRun({ type: "daily", time: "17:30" }, "America/Chicago", after);
    expect(sameDay?.toISOString()).toBe("2026-10-14T22:30:00.000Z");
  });

  it("respects weekday-only routines", () => {
    const friday = new Date("2026-10-16T20:00:00Z"); // Fri 3pm CDT
    const next = computeNextRun({ type: "daily", time: "08:00", days: [1, 2, 3, 4, 5] }, "America/Chicago", friday);
    expect(next?.toISOString()).toBe("2026-10-19T13:00:00.000Z"); // Monday
  });

  it("handles one-off reminders and cron", () => {
    const after = new Date("2026-10-14T00:00:00Z");
    expect(computeNextRun({ type: "once", at: "2026-10-13T00:00:00Z" }, "UTC", after)).toBeNull();
    expect(computeNextRun({ type: "once", at: "2026-10-15T00:00:00Z" }, "UTC", after)?.toISOString()).toBe(
      "2026-10-15T00:00:00.000Z",
    );
    expect(computeNextRun({ type: "cron", expr: "0 9 * * 1" }, "UTC", after)?.toISOString()).toBe(
      "2026-10-19T09:00:00.000Z",
    );
  });

  it("parses model-supplied local datetimes in the owner's timezone", () => {
    expect(parseOwnerDateTime("2026-10-14T18:00", "America/Chicago")?.toISOString()).toBe("2026-10-14T23:00:00.000Z");
    expect(parseOwnerDateTime("2026-10-14T18:00:00-05:00", "UTC")?.toISOString()).toBe("2026-10-14T23:00:00.000Z");
    // Seconds, milliseconds or a Z a model tacks on are still the owner's 6 PM (what the reminder chip shows).
    expect(parseOwnerDateTime("2026-10-14T18:00:00.000", "America/Chicago")?.toISOString()).toBe("2026-10-14T23:00:00.000Z");
    expect(parseOwnerDateTime("2026-10-14T18:00:00Z", "America/Chicago")?.toISOString()).toBe("2026-10-14T23:00:00.000Z");
    expect(parseOwnerDateTime("2026-10-14T18:00:00.000Z", "America/Chicago")?.toISOString()).toBe("2026-10-14T23:00:00.000Z");
  });

  it("describes schedules in plain words", () => {
    expect(describeSchedule({ type: "daily", time: "08:00", days: [1, 2, 3, 4, 5] }, "UTC")).toBe("Weekdays at 8:00 AM");
    expect(describeSchedule({ type: "daily", time: "21:15" }, "UTC")).toBe("Every day at 9:15 PM");
  });
});
