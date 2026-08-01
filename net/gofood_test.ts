import { assertEquals } from "jsr:@std/assert@1";
import { todayHours } from "./gofood.ts";

const hm = (h: number, m = 0) => ({ hours: h, minutes: m });
// GoFood numbers days 1..7 starting Monday.
const WEEK = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
  day,
  startTime: hm(day),
  endTime: hm(day + 12),
}));

Deno.test("Sunday maps to day 7, not day 0", () => {
  // 2026-08-02 is a Sunday. Noon UTC is still Sunday in Jakarta (UTC+7).
  const sunday = new Date("2026-08-02T05:00:00Z");
  assertEquals(todayHours(WEEK, "Asia/Jakarta", sunday), "07:00-19:00");
});

Deno.test("Monday maps to day 1", () => {
  const monday = new Date("2026-08-03T05:00:00Z");
  assertEquals(todayHours(WEEK, "Asia/Jakarta", monday), "01:00-13:00");
});

Deno.test("hours are read in the outlet's timezone, not the server's", () => {
  // 20:00 UTC Saturday is already 03:00 Sunday in Jakarta.
  const lateSaturdayUtc = new Date("2026-08-01T20:00:00Z");
  assertEquals(
    todayHours(WEEK, "Asia/Jakarta", lateSaturdayUtc),
    "07:00-19:00",
  );
  assertEquals(todayHours(WEEK, "UTC", lateSaturdayUtc), "06:00-18:00");
});

Deno.test("split shifts are both reported", () => {
  const periods = [
    { day: 7, startTime: hm(0), endTime: hm(4, 45) },
    { day: 7, startTime: hm(18), endTime: hm(23, 59) },
  ];
  const sunday = new Date("2026-08-02T05:00:00Z");
  assertEquals(
    todayHours(periods, "Asia/Jakarta", sunday),
    "00:00-04:45 18:00-23:59",
  );
});

Deno.test("a day with no shift says so instead of guessing", () => {
  const sunday = new Date("2026-08-02T05:00:00Z");
  assertEquals(
    todayHours(
      [{ day: 1, startTime: hm(9), endTime: hm(17) }],
      "Asia/Jakarta",
      sunday,
    ),
    "closed today",
  );
  assertEquals(todayHours([], "Asia/Jakarta", sunday), "?");
});
