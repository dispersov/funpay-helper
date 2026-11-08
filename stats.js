// Статистика продаж (/orders/trade) и покупок (/orders/) — встроенный блок на странице.
// Заказы кэшируются в chrome.storage.local (по аккаунту), при открытии страницы догружаются только новые.
FPH.settings.then((SET) => {
  const SALES = /^\/orders\/trade\/?$/.test(location.pathname);
  const PURCH = /^\/orders\/?$/.test(location.pathname);
  if (!(SALES && SET.features.salesStats) && !(PURCH && SET.features.purchaseStats)) return;
  const PAGE = SALES ? "/orders/trade" : "/orders/";
  const fee = (Number(SET.custom.withdrawFee) || 0) / 100;
  const { el, parseNumber, currencyOf, fmtMoney, sleep, fetchDoc, appData } = FPH;
  const userId = String(appData().userId || "0");
  const CACHE = (SALES ? "sales_" : "purchases_") + userId;
  let PAGE_DELAY = 1000; // после ответов 429 увеличивается до 4 с, чтобы реже упираться в лимит FunPay

  const MONTHS = {
    января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5, июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11,
    січня: 0, лютого: 1, березня: 2, квітня: 3, травня: 4, червня: 5, липня: 6, серпня: 7, вересня: 8, жовтня: 9, листопада: 10, грудня: 11,
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  const STATUS = {
    closed: { name: "Закрыт", icon: "✓", color: "#30a46c" },
    paid: { name: "Ожидает", icon: "◷", color: "var(--fph-accent, #d4a514)" },
    refunded: { name: "Возврат", icon: "↩", color: "#e5484d" },
  };

  // ---------- Разбор страницы продаж ----------
  function parseDate(text) {
    const t = text.trim().toLowerCase();
    const now = new Date();
    const [dayPart, timePart = "00:00"] = t.split(", ");
    const [h, m] = timePart.split(":").map(Number);
    let d;
    if (/сегодня|сьогодні|today/.test(dayPart)) d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    else if (/вчера|вчора|yesterday/.test(dayPart)) d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    else {
      const [day, month, year] = dayPart.split(/\s+/);
      d = new Date(year ? Number(year) : now.getFullYear(), MONTHS[month] ?? 0, Number(day));
      if (!year && d > now) d.setFullYear(d.getFullYear() - 1);
    }
    d.setHours(h || 0, m || 0);
    return d.getTime();
  }

  // Убираем из описания трейд-ссылки и количество — иначе каждая продажа считается отдельным лотом.
  const cleanDesc = (s) => s.replace(/,?\s*https?:\/\/\S+/g, "").replace(/,\s*\d+\s*шт\.?\s*$/i, "").replace(/\s+/g, " ").trim();

  // Короткое понятное имя лота: без рекламных блоков «【 ⚡ АВТОВЫДАЧА / В НАЛИЧИИ 】», эмодзи и скобок.
  const PROMO = /автовыдач|в\s*наличии|24\s*\/\s*7|мгновенн|моментальн|быстр|скидк|акци|гарант|лучш|дешев|онлайн|auto/i;
  const lotCache = new Map();
  function lotName(desc) {
    if (lotCache.has(desc)) return lotCache.get(desc);
    let t = desc
      .replace(/[【\[]([^】\]]*)[】\]]/g, (m, inner) => (PROMO.test(inner) ? " " : ` ${inner} `))
      .replace(/[\p{Extended_Pictographic}☀-➿️‍]/gu, " ")
      .replace(/\s*([—–|\/])\s*(?=[—–|\/,]|$)/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\s+,/g, ",")
      .replace(/^[\s,.;:—–|\/-]+|[\s,.;:—–|\/-]+$/g, "")
      .trim();
    if (!t) t = desc;
    lotCache.set(desc, t);
    return t;
  }

  function parseOrders(doc) {
    return [...doc.querySelectorAll("a.tc-item")].map((a) => {
      const priceText = a.querySelector(".tc-price")?.textContent || "";
      const buyerEl = a.querySelector(".media-user-name span[data-href], .media-user-name");
      const qty = /(\d+)\s*шт/i.exec(a.querySelector(".order-desc > div")?.textContent || "");
      return {
        id: (a.querySelector(".tc-order")?.textContent || "").trim().replace(/^#/, ""),
        desc: cleanDesc(a.querySelector(".order-desc > div")?.textContent || ""),
        qty: qty ? Number(qty[1]) : 1,
        cat: (a.querySelector(".order-desc .text-muted, .text-muted")?.textContent || "").trim(),
        buyer: (buyerEl?.textContent || "").trim(),
        buyerId: ((buyerEl?.getAttribute("data-href") || "").match(/users\/(\d+)/) || [])[1] || "",
        price: parseNumber(priceText),
        cur: currencyOf(priceText),
        date: parseDate(a.querySelector(".tc-date-time")?.textContent || ""),
        status: a.classList.contains("warning") ? "refunded" : a.classList.contains("info") ? "paid" : "closed",
      };
    }).filter((o) => o.id);
  }

  // ---------- Кэш ----------
  let cache = { orders: {}, updated: 0, complete: false };
  const loadCache = async () => { cache = (await chrome.storage.local.get(CACHE))[CACHE] || cache; };
  const saveCache = () => chrome.storage.local.set({ [CACHE]: cache });

  let loading = false;
  let lastError = "";
  async function refresh(full = false) {
    if (loading) return;
    loading = true;
    lastError = "";
    ui.setBusy(true);
    try {
      const known = cache.orders;
      const pendingDates = Object.values(known).filter((o) => o.status === "paid").map((o) => o.date);
      // Догружаем, пока не дойдём до заказов, которые уже точно не изменятся.
      // Свежие 3 дня перечитываем всегда; «Оплаченные» заказы — только за последние 14 дней,
      // иначе один старый неподтверждённый заказ заставлял бы каждый раз листать всю историю.
      const recentPending = pendingDates.filter((d) => d > Date.now() - 14 * 864e5);
      const stopAt = Math.min(Date.now() - 3 * 864e5, ...recentPending);
      const wait = (s) => { PAGE_DELAY = Math.min(4000, Math.round(PAGE_DELAY * 1.5)); ui.status(`FunPay просит не спешить — жду ${s} с и продолжаю…`); };
      const next = (cont) => fetchDoc(PAGE, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest" },
        body: new URLSearchParams({ continue: cont }).toString(),
      }, wait);
      let seen = 0, page = 0;
      // Проход по страницам. mode "top" — свежие заказы сверху, пока не дойдём до известных;
      // mode "deep" — догрузка старой истории (с места, где остановились в прошлый раз).
      const walk = async (doc, mode) => {
        while (true) {
          page++;
          const orders = parseOrders(doc);
          let allKnown = true;
          for (const o of orders) {
            if (!known[o.id]) allKnown = false;
            known[o.id] = o;
          }
          seen += orders.length;
          ui.status(`Загрузка: страница ${page}, заказов ${seen}${mode === "deep" ? " (старая история)" : ""}…`);
          const cont = doc.querySelector('input[type="hidden"][name="continue"]')?.value;
          const oldest = orders[orders.length - 1]?.date || 0;
          // Запоминаем, докуда дошли, чтобы после перерыва продолжить, а не начинать заново.
          if (mode === "deep" || (!cache.complete && !hadCursor)) cache.cursor = cont || "";
          if (!cont || !orders.length) { if (mode === "deep" || !cache.cursor) { cache.complete = true; cache.cursor = ""; } return; }
          if (mode === "top" && allKnown && oldest < stopAt && (cache.complete || cache.cursor)) return;
          if (page % 3 === 0) await saveCache(); // сохраняем по ходу: загрузку может прервать перезагрузка страницы
          await sleep(PAGE_DELAY);
          doc = await next(cont);
        }
      };
      if (full) { cache.complete = false; cache.cursor = ""; }
      const hadCursor = !!cache.cursor;
      await walk(await fetchDoc(PAGE, {}, wait), "top");
      if (!cache.complete && cache.cursor) {
        await sleep(PAGE_DELAY);
        await walk(await next(cache.cursor), "deep");
      }
      cache.updated = Date.now();
      await saveCache();
    } catch (e) {
      lastError = "Ошибка загрузки: " + e.message;
      try { await saveCache(); } catch (e2) {}
      loading = false;
      ui.setBusy(false);
      ui.render();
      return;
    }
    loading = false;
    ui.setBusy(false);
    ui.render();
  }

  // ---------- Периоды ----------
  const PERIODS = {
    today: "Сегодня", yesterday: "Вчера", d7: "7 дней", d30: "30 дней", month: "Этот месяц", prev: "Прошлый месяц", d90: "90 дней", all: "Всё время",
  };
  function range(p) {
    const n = new Date();
    const day = (k) => new Date(n.getFullYear(), n.getMonth(), n.getDate() + k).getTime();
    switch (p) {
      case "today": return [day(0), Infinity];
      case "yesterday": return [day(-1), day(0)];
      case "d7": return [day(-6), Infinity];
      case "d30": return [day(-29), Infinity];
      case "d90": return [day(-89), Infinity];
      case "month": return [new Date(n.getFullYear(), n.getMonth(), 1).getTime(), Infinity];
      case "prev": return [new Date(n.getFullYear(), n.getMonth() - 1, 1).getTime(), new Date(n.getFullYear(), n.getMonth(), 1).getTime()];
      default: return [0, Infinity];
    }
  }

  // ---------- Расчёты ----------
  const sum = (list) => list.reduce((a, o) => a + o.price, 0);
  function group(list, key) {
    const map = new Map();
    for (const o of list) {
      const k = key(o) || "—";
      const g = map.get(k) || { key: k, count: 0, sum: 0 };
      g.count++; g.sum += o.price;
      map.set(k, g);
    }
    return [...map.values()].sort((a, b) => b.sum - a.sum);
  }
  const dayKey = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const monthKey = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };

  // ---------- Интерфейс ----------
  const pref = (k, d) => { try { return localStorage.getItem("fph-stats-" + k) || d; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem("fph-stats-" + k, v); } catch (e) {} };
  let period = pref("period", "d30");
  let tab = pref("tab", "cards");
  let collapsed = pref("collapsed", "0") === "1";

  const statusEl = el("span", { class: "fph-muted" });
  const body = el("div", { class: "fph-sec-body" });
  const periodSel = el("select", { class: "fph-input fph-inline", onchange: () => { period = periodSel.value; setPref("period", period); ui.render(); } },
    Object.entries(PERIODS).map(([k, v]) => el("option", { value: k }, v)));
  periodSel.value = period;
  const refreshBtn = el("button", { class: "fph-btn", onclick: () => refresh(false) }, "Обновить данные");
  const tabsEl = el("div", { class: "fph-tabs" });
  const TABS = { cards: "Карточки", charts: "Графики", diagrams: "Диаграммы", tops: "ТОП-списки", all: "Все данные" };
  const collapseBtn = el("button", { class: "fph-btn fph-btn-ghost", title: "Свернуть", onclick: () => {
    collapsed = !collapsed; setPref("collapsed", collapsed ? "1" : "0"); ui.render();
  } });

  const section = el("section", { class: "fph-sec", id: "fph-stats" },
    el("div", { class: "fph-sec-head" },
      el("h2", { class: "fph-sec-title" }, "Статистика"),
      el("div", { class: "fph-row fph-sec-tools" },
        el("button", { class: "fph-btn fph-btn-ok", onclick: exportCsv }, "Экспорт"),
        SALES ? el("button", { class: "fph-btn fph-btn-primary", onclick: copyUnconfirmed }, "Скопировать неподтверждённые") : null,
        refreshBtn, periodSel, collapseBtn)),
    el("div", { class: "fph-row" }, statusEl),
    tabsEl, body);

  const anchor = document.querySelector('select[name="state"]')?.closest("form")
    || document.querySelector(".page-header, h1");
  if (anchor) anchor.after(section); else document.querySelector("#content, body").prepend(section);

  const tip = el("div", { class: "fph-tip" });
  document.body.append(tip);
  const showTip = (e, html) => {
    tip.innerHTML = html;
    tip.style.display = "block";
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + "px";
    tip.style.top = e.clientY + 14 + "px";
  };
  const hideTip = () => { tip.style.display = "none"; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const ui = {
    setBusy(b) { refreshBtn.disabled = b; refreshBtn.textContent = b ? "Загрузка…" : "Обновить данные"; },
    status(text, err) { statusEl.textContent = text; statusEl.classList.toggle("fph-err", !!err); },
    render() {
      collapseBtn.textContent = collapsed ? "▸" : "▾";
      tabsEl.style.display = body.style.display = collapsed ? "none" : "";
      const all = Object.values(cache.orders);
      if (!loading) {
        if (lastError) ui.status(lastError, true);
        else ui.status(cache.updated
          ? `В базе ${all.length.toLocaleString("ru-RU")} заказов · обновлено ${new Date(cache.updated).toLocaleString("ru-RU")}${cache.complete ? "" : " · история загружена не полностью"}`
          : "Данных пока нет");
      }
      tabsEl.textContent = "";
      for (const [k, v] of Object.entries(TABS)) {
        tabsEl.append(el("button", { class: "fph-tab" + (k === tab ? " fph-on" : ""), onclick: () => { tab = k; setPref("tab", k); ui.render(); } }, v));
      }
      if (collapsed) return;
      const [from, to] = range(period);
      const list = all.filter((o) => o.date >= from && o.date < to).sort((a, b) => b.date - a.date);
      body.textContent = "";
      if (!list.length) {
        body.append(el("p", { class: "fph-muted" }, loading ? "Загружаю заказы…" : "За выбранный период заказов нет."));
        return;
      }
      ({ cards, charts, diagrams, tops, all: table })[tab](list);
    },
  };

  const curOf = (list) => list.find((o) => o.cur)?.cur || "₽";

  function cards(list) {
    const cur = curOf(list);
    const by = (s) => list.filter((o) => o.status === s);
    const closed = by("closed"), paid = by("paid"), refunded = by("refunded");
    const sold = [...closed, ...paid];
    const done = closed.length + refunded.length;
    const buyers = new Set(list.map((o) => o.buyerId || o.buyer)).size;
    const card = (cls, ico, title, value, sub) => el("div", { class: "fph-card " + cls },
      el("div", { class: "fph-card-ico" }, ico),
      el("div", {}, el("div", { class: "fph-muted" }, title), el("div", { class: "fph-big" }, value, sub ? el("span", { class: "fph-sub" }, " " + sub) : null)));
    body.append(el("div", { class: "fph-cards" },
      card("fph-card-wide fph-card-money", "💰", SALES ? "Всего заработано" : "Всего потрачено", fmtMoney(sum(closed), cur)),
      card("", "📦", "Всего заказов", list.length.toLocaleString("ru-RU")),
      card("", "🏷", "Средний чек", fmtMoney(closed.length ? sum(closed) / closed.length : 0, cur)),
      card("", "✓", "Закрыто", closed.length.toLocaleString("ru-RU"), `(${fmtMoney(sum(closed), cur)})`),
      card("", "◷", "В ожидании", paid.length.toLocaleString("ru-RU"), `(${fmtMoney(sum(paid), cur)})`),
      card("", "↩", "Возвраты", refunded.length.toLocaleString("ru-RU"), `(${fmtMoney(sum(refunded), cur)} · ${done ? Math.round((refunded.length / done) * 100) : 0}%)`),
      card("", "👥", SALES ? "Уникальных покупателей" : "Уникальных продавцов", buyers.toLocaleString("ru-RU")),
      SALES ? profitCard(closed, cur, card) : null));
    const topBuyer = group(sold, (o) => o.buyer).sort((a, b) => b.count - a.count)[0];
    const maxSale = sold.reduce((m, o) => (o.price > (m?.price || 0) ? o : m), null);
    const topLot = group(sold, (o) => lotName(o.desc)).sort((a, b) => b.count - a.count)[0];
    const topCat = group(sold, (o) => o.cat).sort((a, b) => b.count - a.count)[0];
    const fact = (ico, label, value) => value ? el("div", { class: "fph-fact" }, el("span", {}, ico), el("span", { class: "fph-muted" }, label + ":"), el("b", {}, value)) : null;
    body.append(el("div", { class: "fph-facts" },
      fact("🏆", SALES ? "Самый активный покупатель" : "Чаще всего покупали у", topBuyer && `${topBuyer.key} (${topBuyer.count})`),
      fact("💎", "Самая дорогая продажа", maxSale && fmtMoney(maxSale.price, cur)),
      fact("🔥", "Самый популярный товар", topLot && `${topLot.key} (${topLot.count})`),
      fact("🎮", "Самая популярная категория", topCat && `${topCat.key} (${topCat.count})`)));
  }

  // Столбчатый график одного ряда: выручка или число заказов по дням/месяцам.
  function barChart(title, points, fmt) {
    const W = 860, H = 220, L = 8, R = 8, T = 16, B = 26;
    const max = Math.max(...points.map((p) => p.v), 1);
    const slot = (W - L - R) / points.length;
    const bw = Math.max(2, Math.min(28, slot - 2));
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "fph-chart");
    const add = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.append(n); return n; };
    for (const f of [0.5, 1]) add("line", { x1: L, x2: W - R, y1: T + (H - T - B) * (1 - f), y2: T + (H - T - B) * (1 - f), class: "fph-grid" });
    add("line", { x1: L, x2: W - R, y1: H - B, y2: H - B, class: "fph-axis" });
    const maxLbl = add("text", { x: W - R, y: T - 4, "text-anchor": "end", class: "fph-tick" });
    maxLbl.textContent = fmt(max);
    const every = Math.ceil(points.length / 10);
    points.forEach((p, i) => {
      const x = L + i * slot + (slot - bw) / 2;
      const h = ((H - T - B) * p.v) / max;
      if (p.v > 0) {
        const r = Math.min(4, bw / 2, h);
        add("path", { class: "fph-bar", d: `M${x},${H - B} V${H - B - h + r} Q${x},${H - B - h} ${x + r},${H - B - h} H${x + bw - r} Q${x + bw},${H - B - h} ${x + bw},${H - B - h + r} V${H - B} Z` });
      }
      const hit = add("rect", { x: L + i * slot, y: T, width: slot, height: H - T - B, class: "fph-hit" });
      hit.addEventListener("mousemove", (e) => showTip(e, `<b>${esc(p.label)}</b><br>${esc(fmt(p.v))}`));
      hit.addEventListener("mouseleave", hideTip);
      if (i % every === 0) {
        const t = add("text", { x: L + i * slot + slot / 2, y: H - 8, "text-anchor": "middle", class: "fph-tick" });
        t.textContent = p.short;
      }
    });
    return el("div", { class: "fph-chart-box" }, el("div", { class: "fph-chart-title" }, title), svg);
  }

  function series(list) {
    const monthly = period === "all";
    const keyFn = monthly ? monthKey : dayKey;
    const [from0, to0] = range(period);
    const from = from0 || Math.min(...list.map((o) => o.date));
    const map = new Map();
    for (const o of list) {
      if (o.status === "refunded") continue;
      const k = keyFn(o.date);
      const g = map.get(k) || { sum: 0, count: 0 };
      g.sum += o.price; g.count++;
      map.set(k, g);
    }
    const out = [];
    const end = Math.min(Date.now(), to0 - 1);
    const d = new Date(keyFn(from));
    while (d.getTime() <= end && out.length < 400) {
      const k = d.getTime();
      const g = map.get(k) || { sum: 0, count: 0 };
      out.push({
        sum: g.sum, count: g.count,
        label: monthly ? d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" }) : d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "short" }),
        short: monthly ? d.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" }) : d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
      });
      if (monthly) d.setMonth(d.getMonth() + 1); else d.setDate(d.getDate() + 1);
    }
    return { monthly, points: out };
  }

  function charts(list) {
    const cur = curOf(list);
    const { monthly, points } = series(list);
    const unit = monthly ? "по месяцам" : "по дням";
    body.append(
      barChart(`Выручка ${unit} (закрытые и ожидающие)`, points.map((p) => ({ ...p, v: p.sum })), (v) => fmtMoney(v, cur)),
      barChart(`Заказов ${unit}`, points.map((p) => ({ ...p, v: p.count })), (v) => v.toLocaleString("ru-RU")));
  }

  function hbars(title, rows, fmt, colorFn) {
    const max = Math.max(...rows.map((r) => r.v), 1);
    return el("div", { class: "fph-chart-box" }, el("div", { class: "fph-chart-title" }, title),
      rows.map((r) => el("div", { class: "fph-hrow" },
        el("div", { class: "fph-hlabel", title: r.label }, r.icon ? r.icon + " " : "", r.label),
        el("div", { class: "fph-htrack" }, el("div", { class: "fph-hbar", style: `width:${Math.max(0.5, (r.v / max) * 100)}%;${colorFn ? "background:" + colorFn(r) : ""}` })),
        el("div", { class: "fph-hval" }, fmt(r)))));
  }

  function diagrams(list) {
    const cur = curOf(list);
    const total = list.length;
    const st = Object.entries(STATUS).map(([k, s]) => {
      const l = list.filter((o) => o.status === k);
      return { label: s.name, icon: s.icon, color: s.color, v: l.length, s: sum(l) };
    });
    body.append(hbars("Статусы заказов", st, (r) => `${r.v} · ${Math.round((r.v / total) * 100)}% · ${fmtMoney(r.s, cur)}`, (r) => r.color));
    const sold = list.filter((o) => o.status !== "refunded");
    const soldSum = sum(sold) || 1;
    const cats = group(sold, (o) => o.cat);
    const top = cats.slice(0, 9).map((g) => ({ label: g.key, v: g.sum, c: g.count }));
    const rest = cats.slice(9);
    if (rest.length) top.push({ label: `Остальные (${rest.length})`, v: rest.reduce((a, g) => a + g.sum, 0), c: rest.reduce((a, g) => a + g.count, 0) });
    body.append(hbars("Выручка по категориям", top, (r) => `${fmtMoney(r.v, cur)} · ${Math.round((r.v / soldSum) * 100)}%`));
    const byHour = Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, "0")}:00`, short: String(h), v: 0 }));
    for (const o of sold) byHour[new Date(o.date).getHours()].v++;
    body.append(barChart("Продажи по часам суток", byHour, (v) => `${v} заказов`));
  }

  function topTable(title, rows, cur, link, cls = "") {
    return el("div", { class: "fph-chart-box " + cls }, el("div", { class: "fph-chart-title" }, title),
      el("table", { class: "fph-table" },
        el("thead", {}, el("tr", {}, el("th", {}, "#"), el("th", {}, "Название"), el("th", {}, "Продаж"), el("th", {}, "Сумма"))),
        el("tbody", {}, rows.map((g, i) => el("tr", {},
          el("td", { class: "fph-muted" }, i + 1),
          el("td", { title: g.key }, link ? link(g) : g.key),
          el("td", {}, g.count.toLocaleString("ru-RU")),
          el("td", {}, fmtMoney(g.sum, cur)))))));
  }

  function tops(list) {
    const cur = curOf(list);
    const sold = list.filter((o) => o.status !== "refunded");
    const buyerIds = Object.fromEntries(sold.map((o) => [o.buyer, o.buyerId]));
    body.append(el("div", { class: "fph-tops" },
      topTable("Топ лотов", group(sold, (o) => lotName(o.desc)).slice(0, 15), cur, null, "fph-wide"),
      topTable("Топ категорий", group(sold, (o) => o.cat).slice(0, 15), cur),
      topTable(SALES ? "Топ покупателей" : "Топ продавцов", group(sold, (o) => o.buyer).slice(0, 15), cur,
        (g) => buyerIds[g.key] ? el("a", { href: `/users/${buyerIds[g.key]}/`, target: "_blank" }, g.key) : g.key)));
  }

  let tableQuery = "", tableStatus = "", tablePage = 0;
  function table(list) {
    const cur = curOf(list);
    const q = el("input", { class: "fph-input fph-inline", type: "search", placeholder: "Поиск: заказ, покупатель, лот", value: tableQuery, style: "min-width:260px" });
    const s = el("select", { class: "fph-input fph-inline" }, el("option", { value: "" }, "Все статусы"),
      Object.entries(STATUS).map(([k, v]) => el("option", { value: k }, v.name)));
    s.value = tableStatus;
    const holder = el("div");
    const draw = () => {
      const qq = tableQuery.toLowerCase();
      const rows = list.filter((o) => (!tableStatus || o.status === tableStatus) &&
        (!qq || o.id.toLowerCase().includes(qq) || o.buyer.toLowerCase().includes(qq) || o.desc.toLowerCase().includes(qq) || o.cat.toLowerCase().includes(qq)));
      const per = 50, pages = Math.max(1, Math.ceil(rows.length / per));
      tablePage = Math.min(tablePage, pages - 1);
      holder.textContent = "";
      holder.append(el("table", { class: "fph-table" },
        el("thead", {}, el("tr", {}, ["Заказ", "Дата", SALES ? "Покупатель" : "Продавец", "Лот", "Категория", "Статус", "Сумма"].map((t) => el("th", {}, t)))),
        el("tbody", {}, rows.slice(tablePage * per, tablePage * per + per).map((o) => el("tr", {},
          el("td", {}, el("a", { href: `/orders/${o.id}/`, target: "_blank" }, "#" + o.id)),
          el("td", { class: "fph-nowrap" }, new Date(o.date).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })),
          el("td", {}, o.buyerId ? el("a", { href: `/users/${o.buyerId}/`, target: "_blank" }, o.buyer) : o.buyer),
          el("td", { class: "fph-wrap", title: o.desc }, lotName(o.desc)),
          el("td", { class: "fph-muted" }, o.cat),
          el("td", { class: "fph-nowrap" }, el("span", { class: "fph-status", style: `--c:${STATUS[o.status].color}` }, STATUS[o.status].icon + " " + STATUS[o.status].name)),
          el("td", { class: "fph-nowrap" }, fmtMoney(o.price, cur)))))),
        el("div", { class: "fph-row" },
          el("button", { class: "fph-btn", disabled: tablePage === 0 ? "" : null, onclick: () => { tablePage--; draw(); } }, "←"),
          el("span", { class: "fph-muted" }, `Стр. ${tablePage + 1} из ${pages} · найдено ${rows.length}`),
          el("button", { class: "fph-btn", disabled: tablePage >= pages - 1 ? "" : null, onclick: () => { tablePage++; draw(); } }, "→")));
    };
    q.addEventListener("input", () => { tableQuery = q.value.trim(); tablePage = 0; draw(); });
    s.addEventListener("change", () => { tableStatus = s.value; tablePage = 0; draw(); });
    body.append(el("div", { class: "fph-row" }, q, s), holder);
    draw();
  }

  // ---------- Экспорт и неподтверждённые ----------
  function exportCsv() {
    const [from, to] = range(period);
    const list = Object.values(cache.orders).filter((o) => o.date >= from && o.date < to).sort((a, b) => b.date - a.date);
    if (!list.length) return ui.status("Нечего выгружать за этот период.");
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Заказ", "Дата", "Статус", SALES ? "Покупатель" : "Продавец", SALES ? "ID покупателя" : "ID продавца", "Лот", "Кол-во", "Категория", "Сумма", "Валюта"].map(cell).join(";")];
    for (const o of list) {
      lines.push([o.id, new Date(o.date).toLocaleString("ru-RU"), STATUS[o.status].name, o.buyer, o.buyerId, o.desc, o.qty, o.cat,
        String(o.price).replace(".", ","), o.cur].map(cell).join(";"));
    }
    const a = el("a", { href: URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" })), download: `funpay_${SALES ? "sales" : "purchases"}_${period}_${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function copyUnconfirmed() {
    await refresh(false);
    const ids = Object.values(cache.orders).filter((o) => o.status === "paid").sort((a, b) => a.date - b.date).map((o) => "#" + o.id);
    if (!ids.length) return ui.status("Неподтверждённых заказов нет.");
    await navigator.clipboard.writeText(ids.join("\n"));
    ui.status(`Скопировано неподтверждённых: ${ids.length}`);
  }

  // ---------- Себестоимость и чистая прибыль ----------
  // Себестоимость задаётся в редактировании лота и привязана к названию лота: заказ подходит,
  // если его описание начинается с этого названия.
  let costList = [];
  const norm = (t) => lotName(String(t || "")).toLowerCase().replace(/\s+/g, " ").trim();
  async function loadCosts() {
    const all = (await chrome.storage.local.get("fphCosts")).fphCosts || {};
    costList = Object.values(all).filter((c) => c.title && c.cost >= 0).map((c) => ({ key: norm(c.title), cost: c.cost }))
      .filter((c) => c.key).sort((a, b) => b.key.length - a.key.length);
  }
  function costOf(o) {
    const d = norm(o.desc);
    const hit = costList.find((c) => d.startsWith(c.key) || d.includes(c.key));
    return hit ? hit.cost * (o.qty || 1) : null;
  }
  const profitOf = (o) => { const c = costOf(o); return c == null ? null : o.price * (1 - fee) - c; };
  function profitCard(closed, cur, card) {
    if (!costList.length) return null;
    const known = closed.map(profitOf).filter((v) => v != null);
    if (!known.length) return null;
    const total = known.reduce((a, v) => a + v, 0);
    return card("fph-card-profit", "📈", "Чистая прибыль", fmtMoney(total, cur), `(по ${known.length} из ${closed.length} заказов)`);
  }
  function annotateRows() {
    if (!SALES || !costList.length) return;
    for (const a of document.querySelectorAll("a.tc-item")) {
      if (a.querySelector(".fph-profit") || a.closest("#fph-stats")) continue;
      const o = parseOrders({ querySelectorAll: () => [a] })[0];
      const p = o && profitOf(o);
      if (p == null) continue;
      a.querySelector(".tc-price")?.append(el("div", { class: "fph-profit " + (p >= 0 ? "fph-ok" : "fph-err") }, (p >= 0 ? "+" : "") + fmtMoney(Math.round(p * 100) / 100, o.cur || "₽")));
    }
  }

  // ---------- Старт ----------
  (async () => {
    await loadCosts();
    annotateRows();
    await loadCache();
    ui.render();
    if (new URLSearchParams(location.search).get("fph") === "stats") section.scrollIntoView({ behavior: "smooth" });
    // Автообновление при открытии — не чаще раза в 10 минут (и если история догружена). Кнопка «Обновить данные» работает всегда.
    if (!cache.complete || Date.now() - (cache.updated || 0) > 10 * 60e3) refresh(false);
  })();
});
