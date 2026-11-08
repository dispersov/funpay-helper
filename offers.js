// Раздел «Предложения»: подсветка своих лотов, реальные цены, комиссия раздела,
// точная цена и себестоимость в редактировании лота, клонирование, панель лотов в профиле.
FPH.settings.then((S) => {
  const F = S.features;
  const { el, parseNumber, fmtMoney, commission, loadOffer, saveOffer, collectOfferFields, myId, toast, copyText } = FPH;
  const path = location.pathname;
  const me = myId();
  const pct = (c) => (c * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%";
  const round2 = (v) => Math.round(v * 100) / 100;

  // ---------- Список лотов раздела: подсветка своих и реальные цены ----------
  const listMatch = path.match(/^\/(lots|chips)\/(\d+)\/?$/);
  if (listMatch) {
    const items = [...document.querySelectorAll("a.tc-item")];
    if (F.highlightOwn && me) {
      let pos = 0, mine = [];
      items.forEach((a, i) => {
        const seller = a.querySelector('[data-href*="/users/"]')?.getAttribute("data-href") || "";
        if (seller.includes(`/users/${me}/`)) { a.classList.add("fph-own"); mine.push(i + 1); if (!pos) pos = i + 1; }
      });
      if (mine.length) {
        const h1 = document.querySelector("h1");
        h1?.after(el("div", { class: "fph-own-info" },
          `Ваших лотов: ${mine.length} · лучшая позиция: ${pos} из ${items.length} `,
          el("a", { href: "#", onclick: (e) => { e.preventDefault(); document.querySelector(".fph-own")?.scrollIntoView({ behavior: "smooth", block: "center" }); } }, "показать")));
      }
    }
    if (listMatch[1] === "lots" && (F.realPrice || F.sectionCommission)) {
      commission(listMatch[2]).then((c) => {
        if (c == null) return;
        if (F.sectionCommission) addCommissionBadge(c);
        if (!F.realPrice) return;
        for (const a of items) {
          const p = a.querySelector(".tc-price");
          const v = p?.dataset.s ? parseFloat(p.dataset.s) : parseNumber(p?.textContent);
          if (!(v > 0)) continue;
          p.append(el("div", { class: "fph-real", title: `Комиссия раздела ${pct(c)}: продавец получает примерно столько` }, "≈ " + fmtMoney(round2(v / (1 + c)), "₽")));
        }
      });
    }
  }

  function addCommissionBadge(c) {
    const h1 = document.querySelector("h1");
    if (!h1 || h1.querySelector(".fph-commission")) return;
    h1.append(el("span", { class: "fph-commission", title: "Сколько сверху вашей цены платит покупатель (самый дешёвый способ оплаты)" }, "комиссия " + pct(c)));
  }

  // ---------- Свои лоты раздела: комиссия ----------
  const tradeMatch = path.match(/^\/lots\/(\d+)\/trade\/?$/);
  if (tradeMatch && F.sectionCommission) commission(tradeMatch[1]).then((c) => c != null && addCommissionBadge(c));

  // ---------- Редактирование лота ----------
  if (/^\/lots\/offerEdit/.test(path)) {
    const priceInput = document.querySelector('input[name="price"]');
    const nodeId = document.querySelector('input[name="node_id"]')?.value;
    const offerId = new URLSearchParams(location.search).get("offer") || document.querySelector('input[name="offer_id"]')?.value;
    const hasOffer = offerId && offerId !== "0";
    const group = priceInput?.closest(".form-group") || priceInput?.parentElement;
    const box = el("div", { class: "fph-edit-box" });
    if (group && (F.exactPrice || F.cost)) group.after(box);
    const setPrice = (v) => {
      priceInput.value = String(v);
      for (const t of ["input", "change", "keyup"]) priceInput.dispatchEvent(new Event(t, { bubbles: true }));
    };

    if (F.exactPrice && priceInput) {
      commission(nodeId).then((c) => {
        if (c == null) return;
        const buyer = el("input", { class: "form-control fph-inline-input", type: "number", step: "0.01", min: "0", placeholder: "сколько платит покупатель" });
        const info = el("span", { class: "fph-muted" });
        const sync = () => {
          const p = parseFloat(priceInput.value);
          if (document.activeElement !== buyer) buyer.value = p > 0 ? round2(p * (1 + c)) : "";
          info.textContent = `комиссия раздела ${pct(c)}`;
        };
        buyer.addEventListener("input", () => {
          const b = parseFloat(buyer.value);
          if (b > 0) setPrice(round2(b / (1 + c)));
        });
        priceInput.addEventListener("input", sync);
        box.append(el("div", { class: "fph-edit-row" }, el("label", {}, "Точная цена для покупателя"), buyer, info));
        sync();
      });
    }

    if (F.cost && priceInput) {
      const key = "fphCosts";
      chrome.storage.local.get(key).then((r) => {
        const costs = r[key] || {};
        const cur = hasOffer ? costs[offerId] : null;
        const fee = (Number(S.custom.withdrawFee) || 0) / 100;
        const cost = el("input", { class: "form-control fph-inline-input", type: "number", step: "0.01", min: "0", placeholder: "себестоимость, ₽", value: cur?.cost ?? "" });
        const info = el("span", { class: "fph-muted" });
        const calc = () => {
          const p = parseFloat(priceInput.value), cs = parseFloat(cost.value);
          if (!(p > 0) || !(cs >= 0)) { info.textContent = hasOffer ? "" : "сохраните лот, потом укажите себестоимость"; return; }
          const profit = p * (1 - fee) - cs;
          info.textContent = `прибыль с продажи ≈ ${fmtMoney(round2(profit), "₽")}${fee ? ` (с учётом ${S.custom.withdrawFee}% на вывод)` : ""}`;
          info.className = profit >= 0 ? "fph-ok" : "fph-err";
        };
        let t = null;
        cost.addEventListener("input", () => {
          calc();
          if (!hasOffer) return;
          clearTimeout(t);
          t = setTimeout(async () => {
            const all = (await chrome.storage.local.get(key))[key] || {};
            const v = parseFloat(cost.value);
            const title = document.querySelector('input[name="fields[summary][ru]"]')?.value || "";
            if (v >= 0) all[offerId] = { cost: v, title, node: nodeId, at: Date.now() };
            else delete all[offerId];
            await chrome.storage.local.set({ [key]: all });
          }, 400);
        });
        priceInput.addEventListener("input", calc);
        box.append(el("div", { class: "fph-edit-row" }, el("label", {}, "Себестоимость"), cost, info));
        calc();
      });
    }

    if (F.clone && hasOffer) {
      const btn = el("button", { type: "button", class: "btn btn-default fph-clone-btn", onclick: async () => {
        if (!confirm("Создать копию этого лота? Товары автовыдачи в копию не переносятся, автовыдача FunPay в копии будет выключена.")) return;
        btn.disabled = true;
        try {
          const data = collectOfferFields(document);
          data.set("offer_id", "0");
          data.set("secrets", "");
          data.delete("auto_delivery");
          await saveOffer(data);
          toast("Копия лота создана");
          setTimeout(() => (location.href = nodeId ? `/lots/${nodeId}/trade` : "/"), 900);
        } catch (e) {
          toast("Не удалось клонировать: " + e.message);
          btn.disabled = false;
        }
      } }, "⧉ Клонировать лот");
      const anchor = document.querySelector("h1") || box;
      anchor.after(btn);
    }
  }

  // ---------- Продажи по каждому лоту (свой профиль и «Ваши предложения») ----------
  // Считаем по истории продаж из статистики: описание заказа = описание лота + «1 шт.» + трейд-ссылка.
  const onOwnProfile = (path.match(/^\/users\/(\d+)\/?$/) || [])[1] === me;
  if (F.lotSales && me && (onOwnProfile || tradeMatch)) {
    const norm = (t) => String(t || "")
      .replace(/,?\s*https?:\/\/\S+/g, "").replace(/,\s*\d+\s*шт\.?/gi, "")
      .replace(/[\p{Extended_Pictographic}☀-➿️‍【】\[\]]/gu, " ")
      .replace(/\s+/g, " ").replace(/\s+,/g, ",").trim().toLowerCase();
    const ago = (t) => { const d = Math.floor((Date.now() - t) / 864e5); return d < 1 ? "сегодня" : d === 1 ? "вчера" : `${d} дн. назад`; };
    chrome.storage.local.get("sales_" + me).then((r) => {
      const orders = Object.values(r["sales_" + me]?.orders || {});
      if (!orders.length) return;
      const stats = new Map();
      for (const o of orders) {
        const k = norm(o.desc);
        const g = stats.get(k) || { n: 0, sum: 0, refunds: 0, last: 0 };
        if (o.status === "refunded") g.refunds++;
        else { g.n += o.qty || 1; g.sum += o.price; g.last = Math.max(g.last, o.date); }
        stats.set(k, g);
      }
      for (const a of document.querySelectorAll(onOwnProfile ? 'a.tc-item[href*="offer?id="]' : "a.tc-item[data-offer]")) {
        const descEl = a.querySelector(".tc-desc-text") || a.querySelector(".tc-desc");
        if (!descEl || a.querySelector(".fph-lot-sales")) continue;
        const g = stats.get(norm(descEl.textContent));
        const box = el("div", { class: "fph-lot-sales" + (g && g.n ? "" : " fph-lot-sales-none") });
        if (g && g.n) {
          box.append(el("span", {}, `🛒 продано ${g.n}`), el("span", {}, fmtMoney(Math.round(g.sum), "₽")), el("span", {}, `последняя ${ago(g.last)}`));
          if (g.refunds) box.append(el("span", { class: "fph-err" }, `↩ возвратов ${g.refunds}`));
        } else box.append(el("span", {}, g?.refunds ? `продаж нет · ↩ возвратов ${g.refunds}` : "продаж пока нет"));
        descEl.after(box);
      }
    });
  }

  // ---------- Профиль: поиск по лотам и экспорт ----------
  const profMatch = path.match(/^\/users\/(\d+)\/?$/);
  if (profMatch && F.profilePanel) {
    const groups = [...document.querySelectorAll(".offer-list-title-container")];
    if (groups.length) {
      const own = profMatch[1] === me;
      const allItems = () => [...document.querySelectorAll('a.tc-item[href*="offer?id="]')];
      const counter = el("span", { class: "fph-muted" });
      const search = el("input", { class: "form-control fph-inline-input", type: "search", placeholder: "Поиск по лотам профиля…", style: "min-width:260px" });
      const filter = () => {
        const q = search.value.trim().toLowerCase();
        let shown = 0;
        for (const a of allItems()) {
          const hit = !q || a.textContent.toLowerCase().includes(q);
          a.style.display = hit ? "" : "none";
          if (hit) shown++;
        }
        for (const g of groups) {
          const box = g.parentElement;
          const any = [...box.querySelectorAll('a.tc-item[href*="offer?id="]')].some((a) => a.style.display !== "none");
          box.style.display = any ? "" : "none";
        }
        counter.textContent = `Лотов: ${shown}${q ? " из " + allItems().length : ""}`;
      };
      search.addEventListener("input", filter);
      const exportCsv = () => {
        const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const lines = [["ID", "Раздел", "Описание", "Сервер", "Наличие", "Цена", "Ссылка"].map(cell).join(";")];
        for (const g of groups) {
          const cat = g.querySelector("h3")?.textContent.trim() || "";
          for (const a of g.parentElement.querySelectorAll('a.tc-item[href*="offer?id="]')) {
            const id = (a.getAttribute("href").match(/id=(\d+)/) || [])[1];
            const p = a.querySelector(".tc-price");
            lines.push([id, cat, a.querySelector(".tc-desc-text")?.textContent.trim(), a.querySelector(".tc-server")?.textContent.trim(),
              a.querySelector(".tc-amount")?.textContent.trim(), String(p?.dataset.s || parseNumber(p?.textContent)).replace(".", ","),
              new URL(a.getAttribute("href"), location.origin).href].map(cell).join(";"));
          }
        }
        const link = el("a", { href: URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" })), download: `funpay_lots_${profMatch[1]}_${new Date().toISOString().slice(0, 10)}.csv` });
        document.body.append(link); link.click(); link.remove();
      };
      const copyLinks = async () => {
        const urls = allItems().filter((a) => a.style.display !== "none").map((a) => new URL(a.getAttribute("href"), location.origin).href);
        await copyText(urls.join("\n"));
        toast(`Скопировано ссылок: ${urls.length}`);
      };
      const bar = el("div", { class: "fph-profile-bar" },
        el("b", {}, "Управление лотами"), search, counter,
        el("button", { type: "button", class: "btn btn-default btn-sm", onclick: copyLinks }, "Скопировать ссылки"),
        own ? el("button", { type: "button", class: "btn btn-default btn-sm", onclick: exportCsv }, "Экспорт лотов") : null);
      groups[0].parentElement.before(bar);
      filter();
    }
  }
});
