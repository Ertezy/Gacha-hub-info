import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeHub, sameData, sectionKey } from "../src/merge.ts";
import type { Banner, Code, HubData, HubGame, Item, SourceRun, Video } from "../src/types.ts";

const NOW = 1_000_000;
const catalog: HubGame[] = [{ id: "hsr", title: "Honkai: Star Rail", match: { steamAppIds: [], epicAppNames: [], folderNames: [] } }];
const code = (c: string, expiresAt: number | null = null): Code => ({ gameId: "hsr", code: c, rewards: "", expiresAt, region: "all", source: null });
const banner = (title: string, startsAt: number, endsAt: number): Banner => ({ gameId: "hsr", title, featured: [], rarity: 5, image: null, startsAt, endsAt, url: null });
const video = (n: number): Video => ({ gameId: "hsr", title: `V${n}`, url: `https://www.youtube.com/watch?v=${n}`, thumb: null, publishedAt: NOW - n, duration: null, premiere: false });

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

test("видео по свежести, не больше шести", () => {
  const runs = new Map<string, SourceRun<Item>>([[sectionKey("hsr", "videos"), ok([7, 3, 5, 1, 2, 6, 4].map(video))]]);
  const hub = mergeHub({ previous: null, catalog, runs, now: NOW });
  assert.deepEqual(hub.videos.map((v) => v.title), ["V1", "V2", "V3", "V4", "V5", "V6"]);
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
