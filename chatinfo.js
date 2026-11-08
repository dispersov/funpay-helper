// Краткая информация под ником в списке чатов: что смотрит покупатель / что купил последним.
// Чаты при этом не открываются (иначе FunPay пометит их прочитанными). Источники:
//  1) блок «Покупатель смотрит» — запоминаем его, когда вы сами открываете чат;
//  2) последний заказ этого покупателя из истории продаж (её собирает статистика продаж).
FPH.whenEnabled("chatInfo", () => {
  if (!/^\/chat\/?$/.test(location.pathname)) return;
  const { el, myId } = FPH;
  const KEY = "fphChatLooking";
  const STATUS_ICO = { paid: "◷", closed: "✓", refunded: "↩" };

  // Убираем рекламные вставки и эмодзи из названия лота — как в статистике.
  const PROMO = /автовыдач|в\s*наличии|24\s*\/\s*7|мгновенн|моментальн|быстр|скидк|акци|гарант|лучш|дешев|онлайн|auto/i;
  const short = (desc) => String(desc || "")
    .replace(/,?\s*https?:\/\/\S+/g, "")
    .replace(/[【\[]([^】\]]*)[】\]]/g, (m, inner) => (PROMO.test(inner) ? " " : ` ${inner} `))
    .replace(/[\p{Extended_Pictographic}☀-➿️‍]/gu, " ")
    .replace(/\s+/g, " ").replace(/\s+,/g, ",")
    .replace(/^[\s,.;:—–|\/-]+|[\s,.;:—–|\/-]+$/g, "").trim();
  // Название предмета: сначала то, что продавец взял в скобки 【…】 (кроме рекламы),
  // иначе самая длинная из первых частей описания — чтобы не показывать «PC» или «Steam».
  function itemName(desc, skip = 0) {
    const brackets = [...String(desc || "").matchAll(/[【\[]([^】\]]*)[】\]]/g)]
      .map((m) => short(m[1])).filter((t) => t && !PROMO.test(t) && t.length > 2);
    if (brackets.length) return brackets[0];
    const parts = short(desc).split(/\s*,\s*/).slice(skip).filter(Boolean);
    return parts.slice(0, 3).sort((a, b) => b.length - a.length)[0] || short(desc);
  }
  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 60) return `${Math.max(1, m)} мин`;
    if (m < 1440) return `${Math.round(m / 60)} ч`;
    return `${Math.round(m / 1440)} дн`;
  };

  let looking = {};
  let lastOrder = new Map(); // ник → последний заказ

  async function load() {
    const r = await chrome.storage.local.get([KEY, "sales_" + myId()]);
    looking = r[KEY] || {};
    lastOrder = new Map();
    for (const o of Object.values(r["sales_" + myId()]?.orders || {})) {
      const k = (o.buyer || "").toLowerCase();
      if (!k) continue;
      const cur = lastOrder.get(k);
      if (!cur || o.date > cur.date) lastOrder.set(k, o);
    }
  }

  // Запоминаем «Покупатель смотрит» из открытого чата.
  function captureLooking() {
    const chatId = new URLSearchParams(location.search).get("node");
    if (!chatId) return;
    const label = [...document.querySelectorAll("h5, h4, .param-item h5, div, span")].find((e) =>
      e.children.length === 0 && /^(покупатель смотрит|buyer is viewing|покупець дивиться)$/i.test(e.textContent.trim()));
    if (!label) return;
    const box = label.parentElement;
    const text = box.textContent.replace(label.textContent, "").replace(/\s+/g, " ").trim();
    if (!text || looking[chatId]?.text === text) return;
    looking[chatId] = { text, at: Date.now() };
    // Храним не больше 500 последних чатов.
    const ids = Object.keys(looking).sort((a, b) => looking[b].at - looking[a].at);
    for (const id of ids.slice(500)) delete looking[id];
    chrome.storage.local.set({ [KEY]: looking });
  }

  function decorate() {
    for (const a of document.querySelectorAll("a.contact-item[data-id]")) {
      const nameEl = a.querySelector(".media-user-name");
      if (!nameEl) continue;
      const nick = nameEl.textContent.trim();
      const look = looking[a.dataset.id];
      const order = lastOrder.get(nick.toLowerCase());
      let text = "", title = "", ico = "";
      if (look && (!order || look.at >= order.date)) {
        // Формат блока: «Игра, Раздел, Название лота, параметры…» — показываем название лота.
        ico = "👁"; text = itemName(look.text, 2); title = `Смотрел(а): ${look.text}`;
      } else if (order) {
        ico = "🛒"; text = itemName(order.desc); title = `Последний заказ #${order.id} (${ago(order.date)} назад): ${order.desc}`;
        if (STATUS_ICO[order.status]) text = `${STATUS_ICO[order.status]} ${text}`;
      }
      let tag = a.querySelector(".fph-chat-tag");
      if (!text) { tag?.remove(); continue; }
      if (!tag) { tag = el("div", { class: "fph-chat-tag" }); nameEl.after(tag); }
      if (tag.dataset.v === ico + text) continue;
      tag.dataset.v = ico + text;
      tag.title = title;
      tag.textContent = `${ico} ${text}`;
    }
  }

  (async () => {
    await load();
    captureLooking();
    decorate();
    let t = null;
    new MutationObserver((muts) => {
      if (muts.every((m) => [...m.addedNodes].every((n) => n.classList?.contains("fph-chat-tag")))) return;
      clearTimeout(t);
      t = setTimeout(() => { captureLooking(); decorate(); }, 300);
    }).observe(document.body, { childList: true, subtree: true });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === "local" && (ch[KEY] || ch["sales_" + myId()])) load().then(decorate);
    });
  })();
});
