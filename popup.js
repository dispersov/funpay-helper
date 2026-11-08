const T = FPH_THEME;
const sel = document.getElementById("preset");

chrome.storage.local.get("settings", (r) => {
  const S = T.merge(T.DEFAULTS, r.settings);
  const paint = () => {
    const view = T.palette(S).off ? T.merge(S, { theme: { preset: "dark", wallpaper: { type: "none" } } }) : T.merge(S, { theme: { wallpaper: { type: "none" } } });
    document.getElementById("fph-vars")?.remove();
    const st = document.createElement("style");
    st.id = "fph-vars";
    st.textContent = T.varsCss(view);
    document.head.append(st);
  };
  for (const [id, p] of Object.entries(T.PRESETS)) sel.append(new Option(p.name, id, false, id === S.theme.preset));
  sel.addEventListener("change", () => {
    S.theme.preset = sel.value;
    chrome.storage.local.set({ settings: S });
    paint();
  });
  paint();
});

document.querySelectorAll("a[data-url]").forEach((a) =>
  a.addEventListener("click", () => chrome.tabs.create({ url: a.dataset.url })));
