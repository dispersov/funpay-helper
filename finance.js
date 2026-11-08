// Финансы и мелочи по заказам: скрытие баланса, «доступно для вывода», статистика и экспорт операций
// на странице /account/balance, копирование номера на странице заказа.
FPH.settings.then((S) => {
  const F = S.features;
  const { el, parseNumber, fmtMoney, sleep, fetchRetry, myId, toast, copyText, XHR } = FPH;
  const root = document.documentElement;
  const path = location.pathname;

  // ---------- Скрыть баланс (на всех страницах) ----------
  root.classList.toggle("fph-hide-balance", !!F.hideBalance);
  if (F.hideBalance) {
    document.addEventListener("click", (e) => {
      const b = e.target.closest(".badge-balance, .balances-value, .fph-balance-sensitive");
      if (b && !b.classList.contains("fph-revealed")) { e.preventDefault(); e.stopPropagation(); b.classList.add("fph-revealed"); }
    }, true);
  }

  // ---------- Страница заказа: копирование номера ----------
  const orderMatch = path.match(/^\/orders\/([A-Z0-9]{6,})\/?$/i);
  if (orderMatch && F.copyOrderId) {
    const id = orderMatch[1];
    const h1 = document.querySelector("h1");
    if (h1) h1.append(el("button", { type: "button", class: "fph-copy-id", title: "Скопировать номер заказа", onclick: async () => {
      await copyText("#" + id);
      toast(`Номер заказа #${id} скопирован`);
    } }, "⧉"));
  }

  if (!/^\/account\/balance\/?$/.test(path)) return;

  // ---------- Операции по балансу ----------
  const MONTHS = { января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5, июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11 };
  function parseDate(text) {
    const t = String(text || "").trim().toLowerCase();
    const now = new Date();
    const [dayPart, timePart = "00:00"] = t.split(", ");
    const [h, m] = timePart.split(":").map(Number);
    let d;
    if (/сегодня|today/.test(dayPart)) d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    else if (/вчера|yesterday/.test(dayPart)) d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    else {
      const [day, month, year] = dayPart.split(/\s+/);
      d = new Date(year ? Number(year) : now.getFullYear(), MONTHS[month] ?? 0, Number(day));
      if (!year && d > now) d.setFullYear(d.getFullYear() - 1);
    }
    d.setHours(h || 0, m || 0);
    return d.getTime();
  }
  const typeOf = (title) => title.replace(/#\S+/g, "").replace(/\s+/g, " ").trim() || "Прочее";
  function parseRows(doc) {
    return [...doc.querySelectorAll(".tc-item")].map((it) => {
      const title = (it.querySelector(".tc-title")?.textContent || "").trim();
      const priceText = (it.querySelector(".tc-price")?.textContent || "").replace(/ /g, " ");
      let amount = Math.abs(parseNumber(priceText));
      if (!isFinite(amount)) return null;
      const neg = /[−-]\s*\d/.test(priceText) || (!/\+\s*\d/.test(priceText) && /вывод|покупк|оплат|списан/i.test(title));
      if (neg) amount = -amount;
      const cls = it.className;
      return {
        id: String(it.getAttribute("data-transaction") || title + priceText),
        title, type: typeOf(title), amount,
        date: parseDate(it.querySelector(".tc-date-time")?.textContent),
        status: /complete/.test(cls) ? "complete" : /cancel/.test(cls) ? "cancel" : "waiting",
        statusText: (it.querySelector(".tc-status")?.textContent || "").trim(),
      };
    }).filter(Boolean);
  }
  const balanceNow = () => {
    for (const v of document.querySelectorAll("span.balances-value")) if (/₽/.test(v.textContent)) return parseNumber(v.textContent);
    return parseNumber(document.querySelector(".badge-balance")?.textContent);
  };

  const CACHE = "finance_" + myId();
  let cache = { rows: {}, updated: 0, complete: false };
  let salesOrders = {}; // заказы из статистики продаж — для разбивки по категориям
  let periodCancelledOrders = [];
  async function load(full) {
    cache = (await chrome.storage.local.get(CACHE))[CACHE] || cache;
    let doc = document, page = 0;
    while (true) {
      page++;
      const rows = parseRows(doc);
      let allKnown = rows.length > 0;
      for (const r of rows) { if (!cache.rows[r.id]) allKnown = false; cache.rows[r.id] = r; }
      status.textContent = `Загрузка операций: страница ${page}…`;
      const cont = doc.querySelector('input[name="continue"]')?.value;
      if (!cont || !rows.length) { cache.complete = true; break; }
      if (!full && cache.complete && allKnown && page >= 2) break;
      if (page >= 300) break;
      await sleep(1000);
      const r = await fetchRetry("/users/transactions", { method: "POST", headers: XHR, body: new URLSearchParams({ user_id: myId(), continue: cont, filter: "" }).toString() }, (w) => (status.textContent = `FunPay просит не спешить — жду ${w} с…`));
      if (!r.ok) throw new Error(r.status === 429 ? "FunPay просит подождать (429), попробуйте позже" : "HTTP " + r.status);
      doc = new DOMParser().parseFromString(await r.text(), "text/html");
    }
    cache.updated = Date.now();
    await chrome.storage.local.set({ [CACHE]: cache });
  }

  // ---------- Интерфейс: как статистика продаж — период, вкладки ----------
  const pref = (k, d) => { try { return localStorage.getItem("fph-fin-" + k) || d; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem("fph-fin-" + k, v); } catch (e) {} };
  const PERIODS = { today: "Сегодня", yesterday: "Вчера", d7: "7 дней", d30: "30 дней", month: "Этот месяц", prev: "Прошлый месяц", d90: "90 дней", all: "Всё время" };
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
  const TABS = { cards: "Карточки", charts: "Графики", cats: "Категории", ops: "Операции" };
  let period = pref("period", "d30"), tab = pref("tab", "cards");

  const status = el("span", { class: "fph-muted" });
  const top = el("div");
  const tabsEl = el("div", { class: "fph-tabs" });
  const body = el("div", { class: "fph-sec-body" });
  const periodSel = el("select", { class: "fph-input fph-inline", onchange: () => { period = periodSel.value; setPref("period", period); render(); } },
    Object.entries(PERIODS).map(([k, v]) => el("option", { value: k }, v)));
  periodSel.value = period;
  const section = el("section", { class: "fph-sec", id: "fph-finance" },
    el("div", { class: "fph-sec-head" },
      el("h2", { class: "fph-sec-title" }, "Статистика финансов"),
      el("div", { class: "fph-row fph-sec-tools" },
        F.financeExport ? el("button", { class: "fph-btn fph-btn-ok", onclick: () => exportRows("csv") }, "Экспорт Excel") : null,
        F.financeExport ? el("button", { class: "fph-btn", onclick: () => exportRows("json") }, "JSON") : null,
        el("button", { class: "fph-btn", onclick: () => run(false) }, "Обновить"),
        F.financeStats ? periodSel : null)),
    el("div", { class: "fph-row" }, status), top, F.financeStats ? tabsEl : null, F.financeStats ? body : null);
  const anchor = document.querySelector(".balances-list, .balances, h1");
  if (!F.withdrawInfo && !F.financeStats && !F.financeExport) return;
  const place = anchor?.closest(".balances, .page-header") || anchor;
  if (place) place.after(section); else (document.querySelector("#content") || document.body).prepend(section);

  // Подписи под цифрами не показываем — только название и сумма.
  const card = (ico, title, value, _sub, cls = "") => el("div", { class: "fph-card " + cls },
    el("div", { class: "fph-card-ico" }, ico),
    el("div", {}, el("div", { class: "fph-muted" }, title), el("div", { class: "fph-big fph-balance-sensitive" }, value)));
  const money = (v) => fmtMoney(Math.round(v * 100) / 100, "₽");
  const sum = (l) => l.reduce((a, r) => a + r.amount, 0);
  const isOrder = (r) => /заказ/i.test(r.title);
  const isWithdraw = (r) => /вывод/i.test(r.title) && !/отмена/i.test(r.title);

  // Всплывающая подсказка для графиков
  const tip = el("div", { class: "fph-tip" });
  document.body.append(tip);
  const showTip = (e, html) => { tip.innerHTML = html; tip.style.display = "block"; tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px"; tip.style.top = e.clientY + 14 + "px"; };
  const hideTip = () => { tip.style.display = "none"; };

  function barChart(title, points, color) {
    const W = 860, H = 200, L = 8, R = 8, T = 16, B = 26;
    const max = Math.max(...points.map((p) => p.v), 1);
    const slot = (W - L - R) / Math.max(1, points.length);
    const bw = Math.max(2, Math.min(28, slot - 2));
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "fph-chart");
    const add = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.append(n); return n; };
    add("line", { x1: L, x2: W - R, y1: T + (H - T - B) / 2, y2: T + (H - T - B) / 2, class: "fph-grid" });
    add("line", { x1: L, x2: W - R, y1: H - B, y2: H - B, class: "fph-axis" });
    add("text", { x: W - R, y: T - 4, "text-anchor": "end", class: "fph-tick" }).textContent = money(max);
    const every = Math.ceil(points.length / 10);
    points.forEach((p, i) => {
      const x = L + i * slot + (slot - bw) / 2, h = ((H - T - B) * p.v) / max;
      if (p.v > 0) add("rect", { x, y: H - B - h, width: bw, height: h, rx: Math.min(4, bw / 2), fill: color });
      const hit = add("rect", { x: L + i * slot, y: T, width: slot, height: H - T - B, class: "fph-hit" });
      hit.addEventListener("mousemove", (e) => showTip(e, `<b>${p.label}</b><br>${money(p.v)}`));
      hit.addEventListener("mouseleave", hideTip);
      if (i % every === 0) add("text", { x: L + i * slot + slot / 2, y: H - 8, "text-anchor": "middle", class: "fph-tick" }).textContent = p.short;
    });
    return el("div", { class: "fph-chart-box" }, el("div", { class: "fph-chart-title" }, title), svg);
  }

  function hbars(title, rows, fmt) {
    const max = Math.max(1, ...rows.map((r) => r.v));
    return el("div", { class: "fph-chart-box" }, el("div", { class: "fph-chart-title" }, title),
      rows.map((r) => el("div", { class: "fph-hrow fph-cat-row", title: r.hint || r.label },
        el("div", { class: "fph-hlabel" }, r.label),
        el("div", { class: "fph-htrack" }, el("div", { class: "fph-hbar", style: `width:${Math.max(0.5, (r.v / max) * 100)}%` })),
        el("div", { class: "fph-hval" }, fmt(r)))));
  }

  // Верх — всегда: баланс и сколько можно вывести (не зависит от периода).
  function renderTop(rows) {
    top.textContent = "";
    if (!F.withdrawInfo) return;
    const bal = balanceNow();
    const HOLD = 48 * 3600e3, now = Date.now();
    const locked = rows.filter((r) => r.amount > 0 && isOrder(r) && r.status !== "cancel" && now - r.date < HOLD)
      .map((r) => ({ amount: r.amount, at: r.date + HOLD })).sort((a, b) => a.at - b.at);
    const lockedSum = locked.reduce((a, r) => a + r.amount, 0);
    // Заморожено больше баланса или были выводы больше «свободных» денег — значит, задержки на аккаунте нет.
    const recentOut = rows.filter((r) => r.amount < 0 && isWithdraw(r) && r.status !== "cancel" && now - r.date < HOLD).reduce((a, r) => a - r.amount, 0);
    const noHold = isFinite(bal) && (lockedSum > bal + 0.01 || recentOut > 0 && recentOut > Math.max(0, bal - lockedSum) + 0.01 && lockedSum > 0);
    const avail = isFinite(bal) ? (noHold ? bal : Math.max(0, bal - lockedSum)) : null;
    const next = locked[0];
    top.append(el("div", { class: "fph-cards fph-cards-top" },
      card("✅", "Можно вывести сейчас", avail != null ? money(avail) : "—", noHold ? "задержки на выводе нет — доступен весь баланс" : "оценка по задержке 48 часов", "fph-card-money"),
      (() => {
        const pending = Object.values(salesOrders).filter((o) => o.status === "paid");
        return card("◷", `В ожидании · ${pending.length} зак.`, money(pending.reduce((a, o) => a + o.price, 0)), null, "fph-card-pending");
      })(),
      noHold ? null : card("⏳", "Освободится позже", money(lockedSum), next ? `ближайшие ${money(next.amount)} — ${new Date(next.at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "ничего не заморожено")));
  }

  function render() {
    const rows = Object.values(cache.rows).sort((a, b) => b.date - a.date);
    status.textContent = cache.updated ? `Операций в базе: ${rows.length} · обновлено ${new Date(cache.updated).toLocaleString("ru-RU")}` : "";
    renderTop(rows);
    if (!F.financeStats) return;
    tabsEl.textContent = "";
    for (const [k, v] of Object.entries(TABS)) tabsEl.append(el("button", { class: "fph-tab" + (k === tab ? " fph-on" : ""), onclick: () => { tab = k; setPref("tab", k); render(); } }, v));
    body.textContent = "";
    const [from, to] = range(period);
    const list = rows.filter((r) => r.status !== "cancel" && r.date >= from && r.date < to);
    if (!list.length) { body.append(el("p", { class: "fph-muted" }, "За выбранный период операций нет.")); return; }
    // Во вкладке «Операции» показываем и отменённые — чтобы было видно всё, что есть в истории.
    if (tab === "ops") return tabOps(rows.filter((r) => r.date >= from && r.date < to));
    // Зачисления по заказам с пометкой «Отменено» FunPay тоже учитывает в балансе (иначе баланс не сходится).
    periodCancelledOrders = rows.filter((r) => r.status === "cancel" && isOrder(r) && r.date >= from && r.date < to);
    ({ cards: tabCards, charts: tabCharts, cats: tabCats })[tab](list);
  }

  function tabCards(list) {
    const inc = list.filter((r) => r.amount > 0), out = list.filter((r) => r.amount < 0);
    const orders = inc.filter(isOrder), withdraws = out.filter(isWithdraw);
    const other = out.filter((r) => !isWithdraw(r));
    // Минус по «Заказу» из истории продаж — это возврат денег покупателю; остальные списания — ваши покупки.
    const orderId = (r) => (r.title.match(/#([A-Z0-9]+)/i) || [])[1];
    const refunds = other.filter((r) => isOrder(r) && salesOrders[orderId(r)]);
    const purchases = other.filter((r) => !refunds.includes(r));
    const days = new Set(list.map((r) => new Date(r.date).toDateString())).size || 1;
    // «Отмена вывода денег» — это не доход, а возврат отменённого вывода; пополнения — ваши же деньги.
    const topups = inc.filter((r) => /пополнен/i.test(r.title));
    const cancelledOrders = periodCancelledOrders;
    const earned = sum(orders) + sum(refunds) + sum(cancelledOrders); // за продажи, уже за вычетом возвратов
    body.append(el("div", { class: "fph-cards" },
      card("⬆", "Заработано на продажах", money(earned), `зачисления за заказы минус возвраты${cancelledOrders.length ? `, вкл. ${cancelledOrders.length} с пометкой «Отменено»` : ""}`, "fph-card-money"),
      card("🏦", "Выведено", money(-sum(withdraws)), `${withdraws.length} выводов`),
      card("🛒", "Средняя выплата за заказ", money(orders.length ? sum(orders) / orders.length : 0), `${orders.length} заказов`),
      card("📅", "В среднем за день", money(earned / days), `дней с операциями: ${days}`),
      topups.length ? card("➕", "Пополнения баланса", money(sum(topups)), `${topups.length} пополнений`) : null));
    const maxOrder = orders.reduce((m, r) => (r.amount > (m?.amount || 0) ? r : m), null);
    const maxW = withdraws.reduce((m, r) => (-r.amount > (m ? -m.amount : 0) ? r : m), null);
    const byDay = new Map();
    for (const r of orders) { const k = new Date(r.date).toLocaleDateString("ru-RU"); byDay.set(k, (byDay.get(k) || 0) + r.amount); }
    const best = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
    const fact = (ico, label, value) => value ? el("div", { class: "fph-fact" }, el("span", {}, ico), el("span", { class: "fph-muted" }, label + ":"), el("b", {}, value)) : null;
    body.append(el("div", { class: "fph-facts" },
      fact("💎", "Самая большая выплата за заказ", maxOrder && `${money(maxOrder.amount)} (${maxOrder.title})`),
      fact("🏦", "Самый крупный вывод", maxW && `${money(-maxW.amount)} — ${new Date(maxW.date).toLocaleDateString("ru-RU")}`),
      fact("🔥", "Лучший день по продажам", best && `${best[0]} — ${money(best[1])}`)));
  }

  function tabCharts(list) {
    const monthly = period === "all";
    const key = (t) => { const d = new Date(t); return monthly ? new Date(d.getFullYear(), d.getMonth(), 1).getTime() : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
    const [from0, to0] = range(period);
    const from = from0 || Math.min(...list.map((r) => r.date));
    const inc = new Map(), outM = new Map();
    for (const r of list) { if (/отмена вывода/i.test(r.title)) continue; const k = key(r.date); if (r.amount > 0) inc.set(k, (inc.get(k) || 0) + r.amount); else outM.set(k, (outM.get(k) || 0) - r.amount); }
    const pts = [], d = new Date(key(from)), end = Math.min(Date.now(), to0 - 1);
    while (d.getTime() <= end && pts.length < 400) {
      const k = d.getTime();
      pts.push({ k, label: monthly ? d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" }) : d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "short" }),
        short: monthly ? d.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" }) : d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }) });
      if (monthly) d.setMonth(d.getMonth() + 1); else d.setDate(d.getDate() + 1);
    }
    const unit = monthly ? "по месяцам" : "по дням";
    body.append(barChart(`Поступления ${unit}`, pts.map((p) => ({ ...p, v: inc.get(p.k) || 0 })), "#30a46c"),
      barChart(`Выводы и списания ${unit}`, pts.map((p) => ({ ...p, v: outM.get(p.k) || 0 })), "#e5484d"));
  }

  function tabCats(list) {
    const inc = list.filter((r) => r.amount > 0 && isOrder(r));
    const byCat = new Map(), byGame = new Map();
    let unmatched = { n: 0, v: 0 };
    for (const r of inc) {
      const id = (r.title.match(/#([A-Z0-9]+)/i) || [])[1];
      const cat = id && salesOrders[id]?.cat;
      if (!cat) { unmatched.n++; unmatched.v += r.amount; continue; }
      const add = (m, k) => { const g = m.get(k) || { n: 0, v: 0 }; g.n++; g.v += r.amount; m.set(k, g); };
      add(byCat, cat);
      add(byGame, cat.split(",")[0].trim());
    }
    const total = sum(inc) || 1;
    const toRows = (m, limit) => {
      const all = [...m.entries()].sort((a, b) => b[1].v - a[1].v);
      const rows = all.slice(0, limit).map(([k, g]) => ({ label: k, v: g.v, n: g.n }));
      const rest = all.slice(limit);
      if (rest.length) rows.push({ label: `Остальные (${rest.length})`, v: rest.reduce((a, [, g]) => a + g.v, 0), n: rest.reduce((a, [, g]) => a + g.n, 0) });
      return rows;
    };
    const fmt = (r) => `${money(r.v)} · ${Math.round((r.v / total) * 100)}% · ${r.n} зак.`;
    const games = toRows(byGame, 12), cats = toRows(byCat, 15);
    if (unmatched.n) cats.push({ label: "Нет в истории продаж", v: unmatched.v, n: unmatched.n, hint: "Заказы, которых нет в статистике продаж — откройте «Мои продажи», чтобы догрузить историю" });
    body.append(el("div", { class: "fph-fin-grid" }, hbars("Поступления по играм", games, fmt), hbars("Поступления по категориям", cats, fmt)));
  }

  let opsQuery = "", opsType = "", opsPage = 0;
  function tabOps(list) {
    const q = el("input", { class: "fph-input fph-inline", type: "search", placeholder: "Поиск по операциям", value: opsQuery, style: "min-width:240px" });
    const types = [...new Set(list.map((r) => r.type))];
    const s = el("select", { class: "fph-input fph-inline" }, el("option", { value: "" }, "Все типы"), types.map((t) => el("option", { value: t }, t)));
    s.value = opsType;
    const holder = el("div");
    const draw = () => {
      const qq = opsQuery.toLowerCase();
      const rows = list.filter((r) => (!opsType || r.type === opsType) && (!qq || r.title.toLowerCase().includes(qq)));
      const per = 50, pages = Math.max(1, Math.ceil(rows.length / per));
      opsPage = Math.min(opsPage, pages - 1);
      holder.textContent = "";
      holder.append(el("table", { class: "fph-table" },
        el("thead", {}, el("tr", {}, ["Дата", "Операция", "Категория", "Статус", "Сумма"].map((t) => el("th", {}, t)))),
        el("tbody", {}, rows.slice(opsPage * per, opsPage * per + per).map((r) => {
          const id = (r.title.match(/#([A-Z0-9]+)/i) || [])[1];
          return el("tr", {},
            el("td", { class: "fph-nowrap" }, new Date(r.date).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })),
            el("td", {}, id && isOrder(r) ? el("a", { href: `/orders/${id}/`, target: "_blank" }, r.title) : r.title),
            el("td", { class: "fph-muted" }, (id && salesOrders[id]?.cat) || ""),
            el("td", { class: "fph-muted" }, r.statusText || ""),
            el("td", { class: "fph-nowrap " + (r.amount >= 0 ? "fph-ok" : "fph-err") }, (r.amount > 0 ? "+" : "") + money(r.amount)));
        }))),
        el("div", { class: "fph-row" },
          el("button", { class: "fph-btn", disabled: opsPage === 0 ? "" : null, onclick: () => { opsPage--; draw(); } }, "←"),
          el("span", { class: "fph-muted" }, `Стр. ${opsPage + 1} из ${pages} · найдено ${rows.length}`),
          el("button", { class: "fph-btn", disabled: opsPage >= pages - 1 ? "" : null, onclick: () => { opsPage++; draw(); } }, "→")));
    };
    q.addEventListener("input", () => { opsQuery = q.value.trim(); opsPage = 0; draw(); });
    s.addEventListener("change", () => { opsType = s.value; opsPage = 0; draw(); });
    body.append(el("div", { class: "fph-row" }, q, s), holder);
    draw();
  }

  function exportRows(kind) {
    const [from, to] = range(period);
    const rows = Object.values(cache.rows).filter((r) => r.date >= from && r.date < to).sort((a, b) => b.date - a.date);
    if (!rows.length) return toast("Операций за этот период нет");
    let blob, name = `funpay_finance_${period}_${new Date().toISOString().slice(0, 10)}`;
    if (kind === "json") blob = new Blob([JSON.stringify(rows.map((r) => ({ ...r, date: new Date(r.date).toISOString() })), null, 2)], { type: "application/json" });
    else {
      const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [["Дата", "Операция", "Тип", "Категория", "Сумма", "Статус"].map(cell).join(";")];
      for (const r of rows) {
        const id = (r.title.match(/#([A-Z0-9]+)/i) || [])[1];
        lines.push([new Date(r.date).toLocaleString("ru-RU"), r.title, r.type, (id && salesOrders[id]?.cat) || "", String(r.amount).replace(".", ","), r.statusText || r.status].map(cell).join(";"));
      }
      blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    }
    const a = el("a", { href: URL.createObjectURL(blob), download: `${name}.${kind}` });
    document.body.append(a); a.click(); a.remove();
  }

  let busy = false;
  async function run(full) {
    if (busy) return;
    busy = true;
    try { await load(full); } catch (e) { status.textContent = "Ошибка загрузки: " + e.message; }
    busy = false;
    render();
  }
  (async () => {
    salesOrders = (await chrome.storage.local.get("sales_" + myId()))["sales_" + myId()]?.orders || {};
    cache = (await chrome.storage.local.get(CACHE))[CACHE] || cache;
    render();
    // Не чаще раза в 10 минут; кнопка «Обновить» работает всегда.
    if (!cache.complete || Date.now() - (cache.updated || 0) > 10 * 60e3) run(false);
  })();
});
