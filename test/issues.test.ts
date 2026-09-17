import { test } from "node:test";
import assert from "node:assert/strict";
import { createGitHub, formatTime, keyOf, planIssues, withKey, type IssueInputs } from "../src/issues.ts";

const utc = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo - 1, d, h, mi) / 1000;
const NOW = utc(2026, 9, 16, 14, 17);

const base = (patch: Partial<IssueInputs> = {}): IssueInputs => ({
  failures: {},
  labels: { "wuthering-codes": "коды Wuthering Waves (фандом)" },
  validationErrors: [],
  overridesErrors: [],
  wuwaSignal: null,
  daysSinceHumanCommit: 3,
  open: [],
  now: NOW,
  runUrl: "https://github.com/Ertezy/Gacha-hub-info/actions/runs/1",
  repoUrl: "https://github.com/Ertezy/Gacha-hub-info",
  ...patch,
});

const failure = (consecutive: number) => ({ consecutive, since: NOW - 7200, lastError: "ответ 503", lastAttempt: NOW });

test("время по-русски", () => {
  assert.equal(formatTime(NOW), "16 сентября 2026, 14:17 UTC");
});

test("метка ключа в тексте", () => {
  assert.equal(keyOf(withKey("source:x", "текст")), "source:x");
  assert.equal(keyOf("без метки"), null);
});

test("одна неудача — задачи нет", () => {
  assert.deepEqual(planIssues(base({ failures: { "wuthering-codes": failure(1) } })), []);
});

test("две неудачи подряд — задача с понятным заголовком и меткой", () => {
  const actions = planIssues(base({ failures: { "wuthering-codes": failure(2) } }));
  assert.equal(actions.length, 1);
  const a = actions[0]!;
  assert.equal(a.type, "open");
  if (a.type !== "open") return;
  assert.equal(a.title, "Не работает: коды Wuthering Waves (фандом)");
  assert.equal(keyOf(a.body), "source:wuthering-codes");
  assert.match(a.body, /ответ 503/);
  assert.match(a.body, /actions\/runs\/1/);
});

test("открытая задача — только обновление текста", () => {
  const actions = planIssues(base({ failures: { "wuthering-codes": failure(5) }, open: [{ number: 7, key: "source:wuthering-codes" }] }));
  assert.deepEqual(actions.map((a) => a.type), ["update"]);
});

test("источник заработал — комментарий и закрытие", () => {
  const actions = planIssues(base({ open: [{ number: 7, key: "source:wuthering-codes" }] }));
  assert.equal(actions.length, 1);
  assert.equal(actions[0]!.type, "close");
  if (actions[0]!.type === "close") assert.equal(actions[0]!.comment, "Заработал в 16 сентября 2026, 14:17 UTC.");
});

test("проверка файла и файл правок", () => {
  const opened = planIssues(base({ validationErrors: ["codes[0].code: плохо"], overridesErrors: ["codes[1]: плохо"] }));
  assert.deepEqual(opened.map((a) => (a.type === "open" ? keyOf(a.body) : a.type)), ["validation", "overrides"]);
  const closed = planIssues(base({ open: [{ number: 3, key: "validation" }, { number: 4, key: "overrides" }] }));
  assert.deepEqual(closed.map((a) => a.type), ["close", "close"]);
});

test("45 дней без коммита — задача; меньше — закрытие", () => {
  assert.equal(planIssues(base({ daysSinceHumanCommit: 45 }))[0]?.type, "open");
  assert.equal(planIssues(base({ daysSinceHumanCommit: 44, open: [{ number: 9, key: "inactivity" }] }))[0]?.type, "close");
  assert.deepEqual(planIssues(base({ daysSinceHumanCommit: null })), []);
});

test("сигнал о баннере: открыть, сменить на новый анонс, закрыть", () => {
  const signal = (id: number) => ({ articleId: id, publishedAt: NOW - 86400, url: `https://wutheringwaves.kurogames.com/en/main/news/detail/${id}` });
  const opened = planIssues(base({ wuwaSignal: signal(5431) }));
  assert.equal(opened[0]?.type === "open" ? keyOf(opened[0].body) : null, "wuwa-signal:5431");
  if (opened[0]?.type === "open") assert.match(opened[0].body, /news\/detail\/5431/);
  const moved = planIssues(base({ wuwaSignal: signal(5500), open: [{ number: 11, key: "wuwa-signal:5431" }] }));
  assert.deepEqual(moved.map((a) => a.type).sort(), ["close", "open"]);
  const gone = planIssues(base({ open: [{ number: 11, key: "wuwa-signal:5431" }] }));
  assert.deepEqual(gone.map((a) => a.type), ["close"]);
});

test("чужие открытые задачи не трогаются", () => {
  assert.deepEqual(planIssues(base({ open: [{ number: 1, key: "something-else" }] })), []);
});

test("клиент GitHub: список, открытие, закрытие", async () => {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/issues?state=open")) {
      return new Response(JSON.stringify([
        { number: 7, body: withKey("source:a", "x") },
        { number: 8, body: "без метки" },
        { number: 9, body: withKey("source:b", "x"), pull_request: {} },
      ]));
    }
    if (url.endsWith("/labels")) return new Response("{}", { status: 422 });
    if (url.includes("/commits")) {
      return new Response(JSON.stringify([
        { author: { login: "github-actions[bot]", type: "Bot" }, commit: { committer: { date: "2026-09-16T10:00:00Z" } } },
        { author: { login: "Ertezy", type: "User" }, commit: { committer: { date: "2026-09-01T10:00:00Z" } } },
      ]));
    }
    return new Response("{}", { status: 201 });
  }) as typeof fetch;
  const gh = createGitHub({ token: "t", repo: "Ertezy/Gacha-hub-info", fetch: fakeFetch });
  assert.deepEqual(await gh.listOpen(), [{ number: 7, key: "source:a" }]);
  await gh.open("Заголовок", "Текст");
  assert.deepEqual(calls.slice(-2).map((c) => [c.method, c.url.replace("https://api.github.com/repos/Ertezy/Gacha-hub-info", "")]), [
    ["POST", "/labels"],
    ["POST", "/issues"],
  ]);
  assert.deepEqual((calls.at(-1)!.body as { labels: string[] }).labels, ["сборщик"]);
  await gh.close(7, "Заработал.");
  assert.deepEqual(calls.slice(-2).map((c) => c.method), ["POST", "PATCH"]);
  assert.equal(await gh.lastHumanCommitAt(), Date.UTC(2026, 8, 1, 10, 0) / 1000);
});
