// Site-styled dialogs in place of the browser's confirm(), alert() and prompt() (styles in dialog.css).
// Each returns a Promise: confirm gives true or false, alert gives nothing, prompt gives the text typed
// (or null when cancelled). Built on <dialog>, so focus stays inside it, Escape cancels, and the page
// behind can't be clicked; a click outside the box cancels too.
//   OHDialog.confirm({ title, body, ok: "Remove", cancel: "Keep", danger: true })
//   OHDialog.alert({ title, body })
//   OHDialog.prompt({ title, body, label: "Reason (optional)", ok: "Send" })
window.OHDialog = (function () {
  function open({ title, body = "", ok = "OK", cancel = "Cancel", danger = false, label = null, placeholder = "" }) {
    return new Promise((resolve) => {
      const back = document.activeElement;
      const d = document.createElement("dialog");
      d.className = "ohd";
      d.setAttribute("aria-labelledby", "ohdTitle");
      d.setAttribute("aria-describedby", "ohdBody");
      d.innerHTML = `<form method="dialog">
        <h2 class="ohd-title" id="ohdTitle"></h2>
        <p class="ohd-body" id="ohdBody"></p>
        ${label !== null ? '<label class="ohd-label" for="ohdInput"></label><textarea class="ohd-input" id="ohdInput" maxlength="500"></textarea>' : ""}
        <div class="ohd-actions">${cancel ? '<button class="ohd-btn ohd-ghost" value="cancel"></button>' : ""}<button class="ohd-btn${danger ? " ohd-danger" : ""}" value="ok"></button></div>
      </form>`;
      d.querySelector(".ohd-title").textContent = title;
      d.querySelector(".ohd-body").textContent = body;
      d.querySelector('[value="ok"]').textContent = ok;
      if (cancel) d.querySelector('[value="cancel"]').textContent = cancel;
      const input = d.querySelector(".ohd-input");
      if (input) { d.querySelector(".ohd-label").textContent = label; input.placeholder = placeholder; }

      d.addEventListener("click", (e) => { if (e.target === d) d.close("cancel"); }); // the backdrop
      // Escape closes only this box, not a panel the page closes on Escape too (the agent portal's home details).
      d.addEventListener("keydown", (e) => { if (e.key === "Escape") e.stopPropagation(); });
      d.addEventListener("close", () => {
        const yes = d.returnValue === "ok";
        d.remove();
        if (back && back.isConnected) back.focus();
        resolve(input ? (yes ? input.value.trim() : null) : yes);
      });
      document.body.append(d);
      d.showModal();
      // Typing goes straight into the box; a risky action starts on the safe button.
      (input || d.querySelector(danger && cancel ? '[value="cancel"]' : '[value="ok"]')).focus();
    });
  }
  return {
    confirm: (o) => open(o),
    alert: (o) => open({ ok: "OK", ...o, cancel: null }).then(() => undefined),
    prompt: (o) => open({ label: "", ...o }),
  };
})();
