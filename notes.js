// Заметки и цветные метки о покупателях. Хранятся локально в chrome.storage.local под ключом "notes":
// { "<userId>": { name, text, color, updated } }
FPH.whenEnabled("notes", () => {
  const { el, appData, modal } = FPH;
  const myId = String(appData().userId || "");
  const COLORS = { red: "#e5484d", orange: "#f76b15", yellow: "#d4a514", green: "#30a46c", blue: "#0090ff", gray: "#8b8d98" };
  const COLOR_NAMES = { red: "Красная", orange: "Оранжевая", yellow: "Жёлтая", green: "Зелёная", blue: "Синяя", gray: "Серая" };
  let notes = {};

  const userIdOf = (node) => {
    const ref = node.getAttribute("href") || node.getAttribute("data-href") || "";
    const m = ref.match(/\/users\/(\d+)\/?$/);
    return m ? m[1] : null;
  };

  function badgeFor(id) {
    const n = notes[id];
    if (!n || (!n.text && !n.color)) return null;
    return el("span", {
      class: "fph-note-badge fph-keep-colors",
      style: `--fph-c:${COLORS[n.color] || COLORS.gray}`,
      title: n.text || "",
      "data-fph-user": id,
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); openEditor(id); },
    }, n.text ? (n.text.length > 24 ? n.text.slice(0, 24) + "…" : n.text) : "●");
  }

  function decorate() {
    document.querySelectorAll(".fph-note-badge").forEach((b) => b.remove());
    const links = document.querySelectorAll('a[href*="/users/"], [data-href*="/users/"]');
    for (const link of links) {
      const id = userIdOf(link);
      if (!id || id === myId) continue;
      if (link.closest("header, .navbar, .fph-modal, .fph-panel")) continue;
      if (!link.textContent.trim()) continue; // аватарки без текста пропускаем
      const b = badgeFor(id);
      if (b) link.after(b);
    }
    addProfileButton();
  }

  function addProfileButton() {
    const m = location.pathname.match(/^\/users\/(\d+)\/?$/);
    if (!m || m[1] === myId || document.querySelector(".fph-profile-note")) return;
    const target = document.querySelector(".profile .mr4, .profile h1, h1");
    if (!target) return;
    target.after(el("button", { class: "fph-btn fph-profile-note", onclick: () => openEditor(m[1]) }, "📝 Заметка"));
  }

  function guessName(id) {
    for (const link of document.querySelectorAll(`a[href*="/users/${id}/"], [data-href*="/users/${id}/"]`)) {
      const t = link.textContent.trim();
      if (t) return t;
    }
    return notes[id]?.name || "";
  }

  function openEditor(id) {
    const cur = notes[id] || {};
    let color = cur.color || "";
    const name = guessName(id);
    const text = el("textarea", { class: "fph-input", rows: "4", placeholder: "Например: просил возврат, вежливый, постоянный клиент…" });
    text.value = cur.text || "";
    const swatches = el("div", { class: "fph-swatches" },
      el("button", { class: "fph-swatch" + (color ? "" : " fph-on"), title: "Без метки", "data-c": "" }, "∅"),
      Object.keys(COLORS).map((c) => el("button", {
        class: "fph-swatch fph-keep-colors" + (color === c ? " fph-on" : ""),
        style: `background:${COLORS[c]}`, title: COLOR_NAMES[c], "data-c": c,
      })));
    swatches.addEventListener("click", (e) => {
      const b = e.target.closest(".fph-swatch");
      if (!b) return;
      color = b.dataset.c;
      swatches.querySelectorAll(".fph-swatch").forEach((s) => s.classList.toggle("fph-on", s === b));
    });
    const save = async () => {
      const value = text.value.trim();
      if (!value && !color) delete notes[id];
      else notes[id] = { name, text: value, color, updated: Date.now() };
      await chrome.storage.local.set({ notes });
      m.close();
    };
    const m = modal(`Заметка: ${name || "пользователь " + id}`, el("div", {},
      el("div", { class: "fph-muted" }, el("a", { href: `/users/${id}/`, target: "_blank" }, `Профиль #${id}`)),
      text, swatches,
      el("div", { class: "fph-row" },
        el("button", { class: "fph-btn fph-btn-primary", onclick: save }, "Сохранить"),
        cur.text || cur.color ? el("button", { class: "fph-btn", onclick: () => { text.value = ""; color = ""; save(); } }, "Удалить") : null)));
    text.focus();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "fph-edit-note") openEditor(String(msg.userId));
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "local" && ch.notes) { notes = ch.notes.newValue || {}; decorate(); }
  });

  chrome.storage.local.get({ notes: {} }, (r) => {
    notes = r.notes;
    decorate();
    // Чат и списки подгружаются динамически — перерисовываем метки при изменениях.
    let pending = false;
    new MutationObserver((muts) => {
      if (pending || muts.every((m) => [...m.addedNodes].every((n) => n.classList?.contains("fph-note-badge")))) return;
      pending = true;
      setTimeout(() => { pending = false; decorate(); }, 400);
    }).observe(document.body, { childList: true, subtree: true });
  });
});
