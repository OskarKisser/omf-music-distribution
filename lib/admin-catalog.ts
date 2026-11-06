import type { AdminCatalogRelease } from "@/types/admin";

/** Трек каталога: строка списка «Треки». */
export type CatalogTrack = {
  key: string;
  releaseId: string;
  title: string;
  artist: string;
  featuring: string[];
  explicit: boolean;
  duration: number | null;
  releaseTitle: string;
  releaseType: AdminCatalogRelease["release_type"];
  artworkUrl: string | null;
  acceptedAt: string;
  /** Артист заполнил питчинг релиза. */
  pitched: boolean;
};

export type CatalogArtist = {
  name: string;
  tracks: number;
  releases: number;
  lastAcceptedAt: string;
};

export type CatalogSummary = {
  tracks: number;
  releases: number;
  artists: number;
  /** Треков, принятых с начала текущего месяца. */
  tracksThisMonth: number;
};

/** Ключ артиста: без регистра, «ё» и лишних пробелов — «KISSER» и «Kisser » один артист. */
export function artistKey(name: string): string {
  return name.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

/** Все треки каталога, свежие сверху, внутри релиза — по порядку. */
export function flattenCatalogTracks(releases: readonly AdminCatalogRelease[]): CatalogTrack[] {
  const sorted = [...releases].sort((a, b) => b.accepted_at.localeCompare(a.accepted_at));
  const out: CatalogTrack[] = [];
  for (const r of sorted) {
    r.tracks.forEach((t, i) => {
      out.push({
        key: `${r.id}:${i}`,
        releaseId: r.id,
        title: t.title.trim() || r.title,
        artist: r.artist_name,
        featuring: r.featuring,
        explicit: t.explicit,
        duration: t.duration,
        releaseTitle: r.title,
        releaseType: r.release_type,
        artworkUrl: r.artwork_url,
        acceptedAt: r.accepted_at,
        pitched: r.pitched_at != null
      });
    });
  }
  return out;
}

/** Артисты по числу отгруженных треков (потом — по свежести). */
export function groupCatalogByArtist(releases: readonly AdminCatalogRelease[]): CatalogArtist[] {
  const byKey = new Map<string, CatalogArtist>();
  for (const r of releases) {
    const key = artistKey(r.artist_name);
    if (!key) continue;
    const prev = byKey.get(key);
    if (prev) {
      prev.tracks += r.tracks.length;
      prev.releases += 1;
      if (r.accepted_at > prev.lastAcceptedAt) prev.lastAcceptedAt = r.accepted_at;
    } else {
      byKey.set(key, {
        name: r.artist_name.trim(),
        tracks: r.tracks.length,
        releases: 1,
        lastAcceptedAt: r.accepted_at
      });
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) => b.tracks - a.tracks || b.lastAcceptedAt.localeCompare(a.lastAcceptedAt)
  );
}

export function summarizeCatalog(releases: readonly AdminCatalogRelease[], now: Date = new Date()): CatalogSummary {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let tracks = 0;
  let tracksThisMonth = 0;
  const artists = new Set<string>();
  for (const r of releases) {
    tracks += r.tracks.length;
    if (new Date(r.accepted_at).getTime() >= monthStart) tracksThisMonth += r.tracks.length;
    const key = artistKey(r.artist_name);
    if (key) artists.add(key);
  }
  return { tracks, releases: releases.length, artists: artists.size, tracksThisMonth };
}

/** Поиск по треку: название трека и релиза, артист, feat. */
export function matchesCatalogTrack(track: CatalogTrack, query: string): boolean {
  const q = artistKey(query);
  if (!q) return true;
  return [track.title, track.releaseTitle, track.artist, ...track.featuring].some((v) => artistKey(v).includes(q));
}

/** Релизы, где артист заполнил питчинг: последние правки сверху. */
export function pitchedCatalogReleases(
  releases: readonly AdminCatalogRelease[]
): (AdminCatalogRelease & { pitched_at: string })[] {
  return releases
    .filter((r): r is AdminCatalogRelease & { pitched_at: string } => r.pitched_at != null)
    .sort((a, b) => b.pitched_at.localeCompare(a.pitched_at));
}

type PitchedRelease = AdminCatalogRelease & { pitched_at: string };

/** Сегодня в формате YYYY-MM-DD по локальному времени. */
export function localIsoDay(now: Date = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

/**
 * Питчинг делим по срочности: «до выхода» — редакциям ещё можно отправить, ближайшие релизы сверху;
 * «уже вышли» — для истории, свежие правки сверху.
 */
export function splitPitching(
  releases: readonly AdminCatalogRelease[],
  today: string = localIsoDay()
): { upcoming: PitchedRelease[]; released: PitchedRelease[] } {
  const all = pitchedCatalogReleases(releases);
  const upcoming = all
    .filter((r) => r.release_date != null && r.release_date >= today)
    .sort((a, b) => (a.release_date ?? "").localeCompare(b.release_date ?? ""));
  const released = all.filter((r) => !(r.release_date != null && r.release_date >= today));
  return { upcoming, released };
}
