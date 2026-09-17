// Все запросы сборщика идут отсюда: одна подпись, таймаут, один повтор,
// условные заголовки и очередь по хосту, чтобы не нагружать чужие сайты.

export const USER_AGENT = "GachaHubCollector/1.0 (+https://github.com/Ertezy/Gacha-hub-info)";

export interface Validators {
  etag?: string;
  lastModified?: string;
}

export interface HttpResponse {
  status: number;
  body: string;
  validators: Validators;
}

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ status: number; text(): Promise<string>; headers: { get(name: string): string | null } }>;

export interface HttpOptions {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  retryDelayMs?: number;
  /** Минимальная пауза между запросами к хосту, мс. */
  hostGapMs?: Record<string, number>;
  maxBytes?: number;
}

export interface Http {
  get(url: string, validators?: Validators): Promise<HttpResponse>;
}

/** Пауза для ennead.cc: их объявленный лимит — 2 запроса в секунду. */
export const DEFAULT_HOST_GAPS: Record<string, number> = { "api.ennead.cc": 500 };

const RETRYABLE = new Set([403, 429, 500, 502, 503, 504]);

export function createHttp(options: HttpOptions = {}): Http {
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 20_000;
  const retryDelayMs = options.retryDelayMs ?? 5_000;
  const hostGapMs = options.hostGapMs ?? DEFAULT_HOST_GAPS;
  const maxBytes = options.maxBytes ?? 5_000_000;
  const queues = new Map<string, Promise<unknown>>();
  const lastStart = new Map<string, number>();

  async function attempt(url: string, validators: Validators): Promise<HttpResponse> {
    const headers: Record<string, string> = { "User-Agent": USER_AGENT };
    if (validators.etag) headers["If-None-Match"] = validators.etag;
    if (validators.lastModified) headers["If-Modified-Since"] = validators.lastModified;
    const res = await doFetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    const fresh: Validators = {};
    const etag = res.headers.get("etag");
    const lastModified = res.headers.get("last-modified");
    if (etag) fresh.etag = etag;
    if (lastModified) fresh.lastModified = lastModified;
    if (res.status === 304) return { status: 304, body: "", validators: validators };
    if (res.status !== 200) throw new StatusError(res.status, url);
    const body = await res.text();
    if (body.length > maxBytes) throw new TooLargeError(maxBytes, url);
    return { status: 200, body, validators: fresh };
  }

  async function withRetry(url: string, validators: Validators): Promise<HttpResponse> {
    try {
      return await attempt(url, validators);
    } catch (error) {
      // Не повторяем только превышение потолка размера и коды ответа не из RETRYABLE
      // (например, 404) — это не временные сбои. Сеть, таймаут и повторяемые коды
      // получают один повтор после паузы.
      if (error instanceof TooLargeError) throw error;
      if (error instanceof StatusError && !RETRYABLE.has(error.status)) throw error;
      await sleep(retryDelayMs);
      return attempt(url, validators);
    }
  }

  return {
    get(url, validators = {}) {
      if (!url.startsWith("https://")) return Promise.reject(new Error(`только https: ${url}`));
      const host = new URL(url).host;
      const previous = queues.get(host) ?? Promise.resolve();
      const task = previous
        .catch(() => undefined)
        .then(async () => {
          const gap = hostGapMs[host] ?? 0;
          const since = Date.now() - (lastStart.get(host) ?? 0);
          if (gap > 0 && since < gap) await sleep(gap - since);
          lastStart.set(host, Date.now());
          return withRetry(url, validators);
        });
      queues.set(host, task);
      return task;
    },
  };
}

export class StatusError extends Error {
  status: number;
  constructor(status: number, url: string) {
    super(`ответ ${status}: ${url}`);
    this.status = status;
  }
}

class TooLargeError extends Error {
  constructor(maxBytes: number, url: string) {
    super(`ответ превысил потолок ${maxBytes} байт: ${url}`);
  }
}
