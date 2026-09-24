import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseFromPublished, emptyState, isDue, loadState, missingPrevious, recordRun, saveState } from "../src/state.ts";
import type { Failure } from "../src/issues.ts";
import type { HubData, Item, SourceRun } from "../src/types.ts";

const NOW = 1_000_000;

test("пора ли опрашивать", () => {
  assert.equal(isDue(undefined, 6, NOW), true);
  assert.equal(isDue(NOW - 3600, 1, NOW), true);
  assert.equal(isDue(NOW - 3400, 1, NOW), true, "запуск сдвинулся на несколько минут");
  assert.equal(isDue(NOW - 3000, 1, NOW), false);
  assert.equal(isDue(NOW - 5 * 3600, 6, NOW), false);
});

test("isDue: ровно на границе запаса — уже пора, секундой раньше — ещё нет", () => {
  const everyHours = 2;
  const boundary = NOW - (everyHours * 3600 - 300);
  assert.equal(isDue(boundary, everyHours, NOW), true);
  assert.equal(isDue(boundary + 1, everyHours, NOW), false);
});

test("счётчик неудач", () => {
  const failures: Record<string, Failure> = {};
  recordRun(failures, "a", { kind: "broken", error: "503" }, NOW - 3600);
  recordRun(failures, "a", { kind: "broken", error: "429" }, NOW);
  assert.deepEqual(failures.a, { consecutive: 2, since: NOW - 3600, lastError: "429", lastAttempt: NOW });
  recordRun(failures, "a", { kind: "skipped" }, NOW + 1);
  assert.equal(failures.a?.consecutive, 2);
  recordRun(failures, "a", { kind: "unchanged" }, NOW + 2);
  assert.equal(failures.a, undefined);
});

test("счётчик неудач: успешный запуск (ok) тоже стирает запись", () => {
  const failures: Record<string, Failure> = { b: { consecutive: 3, since: NOW - 100, lastError: "x", lastAttempt: NOW - 50 } };
  recordRun(failures, "b", { kind: "ok", items: [], parsed: 1, dropped: 0 }, NOW);
  assert.equal(failures.b, undefined);
});

test("состояние сохраняется и читается; испорченное — null", () => {
  const dir = mkdtempSync(join(tmpdir(), "collector-"));
  const path = join(dir, "state.json");
  const state = emptyState();
  state.lastRun.x = NOW;
  saveState(state, path);
  assert.deepEqual(loadState(path), state);
  writeFileSync(path, "{broken");
  assert.equal(loadState(path), null);
  writeFileSync(path, JSON.stringify({ version: 99 }));
  assert.equal(loadState(path), null);
  assert.equal(loadState(join(dir, "missing.json")), null);
});

test("состояние без memory или с неполным memory считается отсутствующим", () => {
  const dir = mkdtempSync(join(tmpdir(), "collector-"));
  const path = join(dir, "state.json");
  writeFileSync(path, JSON.stringify({ version: 1, base: null, published: null, lastPublishedAt: null, lastRun: {}, failures: {} }));
  assert.equal(loadState(path), null, "memory отсутствует целиком");
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      base: null,
      published: null,
      lastPublishedAt: null,
      lastRun: {},
      failures: {},
      memory: { revisions: {}, pages: {}, validators: {} },
    }),
  );
  assert.equal(loadState(path), null, "у memory нет kuro");
});

test("состояние с испорченным base или published считается отсутствующим", () => {
  const dir = mkdtempSync(join(tmpdir(), "collector-"));
  const path = join(dir, "state.json");
  const valid = emptyState();
  writeFileSync(path, JSON.stringify({ ...valid, base: {} }));
  assert.equal(loadState(path), null, "base — не HubData");
  writeFileSync(path, JSON.stringify({ ...valid, published: { codes: [], banners: [] } }));
  assert.equal(loadState(path), null, "у published нет videos");
});

test("из выложенного файла убираются записи владельца", () => {
  const hub: HubData = {
    version: 2,
    updatedAt: NOW,
    games: [],
    codes: [
      { gameId: "hsr", code: "WIKICODE", rewards: "", expiresAt: null, region: "all", source: "https://wiki" },
      { gameId: "endfield", code: "OWNERCODE", rewards: "", expiresAt: null, region: "all", source: null },
    ],
    banners: [
      { gameId: "hsr", title: "Wiki", featured: [], rarity: 5, image: null, startsAt: 1, endsAt: 2, url: "https://wiki/b" },
      { gameId: "wuthering", title: "Owner", featured: [], rarity: 5, image: null, startsAt: 1, endsAt: 2, url: null },
    ],
    videos: [],
  };
  const base = baseFromPublished(hub);
  assert.deepEqual(base.codes.map((c) => c.code), ["WIKICODE"]);
  assert.deepEqual(base.banners.map((b) => b.title), ["Wiki"]);
});

test("baseFromPublished не трогает остальные поля файла", () => {
  const hub: HubData = {
    version: 2,
    updatedAt: 12345,
    games: [{ id: "genshin", title: "Genshin Impact", match: { steamAppIds: [], epicAppNames: [], folderNames: [] } }],
    codes: [],
    banners: [],
    videos: [{ gameId: "genshin", lang: "en", title: "T", url: "https://www.youtube.com/watch?v=1", thumb: null, publishedAt: 1, duration: null, premiere: false }],
  };
  const base = baseFromPublished(hub);
  assert.equal(base.version, 2);
  assert.equal(base.updatedAt, 12345);
  assert.deepEqual(base.games, hub.games);
  assert.deepEqual(base.videos, hub.videos);
});

test("без прошлых данных сломанный или пропущенный раздел — ошибка", () => {
  const runs = new Map<string, SourceRun<Item>>([
    ["genshin:codes", { kind: "broken", error: "503" }],
    ["genshin:banners", { kind: "skipped" }],
    ["hsr:codes", { kind: "ok", items: [], parsed: 1, dropped: 0 }],
  ]);
  const errors = missingPrevious(runs, false);
  assert.equal(errors.length, 2);
  assert.ok(errors.some((e) => e.includes("genshin:codes")));
  assert.ok(errors.some((e) => e.includes("genshin:banners")));
});

test("без прошлых данных, но запасной источник заполнил раздел — без ошибки", () => {
  const runs = new Map<string, SourceRun<Item>>([["genshin:codes", { kind: "ok", items: [], parsed: 1, dropped: 0 }]]);
  assert.deepEqual(missingPrevious(runs, false), []);
});

test("прошлые данные есть — сломанный или пропущенный раздел не страшен", () => {
  const runs = new Map<string, SourceRun<Item>>([
    ["genshin:codes", { kind: "broken", error: "503" }],
    ["genshin:banners", { kind: "skipped" }],
  ]);
  assert.deepEqual(missingPrevious(runs, true), []);
});
