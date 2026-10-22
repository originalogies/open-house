// Top navigation bar shared by the agent portal and the Admin Console (styles in nav.css).
// The page's HTML has the bar with just the logo; once someone is signed in, mount() adds the links,
// who's signed in and Sign out. Below 760px those sit in a menu behind a hamburger button, which
// closes on a link tap, a tap outside, Escape, or widening the window.
window.OHNav = (function () {
  let header = null;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // links: [{ key, href, label, count? (id of a badge the page fills in) }]; current: the key of this page.
  function mount({ links, current, user }) {
    header = document.getElementById("topnav");
    const bar = header.querySelector(".topnav-bar");
    bar.insertAdjacentHTML("beforeend", `
      <button class="topnav-toggle" type="button" aria-expanded="false" aria-controls="topnavMenu" aria-label="Open menu"><span></span><span></span><span></span></button>
      <div class="topnav-menu" id="topnavMenu"><div class="topnav-menu-inner">
        <nav class="topnav-links" aria-label="Main">${links.map((l) => `<a href="${esc(l.href)}" data-key="${esc(l.key)}"${l.key === current ? ' aria-current="page"' : ""}>${esc(l.label)}${l.count ? `<span class="topnav-count" id="${esc(l.count)}" hidden></span>` : ""}</a>`).join("")}</nav>
        ${user ? `<div class="topnav-user"><span>Signed in as <strong>${esc(user.name || user.email)}</strong></span><button type="button" class="topnav-signout">Sign out</button></div>` : ""}
      </div></div>`);

    const toggle = bar.querySelector(".topnav-toggle"), menu = bar.querySelector(".topnav-menu");
    const isOpen = () => header.classList.contains("open");
    const set = (open) => {
      header.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    };
    toggle.onclick = () => set(!isOpen());
    menu.addEventListener("click", (e) => { if (e.target.closest("a")) set(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) { set(false); toggle.focus(); } });
    document.addEventListener("click", (e) => { if (isOpen() && !header.contains(e.target)) set(false); });
    matchMedia("(min-width: 761px)").addEventListener("change", (e) => { if (e.matches) set(false); });

    const out = bar.querySelector(".topnav-signout");
    if (out) out.onclick = async () => { await fetch("/api/auth/logout", { method: "POST" }).catch(() => {}); location.reload(); };
  }

  // For pages that switch views without reloading (the Admin Console's sections).
  function setCurrent(key) {
    header?.querySelectorAll(".topnav-links a").forEach((a) => {
      if (a.dataset.key === key) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }

  return { mount, setCurrent };
})();
