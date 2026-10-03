// Google sign-in gate. The server (/api/*) is the source of truth; this only drives the UI.
(function () {
  const $ = (id) => document.getElementById(id);
  const gate = $("gate"), msg = $("gateMsg"), who = $("who");

  function say(text) { msg.textContent = text || ""; msg.hidden = !text; }

  function showUser(u) {
    document.body.classList.remove("signed-out");
    gate.hidden = true;
    who.innerHTML = "";
    const l1 = document.createElement("span"); l1.textContent = "Signed in as";
    const name = document.createElement("strong"); name.textContent = u.name || u.email;
    who.append(l1, document.createElement("br"), name);
    const row = document.createElement("div"); row.className = "who-links";
    if (u.admin) { const a = document.createElement("a"); a.href = "/admin/"; a.textContent = "Manage access"; row.append(a); }
    const out = document.createElement("button"); out.type = "button"; out.textContent = "Sign out";
    out.onclick = async () => {
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      location.reload();
    };
    row.append(out);
    who.append(row);
  }

  async function onCredential(resp) {
    say("");
    const r = await fetch("/api/auth/google", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential: resp.credential }),
    }).catch(() => null);
    if (!r) return say("Could not reach the server. Try again.");
    const data = await r.json().catch(() => ({}));
    if (r.ok) return location.reload();
    if (r.status === 403) return say(`${data.email || "That account"} is not authorized for this site. Use your Synergy account, or ask the George & Noonan team for access.`);
    say("Sign-in failed. Please try again.");
  }

  function renderButton(clientId) {
    const init = () => {
      google.accounts.id.initialize({ client_id: clientId, callback: onCredential, auto_select: false });
      google.accounts.id.renderButton($("gBtn"), { theme: "outline", size: "large", text: "signin_with", shape: "pill", width: 280 });
    };
    if (window.google && google.accounts) return init();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.onload = init;
    s.onerror = () => say("Could not load Google sign-in. Check your connection and try again.");
    document.head.append(s);
  }

  async function start() {
    const me = await fetch("/api/me").catch(() => null);
    if (me && me.ok) return showUser(await me.json());
    gate.hidden = false;
    const cfg = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
    if (!cfg.googleClientId) return say("Sign-in is not set up yet. Ask an administrator to finish configuration.");
    renderButton(cfg.googleClientId);
  }
  start();
})();
