#!/usr/bin/env node
/**
 * Код карточек живёт в мокапах (mockups/<name>-widget.html, <template id="widget">).
 * Скрипт вырезает его, минифицирует и пишет lib/widgets/html.generated.ts — бот шлёт ровно этот текст.
 *
 *   node scripts/build-widgets.mjs
 *
 * Тест __tests__/widgets-html.test.ts проверяет, что сгенерированный файл совпадает с мокапами.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const WIDGETS = { releases: "mockups/releases-widget.html", today: "mockups/today-widget.html" };

/** Убрать отступы и пустые строки; переводы строк оставить — в JS они разделяют операторы. */
export function minifyWidget(html) {
  return html
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

export function extractWidget(file) {
  const src = readFileSync(path.join(root, file), "utf8");
  const m = /<template id="widget">([\s\S]*?)<\/template>/.exec(src);
  if (!m) throw new Error(`${file}: нет <template id="widget">`);
  return minifyWidget(m[1]);
}

export function renderGenerated() {
  const lines = [
    "// Сгенерировано scripts/build-widgets.mjs из mockups/*-widget.html — не править руками.",
    "// %APP% бот заменяет на адрес мини-приложения при отправке.",
    ""
  ];
  for (const [name, file] of Object.entries(WIDGETS)) {
    lines.push(`export const ${name.toUpperCase()}_WIDGET_HTML = ${JSON.stringify(extractWidget(file))};`, "");
  }
  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  writeFileSync(path.join(root, "lib/widgets/html.generated.ts"), renderGenerated());
  console.log("lib/widgets/html.generated.ts обновлён");
}
