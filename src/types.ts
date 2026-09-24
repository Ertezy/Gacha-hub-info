// Типы файла хаба версии 2. Должны совпадать со схемой приложения
// (src-tauri/src/hub/schema.rs): приложение читает ровно эти поля.

export type GameId = "genshin" | "hsr" | "zzz" | "wuthering" | "endfield";

export const GAME_IDS: readonly GameId[] = ["genshin", "hsr", "zzz", "wuthering", "endfield"];

export type Section = "codes" | "banners" | "videos";

export interface Code {
  gameId: GameId;
  code: string;
  rewards: string;
  /** Unix-секунды; null — срок неизвестен или код бессрочный. */
  expiresAt: number | null;
  region: string;
  /** Страница, откуда взят код, — указание источника по лицензии. */
  source: string | null;
}

export interface Banner {
  gameId: GameId;
  title: string;
  featured: string[];
  rarity: number | null;
  /** Уменьшенная копия шириной 400 точек или null. */
  image: string | null;
  startsAt: number;
  endsAt: number;
  /** Страница вики с баннером. */
  url: string | null;
}

/** Языки видео: английский — основной, японский — по выбору в приложении (спека этапа 6 §3). */
export type VideoLang = "en" | "ja";
export const VIDEO_LANGS: readonly VideoLang[] = ["en", "ja"];

export interface Video {
  gameId: GameId;
  lang: VideoLang;
  title: string;
  url: string;
  thumb: string | null;
  publishedAt: number;
  duration: null;
  premiere: false;
}

export interface HubGame {
  id: GameId;
  title: string;
  redeemUrl?: string;
  match: { steamAppIds: number[]; epicAppNames: string[]; folderNames: string[] };
}

export interface HubData {
  version: 2;
  updatedAt: number;
  games: HubGame[];
  codes: Code[];
  banners: Banner[];
  videos: Video[];
}

export type Item = Code | Banner | Video;

/** Итог одного источника за запуск. */
export type SourceRun<T extends Item> =
  | { kind: "ok"; items: T[]; parsed: number; dropped: number }
  | { kind: "unchanged" }
  | { kind: "skipped" }
  | { kind: "broken"; error: string };
