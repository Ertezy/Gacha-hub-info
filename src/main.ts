// Один запуск сборщика целиком (спека §3).

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHttp } from "./http.ts";
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
  recordRun,
  saveState,
} from "./state.ts";
import type { HubData, HubGame, Item, SourceRun } from "./types.ts";
import { validateHub } from "./validate.ts";

const dryRun = process.argv.includes("--dry-run");
const now = Math.floor(Date.now() / 1000);
const http = createHttp();
const state = loadState() ?? emptyState();

if (state.base === null) {
  try {
    const published = JSON.parse((await http.get(PAGES_URL)).body) as HubData;
    state.published = published;
    state.base = baseFromPublished(published);
    state.lastPublishedAt = published.updatedAt;
    console.log("Состояния нет — прошлые данные взяты с Pages.");
  } catch {
    console.log("Состояния нет и на Pages файла нет — сбор с нуля.");
  }
}

const catalog = JSON.parse(readFileSync("catalog.json", "utf8")) as HubGame[];
const ctx = { http, now, memory: state.memory };
const runs = new Map<string, SourceRun<Item>>();
const report: string[] = [];

await Promise.all(
  SOURCES.filter((s) => !s.fallback).map(async (source) => {
    const key = sectionKey(source.game, source.section);
    if (!isDue(state.lastRun[source.id], source.everyHours, now)) {
      runs.set(key, { kind: "skipped" });
      return;
    }
    const run = await source.run(ctx);
    state.lastRun[source.id] = now;
    recordRun(state.failures, source.id, run, now);
    runs.set(key, run);
    report.push(`${source.id}: ${run.kind === "broken" ? `сломан — ${run.error}` : run.kind}`);
  }),
);

await Promise.all(
  SOURCES.filter((s) => s.fallback).map(async (source) => {
    const key = sectionKey(source.game, source.section);
    if (runs.get(key)?.kind !== "broken") {
      delete state.failures[source.id];
      return;
    }
    const run = await source.run(ctx);
    recordRun(state.failures, source.id, run, now);
    if (run.kind === "ok") runs.set(key, run);
    report.push(`${source.id} (запасной): ${run.kind === "broken" ? `сломан — ${run.error}` : run.kind}`);
  }),
);

let announcements = state.memory.kuro.filter((a) => a.publishedAt >= now - 21 * 86400);
if (isDue(state.lastRun[KURO_SIGNAL.id], KURO_SIGNAL.everyHours, now)) {
  const result = await fetchKuroAnnouncements(ctx);
  state.lastRun[KURO_SIGNAL.id] = now;
  if (result.ok) {
    announcements = result.announcements;
    delete state.failures[KURO_SIGNAL.id];
  } else {
    recordRun(state.failures, KURO_SIGNAL.id, { kind: "broken", error: result.error }, now);
  }
}

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

const knownStarts = [
  ...wuwaKnownStarts(state.memory),
  ...overrides.banners.filter((b) => b.game === "wuthering").flatMap((b) => {
    const at = parseMoment(b.starts);
    return at === null ? [] : [at];
  }),
];
const wuwaSignal = unknownToWiki(announcements, knownStarts);

const changed = !sameData(state.published, hub);
const stale = state.lastPublishedAt === null || now - state.lastPublishedAt >= REPUBLISH_SECONDS - SLACK_SECONDS;
const publish = validationErrors.length === 0 && (changed || stale);

if (validationErrors.length === 0) state.base = base;
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

if (!dryRun && process.env.GITHUB_TOKEN) {
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

if (!dryRun) saveState(state);

report.push(
  `коды ${hub.codes.length}, баннеры ${hub.banners.length}, видео ${hub.videos.length}`,
  `проверка: ${validationErrors.length === 0 ? "пройдена" : validationErrors.join(" | ")}`,
  `правки: ${overridesErrors.length === 0 ? "в порядке" : overridesErrors.join(" | ")}`,
  `выкладка: ${publish ? "да" : "нет"}${dryRun ? " (пробный запуск, файл в public/hub.json)" : ""}`,
);
console.log(report.join("\n"));
