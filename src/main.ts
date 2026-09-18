// Один запуск сборщика целиком (спека §3).

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHttp, StatusError } from "./http.ts";
import { applyIssueActions, createGitHub, planIssues } from "./issues.ts";
import { mergeHub, sameData, sectionKey } from "./merge.ts";
import { applyOverrides, parseMoment, parseOverrides, type Overrides } from "./overrides.ts";
import { unknownToWiki } from "./sources/kuro.ts";
import { KURO_SIGNAL, SOURCES, fetchKuroAnnouncements, wuwaKnownStarts } from "./sources/registry.ts";
import {
  PAGES_URL,
  REPUBLISH_SECONDS,
  SLACK_SECONDS,
  baseFromPublished,
  emptyState,
  isDue,
  loadState,
  looksLikeHub,
  missingPrevious,
  recordRun,
  saveState,
} from "./state.ts";
import type { HubData, HubGame, Item, SourceRun } from "./types.ts";
import { validateHub } from "./validate.ts";

const dryRun = process.argv.includes("--dry-run");
const now = Math.floor(Date.now() / 1000);
const http = createHttp();
const state = loadState() ?? emptyState();

// Живой файл проверяется на каждом прогоне, не только когда состояния нет:
// когда состояние есть, он ещё и подтверждает, что прошлая выкладка дошла (см. ниже).
let liveHub: HubData | null = null;
let liveCheckFailed: string | null = null;
try {
  const parsed: unknown = JSON.parse((await http.get(PAGES_URL)).body);
  if (looksLikeHub(parsed)) {
    liveHub = parsed;
  } else {
    // Валидный JSON не той формы — читать оттуда нечего; ведём себя так, будто файла нет,
    // а не роняем прогон исключением где-то ниже по цепочке.
    console.log("Файл на Pages не похож на файл хаба — считаем, что выложенного файла нет.");
  }
} catch (error) {
  if (error instanceof StatusError && error.status === 404) {
    // файла ещё нет — это не сбой, а ожидаемое состояние для нового репозитория
  } else if (state.base === null) {
    // прошлых данных нет нигде, а проверка живого файла провалилась не из-за 404 —
    // неожиданный сбой; пусть процесс упадёт, и GitHub сам напишет владельцу письмом
    throw error;
  } else {
    liveCheckFailed = (error as Error).message;
  }
}

if (state.base === null) {
  if (liveHub !== null) {
    const base = baseFromPublished(liveHub);
    state.base = base;
    state.published = liveHub;
    state.lastPublishedAt = liveHub.updatedAt;
    console.log("Состояния нет — прошлые данные взяты с Pages.");
  } else {
    console.log("Состояния нет и на Pages файла нет — сбор с нуля.");
  }
} else if (liveCheckFailed !== null) {
  console.log(`Не удалось проверить, дошла ли прошлая выкладка: ${liveCheckFailed} — пропускаем проверку.`);
} else if (!(liveHub !== null && sameData(state.published, liveHub))) {
  // живого файла нет (окончательный 404) или он отличается от того, что мы выложили —
  // прошлая выкладка не дошла; перевыложим при первой возможности
  state.lastPublishedAt = null;
  console.log("Прошлая выкладка не дошла до Pages — перевыложим при первой возможности.");
}

const catalog = JSON.parse(readFileSync("catalog.json", "utf8")) as HubGame[];

// Источники работают с копией памяти и отметок времени: если итог не пройдёт проверку,
// state.memory и state.lastRun останутся прежними и источники честно перечитаются заново
// на следующем прогоне, а не будут считаться «уже обработанными» (спека §3).
const memory = structuredClone(state.memory);
const lastRun: Record<string, number> = { ...state.lastRun };
const ctx = { http, now, memory };
const runs = new Map<string, SourceRun<Item>>();
const report: string[] = [];

await Promise.all(
  SOURCES.filter((s) => !s.fallback).map(async (source) => {
    const key = sectionKey(source.game, source.section);
    if (!isDue(lastRun[source.id], source.everyHours, now)) {
      runs.set(key, { kind: "skipped" });
      console.log(`${source.id}: skipped`);
      return;
    }
    const run = await source.run(ctx);
    lastRun[source.id] = now;
    recordRun(state.failures, source.id, run, now);
    runs.set(key, run);
    console.log(`${source.id}: ${run.kind === "broken" ? `сломан — ${run.error}` : run.kind}`);
  }),
);

await Promise.all(
  SOURCES.filter((s) => s.fallback).map(async (source) => {
    const key = sectionKey(source.game, source.section);
    const mainKind = runs.get(key)?.kind;
    if (mainKind !== "broken") {
      // Основной источник пропущен в этом прогоне (не наступил час) — это не «он здоров»,
      // счётчик неудач запасного трогать нельзя, как и recordRun сам не трогает skipped.
      if (mainKind === "ok" || mainKind === "unchanged") delete state.failures[source.id];
      return;
    }
    const run = await source.run(ctx);
    recordRun(state.failures, source.id, run, now);
    if (run.kind === "ok") runs.set(key, run);
    console.log(`${source.id} (запасной): ${run.kind === "broken" ? `сломан — ${run.error}` : run.kind}`);
  }),
);

let announcements = memory.kuro.filter((a) => a.publishedAt >= now - 21 * 86400);
if (isDue(lastRun[KURO_SIGNAL.id], KURO_SIGNAL.everyHours, now)) {
  const result = await fetchKuroAnnouncements(ctx);
  lastRun[KURO_SIGNAL.id] = now;
  if (result.ok) {
    announcements = result.announcements;
    delete state.failures[KURO_SIGNAL.id];
  } else {
    recordRun(state.failures, KURO_SIGNAL.id, { kind: "broken", error: result.error }, now);
  }
}

const hadPrevious = state.base !== null;
const base = mergeHub({ previous: state.base, catalog, runs, now });

let overrides: Overrides = { codes: [], banners: [], hide: [] };
let overridesErrors: string[] = [];
try {
  const parsed = parseOverrides(JSON.parse(readFileSync("overrides.json", "utf8")));
  if (parsed.ok) overrides = parsed.overrides;
  else overridesErrors = parsed.errors;
} catch (error) {
  overridesErrors = [`не читается как JSON: ${(error as Error).message}`];
}

const hub = applyOverrides(base, overrides, now);
const validationErrors = validateHub(hub);
validationErrors.push(...missingPrevious(runs, hadPrevious));

const knownStarts = [
  ...wuwaKnownStarts(memory),
  ...overrides.banners.filter((b) => b.game === "wuthering").flatMap((b) => {
    const at = parseMoment(b.starts);
    return at === null ? [] : [at];
  }),
];
const wuwaSignal = unknownToWiki(announcements, knownStarts);

const changed = !sameData(state.published, hub);
const stale = state.lastPublishedAt === null || now - state.lastPublishedAt >= REPUBLISH_SECONDS - SLACK_SECONDS;
const publish = validationErrors.length === 0 && (changed || stale);

if (validationErrors.length === 0) {
  state.base = base;
  state.memory = memory;
  state.lastRun = lastRun;
}
if (publish || dryRun) {
  mkdirSync("public", { recursive: true });
  writeFileSync("public/hub.json", JSON.stringify(hub));
}
if (publish && !dryRun) {
  state.published = hub;
  state.lastPublishedAt = now;
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);

const labels = Object.fromEntries([...SOURCES.map((s) => [s.id, s.label] as const), [KURO_SIGNAL.id, KURO_SIGNAL.label]]);
const repo = process.env.GITHUB_REPOSITORY ?? "Ertezy/Gacha-hub-info";
const repoUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repo}`;
const runUrl = process.env.GITHUB_RUN_ID ? `${repoUrl}/actions/runs/${process.env.GITHUB_RUN_ID}` : repoUrl;

// Состояние сохраняется независимо от того, дозвонимся ли мы до GitHub за задачами:
// прогон не должен терять память и счётчики из-за сбоя одного лишь API задач.
if (!dryRun) saveState(state);

if (!dryRun && process.env.GITHUB_TOKEN) {
  try {
    const github = createGitHub({ token: process.env.GITHUB_TOKEN, repo });
    const lastCommit = await github.lastHumanCommitAt();
    const actions = planIssues({
      failures: state.failures,
      labels,
      validationErrors,
      overridesErrors,
      wuwaSignal,
      daysSinceHumanCommit: lastCommit === null ? null : Math.floor((now - lastCommit) / 86400),
      open: await github.listOpen(),
      now,
      runUrl,
      repoUrl,
    });
    await applyIssueActions(github, actions);
    report.push(`задачи: ${actions.map((a) => a.type).join(", ") || "без изменений"}`);
  } catch (error) {
    // Задачи живут на GitHub, а не локально: следующий прогон сам сверится заново.
    // Но владелец должен узнать о сбое — процесс завершится с ошибкой.
    report.push(`задачи в GitHub не обновились: ${(error as Error).message}`);
    process.exitCode = 1;
  }
} else {
  const actions = planIssues({
    failures: state.failures,
    labels,
    validationErrors,
    overridesErrors,
    wuwaSignal,
    daysSinceHumanCommit: null,
    open: [],
    now,
    runUrl,
    repoUrl,
  });
  report.push(`задачи (не отправлены): ${actions.map((a) => (a.type === "open" ? a.title : a.type)).join("; ") || "нет"}`);
}

report.push(
  `коды ${hub.codes.length}, баннеры ${hub.banners.length}, видео ${hub.videos.length}`,
  `проверка: ${validationErrors.length === 0 ? "пройдена" : validationErrors.join(" | ")}`,
  `правки: ${overridesErrors.length === 0 ? "в порядке" : overridesErrors.join(" | ")}`,
  `выкладка: ${publish ? "да" : "нет"}${dryRun ? " (пробный запуск, файл в public/hub.json)" : ""}`,
);
console.log(report.join("\n"));
