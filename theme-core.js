// Общая часть тем: палитры, обои, настройки по умолчанию и расчёт CSS-переменных.
// Подключается и в страницы FunPay, и в страницу настроек расширения.
const FPH_THEME = (() => {
  const PRESETS = {
    funpay:   { name: "Стандартная FunPay", off: true },
    light:    { name: "Светлая",  dark: false, page: "#f4f5f7", surface: "#ffffff", text: "#1f2328", muted: "#8a8f98", border: "#e3e5e8", accent: "#2f80ed" },
    dark:     { name: "Тёмная",   dark: true,  page: "#121316", surface: "#1b1d21", text: "#e6e7ea", muted: "#8b9099", border: "#2c2f35", accent: "#4c8dff" },
    graphite: { name: "Графит",   dark: true,  page: "#1a1b1e", surface: "#25262b", text: "#dcdde1", muted: "#8d9097", border: "#36383e", accent: "#8e9bb0" },
    north:    { name: "Север",    dark: true,  page: "#1a222d", surface: "#222d3b", text: "#dde6f0", muted: "#8899ad", border: "#33445a", accent: "#5aa9c7" },
    amethyst: { name: "Аметист",  dark: true,  page: "#17121f", surface: "#221a2e", text: "#ece6f5", muted: "#9d8fb3", border: "#3a2d4c", accent: "#9b6bff" },
    forest:   { name: "Лес",      dark: true,  page: "#111a15", surface: "#18241d", text: "#e0ece4", muted: "#86a091", border: "#28402f", accent: "#2fbf71" },
    ocean:    { name: "Океан",    dark: true,  page: "#0d1a1f", surface: "#12252c", text: "#dcedf2", muted: "#7fa3ae", border: "#1f3d48", accent: "#12a4b8" },
    cocoa:    { name: "Какао",    dark: true,  page: "#1d1714", surface: "#28201b", text: "#f0e6dd", muted: "#a8968a", border: "#40342b", accent: "#d99a3e" },
    sakura:   { name: "Сакура",   dark: true,  page: "#1e1519", surface: "#2a1d23", text: "#f5e6ec", muted: "#b0909e", border: "#46313b", accent: "#e86a9a" },
    paper:    { name: "Бумага",   dark: false, page: "#f1ebdf", surface: "#fbf8f1", text: "#2b2620", muted: "#8c8274", border: "#e0d6c3", accent: "#c0703a" },
    custom:   { name: "Своя" },
  };

  // Обои-градиенты: рисуются CSS, без внешних картинок.
  const GRADIENTS = {
    aurora: { name: "Северное сияние", css: "radial-gradient(ellipse at 20% 85%, #1fd1a5aa 0%, transparent 55%), radial-gradient(ellipse at 75% 25%, #6a5cffaa 0%, transparent 55%), linear-gradient(160deg, #04121f, #0b2a3a)" },
    sunset: { name: "Закат", css: "radial-gradient(circle at 50% 95%, #ffb35c 0%, transparent 35%), linear-gradient(175deg, #160c2e 0%, #4b1859 40%, #c53e5a 78%, #f08a4b 100%)" },
    neon:   { name: "Неон", css: "radial-gradient(circle at 25% 30%, #ff2bd699 0, transparent 40%), radial-gradient(circle at 78% 70%, #00e5ff88 0, transparent 45%), linear-gradient(135deg, #0a0618, #170b33)" },
    space:  { name: "Глубина", css: "radial-gradient(circle at 80% 10%, #3b4cca66 0, transparent 40%), linear-gradient(180deg, #020617, #0f172a 60%, #1e293b)" },
    woods:  { name: "Ночной лес", css: "radial-gradient(ellipse at 50% 110%, #2c7a4baa 0, transparent 60%), linear-gradient(180deg, #08110c, #12241a)" },
    sakura: { name: "Сакура", css: "radial-gradient(circle at 15% 20%, #ff9cc2aa 0, transparent 40%), radial-gradient(circle at 85% 80%, #b35cffaa 0, transparent 45%), linear-gradient(150deg, #2a1020, #3a1636)" },
    mist:   { name: "Туман", css: "radial-gradient(circle at 70% 20%, #ffffff 0, transparent 50%), linear-gradient(160deg, #cfd9df, #e2ebf0)" },
  };

  // Живые эффекты поверх фона (рисуются на canvas).
  const EFFECTS = {
    none: { name: "Без эффекта", ico: "∅" },
    sakura: { name: "Лепестки сакуры", ico: "🌸" },
    snow: { name: "Снег", ico: "❄" },
    fireflies: { name: "Светлячки", ico: "✨" },
    stars: { name: "Звёзды", ico: "🌠" },
    rain: { name: "Дождь", ico: "🌧" },
    embers: { name: "Искры", ico: "🔥" },
  };

  // Наборы тем: палитра + картинка из галереи Wallhaven по запросу + живой эффект.
  // Картинка выбирается случайно из топа по запросу, повторный клик — другая картинка.
  const SETS = {
    sakura:  { name: "Сакура",          preset: "sakura",   q: "sakura",              cat: "010", effect: "sakura",    css: "linear-gradient(150deg,#3a1636,#e86a9a)" },
    neon:    { name: "Неоновый город",  preset: "amethyst", q: "neon city",           cat: "010", effect: "rain",      css: "linear-gradient(150deg,#0a0618,#ff2bd6 60%,#00e5ff)" },
    night:   { name: "Ночной лес",      preset: "forest",   q: "forest night",        cat: "010", effect: "fireflies", css: "linear-gradient(170deg,#08110c,#2c7a4b)" },
    winter:  { name: "Зимняя сказка",   preset: "north",    q: "winter snow",         cat: "010", effect: "snow",      css: "linear-gradient(170deg,#1a222d,#9fc3e6)" },
    sky:     { name: "Звёздное небо",   preset: "ocean",    q: "starry sky",          cat: "010", effect: "stars",     css: "linear-gradient(170deg,#020617,#3b4cca)" },
    sunset:  { name: "Закат",           preset: "cocoa",    q: "sunset",              cat: "010", effect: "embers",    css: "linear-gradient(175deg,#4b1859,#f08a4b)" },
    space:   { name: "Горизонт событий", preset: "graphite", q: "black hole",         cat: "100", effect: "stars",     css: "radial-gradient(circle at 50% 60%,#f6a04d 0,#3b1d0a 25%,#000 55%)" },
    land:    { name: "Пейзажи",         preset: "dark",     q: "landscape",           cat: "010", effect: "none",      css: "linear-gradient(170deg,#1e293b,#5b8bb0)" },
  };

  // Быстрые запросы для галереи Wallhaven.
  const GALLERY = [
    { name: "Аниме", q: "", cat: "010" },
    { name: "Аниме-пейзажи", q: "landscape", cat: "010" },
    { name: "Сакура", q: "sakura", cat: "010" },
    { name: "Ночь", q: "night", cat: "010" },
    { name: "Неон", q: "neon", cat: "110" },
    { name: "Природа", q: "nature", cat: "100" },
    { name: "Космос", q: "space", cat: "100" },
    { name: "Игры", q: "video games", cat: "100" },
    { name: "Минимализм", q: "minimalism", cat: "100" },
  ];

  const DEFAULTS = {
    theme: {
      preset: "dark",
      custom: { dark: true, page: "#14161a", surface: "#1e2126", text: "#e6e7ea", muted: "#8b9099", border: "#2e3238", accent: "#ff7a59" },
      // none | gradient | url | upload (файл или картинка из галереи хранится в IndexedDB сайта)
      wallpaper: { type: "none", gradient: "aurora", url: "", name: "", source: "", thumb: "" },
      set: "",
      effect: { type: "none", intensity: 50 },
      parallax: false,
      dim: 35,
      glass: true,
      density: 72,
      blur: 14,
    },
    custom: { fontScale: 100, font: "nunito", customFont: { mode: "name", name: "", google: true, fileName: "", fileId: "" }, textScale: 106, linkAccent: false, withdrawFee: 0, hideProfileCover: true, hideCd: true, logoMode: "custom", footerJoke: true, compact: false, hideChatPromo: false, css: "" },
    features: {
      notes: true, bulk: true, salesStats: true,
      highlightOwn: true, realPrice: true, sectionCommission: true, exactPrice: true, cost: true, clone: true, profilePanel: true,
      copyOrderId: true, purchaseStats: false, chatInfo: true, lotSales: true,
      withdrawInfo: true, hideBalance: false, financeStats: true, financeExport: true,
    },
  };

  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  function merge(def, val) {
    if (!isObj(def)) return val === undefined ? def : val;
    const out = {};
    for (const k of Object.keys(def)) out[k] = merge(def[k], isObj(val) ? val[k] : undefined);
    if (isObj(val)) for (const k of Object.keys(val)) if (!(k in out)) out[k] = val[k];
    return out;
  }

  function rgb(hex) {
    let h = String(hex || "").replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h.slice(0, 6), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
  const css = (c, alpha = 1) => (alpha >= 1 ? `rgb(${c.join(" ")})` : `rgb(${c.join(" ")} / ${alpha})`);

  function palette(s) {
    const p = s.theme.preset === "custom" ? { ...s.theme.custom } : PRESETS[s.theme.preset] || PRESETS.dark;
    return p;
  }

  function hasWallpaper(s) {
    const w = s.theme.wallpaper;
    return w.type === "gradient" || (w.type === "url" && !!w.url) || w.type === "upload";
  }

  // CSS-переменные, которыми пользуется перекраска FunPay и наши панели.
  function vars(s) {
    const p = palette(s);
    if (p.off) return null;
    const dark = !!p.dark;
    const page = rgb(p.page), surface = rgb(p.surface), text = rgb(p.text), muted = rgb(p.muted), border = rgb(p.border), accent = rgb(p.accent);
    const wall = hasWallpaper(s);
    const glass = wall && s.theme.glass;
    const alpha = glass ? Math.max(0.15, Math.min(1, s.theme.density / 100)) : 1;
    return {
      dark,
      text: {
        "--fph-page": wall ? "transparent" : css(page),
        "--fph-page-solid": css(page),
        "--fph-surface": css(surface, alpha),
        "--fph-surface-solid": css(surface),
        // Плотное стекло для таблиц лотов и заказов: строки не должны сливаться с обоями.
        "--fph-surface-strong": css(surface, glass ? Math.max(alpha, 0.78) : 1),
        "--fph-band": wall ? "transparent" : css(surface),
        "--fph-surface-2": glass ? css(text, dark ? 0.06 : 0.05) : css(mix(surface, text, dark ? 0.06 : 0.04)),
        "--fph-surface-3": glass ? css(text, dark ? 0.11 : 0.09) : css(mix(surface, text, dark ? 0.11 : 0.09)),
        // Поля ввода — чуть светлее блоков (а не темнее), как остальные элементы.
        "--fph-input": glass ? css(text, dark ? 0.08 : 0.05) : css(mix(surface, text, dark ? 0.07 : 0.03)),
        "--fph-text": css(text),
        "--fph-text-2": css(mix(text, surface, 0.22)),
        "--fph-muted": css(muted),
        "--fph-border": glass ? css(text, dark ? 0.12 : 0.14) : css(border),
        "--fph-border-strong": css(mix(border, text, 0.25)),
        "--fph-accent": css(accent),
        "--fph-accent-dark": css(mix(accent, [0, 0, 0], 0.2)),
        // Ссылки по умолчанию цветом текста (у FunPay синие почти все надписи), акцентом — при наведении.
        "--fph-link": s.custom.linkAccent ? css(dark ? mix(accent, [255, 255, 255], 0.2) : accent) : css(text),
        "--fph-link-hover": css(dark ? mix(accent, [255, 255, 255], 0.25) : accent),
        // Ссылки внутри текста (сообщения, описания, уведомления) — всегда цветные, чтобы было видно, что кликабельно.
        "--fph-link-content": css(dark ? mix(accent, [255, 255, 255], 0.2) : accent),
        "--fph-tint": dark ? "16%" : "100%",
        "--fph-backdrop": glass ? `blur(${s.theme.blur}px) saturate(1.2)` : "none",
        "--fph-dim": String(s.theme.dim / 100),
        "--fph-radius": "10px",
      },
    };
  }

  function varsCss(s, selector = ":root") {
    const v = vars(s);
    if (!v) return "";
    return `${selector}{${Object.entries(v.text).map(([k, val]) => `${k}:${val}`).join(";")};color-scheme:${v.dark ? "dark" : "light"}}`;
  }

  function wallpaperCss(s) {
    const w = s.theme.wallpaper;
    if (w.type === "gradient") return (GRADIENTS[w.gradient] || GRADIENTS.aurora).css;
    if (w.type === "url" && w.url) return `url("${w.url.replace(/"/g, "%22")}") center / cover no-repeat`;
    return null;
  }

  const isVideoUrl = (u) => /\.(mp4|webm)(\?|#|$)/i.test(u || "");

  // Шрифты лежат в папке fonts (OFL, с кириллицей).
  const FONTS = {
    system: { name: "Как на FunPay", family: "" },
    nunito: { name: "Nunito", family: "FPH Nunito" },
    manrope: { name: "Manrope", family: "FPH Manrope" },
    rubik: { name: "Rubik", family: "FPH Rubik" },
    montserrat: { name: "Montserrat", family: "FPH Montserrat" },
    inter: { name: "Inter", family: "FPH Inter" },
    custom: { name: "Свой шрифт", family: "", custom: true },
  };
  const CYR = "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116";
  const LAT = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
  function fontFaces(urlOf) {
    return Object.entries(FONTS).filter(([, f]) => f.family).map(([id, f]) =>
      `@font-face{font-family:"${f.family}";src:url("${urlOf(`fonts/${id}-cyrillic.woff2`)}") format("woff2");font-weight:100 900;font-display:swap;unicode-range:${CYR}}` +
      `@font-face{font-family:"${f.family}";src:url("${urlOf(`fonts/${id}-latin.woff2`)}") format("woff2");font-weight:100 900;font-display:swap;unicode-range:${LAT}}`).join("");
  }

  return { PRESETS, GRADIENTS, EFFECTS, SETS, GALLERY, FONTS, fontFaces, DEFAULTS, merge, palette, vars, varsCss, wallpaperCss, hasWallpaper, isVideoUrl };
})();

// Файл обоев (картинка или видео) — в IndexedDB сайта funpay.com: без base64 и без лимитов chrome.storage.
const FPH_WALL = (() => {
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open("fph-helper", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction("files", mode);
      const req = fn(t.objectStore("files"));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    get: (key = "wallpaper") => tx("readonly", (s) => s.get(key)).catch(() => null),
    put: (rec, key = "wallpaper") => tx("readwrite", (s) => s.put(rec, key)),
    clear: () => tx("readwrite", (s) => s.delete("wallpaper")),
  };
})();
