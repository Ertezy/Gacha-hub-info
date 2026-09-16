import { test } from "node:test";
import assert from "node:assert/strict";
import { createHttp, USER_AGENT, type FetchLike } from "../src/http.ts";

function fakeFetch(responses: { status: number; body?: string; headers?: Record<string, string> }[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const next = responses.shift();
    if (!next) throw new Error("сеть недоступна");
    return {
      status: next.status,
      text: async () => next.body ?? "",
      headers: { get: (name: string) => next.headers?.[name.toLowerCase()] ?? null },
    };
  };
  return { fetch, calls };
}

const noSleep = async () => {};

test("подпись запроса и условные заголовки", async () => {
  const f = fakeFetch([{ status: 200, body: "ok", headers: { etag: '"v2"' } }]);
  const http = createHttp({ fetch: f.fetch, sleep: noSleep });
  const res = await http.get("https://example.org/a", { etag: '"v1"', lastModified: "Wed, 09 Sep 2026 10:01:03 GMT" });
  assert.equal(res.body, "ok");
  assert.equal(res.validators.etag, '"v2"');
  assert.equal(f.calls[0]!.headers["User-Agent"], USER_AGENT);
  assert.equal(f.calls[0]!.headers["If-None-Match"], '"v1"');
  assert.equal(f.calls[0]!.headers["If-Modified-Since"], "Wed, 09 Sep 2026 10:01:03 GMT");
});

test("304 — пустое тело, это не ошибка", async () => {
  const f = fakeFetch([{ status: 304 }]);
  const res = await createHttp({ fetch: f.fetch, sleep: noSleep }).get("https://example.org/a", { etag: '"v1"' });
  assert.equal(res.status, 304);
  assert.equal(res.body, "");
});

test("503 повторяется один раз", async () => {
  const f = fakeFetch([{ status: 503 }, { status: 200, body: "ok" }]);
  const res = await createHttp({ fetch: f.fetch, sleep: noSleep }).get("https://example.org/a");
  assert.equal(res.body, "ok");
  assert.equal(f.calls.length, 2);
});

test("после второй неудачи — ошибка с кодом ответа", async () => {
  const f = fakeFetch([{ status: 429 }, { status: 429 }]);
  await assert.rejects(createHttp({ fetch: f.fetch, sleep: noSleep }).get("https://example.org/a"), /429/);
});

test("404 не повторяется", async () => {
  const f = fakeFetch([{ status: 404 }]);
  await assert.rejects(createHttp({ fetch: f.fetch, sleep: noSleep }).get("https://example.org/a"), /404/);
  assert.equal(f.calls.length, 1);
});

test("не https — отказ без запроса", async () => {
  const f = fakeFetch([]);
  await assert.rejects(createHttp({ fetch: f.fetch, sleep: noSleep }).get("http://example.org/a"), /https/);
  assert.equal(f.calls.length, 0);
});

test("ответ больше потолка — ошибка", async () => {
  const f = fakeFetch([{ status: 200, body: "x".repeat(11) }]);
  await assert.rejects(createHttp({ fetch: f.fetch, sleep: noSleep, maxBytes: 10 }).get("https://example.org/a"), /потолок/);
});

test("к одному хосту запросы идут по одному", async () => {
  let active = 0;
  let peak = 0;
  const fetch: FetchLike = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return { status: 200, text: async () => "ok", headers: { get: () => null } };
  };
  const http = createHttp({ fetch, sleep: noSleep });
  await Promise.all([http.get("https://example.org/a"), http.get("https://example.org/b"), http.get("https://example.org/c")]);
  assert.equal(peak, 1);
});
