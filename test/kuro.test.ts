import { test } from "node:test";
import assert from "node:assert/strict";
import {
  articleText,
  conveneAnnouncements,
  kuroArticleUrl,
  kuroBannerFacts,
  maintenanceEnd,
  patchNotesVersion,
  unknownToWiki,
} from "../src/sources/kuro.ts";

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

test("список с null и другим мусором не роняет разбор", () => {
  const r = conveneAnnouncements(
    [null, 42, "x", { articleId: 5431, articleTitle: "[Version 3.6 Featured Resonator/Weapon Convene: Phase II]", startTime: "2026-09-09 11:15:00" }],
    NOW
  );
  assert.equal(r.found, true);
  assert.equal(r.announcements.length, 1);
  assert.equal(r.announcements[0]?.articleId, 5431);
});

// Синтетическая статья: имена и даты придуманы, от настоящих анонсов взяты только служебные фразы.
const ARTICLE = {
  articleId: 9001,
  articleTitle: "[Version 9.9 Featured Resonator/Weapon Convene: Phase I]",
  startTime: "2026-10-01 11:15:00",
  articleContent:
    "<p>[Test Banner] Featured Resonator Convene</p>" +
    "<p>During the event, 5-Star Resonator: Resonator A, 4-Star Resonators: B, C, and D receive boosted drop rates!</p>" +
    "<p>&#10022;Duration&#10022;</p><p>Version 9.9 update - 2026-10-22 09:59 (server time)</p>" +
    "<p>[Test Weapon] Featured Weapon Convene</p>" +
    "<p>During the event, 5-Star Weapon: Blade X receive boosted drop rates!</p>" +
    "<p>Version 9.9 update - 2026-10-22 09:59 (server time)</p>" +
    "<p>[Second Banner] Featured Resonator Convene</p>" +
    "<p>During the event, 5-Star Resonator: Resonator E, 4-Star Resonators: F receive boosted drop rates!</p>" +
    "<p>Duration</p><p>2026-10-22 10:00 - 2026-11-11 11:59 (server time)</p>",
};

test("факты баннеров: название, 5★, начало и конец; блок оружия пропущен", () => {
  assert.deepEqual(kuroBannerFacts(articleText(ARTICLE)!), [
    {
      title: "Test Banner",
      featured: "Resonator A",
      start: { kind: "release", version: "9.9" },
      endsAt: utc(2026, 10, 22, 8, 59),
    },
    {
      title: "Second Banner",
      featured: "Resonator E",
      start: { kind: "at", at: utc(2026, 10, 22, 9, 0) },
      endsAt: utc(2026, 11, 11, 10, 59),
    },
  ]);
});

test("текст статьи: теги убраны, блочные теги и <br> — переводы строк, сущности раскрыты", () => {
  const article = {
    articleContent:
      "<div><h3>Head &amp; Tail</h3><ul><li>one</li><li>two</li></ul></div>" +
      "<p>&#10022;Duration&#x2726;<br>Line&nbsp;two<br/><span>a</span><img src=\"x.png\">b</p>" +
      "<p>   </p><p>x &lt;b&gt; y &quot;z&quot; &#39;w&#39;</p>",
  };
  assert.deepEqual(articleText(article), [
    "Head & Tail",
    "one",
    "two",
    "✦Duration✦",
    "Line two",
    "ab",
    "x <b> y \"z\" 'w'",
  ]);
});

test("текст статьи: не объект или нет articleContent — null", () => {
  assert.equal(articleText(null), null);
  assert.equal(articleText("text"), null);
  assert.equal(articleText([]), null);
  assert.equal(articleText({ articleId: 1 }), null);
  assert.equal(articleText({ articleContent: 42 }), null);
});

test("блок резонатора без строки дат или без имени 5★ пропускается, остальные читаются", () => {
  const lines = articleText({
    articleContent:
      // Нет строки дат: даты следующего блока (оружия) ему не принадлежат.
      "<p>[No Dates] Featured Resonator Convene</p>" +
      "<p>During the event, 5-Star Resonator: Resonator A, 4-Star Resonators: B receive boosted drop rates!</p>" +
      "<p>[Test Weapon] Featured Weapon Convene</p>" +
      "<p>During the event, 5-Star Weapon: Blade X receive boosted drop rates!</p>" +
      "<p>Version 9.9 update - 2026-10-22 09:59 (server time)</p>" +
      // Нет имени 5★.
      "<p>[No Name] Featured Resonator Convene</p>" +
      "<p>Version 9.9 update - 2026-10-22 09:59 (server time)</p>" +
      "<p>[Good Banner] Featured Resonator Convene</p>" +
      "<p>During the event, 5-Star Resonator: Resonator E receive boosted drop rates!</p>" +
      "<p>2026-10-22 10:00 - 2026-11-11 11:59 (server time)</p>",
  })!;
  assert.deepEqual(kuroBannerFacts(lines), [
    {
      title: "Good Banner",
      featured: "Resonator E",
      start: { kind: "at", at: utc(2026, 10, 22, 9, 0) },
      endsAt: utc(2026, 11, 11, 10, 59),
    },
  ]);
});

test("блок пропускается, если начало не разобрать или оно не раньше конца", () => {
  const featured = "During the event, 5-Star Resonator: Resonator A receive boosted drop rates!";
  assert.deepEqual(
    kuroBannerFacts([
      "[Bad Start] Featured Resonator Convene",
      featured,
      "Soon - 2026-10-22 09:59 (server time)",
      "[Backwards] Featured Resonator Convene",
      featured,
      "2026-11-11 10:00 - 2026-10-22 09:59 (server time)",
      "[Empty] Featured Resonator Convene",
    ]),
    []
  );
  assert.deepEqual(kuroBannerFacts([]), []);
  assert.deepEqual(kuroBannerFacts(["No banners here", "Duration"]), []);
});

test("конец техработ: время после тире в строке Maintenance Time, UTC+8", () => {
  const lines = articleText({
    articleContent:
      "<p>Version 9.9 update</p><p>&#10022;Maintenance Time:    2026-09-30 04:00 - 2026-09-30 11:00 (UTC+8)</p>",
  })!;
  assert.equal(maintenanceEnd(lines), utc(2026, 9, 30, 3, 0));
  assert.equal(maintenanceEnd(["Maintenance Time:    2026-09-30 04:00 - 2026-09-30 11:00 (UTC+8)"]), utc(2026, 9, 30, 3, 0));
  assert.equal(maintenanceEnd(["Version 9.9 update", "Duration"]), null);
  assert.equal(maintenanceEnd([]), null);
});

test("версия патчноута берётся только из заголовка патчноута", () => {
  assert.equal(patchNotesVersion("Patch Notes for Wuthering Waves Version 9.9: Something"), "9.9");
  assert.equal(patchNotesVersion("[Version 9.9 Featured Resonator/Weapon Convene: Phase I]"), null);
  assert.equal(patchNotesVersion("Patch Notes without a number"), null);
});
