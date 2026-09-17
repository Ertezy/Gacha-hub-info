import { test } from "node:test";
import assert from "node:assert/strict";
import { conveneAnnouncements, kuroArticleUrl, unknownToWiki } from "../src/sources/kuro.ts";

const utc = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo - 1, d, h, mi) / 1000;
const NOW = utc(2026, 9, 15, 12, 0);

const MENU = [
  { articleId: 758, articleTitle: "Convene Details", startTime: "2024-05-23 10:00:00" },
  { articleId: 5437, articleTitle: "Resonator Review | Astral Mapping", startTime: "2026-09-09 18:00:00" },
  { articleId: 5431, articleTitle: "[Version 3.6 Featured Resonator/Weapon Convene: Phase II]", startTime: "2026-09-09 11:15:00" },
  { articleId: 5332, articleTitle: "[Glint of Clouds] Featured Weapon Convene", startTime: "2026-08-19 14:50:38" },
  { articleId: 4100, articleTitle: "[Old] Featured Resonator Convene", startTime: "2026-06-01 10:00:00" },
];

test("анонсы: только Convene, без справки, не старше 21 дня, время UTC+8", () => {
  const r = conveneAnnouncements(MENU, NOW);
  assert.equal(r.found, true);
  // 5332 опубликована 19 августа — это 27 дней назад, старше 21 дня.
  assert.deepEqual(r.announcements, [
    { articleId: 5431, publishedAt: utc(2026, 9, 9, 3, 15), url: kuroArticleUrl(5431) },
  ]);
});

test("не массив — not found", () => {
  assert.equal(conveneAnnouncements({ error: 1 }, NOW).found, false);
});

test("сигнал, пока фандом не знает цикла; пропадает, когда узнал", () => {
  const { announcements } = conveneAnnouncements(MENU, NOW);
  const augustStart = utc(2026, 8, 20, 9, 0);
  const septemberStart = utc(2026, 9, 10, 9, 0);
  assert.equal(unknownToWiki(announcements, [augustStart])?.articleId, 5431);
  assert.equal(unknownToWiki(announcements, [augustStart, septemberStart]), null);
  assert.equal(unknownToWiki([], [augustStart]), null);
  assert.equal(unknownToWiki(announcements, [])?.articleId, 5431);
});
