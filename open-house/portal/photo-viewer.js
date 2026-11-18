// Shows a feedback photo full screen on the page instead of opening the bare image, which on a phone
// (a home-screen app, a link opened from a text) leaves no way back. Any <a data-photo href="…"> opens it;
// links in the same parent are one set, so the arrows step through them. Close with the × button, Escape,
// a tap outside the photo, or the phone's Back gesture. The href stays real, so a long press can still
// save or share the photo.
(function () {
  const css = `
.ohpv{position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;border:0;background:#000;color:#fff}
.ohpv::backdrop{background:#000}
.ohpv img{position:absolute;inset:0;margin:auto;max-width:100%;max-height:100%;object-fit:contain;z-index:0}
.ohpv button{position:absolute;z-index:1;border:0;border-radius:999px;background:rgba(48,48,48,.85);box-shadow:0 0 0 1px rgba(255,255,255,.25);color:#fff;font:600 1rem/1 Figtree,system-ui,sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px}
.ohpv .ohpv-close{top:calc(env(safe-area-inset-top) + 12px);right:12px;height:44px;padding:0 16px}
.ohpv .ohpv-close span{font-size:1.5rem;line-height:1;margin-top:-2px}
.ohpv .ohpv-prev,.ohpv .ohpv-next{top:50%;transform:translateY(-50%);width:44px;height:44px;font-size:1.6rem}
.ohpv .ohpv-prev{left:10px}.ohpv .ohpv-next{right:10px}
.ohpv .ohpv-count{position:absolute;z-index:1;left:50%;transform:translateX(-50%);padding:6px 12px;border-radius:999px;background:rgba(48,48,48,.85);white-space:nowrap;bottom:calc(env(safe-area-inset-bottom) + 14px);font:500 .9rem Figtree,system-ui,sans-serif}
.ohpv:focus{outline:none}
.ohpv button:focus-visible{outline:2px solid #fff;outline-offset:2px}`;
  document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);

  let d = null;

  function open(link) {
    if (d) return; // one photo at a time
    const set = [...link.parentElement.querySelectorAll("a[data-photo]")];
    let i = Math.max(0, set.indexOf(link));
    const back = document.activeElement;
    d = document.createElement("dialog");
    d.className = "ohpv";
    d.setAttribute("aria-label", "Photo");
    d.innerHTML = `<img alt="">
      <button type="button" class="ohpv-close" aria-label="Close photo"><span aria-hidden="true">&times;</span>Close</button>
      ${set.length > 1 ? '<button type="button" class="ohpv-prev" aria-label="Previous photo">&lsaquo;</button><button type="button" class="ohpv-next" aria-label="Next photo">&rsaquo;</button><div class="ohpv-count"></div>' : ""}`;
    const img = d.querySelector("img");
    const show = (n) => {
      i = (n + set.length) % set.length;
      img.src = set[i].href;
      img.alt = (set[i].querySelector("img") || {}).alt || "Photo";
      const c = d.querySelector(".ohpv-count");
      if (c) c.textContent = `${i + 1} of ${set.length}`;
    };
    d.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) { if (e.target !== img) close(); return; } // a tap outside the photo
      if (b.classList.contains("ohpv-close")) close();
      else show(i + (b.classList.contains("ohpv-next") ? 1 : -1));
    });
    d.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      else if (set.length > 1 && e.key === "ArrowRight") show(i + 1);
      else if (set.length > 1 && e.key === "ArrowLeft") show(i - 1);
    });
    // Swipe left or right to step through the set.
    let x0 = null;
    d.addEventListener("touchstart", (e) => { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
    d.addEventListener("touchend", (e) => {
      if (x0 === null || set.length < 2) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1));
      x0 = null;
    });
    const box = d;
    box.addEventListener("close", () => {
      box.remove();
      if (d === box) d = null;
      if (back && back.isConnected) back.focus();
    });
    show(i);
    document.body.append(d);
    d.showModal();
    d.tabIndex = -1; d.focus(); // the box, not the Close button, so no focus ring shows on a phone
    // An extra history entry, so the phone's Back gesture closes the photo rather than leaving the page.
    history.pushState({ ohPhoto: true }, "");
  }

  // Close at once, then step back over the photo's history entry. Waiting for that step to close it could
  // leave the photo up when the browser is slow to report it.
  function close() {
    if (!d) return;
    const shown = d;
    d = null;
    shown.close();
    shown.remove();
    if (history.state && history.state.ohPhoto) history.back();
  }

  // The phone's Back gesture (or the step back above, by which time d is already null).
  window.addEventListener("popstate", () => { if (d) close(); });

  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[data-photo]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || typeof HTMLDialogElement !== "function") return;
    e.preventDefault();
    open(a);
  });
})();
