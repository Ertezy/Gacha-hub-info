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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * «Похоже на файл хаба» — минимальная проверка формы, а не полная (её делает validateHub).
 * Используется и для полей base/published состояния, и для живого файла с Pages: без неё
 * плохая форма где-нибудь позже роняет .filter()/.map() исключением.
 */
export function looksLikeHub(value: unknown): value is HubData {
  return isRecord(value) && Array.isArray(value.codes) && Array.isArray(value.banners) && Array.isArray(value.videos);
}

/** Файл состояния мог быть обрезан или отредактирован вручную: форма проверяется, а не только version. */
function looksLikeState(value: unknown): value is State {
  if (!isRecord(value) || value.version !== 1) return false;
  if (!isRecord(value.lastRun) || !isRecord(value.failures)) return false;
  if (!(value.base === null || looksLikeHub(value.base))) return false;
  if (!(value.published === null || looksLikeHub(value.published))) return false;
  const memory = value.memory;
  if (!isRecord(memory)) return false;
  return isRecord(memory.revisions) && isRecord(memory.pages) && isRecord(memory.validators) && Array.isArray(memory.kuro);
}

export function loadState(path = STATE_FILE): State | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    return looksLikeState(raw) ? raw : null;
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

/** Убирает записи об источниках, которых больше нет (спека этапа 6 §3.1).
 *  Иначе старая неудача держала бы задачу о поломке открытой вечно: удалить
 *  её может только удачный опрос того же источника. */
export function pruneState(state: State, knownIds: ReadonlySet<string>): string[] {
  const removed = new Set<string>();
  for (const record of [state.lastRun, state.failures] as Record<string, unknown>[]) {
    for (const id of Object.keys(record)) {
      if (knownIds.has(id)) continue;
      delete record[id];
      removed.add(id);
    }
  }
  return [...removed].sort();
}

/** Прошлые данные из выложенного файла без записей владельца: они вернутся из overrides.json. */
export function baseFromPublished(hub: HubData): HubData {
  return {
    ...hub,
    codes: hub.codes.filter((c) => c.source !== null),
    banners: hub.banners.filter((b) => b.url !== null),
  };
}

/**
 * Без прошлых данных сломанный или пропущенный раздел слился бы в пустой список и вытеснил бы
 * живой файл на Pages пустым разделом. По одному сообщению на каждый такой раздел — они уходят в
 * общий список ошибок проверки, и публикация вместе с обновлением base сами собой не проходят.
 */
export function missingPrevious(runs: Map<string, SourceRun<Item>>, hadPrevious: boolean): string[] {
  if (hadPrevious) return [];
  const offending: { key: string; broken: boolean }[] = [];
  for (const [key, run] of runs) {
    if (run.kind === "broken" || run.kind === "skipped") offending.push({ key, broken: run.kind === "broken" });
  }
  // Раздел с одним и тем же именем всегда даёт один и тот же текст: сообщения попадают в тело
  // задачи, и нестабильный порядок делал бы её похожей на изменившуюся, когда ничего не менялось.
  offending.sort((a, b) => a.key.localeCompare(b.key));
  return offending.map(
    (o) => `${o.key}: источник ${o.broken ? "сломан" : "пропущен"}, а прошлых данных для этого раздела нет — файл не выкладывается`,
  );
}
