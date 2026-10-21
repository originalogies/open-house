// Team console: one page, four views (Requests, Listings, Agents, Settings) chosen by the URL hash.
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
  };
  const mlsCell = (r) => {
    if (r.status !== "approved" && r.status !== "cancelled") return '<span class="sub">—</span>';
    let [c, t] = MLS[r.mlsState] || ["", mode === "off" ? "Entered by hand" : "Not sent yet"];
    if (r.status === "cancelled" && r.mlsState === "synced") t = "Cancelled on the MLS";
    if (r.status === "cancelled" && (r.mlsState === "manual" || (!r.mlsState && mode === "off"))) t = "Remove by hand";
    return `<span class="pill ${c}">${esc(t)}</span><div class="sub"><a href="/respond/?id=${encodeURIComponent(r.id)}">MLS status</a></div>`;
  };
  // Listing photos are Repliers CDN paths; built-in listings may carry a full URL.
  const photo = (img, size = "small") => !img ? "" : /^https?:/.test(img) ? img : `https://cdn.repliers.io/${img}?class=${size}`;
  const pill = (s) => `<span class="pill ${esc(s)}">${esc(STATUS[s] || s)}</span>`;

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

  function renderWho() {
    $("who").innerHTML = `<span>Signed in as</span><br><strong>${esc(me.name || me.email)}</strong>
      <div class="who-links"><a href="/">Agent portal</a><button type="button" id="signOut">Sign out</button></div>`;
    $("signOut").onclick = async () => { await fetch("/api/auth/logout", { method: "POST" }).catch(() => {}); location.reload(); };
  }

  const VIEWS = { requests: renderRequests, listings: renderListings, agents: renderAgents, settings: renderSettings };
  // Links to one agent's history look like #agent/name@example.com.
  const agentLink = (email, label) => `<a href="#agent/${encodeURIComponent(email)}">${esc(label || email)}</a>`;

  function route() {
    const [hashName, arg] = location.hash.slice(1).split("/");
    let name = hashName || "requests";
    if (name === "agent" && arg) {
      document.querySelectorAll("#tabs a").forEach((a) => { if (a.dataset.view === (me.admin ? "agents" : "requests")) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
      view.innerHTML = '<p class="empty">Loading…</p>';
      renderAgent(decodeURIComponent(arg).toLowerCase());
      window.scrollTo(0, 0);
      return;
    }
    if (!VIEWS[name] || ((name === "agents" || name === "settings") && !me.admin)) name = "requests";
    document.querySelectorAll("#tabs a").forEach((a) => { if (a.dataset.view === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
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
    renderWho();
    if (!me.team) {
      view.innerHTML = `<section class="intro"><div><h1>Team members only</h1><p class="sub">The console is for the George &amp; Noonan team. You can still request open houses on the <a href="/">agent portal</a>.</p></div></section>`;
      return;
    }
    $("tabs").hidden = false;
    if (!me.admin) document.querySelectorAll("#tabs [data-admin]").forEach((a) => a.remove());
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
        <td data-l="Status">${pill(r.status)}${r.cancelRequest ? '<div class="sub">Agent asked to cancel</div>' : ""}${r.cancelledBy ? `<div class="sub">by ${esc(r.cancelledBy)}</div>` : ""}</td>
        <td data-l="Decided">${r.decidedBy ? `${esc(r.decidedBy)}<div class="sub">${esc(fmtDate(r.decidedAt))}</div>` : '<span class="sub">—</span>'}</td>
        <td data-l="MLS">${mlsCell(r)}</td>
        <td data-l="">${r.status === "approved" && r.iso >= todayIso() ? `<button class="link" data-cancel="${esc(r.id)}">Cancel</button>` : ""}</td>
      </tr>`).join("") : '<tr><td colspan="7" class="empty">No requests match.</td></tr>';
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
        ${mode === "off" ? '<label class="check"><input type="checkbox" class="mls"> Entered on the MLS</label>'
          : `<span class="fine">Approving sends it to the MLS bot${mode === "dry_run" ? " as a dry run" : ""}.</span>`}
        <div class="btns"><button class="btn small approve" ${mode === "off" ? "disabled" : ""}>Approve</button><button class="btn danger small decline">Decline</button></div>
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

  function exportCsv(list = filtered(), name = "open-house-requests") {
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Date", "Day", "Time", "Address", "City", "MLS", "Agent", "Agent email", "Phone", "Status", "Decided by", "Decided at", "Requested at", "Notes"];
    const rows = list.map((r) => [r.iso, r.day, r.time, r.addr, r.city, r.mls, r.agent.name, r.agent.email, r.phone, STATUS[r.status] || r.status,
      r.decidedBy, r.decidedAt ? new Date(r.decidedAt).toISOString() : "", new Date(r.createdAt).toISOString(), r.notes]);
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
      <div class="card table-wrap"><table class="stack"><thead><tr><th>Open house</th><th>Home</th><th>Status</th><th>Decided</th></tr></thead><tbody>
        ${mine.map((r) => `<tr>
          <td data-l="Open house"><b>${esc(r.day)}, ${esc(r.date)}</b><div class="sub">${esc(r.time)}</div></td>
          <td data-l="Home">${esc(r.addr)}<div class="sub">${esc(r.city)} · MLS# ${esc(r.mls)}</div></td>
          <td data-l="Status">${label(r)}</td>
          <td data-l="Decided">${r.decidedBy ? `${esc(r.decidedBy)}<div class="sub">${esc(fmtDate(r.decidedAt))}</div>` : '<span class="sub">—</span>'}</td>
        </tr>`).join("") || '<tr><td colspan="4" class="empty">No open house requests yet.</td></tr>'}
      </tbody></table></div>`;
    if (mine.length) $("csv").onclick = () => exportCsv(mine, `open-houses-${email.split("@")[0]}`);
  }

  // ---- Listings ------------------------------------------------------------
  let listFilter = "all";

  async function renderListings() {
    const r = await api("GET", "/api/inventory/listings");
    if (!r.ok) { view.innerHTML = `<div class="card banner err">${esc(r.data.message || "Could not load listings from Repliers.")}</div>`; return; }
    const d = r.data;
    const stale = d.feedUpdatedOn && Math.floor((Date.now() - new Date(d.feedUpdatedOn + "T12:00:00Z")) / 86400000);
    view.innerHTML = `
      <section class="intro"><div><h1>Publish this weekend's homes</h1>
        <p class="sub">Weekend of ${esc(d.week.sat.date)} and ${esc(d.week.sun.date)}. Requests close ${esc(d.closesLabel)}. Turn on the homes agents can request. Offers and Priority reset each week; instructions and access details are kept.</p></div>
        <a class="btn ghost small" href="/" target="_blank" rel="noopener">Preview agent portal</a></section>
      ${d.warning ? `<div class="card banner err"><b>Repliers problem:</b> ${esc(d.warning)}</div>` : ""}
      ${stale >= 3 ? `<div class="card banner"><b>Repliers data looks out of date.</b> Last updated ${esc(d.feedUpdatedOn)} (${stale} days ago).</div>` : ""}
      <div class="toolbar">
        <div class="chips" id="lchips">
          <button class="chip" data-f="all" aria-pressed="${listFilter === "all"}">All homes (${d.listings.length})</button>
          <button class="chip" data-f="offered" aria-pressed="${listFilter === "offered"}">Offered (<span id="offeredN">${d.listings.filter((l) => l.offered).length}</span>)</button>
        </div>
        <span class="spacer"></span>
        <span class="fine">${d.feedUpdatedOn ? `Repliers data updated ${esc(d.feedUpdatedOn)}` : ""}</span>
      </div>
      <div class="listings" id="list"></div>
      <details style="margin-top:28px"><summary class="fine">Check Repliers data</summary>
        <p class="fine">Shows one raw listing so field mapping can be verified.</p>
        <button class="btn ghost small" id="raw">Show sample</button><pre id="rawOut" class="card" style="padding:12px;white-space:pre-wrap;word-break:break-all;font-size:.8rem" hidden></pre></details>`;

    const list = $("list");
    const paint = () => {
      list.innerHTML = "";
      const shown = d.listings.filter((l) => listFilter === "all" || l.offered);
      if (!shown.length) list.innerHTML = `<div class="card empty">${listFilter === "offered" ? "No homes offered yet this weekend." : "No active listings found in Repliers."}</div>`;
      shown.forEach((l) => list.append(listingCard(l, () => { $("offeredN").textContent = d.listings.filter((x) => x.offered).length; })));
    };
    $("lchips").onclick = (e) => { const b = e.target.closest(".chip"); if (!b) return; listFilter = b.dataset.f; $("lchips").querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", c === b)); paint(); };
    $("raw").onclick = async () => { const j = await api("GET", "/api/inventory/listings?raw=1"); const o = $("rawOut"); o.hidden = false; o.textContent = JSON.stringify(j.data, null, 2); };
    paint();
  }

  function listingCard(l, onSaved) {
    const c = document.createElement("article"); c.className = "card lcard" + (l.priority ? " pri" : "");
    const oh = l.openHouses.length ? `<div class="mls-oh">Already on the MLS: ${l.openHouses.map((o) => `${o.day === "sat" ? "Sat" : "Sun"} ${o.from}:00–${o.to}:00`).join(", ")}</div>` : "";
    const badges = () => `${l.offered ? '<span class="pill approved">Offered</span>' : ""}${l.priority ? '<span class="pill priority">★ Priority</span>' : ""}`;
    c.innerHTML = `
      <div class="photo">${l.img ? `<img src="${esc(photo(l.img, "medium"))}" alt="" loading="lazy">` : ""}</div>
      <div class="body">
        <h3>${esc(l.addr)} <span class="badges">${badges()}</span></h3>
        <div class="fine">${esc(l.city)} · MLS# ${esc(l.mls)} · ${money(l.price)}${l.bd ? ` · ${esc(l.bd)} bd / ${esc(l.ba)} ba` : ""}${l.sf ? ` · ${Number(l.sf).toLocaleString()} sq ft` : ""}</div>
        ${oh}
        <div class="toggles">
          <label class="check"><input type="checkbox" data-f="offered" ${l.offered ? "checked" : ""}> Offer this weekend</label>
          <label class="check"><input type="checkbox" data-f="sat" ${l.days.includes("sat") ? "checked" : ""}> Saturday</label>
          <label class="check"><input type="checkbox" data-f="sun" ${l.days.includes("sun") ? "checked" : ""}> Sunday</label>
          <label class="check"><input type="checkbox" data-f="priority" ${l.priority ? "checked" : ""}> Priority</label>
        </div>
        <div class="two">
          <div><label class="label">Instructions for agents (one per line)</label><textarea class="field" data-f="instr">${esc(l.instr.join("\n"))}</textarea></div>
          <div><label class="label">Access details (private)</label><textarea class="field" data-f="access" placeholder="Gate, lockbox, alarm codes">${esc(l.access)}</textarea>
            <div class="fine">Only sent in the Confirmed and Reminder emails. Never shown to agents on the site.</div></div>
        </div>
        <div class="foot"><button class="btn small save">Save</button><span class="fine msg" role="status"></span></div>
      </div>`;
    const q = (f) => c.querySelector(`[data-f="${f}"]`), msg = c.querySelector(".msg");
    c.querySelector(".save").onclick = async () => {
      msg.textContent = "Saving…";
      const days = ["sat", "sun"].filter((d) => q(d).checked);
      const res = await api("PUT", "/api/inventory/listings", { mls: l.mls, offered: q("offered").checked, priority: q("priority").checked, days,
        instr: q("instr").value.split("\n"), access: q("access").value });
      if (!res.ok) { msg.textContent = ""; return toast(res.data.message || "Could not save. Try again.", true); }
      Object.assign(l, { offered: q("offered").checked, priority: q("priority").checked, days, instr: q("instr").value.split("\n").map((s) => s.trim()).filter(Boolean), access: q("access").value });
      c.classList.toggle("pri", l.priority);
      c.querySelector(".badges").innerHTML = badges();
      msg.textContent = "";
      toast(`Saved ${l.addr}.`);
      onSaved();
    };
    return c;
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
