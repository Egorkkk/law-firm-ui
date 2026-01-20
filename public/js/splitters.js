export function initSplitters({
  layoutEl,
  splitVEl,
  splitHEl,
  initialColLeft = 40,
  initialRowTop = 40,
  minPanelPx = 180,
  storageKey = "lawui:splits"
}) {
  const stage = layoutEl;

  const saved = safeParse(localStorage.getItem(storageKey));
  let colLeft = clamp(saved?.colLeft ?? initialColLeft, 10, 90);
  let rowTop  = clamp(saved?.rowTop  ?? initialRowTop, 10, 90);

  apply();

  function apply() {
    stage.style.setProperty("--colLeft", `${colLeft}%`);
    stage.style.setProperty("--rowTop", `${rowTop}%`);
    // positions for absolute splitters
    splitVEl.style.left = `calc(${colLeft}% - 5px)`;
    splitHEl.style.top = `calc(${rowTop}% - 5px)`;
    localStorage.setItem(storageKey, JSON.stringify({ colLeft, rowTop }));
  }

  function pxToPercentX(px) {
    const rect = stage.getBoundingClientRect();
    return (px / rect.width) * 100;
  }
  function pxToPercentY(px) {
    const rect = stage.getBoundingClientRect();
    return (px / rect.height) * 100;
  }

  function clampByMinPanelsCol(percent) {
    const rect = stage.getBoundingClientRect();
    const leftPx = (percent / 100) * rect.width;
    const rightPx = rect.width - leftPx;
    if (leftPx < minPanelPx) return (minPanelPx / rect.width) * 100;
    if (rightPx < minPanelPx) return 100 - (minPanelPx / rect.width) * 100;
    return percent;
  }

  function clampByMinPanelsRow(percent) {
    const rect = stage.getBoundingClientRect();
    const topPx = (percent / 100) * rect.height;
    const botPx = rect.height - topPx;
    if (topPx < minPanelPx) return (minPanelPx / rect.height) * 100;
    if (botPx < minPanelPx) return 100 - (minPanelPx / rect.height) * 100;
    return percent;
  }

  drag(splitVEl, (e) => {
    const rect = stage.getBoundingClientRect();
    colLeft = clampByMinPanelsCol(pxToPercentX(e.clientX - rect.left));
    colLeft = clamp(colLeft, 10, 90);
    apply();
  });

  drag(splitHEl, (e) => {
    const rect = stage.getBoundingClientRect();
    rowTop = clampByMinPanelsRow(pxToPercentY(e.clientY - rect.top));
    rowTop = clamp(rowTop, 10, 90);
    apply();
  });

  function drag(el, onMove) {
    let active = false;

    el.addEventListener("pointerdown", (e) => {
      active = true;
      el.setPointerCapture(e.pointerId);
      document.body.style.userSelect = "none";
    });

    el.addEventListener("pointermove", (e) => {
      if (!active) return;
      onMove(e);
    });

    el.addEventListener("pointerup", () => {
      active = false;
      document.body.style.userSelect = "";
    });

    el.addEventListener("pointercancel", () => {
      active = false;
      document.body.style.userSelect = "";
    });
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
}
