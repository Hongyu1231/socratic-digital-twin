import { describe, expect, it } from "vitest";

import { activeMilliseconds, applyPauseChange, closePause, parsePauseHistory, recordPause } from "@/lib/pause-history";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 2, 1, minute)).toISOString();
const minutes = (ms: number) => ms / 60000;

describe("pause history", () => {
  it("records a pause, then closes it on resume", () => {
    const paused = applyPauseChange([], null, at(10), at(10));
    expect(paused).toEqual([{ pausedAt: at(10) }]);
    expect(applyPauseChange(paused, at(10), null, at(25))).toEqual([{ pausedAt: at(10), resumedAt: at(25) }]);
  });

  it("keeps the first entry when paused twice in a row", () => {
    expect(recordPause([{ pausedAt: at(10) }], at(12))).toEqual([{ pausedAt: at(10) }]);
  });

  it("closes the open entry when the session ends while paused", () => {
    expect(closePause([{ pausedAt: at(1), resumedAt: at(2) }, { pausedAt: at(30) }], at(30), at(45)))
      .toEqual([{ pausedAt: at(1), resumedAt: at(2) }, { pausedAt: at(30), resumedAt: at(45) }]);
  });

  it("builds an entry from the current pause when history started mid-pause", () => {
    expect(closePause([], at(30), at(45))).toEqual([{ pausedAt: at(30), resumedAt: at(45) }]);
    expect(closePause([], null, at(45))).toEqual([]);
  });

  it("ignores malformed stored entries", () => {
    expect(parsePauseHistory([{ pausedAt: at(1) }, { pausedAt: "nope" }, null, { resumedAt: at(2) }, { pausedAt: at(3), resumedAt: 5 }]))
      .toEqual([{ pausedAt: at(1) }, { pausedAt: at(3) }]);
    expect(parsePauseHistory(undefined)).toEqual([]);
  });
});

describe("active time", () => {
  const start = new Date(at(0));
  const end = new Date(at(60));
  it("is exact with no pauses", () => expect(minutes(activeMilliseconds(start, end, []))).toBe(60));
  it("takes out one pause", () => expect(minutes(activeMilliseconds(start, end, [{ pausedAt: at(10), resumedAt: at(25) }]))).toBe(45));
  it("takes out two pauses", () => {
    expect(minutes(activeMilliseconds(start, end, [{ pausedAt: at(10), resumedAt: at(25) }, { pausedAt: at(40), resumedAt: at(45) }]))).toBe(40);
  });
  it("stops at the pause for a session paused right now", () => {
    expect(minutes(activeMilliseconds(start, end, [{ pausedAt: at(20) }]))).toBe(20);
    expect(minutes(activeMilliseconds(start, end, [], at(20)))).toBe(20);
  });
  it("never subtracts overlapping or out-of-window pauses twice", () => {
    expect(minutes(activeMilliseconds(start, end, [{ pausedAt: at(10), resumedAt: at(30) }, { pausedAt: at(20), resumedAt: at(35) }]))).toBe(35);
    expect(minutes(activeMilliseconds(start, end, [{ pausedAt: new Date(Date.UTC(2026, 10, 2, 0, 50)).toISOString(), resumedAt: at(5) }]))).toBe(55);
  });
});
