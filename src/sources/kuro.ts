// Сигнал о новом баннере Wuthering Waves. Условия Kuro Games запрещают
// воспроизводить содержимое сайта, поэтому отсюда берутся только номер статьи
// и время её публикации — для ссылки в задаче владельцу (спека §6.2, §7).

import { atOffset, parseIsoLike } from "../time.ts";

export const KURO_MENU_URL =
  "https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en/ArticleMenu.json";

export const kuroArticleUrl = (id: number) => `https://wutheringwaves.kurogames.com/en/main/news/detail/${id}`;

export interface Announcement {
  articleId: number;
  publishedAt: number;
  url: string;
}

/** Время на сайте Kuro — UTC+8. */
const KURO_OFFSET_MINUTES = 480;

const FRESH_DAYS = 21;

export function conveneAnnouncements(json: unknown, now: number): { found: boolean; announcements: Announcement[] } {
  if (!Array.isArray(json)) return { found: false, announcements: [] };
  const announcements: Announcement[] = [];
  for (const article of json as { articleId?: unknown; articleTitle?: unknown; startTime?: unknown }[]) {
    if (typeof article !== "object" || article === null) continue;
    if (typeof article.articleId !== "number" || typeof article.articleTitle !== "string" || typeof article.startTime !== "string") continue;
    if (!/convene/i.test(article.articleTitle) || /^\s*convene details\s*$/i.test(article.articleTitle)) continue;
    const parts = parseIsoLike(article.startTime);
    if (!parts) continue;
    const publishedAt = atOffset(parts, KURO_OFFSET_MINUTES);
    if (publishedAt < now - FRESH_DAYS * 86400 || publishedAt > now) continue;
    announcements.push({ articleId: article.articleId, publishedAt, url: kuroArticleUrl(article.articleId) });
  }
  announcements.sort((a, b) => b.publishedAt - a.publishedAt);
  return { found: true, announcements };
}

/** Самый свежий анонс, если он новее всех известных начал баннеров; иначе null. */
export function unknownToWiki(announcements: Announcement[], knownStarts: number[]): Announcement | null {
  const newest = announcements[0];
  if (!newest) return null;
  const latestKnown = knownStarts.length > 0 ? Math.max(...knownStarts) : Number.NEGATIVE_INFINITY;
  return newest.publishedAt > latestKnown ? newest : null;
}
