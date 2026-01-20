export function initTabs(rootEl, defaultTab = null) {
  const tabs = Array.from(rootEl.querySelectorAll("[data-tab]"));
  const panes = Array.from(rootEl.querySelectorAll("[data-pane]"));

  function activate(name) {
    tabs.forEach(t => t.classList.toggle("is-active", t.dataset.tab === name));
    panes.forEach(p => p.classList.toggle("is-active", p.dataset.pane === name));
  }

  tabs.forEach(t => {
    t.addEventListener("click", () => activate(t.dataset.tab));
  });

  activate(defaultTab || (tabs[0]?.dataset.tab ?? "overview"));
  return { activate };
}
