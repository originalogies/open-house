// Admin Console: one page, five views (Requests, Feedback, Listings, Agents, Settings) chosen by the URL hash.
// The server checks roles on every API call; hiding tabs here is only for a tidy UI.
(function () {
  const $ = (id) => document.getElementById(id);
  const view = $("view");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "$" + Number(n || 0).toLocaleString("en-US");
  const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const fmtDate = (ms) => ms ? new Date(ms).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const STATUS = { pending: "Waiting", approved: "Approved", declined: "Declined", expired: "Expired", cancelled: "Cancelled" };
  // MLS status of approved and cancelled open houses: [pill class, label]. "synced" means the MLS matches.
  const MLS = {
    manual: ["", "Entered by hand"], idle: ["pending", "Waiting for MLS bot"], booking: ["pending", "MLS bot working"],
    synced: ["approved", "On the MLS"], dry_run_ok: ["approved", "Dry run passed"], failed: ["declined", "MLS update failed"], needs_login: ["declined", "MLS sign-in needed"],
    not_on_mls: ["", "Home not on the MLS yet"],
  };
  const mlsCell = (r) => {
    if (r.status !== "approved" && r.status !== "cancelled") return '<span class="sub">—</span>';
    let [c, t] = MLS[r.mlsState] || ["", mode === "off" ? "Entered by hand" : "Not sent yet"];
    if (r.status === "cancelled" && r.mlsState === "synced") t = "Cancelled on the MLS";
    if (r.status === "cancelled" && (r.mlsState === "manual" || (!r.mlsState && mode === "off"))) t = "Remove by hand";
    return `<span class="pill ${c}">${esc(t)}</span><div class="sub"><a href="/respond/?id=${encodeURIComponent(r.id)}">MLS status</a></div>`;
  };
  // Listing photos are Repliers CDN paths; built-in listings may carry a full URL, and homes the team
  // added before they're on the MLS have photos on this site ("/api/home-photo?...").
  const photo = (img, size = "small") => !img ? "" : /^(https?:|\/)/.test(img) ? img : `https://cdn.repliers.io/${img}?class=${size}`;
  const pill = (s) => `<span class="pill ${esc(s)}">${esc(STATUS[s] || s)}</span>`;
  // The agent's feedback after hosting: a line under the status, and the full text on demand.
  const INTEREST = { lots: "Lots", some: "Some", little: "Little" };
  const PRICE = { high: "Too high", right: "About right", value: "Good value", none: "Didn't come up" };
  const fbLine = (r) => r.feedback ? `<div class="sub">${r.feedback.brokerFlag ? '<b class="flagged">⚠ Flagged for broker</b> · ' : ""}<button class="link" data-fb="${esc(r.id)}">Feedback</button></div>`
    : r.feedbackDue ? '<div class="sub">Waiting on feedback</div>' : "";
  // Feedback sent before the guest questions existed has "What happened" in their place.
  const fbText = (f) => { const none = '<span class="sub">Nothing noted</span>'; return `<dl class="fb">
      <div><dt>Visitors</dt><dd>${f.visitors}</dd></div><div><dt>Interest</dt><dd>${esc(INTEREST[f.interest] || f.interest)}</dd></div>
      ${f.price ? `<div><dt>Price</dt><dd>${esc(PRICE[f.price])}</dd></div>` : ""}
      ${f.happened != null ? `<div class="wide"><dt>What happened</dt><dd>${esc(f.happened)}</dd></div>` : `
      <div class="wide"><dt>What guests liked</dt><dd>${f.liked ? esc(f.liked) : none}</dd></div>
      <div class="wide"><dt>What guests didn't like or would change</dt><dd>${f.disliked ? esc(f.disliked) : none}</dd></div>
      ${f.forSeller ? `<div class="wide"><dt>Additional feedback</dt><dd>${esc(f.forSeller)}</dd></div>` : ""}`}
      <div class="wide"><dt>Notes for the team</dt><dd>${f.teamNotes ? esc(f.teamNotes) : '<span class="sub">None</span>'}</dd></div>
      ${(f.photos || []).length ? `<div class="wide"><dt>Photos</dt><dd class="fbphotos">${f.photos.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Photo from the open house" loading="lazy"></a>`).join("")}</dd></div>` : ""}</dl>`; };

  let me = null;
  let requests = [];
  let mode = "off"; // MLS_BOOKING_MODE: off means the team enters the MLS by hand

  let toastTimer;
  function toast(text, err) {
    const el = $("toast"); clearTimeout(toastTimer);
    el.textContent = text; el.className = "show" + (err ? " err" : "");
    toastTimer = setTimeout(() => el.classList.remove("show"), err ? 5000 : 2600);
  }

  async function api(method, url, body) {
    const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
    const data = r ? await r.json().catch(() => ({})) : {};
    return { ok: !!(r && r.ok), status: r ? r.status : 0, data };
  }

  // ---- sign-in and frame ---------------------------------------------------
  async function showGate() {
    $("gate").hidden = false;
    const msg = $("gateMsg");
    const say = (t) => { msg.textContent = t; msg.hidden = !t; };
    const cfg = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
    if (!cfg.googleClientId) return say("Sign-in is not set up yet. Ask an administrator to finish configuration.");
    const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => {
      google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: async (resp) => {
        const r = await api("POST", "/api/auth/google", { credential: resp.credential });
        if (r.ok) return location.reload();
        say(r.status === 403 ? `${r.data.email || "That account"} is not authorized for this site.` : "Sign-in failed. Try again.");
      } });
      google.accounts.id.renderButton($("gBtn"), { theme: "outline", size: "large", shape: "pill", width: 280 });
    };
    document.head.append(s);
  }

  // Top navigation (nav.js): the sections this person can use, the agent portal, and Sign out.
  function renderNav() {
    const sections = !me.team ? [] : [
      { key: "requests", href: "#requests", label: "Requests", count: "pendingCount" },
      { key: "feedback", href: "#feedback", label: "Feedback" },
      { key: "listings", href: "#listings", label: "Listings" },
      ...(me.admin ? [{ key: "agents", href: "#agents", label: "Agents" }, { key: "settings", href: "#settings", label: "Settings" }] : []),
    ];
    OHNav.mount({ user: me, links: [...sections, { key: "portal", href: "/", label: "Agent portal" }] });
  }

  const VIEWS = { requests: renderRequests, feedback: renderFeedback, listings: renderListings, agents: renderAgents, settings: renderSettings };
  // Links to one agent's history look like #agent/name@example.com.
  const agentLink = (email, label) => `<a href="#agent/${encodeURIComponent(email)}">${esc(label || email)}</a>`;

  function route() {
    flushSaves(); // finish any listing edits still waiting to autosave
    const [hashName, arg] = location.hash.slice(1).split("/");
    let name = hashName || "requests";
    if (name === "agent" && arg) {
      OHNav.setCurrent(me.admin ? "agents" : "requests");
      view.innerHTML = '<p class="empty">Loading…</p>';
      renderAgent(decodeURIComponent(arg).toLowerCase());
      window.scrollTo(0, 0);
      return;
    }
    if (name === "home" && arg) {
      OHNav.setCurrent("feedback");
      view.innerHTML = '<p class="empty">Loading…</p>';
      renderHome(decodeURIComponent(arg));
      window.scrollTo(0, 0);
      return;
    }
    if (!VIEWS[name] || ((name === "agents" || name === "settings") && !me.admin)) name = "requests";
    OHNav.setCurrent(name);
    view.innerHTML = '<p class="empty">Loading…</p>';
    VIEWS[name]();
    window.scrollTo(0, 0);
  }

  async function loadRequests() {
    const r = await api("GET", "/api/team/requests");
    if (r.ok) { requests = r.data.requests; mode = r.data.mode || "off"; }
    const n = requests.filter((x) => x.status === "pending" || asksToCancel(x)).length;
    $("pendingCount").textContent = n; $("pendingCount").hidden = !n;
    return r.ok;
  }
  // The agent asked to cancel and the open house hasn't happened yet.
  const asksToCancel = (r) => !!r.cancelRequest && r.iso >= todayIso();

  async function start() {
    const r = await api("GET", "/api/me");
    if (r.status === 401) return showGate();
    if (!r.ok) { view.innerHTML = '<p class="empty">Could not reach the server.</p>'; return; }
    me = r.data;
    renderNav();
    if (!me.team) {
      view.innerHTML = `<section class="intro"><div><h1>Team members only</h1><p class="sub">The Admin Console is for the George &amp; Noonan team. You can still request open houses on the <a href="/">agent portal</a>.</p></div></section>`;
      return;
    }
    window.addEventListener("hashchange", route);
    await loadRequests();
    route();
  }

  // ---- Requests ------------------------------------------------------------
  let reqFilter = "all", reqSearch = "";

  async function renderRequests() {
    if (!(await loadRequests())) { view.innerHTML = '<p class="empty">Could not load requests.</p>'; return; }
    const today = todayIso();
    const pending = requests.filter((r) => r.status === "pending");
    const asks = requests.filter(asksToCancel);
    const upcoming = requests.filter((r) => r.status === "approved" && r.iso >= today);
    const agents = new Set(requests.map((r) => r.agent.email));
    // Feedback agents sent in the last 14 days, broker flags first.
    const recent = requests.filter((r) => r.feedback && Date.now() - r.feedback.at < 14 * 864e5)
      .sort((a, b) => Number(b.feedback.brokerFlag) - Number(a.feedback.brokerFlag) || b.feedback.at - a.feedback.at);

    view.innerHTML = `
      <section class="intro"><div><h1>Open house requests</h1>
        <p class="sub">Approve or decline requests from Synergy agents. The first approval locks the time, and the agent gets the confirmation email with access details. Agents can't cancel on their own; their cancellation requests show up here too.</p></div></section>
      <div class="stats">
        <div class="card stat"><b>${pending.filter((r) => !r.cancelRequest).length + asks.length}</b><span>Waiting for a decision</span></div>
        <div class="card stat"><b>${upcoming.length}</b><span>Upcoming approved</span></div>
        <div class="card stat"><b>${requests.filter((r) => r.status === "approved").length}</b><span>Approved all time</span></div>
        <div class="card stat"><b>${agents.size}</b><span>Agents who requested</span></div>
      </div>
      <h2 class="section">Needs a decision</h2>
      <div class="queue" id="queue"></div>
      ${recent.length ? `<h2 class="section">Recent feedback</h2><div class="queue" id="feedback"></div>` : ""}
      <h2 class="section">All requests</h2>
      <div class="toolbar">
        <div class="chips" id="chips">${["all", "pending", "approved", "declined", "expired", "cancelled"].map((s) =>
          `<button class="chip" data-s="${s}" aria-pressed="${s === reqFilter}">${s === "all" ? "All" : STATUS[s]}</button>`).join("")}</div>
        <input class="field" id="search" type="search" placeholder="Search agent or address" value="${esc(reqSearch)}" aria-label="Search requests">
        <span class="spacer"></span>
        <button class="btn ghost small" id="csv">Export CSV</button>
      </div>
      <div class="card table-wrap"><table class="stack"><thead><tr><th>Open house</th><th>Home</th><th>Agent</th><th>Status</th><th>Decided</th><th>MLS</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>`;

    const q = $("queue");
    const waiting = [...asks, ...pending.filter((r) => !r.cancelRequest)];
    if (!waiting.length) q.innerHTML = '<div class="card empty">Nothing waiting. New requests and cancellation requests show up here.</div>';
    waiting.sort((a, b) => a.iso.localeCompare(b.iso) || a.from - b.from).forEach((r) => q.append(r.cancelRequest ? cancelCard(r) : pendingCard(r)));
    recent.forEach((r) => $("feedback").append(feedbackCard(r)));

    $("chips").onclick = (e) => { const b = e.target.closest(".chip"); if (!b) return; reqFilter = b.dataset.s; $("chips").querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", c === b)); fillRows(); };
    $("search").oninput = (e) => { reqSearch = e.target.value; fillRows(); };
    $("csv").onclick = () => exportCsv();
    fillRows();
  }

  function filtered() {
    const s = reqSearch.trim().toLowerCase();
    return requests.filter((r) => (reqFilter === "all" || r.status === reqFilter)
      && (!s || [r.agent.name, r.agent.email, r.addr, r.city, r.mls].join(" ").toLowerCase().includes(s)));
  }

  function fillRows() {
    const list = filtered().slice().sort((a, b) => b.iso.localeCompare(a.iso) || a.from - b.from);
    $("rows").innerHTML = list.length ? list.map((r) => `<tr>
        <td data-l="Open house"><b>${esc(r.day)}, ${esc(r.date)}</b><div class="sub">${esc(r.time)}</div></td>
        <td data-l="Home">${esc(r.addr)}<div class="sub">${esc(r.city)} · MLS# ${esc(r.mls)}</div></td>
        <td data-l="Agent">${agentLink(r.agent.email, r.agent.name)}<div class="sub">${esc(r.agent.email)}</div></td>
        <td data-l="Status">${pill(r.status)}${r.cancelRequest ? '<div class="sub">Agent asked to cancel</div>' : ""}${r.cancelledBy ? `<div class="sub">by ${esc(r.cancelledBy)}</div>` : ""}${fbLine(r)}</td>
        <td data-l="Decided">${r.decidedBy ? `${esc(r.decidedBy)}<div class="sub">${esc(fmtDate(r.decidedAt))}</div>` : '<span class="sub">—</span>'}</td>
        <td data-l="MLS">${mlsCell(r)}</td>
        <td data-l="">${r.status === "approved" && r.iso >= todayIso() ? `<button class="link" data-cancel="${esc(r.id)}">Cancel</button>` : ""}</td>
      </tr>`).join("") : '<tr><td colspan="7" class="empty">No requests match.</td></tr>';
    wireFeedback($("rows"), 7);
    $("rows").querySelectorAll("[data-cancel]").forEach((b) => b.onclick = () => {
      const r = requests.find((x) => x.id === b.dataset.cancel);
      if (confirm(`Cancel ${r.agent.name}'s open house at ${r.addr} on ${r.day}, ${r.date}? The agent and team will be emailed${mode === "off" ? "; remove it from the MLS by hand" : " and the MLS bot marks it Canceled"}.`)) manageAction(r, "cancel", b);
    });
  }

  // Team actions after a request was made: cancel (or approve the agent's cancellation request) and keep.
  async function manageAction(r, action, btn) {
    btn.disabled = true;
    const res = await api("POST", "/api/manage", { id: r.id, action });
    const done = action === "keep" ? "Kept. The agent was told it's still on." : "Cancelled. The agent and team were emailed.";
    if (res.ok) toast(res.data.message || done);
    else if (res.data.error === "email_failed") toast(res.data.message || "Saved, but the email failed to send.", true);
    else { toast(res.data.message || "Could not save. Try again.", true); btn.disabled = false; return; }
    renderRequests();
  }

  function cancelCard(r) {
    const c = document.createElement("article"); c.className = "card req";
    const what = r.status === "approved" ? "open house" : "request";
    c.innerHTML = `
      ${r.img ? `<img class="thumb" src="${esc(photo(r.img))}" alt="">` : '<div class="thumb"></div>'}
      <div>
        <h3>${esc(r.addr)}, ${esc(r.city)} <span class="pill declined">Cancellation requested</span></h3>
        <div class="when">${esc(r.day)}, ${esc(r.date)} · ${esc(r.time)}</div>
        <div class="meta">${agentLink(r.agent.email, r.agent.name)} asked ${esc(fmtDate(r.cancelRequest.at))} to cancel this ${r.status === "approved" ? "approved open house" : "request"} · MLS# ${esc(r.mls)}</div>
        ${r.cancelRequest.reason ? `<div class="notes">${esc(r.cancelRequest.reason)}</div>` : ""}
        ${r.status === "approved" ? `<div class="meta"><a href="/respond/?id=${encodeURIComponent(r.id)}">MLS status</a></div>` : ""}
      </div>
      <div class="act">
        <div class="btns" style="flex-direction:column"><button class="btn danger small approve">Approve cancellation</button><button class="btn ghost small keep">Keep ${what}</button></div>
      </div>`;
    const approve = c.querySelector(".approve"), keep = c.querySelector(".keep");
    approve.onclick = () => confirm(`Cancel ${r.agent.name}'s ${what} at ${r.addr}? The agent and team will be emailed${r.status === "approved" && mode !== "off" ? " and the MLS bot marks it Canceled" : ""}.`) && manageAction(r, "cancel", approve);
    keep.onclick = () => manageAction(r, "keep", keep);
    return c;
  }

  // "Feedback" buttons in a table open the full feedback in a row underneath.
  function wireFeedback(tbody, cols) {
    tbody.querySelectorAll("[data-fb]").forEach((b) => b.onclick = () => {
      const tr = b.closest("tr"), open = tr.nextElementSibling?.classList.contains("fbrow");
      if (open) { tr.nextElementSibling.remove(); b.setAttribute("aria-expanded", "false"); return; }
      tr.insertAdjacentHTML("afterend", `<tr class="fbrow"><td colspan="${cols}">${fbText(requests.find((x) => x.id === b.dataset.fb).feedback)}</td></tr>`);
      b.setAttribute("aria-expanded", "true");
    });
  }

  function feedbackCard(r) {
    const c = document.createElement("article"); c.className = "card req" + (r.feedback.brokerFlag ? " flag" : "");
    c.innerHTML = `
      ${r.img ? `<img class="thumb" src="${esc(photo(r.img))}" alt="">` : '<div class="thumb"></div>'}
      <div>
        <h3>${esc(r.addr)}, ${esc(r.city)} ${r.feedback.brokerFlag ? '<span class="pill declined">⚠ Flagged for broker</span>' : ""}</h3>
        <div class="when">${esc(r.day)}, ${esc(r.date)} · ${esc(r.time)}</div>
        <div class="meta">Hosted by ${agentLink(r.agent.email, r.agent.name)} · sent ${esc(fmtDate(r.feedback.at))} · MLS# ${esc(r.mls)}</div>
        ${fbText(r.feedback)}
      </div>`;
    return c;
  }

  function pendingCard(r) {
    const c = document.createElement("article"); c.className = "card req";
    c.innerHTML = `
      ${r.img ? `<img class="thumb" src="${esc(photo(r.img))}" alt="">` : '<div class="thumb"></div>'}
      <div>
        <h3>${esc(r.addr)}, ${esc(r.city)}</h3>
        <div class="when">${esc(r.day)}, ${esc(r.date)} · ${esc(r.time)}</div>
        <div class="meta">${agentLink(r.agent.email, r.agent.name)} · <a href="mailto:${esc(r.agent.email)}">${esc(r.agent.email)}</a>${r.phone ? ` · ${esc(r.phone)}` : ""}</div>
        <div class="meta">Requested ${esc(fmtDate(r.createdAt))} · MLS# ${esc(r.mls)}</div>
        ${r.notes ? `<div class="notes">${esc(r.notes)}</div>` : ""}
      </div>
      <div class="act">
        ${!r.onMls ? '<span class="fine">This home isn\'t on the MLS yet, so there\'s nothing to enter there.</span>'
          : mode === "off" ? '<label class="check"><input type="checkbox" class="mls"> Entered on the MLS</label>'
          : `<span class="fine">Approving sends it to the MLS bot${mode === "dry_run" ? " as a dry run" : ""}.</span>`}
        <div class="btns"><button class="btn small approve" ${mode === "off" && r.onMls ? "disabled" : ""}>Approve</button><button class="btn danger small decline">Decline</button></div>
      </div>`;
    const box = c.querySelector(".mls"), approve = c.querySelector(".approve"), decline = c.querySelector(".decline");
    if (box) box.onchange = () => { approve.disabled = !box.checked; };
    const act = async (action) => {
      if (action === "decline" && !confirm(`Decline ${r.agent.name}'s request for ${r.addr}? They'll get an email.`)) return;
      approve.disabled = decline.disabled = true;
      const res = await api("POST", "/api/respond", { id: r.id, action, mlsEntered: action === "approve" ? !!(box && box.checked) : undefined });
      if (res.ok) toast(action === "approve" ? "Approved. Confirmation sent to the agent and team." : "Declined. The agent was notified.");
      else if (res.data.error === "email_failed") toast(`${action === "approve" ? "Approved" : "Declined"}, but the email failed to send.`, true);
      else { toast(res.data.message || (res.data.error === "already_answered" ? `Already ${res.data.status} by ${res.data.by || "someone else"}.` : "Could not save. Try again."), true); }
      renderRequests();
    };
    approve.onclick = () => act("approve");
    decline.onclick = () => act("decline");
    return c;
  }

  // Feedback columns shared by both exports. Older feedback's "What happened" goes in the liked column.
  const fbCsv = (f) => !f ? ["", "", "", "", "", "", "", "", ""] : [f.visitors, INTEREST[f.interest] || "", PRICE[f.price] || "", f.liked ?? f.happened, f.disliked || "",
    f.forSeller || "", f.teamNotes, (f.photos || []).length ? (f.photos || []).map((u) => location.origin + u).join(" ") : "", f.brokerFlag ? "Yes" : "No"];

  function exportCsv(list = filtered(), name = "open-house-requests") {
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Date", "Day", "Time", "Address", "City", "MLS", "Agent", "Agent email", "Phone", "Status", "Decided by", "Decided at", "Requested at", "Notes",
      "Visitors", "Interest", "Price", "What guests liked", "What guests didn't like", "Additional feedback", "Notes for the team", "Photos", "Flagged for broker"];
    const rows = list.map((r) => { const f = r.feedback || {}; return [r.iso, r.day, r.time, r.addr, r.city, r.mls, r.agent.name, r.agent.email, r.phone, STATUS[r.status] || r.status,
      r.decidedBy, r.decidedAt ? new Date(r.decidedAt).toISOString() : "", new Date(r.createdAt).toISOString(), r.notes,
      ...fbCsv(r.feedback)]; });
    const blob = new Blob([[head, ...rows].map((row) => row.map(cell).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${name}-${todayIso()}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---- One agent's history -------------------------------------------------
  async function renderAgent(email) {
    if (!(await loadRequests())) { view.innerHTML = '<p class="empty">Could not load requests.</p>'; return; }
    const today = todayIso();
    const mine = requests.filter((r) => r.agent.email.toLowerCase() === email).sort((a, b) => b.iso.localeCompare(a.iso) || b.from - a.from);
    const name = (mine.find((r) => r.agent.name) || {}).agent?.name || email;
    const hosted = mine.filter((r) => r.status === "approved" && r.iso < today);
    const upcoming = mine.filter((r) => r.status === "approved" && r.iso >= today);
    const homes = new Set(hosted.map((r) => r.mls));
    const label = (r) => r.status === "approved" && r.iso < today ? '<span class="pill approved">Hosted</span>' : pill(r.status);
    const phone = (mine.find((r) => r.phone) || {}).phone;
    view.innerHTML = `
      <p style="margin:22px 0 0"><a href="${me.admin ? "#agents" : "#requests"}">← ${me.admin ? "All agents" : "All requests"}</a></p>
      <section class="intro" style="padding-top:12px"><div><h1>${esc(name)}</h1>
        <p class="sub"><a href="mailto:${esc(email)}">${esc(email)}</a>${phone ? ` · ${esc(phone)}` : ""}</p></div>
        ${mine.length ? '<button class="btn ghost small" id="csv">Export CSV</button>' : ""}</section>
      <div class="stats">
        <div class="card stat"><b>${hosted.length}</b><span>Open houses hosted</span></div>
        <div class="card stat"><b>${upcoming.length}</b><span>Upcoming approved</span></div>
        <div class="card stat"><b>${homes.size}</b><span>Different homes hosted</span></div>
        <div class="card stat"><b>${mine.length}</b><span>Requests all time</span></div>
      </div>
      <div class="card table-wrap"><table class="stack"><thead><tr><th>Open house</th><th>Home</th><th>Status</th><th>Decided</th></tr></thead><tbody id="agentRows">
        ${mine.map((r) => `<tr>
          <td data-l="Open house"><b>${esc(r.day)}, ${esc(r.date)}</b><div class="sub">${esc(r.time)}</div></td>
          <td data-l="Home">${esc(r.addr)}<div class="sub">${esc(r.city)} · MLS# ${esc(r.mls)}</div></td>
          <td data-l="Status">${label(r)}${fbLine(r)}</td>
          <td data-l="Decided">${r.decidedBy ? `${esc(r.decidedBy)}<div class="sub">${esc(fmtDate(r.decidedAt))}</div>` : '<span class="sub">—</span>'}</td>
        </tr>`).join("") || '<tr><td colspan="4" class="empty">No open house requests yet.</td></tr>'}
      </tbody></table></div>`;
    if (mine.length) $("csv").onclick = () => exportCsv(mine, `open-houses-${email.split("@")[0]}`);
    wireFeedback($("agentRows"), 4);
  }

  // ---- Feedback by home ----------------------------------------------------
  // Every home that's hosted an open house, with what the agents said, kept after the home sells.
  // Links to one home look like #home/<key>; the key is the home's street address and ZIP.
  const homeLink = (h, label) => `<a href="#home/${encodeURIComponent(h.key)}">${esc(label)}</a>`;
  // Older open houses show their year: the history goes back further than this season.
  const withYear = (o) => `${o.day}, ${o.date}${o.iso.slice(0, 4) !== todayIso().slice(0, 4) ? `, ${o.iso.slice(0, 4)}` : ""}`;
  const priceMix = (h) => Object.entries(PRICE).filter(([k]) => k !== "none" && h.price[k]).map(([k, v]) => `${v} ${h.price[k]}`).join(" · ") || "—";
  const interestMix = (h) => Object.entries(INTEREST).filter(([k]) => h.interest[k]).map(([k, v]) => `${v} ${h.interest[k]}`).join(" · ") || "—";
  let fbSearch = "";

  async function loadHomes() {
    const r = await api("GET", "/api/team/feedback");
    return r.ok ? r.data.homes : null;
  }

  async function renderFeedback() {
    const homes = await loadHomes();
    if (!homes) { view.innerHTML = '<p class="empty">Could not load feedback.</p>'; return; }
    const sum = (k) => homes.reduce((n, h) => n + h[k], 0);
    view.innerHTML = `
      <section class="intro"><div><h1>Feedback by home</h1>
        <p class="sub">What agents said after hosting, collected for each home. Homes flagged for the broker are at the top. The history stays here after a home sells or is relisted.</p></div></section>
      <div class="stats">
        <div class="card stat"><b>${homes.length}</b><span>Homes hosted</span></div>
        <div class="card stat"><b>${sum("hosted")}</b><span>Open houses hosted</span></div>
        <div class="card stat"><b>${sum("withFeedback")}</b><span>With feedback</span></div>
        <div class="card stat"><b>${sum("visitors")}</b><span>Visitors reported</span></div>
      </div>
      <div class="toolbar">
        <input class="field" id="fbSearch" type="search" placeholder="Search address or city" value="${esc(fbSearch)}" aria-label="Search homes">
        <span class="spacer"></span>
        ${homes.length ? '<button class="btn ghost small" id="csv">Export CSV</button>' : ""}
      </div>
      <div class="card table-wrap"><table class="stack"><thead><tr><th>Home</th><th>Open houses</th><th>Visitors</th><th>Interest</th><th>Last hosted</th></tr></thead><tbody id="homeRows"></tbody></table></div>`;
    const fill = () => {
      const q = fbSearch.trim().toLowerCase();
      const shown = homes.filter((h) => !q || [h.addr, h.city, h.zip, ...h.mls].join(" ").toLowerCase().includes(q));
      $("homeRows").innerHTML = shown.length ? shown.map((h) => `<tr>
          <td data-l="Home"><div class="homecell">${h.img ? `<img class="thumb" src="${esc(photo(h.img))}" alt="" loading="lazy">` : '<div class="thumb"></div>'}
            <div><b>${homeLink(h, h.addr)}</b><div class="sub">${esc(h.city)}${h.flags ? ` · <b class="flagged">⚠ ${h.flags} flagged for broker</b>` : ""}</div></div></div></td>
          <td data-l="Open houses">${h.hosted}<div class="sub">${h.withFeedback === h.hosted ? "All with feedback" : `${h.hosted - h.withFeedback} waiting on feedback`}</div></td>
          <td data-l="Visitors">${h.withFeedback ? h.visitors : '<span class="sub">—</span>'}</td>
          <td data-l="Interest">${esc(interestMix(h))}</td>
          <td data-l="Last hosted">${esc(withYear(h.openHouses[0]))}</td>
        </tr>`).join("") : `<tr><td colspan="5" class="empty">${homes.length ? "No homes match." : "No open houses hosted yet. Homes show up here once an approved open house has ended."}</td></tr>`;
    };
    $("fbSearch").oninput = (e) => { fbSearch = e.target.value; fill(); };
    if (homes.length) $("csv").onclick = () => exportFeedbackCsv(homes, "open-house-feedback");
    fill();
  }

  async function renderHome(key) {
    const homes = await loadHomes();
    if (!homes) { view.innerHTML = '<p class="empty">Could not load feedback.</p>'; return; }
    const h = homes.find((x) => x.key === key);
    const back = '<p style="margin:22px 0 0"><a href="#feedback">← All homes</a></p>';
    if (!h) { view.innerHTML = back + '<p class="empty">No hosted open houses for this home.</p>'; return; }
    view.innerHTML = `${back}
      <section class="intro" style="padding-top:12px"><div><h1>${esc(h.addr)}</h1>
        <p class="sub">${esc(h.city)}, TX ${esc(h.zip)} · ${h.mls.map((m) => /^\d+$/.test(m) ? `MLS# ${esc(m)}` : "Added by the team").join(", ")}</p></div>
        <button class="btn ghost small" id="csv">Export CSV</button></section>
      <div class="stats">
        <div class="card stat"><b>${h.hosted}</b><span>Open houses hosted</span></div>
        <div class="card stat"><b>${h.withFeedback ? h.visitors : "—"}</b><span>Visitors reported${h.flags ? ` · <b class="flagged">⚠ ${h.flags} flagged</b>` : ""}</span></div>
        <div class="card stat"><b class="words">${esc(interestMix(h))}</b><span>Guest interest</span></div>
        <div class="card stat"><b class="words">${esc(priceMix(h))}</b><span>What guests thought of the price</span></div>
      </div>
      ${sellerSummary(h)}
      <h2 class="section">Every open house, newest first</h2>
      <div class="queue">${h.openHouses.map((o) => `<article class="card req fbentry${o.feedback?.brokerFlag ? " flag" : ""}">
        <div>
          <h3>${esc(withYear(o))} · ${esc(o.time)} ${o.feedback?.brokerFlag ? '<span class="pill declined">⚠ Flagged for broker</span>' : ""}</h3>
          <div class="meta">Hosted by ${agentLink(o.agent.email, o.agent.name)}${o.feedback ? ` · feedback sent ${esc(fmtDate(o.feedback.at))}` : ""}</div>
          ${o.feedback ? fbText(o.feedback) : '<div class="notes">No feedback yet. The agent was emailed a link after the open house.</div>'}
        </div></article>`).join("")}</div>`;
    $("csv").onclick = () => exportFeedbackCsv([h], `feedback-${h.addr.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
  }

  // What guests liked and didn't like, across every open house at the home: what the seller needs to hear.
  function sellerSummary(h) {
    const said = (k) => h.openHouses.filter((o) => o.feedback?.[k]).map((o) =>
      `<li>${esc(o.feedback[k])}<div class="sub">${esc(withYear(o))} · ${esc(o.agent.name)}</div></li>`).join("");
    const liked = said("liked"), disliked = said("disliked");
    if (!liked && !disliked) return "";
    return `<h2 class="section">For the seller</h2>
      <div class="said">
        <div class="card"><h3>What guests didn't like</h3>${disliked ? `<ul>${disliked}</ul>` : '<p class="sub">Nothing noted yet.</p>'}</div>
        <div class="card"><h3>What guests liked</h3>${liked ? `<ul>${liked}</ul>` : '<p class="sub">Nothing noted yet.</p>'}</div>
      </div>`;
  }

  function exportFeedbackCsv(homes, name) {
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Address", "City", "ZIP", "MLS", "Date", "Day", "Time", "Agent", "Agent email",
      "Visitors", "Interest", "Price", "What guests liked", "What guests didn't like", "Additional feedback", "Notes for the team", "Photos", "Flagged for broker"];
    const rows = homes.flatMap((h) => h.openHouses.map((o) => [h.addr, h.city, h.zip, o.mls, o.iso, o.day, o.time, o.agent.name, o.agent.email, ...fbCsv(o.feedback)]));
    const blob = new Blob([[head, ...rows].map((row) => row.map(cell).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${name}-${todayIso()}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---- Listings ------------------------------------------------------------
  let listFilter = "all";
  const FILTERS = { all: ["All homes", () => true], published: ["Published", (l) => l.offered], unpublished: ["Unpublished", (l) => !l.offered] };
  // Fields of a home the team adds before it's on the MLS: [key, label, input attributes].
  const HOME_FIELDS = [
    ["addr", "Street address", 'autocomplete="off"'], ["city", "City", ""], ["zip", "ZIP", 'inputmode="numeric" maxlength="5"'],
    ["price", "List price ($)", 'type="number" min="0" step="1"'], ["bd", "Bedrooms", 'type="number" min="0" step="1"'],
    ["ba", "Bathrooms", 'type="number" min="0" step="0.5"'], ["sf", "Square feet", 'type="number" min="0" step="1"'],
  ];
  const homeFields = (h = {}) => HOME_FIELDS.map(([k, label, attrs]) =>
    `<label class="label">${label}<input class="field" data-h="${k}" ${attrs} value="${esc(h[k] ?? "")}"></label>`).join("");

  // Saves a card's changes as they're made: right away for switches, after a pause in typing for text.
  // Saves never overlap, and a change made during a save is sent right after it.
  const savers = new Set();
  function autosave(send) {
    let timer = null, busy = null, again = false;
    const run = () => {
      clearTimeout(timer); timer = null;
      if (busy) { again = true; return busy; }
      busy = (async () => { try { await send(); } finally { busy = null; if (again) { again = false; await run(); } } })();
      return busy;
    };
    const s = { now: run, soon: () => { clearTimeout(timer); timer = setTimeout(run, 800); }, flush: () => (timer ? run() : busy || Promise.resolve()) };
    savers.add(s);
    return s;
  }
  const flushSaves = () => { savers.forEach((s) => s.flush()); };
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushSaves(); });

  // Shrink a photo to at most 1600px on its longest side as a JPEG, so uploads stay small.
  function shrink(file, max = 1600) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement("canvas"); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        resolve(cv.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable image")); };
      img.src = url;
    });
  }

  async function renderListings(scrollTo) {
    const [r, homes] = await Promise.all([api("GET", "/api/inventory/listings"), loadHomes()]);
    // Each listing links to its home's feedback, matched by MLS number (or team-added home id).
    const fbFor = (mls) => (homes || []).find((h) => h.mls.includes(mls));
    if (!r.ok) { view.innerHTML = `<div class="card banner err">${esc(r.data.message || "Could not load listings from Repliers.")}</div>`; return; }
    const d = r.data;
    savers.clear();
    const stale = d.feedUpdatedOn && Math.floor((Date.now() - new Date(d.feedUpdatedOn + "T12:00:00Z")) / 86400000);
    view.innerHTML = `
      <section class="intro"><div><h1>Publish this weekend's homes</h1>
        <p class="sub">Weekend of ${esc(d.week.sat.date)} and ${esc(d.week.sun.date)}. Requests close ${esc(d.closesLabel)}. Publish the homes agents can request; changes save as you make them. Publishing and Priority reset each week; days, instructions and access details stay with the home.</p></div>
        <div class="intro-actions">${me.admin ? '<button class="btn small" id="addHomeBtn">Add a home</button>' : ""}<a class="btn ghost small" href="/" target="_blank" rel="noopener">Preview agent portal</a></div></section>
      ${me.admin ? `<div class="card panel" id="addHome" hidden>
        <h3>Add a home that isn't on the MLS yet</h3>
        <p class="fine">It works like any listing here: publish it, set Priority, instructions and access details, and add photos. Once it's on the MLS, link it to its MLS listing on its card and everything moves over.</p>
        <form id="addHomeForm"><div class="homegrid">${homeFields()}</div>
          <div class="actions"><button class="btn">Add home</button><button type="button" class="btn ghost" id="addHomeCancel">Cancel</button></div></form></div>` : ""}
      ${d.warning ? `<div class="card banner err"><b>Repliers problem:</b> ${esc(d.warning)}</div>` : ""}
      ${stale >= 3 ? `<div class="card banner"><b>Repliers data looks out of date.</b> Last updated ${esc(d.feedUpdatedOn)} (${stale} days ago).</div>` : ""}
      <div class="toolbar">
        <div class="chips" id="lchips">${Object.entries(FILTERS).map(([f, [label]]) =>
          `<button class="chip" data-f="${f}" aria-pressed="${listFilter === f}">${label} (<span data-n="${f}">0</span>)</button>`).join("")}</div>
        <span class="spacer"></span>
        <span class="fine">${d.feedUpdatedOn ? `Repliers data updated ${esc(d.feedUpdatedOn)}` : ""}</span>
      </div>
      <div class="listings" id="list"></div>
      <details style="margin-top:28px"><summary class="fine">Check Repliers data</summary>
        <p class="fine">Shows one raw listing so field mapping can be verified.</p>
        <button class="btn ghost small" id="raw">Show sample</button><pre id="rawOut" class="card" style="padding:12px;white-space:pre-wrap;word-break:break-all;font-size:.8rem" hidden></pre></details>`;

    const counts = () => Object.entries(FILTERS).forEach(([f, [, test]]) => { view.querySelector(`[data-n="${f}"]`).textContent = d.listings.filter(test).length; });
    const list = $("list");
    const paint = () => {
      list.innerHTML = "";
      const shown = d.listings.filter(FILTERS[listFilter][1]);
      if (!shown.length) list.innerHTML = `<div class="card empty">${{ all: "No active listings found in Repliers.", published: "No homes published yet this weekend.", unpublished: "Every home is published this weekend." }[listFilter]}</div>`;
      shown.forEach((l) => list.append(listingCard(l, d, counts, fbFor(l.mls))));
    };
    $("lchips").onclick = (e) => { const b = e.target.closest(".chip"); if (!b) return; flushSaves(); listFilter = b.dataset.f; $("lchips").querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", c === b)); paint(); };
    $("raw").onclick = async () => { const j = await api("GET", "/api/inventory/listings?raw=1"); const o = $("rawOut"); o.hidden = false; o.textContent = JSON.stringify(j.data, null, 2); };
    if (me.admin) {
      $("addHomeBtn").onclick = () => { $("addHome").hidden = !$("addHome").hidden; if (!$("addHome").hidden) $("addHome").querySelector("input").focus(); };
      $("addHomeCancel").onclick = () => { $("addHome").hidden = true; };
      $("addHomeForm").onsubmit = async (e) => {
        e.preventDefault();
        const body = { action: "create" };
        $("addHomeForm").querySelectorAll("[data-h]").forEach((i) => { body[i.dataset.h] = i.value; });
        const res = await api("POST", "/api/admin/homes", body);
        if (!res.ok) return toast(res.data.message || "Couldn't add the home.", true);
        toast(`Added ${res.data.home.addr}. Add photos and publish it on its card.`);
        listFilter = "all";
        renderListings(res.data.home.id);
      };
    }
    counts();
    paint();
    if (scrollTo) list.querySelector(`[data-mls="${scrollTo}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function listingCard(l, d, onSaved, fb) {
    const c = document.createElement("article"); c.className = "card lcard" + (l.priority ? " pri" : ""); c.dataset.mls = l.mls;
    const oh = l.openHouses.length ? `<div class="mls-oh">Already on the MLS: ${l.openHouses.map((o) => `${o.day === "sat" ? "Sat" : "Sun"} ${o.from}:00–${o.to}:00`).join(", ")}</div>` : "";
    const badges = () => `${l.offered ? '<span class="pill approved">Published</span>' : '<span class="pill">Unpublished</span>'}${l.priority ? '<span class="pill priority">★ Priority</span>' : ""}${l.teamAdded ? '<span class="pill pending">Not on the MLS yet</span>' : ""}`;
    const facts = () => `${esc(l.city)} · ${l.teamAdded ? "Added by the team" : `MLS# ${esc(l.mls)}`} · ${money(l.price)}${l.bd ? ` · ${esc(l.bd)} bd / ${esc(l.ba)} ba` : ""}${l.sf ? ` · ${Number(l.sf).toLocaleString()} sq ft` : ""}`;
    const cover = () => (l.img ? `<img src="${esc(photo(l.img, "medium"))}" alt="" loading="lazy">` : "");
    const editable = l.teamAdded && me.admin;
    c.innerHTML = `
      <div class="photo">${cover()}</div>
      <div class="body">
        <h3><span class="addr">${esc(l.addr)}</span><span class="badges">${badges()}</span></h3>
        <div class="fine facts">${facts()}</div>
        ${fb ? `<div class="lfb">${homeLink(fb, `Feedback from ${fb.hosted} open house${fb.hosted === 1 ? "" : "s"}`)}${fb.flags ? ` · <b class="flagged">⚠ ${fb.flags} flagged</b>` : ""}</div>` : ""}
        ${oh}
        <div class="toggles">
          <label class="check"><input type="checkbox" data-f="offered" ${l.offered ? "checked" : ""}> Publish this weekend</label>
          <label class="check"><input type="checkbox" data-f="sat" ${l.days.includes("sat") ? "checked" : ""}> Saturday</label>
          <label class="check"><input type="checkbox" data-f="sun" ${l.days.includes("sun") ? "checked" : ""}> Sunday</label>
          <label class="check"><input type="checkbox" data-f="priority" ${l.priority ? "checked" : ""}> Priority</label>
        </div>
        <div class="two">
          <div><label class="label">Instructions for agents (one per line)</label><textarea class="field" data-f="instr">${esc(l.instr.join("\n"))}</textarea></div>
          <div><label class="label">Access details (private)</label><textarea class="field" data-f="access" placeholder="Gate, lockbox, alarm codes">${esc(l.access)}</textarea>
            <div class="fine">Only sent in the Confirmed and Reminder emails. Never shown to agents on the site.</div></div>
        </div>
        ${editable ? homeEditor(l, d) : ""}
      </div>`;

    // Publishing, days, Priority, instructions and access details save as they change.
    const q = (f) => c.querySelector(`[data-f="${f}"]`);
    const settings = autosave(async () => {
      const days = ["sat", "sun"].filter((x) => q(x).checked), instr = q("instr").value.split("\n"), access = q("access").value;
      const res = await api("PUT", "/api/inventory/listings", { mls: l.mls, offered: q("offered").checked, priority: q("priority").checked, days, instr, access });
      if (!res.ok) {
        // Put the switches back to what's saved; typed text stays so nothing is lost.
        q("offered").checked = l.offered; q("priority").checked = l.priority; ["sat", "sun"].forEach((x) => { q(x).checked = l.days.includes(x); });
        return toast(res.data.message || "Couldn't save. Your change was not applied.", true);
      }
      Object.assign(l, { offered: q("offered").checked, priority: q("priority").checked, days, instr: instr.map((s) => s.trim()).filter(Boolean), access });
      c.classList.toggle("pri", l.priority);
      c.querySelector(".badges").innerHTML = badges();
      toast(`Saved ${l.addr}.`);
      onSaved();
    });
    c.querySelectorAll(".toggles input").forEach((i) => { i.onchange = settings.now; });
    ["instr", "access"].forEach((f) => { q(f).oninput = settings.soon; q(f).onblur = settings.flush; });
    if (editable) wireHomeEditor(c, l, d, { settings, badges, facts, cover });
    return c;
  }

  // Team-added homes (admins only): the home's details, its photos, linking it to its MLS listing, removing it.
  function homeEditor(l, d) {
    const suggested = (l.suggestions || []).map((m) => d.mlsChoices.find((x) => x.mls === m)).filter(Boolean);
    return `<div class="home-edit">
      <h4>Home details</h4>
      <div class="homegrid">${homeFields(l)}</div>
      <h4>Photos</h4>
      <div class="photos" data-photos></div>
      <div class="foot"><label class="btn ghost small">Add photos<input type="file" accept="image/*" multiple hidden data-upload></label>
        <span class="fine">The first photo is the cover. Large photos are resized before upload.</span></div>
      <h4>Link to its MLS listing</h4>
      ${suggested.length ? suggested.map((s) => `<div class="suggest">Found on the MLS: <b>${esc(s.addr)}</b>, ${esc(s.city)} · MLS# ${esc(s.mls)} <button class="btn small" data-link="${esc(s.mls)}">Link</button></div>`).join("")
        : '<p class="fine">When this home shows up on the MLS at the same address, it appears here to link in one click. You can also pick it from the list.</p>'}
      <div class="addrow"><select class="field" data-pick aria-label="MLS listing to link"><option value="">Choose an MLS listing…</option>${d.mlsChoices.map((m) =>
        `<option value="${esc(m.mls)}">${esc(m.addr)}, ${esc(m.city)} · MLS# ${esc(m.mls)}</option>`).join("")}</select><button class="btn ghost small" data-linkpick>Link</button></div>
      <p class="fine">Linking moves this home's settings, instructions, access details and open house requests to the MLS listing. This card is then replaced by the MLS listing.</p>
      <div class="foot"><button class="link danger" data-remove>Remove this home</button></div>
    </div>`;
  }

  function wireHomeEditor(c, l, d, { settings, facts, cover }) {
    const h = (k) => c.querySelector(`[data-h="${k}"]`);
    const details = autosave(async () => {
      const body = { action: "update", id: l.mls };
      HOME_FIELDS.forEach(([k]) => { body[k] = h(k).value; });
      const res = await api("POST", "/api/admin/homes", body);
      if (!res.ok) return toast(res.data.message || "Couldn't save the home's details.", true);
      const { addr, city, zip, price, bd, ba, sf } = res.data.home;
      Object.assign(l, { addr, city, zip, price, bd, ba, sf });
      c.querySelector(".addr").textContent = l.addr; c.querySelector(".facts").innerHTML = facts();
      toast(`Saved ${l.addr}.`);
    });
    c.querySelectorAll("[data-h]").forEach((i) => { i.oninput = details.soon; i.onblur = details.flush; });

    const paintPhotos = () => {
      const box = c.querySelector("[data-photos]");
      box.innerHTML = l.photos.length ? l.photos.map((p, i) => `<figure><img src="${esc(p.url)}" alt="">
          <figcaption>${i === 0 ? "<b>Cover</b>" : `<button class="link" data-cover="${esc(p.id)}">Make cover</button>`} · <button class="link" data-unphoto="${esc(p.id)}">Remove</button></figcaption></figure>`).join("")
        : '<p class="fine">No photos yet.</p>';
      c.querySelector(".photo").innerHTML = cover();
      box.querySelectorAll("[data-cover]").forEach((b) => { b.onclick = () => photoAction("cover", b.dataset.cover, "Cover photo set."); });
      box.querySelectorAll("[data-unphoto]").forEach((b) => { b.onclick = () => confirm("Remove this photo?") && photoAction("unphoto", b.dataset.unphoto, "Photo removed."); });
    };
    const setPhotos = (home) => {
      l.photos = home.photos.map((id) => ({ id, url: `/api/home-photo?id=${l.mls}&p=${id}` }));
      l.img = l.photos[0]?.url || "";
      paintPhotos();
    };
    const photoAction = async (action, id, done) => {
      const res = await api("POST", "/api/admin/homes", { action, id: l.mls, photo: id });
      if (!res.ok) return toast(res.data.message || "Couldn't update the photos.", true);
      setPhotos(res.data.home); toast(done);
    };
    c.querySelector("[data-upload]").onchange = async (e) => {
      const files = [...e.target.files]; e.target.value = "";
      let added = 0;
      for (const f of files) {
        toast(`Uploading ${f.name}…`);
        const data = await shrink(f).catch(() => null);
        if (!data) { toast(`Couldn't read ${f.name}. Use a JPEG or PNG.`, true); continue; }
        const res = await api("POST", "/api/admin/homes", { action: "photo", id: l.mls, data });
        if (!res.ok) { toast(res.data.message || `Couldn't upload ${f.name}.`, true); continue; }
        setPhotos(res.data.home); added++;
      }
      if (added) toast(`${added} photo${added === 1 ? "" : "s"} saved.`);
    };
    paintPhotos();

    const link = async (mls) => {
      const m = d.mlsChoices.find((x) => x.mls === mls);
      if (!m) return toast("Choose an MLS listing first.", true);
      if (!confirm(`Link ${l.addr} to MLS# ${m.mls} (${m.addr}, ${m.city})?\n\nIts settings, instructions, access details and open house requests move to the MLS listing, and this card is replaced by the MLS listing.`)) return;
      await Promise.all([settings.flush(), details.flush()]); // the latest edits go over too
      const res = await api("POST", "/api/admin/homes", { action: "link", id: l.mls, mls });
      if (!res.ok) return toast(res.data.message || "Couldn't link the home.", true);
      toast(`Linked to MLS# ${mls}.${res.data.moved ? ` ${res.data.moved} request${res.data.moved === 1 ? "" : "s"} moved over.` : ""}`);
      if (res.data.enterByHand?.length) alert(`MLS automation is off, so enter these approved open houses on the MLS for ${m.addr} by hand:\n\n${res.data.enterByHand.join("\n")}`);
      renderListings(mls);
    };
    c.querySelectorAll("[data-link]").forEach((b) => { b.onclick = () => link(b.dataset.link); });
    c.querySelector("[data-linkpick]").onclick = () => link(c.querySelector("[data-pick]").value);

    c.querySelector("[data-remove]").onclick = async () => {
      if (!confirm(`Remove ${l.addr} from the portal? Its photos are deleted too. This can't be undone.`)) return;
      const res = await api("POST", "/api/admin/homes", { action: "remove", id: l.mls });
      if (!res.ok) return toast(res.data.message || "Couldn't remove the home.", true);
      toast(`Removed ${l.addr}.`);
      renderListings();
    };
  }

  // ---- Agents --------------------------------------------------------------
  async function renderAgents() {
    const [a] = await Promise.all([api("GET", "/api/admin/access"), loadRequests()]);
    if (!a.ok) { view.innerHTML = '<p class="empty">Only administrators can manage agents.</p>'; return; }
    let access = a.data;

    const draw = () => {
      const domainOf = (e) => e.slice(e.lastIndexOf("@") + 1);
      const allowedDomains = [...new Set([...access.domains, ...access.env.domains])];
      const roster = new Map();
      const add = (email, name) => { const k = email.toLowerCase(); if (!roster.has(k)) roster.set(k, { email: k, name: name || "", requests: 0, approved: 0, last: 0 }); const p = roster.get(k); if (name && !p.name) p.name = name; return p; };
      access.emails.forEach((e) => add(e)); access.env.emails.forEach((e) => add(e));
      access.admins.forEach((e) => add(e)); (access.team || []).forEach((e) => add(e));
      requests.forEach((r) => { const p = add(r.agent.email, r.agent.name); p.requests++; if (r.status === "approved") p.approved++; p.last = Math.max(p.last, r.createdAt); });

      const how = (p) => {
        const tags = [];
        if (access.admins.includes(p.email)) tags.push('<span class="pill approved">Admin</span>');
        else if ((access.team || []).includes(p.email)) tags.push('<span class="pill approved">Team</span>');
        if (access.emails.includes(p.email)) tags.push('<span class="pill">Added here</span>');
        else if (access.env.emails.includes(p.email)) tags.push('<span class="pill">Set in Netlify</span>');
        else if (allowedDomains.includes(domainOf(p.email))) tags.push(`<span class="pill">@${esc(domainOf(p.email))}</span>`);
        if (!tags.length) tags.push('<span class="pill declined">No access</span>');
        return tags.join(" ");
      };
      const people = [...roster.values()].sort((x, y) => (y.last - x.last) || x.email.localeCompare(y.email));

      view.innerHTML = `
        <section class="intro"><div><h1>Agents and access</h1>
          <p class="sub">Who can sign in to the Open House Portal. Removing someone ends their access right away.</p></div></section>
        <div class="card panel">
          <h3>Add an agent</h3>
          <p class="fine">For agents who sign in with an address outside an allowed domain, like a personal Gmail.</p>
          <form class="addrow" id="addEmail"><input class="field" id="newEmail" type="email" placeholder="agent@example.com" autocomplete="off" aria-label="Agent email"><button class="btn">Add agent</button></form>
        </div>
        <div class="card table-wrap"><table class="stack"><thead><tr><th>Person</th><th>Access</th><th>Requests</th><th>Approved</th><th>Last request</th><th></th></tr></thead>
          <tbody>${people.map((p) => `<tr>
            <td data-l="Person">${p.name ? `${agentLink(p.email, p.name)}<div class="sub">${esc(p.email)}</div>` : agentLink(p.email)}</td>
            <td data-l="Access">${how(p)}</td>
            <td data-l="Requests">${p.requests}</td>
            <td data-l="Approved">${p.approved}</td>
            <td data-l="Last request">${p.last ? esc(fmtDate(p.last)) : '<span class="sub">—</span>'}</td>
            <td data-l="">${access.emails.includes(p.email) ? `<button class="link" data-rm="${esc(p.email)}">Remove</button>` : ""}</td>
          </tr>`).join("") || '<tr><td colspan="6" class="empty">No one yet.</td></tr>'}</tbody></table></div>
        <h2 class="section">Domain access</h2>
        <div class="card panel">
          <p class="fine" style="margin-top:0">Everyone with an address at these domains can sign in. Subdomains are not included.</p>
          <form class="addrow" id="addDomain"><input class="field" id="newDomain" placeholder="synergyrealtors.com" autocomplete="off" aria-label="Domain"><button class="btn ghost">Add domain</button></form>
          <ul class="taglist">${access.domains.map((d) => `<li>@${esc(d)} <button class="link" data-rmd="${esc(d)}">Remove</button></li>`).join("")}
            ${access.env.domains.filter((d) => !access.domains.includes(d)).map((d) => `<li class="fixed">@${esc(d)} <span class="fine">Set in Netlify</span></li>`).join("")}</ul>
        </div>
        <p class="fine">Admins and team members are set in Netlify (<code>ADMIN_EMAILS</code>, <code>TEAM_EMAILS</code>).</p>`;

      $("addEmail").onsubmit = (e) => { e.preventDefault(); const v = $("newEmail").value.trim().toLowerCase(); if (v) save({ emails: [...new Set([...access.emails, v])], domains: access.domains }, `Added ${v}.`); };
      $("addDomain").onsubmit = (e) => { e.preventDefault(); const v = $("newDomain").value.trim().toLowerCase().replace(/^@/, ""); if (v) save({ emails: access.emails, domains: [...new Set([...access.domains, v])] }, `Added @${v}.`); };
      view.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => confirm(`Remove ${b.dataset.rm}? They lose access right away.`) && save({ emails: access.emails.filter((x) => x !== b.dataset.rm), domains: access.domains }, `Removed ${b.dataset.rm}.`));
      view.querySelectorAll("[data-rmd]").forEach((b) => b.onclick = () => confirm(`Remove @${b.dataset.rmd}? Everyone at that domain who isn't listed loses access.`) && save({ emails: access.emails, domains: access.domains.filter((x) => x !== b.dataset.rmd) }, `Removed @${b.dataset.rmd}.`));
    };

    async function save(next, done) {
      const r = await api("PUT", "/api/admin/access", next);
      if (!r.ok) return toast(r.data.error === "invalid_entry" ? "That doesn't look like a valid entry." : "Could not save. Try again.", true);
      access = { ...access, ...next }; draw(); toast(done);
    }
    draw();
  }

  // ---- Settings ------------------------------------------------------------
  async function renderSettings() {
    const r = await api("GET", "/api/admin/settings");
    if (!r.ok) { view.innerHTML = '<p class="empty">Only administrators can change settings.</p>'; return; }
    view.innerHTML = `
      <section class="intro"><div><h1>Settings</h1><p class="sub">Changes save as soon as you make them.</p></div></section>
      <div class="card panel">
        <label class="switch"><input type="checkbox" id="cOn" role="switch"><span><b>Close requests each week</b><br><span class="fine" id="cState"></span></span></label>
        <div id="cMore">
          <div class="cut"><span>Close every</span>
            <select class="field" id="cDay" aria-label="Day of the week">${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((n, i) => `<option value="${i}">${n}</option>`).join("")}</select>
            <span>at</span><input class="field" id="cTime" type="time" step="900" aria-label="Time"><span class="fine">Central time</span></div>
        </div>
        <div class="summary" id="cSum"></div>
      </div>`;
    let last = r.data, seq = 0;
    const show = (d) => {
      last = d;
      $("cOn").checked = d.cutoff.enabled; $("cMore").hidden = !d.cutoff.enabled;
      $("cDay").value = String(d.cutoff.day); $("cTime").value = d.cutoff.time;
      $("cState").textContent = d.cutoff.enabled ? "Requests stop at the day and time you choose." : "Off. Requests stay open until Sunday evening.";
      $("cSum").innerHTML = `Requests for the weekend of <b>${esc(d.weekend)}</b> close <b>${esc(d.closesLabel)}</b>.`;
    };
    const save = async () => {
      const time = $("cTime").value; if (!/^\d\d:\d\d$/.test(time)) return;
      const n = ++seq;
      const res = await api("PUT", "/api/admin/settings", { enabled: $("cOn").checked, day: Number($("cDay").value), time });
      if (n !== seq) return;
      if (!res.ok) { show(last); return toast(res.data.message || "Couldn't save. Your change was not applied.", true); }
      show(res.data); toast(`Saved. Requests close ${res.data.closesLabel}.`);
    };
    $("cOn").onchange = () => { $("cMore").hidden = !$("cOn").checked; save(); };
    $("cDay").onchange = save; $("cTime").onchange = save;
    show(last);
  }

  start();
})();
