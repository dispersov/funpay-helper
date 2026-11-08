chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "fph-note",
    title: "Заметка о пользователе",
    contexts: ["link"],
    targetUrlPatterns: ["https://funpay.com/users/*"],
    documentUrlPatterns: ["https://funpay.com/*"],
  });
});

// Golden Key — кука httpOnly, страница её не видит; отдаём её только своим скриптам расширения.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg?.type === "fph-golden-key") {
    chrome.cookies.get({ url: "https://funpay.com/", name: "golden_key" }, (c) => reply(c?.value || ""));
    return true;
  }
  if (msg?.type === "fph-wallhaven") {
    wallhavenSearch(msg).then(reply, (e) => reply({ error: e.message }));
    return true;
  }
  if (msg?.type === "fph-fetch-image") {
    fetchImage(msg.url).then(reply, (e) => reply({ error: e.message }));
    return true;
  }
});

// ---------- Галерея обоев Wallhaven (только безопасный контент: purity=100) ----------
async function wallhavenSearch({ q = "", cat = "010", page = 1, sorting = "toplist" }) {
  const p = new URLSearchParams({ q, categories: cat, purity: "100", sorting, topRange: "1y", atleast: "1920x1080", ratios: "16x9,16x10,21x9", page: String(page) });
  if (sorting === "random") p.delete("topRange");
  const r = await fetch("https://wallhaven.cc/api/v1/search?" + p);
  if (!r.ok) throw new Error("Wallhaven ответил " + r.status);
  const j = await r.json();
  return {
    page: j.meta.current_page,
    last: j.meta.last_page,
    items: j.data.map((w) => ({ id: w.id, thumb: w.thumbs.small, big: w.thumbs.large, url: w.path, res: w.resolution, size: w.file_size, colors: w.colors })),
  };
}

// Скачиваем картинку здесь (у фонового скрипта есть доступ к wallhaven) и отдаём странице как data URL —
// страница сохранит её в свою IndexedDB.
async function fetchImage(url) {
  if (!/^https:\/\/w\.wallhaven\.cc\//.test(url)) throw new Error("Неподдерживаемый адрес");
  const r = await fetch(url);
  if (!r.ok) throw new Error("Не удалось скачать: " + r.status);
  const blob = await r.blob();
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { dataUrl: `data:${blob.type || "image/jpeg"};base64,${btoa(bin)}`, mime: blob.type || "image/jpeg" };
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "fph-note" || !tab?.id) return;
  const m = String(info.linkUrl || "").match(/\/users\/(\d+)/);
  if (m) chrome.tabs.sendMessage(tab.id, { type: "fph-edit-note", userId: m[1] });
});

// ---------- Автообновление ----------
// Расширение загружено из папки (режим разработчика), поэтому Chrome сам его не обновляет.
// Раз в 30 секунд и при открытии страниц FunPay сверяем содержимое своих файлов с тем,
// что было при запуске. Если файлы в папке поменялись — перезагружаем расширение,
// а после перезагрузки обновляем открытые вкладки FunPay, чтобы подхватились новые скрипты.
const FILES = (() => {
  const m = chrome.runtime.getManifest();
  const list = new Set(["manifest.json", "background.js", "popup.html", "popup.js", "options.html", "options.js"]);
  for (const cs of m.content_scripts || []) [...(cs.js || []), ...(cs.css || [])].forEach((f) => list.add(f));
  return [...list];
})();

async function signature() {
  const parts = await Promise.all(FILES.map(async (f) => {
    try {
      const r = await fetch(chrome.runtime.getURL(f), { cache: "no-store" });
      return f + ":" + (await r.text());
    } catch (e) {
      return f + ":missing";
    }
  }));
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\n")));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let isDev = null;
async function devMode() {
  if (isDev === null) isDev = (await chrome.management.getSelf()).installType === "development";
  return isDev;
}

let checking = false;
async function checkForUpdate() {
  if (checking || !(await devMode())) return;
  checking = true;
  try {
    const now = await signature();
    const { fphSignature } = await chrome.storage.session.get("fphSignature");
    if (!fphSignature) {
      await chrome.storage.session.set({ fphSignature: now });
    } else if (fphSignature !== now) {
      // Файлы могли меняться прямо сейчас (правка в процессе) — ждём, пока они перестанут меняться,
      // иначе Chrome загрузит недописанный файл и автообновление решит, что всё уже свежее.
      await new Promise((r) => setTimeout(r, 3000));
      if ((await signature()) !== now) return;
      await chrome.storage.local.set({ fphReloadedAt: Date.now() });
      chrome.runtime.reload();
    }
  } finally {
    checking = false;
  }
}

chrome.runtime.onStartup.addListener(checkForUpdate);
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.session.set({ fphSignature: await signature() });
  chrome.alarms.create("fph-update", { periodInMinutes: 0.5 });
  // Если это была автоперезагрузка — обновляем вкладки FunPay, где не идёт набор текста.
  const { fphReloadedAt } = await chrome.storage.local.get("fphReloadedAt");
  if (fphReloadedAt && Date.now() - fphReloadedAt < 60000) {
    await chrome.storage.local.remove("fphReloadedAt");
    const tabs = await chrome.tabs.query({ url: "https://funpay.com/*" });
    for (const t of tabs) if (!t.active || !/\/chat\//.test(t.url || "")) chrome.tabs.reload(t.id);
  }
});
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "fph-update") checkForUpdate(); });
chrome.tabs.onUpdated.addListener((id, info, tab) => {
  if (info.status === "loading" && /^https:\/\/funpay\.com\//.test(tab.url || "")) checkForUpdate();
});
chrome.alarms.get("fph-update", (a) => { if (!a) chrome.alarms.create("fph-update", { periodInMinutes: 0.5 }); });
