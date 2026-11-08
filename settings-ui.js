// Интерфейс настроек FunPay Helper. Монтируется прямо на страницу FunPay (адрес с #helper).
// В момент автообновления расширения часть скриптов может загрузиться без FPH_THEME — тогда молчим.
const FPH_SETTINGS_UI = typeof FPH_THEME === "undefined" ? undefined : (() => {
  const T = FPH_THEME;

  function h(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "style") n.style.cssText = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k in n && typeof v !== "string") n[k] = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }

  function mount(root) {
    let S = T.merge(T.DEFAULTS, {});
    let notes = {};
    let section = "theme";
    let saveTimer = null;
    const store = {
      get: (k) => chrome.storage.local.get(k),
      set: (o) => chrome.storage.local.set(o),
    };
    function save() {
      paintScope();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => store.set({ settings: S }), 120);
    }
    function toast(text) {
      const t = h("div", { class: "fs-toast" }, text);
      document.body.append(t);
      setTimeout(() => t.remove(), 2200);
    }
    const get = (path) => path.split(".").reduce((o, k) => o[k], S);
    function set(path, value) {
      const keys = path.split(".");
      const last = keys.pop();
      keys.reduce((o, k) => o[k], S)[last] = value;
      save();
    }

    // Если тема FunPay выключена, сама страница настроек всё равно рисуется в тёмной палитре.
    const scopeStyle = h("style");
    function paintScope() {
      scopeStyle.textContent = T.palette(S).off ? T.varsCss(T.merge(S, { theme: { preset: "dark", wallpaper: { type: "none" } } }), ".fs-app") : "";
    }

    function toggle(path, title, desc, opts = {}) {
      const id = "fs-" + path.replace(/\./g, "-");
      return h("div", { class: "fs-opt" },
        h("input", { type: "checkbox", id, checked: !!get(path), onchange: (e) => { set(path, e.target.checked); opts.onchange?.(); } }),
        h("label", { for: id, class: "fs-t" }, title),
        h("div", { class: "fs-d" }, desc));
    }
    function soon(title, desc) {
      return h("div", { class: "fs-opt fs-locked" },
        h("input", { type: "checkbox", disabled: true }),
        h("div", { class: "fs-t" }, title, h("span", { class: "fs-soon" }, "СКОРО")),
        h("div", { class: "fs-d" }, desc));
    }
    function slider(path, label, min, max, step, unit) {
      const out = h("output", {}, get(path) + unit);
      return h("div", { class: "fs-slider" }, h("span", {}, label),
        h("input", { type: "range", min, max, step, value: get(path), oninput: (e) => { out.textContent = e.target.value + unit; set(path, Number(e.target.value)); } }),
        out);
    }
    const btn = (text, onclick, cls = "") => h("button", { type: "button", class: "fs-btn " + cls, onclick }, text);

    const SECTIONS = [
      { id: "theme", ico: "◐", name: "Тема", render: renderTheme },
      { id: "custom", ico: "🎨", name: "Кастомизация", render: renderCustom },
      { id: "offers", ico: "🏷", name: "Предложения", render: renderOffers },
      { id: "orders", ico: "🛒", name: "Заказы", render: renderOrders },
      { id: "finance", ico: "💳", name: "Финансы", render: renderFinance },
      { id: "buyers", ico: "👤", name: "Покупатели", render: renderBuyers },
      { id: "info", ico: "ⓘ", name: "Инфо", render: renderInfo },
    ];

    const nav = h("nav", { class: "fs-side fs-glass" });
    const main = h("main", { class: "fs-main fs-glass" });
    root.className = "fs-app";
    root.append(scopeStyle,
      h("header", { class: "fs-top" },
        h("div", { class: "fs-brand" }, "FunPay Helper", h("span", { class: "fs-chip" }, "v" + chrome.runtime.getManifest().version)),
        h("a", { class: "fs-close", href: "#", onclick: (e) => { e.preventDefault(); history.length > 1 ? history.back() : (location.hash = ""); } }, "✕ Закрыть")),
      h("div", { class: "fs-layout" }, nav, main));

    function render() {
      nav.textContent = "";
      for (const s of SECTIONS) {
        nav.append(h("button", { type: "button", class: s.id === section ? "fs-on" : "", onclick: () => { section = s.id; render(); } },
          h("span", { class: "fs-ico" }, s.ico), s.name));
      }
      main.textContent = "";
      SECTIONS.find((s) => s.id === section).render(main);
      try { localStorage.setItem("fph-section", section); } catch (e) {}
    }

    function miniPreview(p, wallCss) {
      const pv = p.off ? { page: "#f5f5f5", surface: "#ffffff", text: "#222222", muted: "#a6a6a6", accent: "#4384d0" } : p;
      return h("div", { class: "fs-mini", style: `background:${wallCss || pv.page}` },
        h("div", { class: "fs-mini-panel", style: `background:${pv.surface}${wallCss ? "cc" : ""}` },
          h("div", { class: "fs-ln", style: `background:${pv.text};width:60%` }),
          h("div", { class: "fs-ln", style: `background:${pv.muted};width:80%` }),
          h("div", { class: "fs-ln", style: `background:${pv.muted};width:45%` })),
        h("div", { class: "fs-mini-btn", style: `background:${pv.accent}` }));
    }

    const ask = (o) => new Promise((res) => chrome.runtime.sendMessage(o, (r) => res(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : r)));
    let busy = false;
    function setBusy(text) {
      busy = !!text;
      root.classList.toggle("fs-busy", busy);
      if (text) toast(text);
    }

    // Сохраняет файл обоев в IndexedDB сайта и включает его фоном.
    async function useWallFile(rec, meta) {
      await FPH_WALL.put(rec);
      Object.assign(S.theme.wallpaper, { type: "upload", uploadId: Date.now(), name: meta.name || "", source: meta.source || "", thumb: meta.thumb || "" });
      save();
      render();
    }

    async function useWallhaven(item, quiet) {
      if (busy) return;
      setBusy(quiet ? "" : "Загружаю картинку…");
      try {
        const r = await ask({ type: "fph-fetch-image", url: item.url });
        if (!r || r.error) throw new Error(r?.error || "нет ответа");
        const blob = await (await fetch(r.dataUrl)).blob();
        await useWallFile({ blob, mime: r.mime, name: `wallhaven-${item.id}` }, { name: `wallhaven-${item.id}`, source: "Wallhaven", thumb: item.thumb });
        if (!quiet) toast("Фон установлен");
      } catch (e) {
        toast("Не удалось загрузить картинку: " + e.message);
      } finally {
        setBusy("");
      }
    }

    async function applySet(id) {
      const set = T.SETS[id];
      S.theme.preset = set.preset;
      S.theme.set = id;
      S.theme.effect.type = set.effect;
      S.theme.glass = true;
      save();
      render();
      setBusy(`Подбираю картинку «${set.name}»…`);
      const r = await ask({ type: "fph-wallhaven", q: set.q, cat: set.cat, page: 1 + Math.floor(Math.random() * 3) });
      setBusy("");
      const items = (r?.items || []).filter((i) => i.size < 9e6);
      if (!items.length) {
        S.theme.wallpaper.type = "gradient";
        save(); render();
        return toast("Галерея не ответила — поставил градиент");
      }
      await useWallhaven(items[Math.floor(Math.random() * items.length)], true);
      toast(`Тема «${set.name}» готова. Нажмите ещё раз — будет другая картинка`);
    }

    function randomTheme() {
      const ids = Object.keys(T.SETS);
      applySet(ids[Math.floor(Math.random() * ids.length)]);
    }

    async function wallPreview(box) {
      const w = S.theme.wallpaper;
      if (w.type === "gradient") { box.style.background = T.wallpaperCss(S); return; }
      if (w.type === "url" && w.url) {
        if (T.isVideoUrl(w.url)) box.append(h("video", { src: w.url, autoplay: true, loop: true, muted: true }));
        else box.style.backgroundImage = `url("${w.url}")`;
        return;
      }
      if (w.type === "upload") {
        if (w.thumb) { box.style.backgroundImage = `url("${w.thumb}")`; return; }
        const rec = await FPH_WALL.get();
        if (!rec?.blob) return;
        const url = URL.createObjectURL(rec.blob);
        if ((rec.mime || rec.blob.type || "").startsWith("video/")) box.append(h("video", { src: url, autoplay: true, loop: true, muted: true }));
        else box.style.backgroundImage = `url("${url}")`;
      }
    }

    // ---------- Галерея Wallhaven ----------
    const gal = { open: false, q: "", cat: "010", chip: 0, sorting: "toplist", page: 1, last: 1, items: [], loading: false, error: "" };
    async function galLoad(reset) {
      if (gal.loading) return;
      if (reset) { gal.page = 1; gal.items = []; }
      gal.loading = true; gal.error = "";
      render();
      const r = await ask({ type: "fph-wallhaven", q: gal.q, cat: gal.cat, sorting: gal.sorting, page: gal.page });
      gal.loading = false;
      if (!r || r.error) gal.error = r?.error || "нет ответа";
      else { gal.items.push(...r.items); gal.last = r.last; }
      render();
    }
    function renderGallery(m) {
      const search = h("input", { class: "fs-input", style: "flex:1;min-width:200px", placeholder: "Поиск на английском: naruto, cyberpunk, lofi…", value: gal.q });
      const go = () => { gal.q = search.value.trim(); gal.chip = -1; gal.cat = gal.q ? "110" : "010"; galLoad(true); };
      search.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      const sort = h("select", { class: "fs-input", onchange: (e) => { gal.sorting = e.target.value; galLoad(true); } },
        h("option", { value: "toplist" }, "Топ за год"), h("option", { value: "random" }, "Случайные"), h("option", { value: "date_added" }, "Новые"), h("option", { value: "views" }, "Популярные"));
      sort.value = gal.sorting;
      m.append(h("div", { class: "fs-gallery" },
        h("div", { class: "fs-chips" }, T.GALLERY.map((g, i) => h("button", { type: "button", class: "fs-chip-btn" + (gal.chip === i ? " fs-on" : ""), onclick: () => {
          gal.chip = i; gal.q = g.q; gal.cat = g.cat; galLoad(true);
        } }, g.name))),
        h("div", { class: "fs-row" }, search, btn("Найти", go, "fs-primary"), sort),
        gal.error ? h("p", { class: "fs-err" }, "Ошибка галереи: " + gal.error) : null,
        h("div", { class: "fs-thumbs" }, gal.items.map((it) => h("button", {
          type: "button", class: "fs-thumb", title: `${it.res} · ${(it.size / 1048576).toFixed(1)} МБ — нажмите, чтобы поставить фоном`,
          style: `background-image:url("${it.thumb}")`, onclick: () => useWallhaven(it),
        }, h("span", {}, it.res)))),
        gal.loading ? h("p", { class: "fs-muted" }, "Загружаю…") : null,
        !gal.loading && gal.items.length && gal.page < gal.last ? h("div", { class: "fs-row" }, btn("Показать ещё", () => { gal.page++; galLoad(false); })) : null,
        !gal.loading && !gal.items.length && !gal.error ? h("p", { class: "fs-muted" }, "Ничего не найдено.") : null,
        h("p", { class: "fs-muted" }, "Картинки с wallhaven.cc, только безопасные (SFW). Выбранная картинка скачивается и хранится в браузере.")));
    }

    function renderTheme(m) {
      const th = S.theme;

      m.append(h("div", { class: "fs-h" }, "Наборы тем"),
        h("p", { class: "fs-muted" }, "Палитра + картинка + живой эффект одним кликом. Повторный клик — другая картинка."));
      const sets = h("div", { class: "fs-grid" },
        h("button", { type: "button", class: "fs-card", onclick: randomTheme },
          h("div", { class: "fs-mini fs-dice" }, "🎲"), h("div", { class: "fs-name" }, "Случайная")));
      for (const [id, set] of Object.entries(T.SETS)) {
        const on = th.set === id && th.preset === set.preset;
        const thumb = on && th.wallpaper.type === "upload" && th.wallpaper.thumb;
        sets.append(h("button", { type: "button", class: "fs-card" + (on ? " fs-on" : ""), onclick: () => applySet(id) },
          h("div", { class: "fs-mini fs-set", style: thumb ? `background-image:url("${thumb}")` : `background:${set.css}` },
            h("span", { class: "fs-set-fx" }, T.EFFECTS[set.effect]?.ico || "")),
          h("div", { class: "fs-name" }, set.name)));
      }
      m.append(sets);

      m.append(h("div", { class: "fs-h" }, "Цвета"));
      const grid = h("div", { class: "fs-grid" });
      for (const [id, p] of Object.entries(T.PRESETS)) {
        const pv = id === "custom" ? th.custom : p;
        grid.append(h("button", { type: "button", class: "fs-card" + (th.preset === id ? " fs-on" : ""), onclick: () => { th.preset = id; save(); render(); } },
          miniPreview(pv), h("div", { class: "fs-name" }, p.name)));
      }
      m.append(grid);

      if (th.preset === "custom") {
        const c = th.custom;
        const color = (k, label) => h("label", {}, label, h("input", { type: "color", value: c[k], oninput: (e) => { c[k] = e.target.value; save(); } }));
        m.append(h("div", { class: "fs-h" }, "Своя палитра"),
          h("div", { class: "fs-colors" },
            color("page", "Фон страницы"), color("surface", "Блоки"), color("text", "Текст"),
            color("muted", "Второстепенный текст"), color("border", "Рамки"), color("accent", "Акцент")),
          h("div", { class: "fs-opt" },
            h("input", { type: "checkbox", id: "fs-c-dark", checked: c.dark, onchange: (e) => { c.dark = e.target.checked; save(); } }),
            h("label", { for: "fs-c-dark", class: "fs-t" }, "Тёмная палитра"),
            h("div", { class: "fs-d" }, "Включите, если фон тёмный: так цветные плашки FunPay тоже будут затемнены.")));
      }

      if (T.PRESETS[th.preset]?.off) {
        m.append(h("p", { class: "fs-muted" }, "Выбрана стандартная тема FunPay: сайт не перекрашивается, фон, эффекты и стекло не применяются."));
        return;
      }

      // Фон
      m.append(h("div", { class: "fs-h" }, "Фон"),
        h("p", { class: "fs-muted" }, "Картинка или видео за страницей: из галереи, свой файл (картинка, GIF, MP4 или WebM до 100 МБ), ссылка или градиент."));
      const w = th.wallpaper;
      const preview = h("div", { class: "fs-wall" });
      wallPreview(preview);
      const file = h("input", { type: "file", accept: "image/*,video/mp4,video/webm", hidden: true, onchange: onUpload });
      const url = h("input", { class: "fs-input", style: "flex:1;min-width:220px", placeholder: "ссылка на картинку / .mp4 / .webm", value: w.type === "url" ? w.url : "" });
      const label = { none: "Без фона", gradient: "Градиент: " + (T.GRADIENTS[w.gradient]?.name || ""), url: "По ссылке", upload: w.name || "Свой файл" }[w.type];
      m.append(h("div", { class: "fs-row fs-wall-row" }, preview,
        h("div", { style: "flex:1;min-width:240px" },
          h("div", {}, h("b", {}, label), w.source ? h("span", { class: "fs-muted" }, " · " + w.source) : null),
          h("div", { class: "fs-row" },
            btn(gal.open ? "Скрыть галерею" : "Галерея обоев", () => { gal.open = !gal.open; if (gal.open && !gal.items.length) galLoad(true); else render(); }, "fs-primary"),
            btn("Свой файл…", () => file.click()),
            w.type !== "none" ? btn("Убрать", () => { w.type = "none"; th.set = ""; save(); render(); }) : null,
            file),
          h("div", { class: "fs-row" }, url,
            btn("По ссылке", () => {
              const v = url.value.trim();
              if (!/^https?:\/\//.test(v)) return toast("Нужна ссылка, начинающаяся с http(s)://");
              Object.assign(w, { type: "url", url: v, name: "", source: "Ссылка", thumb: "" }); save(); render();
            })))));
      if (gal.open) renderGallery(m);
      m.append(slider("theme.dim", "Затемнение фона", 0, 90, 5, "%"));

      const grads = h("div", { class: "fs-grid fs-grid-sm" });
      for (const [id, g] of Object.entries(T.GRADIENTS)) {
        const on = w.type === "gradient" && w.gradient === id;
        grads.append(h("button", { type: "button", class: "fs-card" + (on ? " fs-on" : ""), onclick: () => { Object.assign(w, { type: "gradient", gradient: id, source: "", thumb: "" }); save(); render(); } },
          h("div", { class: "fs-mini", style: `background:${g.css}` }), h("div", { class: "fs-name" }, g.name)));
      }
      m.append(h("details", { class: "fs-details" }, h("summary", {}, "Градиенты"), grads));

      // Живые эффекты
      m.append(h("div", { class: "fs-h" }, "Живые обои"),
        h("p", { class: "fs-muted" }, "Анимация поверх фона: лепестки, снег, светлячки, звёзды. Для «живых» аниме-обоев выберите картинку из галереи и добавьте эффект — или загрузите своё видео."));
      const fxGrid = h("div", { class: "fs-grid fs-grid-sm" });
      for (const [id, e] of Object.entries(T.EFFECTS)) {
        fxGrid.append(h("button", { type: "button", class: "fs-card fs-fx" + (th.effect.type === id ? " fs-on" : ""), onclick: () => { th.effect.type = id; save(); render(); } },
          h("div", { class: "fs-fx-ico" }, e.ico), h("div", { class: "fs-name" }, e.name)));
      }
      m.append(fxGrid);
      if (th.effect.type !== "none") m.append(slider("theme.effect.intensity", "Интенсивность", 5, 100, 5, "%"));
      m.append(toggle("theme.parallax", "Параллакс", "Фон слегка сдвигается вслед за мышью — эффект глубины."));

      m.append(h("div", { class: "fs-h" }, "Стекло"),
        toggle("theme.glass", "Жидкое стекло", "Блоки FunPay становятся полупрозрачными, а фон за ними размывается. Работает, когда выбран фон.", { onchange: render }));
      if (th.glass) m.append(slider("theme.density", "Плотность", 15, 100, 1, "%"), slider("theme.blur", "Размытие", 0, 40, 1, "px"));
    }

    async function onUpload(e) {
      const f = e.target.files[0];
      e.target.value = "";
      if (!f) return;
      if (f.size > 100 * 1024 * 1024) return toast("Файл больше 100 МБ");
      if (!/^(image|video)\//.test(f.type)) return toast("Нужна картинка или видео");
      S.theme.set = "";
      await useWallFile({ blob: f, mime: f.type, name: f.name }, { name: f.name, source: "Свой файл" });
      toast("Фон загружен");
    }

    function renderCustom(m) {
      m.append(h("div", { class: "fs-h" }, "Шрифт"));
      const fonts = h("div", { class: "fs-grid fs-grid-sm" });
      const cf = S.custom.customFont || (S.custom.customFont = { mode: "name", name: "", google: true });
      for (const [id, f] of Object.entries(T.FONTS)) {
        const fam = f.custom ? (cf.mode === "file" ? (cf.fileId ? "FPH Custom" : "") : cf.name) : f.family;
        const ff = fam ? `font-family:"${fam}",sans-serif !important` : "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif !important";
        fonts.append(h("button", { type: "button", class: "fs-card fs-font" + (S.custom.font === id ? " fs-on" : ""), onclick: () => { S.custom.font = id; save(); render(); } },
          h("div", { class: "fs-font-sample", style: ff }, f.custom && !fam ? "＋" : "Аа"),
          h("div", { class: "fs-font-line", style: ff }, f.custom && !fam ? "загрузить" : "Привет, 123 ₽"),
          h("div", { class: "fs-name" }, f.custom && fam && cf.mode !== "file" ? cf.name : f.name)));
      }
      m.append(fonts);
      if (S.custom.font === "custom") {
        const name = h("input", { class: "fs-input", style: "flex:1;min-width:220px", placeholder: "Название: Comfortaa, Unbounded, Segoe UI…", value: cf.name || "" });
        const file = h("input", { type: "file", accept: ".ttf,.otf,.woff,.woff2,font/*", hidden: true, onchange: async (e) => {
          const f = e.target.files[0];
          e.target.value = "";
          if (!f) return;
          if (f.size > 15 * 1024 * 1024) return toast("Файл шрифта больше 15 МБ");
          if (!/\.(ttf|otf|woff2?)$/i.test(f.name)) return toast("Нужен файл .ttf, .otf, .woff или .woff2");
          await FPH_WALL.put({ blob: f, name: f.name }, "font-custom");
          Object.assign(cf, { mode: "file", fileName: f.name, fileId: String(Date.now()) });
          save(); render();
          toast("Шрифт загружен: " + f.name);
        } });
        const google = h("input", { type: "checkbox", id: "fs-gfont", checked: cf.google !== false });
        m.append(h("div", { class: "fs-box fs-font-box" },
          h("div", { class: "fs-t" }, "Свой шрифт"),
          h("p", { class: "fs-muted" }, "Загрузите файл шрифта или впишите название: шрифта, установленного на компьютере, или любого шрифта с fonts.google.com — тогда он подгрузится сам. Для русского текста шрифт должен поддерживать кириллицу."),
          h("div", { class: "fs-row" },
            btn(cf.mode === "file" && cf.fileName ? "Файл: " + cf.fileName : "Загрузить файл…", () => file.click(), cf.mode === "file" ? "fs-primary" : ""), file),
          h("div", { class: "fs-row" }, name,
            btn("Применить название", () => {
              const v = name.value.trim();
              if (!v) return toast("Впишите название шрифта");
              Object.assign(cf, { mode: "name", name: v, google: google.checked });
              save(); render();
            }, cf.mode !== "file" && cf.name ? "fs-primary" : "")),
          h("label", { class: "fs-check-line" }, google, " искать в Google Fonts (выключите для шрифта, установленного на компьютере)")));
      }
      m.append(
        slider("custom.textScale", "Размер текста", 90, 130, 2, "%"),
        h("p", { class: "fs-muted" }, "Увеличивает только текст, без кнопок и картинок. «Масштаб» ниже увеличивает всю страницу."));
      m.append(h("div", { class: "fs-h" }, "Вид"),
        toggle("custom.linkAccent", "Цветные ссылки в меню и списках", "Ссылки в тексте (сообщения, описания, уведомления) всегда цветные. Это включает цвет и для шапки, списка игр и заголовков; если выключено — там они цветом текста и подсвечиваются при наведении."),
        slider("custom.fontScale", "Масштаб", 80, 130, 5, "%"),
        toggle("custom.compact", "Компактный вид", "Меньше отступов в списках лотов, чатов и сообщений: больше помещается на экран."),
        toggle("custom.hideChatPromo", "Скрыть промо-блок чата", "Убирает рекламный блок рядом с чатом на страницах разделов."),
        toggle("custom.hideProfileCover", "Скрыть обложку профиля", "Убирает большую полукруглую картинку в шапке профилей FunPay."),
        h("div", { class: "fs-opt" }, h("span"), h("div", { class: "fs-t" }, "Логотип в шапке"),
          h("div", { class: "fs-d" }, "Логотип слева — ссылка на главную FunPay.",
            h("div", { class: "fs-row" }, [["custom", "В стиле темы"], ["original", "Оригинальный FunPay"], ["hidden", "Скрыть"]].map(([v, label]) =>
              h("button", { type: "button", class: "fs-chip-btn" + (S.custom.logoMode === v ? " fs-on" : ""), onclick: () => { S.custom.logoMode = v; save(); render(); } }, label))))),
        toggle("custom.footerJoke", "Пасхалка в подвале", "Своя подпись вместо «Задизайнено в Студии Артемия Лебедева», зачёркнутый логотип студии и значок Claude."),
        toggle("custom.hideCd", "Скрыть большой круг справа", "Убирает декоративный круг FunPay с картинкой и кнопками Telegram/VK на главной и в разделах. Список игр растягивается на всю ширину — 5–6 игр в ряд вместо 4."));
      const ta = h("textarea", { class: "fs-input fs-code", rows: 12, spellcheck: false }, S.custom.css);
      m.append(h("div", { class: "fs-h" }, "Свой CSS"),
        h("p", { class: "fs-muted" }, "Применяется на всех страницах funpay.com поверх темы. Можно пользоваться переменными темы: var(--fph-accent), var(--fph-surface), var(--fph-text)."),
        ta, h("div", { class: "fs-row" }, btn("Сохранить CSS", () => { S.custom.css = ta.value; save(); toast("CSS сохранён"); }, "fs-primary")));
    }

    function renderOffers(m) {
      m.append(h("div", { class: "fs-h" }, "Лоты"),
        toggle("features.highlightOwn", "Подсветка своих лотов", "В общей таблице раздела ваши лоты выделены цветом, сверху — сколько их и на какой позиции лучший."),
        toggle("features.realPrice", "Реальные цены лотов", "Под ценой каждого лота в разделе — сумма без комиссии FunPay (сколько примерно получит продавец)."),
        toggle("features.sectionCommission", "Комиссия раздела", "Процент комиссии FunPay рядом с заголовком раздела и на странице ваших лотов."),
        toggle("features.exactPrice", "Точная цена", "В редактировании лота поле «цена для покупателя»: впишите, сколько должен заплатить покупатель, — цена продавца посчитается сама."),
        toggle("features.bulk", "Массовое редактирование лотов", "На странице ваших лотов в разделе и на своём профиле кнопка «Выбрать лоты»: изменить цену (=, ±%, ±сумма), включить, выключить, клонировать или удалить сразу много лотов."),
        toggle("features.clone", "Клонирование лотов", "Кнопка «Клонировать лот» в редактировании своего лота. Товары автовыдачи в копию не переносятся."),
        toggle("features.lotSales", "Продажи по лотам", "Под описанием каждого своего лота (в профиле и на странице «Ваши предложения»): сколько раз продан, на какую сумму, когда последняя продажа и сколько было возвратов. Считается по истории продаж, без запросов к FunPay."),
        toggle("features.profilePanel", "Панель лотов в профиле", "На профилях FunPay — поиск по лотам и копирование ссылок, на своём — ещё экспорт лотов в Excel."),
        toggle("features.cost", "Себестоимость лотов", "Поле себестоимости в редактировании лота. На странице продаж под суммой заказа — чистая прибыль, в статистике — карточка «Чистая прибыль»."),
        h("div", { class: "fs-slider" }, h("span", {}, "Комиссия на вывод"),
          h("select", { class: "fs-input", onchange: (e) => set("custom.withdrawFee", Number(e.target.value)) },
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 10].map((v) => h("option", { value: String(v), selected: Number(S.custom.withdrawFee) === v }, v ? v + "%" : "не учитывать"))),
          h("span", {})));
    }

    function renderOrders(m) {
      m.append(h("div", { class: "fs-h" }, "Продажи"),
        toggle("features.salesStats", "Статистика продаж", "Блок «Статистика» на странице «Мои продажи»: карточки, графики, диаграммы, ТОП-списки, все заказы, экспорт и копирование неподтверждённых."),
        toggle("features.copyOrderId", "Копирование номера заказа", "На странице заказа рядом с номером кнопка ⧉ — копирует номер заказа."),
        h("div", { class: "fs-h" }, "Покупки"),
        toggle("features.purchaseStats", "Статистика покупок", "Такой же блок статистики на странице «Покупки»: сколько потрачено, у кого покупали, графики."));
    }

    function renderFinance(m) {
      m.append(h("div", { class: "fs-h" }, "Баланс"),
        toggle("features.withdrawInfo", "Сколько доступно для вывода", "На странице «Финансы»: сколько можно вывести сейчас и сколько освободится позже из-за задержки 48 часов, и когда."),
        toggle("features.hideBalance", "Скрыть отображение баланса", "Баланс размыт на всех страницах — удобно при демонстрации экрана. Клик по сумме показывает её."),
        toggle("features.financeStats", "Статистика финансов", "На странице «Финансы»: поступления, расходы, чистый поток, разбивка по типам операций и по месяцам."),
        toggle("features.financeExport", "Экспорт финансов", "Кнопки выгрузки истории операций в Excel (CSV) и JSON на странице «Финансы»."));
    }

    function renderBuyers(m) {
      m.append(h("div", { class: "fs-h" }, "Сообщения"),
        toggle("features.chatInfo", "Кратко о собеседнике в списке чатов", "Под ником: что покупатель смотрел (запоминается, когда вы открываете чат) или его последний заказ из истории продаж со статусом. Чаты для этого не открываются и не помечаются прочитанными."));
      m.append(h("div", { class: "fs-h" }, "Заметки"),
        toggle("features.notes", "Заметки о покупателях", "Правый клик по нику → «Заметка о пользователе», или кнопка «📝 Заметка» в профиле. Метка видна рядом с ником в чате и заказах."));
      const COLORS = { red: "#e5484d", orange: "#f76b15", yellow: "#d4a514", green: "#30a46c", blue: "#0090ff", gray: "#8b8d98" };
      const q = h("input", { class: "fs-input", type: "search", placeholder: "Поиск по нику или тексту", style: "min-width:240px" });
      const tbody = h("tbody");
      const draw = () => {
        const s = q.value.trim().toLowerCase();
        tbody.textContent = "";
        const list = Object.entries(notes)
          .filter(([id, n]) => !s || id.includes(s) || (n.name || "").toLowerCase().includes(s) || (n.text || "").toLowerCase().includes(s))
          .sort((a, b) => (b[1].updated || 0) - (a[1].updated || 0));
        if (!list.length) tbody.append(h("tr", {}, h("td", { colspan: "5", class: "fs-muted" }, "Заметок пока нет.")));
        for (const [id, n] of list) {
          tbody.append(h("tr", {},
            h("td", {}, h("span", { class: "fs-dot", style: `background:${COLORS[n.color] || "transparent"}` })),
            h("td", {}, h("a", { href: `/users/${id}/`, target: "_blank" }, n.name || "#" + id)),
            h("td", {}, n.text || ""),
            h("td", { class: "fs-muted" }, n.updated ? new Date(n.updated).toLocaleString("ru-RU") : ""),
            h("td", {}, btn("Удалить", async () => {
              if (!confirm(`Удалить заметку о ${n.name || id}?`)) return;
              delete notes[id];
              await store.set({ notes });
              draw();
            }, "fs-danger"))));
        }
      };
      q.addEventListener("input", draw);
      const file = h("input", { type: "file", accept: "application/json", hidden: true, onchange: async (e) => {
        const f = e.target.files[0];
        e.target.value = "";
        if (!f) return;
        try {
          const data = JSON.parse(await f.text());
          const ids = Object.keys(data).filter((k) => /^\d+$/.test(k));
          for (const k of ids) notes[k] = { ...notes[k], ...data[k] };
          await store.set({ notes });
          draw();
          toast(`Импортировано заметок: ${ids.length}`);
        } catch (err) { toast("Не удалось импортировать: " + err.message); }
      } });
      m.append(h("div", { class: "fs-row" }, q,
        btn("Экспорт", () => download(`funpay_notes_${today()}.json`, notes)),
        btn("Импорт", () => file.click()), file),
        h("table", { class: "fs-table" }, h("thead", {}, h("tr", {}, h("th", {}), h("th", {}, "Пользователь"), h("th", {}, "Заметка"), h("th", {}, "Изменена"), h("th", {}))), tbody));
      draw();
    }

    function renderInfo(m) {
      const file = h("input", { type: "file", accept: "application/json", hidden: true, onchange: async (e) => {
        const f = e.target.files[0];
        e.target.value = "";
        if (!f) return;
        try {
          const data = JSON.parse(await f.text());
          if (data.settings) S = T.merge(T.DEFAULTS, data.settings);
          if (data.notes) notes = data.notes;
          await store.set({ settings: S, notes });
          paintScope();
          render();
          toast("Настройки загружены");
        } catch (err) { toast("Не удалось загрузить: " + err.message); }
      } });
      m.append(h("div", { class: "fs-h" }, "О расширении"),
        h("p", {}, "FunPay Helper — собственное расширение для продавца FunPay. Всё хранится локально в этом браузере, никакие данные никуда не отправляются."),
        h("p", { class: "fs-muted" }, "Расширение обновляется само: при изменении файлов в папке оно перезагружается в течение 30 секунд."),
        h("div", { class: "fs-h" }, "Резервная копия"),
        h("p", { class: "fs-muted" }, "Настройки и заметки в одном файле — для переноса на другой компьютер. Загруженный фон в файл не входит."),
        h("div", { class: "fs-row" },
          btn("Сохранить в файл", () => download(`funpay_helper_${today()}.json`, { settings: S, notes })),
          btn("Загрузить из файла", () => file.click()), file,
          btn("Сбросить настройки", async () => {
            if (!confirm("Сбросить настройки к стандартным? Заметки останутся.")) return;
            S = T.merge(T.DEFAULTS, {});
            await store.set({ settings: S });
            paintScope();
            render();
          }, "fs-danger")));
    }

    const today = () => new Date().toISOString().slice(0, 10);
    function download(name, data) {
      const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })), download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    const onStorage = (ch, area) => {
      if (area === "local" && ch.notes) { notes = ch.notes.newValue || {}; if (section === "buyers") render(); }
    };
    (async () => {
      try { section = localStorage.getItem("fph-section") || section; } catch (e) {}
      if (!SECTIONS.some((s) => s.id === section)) section = "theme";
      const r = await store.get(["settings", "notes"]);
      S = T.merge(T.DEFAULTS, r.settings);
      notes = r.notes || {};
      paintScope();
      render();
      chrome.storage.onChanged.addListener(onStorage);
    })();
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }

  return { mount };
})();
