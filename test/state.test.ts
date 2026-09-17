import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseFromPublished, emptyState, isDue, loadState, recordRun, saveState } from "../src/state.ts";
import type { Failure } from "../src/issues.ts";
import type { HubData } from "../src/types.ts";

const NOW = 1_000_000;

test("пора ли опрашивать", () => {
  assert.equal(isDue(undefined, 6, NOW), true);
  assert.equal(isDue(NOW - 3600, 1, NOW), true);
  assert.equal(isDue(NOW - 3400, 1, NOW), true, "запуск сдвинулся на несколько минут");
  assert.equal(isDue(NOW - 3000, 1, NOW), false);
  assert.equal(isDue(NOW - 5 * 3600, 6, NOW), false);
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
