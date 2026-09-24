import { test } from "node:test";
import assert from "node:assert/strict";
import type { Http, HttpResponse } from "../src/http.ts";
import { fandom } from "../src/mediawiki.ts";
import { GAME_IDS } from "../src/types.ts";
import { KURO_SIGNAL, SOURCES, emptyMemory, fetchKuroAnnouncements, wuwaKnownStarts } from "../src/sources/registry.ts";

type Route = (url: URL) => HttpResponse | undefined;

function fakeHttp(routes: Route[]) {
  const urls: string[] = [];
  const http: Http = {
    async get(url, validators) {
      urls.push(url);
      const u = new URL(url);
      for (const route of routes) {
        const res = route(u);
        if (res) return validators?.etag && res.validators.etag === validators.etag ? { status: 304, body: "", validators } : res;
      }
      throw new Error(`нет ответа для ${url}`);
    },
  };
  return { http, urls };
}

const json = (value: unknown, etag?: string): HttpResponse => ({ status: 200, body: JSON.stringify(value), validators: etag ? { etag } : {} });
const byId = (id: string) => SOURCES.find((s) => s.id === id)!;
const NOW = Date.UTC(2026, 8, 16, 12, 0) / 1000;

test("у каждой игры есть источники кодов, баннеров и видео, кроме кодов Endfield", () => {
  const ids = SOURCES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const game of GAME_IDS) {
    for (const section of ["codes", "banners", "videos"] as const) {
      const primary = SOURCES.filter((s) => s.game === game && s.section === section && !s.fallback);
      assert.equal(primary.length, game === "endfield" && section === "codes" ? 0 : 1, `${game} ${section}`);
    }
  }
  assert.deepEqual(SOURCES.filter((s) => s.fallback).map((s) => s.id).sort(), [
    "genshin-banners-ennead", "genshin-codes-ennead", "hsr-banners-ennead", "hsr-codes-ennead", "zzz-banners-ennead", "zzz-codes-ennead",
  ]);
  assert.equal(KURO_SIGNAL.id, "wuthering-signal");
});

test("коды с фандома: тот же номер правки — без чтения страницы", async () => {
  const page = "{{Redemption Code Row|NSJR3B97ZZ5X|ref=|A|{{Item List|Stellar Jade*50|mode=br}}|2026-08-16|unknown}}";
  const f = fakeHttp([
    (u) => (u.searchParams.get("prop") === "info" ? json({ query: { pages: [{ title: "Redemption Code", lastrevid: 5 }] } }) : undefined),
    (u) => (u.searchParams.get("action") === "parse" ? json({ parse: { wikitext: page } }) : undefined),
  ]);
  const memory = emptyMemory();
  const source = byId("hsr-codes");
  const first = await source.run({ http: f.http, now: NOW, memory });
  assert.equal(first.kind, "ok");
  if (first.kind === "ok") assert.deepEqual(first.items.map((c) => ("code" in c ? c.code : "")), ["NSJR3B97ZZ5X"]);
  const parses = f.urls.filter((u) => u.includes("action=parse")).length;
  const second = await source.run({ http: f.http, now: NOW, memory });
  assert.equal(second.kind, "unchanged");
  assert.equal(f.urls.filter((u) => u.includes("action=parse")).length, parses);
});

test("баннеры с фандома: разобранные страницы берутся из памяти, миниатюры пачкой", async () => {
  const page = `{{Convene
|image = Banner A 2026-09-10.jpg
|type = Featured Resonator
|time_start = 2026-09-10 10:00
|time_end = 2026-09-29 11:59
}}
{{Convene/Pool
|resonator_5_F = Hiyuki
}}`;
  const f = fakeHttp([
    (u) => (u.searchParams.get("list") === "categorymembers" ? json({ query: { categorymembers: [{ title: "Banner A/2026-09-10" }, { title: "Convene" }] } }) : undefined),
    (u) => (u.searchParams.get("prop") === "info" ? json({ query: { pages: [{ title: "Banner A/2026-09-10", lastrevid: 9 }] } }) : undefined),
    (u) => (u.searchParams.get("action") === "parse" ? json({ parse: { wikitext: page } }) : undefined),
    (u) => (u.searchParams.get("prop") === "imageinfo"
      ? json({ query: { pages: [{ title: "File:Banner A 2026-09-10.jpg", imageinfo: [{ thumburl: "https://static.wikia.nocookie.net/a.jpg/scale-to-width-down/400" }] }] } })
      : undefined),
  ]);
  const memory = emptyMemory();
  const source = byId("wuthering-banners");
  const run = await source.run({ http: f.http, now: NOW, memory });
  assert.equal(run.kind, "ok");
  if (run.kind === "ok") {
    assert.equal(run.items.length, 1);
    assert.equal((run.items[0] as { image: string }).image, "https://static.wikia.nocookie.net/a.jpg/scale-to-width-down/400");
  }
  assert.deepEqual(wuwaKnownStarts(memory), [Date.UTC(2026, 8, 10, 9, 0) / 1000]);
  await source.run({ http: f.http, now: NOW, memory });
  assert.equal(f.urls.filter((u) => u.includes("action=parse")).length, 1, "вторая пробежка страницу не читала");
});

test("баннеры с фандома: сломанная подстраница перечитывается на следующем прогоне", async () => {
  const badPage = `{{Convene
|image = Banner A 2026-09-10.jpg
|type = Featured Resonator
|time_start = not-a-date
|time_end = also-not-a-date
}}`;
  const f = fakeHttp([
    (u) => (u.searchParams.get("list") === "categorymembers" ? json({ query: { categorymembers: [{ title: "Banner A/2026-09-10" }] } }) : undefined),
    (u) => (u.searchParams.get("prop") === "info" ? json({ query: { pages: [{ title: "Banner A/2026-09-10", lastrevid: 9 }] } }) : undefined),
    (u) => (u.searchParams.get("action") === "parse" ? json({ parse: { wikitext: badPage } }) : undefined),
  ]);
  const memory = emptyMemory();
  const source = byId("wuthering-banners");
  const first = await source.run({ http: f.http, now: NOW, memory });
  assert.equal(first.kind, "broken");
  const parsesAfterFirst = f.urls.filter((u) => u.includes("action=parse")).length;
  const second = await source.run({ http: f.http, now: NOW, memory });
  assert.equal(second.kind, first.kind, "тот же испорченный текст даёт тот же вердикт");
  assert.equal(
    f.urls.filter((u) => u.includes("action=parse")).length,
    parsesAfterFirst + 1,
    "вторая пробежка перечитала сломанную страницу, а не взяла её из памяти",
  );
});

test("коды с фандома: сломанный разбор перечитывается на следующем прогоне", async () => {
  // Строка кода без разрешённых символов — «выброшенная», без здоровых строк рядом,
  // так что judge() сочтёт источник поломанным и не запомнит номер правки.
  const badPage = "{{Redemption Code Row|not a code!!|ref=|A|{{Item List|Stellar Jade*50|mode=br}}|2026-08-16|unknown}}";
  const f = fakeHttp([
    (u) => (u.searchParams.get("prop") === "info" ? json({ query: { pages: [{ title: "Redemption Code", lastrevid: 5 }] } }) : undefined),
    (u) => (u.searchParams.get("action") === "parse" ? json({ parse: { wikitext: badPage } }) : undefined),
  ]);
  const memory = emptyMemory();
  const source = byId("hsr-codes");
  const first = await source.run({ http: f.http, now: NOW, memory });
  assert.equal(first.kind, "broken");
  const parsesAfterFirst = f.urls.filter((u) => u.includes("action=parse")).length;
  const second = await source.run({ http: f.http, now: NOW, memory });
  assert.equal(second.kind, first.kind, "тот же испорченный текст даёт тот же вердикт");
  assert.equal(
    f.urls.filter((u) => u.includes("action=parse")).length,
    parsesAfterFirst + 1,
    "вторая пробежка перечитала сломанную страницу, а не взяла номер правки из памяти",
  );
});

test("баннеры с фандома: страница, пропавшая из категории, удаляется из памяти", async () => {
  const page = `{{Convene
|image = Banner A 2026-09-10.jpg
|type = Featured Resonator
|time_start = 2026-09-10 10:00
|time_end = 2026-09-29 11:59
}}
{{Convene/Pool
|resonator_5_F = Hiyuki
}}`;
  const f = fakeHttp([
    (u) => (u.searchParams.get("list") === "categorymembers" ? json({ query: { categorymembers: [{ title: "Banner A/2026-09-10" }] } }) : undefined),
    (u) => (u.searchParams.get("prop") === "info" ? json({ query: { pages: [{ title: "Banner A/2026-09-10", lastrevid: 9 }] } }) : undefined),
    (u) => (u.searchParams.get("action") === "parse" ? json({ parse: { wikitext: page } }) : undefined),
    (u) => (u.searchParams.get("prop") === "imageinfo"
      ? json({ query: { pages: [{ title: "File:Banner A 2026-09-10.jpg", imageinfo: [{ thumburl: "https://static.wikia.nocookie.net/a.jpg/scale-to-width-down/400" }] }] } })
      : undefined),
  ]);
  const memory = emptyMemory();
  const wiki = fandom("wutheringwaves");
  const staleKey = `${wiki.api}|Old Banner/2026-01-01`;
  const currentKey = `${wiki.api}|Banner A/2026-09-10`;
  memory.pages[staleKey] = { rev: 1, outcome: { kind: "skip" } };
  const source = byId("wuthering-banners");
  const run = await source.run({ http: f.http, now: NOW, memory });
  assert.equal(run.kind, "ok");
  assert.equal(staleKey in memory.pages, false, "запись пропавшей подстраницы удалена");
  assert.equal(currentKey in memory.pages, true, "запись текущей подстраницы осталась");
});

test("баннеры с фандома: сбой миниатюр не ломает источник, картинки просто нет", async () => {
  const page = `{{Convene
|image = Banner A 2026-09-10.jpg
|type = Featured Resonator
|time_start = 2026-09-10 10:00
|time_end = 2026-09-29 11:59
}}
{{Convene/Pool
|resonator_5_F = Hiyuki
}}`;
  const f = fakeHttp([
    (u) => (u.searchParams.get("list") === "categorymembers" ? json({ query: { categorymembers: [{ title: "Banner A/2026-09-10" }] } }) : undefined),
    (u) => (u.searchParams.get("prop") === "info" ? json({ query: { pages: [{ title: "Banner A/2026-09-10", lastrevid: 9 }] } }) : undefined),
    (u) => (u.searchParams.get("action") === "parse" ? json({ parse: { wikitext: page } }) : undefined),
    // Запрос миниатюр (imageinfo) нарочно не обслуживается — имитирует сбой сети.
  ]);
  const memory = emptyMemory();
  const source = byId("wuthering-banners");
  const run = await source.run({ http: f.http, now: NOW, memory });
  assert.equal(run.kind, "ok");
  if (run.kind === "ok") {
    assert.equal(run.items.length, 1);
    assert.equal((run.items[0] as { image: string | null }).image, null);
  }
});

test("лента YouTube: 304 — unchanged", async () => {
  const feed = `<feed><entry><yt:videoId>abc</yt:videoId><yt:channelId>UC2SpC8rL9LaeQriE4YNdyzA</yt:channelId><title>T</title><link rel="alternate" href="https://www.youtube.com/watch?v=abc"/><published>2026-09-15T10:00:00+00:00</published></entry></feed>`;
  const f = fakeHttp([(u) => (u.host === "www.youtube.com" ? { status: 200, body: feed, validators: { etag: '"e1"' } } : undefined)]);
  const memory = emptyMemory();
  const source = byId("zzz-videos");
  assert.equal((await source.run({ http: f.http, now: NOW, memory })).kind, "ok");
  assert.equal((await source.run({ http: f.http, now: NOW, memory })).kind, "unchanged");
});

test("анонсы Kuro: разбор и повтор из памяти при 304", async () => {
  const menu = [{ articleId: 5431, articleTitle: "[Version 3.6 Featured Resonator/Weapon Convene: Phase II]", startTime: "2026-09-09 11:15:00" }];
  const f = fakeHttp([(u) => (u.host === "hw-media-cdn-mingchao.kurogame.com" ? json(menu, '"k1"') : undefined)]);
  const memory = emptyMemory();
  const first = await fetchKuroAnnouncements({ http: f.http, now: NOW, memory });
  assert.equal(first.ok && first.announcements[0]?.articleId, 5431);
  const second = await fetchKuroAnnouncements({ http: f.http, now: NOW, memory });
  assert.equal(second.ok && second.announcements[0]?.articleId, 5431);
});

test("сетевая ошибка — поломка источника, а не исключение", async () => {
  const f = fakeHttp([]);
  const run = await byId("endfield-banners").run({ http: f.http, now: NOW, memory: emptyMemory() });
  assert.equal(run.kind, "broken");
});
