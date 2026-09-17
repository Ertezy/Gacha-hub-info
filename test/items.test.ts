import { test } from "node:test";
import assert from "node:assert/strict";
import { isLive, judge } from "../src/items.ts";
import type { Banner, Code } from "../src/types.ts";

const code: Code = { gameId: "hsr", code: "ABCD1234", rewards: "", expiresAt: null, region: "all", source: null };

test("раздел не найден — поломка", () => {
  assert.deepEqual(judge("codes", false, [], 0, 0), { kind: "broken", error: "раздел не найден" });
});

test("ноль кодов при найденном разделе — норма", () => {
  assert.deepEqual(judge("codes", true, [], 0, 0), { kind: "ok", items: [], parsed: 0, dropped: 0 });
});

test("больше половины мусора — поломка; ровно половина — норма", () => {
  assert.equal(judge("codes", true, [code], 3, 2).kind, "broken");
  assert.equal(judge("codes", true, [code, code], 4, 2).kind, "ok");
});

test("ноль разобранных баннеров — поломка, ноль текущих — нет", () => {
  assert.deepEqual(judge("banners", true, [], 0, 0), { kind: "broken", error: "ни одного баннера" });
  assert.equal(judge("banners", true, [], 3, 0).kind, "ok");
});

test("ноль роликов — поломка", () => {
  assert.deepEqual(judge("videos", true, [], 0, 0), { kind: "broken", error: "ни одного ролика" });
});

test("сгоревшее", () => {
  const banner: Banner = { gameId: "hsr", title: "T", featured: [], rarity: 5, image: null, startsAt: 10, endsAt: 100, url: null };
  assert.equal(isLive("codes", code, 50), true);
  assert.equal(isLive("codes", { ...code, expiresAt: 50 }, 50), false);
  assert.equal(isLive("banners", banner, 99), true);
  assert.equal(isLive("banners", banner, 100), false);
});
