import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GAME_IDS } from "../src/types.ts";

test("каталог знает ровно пять игр в том же порядке", () => {
  const catalog = JSON.parse(readFileSync("catalog.json", "utf8")) as { id: string }[];
  assert.deepEqual(catalog.map((g) => g.id), [...GAME_IDS]);
});
