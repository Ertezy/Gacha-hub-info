// Состояние между запусками. Лежит в кеше GitHub Actions, в репозиторий не
// попадает: данные не коммитятся (спека §3).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Failure } from "./issues.ts";
import { emptyMemory, type SourceMemory } from "./sources/registry.ts";
import type { HubData, Item, SourceRun } from "./types.ts";

export const STATE_FILE = ".collector-state/state.json";
export const PAGES_URL = "https://ertezy.github.io/Gacha-hub-info/hub.json";

/** Файл перевыкладывается не реже раза в 6 часов: на его метку времени смотрит правило протухания в приложении. */
export const REPUBLISH_SECONDS = 6 * 3600;

/** Запуск по расписанию сдвигается на минуты; без запаса часовой источник пропускал бы час. */
export const SLACK_SECONDS = 300;

export interface State {
  version: 1;
  base: HubData | null;
  published: HubData | null;
  lastPublishedAt: number | null;
  lastRun: Record<string, number>;
  failures: Record<string, Failure>;
  memory: SourceMemory;
}

export const emptyState = (): State => ({
  version: 1,
  base: null,
  published: null,
  lastPublishedAt: null,
  lastRun: {},
  failures: {},
  memory: emptyMemory(),
});

export function loadState(path = STATE_FILE): State | null {
  try {
    const state = JSON.parse(readFileSync(path, "utf8")) as State;
    return state.version === 1 ? state : null;
  } catch {
    return null;
  }
}

export function saveState(state: State, path = STATE_FILE): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state));
}

export function isDue(lastRun: number | undefined, everyHours: number, now: number): boolean {
  return lastRun === undefined || now - lastRun >= everyHours * 3600 - SLACK_SECONDS;
}

export function recordRun(failures: Record<string, Failure>, sourceId: string, run: SourceRun<Item>, now: number): void {
  if (run.kind === "skipped") return;
  if (run.kind !== "broken") {
    delete failures[sourceId];
    return;
  }
  const previous = failures[sourceId];
  failures[sourceId] = {
    consecutive: (previous?.consecutive ?? 0) + 1,
    since: previous?.since ?? now,
    lastError: run.error,
    lastAttempt: now,
  };
}

/** Прошлые данные из выложенного файла без записей владельца: они вернутся из overrides.json. */
export function baseFromPublished(hub: HubData): HubData {
  return {
    ...hub,
    codes: hub.codes.filter((c) => c.source !== null),
    banners: hub.banners.filter((b) => b.url !== null),
  };
}
