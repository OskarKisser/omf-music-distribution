import { describe, it, expect } from "vitest";
import {
  flattenCatalogTracks,
  groupCatalogByArtist,
  matchesCatalogTrack,
  pitchedCatalogReleases,
  splitPitching,
  summarizeCatalog
} from "@/lib/admin-catalog";
import type { AdminCatalogRelease } from "@/types/admin";

function release(p: Partial<AdminCatalogRelease> & Pick<AdminCatalogRelease, "id">): AdminCatalogRelease {
  return {
    title: "Релиз",
    artist_name: "KISSER",
    featuring: [],
    release_type: "single",
    genre: null,
    artwork_url: null,
    smart_link: null,
    upc: null,
    accepted_at: "2026-10-10T10:00:00.000Z",
    tracks: [{ title: "Трек", explicit: false, duration: null }],
    release_date: null,
    pitched_at: null,
    ...p
  };
}

const CATALOG = [
  release({ id: "a", artist_name: "KISSER", accepted_at: "2026-09-20T10:00:00.000Z" }),
  release({
    id: "b",
    artist_name: "kisser ",
    title: "EP",
    release_type: "ep",
    accepted_at: "2026-10-05T10:00:00.000Z",
    tracks: [
      { title: "Один", explicit: true, duration: 120 },
      { title: "", explicit: false, duration: null }
    ]
  }),
  release({ id: "c", artist_name: "Sergg59", featuring: ["Ёжик"], accepted_at: "2026-10-12T10:00:00.000Z" })
];

describe("admin catalog", () => {
  it("итоги: треки, релизы, артисты без учёта регистра, треки за месяц", () => {
    expect(summarizeCatalog(CATALOG, new Date(2026, 9, 14))).toEqual({
      tracks: 4,
      releases: 3,
      artists: 2,
      tracksThisMonth: 3
    });
  });

  it("треки: свежие релизы сверху, порядок внутри релиза, пустое название — название релиза", () => {
    const tracks = flattenCatalogTracks(CATALOG);
    expect(tracks.map((t) => t.key)).toEqual(["c:0", "b:0", "b:1", "a:0"]);
    expect(tracks[2].title).toBe("EP");
    expect(tracks[1].explicit).toBe(true);
  });

  it("артисты: по числу треков, одно имя в разном регистре — один артист", () => {
    const artists = groupCatalogByArtist(CATALOG);
    expect(artists).toEqual([
      { name: "KISSER", tracks: 3, releases: 2, lastAcceptedAt: "2026-10-05T10:00:00.000Z" },
      { name: "Sergg59", tracks: 1, releases: 1, lastAcceptedAt: "2026-10-12T10:00:00.000Z" }
    ]);
  });

  it("поиск по треку, релизу, артисту и feat (ё = е)", () => {
    const [c, b0] = flattenCatalogTracks(CATALOG);
    expect(matchesCatalogTrack(c, "ежик")).toBe(true);
    expect(matchesCatalogTrack(b0, "один")).toBe(true);
    expect(matchesCatalogTrack(b0, "ep")).toBe(true);
    expect(matchesCatalogTrack(b0, "sergg")).toBe(false);
    expect(matchesCatalogTrack(b0, "  ")).toBe(true);
  });
});

describe("pitchedCatalogReleases", () => {
  it("только релизы с питчингом, свежие сверху", () => {
    const rows = [
      release({ id: "x" }),
      release({ id: "y", pitched_at: "2026-11-01T10:00:00.000Z" }),
      release({ id: "z", pitched_at: "2026-11-05T10:00:00.000Z" })
    ];
    expect(pitchedCatalogReleases(rows).map((r) => r.id)).toEqual(["z", "y"]);
  });
});

describe("splitPitching", () => {
  it("до выхода — ближайшие сверху, остальные — в «уже вышли»", () => {
    const rows = [
      release({ id: "past", release_date: "2026-11-01", pitched_at: "2026-10-20T10:00:00.000Z" }),
      release({ id: "far", release_date: "2026-12-01", pitched_at: "2026-11-02T10:00:00.000Z" }),
      release({ id: "soon", release_date: "2026-11-13", pitched_at: "2026-11-01T10:00:00.000Z" }),
      release({ id: "today", release_date: "2026-11-06", pitched_at: "2026-11-03T10:00:00.000Z" }),
      release({ id: "nodate", pitched_at: "2026-11-04T10:00:00.000Z" }),
      release({ id: "empty", release_date: "2026-11-20" })
    ];
    const { upcoming, released } = splitPitching(rows, "2026-11-06");
    expect(upcoming.map((r) => r.id)).toEqual(["today", "soon", "far"]);
    expect(released.map((r) => r.id)).toEqual(["nodate", "past"]);
  });
});
