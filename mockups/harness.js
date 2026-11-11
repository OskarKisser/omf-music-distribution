/*
 * Стенд для мокапов Telegram-карточек (Bot API 10.4 widgets).
 * Код карточки лежит в <template id="widget"> — ровно тот же, что уйдёт в sendWidget.
 * Здесь: рамка телефона, поддельный window.TelegramWidget, проверка пределов.
 *
 * Мокап задаёт window.MOCK = {
 *   title, caption(scn) -> string, scenarios: {key: label}, chatData(scn) -> string,
 *   answer(data, scn) -> string   // как ответит бот на W.request(data)
 * }
 */
(function () {
  const LIM = { height: 600, minHeight: 50, state: 1024, req: 64, answer: 1024, zlib: 4070, html: 32768 };
  const THEMES = {
    light: {
      bg_color: "#ffffff", text_color: "#000000", hint_color: "#8e8e93", link_color: "#007aff",
      button_color: "#007aff", button_text_color: "#ffffff", secondary_bg_color: "#efeff4",
      accent_text_color: "#007aff", subtitle_text_color: "#8e8e93", destructive_text_color: "#ff3b30",
      section_bg_color: "#ffffff", section_separator_color: "#c8c7cc", header_bg_color: "#f8f8f8"
    },
    dark: {
      bg_color: "#212121", text_color: "#ffffff", hint_color: "#aaaaaa", link_color: "#8774e1",
      button_color: "#8774e1", button_text_color: "#ffffff", secondary_bg_color: "#181818",
      accent_text_color: "#8774e1", subtitle_text_color: "#aaaaaa", destructive_text_color: "#ff595a",
      section_bg_color: "#212121", section_separator_color: "#3d3d3d", header_bg_color: "#2c2c2c"
    }
  };
  const enc = new TextEncoder();
  const bytes = (s) => enc.encode(String(s ?? "")).length;
  const $ = (id) => document.getElementById(id);

  let theme = "light", scn = null, caption = true, frame = null, W = null, lastReq = 0, lastAns = 0;
  const reqTimes = [];

  /** Та же минификация, что в боте: убрать отступы и пустые строки, переводы строк оставить. */
  function minify(html) {
    return html.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  }
  async function zlibSize(text) {
    // Браузерный deflate (уровень по умолчанию) — оценка сверху; точный zlib-9 считает тест в боте.
    const cs = new CompressionStream("deflate");
    const buf = await new Response(new Blob([text]).stream().pipeThrough(cs)).arrayBuffer();
    return buf.byteLength;
  }

  function log(kind, text) {
    const li = document.createElement("li");
    li.innerHTML = `<b>${kind}</b> ${String(text).replace(/</g, "&lt;")}`;
    $("log").prepend(li);
    while ($("log").children.length > 30) $("log").lastChild.remove();
  }

  function setMetric(id, value, limit, unit = "Б") {
    const el = $(id);
    const bad = value > limit;
    el.textContent = `${value} / ${limit} ${unit}`;
    el.parentElement.classList.toggle("bad", bad);
    return bad;
  }

  function warn() {
    const bad = [...document.querySelectorAll(".metrics .bad")].map((e) => e.dataset.name);
    $("warn").hidden = bad.length === 0;
    $("warn").textContent = bad.length ? "Превышено: " + bad.join(", ") : "";
  }

  function makeW(win) {
    const handlers = {};
    let busy = false;
    const tp = THEMES[theme];
    const fire = (t) => (handlers[t] || []).forEach((h) => h.call(api));
    const api = {
      profile: 1, colorScheme: theme, themeParams: tp, isActive: true, isPreview: false, isForward: false,
      chatType: "private", viewer: { id: 1001, first_name: "Андрей" },
      publicData: null, chatData: MOCK.chatData(scn),
      contentSafeAreaInset: { top: 0, right: 0, bottom: caption ? 0 : 22, left: 0, cornerRight: 0, cornerLeft: 0 },
      wallet: null,
      HapticFeedback: {
        impactOccurred(s) { log("haptic", "impact " + s); return this; },
        notificationOccurred(t) { log("haptic", "notification " + t); return this; },
        selectionChanged() { log("haptic", "selection"); return this; }
      },
      isProfileAtLeast: (n) => typeof n === "number" && 1 >= n,
      ready() { log("ready", "карточка нарисована"); },
      setResizeAnchor() {},
      watchPublicData() {}, unwatchPublicData() {},
      copyText(t) { log("copy", t); },
      openLink(u) {
        if (!/^https:\/\//.test(u) || u.length > 256 || /^https:\/\/(t\.me|telegram\.(me|dog))\//.test(u)) throw new TypeError("openLink: " + u);
        log("openLink", u);
      },
      openTelegramLink(u) {
        if (!/^https:\/\/t\.me\//.test(u) || u.length > 256) throw new TypeError("openTelegramLink: " + u);
        log("openTelegramLink", u);
      },
      onEvent(t, h) { (handlers[t] = handlers[t] || []).push(h); },
      offEvent(t, h) { handlers[t] = (handlers[t] || []).filter((x) => x !== h); },
      request(data) {
        const err = (code) => Object.assign(new Error(code), { name: "WidgetRequestError", code });
        const n = bytes(data);
        lastReq = n;
        setMetric("m-req", n, LIM.req);
        warn();
        if (n < 1 || n > LIM.req) throw new TypeError("request: 1–64 байт, а тут " + n);
        const now = Date.now();
        while (reqTimes.length && now - reqTimes[0] > 5000) reqTimes.shift();
        if (busy) { log("request", data + " → BUSY"); return Promise.reject(err("BUSY")); }
        if (reqTimes.length >= 5) { log("request", data + " → RATE_LIMITED"); return Promise.reject(err("RATE_LIMITED")); }
        reqTimes.push(now);
        busy = true;
        log("request", data);
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            busy = false;
            const result = MOCK.answer(data, scn);
            lastAns = bytes(result);
            setMetric("m-ans", lastAns, LIM.answer);
            warn();
            if (!result || lastAns > LIM.answer) { log("answer", "INVALID_ANSWER"); return reject(err("INVALID_ANSWER")); }
            log("answer", result.length > 160 ? result.slice(0, 160) + "…" : result);
            resolve({ result });
          }, 350);
        });
      },
      /** Только для стенда: бот правит chat_data (editMessageWidgetData). */
      _push(data) { api.chatData = data; fire("chatDataChanged"); }
    };
    return api;
  }

  function cssVars() {
    const tp = THEMES[theme];
    const v = Object.entries(tp).map(([k, c]) => `--tg-theme-${k.replace(/_/g, "-")}:${c}!important`);
    v.push(`--tg-color-scheme:${theme}!important`, "--tg-text-font-size:15px", "--tg-text-line-height:1.35",
      `--tg-content-safe-area-inset-bottom:${caption ? 0 : 22}px`);
    return `:root{${v.join(";")}}`;
  }

  function render() {
    const src = $("widget").innerHTML;
    const host = $("bubble-body");
    host.innerHTML = "";
    frame = document.createElement("iframe");
    frame.setAttribute("title", "карточка");
    host.appendChild(frame);
    const doc = `<!doctype html><html><head><style>${cssVars()}
html{background:none}body{margin:8px 12px;font:var(--tg-text-font-size)/var(--tg-text-line-height) system-ui,sans-serif;color:var(--tg-theme-text-color)}
</style><script>
window.fetch=()=>{throw new Error("NetworkDisabledError")};window.XMLHttpRequest=function(){throw new Error("NetworkDisabledError")};
window.TelegramWidget=parent.__makeW(window);
<\/script></head><body>${src}</body></html>`;
    frame.srcdoc = doc;
    frame.onload = () => {
      const d = frame.contentDocument;
      const measure = () => {
        const h = Math.ceil(d.documentElement.getBoundingClientRect().height);
        frame.style.height = Math.min(Math.max(h, LIM.minHeight), LIM.height) + "px";
        setMetric("m-h", h, LIM.height, "px");
        warn();
      };
      new ResizeObserver(measure).observe(d.documentElement);
      measure();
    };
    W = null;
    const st = MOCK.chatData(scn);
    setMetric("m-state", bytes(st), LIM.state);
    $("caption").textContent = MOCK.caption(scn);
    $("caption").hidden = !caption;
    $("time").classList.toggle("over", !caption);
    $("bubble").dataset.theme = theme;
    document.body.dataset.theme = theme;
    warn();
  }

  window.__makeW = (win) => (W = makeW(win));

  async function sizes() {
    const src = $("widget").innerHTML;
    const min = minify(src);
    setMetric("m-html", bytes(min), LIM.html);
    setMetric("m-zlib", await zlibSize(min), LIM.zlib);
    const banned = [/\bfetch\s*\(/, /XMLHttpRequest/, /\d+vh\b/, /overflow\s*:\s*(auto|scroll)/, /<input/i, /\bsrc\s*=\s*["']?https?:/i];
    const hits = banned.filter((re) => re.test(src)).map(String);
    $("m-ban").textContent = hits.length ? hits.join(" ") : "нет";
    $("m-ban").parentElement.classList.toggle("bad", hits.length > 0);
    const reqs = [...src.matchAll(/W\.request\((["'`])(.)/g)].map((m) => m[2]);
    const wrong = reqs.filter((p) => p !== MOCK.prefix);
    $("m-pref").textContent = wrong.length ? "чужие: " + wrong.join(",") : `все «${MOCK.prefix}»`;
    $("m-pref").parentElement.classList.toggle("bad", wrong.length > 0);
    warn();
  }

  function init() {
    document.title = MOCK.title;
    $("title").textContent = MOCK.title;
    const sel = $("scn");
    for (const [k, label] of Object.entries(MOCK.scenarios)) sel.add(new Option(label, k));
    scn = sel.value;
    sel.onchange = () => { scn = sel.value; render(); };
    $("theme").onclick = () => { theme = theme === "light" ? "dark" : "light"; $("theme").textContent = theme === "light" ? "Тёмная тема" : "Светлая тема"; render(); };
    $("cap").onchange = (e) => { caption = e.target.checked; render(); };
    $("push").onclick = () => {
      if (!W) return;
      const next = MOCK.nextChatData ? MOCK.nextChatData(scn) : MOCK.chatData(scn);
      setMetric("m-state", bytes(next), LIM.state);
      warn();
      log("edit", "editMessageWidgetData " + bytes(next) + " Б");
      W._push(next);
    };
    const q = new URLSearchParams(location.search);
    if (q.get("theme") === "dark") { theme = "dark"; $("theme").textContent = "Светлая тема"; }
    if (q.get("scn") && MOCK.scenarios[q.get("scn")]) { scn = q.get("scn"); sel.value = scn; }
    render();
    sizes();
  }

  window.__harness = { bytes, minify };
  document.addEventListener("DOMContentLoaded", init);
})();

/** Обрезать список до лимита состояния: та же логика, что fit_rows на сервере. */
function fitRows(build, rows, limit = 1024) {
  const enc = new TextEncoder();
  let n = rows.length;
  while (n > 0 && enc.encode(build(rows.slice(0, n))).length > limit) n--;
  return n;
}
