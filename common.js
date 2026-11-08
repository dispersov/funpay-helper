// Общие помощники для всех модулей. Все скрипты работают в одном контексте страницы.
const FPH = (() => {
  function appData() {
    try {
      return JSON.parse(document.body.getAttribute("data-app-data") || "{}");
    } catch (e) {
      return {};
    }
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "style") node.style.cssText = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function parseNumber(text) {
    const m = String(text || "").replace(/\s| /g, "").replace(",", ".").match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }

  function currencyOf(text) {
    const m = String(text || "").trim().match(/[^\d\s., ]+$/);
    return m ? m[0] : "";
  }

  function fmtMoney(n, cur = "") {
    return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + (cur ? " " + cur : "");
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Запрос к FunPay. На 429 («слишком много запросов») ждём и повторяем: 5, 10, 20, 40, 60 секунд.
  async function fetchRetry(url, opts = {}, onWait) {
    const waits = [5, 10, 20, 40, 60];
    for (let i = 0; ; i++) {
      const r = await fetch(url, { credentials: "include", ...opts });
      if (r.status !== 429 || i >= waits.length) return r;
      onWait?.(waits[i]);
      await sleep(waits[i] * 1000);
    }
  }
  async function fetchDoc(url, opts = {}, onWait) {
    const r = await fetchRetry(url, opts, onWait);
    if (!r.ok) throw new Error(r.status === 429 ? "FunPay просит подождать (429), попробуйте позже" : `HTTP ${r.status} для ${url}`);
    return new DOMParser().parseFromString(await r.text(), "text/html");
  }

  function modal(title, body) {
    const close = () => wrap.remove();
    const wrap = el("div", { class: "fph-modal-wrap", onclick: (e) => e.target === wrap && close() },
      el("div", { class: "fph-modal" },
        el("div", { class: "fph-modal-head" },
          el("b", {}, title),
          el("button", { class: "fph-btn fph-btn-ghost", onclick: close }, "✕")),
        body));
    document.body.append(wrap);
    return { close, wrap };
  }

  // ---------- Лоты: чтение формы, сохранение, комиссия ----------
  const XHR = { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest", accept: "*/*" };

  // Собирает поля формы редактирования лота так же, как браузер при отправке.
  function collectOfferFields(doc) {
    const form = doc.querySelector('input[name="offer_id"]')?.closest("form") || doc;
    const live = doc === document;
    const data = new URLSearchParams();
    for (const f of form.querySelectorAll("input[name], textarea[name], select[name]")) {
      const tag = f.tagName.toLowerCase();
      const type = (f.getAttribute("type") || "").toLowerCase();
      if (tag === "input" && ["submit", "button", "file", "image", "reset"].includes(type)) continue;
      if ((type === "checkbox" || type === "radio") && !f.checked) continue;
      if (tag === "select" && f.closest(".form-group")?.classList.contains("hidden")) continue;
      if (tag === "textarea") data.append(f.name, live ? f.value : f.textContent);
      else if (type === "checkbox") data.append(f.name, f.getAttribute("value") || "on");
      else data.append(f.name, tag === "select" || live ? f.value : f.getAttribute("value") || "");
    }
    return data;
  }

  async function loadOffer(id) {
    const doc = await fetchDoc(`/lots/offerEdit?offer=${id}`);
    const err = doc.querySelector("p.lead");
    if (err) throw new Error(err.textContent.trim());
    return { doc, data: collectOfferFields(doc) };
  }

  async function saveOffer(data) {
    const r = await fetch("/lots/offerSave", { method: "POST", credentials: "include", headers: XHR, body: data.toString() });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json().catch(() => ({}));
    if (json.error || (json.errors && Object.keys(json.errors).length)) throw new Error(json.error || JSON.stringify(json.errors));
    return json;
  }

  // Комиссия раздела: спрашиваем у FunPay, сколько заплатит покупатель при цене продавца 1000.
  // Кэшируем на сутки. Возвращает долю (0.05 = 5%) или null.
  async function commission(nodeId) {
    if (!nodeId) return null;
    const key = "fphCommission2";
    const all = (await chrome.storage.local.get(key))[key] || {};
    const hit = all[nodeId];
    if (hit && Date.now() - hit.at < 864e5) return hit.c;
    try {
      const r = await fetch("/lots/calc", { method: "POST", credentials: "include", headers: XHR, body: new URLSearchParams({ nodeId, price: "1000" }).toString() });
      const j = await r.json();
      // FunPay отдаёт цены сразу в ₽, $ и €; цена 1000 задана в валюте аккаунта, поэтому
      // берём только суммы около 1000 (в другой валюте они в десятки раз меньше или больше).
      const prices = (j.methods || []).map((m) => parseNumber(m.price)).filter((v) => v >= 1000 && v < 1600);
      if (!prices.length) return null;
      const c = Math.min(...prices) / 1000 - 1;
      all[nodeId] = { c, at: Date.now() };
      await chrome.storage.local.set({ [key]: all });
      return c;
    } catch (e) {
      return null;
    }
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = el("textarea", { style: "position:fixed;left:-9999px" });
      ta.value = text; document.body.append(ta); ta.select();
      const ok = document.execCommand("copy"); ta.remove(); return ok;
    }
  }

  function toast(text) {
    const t = el("div", { class: "fs-toast" }, text);
    document.body.append(t);
    setTimeout(() => t.remove(), 2400);
  }

  // Настройки расширения (включённые функции и т.д.).
  const settings = new Promise((resolve) => {
    if (typeof FPH_THEME === "undefined") return; // расширение не перезагружено после обновления файлов
    chrome.storage.local.get("settings", (r) => resolve(FPH_THEME.merge(FPH_THEME.DEFAULTS, r.settings)));
  });
  const whenEnabled = (feature, fn) => settings.then((s) => { if (s.features[feature]) fn(s); });

  // ---------- Страница настроек внутри FunPay ----------
  // Пункт «⚙ Helper» в шапке ведёт на текущую страницу с #helper: содержимое страницы
  // прячется, на его месте рисуются настройки. Шапка, подвал и тема FunPay остаются.
  let settingsHost = null, unmount = null, prevTitle = "";
  function routeSettings() {
    const want = location.hash === "#helper";
    const content = document.querySelector("#content") || document.querySelector("#content-body");
    if (want && !settingsHost) {
      if (typeof FPH_SETTINGS_UI === "undefined") return;
      settingsHost = el("div", { id: "fph-settings", class: "container" });
      const box = el("div");
      settingsHost.append(box);
      if (content) { content.style.display = "none"; content.after(settingsHost); } else document.body.prepend(settingsHost);
      unmount = FPH_SETTINGS_UI.mount(box);
      prevTitle = document.title;
      document.title = "FunPay Helper — настройки";
      window.scrollTo(0, 0);
    } else if (!want && settingsHost) {
      unmount?.();
      settingsHost.remove();
      settingsHost = null;
      if (content) content.style.display = "";
      document.title = prevTitle;
    }
    document.getElementById("fph-nav")?.classList.toggle("active", want);
  }
  function addNavButton() {
    if (document.getElementById("fph-nav")) return;
    const nav = document.querySelector(".navbar ul.navbar-nav:not(.navbar-right)") || document.querySelector(".navbar ul.navbar-nav");
    if (nav) {
      nav.append(el("li", { id: "fph-nav" }, el("a", { href: "#helper", title: "Настройки FunPay Helper: темы и функции" }, "⚙ Helper")));
    } else {
      document.body.append(el("a", { id: "fph-nav", href: "#helper", class: "fph-btn fph-btn-primary fph-float", title: "Настройки FunPay Helper" }, "⚙"));
    }
  }
  // Пасхалка в подвале (по просьбе владельца): своя подпись, зачёркнутый логотип студии и значок Claude.
  function footerJoke() {
    const b = document.querySelector(".footer-block-als");
    if (!b || b.dataset.fph) return;
    const text = b.querySelector("div");
    const logo = b.querySelector("img");
    if (!text) return;
    b.dataset.fph = "1";
    const link = text.querySelector("a");
    text.textContent = "";
    text.append("криворукие ебланы", el("br"), "в ");
    if (link) text.append(link);
    if (logo) {
      const wrap = el("span", { class: "fph-strike-logo" });
      logo.replaceWith(wrap);
      wrap.append(logo);
    }
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 20 400 270");
    svg.setAttribute("class", "fph-claude-ico");
    svg.setAttribute("shape-rendering", "crispEdges");
    // Пиксельный человечек по картинке владельца: тело, «руки», четыре ножки и два глаза.
    const px = (x, y, w, h, fill) => {
      const r = document.createElementNS(NS, "rect");
      Object.entries({ x, y, width: w, height: h, fill }).forEach(([k, v]) => r.setAttribute(k, String(v)));
      svg.append(r);
    };
    const C = "#f15f4a";
    px(72, 30, 258, 186, C);           // тело
    px(12, 92, 378, 62, C);            // «руки» по бокам
    for (const x of [72, 136, 232, 296]) px(x, 210, 32, 68, C); // ножки
    px(108, 60, 32, 32, "#111");       // левый глаз
    px(262, 60, 32, 32, "#111");       // правый глаз
    b.append(el("div", { class: "fph-claude" }, svg, el("div", {}, "а чинил", el("br"), el("b", {}, "Claude"))));
  }

  // Свой логотип в шапке: квадрат цвета акцента с «F» и надпись FunPay шрифтом темы. Ссылка на главную остаётся.
  function addLogo() {
    const brand = document.querySelector(".navbar .navbar-brand");
    if (!brand || brand.querySelector(".fph-logo")) return;
    brand.append(el("span", { class: "fph-logo" },
      el("span", { class: "fph-logo-mark" }, "F"),
      el("span", { class: "fph-logo-text" }, "Fun", el("b", {}, "Pay"))));
  }

  if (typeof FPH_THEME !== "undefined") {
    addLogo();
    settings.then((s) => { if (s.custom.footerJoke) footerJoke(); });
    addNavButton();
    window.addEventListener("hashchange", routeSettings);
    routeSettings();
  }

  const myId = () => String(appData().userId || "");

  return { appData, el, parseNumber, currencyOf, fmtMoney, sleep, fetchDoc, fetchRetry, modal, settings, whenEnabled,
    collectOfferFields, loadOffer, saveOffer, commission, copyText, toast, myId, XHR };
})();
