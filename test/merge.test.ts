import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeHub, sameData, sectionKey } from "../src/merge.ts";
import type { Banner, Code, HubData, HubGame, Item, SourceRun, Video } from "../src/types.ts";

const NOW = 1_000_000;
const catalog: HubGame[] = [{ id: "hsr", title: "Honkai: Star Rail", match: { steamAppIds: [], epicAppNames: [], folderNames: [] } }];
const code = (c: string, expiresAt: number | null = null): Code => ({ gameId: "hsr", code: c, rewards: "", expiresAt, region: "all", source: null });
const banner = (title: string, startsAt: number, endsAt: number): Banner => ({ gameId: "hsr", title, featured: [], rarity: 5, image: null, startsAt, endsAt, url: null });
const video = (n: number, lang: "en" | "ja" = "en"): Video => ({ gameId: "hsr", lang, title: `V${n}${lang}`, url: `https://www.youtube.com/watch?v=${n}${lang}`, thumb: null, publishedAt: NOW - n, duration: null, premiere: false });

const previous: HubData = {
  version: 2,
  updatedAt: NOW - 3600,
  games: catalog,
  codes: [code("OLDCODE1"), code("GONECODE", NOW - 1)],
  banners: [banner("Old", NOW - 100, NOW + 100)],
  videos: [video(1)],
};

const ok = <T extends Item>(items: T[]): SourceRun<Item> => ({ kind: "ok", items, parsed: items.length, dropped: 0 });

test("свежий источник заменяет свои записи", () => {
  const runs = new Map<string, SourceRun<Item>>([[sectionKey("hsr", "codes"), ok([code("NEWCODE1")])]]);
  const hub = mergeHub({ previous, catalog, runs, now: NOW });
  assert.deepEqual(hub.codes.map((c) => c.code), ["NEWCODE1"]);
  assert.deepEqual(hub.banners.map((b) => b.title), ["Old"], "раздел без результата взят из прошлого");
});

test("сломанный источник оставляет прошлые записи без сгоревших", () => {
  const runs = new Map<string, SourceRun<Item>>([[sectionKey("hsr", "codes"), { kind: "broken", error: "x" }]]);
  const hub = mergeHub({ previous, catalog, runs, now: NOW });
  assert.deepEqual(hub.codes.map((c) => c.code), ["OLDCODE1"]);
});

test("без прошлого файла сломанный раздел пуст", () => {
  const runs = new Map<string, SourceRun<Item>>([[sectionKey("hsr", "codes"), { kind: "broken", error: "x" }]]);
  assert.deepEqual(mergeHub({ previous: null, catalog, runs, now: NOW }).codes, []);
});

test("сгоревшее выбрасывается и из свежих данных, повторы кодов убираются", () => {
  const runs = new Map<string, SourceRun<Item>>([
    [sectionKey("hsr", "codes"), ok([code("DUPECODE"), code("dupecode"), code("DEADCODE", NOW)])],
    [sectionKey("hsr", "banners"), ok([banner("Later", NOW + 10, NOW + 500), banner("Ended", NOW - 500, NOW), banner("Now", NOW - 10, NOW + 500)])],
  ]);
  const hub = mergeHub({ previous: null, catalog, runs, now: NOW });
  assert.deepEqual(hub.codes.map((c) => c.code), ["DUPECODE"]);
  assert.deepEqual(hub.banners.map((b) => b.title), ["Now", "Later"]);
});

test("видео по свежести, не больше шести на каждом языке", () => {
  const runs = new Map<string, SourceRun<Item>>([
    [sectionKey("hsr", "videos", "en"), ok([7, 3, 5, 1, 2, 6, 4].map((n) => video(n, "en")))],
    [sectionKey("hsr", "videos", "ja"), ok([9, 8, 1].map((n) => video(n, "ja")))],
  ]);
  const hub = mergeHub({ previous: null, catalog, runs, now: NOW });
  assert.deepEqual(hub.videos.filter((v) => v.lang === "en").map((v) => v.title), ["V1en", "V2en", "V3en", "V4en", "V5en", "V6en"]);
  assert.deepEqual(hub.videos.filter((v) => v.lang === "ja").map((v) => v.title), ["V1ja", "V8ja", "V9ja"]);
});

test("ключ раздела с языком и без", () => {
  assert.equal(sectionKey("hsr", "videos", "ja"), "hsr:videos:ja");
  assert.equal(sectionKey("hsr", "codes"), "hsr:codes");
});

test("сломанная лента берёт прошлые видео своего языка; видео без lang — английское", () => {
  const old = { gameId: "hsr", title: "Old", url: "https://www.youtube.com/watch?v=old", thumb: null, publishedAt: NOW - 50, duration: null, premiere: false } as unknown as Video;
  const prev: HubData = { version: 2, updatedAt: NOW - 3600, games: catalog, codes: [], banners: [], videos: [old, video(1, "ja")] };
  const runs = new Map<string, SourceRun<Item>>([
    [sectionKey("hsr", "videos", "en"), { kind: "broken", error: "x" }],
    [sectionKey("hsr", "videos", "ja"), { kind: "broken", error: "x" }],
  ]);
  const hub = mergeHub({ previous: prev, catalog, runs, now: NOW });
  assert.deepEqual(hub.videos.map((v) => [v.title, v.lang]), [["Old", "en"], ["V1ja", "ja"]]);
});

test("шапка файла и сравнение без updatedAt", () => {
  const hub = mergeHub({ previous, catalog, runs: new Map(), now: NOW });
  assert.equal(hub.version, 2);
  assert.equal(hub.updatedAt, NOW);
  assert.deepEqual(hub.games, catalog);
  assert.equal(sameData(previous, { ...previous, updatedAt: NOW }), true);
  assert.equal(sameData(previous, { ...previous, codes: [] }), false);
  assert.equal(sameData(null, previous), false);
});
