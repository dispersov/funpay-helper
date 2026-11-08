// Тема для страниц FunPay. Запускается до отрисовки страницы.
// Перекраска: проходим по CSS самого FunPay и подменяем цвета на переменные темы
// (белый фон → поверхность, серый текст → приглушённый и т.д.). Готовый CSS кэшируется в localStorage.
(() => {
  // Если Chrome ещё держит старый список скриптов (расширение не перезагружено) — тихо выходим.
  if (typeof FPH_THEME === "undefined") return;
  const T = FPH_THEME;
  const ENGINE = "5";
  const root = document.documentElement;
  const CACHE_KEY = "fph-remap-" + ENGINE;
  const BOOT_KEY = "fph-settings-boot";
  let settings = T.merge(T.DEFAULTS, {});
  let remapCss = "";
  try { remapCss = localStorage.getItem(CACHE_KEY) || ""; } catch (e) {}

  const style = (id) => {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      (document.head || root).appendChild(el);
    }
    return el;
  };

  // ---------- Разбор цветов ----------
  function parseColor(v) {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(String(v).trim());
    if (!m) return null;
    const [r, g, b] = [+m[1], +m[2], +m[3]];
    const a = m[4] === undefined ? 1 : +m[4];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 510;
    const chroma = (max - min) / 255;
    let h = 0;
    if (chroma) {
      if (max === r) h = ((g - b) / (max - min)) % 6;
      else if (max === g) h = (b - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
      h = (h * 60 + 360) % 360;
    }
    return { r, g, b, a, l, chroma, h, gray: chroma < 0.1 };
  }
  const isAccent = (c) => c.chroma > 0.3 && c.h >= 195 && c.h <= 225;

  function mapBg(c, sel) {
    if (c.a < 0.9) return null;
    if (c.gray) {
      if (c.l >= 0.96) {
        if (/(^|[\s>,+~(])(html|body)(?![-\w])/.test(sel)) return { v: "var(--fph-page)" };
        if (/form-control|input|select|textarea/.test(sel)) return { v: "var(--fph-input)" };
        if (/dropdown|modal|popover|tooltip|autocomplete|menu/.test(sel)) return { v: "var(--fph-surface-solid)" };
        // Кнопки — без своего стекла: размытие внутри размытия не работает и портит блок вокруг.
        if (/\bbtn\b|button|label|switch|badge/.test(sel)) return { v: "var(--fph-surface-3)" };
        // Фоновые полосы во всю ширину страницы: при обоях прозрачные, иначе размывают всю картинку.
        if (/bg-light/.test(sel)) return { v: "var(--fph-band)" };
        return { v: "var(--fph-surface)", glass: true };
      }
      if (c.l >= 0.88) return { v: "var(--fph-surface-2)" };
      if (c.l >= 0.75) return { v: "var(--fph-surface-3)" };
      if (c.l <= 0.22) return { v: "var(--fph-accent)" }; // тёмные «активные» плашки
      return null;
    }
    if (isAccent(c)) {
      if (c.l > 0.8) return { v: `color-mix(in srgb, rgb(${c.r} ${c.g} ${c.b}) var(--fph-tint), var(--fph-surface-solid))` };
      return { v: c.l < 0.45 ? "var(--fph-accent-dark)" : "var(--fph-accent)" };
    }
    if (c.l > 0.8) return { v: `color-mix(in srgb, rgb(${c.r} ${c.g} ${c.b}) var(--fph-tint), var(--fph-surface-solid))` };
    return null;
  }

  function mapText(c) {
    if (c.a < 0.5) return null;
    if (isAccent(c)) return "var(--fph-link)";
    if (!c.gray) return null;
    if (c.l < 0.35) return "var(--fph-text)";
    if (c.l < 0.6) return "var(--fph-text-2)";
    if (c.l < 0.82) return "var(--fph-muted)";
    return null;
  }

  function mapBorder(c) {
    if (c.a < 0.5) return null;
    if (isAccent(c)) return "var(--fph-accent)";
    if (!c.gray) return null;
    if (c.l >= 0.7) return "var(--fph-border)";
    if (c.l >= 0.5) return "var(--fph-border-strong)";
    return null;
  }

  // Наши правила должны перебивать CSS FunPay, который подключается позже нас:
  // добавляем к каждому селектору html.fph-on — так выше специфичность.
  function splitSelectors(sel) {
    const parts = [];
    let depth = 0, cur = "";
    for (const ch of sel) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  }
  function scope(sel) {
    return splitSelectors(sel).map((s) => {
      if (/^(html|:root)(?![-\w])/.test(s)) return s.replace(/^(html|:root)/, "html.fph-on");
      return "html.fph-on " + s;
    }).join(",");
  }

  const BORDERS = ["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"];

  function buildRemap() {
    const out = [];
    const visit = (rules) => {
      for (const r of rules) {
        if (r.cssRules && !r.style) {
          if (r.media) {
            const save = out.length, saveFs = fontRules.length;
            visit(r.cssRules);
            const inner = out.splice(save), innerFs = fontRules.splice(saveFs);
            if (inner.length) out.push(`@media ${r.media.mediaText}{${inner.join("")}}`);
            if (innerFs.length) fontRules.push(`@media ${r.media.mediaText}{${innerFs.join("")}}`);
          }
          continue;
        }
        if (!r.style || !r.selectorText) continue;
        const sel = r.selectorText;
        const decl = [];
        const imp = (p) => (r.style.getPropertyPriority(p) ? " !important" : "");
        const bg = parseColor(r.style.getPropertyValue("background-color"));
        if (bg) {
          const m = mapBg(bg, sel);
          if (m) {
            decl.push(`background-color:${m.v}${imp("background-color")}`);
            if (m.glass) decl.push("-webkit-backdrop-filter:var(--fph-backdrop);backdrop-filter:var(--fph-backdrop)");
          }
        }
        const col = parseColor(r.style.getPropertyValue("color"));
        if (col) {
          const m = mapText(col);
          if (m) decl.push(`color:${m}${imp("color")}`);
        }
        for (const p of BORDERS) {
          const c = parseColor(r.style.getPropertyValue(p));
          const m = c && mapBorder(c);
          if (m) decl.push(`${p}:${m}${imp(p)}`);
        }
        if (decl.length) out.push(`${scope(sel)}{${decl.join(";")}}`);
        // Размер текста: все размеры шрифта FunPay в px умножаем на коэффициент из настроек.
        const fs = /^([\d.]+)px$/.exec(r.style.getPropertyValue("font-size").trim());
        if (fs) fontRules.push(`${scopeFs(sel)}{font-size:calc(${fs[1]}px * var(--fph-text-scale))${imp("font-size")}}`);
      }
    };
    const fontRules = [];
    for (const sheet of document.styleSheets) {
      const node = sheet.ownerNode;
      if (node && node.id && node.id.startsWith("fph-")) continue;
      if (sheet.href && !sheet.href.startsWith(location.origin)) continue;
      try { visit(sheet.cssRules); } catch (e) { /* чужой домен — пропускаем */ }
    }
    return out.join("\n") + "\n/*fph-fonts*/\n" + fontRules.join("\n");
  }
  // С выключенной темой оставляем только правила размера текста.
  function remapFor(themeOn) {
    if (themeOn) return remapCss;
    const i = remapCss.indexOf("/*fph-fonts*/");
    return i >= 0 ? remapCss.slice(i) : "";
  }
  function scopeFs(sel) {
    return splitSelectors(sel).map((s) => (/^(html|:root)(?![-\w])/.test(s) ? s.replace(/^(html|:root)/, "html.fph-fs") : "html.fph-fs " + s)).join(",");
  }

  // Стили, которые не зависят от CSS FunPay.
  const BASE = `
    html.fph-on { background: var(--fph-page-solid) !important; color: var(--fph-text); }
    html.fph-on.fph-wall { background: #000 !important; }
    html.fph-on body { background-color: var(--fph-page) !important; color: var(--fph-text); }
    html.fph-on input, html.fph-on select, html.fph-on textarea { color: var(--fph-text); }
    html.fph-on .form-control, html.fph-on input:not([type=checkbox]):not([type=radio]):not([type=range]), html.fph-on select, html.fph-on textarea {
      background-color: var(--fph-input) !important; border-color: var(--fph-border) !important; color: var(--fph-text) !important; }
    html.fph-on ::placeholder { color: var(--fph-muted) !important; }
    /* Выпадающие списки: варианты на фоне темы, а не белым с светлым текстом */
    html.fph-on option, html.fph-on optgroup { background-color: var(--fph-surface-solid) !important; color: var(--fph-text) !important; }
    html.fph-on option:checked { background-color: var(--fph-accent) !important; color: #fff !important; }
    html.fph-on hr { border-color: var(--fph-border) !important; }
    html.fph-on .navbar, html.fph-on .navbar-default { -webkit-backdrop-filter: var(--fph-backdrop); backdrop-filter: var(--fph-backdrop); }
    /* Ссылки: в тексте — цветные (видно, что кликабельно), в меню и списках — цветом текста */
    html.fph-on a:not(.btn):not(.tc-item):not(.contact-item):not(.counter-item) { color: var(--fph-link-content); }
    html.fph-on :is(.navbar, .promo-games, .promo-game-list, footer, #footer, .breadcrumb, .counter-list, .offer-list-title, h1, h2, h3, h4, .media-user-name, .chat-header, .user-link, .dropdown-menu) a:not(.btn) { color: var(--fph-link); }
    html.fph-on a:not(.btn):not(.tc-item):not(.contact-item):not(.counter-item):hover { color: var(--fph-link-hover); }
    html.fph-on a:hover, html.fph-on a:focus { text-decoration: none !important; }
    /* Шапка: без серой плашки при наведении, только цвет */
    html.fph-on .navbar-nav > li > a:hover, html.fph-on .navbar-nav > li > a:focus,
    html.fph-on .navbar-nav > .open > a, html.fph-on .navbar-nav > .open > a:hover, html.fph-on .navbar-nav > .open > a:focus,
    html.fph-on .navbar-nav > .active > a, html.fph-on .navbar-nav > .active > a:hover {
      background: transparent !important; color: var(--fph-link-hover) !important; }
    html.fph-on .navbar-form .form-control { background-color: var(--fph-input) !important; }
    /* Поиск в шапке: аккуратное поле с иконкой внутри, плейсхолдер не обрезается */
    html.fph-on .navbar-form.promo-games-filter { position: relative; }
    html.fph-on .promo-games-filter .form-control { height: 36px !important; padding: 6px 34px 6px 14px !important; border: 1px solid var(--fph-border) !important;
      border-radius: 10px !important; box-shadow: none !important; transition: border-color .15s, background-color .15s; }
    html.fph-on .promo-games-filter .form-control:focus { border-color: var(--fph-accent) !important; background-color: var(--fph-surface-3) !important; }
    @media (min-width: 992px) { html.fph-on .promo-games-filter .form-control { width: 230px !important; } }
    html.fph-on .promo-games-filter .btn-link { position: absolute; right: 18px; top: 50%; transform: translateY(-50%); padding: 4px 6px !important; color: var(--fph-muted) !important; }
    html.fph-on .promo-games-filter .btn-link:hover { color: var(--fph-link-hover) !important; }
    /* Главная: список игр на подложке, чтобы читался поверх обоев */
    html.fph-on.fph-wall .promo-games .content-with-cd { background: var(--fph-surface); -webkit-backdrop-filter: var(--fph-backdrop); backdrop-filter: var(--fph-backdrop);
      border: 1px solid var(--fph-border); border-radius: 16px; padding: 18px 22px; margin-top: 12px; margin-bottom: 12px; }
    html.fph-on.fph-wall .promo-games-fav { background: transparent !important; }
    /* Таблицы лотов и заказов: плотное стекло сразу, а не только при наведении */
    html.fph-on.fph-wall :is(.offer, .showcase, .tc:not(.offer .tc):not(.showcase .tc):not(#fph-stats .tc)) {
      background-color: var(--fph-surface-strong) !important; -webkit-backdrop-filter: var(--fph-backdrop); backdrop-filter: var(--fph-backdrop); border-radius: 14px; }
    html.fph-on.fph-wall .tc:not(.offer .tc):not(.showcase .tc) { padding: 0 8px; }
    /* Большой декоративный круг FunPay справа (картинка, Telegram/VK) — скрываем и отдаём место контенту */
    html.fph-hide-cd :is(.cd-container, .corner-cd-container) { display: none !important; }
    html.fph-hide-cd .content-with-cd { margin-right: 0 !important; }
    html.fph-hide-cd .promo-cd { min-height: 0 !important; }
    @media (min-width: 992px) { html.fph-hide-cd .promo-game-list .col-md-3 { width: 20% !important; } }
    @media (min-width: 1200px) { html.fph-hide-cd .promo-game-list .col-md-3 { width: 16.6667% !important; } }
    /* Профиль: если справа нет колонки с отзывами, лоты занимают всю ширину */
    @media (min-width: 992px) { html.fph-on .profile-container > .profile-data-container:only-child { width: 100% !important; } }
    /* Логотип FunPay в шапке */
    html.fph-logo-hidden .navbar .navbar-brand { display: none !important; }
    /* Свой логотип в стиле темы (вставляется скриптом в .navbar-brand) */
    html.fph-logo-custom .navbar .navbar-brand > :not(.fph-logo) { display: none !important; }
    html:not(.fph-logo-custom) .fph-logo { display: none !important; }
    .fph-logo { display: inline-flex; align-items: center; gap: 8px; margin-left: 16px; position: relative; top: -3px; text-decoration: none !important; }
    .fph-logo-mark { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--fph-accent, #2d6cdf);
      color: #fff; font-weight: 900; font-size: 17px; line-height: 1; box-shadow: 0 2px 10px color-mix(in srgb, var(--fph-accent, #2d6cdf) 45%, transparent); }
    .fph-logo-text { font-weight: 800; font-size: 19px; letter-spacing: -.02em; color: var(--fph-text, #222); }
    .fph-logo-text b { color: var(--fph-accent, #2d6cdf); font-weight: 800; }
    .navbar .navbar-brand:hover .fph-logo-mark { filter: brightness(1.1); }
    /* Обложка-полусфера в шапке профиля */
    html.fph-on.fph-hide-cover .profile-cover-container { visibility: hidden !important; }
    /* Редактирование лота: форма на стеклянной подложке, чтобы читалась поверх обоев */
    html.fph-on.fph-wall #content.content-lots-offeredit .page-content { background: var(--fph-surface); -webkit-backdrop-filter: var(--fph-backdrop); backdrop-filter: var(--fph-backdrop);
      border: 1px solid var(--fph-border); border-radius: 16px; padding: 18px 22px !important; margin-top: 12px; margin-bottom: 18px; }
    html.fph-on .promo-game-item .game-title a, html.fph-on .promo-game-item .game-title { font-weight: 700; }
    /* Шрифт */
    html.fph-ff body, html.fph-ff body :is(div, span, a, p, h1, h2, h3, h4, h5, h6, li, td, th, label, button, input, select, textarea, b, strong, small, em, section, nav, header, footer, table):not(.fa):not(.fas):not(.far):not(.fab):not(.glyphicon):not([class*="fa-"]):not([class*="icon"]) {
      font-family: var(--fph-font), "Helvetica Neue", Helvetica, Arial, sans-serif !important; }
    html.fph-on .tc-item, html.fph-on .contact-item { color: var(--fph-text); }
    html.fph-on .tc-item:hover, html.fph-on .contact-item:hover { background-color: var(--fph-surface-2) !important; }
    /* Статусы заказов: «Оплачен» — цветом акцента темы, «Возврат» — красным, «Закрыт» — зелёным */
    html.fph-on .tc-status.text-primary { color: var(--fph-accent) !important; font-weight: 700; }
    html.fph-on .tc-status.text-warning { color: #e5484d !important; font-weight: 700; }
    html.fph-on .tc-status.text-success { color: #30a46c !important; font-weight: 700; }
    /* Плашки строк заказов: оплаченные — цветом акцента темы, возвраты — красным (с полоской слева) */
    html.fph-on a.tc-item.info { background-color: color-mix(in srgb, var(--fph-accent) 18%, transparent) !important; box-shadow: inset 3px 0 0 var(--fph-accent); }
    html.fph-on a.tc-item.info:hover { background-color: color-mix(in srgb, var(--fph-accent) 28%, transparent) !important; }
    html.fph-on a.tc-item.warning:not([data-offer]) { background-color: color-mix(in srgb, #e5484d 16%, transparent) !important; box-shadow: inset 3px 0 0 #e5484d; }
    html.fph-on a.tc-item.warning:not([data-offer]):hover { background-color: color-mix(in srgb, #e5484d 26%, transparent) !important; }
    /* Скрытые (выключенные) свои лоты — подсветка цветом акцента темы и пометка «скрыт» */
    html.fph-on a.tc-item[data-offer].warning { background-color: color-mix(in srgb, var(--fph-accent) 20%, transparent) !important; box-shadow: inset 3px 0 0 var(--fph-accent); }
    html.fph-on a.tc-item[data-offer].warning:hover { background-color: color-mix(in srgb, var(--fph-accent) 30%, transparent) !important; }
    html.fph-on a.tc-item[data-offer].warning .tc-desc-text::before { content: "скрыт · "; color: var(--fph-accent); font-weight: 700; }
    /* Открытый чат — нейтральная плашка с полоской слева (у FunPay он синий, а акцент темы может
       совпасть с оранжевым цветом непрочитанных). Непрочитанные остаются оранжевыми. */
    html.fph-on .contact-item.active, html.fph-on .contact-item.active:hover { background-color: var(--fph-surface-3) !important; box-shadow: inset 3px 0 0 var(--fph-text-2); }
    html.fph-on .contact-item.active :is(.media-user-name, .contact-item-time) { color: var(--fph-text) !important; }
    html.fph-on .contact-item.active .contact-item-message { color: var(--fph-text-2) !important; }
    html.fph-on .contact-item.unread:not(.active) { background-color: color-mix(in srgb, #f5a623 30%, transparent) !important; box-shadow: inset 3px 0 0 #f5a623; }
    html.fph-on .contact-item.unread:not(.active) :is(.media-user-name, .contact-item-message, .contact-item-time) { color: var(--fph-text) !important; }
    html.fph-on.fph-wall .footer-block, html.fph-on.fph-wall #footer { color: var(--fph-text-2); }
    html.fph-on .btn-primary { background-color: var(--fph-accent) !important; border-color: var(--fph-accent) !important; color: #fff !important; }
    html.fph-on ::-webkit-scrollbar { width: 10px; height: 10px; }
    html.fph-on ::-webkit-scrollbar-thumb { background: var(--fph-border-strong); border-radius: 6px; }
    html.fph-on ::-webkit-scrollbar-track { background: transparent; }
    #fph-bg { position: fixed; inset: 0; z-index: -1; pointer-events: none; background-size: cover; background-position: center; transition: transform .25s ease-out; }
    #fph-bg.fph-parallax { inset: -24px; }
    #fph-bg.fph-bg-preview { filter: blur(18px); transform: scale(1.06); }
    #fph-bg { transition: transform .25s ease-out, filter .35s ease-out; }
    #fph-bg video { width: 100%; height: 100%; object-fit: cover; }
    #fph-bg::after { content: ""; position: absolute; inset: 0; background: rgb(0 0 0 / var(--fph-dim)); }
    #fph-fx { position: fixed; inset: 0; z-index: -1; pointer-events: none; width: 100vw; height: 100vh; }
    html.fph-font body { zoom: var(--fph-font-scale); }
    /* Строки таблиц FunPay — это table-row, отступы задают ячейки внутри, поэтому ужимаем их */
    html.fph-compact .tc-item > div { padding-top: 5px !important; padding-bottom: 5px !important; }
    html.fph-compact .tc-item :is(.tc-desc-text, .order-desc) { line-height: 1.3 !important; }
    html.fph-compact :is(.offer-list-title-container, .offer-list-title) { padding-top: 6px !important; padding-bottom: 6px !important; }
    html.fph-compact .contact-item { padding-top: 6px !important; padding-bottom: 6px !important; }
    html.fph-compact .chat-msg-item { margin-top: 2px !important; padding-top: 2px !important; padding-bottom: 2px !important; }
    html.fph-hide-chat-promo .chat-promo { display: none !important; }
  `;

  // ---------- Обои ----------
  let bgKey = "";
  let blobUrl = null;
  // Перенос старого формата (base64 в chrome.storage) в IndexedDB.
  async function wallFile() {
    let rec = await FPH_WALL.get();
    if (rec?.blob) return rec;
    const { wallpaperData: d } = await chrome.storage.local.get("wallpaperData");
    if (!d?.dataUrl) return null;
    rec = { blob: await (await fetch(d.dataUrl)).blob(), mime: d.mime, name: d.name || "" };
    await FPH_WALL.put(rec);
    chrome.storage.local.remove("wallpaperData");
    return rec;
  }
  // Копия картинки под размер экрана (до 2560 px) — декодируется в разы быстрее оригинала 4K.
  // Плюс превью 48 px в localStorage для мгновенного показа. GIF не трогаем — потеряется анимация.
  const THUMB_KEY = "fph-wall-thumb";
  async function fitImage(rec, id) {
    const mime = rec.mime || rec.blob.type || "";
    if (/gif/i.test(mime)) return rec.blob;
    const cached = await FPH_WALL.get("wallpaper-fit");
    if (cached?.id === id && cached.blob) return cached.blob;
    try {
      const bmp = await createImageBitmap(rec.blob);
      const scale = Math.min(1, 2560 / bmp.width);
      const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
      const c = new OffscreenCanvas(w, h);
      c.getContext("2d").drawImage(bmp, 0, 0, w, h);
      const fit = scale < 1 || rec.blob.size > 3e6 ? await c.convertToBlob({ type: "image/jpeg", quality: 0.9 }) : rec.blob;
      const t = new OffscreenCanvas(48, Math.max(1, Math.round(48 * h / w)));
      t.getContext("2d").drawImage(bmp, 0, 0, t.width, t.height);
      const tb = await t.convertToBlob({ type: "image/jpeg", quality: 0.6 });
      const turl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(tb); });
      try { localStorage.setItem(THUMB_KEY, JSON.stringify({ id, url: turl })); } catch (e) {}
      await FPH_WALL.put({ id, blob: fit }, "wallpaper-fit");
      return fit;
    } catch (e) {
      return rec.blob;
    }
  }

  async function applyWallpaper(s) {
    const w = s.theme.wallpaper;
    const on = !T.palette(s).off && T.hasWallpaper(s);
    const key = on ? `${w.type}|${w.gradient}|${w.url}|${w.uploadId || ""}` : "";
    if (key === bgKey) { setParallax(on && s.theme.parallax); return; }
    bgKey = key;
    document.getElementById("fph-bg")?.remove();
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    root.classList.toggle("fph-wall", on);
    if (!on) { setParallax(false); return; }
    const layer = document.createElement("div");
    layer.id = "fph-bg";
    let src = null, video = false;
    if (w.type === "upload") {
      // Мгновенно — крошечное размытое превью из localStorage, пока читается настоящая картинка.
      const id = String(w.uploadId || "");
      let thumb = null;
      try { thumb = JSON.parse(localStorage.getItem(THUMB_KEY) || "null"); } catch (e) {}
      if (thumb?.id === id && thumb.url) {
        layer.style.backgroundImage = `url("${thumb.url}")`;
        layer.classList.add("fph-bg-preview");
        root.insertBefore(layer, document.getElementById("fph-fx"));
        setParallax(s.theme.parallax);
      }
      const rec = await wallFile();
      if (!rec?.blob || bgKey !== key) return;
      video = (rec.mime || rec.blob.type || "").startsWith("video/");
      const blob = video ? rec.blob : await fitImage(rec, id);
      if (bgKey !== key) return;
      blobUrl = URL.createObjectURL(blob);
      src = blobUrl;
      if (!video) {
        // Ждём декодирования, чтобы картинка появилась целиком, а не построчно.
        const img = new Image();
        img.src = src;
        try { await img.decode(); } catch (e) {}
        if (bgKey !== key) return;
        layer.style.backgroundImage = `url("${src}")`;
        layer.classList.remove("fph-bg-preview");
        if (!layer.isConnected) { root.insertBefore(layer, document.getElementById("fph-fx")); setParallax(s.theme.parallax); }
        return;
      }
    } else if (w.type === "url") {
      src = w.url; video = T.isVideoUrl(w.url);
    }
    if (video) {
      const v = document.createElement("video");
      Object.assign(v, { src, autoplay: true, loop: true, muted: true, playsInline: true });
      layer.append(v);
    } else if (src) {
      layer.style.backgroundImage = `url("${src}")`;
    } else {
      layer.style.background = T.wallpaperCss(s);
    }
    root.insertBefore(layer, document.getElementById("fph-fx"));
    setParallax(s.theme.parallax);
  }

  // ---------- Параллакс: фон слегка смещается за мышью ----------
  let parallaxOn = false;
  const onMouse = (e) => {
    const bg = document.getElementById("fph-bg");
    if (!bg) return;
    const x = (e.clientX / innerWidth - 0.5) * -24, y = (e.clientY / innerHeight - 0.5) * -24;
    bg.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  };
  function setParallax(on) {
    on = !!on;
    const bg = document.getElementById("fph-bg");
    bg?.classList.toggle("fph-parallax", on);
    if (!on && bg) bg.style.transform = "";
    if (on === parallaxOn) return;
    parallaxOn = on;
    if (on) addEventListener("mousemove", onMouse, { passive: true });
    else removeEventListener("mousemove", onMouse);
  }

  // ---------- Живые эффекты (canvas поверх фона, под содержимым) ----------
  let fx = null;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const FX = {
    sakura: {
      count: (k) => 18 + 70 * k,
      make: (w, h, init) => ({ x: rnd(-40, w), y: init ? rnd(0, h) : rnd(-60, -10), r: rnd(5, 11), vx: rnd(0.3, 1.2), vy: rnd(0.6, 1.6), a: rnd(0, 6.28), va: rnd(-0.03, 0.03), sw: rnd(0, 6.28), hue: rnd(330, 355) }),
      step: (p, w, h) => { p.sw += 0.02; p.x += p.vx + Math.sin(p.sw) * 0.6; p.y += p.vy; p.a += p.va; return p.y < h + 20 && p.x < w + 40; },
      draw: (c, p) => {
        c.save(); c.translate(p.x, p.y); c.rotate(p.a); c.scale(1, 0.55 + 0.45 * Math.abs(Math.sin(p.sw)));
        c.fillStyle = `hsla(${p.hue},85%,82%,.85)`;
        c.beginPath(); c.moveTo(0, -p.r); c.bezierCurveTo(p.r, -p.r, p.r, p.r * 0.6, 0, p.r); c.bezierCurveTo(-p.r, p.r * 0.6, -p.r, -p.r, 0, -p.r); c.fill();
        c.restore();
      },
    },
    snow: {
      count: (k) => 40 + 220 * k,
      make: (w, h, init) => ({ x: rnd(0, w), y: init ? rnd(0, h) : -5, r: rnd(1, 3.4), vy: rnd(0.4, 1.4), sw: rnd(0, 6.28), o: rnd(0.4, 0.95) }),
      step: (p, w, h) => { p.sw += 0.01; p.x += Math.sin(p.sw) * 0.5; p.y += p.vy * (p.r / 2); return p.y < h + 5; },
      draw: (c, p) => { c.fillStyle = `rgba(255,255,255,${p.o})`; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.28); c.fill(); },
    },
    fireflies: {
      count: (k) => 12 + 50 * k,
      make: (w, h) => ({ x: rnd(0, w), y: rnd(h * 0.2, h), a: rnd(0, 6.28), v: rnd(0.2, 0.6), t: rnd(0, 6.28), r: rnd(1.5, 3) }),
      step: (p, w, h) => { p.a += rnd(-0.08, 0.08); p.x += Math.cos(p.a) * p.v; p.y += Math.sin(p.a) * p.v; p.t += 0.03; if (p.x < 0 || p.x > w) p.a = Math.PI - p.a; if (p.y < 0 || p.y > h) p.a = -p.a; return true; },
      draw: (c, p) => {
        const o = 0.35 + 0.65 * Math.abs(Math.sin(p.t));
        const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 6);
        g.addColorStop(0, `rgba(255,236,140,${o})`); g.addColorStop(1, "rgba(255,236,140,0)");
        c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, p.r * 6, 0, 6.28); c.fill();
      },
    },
    stars: {
      count: (k) => 60 + 240 * k,
      make: (w, h) => ({ x: rnd(0, w), y: rnd(0, h), r: rnd(0.4, 1.6), t: rnd(0, 6.28), vt: rnd(0.01, 0.05) }),
      step: (p) => { p.t += p.vt; return true; },
      draw: (c, p) => { c.fillStyle = `rgba(255,255,255,${0.25 + 0.75 * Math.abs(Math.sin(p.t))})`; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.28); c.fill(); },
      extra: (c, w, h, st) => { // падающая звезда раз в несколько секунд
        if (!st.shoot && Math.random() < 0.004) st.shoot = { x: rnd(w * 0.3, w), y: rnd(0, h * 0.4), l: 0 };
        const s = st.shoot;
        if (!s) return;
        s.l += 14;
        const len = Math.min(s.l, 160);
        const g = c.createLinearGradient(s.x + len, s.y - len * 0.4, s.x, s.y);
        g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(255,255,255,.9)");
        c.strokeStyle = g; c.lineWidth = 1.6; c.beginPath(); c.moveTo(s.x + len, s.y - len * 0.4); c.lineTo(s.x, s.y); c.stroke();
        s.x -= 14; s.y += 5.6;
        if (s.l > 420) st.shoot = null;
      },
    },
    rain: {
      count: (k) => 60 + 260 * k,
      make: (w, h, init) => ({ x: rnd(-50, w), y: init ? rnd(0, h) : rnd(-80, -10), l: rnd(10, 24), v: rnd(9, 16), o: rnd(0.15, 0.45) }),
      step: (p, w, h) => { p.y += p.v; p.x += p.v * 0.15; return p.y < h + 30; },
      draw: (c, p) => { c.strokeStyle = `rgba(190,215,255,${p.o})`; c.lineWidth = 1; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + p.l * 0.15, p.y + p.l); c.stroke(); },
    },
    embers: {
      count: (k) => 20 + 80 * k,
      make: (w, h, init) => ({ x: rnd(0, w), y: init ? rnd(0, h) : h + 10, r: rnd(1, 2.6), vy: rnd(0.4, 1.3), sw: rnd(0, 6.28), life: 1 }),
      step: (p) => { p.sw += 0.03; p.x += Math.sin(p.sw) * 0.7; p.y -= p.vy; p.life -= 0.0015; return p.y > -10 && p.life > 0; },
      draw: (c, p) => {
        const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        g.addColorStop(0, `rgba(255,190,90,${0.9 * p.life})`); g.addColorStop(1, "rgba(255,90,20,0)");
        c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, p.r * 4, 0, 6.28); c.fill();
      },
    },
  };

  function stopFx() {
    if (!fx) return;
    cancelAnimationFrame(fx.raf);
    fx.canvas.remove();
    removeEventListener("resize", fx.resize);
    fx = null;
  }
  function applyEffect(s) {
    const e = s.theme.effect || {};
    const type = !T.palette(s).off && FX[e.type] ? e.type : null;
    const intensity = Math.max(1, Math.min(100, Number(e.intensity) || 50));
    if (fx && fx.type === type && fx.intensity === intensity) return;
    stopFx();
    if (!type) return;
    const def = FX[type];
    const canvas = document.createElement("canvas");
    canvas.id = "fph-fx";
    root.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const st = {};
    fx = { type, intensity, canvas, ctx, parts: [], raf: 0 };
    fx.resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
    fx.resize();
    addEventListener("resize", fx.resize);
    const n = Math.round(def.count(intensity / 100));
    for (let i = 0; i < n; i++) fx.parts.push(def.make(canvas.width, canvas.height, true));
    const frame = () => {
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < fx.parts.length; i++) {
        if (!def.step(fx.parts[i], w, h)) fx.parts[i] = def.make(w, h, false);
        def.draw(ctx, fx.parts[i]);
      }
      def.extra?.(ctx, w, h, st);
      fx.raf = requestAnimationFrame(frame);
    };
    fx.raf = requestAnimationFrame(frame);
  }

  // ---------- Свой шрифт: файл из IndexedDB или название (установленный / Google Fonts) ----------
  let customFontKey = "";
  let customFontUrl = null;
  function customFontFamily(cf) {
    const key = cf.mode === "file" ? "file|" + (cf.fileId || "") : "name|" + (cf.name || "") + "|" + (cf.google ? 1 : 0);
    if (key !== customFontKey) {
      customFontKey = key;
      document.getElementById("fph-gfont")?.remove();
      if (customFontUrl) { URL.revokeObjectURL(customFontUrl); customFontUrl = null; }
      style("fph-customfont").textContent = "";
      if (cf.mode === "file" && cf.fileId) {
        FPH_WALL.get("font-custom").then((rec) => {
          if (!rec?.blob || customFontKey !== key) return;
          customFontUrl = URL.createObjectURL(rec.blob);
          style("fph-customfont").textContent = `@font-face{font-family:"FPH Custom";src:url("${customFontUrl}");font-weight:100 900;font-display:swap}`;
        });
      } else if (cf.mode !== "file" && cf.name && cf.google) {
        // Google Fonts: старый API css отдаёт все доступные начертания и не падает, если какого-то нет.
        const link = document.createElement("link");
        link.id = "fph-gfont";
        link.rel = "stylesheet";
        link.href = "https://fonts.googleapis.com/css?family=" + encodeURIComponent(cf.name.trim()) + ":300,400,500,600,700,800&subset=cyrillic,latin&display=swap";
        (document.head || root).appendChild(link);
      }
    }
    if (cf.mode === "file") return cf.fileId ? "FPH Custom" : "";
    return (cf.name || "").trim();
  }

  function apply(s) {
    settings = s;
    const on = !T.palette(s).off;
    root.classList.toggle("fph-on", on);
    style("fph-vars").textContent = on ? T.varsCss(s) : "";
    style("fph-base").textContent = BASE;
    style("fph-remap").textContent = remapFor(on);
    const c = s.custom;
    root.classList.toggle("fph-compact", !!c.compact);
    root.classList.toggle("fph-font", Number(c.fontScale) !== 100);
    root.classList.toggle("fph-hide-chat-promo", !!c.hideChatPromo);
    root.classList.toggle("fph-hide-cover", !!c.hideProfileCover);
    root.classList.toggle("fph-hide-cd", !!c.hideCd);
    root.classList.toggle("fph-logo-hidden", c.logoMode === "hidden");
    root.classList.toggle("fph-logo-custom", c.logoMode === "custom");
    // Запоминаем настройки синхронно — при следующей загрузке страницы тема включится мгновенно.
    try { localStorage.setItem(BOOT_KEY, JSON.stringify(s)); } catch (e) {}
    root.style.setProperty("--fph-font-scale", String((Number(c.fontScale) || 100) / 100));
    style("fph-user-css").textContent = c.css || "";
    // Шрифт и размер текста работают и при стандартной теме FunPay.
    const font = c.font === "custom" ? customFontFamily(c.customFont || {}) : (T.FONTS[c.font]?.family || "");
    root.classList.toggle("fph-ff", !!font);
    if (font) {
      root.style.setProperty("--fph-font", `"${font.replace(/"/g, "")}"`);
      const faces = style("fph-fontfaces");
      if (!faces.textContent) faces.textContent = T.fontFaces((p) => chrome.runtime.getURL(p));
    }
    const ts = Number(c.textScale) || 100;
    root.classList.toggle("fph-fs", ts !== 100);
    root.style.setProperty("--fph-text-scale", String(ts / 100));
    applyWallpaper(s);
    applyEffect(s);
  }

  function rebuild() {
    const fresh = buildRemap();
    if (!fresh || fresh === remapCss) return;
    remapCss = fresh;
    try { localStorage.setItem(CACHE_KEY, remapCss); } catch (e) {}
    style("fph-remap").textContent = remapFor(!T.palette(settings).off);
  }

  // Сразу, синхронно — из копии настроек в localStorage, чтобы не мелькал стандартный дизайн FunPay.
  let bootJson = "";
  try {
    bootJson = localStorage.getItem(BOOT_KEY) || "";
    if (bootJson) apply(T.merge(T.DEFAULTS, JSON.parse(bootJson)));
  } catch (e) {}
  // Затем сверяемся с настоящими настройками расширения (могли поменяться в другой вкладке).
  chrome.storage.local.get("settings", (r) => {
    const s = T.merge(T.DEFAULTS, r.settings);
    if (JSON.stringify(s) !== bootJson) apply(s);
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "local" && (ch.settings || ch.wallpaperData)) {
      if (ch.wallpaperData) bgKey = "";
      chrome.storage.local.get("settings", (r) => apply(T.merge(T.DEFAULTS, r.settings)));
    }
  });
  // CSS FunPay загружается после старта — пересобираем перекраску, когда он готов.
  // Логотип и пункт «⚙ Helper» вставляем, как только браузер разобрал шапку, — ещё до загрузки
  // остальной страницы, чтобы на месте логотипа не было пустоты.
  function earlyHeader() {
    const brand = document.querySelector(".navbar .navbar-brand");
    if (brand && !brand.querySelector(".fph-logo")) {
      const logo = document.createElement("span");
      logo.className = "fph-logo";
      logo.innerHTML = '<span class="fph-logo-mark">F</span><span class="fph-logo-text">Fun<b>Pay</b></span>';
      brand.append(logo);
    }
    // Пункт меню добавляем, только когда браузер дочитал список целиком (иначе встанет не последним).
    const navUl = document.querySelector(".navbar ul.navbar-nav:not(.navbar-right)");
    const nav = navUl && (navUl.nextElementSibling || document.readyState !== "loading") ? navUl : null;
    if (nav && !document.getElementById("fph-nav")) {
      const li = document.createElement("li");
      li.id = "fph-nav";
      li.innerHTML = '<a href="#helper" title="Настройки FunPay Helper: темы и функции">⚙ Helper</a>';
      nav.append(li);
    }
    return !!(brand && nav);
  }
  if (!earlyHeader()) {
    const mo = new MutationObserver(() => { if (earlyHeader()) mo.disconnect(); });
    mo.observe(root, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", () => { earlyHeader(); mo.disconnect(); });
  }
  document.addEventListener("DOMContentLoaded", rebuild);
  window.addEventListener("load", rebuild);
})();
