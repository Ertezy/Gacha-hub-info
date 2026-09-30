// Официальные анонсы Kuro Games для Wuthering Waves. Условия сайта запрещают
// воспроизводить его содержимое, поэтому берутся только факты: название баннера,
// имя 5★ резонатора, даты и конец техработ — со ссылкой на сам анонс. Ни текста
// статей, ни картинок здесь нет. Источник убирается при первой просьбе Kuro
// (спека §6.2, §7, поправка от 30 сентября 2026). Номер статьи и время её
// публикации дополнительно служат сигналом владельцу: если из самого свежего
// анонса баннер не вышел, сборщик открывает задачу.

import { atOffset, EUROPE_SERVER_OFFSET_MINUTES, parseIsoLike } from "../time.ts";
import { GAME_IDS, type Banner, type HubData } from "../types.ts";
import { bannerFits } from "../validate.ts";

export const KURO_MENU_URL =
  "https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en/ArticleMenu.json";

/** JSON статьи; из него берутся только факты (см. kuroBannerFacts и maintenanceEnd). */
export const KURO_ARTICLE_JSON_DIR = "https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en/article/";

export const kuroArticleJsonUrl = (id: number) => `${KURO_ARTICLE_JSON_DIR}${id}.json`;

const KURO_NEWS_PREFIX = "https://wutheringwaves.kurogames.com/en/main/news/detail/";

export const kuroArticleUrl = (id: number) => `${KURO_NEWS_PREFIX}${id}`;

/** Ссылка на анонс Kuro: так записи Kuro отличаются от записей вики. */
export const isKuroUrl = (url: string) => url.startsWith(KURO_NEWS_PREFIX);

export interface Announcement {
  articleId: number;
  publishedAt: number;
  url: string;
}

/** Патчноут версии: из него берётся только конец техработ — начало баннеров «с выходом версии». */
export interface PatchNotes {
  articleId: number;
  version: string;
  publishedAt: number;
}

/** Время на сайте Kuro — UTC+8. */
const KURO_OFFSET_MINUTES = 480;

const FRESH_SECONDS = 21 * 86400;

/** Статья не старше 21 дня и уже опубликована. */
export const isFresh = (publishedAt: number, now: number) => publishedAt >= now - FRESH_SECONDS && publishedAt <= now;

/** Меню: свежие анонсы баннеров и свежие патчноуты, самые новые первыми. */
export function conveneAnnouncements(
  json: unknown,
  now: number,
): { found: boolean; announcements: Announcement[]; patchNotes: PatchNotes[] } {
  if (!Array.isArray(json)) return { found: false, announcements: [], patchNotes: [] };
  const announcements: Announcement[] = [];
  const patchNotes: PatchNotes[] = [];
  for (const article of json as { articleId?: unknown; articleTitle?: unknown; startTime?: unknown }[]) {
    if (typeof article !== "object" || article === null) continue;
    if (typeof article.articleId !== "number" || typeof article.articleTitle !== "string" || typeof article.startTime !== "string") continue;
    const isConvene = /convene/i.test(article.articleTitle) && !/^\s*convene details\s*$/i.test(article.articleTitle);
    const version = patchNotesVersion(article.articleTitle);
    if (!isConvene && version === null) continue;
    const parts = parseIsoLike(article.startTime);
    if (!parts) continue;
    const publishedAt = atOffset(parts, KURO_OFFSET_MINUTES);
    if (!isFresh(publishedAt, now)) continue;
    if (isConvene) announcements.push({ articleId: article.articleId, publishedAt, url: kuroArticleUrl(article.articleId) });
    if (version !== null) patchNotes.push({ articleId: article.articleId, version, publishedAt });
  }
  announcements.sort((a, b) => b.publishedAt - a.publishedAt);
  patchNotes.sort((a, b) => b.publishedAt - a.publishedAt);
  return { found: true, announcements, patchNotes };
}

/** Самый свежий анонс, если он новее всех известных начал баннеров; иначе null. */
export function unknownToWiki(announcements: Announcement[], knownStarts: number[]): Announcement | null {
  const newest = announcements[0];
  if (!newest) return null;
  const latestKnown = knownStarts.length > 0 ? Math.max(...knownStarts) : Number.NEGATIVE_INFINITY;
  return newest.publishedAt > latestKnown ? newest : null;
}

/** Начало баннера: момент или «с выходом версии X.Y». */
export type KuroStart = { kind: "at"; at: number } | { kind: "release"; version: string };

export interface KuroBannerFact {
  title: string;
  /** Имя 5★ резонатора. */
  featured: string;
  start: KuroStart;
  /** Unix-секунды. */
  endsAt: number;
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Именованные и числовые (&#10022;, &#x2726;) сущности; незнакомые остаются как есть. */
const decodeEntities = (text: string) =>
  text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, dec?: string, hex?: string, name?: string) => {
    if (name !== undefined) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    const code = dec !== undefined ? Number(dec) : parseInt(hex!, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });

/**
 * Текст статьи из JSON Kuro: теги убраны, <br>, <p>, <div>, <li> и <h1>–<h6> —
 * переводы строк, сущности раскрыты, пустые строки выброшены. Не объект или
 * нет articleContent — null.
 */
export function articleText(article: unknown): string[] | null {
  if (typeof article !== "object" || article === null) return null;
  const content = (article as { articleContent?: unknown }).articleContent;
  if (typeof content !== "string") return null;
  // Теги режутся до раскрытия сущностей: «&lt;b&gt;» должно остаться текстом.
  const withBreaks = content.replace(/<br\s*\/?>|<\/?(?:p|div|li|h[1-6])\b[^>]*>/gi, "\n");
  return decodeEntities(withBreaks.replace(/<[^>]*>/g, ""))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

const RESONATOR_HEAD = /^\[(.+?)\]\s*Featured Resonator Convene\s*$/i;
const ANY_HEAD = /^\[.+?\]\s*Featured (?:Resonator|Weapon) Convene\s*$/i;
const FEATURED = /5-Star Resonator:\s*([^,!]+?)\s*(?:,|receive|!|$)/i;
const DURATION = /^(.+?)\s+-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*\(server time\)/i;
const RELEASE_START = /^version\s+(\d+\.\d+)\s+update$/i;
const MINUTE_STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

/** Баннеры персонажей из анонса. Пустой массив — ничего не нашлось. */
export function kuroBannerFacts(lines: string[]): KuroBannerFact[] {
  const heads: number[] = [];
  lines.forEach((line, index) => {
    if (ANY_HEAD.test(line)) heads.push(index);
  });
  const facts: KuroBannerFact[] = [];
  heads.forEach((head, n) => {
    const title = RESONATOR_HEAD.exec(lines[head]!)?.[1]?.trim();
    if (!title) return; // блок оружия
    const block = lines.slice(head + 1, heads[n + 1] ?? lines.length);
    const featured = block.map((line) => FEATURED.exec(line)?.[1]).find((name) => name !== undefined);
    const duration = block.map((line) => DURATION.exec(line)).find((m) => m !== null && m !== undefined);
    if (!featured || !duration) return;
    const endParts = parseIsoLike(duration[2]!);
    if (!endParts) return;
    const endsAt = atOffset(endParts, EUROPE_SERVER_OFFSET_MINUTES);
    const from = duration[1]!.trim();
    const release = RELEASE_START.exec(from);
    let start: KuroStart;
    if (release) {
      start = { kind: "release", version: release[1]! };
    } else {
      // Только «ГГГГ-ММ-ДД ЧЧ:ММ»: голая дата у parseIsoLike означала бы конец дня.
      const startParts = MINUTE_STAMP.test(from) ? parseIsoLike(from) : null;
      if (!startParts) return;
      const at = atOffset(startParts, EUROPE_SERVER_OFFSET_MINUTES);
      if (at >= endsAt) return;
      start = { kind: "at", at };
    }
    facts.push({ title, featured, start, endsAt });
  });
  return facts;
}

const MAINTENANCE =
  /Maintenance Time:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*-\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*\(UTC\+8\)/i;

/** Конец техработ из патчноута: «Maintenance Time: A - B (UTC+8)» → B; null, если строки нет. */
export function maintenanceEnd(lines: string[]): number | null {
  for (const line of lines) {
    const m = MAINTENANCE.exec(line);
    const parts = m ? parseIsoLike(m[2]!) : null;
    if (parts) return atOffset(parts, KURO_OFFSET_MINUTES);
  }
  return null;
}

/** Версия из заголовка патчноута («… Version 3.7 …») или null, если это не патчноут. */
export function patchNotesVersion(title: string): string | null {
  if (!/patch notes/i.test(title)) return null;
  return /version\s+(\d+\.\d+)/i.exec(title)?.[1] ?? null;
}

/** Анонс и баннеры, прочитанные из его статьи. */
export interface AnnouncementFacts {
  announcement: Announcement;
  banners: KuroBannerFact[];
}

/**
 * Баннеры из фактов. Начало «с выходом версии» — конец техработ этой версии
 * (releases), а пока патчноута нет, — время публикации анонса. Закончившиеся и
 * не влезающие в пределы файла отбрасываются: одна такая запись не пропустила бы
 * проверку всего файла.
 */
export function kuroBanners(facts: AnnouncementFacts[], releases: Record<string, number>, now: number): Banner[] {
  const banners: Banner[] = [];
  for (const { announcement, banners: list } of facts) {
    for (const fact of list) {
      const startsAt = fact.start.kind === "at" ? fact.start.at : (releases[fact.start.version] ?? announcement.publishedAt);
      if (fact.endsAt <= now || fact.endsAt <= startsAt || !bannerFits(fact.title, [fact.featured])) continue;
      banners.push({
        gameId: "wuthering",
        title: fact.title,
        featured: [fact.featured],
        rarity: 5,
        image: null,
        startsAt,
        endsAt: fact.endsAt,
        url: kuroArticleUrl(announcement.articleId),
      });
    }
  }
  return banners;
}

/** Одно название и начала в пределах 2 суток — это один и тот же баннер, а не его повтор. */
const SAME_BANNER_SECONDS = 2 * 86400;

const sameBanner = (a: Banner, b: Banner) =>
  a.gameId === b.gameId &&
  a.title.trim().toLowerCase() === b.title.trim().toLowerCase() &&
  Math.abs(a.startsAt - b.startsAt) <= SAME_BANNER_SECONDS;

/**
 * Добавляет баннеры Kuro, которых там ещё нет. Фандом побеждает: у него есть
 * картинка. Из двух одинаковых записей Kuro остаётся первая (анонсы в списке
 * идут от новых к старым).
 */
export function withKuroBanners(hub: HubData, kuro: Banner[]): HubData {
  const banners = [...hub.banners];
  for (const banner of kuro) {
    if (!banners.some((b) => sameBanner(b, banner))) banners.push(banner);
  }
  if (banners.length === hub.banners.length) return hub;
  banners.sort((a, b) => GAME_IDS.indexOf(a.gameId) - GAME_IDS.indexOf(b.gameId) || a.startsAt - b.startsAt);
  return { ...hub, banners };
}
