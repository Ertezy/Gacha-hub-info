import { test } from "node:test";
import assert from "node:assert/strict";
import { atOffset, inTimeZone, parseEnglishDate, parseIsoLike, parseOffset } from "../src/time.ts";

const utc = (y: number, mo: number, d: number, h: number, mi: number, s = 0) =>
  Date.UTC(y, mo - 1, d, h, mi, s) / 1000;

test("дата со временем и смещением фандома", () => {
  const p = parseIsoLike("2026-09-23 11:00:00");
  assert.ok(p);
  assert.equal(atOffset(p, 480), utc(2026, 9, 23, 3, 0));
});

test("час одной цифрой и время без секунд", () => {
  assert.deepEqual(parseIsoLike("2026-09-28 3:59:59"), { year: 2026, month: 9, day: 28, hour: 3, minute: 59, second: 59 });
  assert.deepEqual(parseIsoLike("2026-08-20 10:00"), { year: 2026, month: 8, day: 20, hour: 10, minute: 0, second: 0 });
});

test("дата без времени действует до конца дня", () => {
  const p = parseIsoLike("2026-08-15");
  assert.ok(p);
  assert.equal(atOffset(p, 0), utc(2026, 8, 15, 23, 59, 59));
});

test("несуществующие даты и слова не разбираются", () => {
  assert.equal(parseIsoLike("2026-02-30 10:00"), null);
  assert.equal(parseIsoLike("TBA"), null);
  assert.equal(parseIsoLike("unknown"), null);
  assert.equal(parseEnglishDate("Smarch 1, 2026 10:00"), null);
});

test("тихоокеанское время летом и зимой", () => {
  const summer = parseEnglishDate("August 9, 2026 08:59");
  const winter = parseEnglishDate("December 20, 2026 08:59");
  assert.ok(summer && winter);
  assert.equal(inTimeZone(summer, "America/Los_Angeles"), utc(2026, 8, 9, 15, 59));
  assert.equal(inTimeZone(winter, "America/Los_Angeles"), utc(2026, 12, 20, 16, 59));
});

test("тихоокеанское время на границах перевода часов 2026 года", () => {
  const tz = "America/Los_Angeles";
  assert.equal(inTimeZone(parseEnglishDate("March 8, 2026 01:30")!, tz), utc(2026, 3, 8, 9, 30));
  assert.equal(inTimeZone(parseEnglishDate("March 8, 2026 03:30")!, tz), utc(2026, 3, 8, 10, 30));
  assert.equal(inTimeZone(parseEnglishDate("November 1, 2026 00:30")!, tz), utc(2026, 11, 1, 7, 30));
  assert.equal(inTimeZone(parseEnglishDate("November 2, 2026 00:30")!, tz), utc(2026, 11, 2, 8, 30));
});

test("дата Endfield с коротким месяцем и запятой", () => {
  const p = parseEnglishDate("Sep 01, 2026, 23:00");
  assert.ok(p);
  assert.equal(atOffset(p, parseOffset("UTC&minus;5")!), utc(2026, 9, 2, 4, 0));
});

test("смещения", () => {
  assert.equal(parseOffset("GMT+8"), 480);
  assert.equal(parseOffset("UTC+1"), 60);
  assert.equal(parseOffset("UTC−5"), -300);
  assert.equal(parseOffset("UTC-5"), -300);
  assert.equal(parseOffset(""), null);
  assert.equal(parseOffset("GMT+99"), null);
});
