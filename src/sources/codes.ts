// Разбор кодов. Только чистые функции над текстом страницы или телом ответа:
// сеть и выбор источника живут в registry.ts.

import type { Code, GameId } from "../types.ts";
import { atOffset, inTimeZone, parseEnglishDate, parseIsoLike } from "../time.ts";
import { findTemplates, rewardsText, templateParams } from "../wikitext.ts";

export interface ParsedCodes {
  found: boolean;
  codes: Code[];
  parsed: number;
  dropped: number;
}

export const ENNEAD_SOURCE = "https://github.com/torikushiii/hoyoverse-api";

export const CODE_PATTERN = /^[A-Za-z0-9]{4,40}$/;

const NO_EXPIRY = new Set(["", "unknown", "indef", "indefinite", "tba"]);

/** Срок из ячейки страницы HoYoverse: null — без срока, undefined — не разобрать. */
function hoyoExpiry(value: string): number | null | undefined {
  const text = value.trim();
  if (NO_EXPIRY.has(text.toLowerCase())) return null;
  const parts = parseIsoLike(text);
  return parts ? atOffset(parts, 0) : undefined;
}

export function parseRowCodes(
  wikitext: string,
  template: "Code Row" | "Redemption Code Row",
  gameId: GameId,
  source: string,
): ParsedCodes {
  const rows = findTemplates(wikitext, template);
  const found = rows.length > 0 || wikitext.includes(`{{${template}/Header}}`);
  const codes: Code[] = [];
  let parsed = 0;
  let dropped = 0;
  for (const row of rows) {
    const { positional, named } = templateParams(row);
    const [cell = "", server = "", rewards = "", , expiry = ""] = positional;
    if (server.trim().toUpperCase() === "CN" || named.get("notacode")?.toLowerCase() === "yes") continue;
    parsed++;
    const expiresAt = hoyoExpiry(expiry);
    const group = cell.split(";").map((code) => code.trim());
    if (expiresAt === undefined || group.some((code) => !CODE_PATTERN.test(code))) {
      dropped++;
      continue;
    }
    for (const code of group) {
      codes.push({ gameId, code, rewards: rewardsText(rewards), expiresAt, region: "all", source });
    }
  }
  return { found, codes, parsed, dropped };
}

const WUWA_ROW =
  /<code>([^<]+)<\/code>\s*\|\|\s*[^|]*?\s*\|\|\s*(\{\{Card List[\s\S]*?\}\})[\s\S]*?Valid until:\s*([^'<\n]+)/g;

export function parseWuwaCodes(wikitext: string, source: string): ParsedCodes {
  const start = wikitext.indexOf("===Active===");
  if (start === -1) return { found: false, codes: [], parsed: 0, dropped: 0 };
  const rest = wikitext.slice(start + "===Active===".length);
  const next = rest.search(/\n===[^=]/);
  const section = next === -1 ? rest : rest.slice(0, next);
  const codes: Code[] = [];
  let parsed = 0;
  let dropped = 0;
  for (const m of section.matchAll(WUWA_ROW)) {
    parsed++;
    const code = m[1]!.trim();
    const until = m[3]!.replace(/\(PT\)/, "").trim();
    let expiresAt: number | null = null;
    if (until.toLowerCase() !== "unknown") {
      const parts = parseEnglishDate(until);
      if (!parts) {
        dropped++;
        continue;
      }
      expiresAt = inTimeZone(parts, "America/Los_Angeles");
    }
    if (!CODE_PATTERN.test(code)) {
      dropped++;
      continue;
    }
    codes.push({ gameId: "wuthering", code, rewards: rewardsText(m[2]!), expiresAt, region: "all", source });
  }
  return { found: true, codes, parsed, dropped };
}

export function parseEnneadCodes(json: unknown, gameId: GameId): ParsedCodes {
  const active = (json as { active?: unknown } | null)?.active;
  if (!Array.isArray(active)) return { found: false, codes: [], parsed: 0, dropped: 0 };
  const codes: Code[] = [];
  let dropped = 0;
  for (const entry of active as { code?: unknown; rewards?: unknown }[]) {
    const code = typeof entry.code === "string" ? entry.code.trim() : "";
    const rewards = Array.isArray(entry.rewards) ? entry.rewards.filter((r) => typeof r === "string") : [];
    if (!CODE_PATTERN.test(code)) {
      dropped++;
      continue;
    }
    codes.push({ gameId, code, rewards: rewards.join(", "), expiresAt: null, region: "all", source: ENNEAD_SOURCE });
  }
  return { found: true, codes, parsed: active.length, dropped };
}
