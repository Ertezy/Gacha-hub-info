// Ленты YouTube официальных англоязычных каналов. Канал сверяется по
// идентификатору. У Endfield английский канал — @ArknightsEndfieldEN: лента
// основного @ArknightsEndfield пуста.

import type { GameId, Video } from "../types.ts";

export const CHANNELS: Record<GameId, string> = {
  genshin: "UCiS882YPwZt1NfaM0gR0D9Q",
  hsr: "UC2PeMPA8PAOp-bynLoCeMLA",
  zzz: "UC2SpC8rL9LaeQriE4YNdyzA",
  wuthering: "UC0Bi5KMcECRVYis5Gb_ZYZQ",
  endfield: "UCowPaVRBzg8CE6K4CB6LJfw",
};

/** Столько роликов показывает панель приложения. */
export const VIDEOS_PER_GAME = 6;

export const feedUrl = (channelId: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" };
const decode = (text: string) => text.replace(/&(?:amp|quot|#39|lt|gt);/g, (e) => ENTITIES[e] ?? e);
const pick = (block: string, re: RegExp) => re.exec(block)?.[1];

export function parseYoutubeFeed(
  xml: string,
  gameId: GameId,
  channelId: string,
): { found: boolean; videos: Video[]; parsed: number; dropped: number } {
  if (!xml.includes("<feed")) return { found: false, videos: [], parsed: 0, dropped: 0 };
  const videos: Video[] = [];
  let parsed = 0;
  let dropped = 0;
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    parsed++;
    const block = m[1]!;
    const channel = pick(block, /<yt:channelId>([^<]+)<\/yt:channelId>/);
    const url = pick(block, /<link rel="alternate" href="([^"]+)"/);
    const title = pick(block, /<title>([^<]*)<\/title>/);
    const publishedAt = Date.parse(pick(block, /<published>([^<]+)<\/published>/) ?? "") / 1000;
    const thumb = pick(block, /<media:thumbnail url="([^"]+)"/);
    if (channel !== channelId || !url?.startsWith("https://www.youtube.com/") || title === undefined || !Number.isFinite(publishedAt)) {
      dropped++;
      continue;
    }
    videos.push({
      gameId,
      title: decode(title).trim(),
      url,
      thumb: thumb?.startsWith("https://") ? thumb : null,
      publishedAt: Math.floor(publishedAt),
      duration: null,
      premiere: false,
    });
  }
  videos.sort((a, b) => b.publishedAt - a.publishedAt);
  return { found: true, videos: videos.slice(0, VIDEOS_PER_GAME), parsed, dropped };
}
