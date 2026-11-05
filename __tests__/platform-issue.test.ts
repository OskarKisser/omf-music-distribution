import { describe, expect, it } from "vitest";
import {
  formatPlatforms,
  platformIssueBody,
  platformIssueCardLine,
  platformIssueMessage,
  platformIssueResolvedMessage,
  readPlatformIssue
} from "@/lib/platform-issue";
import { getReleaseNextStep } from "@/lib/release-next-step";

const AT = "2026-11-05T10:00:00Z";

describe("readPlatformIssue", () => {
  it("returns null without a mark date", () => {
    expect(readPlatformIssue({ platform_issue_platforms: ["apple_music"] })).toBeNull();
    expect(readPlatformIssue(null)).toBeNull();
  });

  it("keeps known keys in list order and drops unknown ones", () => {
    const issue = readPlatformIssue({
      platform_issue_at: AT,
      platform_issue_platforms: ["itunes", "zzz", "apple_music"],
      platform_issue_reasons: ["artwork", "nope"],
      platform_issue_note: "  "
    });
    expect(issue).toEqual({ platforms: ["apple_music", "itunes"], reasons: ["artwork"], note: null, at: AT });
  });

  it("falls back to 'other' when no platform is known", () => {
    expect(readPlatformIssue({ platform_issue_at: AT, platform_issue_platforms: [] })?.platforms).toEqual(["other"]);
  });
});

describe("texts", () => {
  it("joins platform names in Russian", () => {
    expect(formatPlatforms(["apple_music", "itunes"])).toBe("Apple Music и iTunes");
    expect(formatPlatforms(["spotify", "vk", "other"])).toBe("Spotify, VK Музыка и другие площадки");
    expect(formatPlatforms(["other"])).toBe("Одна из площадок");
  });

  it("names a single store on the library row, Apple Music and iTunes count as one", () => {
    const issue = readPlatformIssue({ platform_issue_at: AT, platform_issue_platforms: ["apple_music", "itunes"] })!;
    expect(platformIssueCardLine(issue)).toBe("Обновляем в Apple Music");
    const many = readPlatformIssue({ platform_issue_at: AT, platform_issue_platforms: ["apple_music", "spotify"] })!;
    expect(platformIssueCardLine(many)).toBe("Обновляем на площадках");
  });

  it("explains the artwork case to the artist and in the bot", () => {
    const issue = readPlatformIssue({
      platform_issue_at: AT,
      platform_issue_platforms: ["apple_music", "itunes"],
      platform_issue_reasons: ["artwork"]
    })!;
    expect(platformIssueBody(issue, true)).toBe(
      "Apple Music и iTunes временно сняли релиз из-за обложки. Новая обложка уже на проверке — обычно 3–5 дней. Напишем в бот, когда вернётся."
    );
    const msg = platformIssueMessage("Ночной <рейс>", issue);
    expect(msg).toContain("«Ночной &lt;рейс&gt;»: обновляем на площадках.");
    expect(msg).toContain("Новую обложку уже отправили");
    expect(msg).toContain("На остальных площадках всё на месте.");
    expect(platformIssueResolvedMessage("Ночной рейс")).toContain("снова на всех площадках");
  });

  it("speaks of fixes when there are several reasons", () => {
    const issue = readPlatformIssue({
      platform_issue_at: AT,
      platform_issue_platforms: ["spotify"],
      platform_issue_reasons: ["artwork", "title"]
    })!;
    expect(platformIssueBody(issue, false)).toBe(
      "Spotify временно сняли релиз из-за обложки и названия. Исправления уже на проверке — обычно 3–5 дней. Статус обновится здесь, когда вернётся."
    );
  });
});

describe("getReleaseNextStep with a platform issue", () => {
  const issue = readPlatformIssue({ platform_issue_at: AT, platform_issue_platforms: ["apple_music"] });

  it("replaces 'link ready' for a released release", () => {
    const step = getReleaseNextStep({ status: "ready", smartLink: "https://omf.link/x", platformIssue: issue });
    expect(step.kind).toBe("updating");
    expect(step.cardLine).toBe("Обновляем в Apple Music");
    expect(step.title).toBe("Обновляем на площадках");
  });

  it("does not touch other statuses", () => {
    expect(getReleaseNextStep({ status: "removed", platformIssue: issue }).kind).toBe("removed");
    expect(getReleaseNextStep({ status: "ready", smartLink: "https://x" }).kind).toBe("approved_link");
  });
});
