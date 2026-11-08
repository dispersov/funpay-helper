// Массовое редактирование своих лотов: страница раздела /lots/<id>/trade и свой профиль /users/<id>/.
// Кнопка «Выбрать лоты» включает галочки и панель: цена, включить/выключить, клонировать, удалить.
FPH.whenEnabled("bulk", () => {
  const { el, parseNumber, sleep, fmtMoney, loadOffer, saveOffer, myId } = FPH;
  const onTrade = /^\/lots\/\d+\/trade\/?$/.test(location.pathname);
  const prof = location.pathname.match(/^\/users\/(\d+)\/?$/);
  const onProfile = prof && prof[1] === myId();
  if (!onTrade && !onProfile) return;
  const DELAY_MS = 1200; // пауза между сохранениями, чтобы FunPay не ругался на частые запросы

  const items = [...document.querySelectorAll(onTrade ? "a.tc-item[data-offer]" : 'a.tc-item[href*="offer?id="]')];
  if (!items.length) return;

  let rows = [];
  let enabled = false;

  function setup() {
    rows = items.map((a) => {
      const priceEl = a.querySelector(".tc-price");
      const price = priceEl?.dataset.s ? parseFloat(priceEl.dataset.s) : parseNumber(priceEl?.textContent);
      const id = a.dataset.offer || (a.getAttribute("href").match(/id=(\d+)/) || [])[1];
      const box = el("span", { class: "fph-check", title: "Выбрать лот" });
      const preview = el("span", { class: "fph-preview" });
      const row = { a, id, price, active: !a.classList.contains("warning"), selected: false, box, preview, newPrice: null };
      box.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        setSelected(row, !row.selected);
        refresh();
      });
      return row;
    });
  }

  function toggleMode() {
    enabled = !enabled;
    if (enabled && !rows.length) setup();
    for (const r of rows) {
      if (enabled) { r.a.classList.add("fph-lot"); r.a.prepend(r.box); r.a.querySelector(".tc-price")?.append(r.preview); }
      else { r.a.classList.remove("fph-lot", "fph-selected"); r.box.remove(); r.preview.remove(); r.selected = false; r.box.classList.remove("fph-on"); }
    }
    panel.style.display = enabled ? "" : "none";
    openBtn.textContent = enabled ? "✕ Закрыть выбор" : "☑ Выбрать лоты";
    refresh();
  }

  function setSelected(row, v) {
    row.selected = v;
    row.box.classList.toggle("fph-on", v);
    row.a.classList.toggle("fph-selected", v);
  }

  const mode = el("select", { class: "fph-input fph-inline" },
    el("option", { value: "set" }, "Цена ="),
    el("option", { value: "pct_up" }, "+ %"),
    el("option", { value: "pct_down" }, "− %"),
    el("option", { value: "add" }, "+ сумма"),
    el("option", { value: "sub" }, "− сумма"));
  const value = el("input", { class: "fph-input fph-inline", type: "number", step: "0.01", min: "0", placeholder: "значение" });
  const counter = el("span", { class: "fph-muted" });
  const log = el("div", { class: "fph-log" });

  function calcPrice(p) {
    const v = parseFloat(value.value);
    if (!isFinite(v)) return null;
    let r;
    switch (mode.value) {
      case "set": r = v; break;
      case "pct_up": r = p * (1 + v / 100); break;
      case "pct_down": r = p * (1 - v / 100); break;
      case "add": r = p + v; break;
      case "sub": r = p - v; break;
    }
    r = Math.round(r * 100) / 100;
    return r > 0 ? r : null;
  }

  function refresh() {
    const sel = rows.filter((r) => r.selected);
    counter.textContent = `Выбрано: ${sel.length} из ${rows.length}`;
    for (const r of rows) {
      r.newPrice = r.selected ? calcPrice(r.price) : null;
      r.preview.textContent = r.newPrice != null && r.newPrice !== r.price ? ` → ${fmtMoney(r.newPrice)}` : "";
    }
  }
  mode.addEventListener("change", refresh);
  value.addEventListener("input", refresh);

  const selectBy = (fn) => { rows.forEach((r) => setSelected(r, fn(r))); refresh(); };

  const panel = el("div", { class: "fph-panel fph-bulk", style: "display:none" },
    el("div", { class: "fph-row" }, el("b", {}, "Массовая правка"), counter),
    el("div", { class: "fph-row" },
      el("button", { class: "fph-btn", onclick: () => selectBy(() => true) }, "Все"),
      onTrade ? el("button", { class: "fph-btn", onclick: () => selectBy((r) => r.active) }, "Активные") : null,
      onTrade ? el("button", { class: "fph-btn", onclick: () => selectBy((r) => !r.active) }, "Выключенные") : null,
      el("button", { class: "fph-btn", onclick: () => selectBy(() => false) }, "Снять")),
    el("div", { class: "fph-row" }, mode, value,
      el("button", { class: "fph-btn fph-btn-primary", onclick: () => run("price") }, "Применить цены")),
    el("div", { class: "fph-row" },
      el("button", { class: "fph-btn", onclick: () => run("on") }, "Включить"),
      el("button", { class: "fph-btn", onclick: () => run("off") }, "Выключить"),
      el("button", { class: "fph-btn", onclick: () => run("clone") }, "Клонировать"),
      el("button", { class: "fph-btn fph-btn-danger", onclick: () => run("delete") }, "Удалить")),
    log);
  const openBtn = el("button", { class: "fph-btn fph-btn-primary fph-bulk-open", onclick: toggleMode }, "☑ Выбрать лоты");
  document.body.append(panel, openBtn);

  async function apply(id, action, row) {
    if (action === "delete") {
      const { data } = await loadOffer(id);
      return saveOffer(new URLSearchParams({ csrf_token: data.get("csrf_token") || "", offer_id: id, deleted: "1" }));
    }
    const { data } = await loadOffer(id);
    if (action === "price") data.set("price", String(row.newPrice));
    if (action === "on") data.set("active", "on");
    if (action === "off") data.delete("active");
    if (action === "clone") {
      // Новый лот с теми же полями. Товары автовыдачи не копируем — иначе один товар продастся дважды.
      data.set("offer_id", "0");
      data.set("secrets", "");
      data.delete("auto_delivery");
    }
    return saveOffer(data);
  }

  let busy = false;
  async function run(action) {
    if (busy) return;
    let targets = rows.filter((r) => r.selected);
    if (action === "price") targets = targets.filter((r) => r.newPrice != null && r.newPrice !== r.price);
    if (action === "on" && onTrade) targets = targets.filter((r) => !r.active);
    if (action === "off" && onTrade) targets = targets.filter((r) => r.active);
    if (!targets.length) {
      log.textContent = action === "price" ? "Нечего менять: выберите лоты и укажите значение." : "Нечего менять среди выбранных лотов.";
      return;
    }
    const n = targets.length;
    const question = {
      price: `Изменить цену у ${n} лот(ов)?`,
      on: `Включить ${n} лот(ов)?`,
      off: `Выключить ${n} лот(ов)?`,
      clone: `Создать копии ${n} лот(ов)? Товары автовыдачи в копии не переносятся, автовыдача FunPay в копиях будет выключена.`,
      delete: `Удалить ${n} лот(ов) с FunPay? Это нельзя отменить.`,
    }[action];
    if (!confirm(question)) return;

    busy = true;
    panel.classList.add("fph-busy");
    log.textContent = "";
    let ok = 0;
    for (const [i, r] of targets.entries()) {
      const line = el("div", {}, `${i + 1}/${n} · лот ${r.id}… `);
      log.append(line);
      log.scrollTop = log.scrollHeight;
      try {
        await apply(r.id, action, r);
        line.append("✔");
        ok++;
      } catch (e) {
        line.append(el("span", { class: "fph-err" }, "✖ " + e.message));
      }
      if (i < n - 1) await sleep(DELAY_MS);
    }
    log.append(el("div", {}, el("b", {}, `Готово: ${ok} из ${n}. `),
      el("button", { class: "fph-btn", onclick: () => location.reload() }, "Обновить страницу")));
    busy = false;
    panel.classList.remove("fph-busy");
  }
});
