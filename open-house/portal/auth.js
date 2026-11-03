// Google sign-in gate for the agent pages, then the Support and Referral Agreement for agents who haven't
// signed it, and their top navigation once they're in (nav.js).
// The server (/api/*) is the source of truth; this only drives the UI.
(function () {
  const $ = (id) => document.getElementById(id);
  const gate = $("gate"), msg = $("gateMsg");

  function say(text) { msg.textContent = text || ""; msg.hidden = !text; }

  function showUser(u) {
    document.body.classList.remove("signed-out");
    gate.hidden = true;
    // <body data-page="..."> says which page this is, so its link is marked as the current one.
    OHNav.mount({ current: document.body.dataset.page, user: u, links: [
      { key: "weekend", href: "/", label: "This weekend" },
      { key: "mine", href: "/my-open-houses/", label: "My Requests" },
      { key: "how", href: "/how-it-works/", label: "How it works" },
      ...(u.team ? [{ key: "admin", href: "/admin/", label: "Admin Console" }] : []),
    ] });
    document.dispatchEvent(new CustomEvent("signedin", { detail: u }));
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

  // Agents sign the Support and Referral Agreement in DocuSeal before using the portal (netlify/lib/agreement.mjs).
  // "Read and sign" takes them to DocuSeal, which sends them back here with ?agreement=signed; the server then
  // checks with DocuSeal and records when they signed. One they started and left is checked the same way.
  async function askToSign(u, back) {
    gate.hidden = false;
    $("gateTitle").textContent = "Sign the Support and Referral Agreement";
    $("gateTitle").nextElementSibling.textContent = "Before you request George & Noonan open houses, read and sign our agreement. It covers open house duties and the referral fee on leads from our listings. You sign it once, on DocuSeal, and come right back here.";
    $("gBtn").outerHTML = '<button type="button" class="gate-go" id="signGo"></button>';
    msg.insertAdjacentHTML("afterend", '<p class="gate-who">Signed in as <b></b><br><button type="button" class="gate-link" id="signOut">Use a different account</button></p>');
    gate.querySelector(".gate-who b").textContent = u.email;
    $("signOut").onclick = async () => { await fetch("/api/auth/logout", { method: "POST" }).catch(() => {}); location.reload(); };

    const go = $("signGo");
    const label = () => { go.disabled = false; go.textContent = u.agreement === "pending" ? "Continue signing" : "Read and sign"; };
    const wait = (text) => { go.disabled = true; go.textContent = text; };
    go.onclick = async () => {
      say(""); wait("Opening the agreement…");
      const r = await fetch("/api/agreement", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: location.pathname }) }).catch(() => null);
      const d = r ? await r.json().catch(() => ({})) : {};
      if (r && r.ok && d.signed) return location.reload();
      if (r && r.ok && d.url) return location.assign(d.url);
      label(); say(d.message || "Could not open the agreement. Check your connection and try again.");
    };
    const declined = () => say("You declined the agreement, so the portal isn't open to you yet. You can read and sign it any time. Questions? Email team@georgeandnoonan.com.");
    label();
    if (!back && u.agreement !== "pending") return u.agreement === "declined" && declined();
    wait("Checking your signature…");
    const r = await fetch("/api/agreement").catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    // Signed: load the page afresh (its first data request went out before signing and was refused).
    if (r && r.ok && d.signed) return location.reload();
    u.agreement = d.status || u.agreement;
    label();
    if (d.status === "declined") declined();
    else if (back) say(r && r.ok ? "It isn't signed yet. Tap Continue signing to finish." : "Could not check your signature. Reload the page to try again.");
  }

  async function start() {
    // Back from DocuSeal: note it, and take the marker out of the address.
    const q = new URLSearchParams(location.search), back = q.has("agreement");
    if (back) { q.delete("agreement"); const s = q.toString(); history.replaceState(null, "", location.pathname + (s ? "?" + s : "") + location.hash); }
    const me = await fetch("/api/me").catch(() => null);
    if (me && me.ok) { const u = await me.json(); return u.mustSign ? askToSign(u, back) : showUser(u); }
    gate.hidden = false;
    const cfg = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
    if (!cfg.googleClientId) return say("Sign-in is not set up yet. Ask an administrator to finish configuration.");
    renderButton(cfg.googleClientId);
  }
  start();
})();
