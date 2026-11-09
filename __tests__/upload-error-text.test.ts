import { describe, expect, it } from "vitest";
import { userSubmitErrorText, userUploadErrorText } from "@/lib/upload-error-text";

describe("userUploadErrorText", () => {
  it("оставляет готовый русский текст как есть", () => {
    const msg = "Аудио слишком большое. Максимум 100 МБ.";
    expect(userUploadErrorText(new Error(msg), "storage")).toBe(msg);
  });

  it("обрыв сети превращает в понятный текст про интернет", () => {
    expect(userUploadErrorText(new TypeError("Failed to fetch"), "storage")).toMatch(/проверь интернет/);
    expect(userUploadErrorText(new Error("tus: failed to upload chunk at offset 0"), "storage")).toMatch(
      /проверь интернет/
    );
  });

  it("413 — файл слишком большой", () => {
    expect(userUploadErrorText({ statusCode: 413, message: "Payload too large" }, "storage")).toMatch(
      /слишком большой/
    );
  });

  it("отказ в доступе — просит открыть приложение заново", () => {
    expect(
      userUploadErrorText({ statusCode: 403, message: "new row violates row-level security policy" }, "storage")
    ).toMatch(/Нет доступа/);
  });

  it("не показывает технические слова, даже если текст русский", () => {
    const text = userUploadErrorText(
      new Error("Проверьте политику bucket «releases» и схему БД и RLS"),
      "database"
    );
    expect(text).not.toMatch(/bucket|RLS|БД/);
    expect(text).toMatch(/сохранить трек не получилось/);
  });

  it("всегда упоминает файл или загрузку — экран проверки по этим словам ведёт к трекам", () => {
    for (const err of [new Error("boom"), { statusCode: 500, message: "Internal" }, null]) {
      expect(userUploadErrorText(err, "storage")).toMatch(/файл|загруз/i);
    }
  });
});

describe("userSubmitErrorText", () => {
  it("оставляет готовый русский текст", () => {
    const msg = "Не удалось отправить релиз на модерацию. Попробуйте позже.";
    expect(userSubmitErrorText(new Error(msg))).toBe(msg);
  });

  it("не показывает сырой объект ошибки", () => {
    expect(userSubmitErrorText({ code: "PGRST116", message: "JSON object requested" })).toBe(
      "Не получилось отправить релиз. Попробуй ещё раз; если не поможет, напиши в поддержку."
    );
  });

  it("сеть", () => {
    expect(userSubmitErrorText(new TypeError("Load failed"))).toMatch(/проверь интернет/);
  });
});
