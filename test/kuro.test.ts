import { test } from "node:test";
import assert from "node:assert/strict";
import {
  articleText,
  conveneAnnouncements,
  kuroArticleUrl,
  kuroBannerFacts,
  kuroBanners,
  maintenanceEnd,
  patchNotesVersion,
  unknownToWiki,
  withKuroBanners,
  type Announcement,
  type KuroBannerFact,
} from "../src/sources/kuro.ts";
import type { Banner, HubData } from "../src/types.ts";

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

// Меню с патчноутами: названия и номера придуманы.
const MENU_WITH_NOTES = [
  { articleId: 9101, articleTitle: "Patch Notes for Wuthering Waves Version 9.9: Synthetic Title", startTime: "2026-09-12 12:00:00" },
  { articleId: 9100, articleTitle: "Patch Notes for Wuthering Waves Version 9.8: Old Synthetic Title", startTime: "2026-08-01 12:00:00" },
  { articleId: 9102, articleTitle: "Patch Notes without a number", startTime: "2026-09-12 13:00:00" },
  { articleId: 9103, articleTitle: "Patch Notes for Wuthering Waves Version 10.0: From The Future", startTime: "2026-09-20 12:00:00" },
  { articleId: 9104, articleTitle: "[Version 9.9 Featured Resonator/Weapon Convene: Phase I]", startTime: "2026-09-13 11:15:00" },
  { articleId: 9105, articleTitle: "Resonator Review | Synthetic", startTime: "2026-09-13 18:00:00" },
];

test("меню: свежие патчноуты возвращаются отдельно от анонсов, время UTC+8", () => {
  const r = conveneAnnouncements(MENU_WITH_NOTES, NOW);
  assert.equal(r.found, true);
  // 9100 старше 21 дня, 9102 без номера версии, 9103 «из будущего».
  assert.deepEqual(r.patchNotes, [{ articleId: 9101, version: "9.9", publishedAt: utc(2026, 9, 12, 4, 0) }]);
  assert.deepEqual(r.announcements.map((a) => a.articleId), [9104]);
});

test("не массив — патчноутов тоже нет", () => {
  assert.deepEqual(conveneAnnouncements({ error: 1 }, NOW).patchNotes, []);
  assert.deepEqual(conveneAnnouncements([], NOW), { found: true, announcements: [], patchNotes: [] });
});

const announcement = (articleId: number, publishedAt: number): Announcement => ({ articleId, publishedAt, url: kuroArticleUrl(articleId) });
const RELEASE_FACT: KuroBannerFact = { title: "Test Banner", featured: "Resonator A", start: { kind: "release", version: "9.9" }, endsAt: utc(2026, 10, 22, 8, 59) };
const AT_FACT: KuroBannerFact = { title: "Second Banner", featured: "Resonator E", start: { kind: "at", at: utc(2026, 10, 22, 9, 0) }, endsAt: utc(2026, 11, 11, 10, 59) };
const PUBLISHED = utc(2026, 9, 30, 3, 15);

test("баннер из факта: только факты, ссылка на анонс, начало «с версией» — из конца техработ", () => {
  const banners = kuroBanners([{ announcement: announcement(9001, PUBLISHED), banners: [RELEASE_FACT, AT_FACT] }], { "9.9": utc(2026, 10, 1, 3, 0) }, NOW);
  assert.deepEqual(banners, [
    {
      gameId: "wuthering",
      title: "Test Banner",
      featured: ["Resonator A"],
      rarity: 5,
      image: null,
      startsAt: utc(2026, 10, 1, 3, 0),
      endsAt: utc(2026, 10, 22, 8, 59),
      url: kuroArticleUrl(9001),
    },
    {
      gameId: "wuthering",
      title: "Second Banner",
      featured: ["Resonator E"],
      rarity: 5,
      image: null,
      startsAt: utc(2026, 10, 22, 9, 0),
      endsAt: utc(2026, 11, 11, 10, 59),
      url: kuroArticleUrl(9001),
    },
  ]);
});

test("баннер из факта: версия без известных техработ — начало во время публикации анонса", () => {
  const banners = kuroBanners([{ announcement: announcement(9001, PUBLISHED), banners: [RELEASE_FACT] }], { "9.8": utc(2026, 9, 1, 3, 0) }, NOW);
  assert.equal(banners.length, 1);
  assert.equal(banners[0]?.startsAt, PUBLISHED);
});

test("баннер из факта: закончившийся, с концом не позже начала и не влезающий в пределы файла отбрасываются", () => {
  const facts = (list: KuroBannerFact[]) => [{ announcement: announcement(9001, PUBLISHED), banners: list }];
  const ended: KuroBannerFact = { ...AT_FACT, start: { kind: "at", at: utc(2026, 9, 1, 9, 0) }, endsAt: NOW };
  const endsJustAfter: KuroBannerFact = { ...ended, endsAt: NOW + 1 };
  assert.deepEqual(kuroBanners(facts([ended]), {}, NOW), [], "конец ровно сейчас — уже закончился");
  assert.equal(kuroBanners(facts([endsJustAfter]), {}, NOW).length, 1);
  // Версия вышла позже конца баннера — начало получилось бы позже конца.
  assert.deepEqual(kuroBanners(facts([RELEASE_FACT]), { "9.9": utc(2026, 10, 23, 3, 0) }, NOW), []);
  assert.deepEqual(kuroBanners(facts([{ ...AT_FACT, title: "x".repeat(201) }]), {}, NOW), [], "название длиннее 200 знаков валило бы проверку файла");
  assert.deepEqual(kuroBanners(facts([{ ...AT_FACT, featured: "y".repeat(81) }]), {}, NOW), [], "имя длиннее 80 знаков — тоже");
  assert.deepEqual(kuroBanners([], {}, NOW), []);
});

const wuwa = (title: string, startsAt: number, extra: Partial<Banner> = {}): Banner => ({
  gameId: "wuthering",
  title,
  featured: [],
  rarity: 5,
  image: null,
  startsAt,
  endsAt: startsAt + 21 * 86400,
  url: "https://wiki.example/b",
  ...extra,
});
const hubOf = (banners: Banner[]): HubData => ({ version: 2, updatedAt: NOW, games: [], codes: [], banners, videos: [] });

test("фандом побеждает: то же название без учёта регистра и начало в пределах 2 суток — баннер Kuro не добавляется", () => {
  const start = utc(2026, 10, 1, 3, 0);
  const fandom = wuwa("test banner", start + 3600, { image: "https://static.example/a.jpg" });
  const hub = hubOf([fandom]);
  const result = withKuroBanners(hub, kuroBanners([{ announcement: announcement(9001, PUBLISHED), banners: [RELEASE_FACT] }], { "9.9": start }, NOW));
  assert.deepEqual(result.banners, [fandom]);
  assert.equal(result, hub, "нечего добавлять — тот же файл");
});

test("граница двух суток: ровно 172 800 с — тот же баннер, на секунду больше — другой", () => {
  const start = utc(2026, 10, 1, 3, 0);
  const kuro = wuwa("Test Banner", start, { url: kuroArticleUrl(9001) });
  assert.equal(withKuroBanners(hubOf([wuwa("Test Banner", start + 172800)]), [kuro]).banners.length, 1);
  assert.equal(withKuroBanners(hubOf([wuwa("Test Banner", start - 172800)]), [kuro]).banners.length, 1);
  assert.equal(withKuroBanners(hubOf([wuwa("Test Banner", start + 172801)]), [kuro]).banners.length, 2, "повтор баннера через время — не то же самое");
});

test("другое название добавляется, порядок — по играм и началу; чужая игра с тем же названием не мешает", () => {
  const start = utc(2026, 10, 1, 3, 0);
  const genshin = wuwa("Test Banner", start, { gameId: "genshin" });
  const early = wuwa("Earlier Banner", start - 5 * 86400);
  const kuro = kuroBanners([{ announcement: announcement(9001, PUBLISHED), banners: [RELEASE_FACT, AT_FACT] }], { "9.9": start }, NOW);
  const result = withKuroBanners(hubOf([genshin, early]), kuro);
  assert.deepEqual(result.banners.map((b) => `${b.gameId}:${b.title}`), [
    "genshin:Test Banner",
    "wuthering:Earlier Banner",
    "wuthering:Test Banner",
    "wuthering:Second Banner",
  ]);
  assert.equal(result.updatedAt, NOW);
});

test("один и тот же баннер из двух анонсов Kuro добавляется один раз", () => {
  const start = utc(2026, 10, 1, 3, 0);
  const kuro = kuroBanners(
    [
      { announcement: announcement(9002, PUBLISHED + 3600), banners: [RELEASE_FACT] },
      { announcement: announcement(9001, PUBLISHED), banners: [RELEASE_FACT] },
    ],
    { "9.9": start },
    NOW,
  );
  const result = withKuroBanners(hubOf([]), kuro);
  assert.equal(result.banners.length, 1);
  assert.equal(result.banners[0]?.url, kuroArticleUrl(9002), "побеждает более новый анонс (первый в списке)");
});
