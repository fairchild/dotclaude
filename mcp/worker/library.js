/* The library's keyboard grammar, shared by every page: Esc zooms out one level
   of the path hierarchy (/view/<skill>/<file> → /skills/<skill>/ → /), Tab and
   the arrows move across a level, Enter goes deeper. A page claims a key for
   itself first by calling preventDefault; this listens on window, after it. */
(() => {
  const cameFrom = "library:came-from";

  const parentOf = (path) => {
    const file = path.match(/^\/view\/([^/]+)\/./);
    if (file) return `/skills/${file[1]}/`;
    return /^\/skills?\/[^/]+\/?$/.test(path) ? "/" : null;
  };
  const editing = (element) => !!element && (element.isContentEditable
    || ((element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT") && !element.readOnly));
  const shown = (element) => !element.closest("[hidden]");

  function up() {
    const parent = parentOf(location.pathname);
    if (!parent) return false;
    try { sessionStorage.setItem(cameFrom, location.pathname); } catch {}
    let previous = null;
    try { previous = new URL(document.referrer); } catch {}
    // Going back restores the parent as it was left: its filter, scroll and
    // place in history. Any other way in navigates to the parent fresh.
    const canGoBack = window.navigation?.canGoBack ?? history.length > 1;
    if (previous?.origin === location.origin && previous.pathname === parent && canGoBack) history.back();
    else location.assign(parent);
    return true;
  }

  /** Back on a parent, focus the link to the child just left, so the arrows carry on among its siblings. */
  function arrive() {
    let child = null;
    try { child = sessionStorage.getItem(cameFrom); sessionStorage.removeItem(cameFrom); } catch {}
    if (!child) return;
    const link = [...document.querySelectorAll("main a[href]")]
      .find((a) => a.origin === location.origin && a.pathname === child && shown(a));
    if (!link) return;
    for (let details = link.closest("details"); details; details = details.parentElement?.closest("details")) details.open = true;
    link.focus();
  }

  /** ↑ and ↓ walk a list of sibling links; at either end they stay put. */
  function walk(event) {
    const list = document.activeElement?.closest?.("[data-siblings]");
    if (!list) return false;
    const links = [...list.querySelectorAll("a[href]")].filter(shown);
    const at = links.indexOf(document.activeElement);
    if (at === -1) return false;
    links[Math.max(0, Math.min(links.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))].focus();
    return true;
  }

  /** ← and → follow the page's rel=prev / rel=next links, unless focus sits in something that scrolls sideways. */
  function turn(event) {
    if (document.activeElement?.closest?.("pre, .table-scroll")) return false;
    const target = document.querySelector(event.key === "ArrowLeft" ? 'a[rel="prev"]' : 'a[rel="next"]');
    if (!target) return false;
    target.click();
    return true;
  }

  addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    if (editing(document.activeElement)) return;
    const handled = event.key === "Escape" ? up()
      : event.key === "ArrowDown" || event.key === "ArrowUp" ? walk(event)
      : event.key === "ArrowLeft" || event.key === "ArrowRight" ? !event.shiftKey && turn(event)
      : false;
    if (handled) event.preventDefault();
  });
  document.addEventListener("DOMContentLoaded", () => {
    for (const hint of document.querySelectorAll("p.hint[data-keys]")) hint.hidden = false;
    arrive();
  });
  addEventListener("pageshow", (event) => { if (event.persisted) arrive(); });
})();
