// Последний рубеж перед выкладкой: файл проверяется по тем же правилам, что
// соблюдает приложение. Не прошёл — в сети остаётся прошлый рабочий файл.

import { CODE_PATTERN } from "./sources/codes.ts";
import { VIDEOS_PER_GAME } from "./sources/videos.ts";
import { GAME_IDS, type HubData } from "./types.ts";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

const MAX_ERRORS = 50;

const isInt = (value: unknown) => Number.isInteger(value);
const httpsOrNull = (value: unknown) => value === null || (typeof value === "string" && value.startsWith("https://"));
const text = (value: unknown, min: number, max: number) => typeof value === "string" && value.length >= min && value.length <= max;

export function validateHub(hub: HubData, maxBytes = MAX_FILE_BYTES): string[] {
  const errors: string[] = [];
  const fail = (message: string) => {
    if (errors.length < MAX_ERRORS) errors.push(message);
  };

  if (hub.version !== 2) fail("version: должна быть 2");
  if (!isInt(hub.updatedAt) || hub.updatedAt <= 0) fail("updatedAt: целое число секунд");

  const gameIds = new Set<string>();
  hub.games.forEach((g, i) => {
    if (!(GAME_IDS as readonly string[]).includes(g.id) || gameIds.has(g.id)) fail(`games[${i}].id: неизвестная или повторная игра ${g.id}`);
    gameIds.add(g.id);
    if (!text(g.title, 1, 100)) fail(`games[${i}].title: 1–100 знаков`);
    if (!(g.redeemUrl === undefined || (typeof g.redeemUrl === "string" && g.redeemUrl.startsWith("https://") && g.redeemUrl.includes("{code}")))) {
      fail(`games[${i}].redeemUrl: https с {code}`);
    }
  });
  const knownGame = (id: string) => gameIds.has(id);

  hub.codes.forEach((c, i) => {
    const at = `codes[${i}]`;
    if (!knownGame(c.gameId)) fail(`${at}.gameId: игры ${c.gameId} нет в файле`);
    if (!(typeof c.code === "string" && CODE_PATTERN.test(c.code))) fail(`${at}.code: латинские буквы и цифры, 4–40 знаков`);
    if (!text(c.rewards, 0, 300)) fail(`${at}.rewards: до 300 знаков`);
    if (c.expiresAt !== null && !isInt(c.expiresAt)) fail(`${at}.expiresAt: целое или null`);
    if (!text(c.region, 1, 16)) fail(`${at}.region: 1–16 знаков`);
    if (!httpsOrNull(c.source)) fail(`${at}.source: https или null`);
  });

  hub.banners.forEach((b, i) => {
    const at = `banners[${i}]`;
    if (!knownGame(b.gameId)) fail(`${at}.gameId: игры ${b.gameId} нет в файле`);
    if (!text(b.title, 1, 200)) fail(`${at}.title: 1–200 знаков`);
    if (!Array.isArray(b.featured) || b.featured.length > 10 || !b.featured.every((f) => text(f, 1, 80))) {
      fail(`${at}.featured: до 10 имён по 80 знаков`);
    }
    if (b.rarity !== null && !(isInt(b.rarity) && b.rarity >= 1 && b.rarity <= 6)) fail(`${at}.rarity: 1–6 или null`);
    if (!httpsOrNull(b.image)) fail(`${at}.image: https или null`);
    if (!httpsOrNull(b.url)) fail(`${at}.url: https или null`);
    if (!isInt(b.startsAt)) fail(`${at}.startsAt: целое`);
    if (!isInt(b.endsAt) || b.endsAt <= b.startsAt) fail(`${at}.endsAt: целое и позже начала`);
  });

  const perGame = new Map<string, number>();
  hub.videos.forEach((v, i) => {
    const at = `videos[${i}]`;
    if (!knownGame(v.gameId)) fail(`${at}.gameId: игры ${v.gameId} нет в файле`);
    if (!text(v.title, 0, 300)) fail(`${at}.title: до 300 знаков`);
    if (!(typeof v.url === "string" && v.url.startsWith("https://www.youtube.com/"))) fail(`${at}.url: только https://www.youtube.com/`);
    if (!httpsOrNull(v.thumb)) fail(`${at}.thumb: https или null`);
    if (!isInt(v.publishedAt)) fail(`${at}.publishedAt: целое`);
    perGame.set(v.gameId, (perGame.get(v.gameId) ?? 0) + 1);
  });
  for (const [game, count] of perGame) {
    if (count > VIDEOS_PER_GAME) fail(`videos: у ${game} ${count} роликов, больше ${VIDEOS_PER_GAME}`);
  }

  const bytes = Buffer.byteLength(JSON.stringify(hub), "utf8");
  if (bytes > maxBytes) fail(`файл: ${bytes} байт, больше потолка ${maxBytes}`);

  return errors;
}
