// Какие источники есть, как часто их спрашивать и как из ответа получить записи.

import type { Http, Validators } from "../http.ts";
import { judge } from "../items.ts";
import { ENDFIELD_WIKI, categoryMembers, expandTemplates, fandom, lastRevisions, pageWikitext, thumbnails, type Wiki } from "../mediawiki.ts";
import { GAME_IDS, VIDEO_LANGS, type Banner, type GameId, type Item, type Section, type SourceRun, type VideoLang } from "../types.ts";
import { BANNER_PAGES, parseBannerPage, parseEndfieldTable, parseEnneadBanners, recentBannerPages, type BannerDraft, type BannerPageSpec, type PageOutcome } from "./banners.ts";
import { parseEnneadCodes, parseRowCodes, parseWuwaCodes } from "./codes.ts";
import { KURO_MENU_URL, conveneAnnouncements, type Announcement } from "./kuro.ts";
import { CHANNELS, feedUrl, parseYoutubeFeed } from "./videos.ts";

export interface SourceMemory {
  revisions: Record<string, number>;
  pages: Record<string, { rev: number; outcome: PageOutcome }>;
  validators: Record<string, Validators>;
  kuro: Announcement[];
}

export const emptyMemory = (): SourceMemory => ({ revisions: {}, pages: {}, validators: {}, kuro: [] });

export interface SourceContext {
  http: Http;
  now: number;
  memory: SourceMemory;
}

export interface SourceDef {
  id: string;
  game: GameId;
  section: Section;
  /** Только у видео: язык канала. Входит в ключ раздела (`genshin:videos:ja`). */
  lang?: VideoLang;
  label: string;
  everyHours: number;
  fallback: boolean;
  run(ctx: SourceContext): Promise<SourceRun<Item>>;
}

const TITLES: Record<GameId, string> = {
  genshin: "Genshin Impact",
  hsr: "Honkai: Star Rail",
  zzz: "Zenless Zone Zero",
  wuthering: "Wuthering Waves",
  endfield: "Arknights: Endfield",
};

const ENNEAD_SLUGS: Record<"genshin" | "hsr" | "zzz", string> = { genshin: "genshin", hsr: "starrail", zzz: "zenless" };

/** Любое исключение внутри источника превращается в его поломку. */
async function guarded(run: () => Promise<SourceRun<Item>>): Promise<SourceRun<Item>> {
  try {
    return await run();
  } catch (error) {
    return { kind: "broken", error: (error as Error).message };
  }
}

function fandomCodes(id: string, game: GameId, subdomain: string, page: string, template: "Code Row" | "Redemption Code Row" | "wuwa"): SourceDef {
  return {
    id,
    game,
    section: "codes",
    label: `коды ${TITLES[game]} (фандом)`,
    everyHours: 1,
    fallback: false,
    run: ({ http, memory }) =>
      guarded(async () => {
        const wiki = fandom(subdomain);
        const rev = (await lastRevisions(http, wiki, [page])).get(page);
        if (rev === undefined) return { kind: "broken", error: `страница ${page} не найдена` };
        const key = `${wiki.api}|${page}`;
        if (memory.revisions[key] === rev) return { kind: "unchanged" };
        const text = await pageWikitext(http, wiki, page);
        const url = wiki.pageUrl(page);
        const r = template === "wuwa" ? parseWuwaCodes(text, url) : parseRowCodes(text, template, game, url);
        const verdict = judge("codes", r.found, r.codes, r.parsed, r.dropped);
        if (verdict.kind === "ok") memory.revisions[key] = rev;
        return verdict;
      }),
  };
}

/** GET с условными заголовками: 304 — null; метки версий отдаются вызвавшему, чтобы запомнить после разбора. */
async function conditional(ctx: SourceContext, url: string): Promise<{ body: string; validators: Validators } | null> {
  const res = await ctx.http.get(url, ctx.memory.validators[url] ?? {});
  return res.status === 304 ? null : { body: res.body, validators: res.validators };
}

function ennead(game: "genshin" | "hsr" | "zzz", section: "codes" | "banners"): SourceDef {
  const url = `https://api.ennead.cc/mihoyo/${ENNEAD_SLUGS[game]}/${section === "codes" ? "codes" : "calendar"}`;
  return {
    id: `${game}-${section}-ennead`,
    game,
    section,
    label: `${section === "codes" ? "коды" : "баннеры"} ${TITLES[game]} (ennead.cc)`,
    everyHours: section === "codes" ? 1 : 6,
    fallback: true,
    run: (ctx) =>
      guarded(async () => {
        const res = await conditional(ctx, url);
        if (res === null) return { kind: "unchanged" };
        const data: unknown = JSON.parse(res.body);
        const verdict =
          section === "codes"
            ? (() => {
                const r = parseEnneadCodes(data, game);
                return judge("codes", r.found, r.codes, r.parsed, r.dropped);
              })()
            : (() => {
                const r = parseEnneadBanners(data, game);
                return judge("banners", r.found, r.banners, r.parsed, r.dropped);
              })();
        if (verdict.kind === "ok") ctx.memory.validators[url] = res.validators;
        return verdict;
      }),
  };
}

async function withThumbnails(http: Http, wiki: Wiki, drafts: BannerDraft[]): Promise<Banner[]> {
  const files = drafts.flatMap((d) => (d.imageFile ? [d.imageFile] : []));
  let thumbs = new Map<string, string>();
  if (files.length > 0) {
    try {
      thumbs = await thumbnails(http, wiki, files);
    } catch {
      // Без миниатюр баннеры остаются с градиентом в приложении; источник не ломается.
    }
  }
  return drafts.map((d) => ({ ...d.banner, image: d.imageFile ? (thumbs.get(d.imageFile.replace(/_/g, " ")) ?? null) : null }));
}

function fandomBanners(spec: BannerPageSpec): SourceDef {
  return {
    id: `${spec.gameId}-banners`,
    game: spec.gameId,
    section: "banners",
    label: `баннеры ${TITLES[spec.gameId]} (фандом)`,
    everyHours: 6,
    fallback: false,
    run: ({ http, now, memory }) =>
      guarded(async () => {
        const wiki = fandom(spec.wiki);
        const titles = recentBannerPages(await categoryMembers(http, wiki, spec.category, 50), now);
        const revs = titles.length > 0 ? await lastRevisions(http, wiki, titles) : new Map<string, number>();
        const drafts: BannerDraft[] = [];
        let parsed = 0;
        let dropped = 0;
        const current = new Set<string>();
        for (const title of titles) {
          const rev = revs.get(title);
          if (rev === undefined) continue;
          const key = `${wiki.api}|${title}`;
          current.add(key);
          let outcome = memory.pages[key]?.rev === rev ? memory.pages[key]!.outcome : undefined;
          if (outcome === undefined) {
            outcome = parseBannerPage(await pageWikitext(http, wiki, title), spec, title, wiki.pageUrl(title));
            // Сломанная страница не запоминается — её нужно перечитать в следующий раз,
            // когда шаблон поправят; удачный разбор (баннер или сознательный skip) кешируется.
            if (outcome.kind !== "bad") memory.pages[key] = { rev, outcome };
          }
          if (outcome.kind === "banner") {
            parsed++;
            drafts.push(outcome.draft);
          } else if (outcome.kind === "bad") {
            parsed++;
            dropped++;
          }
        }
        for (const key of Object.keys(memory.pages)) {
          if (key.startsWith(`${wiki.api}|`) && !current.has(key)) delete memory.pages[key];
        }
        return judge("banners", true, await withThumbnails(http, wiki, drafts), parsed, dropped);
      }),
  };
}

const endfieldBanners: SourceDef = {
  id: "endfield-banners",
  game: "endfield",
  section: "banners",
  label: "баннеры Arknights: Endfield (wiki.gg)",
  everyHours: 6,
  fallback: false,
  run: ({ http }) =>
    guarded(async () => {
      const text = await expandTemplates(http, ENDFIELD_WIKI, "{{Banner table|current}}\n{{Banner table|upcoming}}");
      const r = parseEndfieldTable(text, ENDFIELD_WIKI.pageUrl("Headhunting/Banners"));
      return judge("banners", true, await withThumbnails(http, ENDFIELD_WIKI, r.drafts), r.parsed, r.dropped);
    }),
};

const LANG_LABELS: Record<VideoLang, string> = { en: "англ.", ja: "япон." };

function youtube(game: GameId, lang: VideoLang): SourceDef {
  const channel = CHANNELS[lang][game];
  const url = feedUrl(channel);
  return {
    id: `${game}-videos-${lang}`,
    game,
    section: "videos",
    lang,
    label: `видео ${TITLES[game]} (YouTube, ${LANG_LABELS[lang]})`,
    everyHours: 1,
    fallback: false,
    run: (ctx) =>
      guarded(async () => {
        const res = await conditional(ctx, url);
        if (res === null) return { kind: "unchanged" };
        const r = parseYoutubeFeed(res.body, game, channel, lang);
        const verdict = judge("videos", r.found, r.videos, r.parsed, r.dropped);
        if (verdict.kind === "ok") ctx.memory.validators[url] = res.validators;
        return verdict;
      }),
  };
}

export const SOURCES: SourceDef[] = [
  fandomCodes("genshin-codes", "genshin", "genshin-impact", "Promotional_Code", "Code Row"),
  ennead("genshin", "codes"),
  fandomCodes("hsr-codes", "hsr", "honkai-star-rail", "Redemption_Code", "Redemption Code Row"),
  ennead("hsr", "codes"),
  fandomCodes("zzz-codes", "zzz", "zenless-zone-zero", "Redemption_Code", "Redemption Code Row"),
  ennead("zzz", "codes"),
  fandomCodes("wuthering-codes", "wuthering", "wutheringwaves", "Redemption_Code", "wuwa"),
  fandomBanners(BANNER_PAGES.genshin),
  ennead("genshin", "banners"),
  fandomBanners(BANNER_PAGES.hsr),
  ennead("hsr", "banners"),
  fandomBanners(BANNER_PAGES.zzz),
  ennead("zzz", "banners"),
  fandomBanners(BANNER_PAGES.wuthering),
  endfieldBanners,
  ...GAME_IDS.flatMap((game) => VIDEO_LANGS.map((lang) => youtube(game, lang))),
];

export const KURO_SIGNAL = { id: "wuthering-signal", label: "анонсы баннеров Wuthering Waves (сайт Kuro Games)", everyHours: 6 } as const;

export async function fetchKuroAnnouncements(
  ctx: SourceContext,
): Promise<{ ok: true; announcements: Announcement[] } | { ok: false; error: string }> {
  try {
    const res = await conditional(ctx, KURO_MENU_URL);
    if (res === null) return { ok: true, announcements: conveneFresh(ctx.memory.kuro, ctx.now) };
    const r = conveneAnnouncements(JSON.parse(res.body), ctx.now);
    if (!r.found) return { ok: false, error: "список новостей не разобрался" };
    ctx.memory.kuro = r.announcements;
    ctx.memory.validators[KURO_MENU_URL] = res.validators;
    return { ok: true, announcements: r.announcements };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Анонсы из памяти тоже стареют: не старше 21 дня, как в conveneAnnouncements. */
const conveneFresh = (list: Announcement[], now: number) => list.filter((a) => a.publishedAt >= now - 21 * 86400);

/** Начала всех баннеров Wuthering Waves, которые фандом уже знает (в том числе закончившихся). */
export function wuwaKnownStarts(memory: SourceMemory): number[] {
  const prefix = `${fandom(BANNER_PAGES.wuthering.wiki).api}|`;
  return Object.entries(memory.pages)
    .filter(([key]) => key.startsWith(prefix))
    .flatMap(([, page]) => (page.outcome.kind === "banner" ? [page.outcome.draft.banner.startsAt] : []));
}
