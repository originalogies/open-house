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
  // The Requests list shows the MLS only when it needs the team (the request's page has the full MLS status).
  // A request being approved with the AI agent waits until it's on the MLS; a dry run never gets it there.
  const MLS_ALERT = { failed: "MLS update failed", needs_login: "MLS sign-in needed" };
  const mlsNote = (r) => {
    if (r.approving) {
      const bad = MLS_ALERT[r.mlsState] || (r.mlsState === "dry_run_ok" ? "Dry run only: not on the MLS" : "");
      return bad ? `<div class="sub alert">${bad}</div>` : '<div class="sub">AI agent adding it to the MLS</div>';
    }
    return r.status === "approved" && MLS_ALERT[r.mlsState] ? `<div class="sub alert">${MLS_ALERT[r.mlsState]}</div>` : "";
  };
  const requestPage = (r) => `/respond/?id=${encodeURIComponent(r.id)}`;
  // Listing photos are Repliers CDN paths; built-in listings may carry a full URL, and homes the team
  // added before they're on the MLS have photos on this site ("/api/home-photo?...").
  const photo = (img, size = "small") => !img ? "" : /^(https?:|\/)/.test(img) ? img : `https://cdn.repliers.io/${img}?class=${size}`;
  const pill = (s) => `<span class="pill ${esc(s)}">${esc(STATUS[s] || s)}</span>`;
  // A home's street and city, the way every address on the site reads: "200 Murano Place, Southlake".
  const place = (x) => [x.addr, x.city].filter(Boolean).join(", ");
  // Open houses imported from the G&N calendar may have no MLS number, and nobody decided them here.
  const mlsNo = (r) => (r.mls ? `MLS# ${esc(r.mls)}` : "MLS# not found");
  // "Sat, Oct 24", with the year when it isn't this year (the list goes back to imported history).
  const dayDate = (r) => `${esc(r.day.slice(0, 3))}, ${esc(r.date)}${r.iso.slice(0, 4) !== todayIso().slice(0, 4) ? `, ${esc(r.iso.slice(0, 4))}` : ""}`;
  // "1–4 PM", or "10 AM–1 PM" when the hours cross noon.
  const hours = (r) => {
    const h = (n) => n % 12 || 12, ap = (n) => (n >= 12 ? "PM" : "AM");
    return ap(r.from) === ap(r.to) ? `${h(r.from)}–${h(r.to)} ${ap(r.to)}` : `${h(r.from)} ${ap(r.from)}–${h(r.to)} ${ap(r.to)}`;
  };
  const decided = (r) => r.decidedBy ? `${esc(r.decidedBy)}<div class="sub">${esc(fmtDate(r.decidedAt))}</div>`
    : `<span class="sub">${r.imported ? "Imported" : "—"}</span>`;
  // What "Vacant" means; agents see the same sentence on the portal.
  const VACANT_TIP = "No one is living in this home, so there are no occupants.";
  // The days of the week an open house can be on, Monday first: [key, short, full]. Each home allows some of them.
  const WEEKDAYS = [["mon", "Mon", "Monday"], ["tue", "Tue", "Tuesday"], ["wed", "Wed", "Wednesday"], ["thu", "Thu", "Thursday"],
    ["fri", "Fri", "Friday"], ["sat", "Sat", "Saturday"], ["sun", "Sun", "Sunday"]];
  const SHORT_DAY = Object.fromEntries(WEEKDAYS.map(([k, s]) => [k, s]));
  // The Support and Referral Agreement each agent signs in DocuSeal before using the portal (GET /api/admin/agreements).
  // "Signed Oct 28, 2026, 3:14 PM", with a link to the signed copy.
  const fmtSigned = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const signedCopy = (email) => `<a href="/api/admin/agreements?copy=${encodeURIComponent(email)}" target="_blank" rel="noopener">Signed copy</a>`;
  const agreementCell = (ag, email) => {
    const a = ag.agreements.find((x) => x.email === email);
    if (ag.exempt.includes(email)) return '<span class="sub">Not needed (team)</span>';
    if (a?.status === "signed") return `<span class="pill approved">Signed</span><div class="sub">${esc(fmtSigned(a.signedAt))} · ${signedCopy(email)}</div>`;
    if (a?.status === "declined") return '<span class="pill declined">Declined</span>';
    if (a?.status === "pending") return '<span class="pill pending">Started</span><div class="sub">Not signed yet</div>';
    return '<span class="sub">Not signed</span>';
  };
  // The agent's feedback after hosting (/feedback/ on the agent side). The full feedback is on the request's
  // page and, collected by home, on the Feedback tab; lists show a short note that links to the request.
  const INTEREST = { lots: "Lots", some: "Some", little: "Little" };
  const PRICE = { high: "Too high", right: "About right", value: "Good value", none: "Didn't come up" };
  const fbNote = (r) => r.feedback ? `<div class="sub">${r.feedback.brokerFlag ? '<b class="flagged">⚠ Flagged</b> · ' : ""}<a href="${esc(requestPage(r))}">Feedback sent</a></div>`
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
  // Feedback columns for the CSV exports. Older feedback's "What happened" goes in the liked column.
  const FB_HEAD = ["Visitors", "Interest", "Price", "What guests liked", "What guests didn't like", "Additional feedback", "Notes for the team", "Photos", "Flagged for broker"];
  const fbCsv = (f) => !f ? FB_HEAD.map(() => "") : [f.visitors, INTEREST[f.interest] || "", PRICE[f.price] || "", f.liked ?? f.happened, f.disliked || "",
    f.forSeller || "", f.teamNotes, (f.photos || []).map((u) => location.origin + u).join(" "), f.brokerFlag ? "Yes" : "No"];

  let me = null;
  let requests = [];

  // An "i" button opens its note on a tap (phones have no hover); tapping anywhere else or Escape closes it.
  document.addEventListener("click", (e) => {
    const i = e.target.closest("button.tip-i");
    document.querySelectorAll(".tip.open").forEach((t) => { if (t !== i?.parentElement) t.classList.remove("open"); });
    if (i) i.parentElement.classList.toggle("open");
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".tip.open").forEach((t) => t.classList.remove("open")); });

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
    const [hashName, arg, sub] = location.hash.slice(1).split("/");
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
      renderHome(decodeURIComponent(arg), sub);
      window.scrollTo(0, 0);
      return;
    }
    if (!VIEWS[name] || ((name === "agents" || name === "settings") && !me.admin)) name = "requests";
    OHNav.setCurrent(name);
    view.innerHTML = '<p class="empty">Loading…</p>';
    VIEWS[name]();
    window.scrollTo(0, 0);
  }

  // The first list is fetched alongside the sign-in check (start) and used by the first view that needs it.
  let primed = null;
  async function loadRequests() {
    const p = primed || api("GET", "/api/team/requests"); primed = null;
    const r = await p;
    if (r.ok) requests = r.data.requests;
    const n = requests.filter((x) => x.status === "pending" || asksToCancel(x)).length;
    $("pendingCount").textContent = n; $("pendingCount").hidden = !n;
    return r.ok;
  }
  // The agent asked to cancel and the open house hasn't happened yet.
  const asksToCancel = (r) => !!r.cancelRequest && r.iso >= todayIso();

  async function start() {
    primed = api("GET", "/api/team/requests");
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
    // Going back from a request's page (on phones especially) can restore this page as it was; reload the view.
    window.addEventListener("pageshow", (e) => { if (e.persisted) route(); });
    route();
    if (primed) loadRequests(); // views that don't list requests still show the waiting count
  }

  // ---- Requests ------------------------------------------------------------
  // One list. Requests waiting for a decision (new ones and agents' cancellation requests) are pinned at
  // the top whatever the time frame; Review opens the request's page to decide. The time frame (by open
  // house date) sets the stat cards and the rest of the list; status chips and search narrow the list only.
  // The list is split into pages of 25, 50 or 100 rows.
  // Filters and the page are kept for this tab, so Back from a request's page returns to the same view.
  const RANGES = { week: "This week", month: "This month", year: "This year", all: "All time", custom: "Custom range" };
  const PAGE_SIZES = [25, 50, 100];
  // Pages of a list (the Requests list and an agent's open houses): rows per page, which rows are showing, Previous and Next.
  const pagerHtml = (label, per) => `<nav class="pager" id="pager" aria-label="${label}">
        <label class="pg-size"><span>Rows per page</span><select class="field" id="per">${PAGE_SIZES.map((n) => `<option value="${n}" ${n === per ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <span class="pg-info" id="pgInfo"></span>
        <span class="pg-nav"><button class="btn ghost small" id="prev">Previous</button><button class="btn ghost small" id="next">Next</button></span>
      </nav>`;
  // Fills in the pager for `total` rows; returns the page (kept in range), the page count and the page's first and last row.
  function paintPager(total, page, per) {
    const pages = Math.max(1, Math.ceil(total / per));
    page = Math.min(Math.max(1, page), pages);
    const first = (page - 1) * per, last = Math.min(first + per, total);
    $("pager").hidden = !total;
    $("pgInfo").innerHTML = `${(first + 1).toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}${pages > 1 ? `<span class="pg-of"> · Page ${page} of ${pages}</span>` : ""}`;
    $("prev").disabled = page <= 1; $("next").disabled = page >= pages;
    return { page, pages, first, last };
  }
  // A new page size keeps the first row of the current page in view.
  const resizedPage = (page, per, newPer) => Math.floor(((page - 1) * per) / newPer) + 1;
  let reqFilter = "all", reqSearch = "", reqRange = "week", reqFrom = "", reqTo = "", reqPer = 25, reqPage = 1;
  try { ({ reqFilter = "all", reqSearch = "", reqRange = "week", reqFrom = "", reqTo = "", reqPer = 25, reqPage = 1 } = JSON.parse(sessionStorage.getItem("oh.requests") || "{}")); } catch {}
  if (!RANGES[reqRange]) reqRange = "week";
  if (!PAGE_SIZES.includes(reqPer)) reqPer = 25;
  const saveFilters = () => { try { sessionStorage.setItem("oh.requests", JSON.stringify({ reqFilter, reqSearch, reqRange, reqFrom, reqTo, reqPer, reqPage })); } catch {} };
  const waits = (r) => r.status === "pending" || asksToCancel(r);

  // The time frame as [first, last] open house dates ("" = open-ended). Weeks run Monday to Sunday,
  // so "This week" holds this weekend's open houses.
  const shiftIso = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  function rangeBounds() {
    const t = todayIso(), [y, m] = t.split("-").map(Number);
    if (reqRange === "week") { const mon = shiftIso(t, -((new Date(`${t}T12:00:00Z`).getUTCDay() + 6) % 7)); return [mon, shiftIso(mon, 6)]; }
    if (reqRange === "month") return [t.slice(0, 8) + "01", new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)];
    if (reqRange === "year") return [`${y}-01-01`, `${y}-12-31`];
    if (reqRange === "custom") return reqFrom && reqTo && reqFrom > reqTo ? [reqTo, reqFrom] : [reqFrom, reqTo];
    return ["", ""];
  }
  const inRange = (r, [a, b]) => (!a || r.iso >= a) && (!b || r.iso <= b);
  const fmtIso = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  function rangeLabel() {
    const [a, b] = rangeBounds();
    if (a && b) return `${fmtIso(a)} – ${fmtIso(b)}`;
    return a ? `From ${fmtIso(a)}` : b ? `Through ${fmtIso(b)}` : "Every open house";
  }

  async function renderRequests() {
    if (!(await loadRequests())) { view.innerHTML = '<p class="empty">Could not load requests.</p>'; return; }
    view.innerHTML = `
      <section class="intro"><div><h1>Open house requests</h1>
        <p class="sub">Requests from Synergy agents. Anything waiting for a decision, including an agent's cancellation request, stays at the top; Review opens it to approve or decline. The first approval locks the time.</p></div>
        <div class="intro-actions"><button class="btn small" id="addReqBtn" aria-expanded="false" aria-controls="addReq">Add a request</button></div></section>
      <div id="addReq" hidden></div>
      <div class="timeframe">
        <label class="tf-pick"><span>Time frame</span><select class="field" id="range">${Object.entries(RANGES).map(([k, v]) => `<option value="${k}" ${k === reqRange ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <span class="tf-dates" id="custom" ${reqRange === "custom" ? "" : "hidden"}>
          <label><span>From</span><input class="field" type="date" id="from" value="${esc(reqFrom)}"></label>
          <label><span>To</span><input class="field" type="date" id="to" value="${esc(reqTo)}"></label>
        </span>
        <span class="tf-label" id="rangeLabel"></span>
      </div>
      <div class="stats" id="stats"></div>
      <h2 class="section">Requests</h2>
      <div class="toolbar">
        <div class="chips" id="chips">${["all", "pending", "approved", "declined", "expired", "cancelled"].map((s) =>
          `<button class="chip" data-s="${s}" aria-pressed="${s === reqFilter}">${s === "all" ? "All" : STATUS[s]}</button>`).join("")}</div>
        <input class="field" id="search" type="search" placeholder="Search agent or address" value="${esc(reqSearch)}" aria-label="Search requests">
        <span class="spacer"></span>
        <button class="btn ghost small" id="csv">Export CSV</button>
      </div>
      <div class="card table-wrap"><table class="stack reqs"><thead><tr><th>Open house</th><th>Home</th><th>Agent</th><th>Status</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
      ${pagerHtml("Pages of requests", reqPer)}`;

    const refresh =() => { reqPage = 1; saveFilters(); $("rangeLabel").textContent = rangeLabel(); fillStats(); fillRows(); };
    $("range").onchange = (e) => {
      if (e.target.value === "custom" && !reqFrom && !reqTo) [reqFrom, reqTo] = rangeBounds(); // start from the range picked before
      reqRange = e.target.value;
      $("custom").hidden = reqRange !== "custom";
      $("from").value = reqFrom; $("to").value = reqTo;
      refresh();
    };
    $("from").onchange = (e) => { reqFrom = e.target.value; refresh(); };
    $("to").onchange = (e) => { reqTo = e.target.value; refresh(); };
    $("chips").onclick = (e) => { const b = e.target.closest(".chip"); if (!b) return; reqFilter = b.dataset.s; reqPage = 1; $("chips").querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", c === b)); saveFilters(); fillRows(); };
    $("search").oninput = (e) => { reqSearch = e.target.value; reqPage = 1; saveFilters(); fillRows(); };
    $("per").onchange = (e) => { const per = Number(e.target.value); reqPage = resizedPage(reqPage, reqPer, per); reqPer = per; saveFilters(); fillRows(); };
    const turn = (n) => { reqPage += n; saveFilters(); fillRows(); $("rows").closest(".card").scrollIntoView({ block: "start" }); };
    $("prev").onclick = () => turn(-1);
    $("next").onclick = () => turn(1);
    $("csv").onclick = () => exportCsv();
    $("addReqBtn").onclick = () => ($("addReq").hidden ? addRequest() : closeAddRequest());
    $("rangeLabel").textContent = rangeLabel(); fillStats(); fillRows(); // keeps the saved page, unlike refresh()
  }

  // Stat cards: waiting counts everything pinned at the top; the rest count the time frame.
  function fillStats() {
    const frame = requests.filter((r) => inRange(r, rangeBounds()));
    $("stats").innerHTML = `
      <div class="card stat"><b>${frame.length}</b><span>Requests</span></div>
      <div class="card stat wait"><b>${requests.filter(waits).length}</b><span>Waiting for a decision</span></div>
      <div class="card stat"><b>${frame.filter((r) => r.status === "approved").length}</b><span>Approved</span></div>
      <div class="card stat"><b>${new Set(frame.map((r) => r.agent.email.toLowerCase())).size}</b><span>Agents</span></div>`;
  }

  // Waiting requests (soonest first, any date), then the time frame's others (newest open house first).
  // The "Waiting" chip shows everything that needs a decision.
  function listParts() {
    const s = reqSearch.trim().toLowerCase(), bounds = rangeBounds();
    const match = (r) => (reqFilter === "all" || (reqFilter === "pending" ? waits(r) : r.status === reqFilter))
      && (!s || [r.agent.name, r.agent.email, r.addr, r.city, r.mls].join(" ").toLowerCase().includes(s));
    return {
      waiting: requests.filter((r) => waits(r) && match(r)).sort((a, b) => a.iso.localeCompare(b.iso) || a.from - b.from),
      rest: requests.filter((r) => !waits(r) && inRange(r, bounds) && match(r)).sort((a, b) => b.iso.localeCompare(a.iso) || a.from - b.from),
    };
  }
  const filtered = () => { const { waiting, rest } = listParts(); return [...waiting, ...rest]; };

  // One page of the list. A group's heading (with the group's full count) shows on each page that
  // has rows from it; the time frame's "nothing here" row shows on the last page.
  function fillRows() {
    const { waiting, rest } = listParts();
    const showRest = reqFilter !== "pending"; // the Waiting chip has nothing below
    const total = waiting.length + (showRest ? rest.length : 0);
    let pages, first, last;
    ({ page: reqPage, pages, first, last } = paintPager(total, reqPage, reqPer));
    const pageWaiting = waiting.slice(first, last), pageRest = showRest ? rest.slice(Math.max(0, first - waiting.length), last - waiting.length) : [];
    const group = (label, n) => `<tr class="group"><th colspan="5">${esc(label)} <span>${n}</span></th></tr>`;
    // On phones each row is three short lines: when and status, the home, the agent and the action.
    // The address (and the whole row) opens the request's page.
    const row = (r, wait) => `<tr class="req${wait ? " wait" : ""}" data-open="${esc(requestPage(r))}">
        <td class="when" data-l="Open house"><b>${dayDate(r)}</b><div class="sub">${esc(hours(r))}</div></td>
        <td class="home" data-l="Home"><a href="${esc(requestPage(r))}">${esc(place(r))}</a><div class="sub">${mlsNo(r)}</div></td>
        <td class="agent" data-l="Agent">${agentLink(r.agent.email, r.agent.name)}</td>
        <td class="status" data-l="Status">${pill(r.status)}${r.addedBy ? `<div class="sub">Added by ${esc(r.addedBy)}${r.status === "pending" && r.holds ? " · hours held" : ""}</div>` : ""}${r.cancelRequest ? '<div class="sub">Agent asked to cancel</div>' : ""}${r.cancelledBy ? `<div class="sub">by ${esc(r.cancelledBy)}</div>` : ""}${mlsNote(r)}${fbNote(r)}</td>
        <td class="act" data-l="">${wait ? `<a class="btn small" href="${esc(requestPage(r))}">Review</a>`
          : r.status === "approved" && r.iso >= todayIso() ? `<button class="link" data-cancel="${esc(r.id)}">Cancel</button>` : ""}</td>
      </tr>`;
    $("rows").innerHTML = !waiting.length && !rest.length ? '<tr><td colspan="5" class="empty">No requests match.</td></tr>'
      : (pageWaiting.length ? group("Waiting for a decision", waiting.length) + pageWaiting.map((r) => row(r, true)).join("") : "")
        + (!showRest || (!pageRest.length && (rest.length || reqPage < pages)) ? "" : group(`${RANGES[reqRange]} · ${rangeLabel()}`, rest.length)
          + (pageRest.length ? pageRest.map((r) => row(r, false)).join("") : '<tr><td colspan="5" class="empty">No other requests in this time frame.</td></tr>'));
    // A tap anywhere else on a row opens it (links, buttons and selecting text keep working).
    $("rows").onclick = (e) => {
      const tr = e.target.closest("tr[data-open]");
      if (tr && !e.target.closest("a, button") && !String(getSelection())) location.href = tr.dataset.open;
    };
    $("rows").querySelectorAll("[data-cancel]").forEach((b) => b.onclick = async () => {
      const r = requests.find((x) => x.id === b.dataset.cancel);
      if (await OHDialog.confirm({ title: "Cancel this open house?", danger: true, ok: "Cancel open house", cancel: "Keep it",
        body: `${r.agent.name}'s open house at ${place(r)} on ${r.day}, ${r.date}, ${r.time}. The agent and team will be emailed${r.byHand ? "; remove it from the MLS by hand." : ", and the AI agent marks it Canceled on the MLS."}` })) manageAction(r, "cancel", b);
    });
  }

  // Cancel an approved open house from the list (agent and team are emailed).
  async function manageAction(r, action, btn) {
    btn.disabled = true;
    const res = await api("POST", "/api/manage", { id: r.id, action });
    if (res.ok) toast(res.data.message || "Cancelled. The agent and team were emailed.");
    else if (res.data.error === "email_failed") toast(res.data.message || "Saved, but the email failed to send.", true);
    else { toast(res.data.message || "Could not save. Try again.", true); btn.disabled = false; return; }
    renderRequests();
  }

  // ---- Add a request -------------------------------------------------------
  // The team adds an open house for an agent who asked them directly (POST /api/team/new-request). One step at a
  // time: who's hosting, the home, the day (any day the seller allows, this week and the next three; the weekly cutoff doesn't apply), the
  // time, then Auto-Approve. Approved now, the agent gets the Confirmed email (unless Send Email Confirmations is
  // unticked); left unticked, it waits for a decision.
  // Either way its hours are held as soon as it's added. The time picker works like the agent portal's.
  const fmtH = (h) => `${h % 12 || 12}:00 ${h >= 12 ? "PM" : "AM"}`;
  const fmtSpan = (r) => `${fmtH(r.from)} to ${fmtH(r.to)}`;
  const OTHER = "__other";
  const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

  function closeAddRequest() {
    $("addReq").hidden = true; $("addReq").innerHTML = "";
    $("addReqBtn").setAttribute("aria-expanded", "false");
  }

  async function addRequest() {
    const box = $("addReq");
    box.hidden = false; $("addReqBtn").setAttribute("aria-expanded", "true");
    box.innerHTML = '<div class="card addreq"><p class="fine">Loading…</p></div>';
    const res = await api("GET", "/api/team/new-request");
    if (box.hidden) return; // closed while loading
    if (!res.ok) { box.innerHTML = `<div class="card addreq"><p class="ar-err">${esc(res.data.message || "Couldn't load the homes. Try again.")}</p></div>`; return; }
    const d = res.data, ROW = 44, FIRST = d.firstHour, LAST = d.lastHour;
    let home = null, day = null, sel = null;

    const agentOpt = (a) => `<option value="${esc(a.email)}">${esc(a.name)} · ${esc(a.email)}</option>`;
    const homeOpt = (h) => `<option value="${esc(h.mls)}">${esc(place(h))} · ${h.teamAdded ? "Not on the MLS yet" : `MLS# ${esc(h.mls)}`}</option>`;
    const published = d.homes.filter((h) => h.offered), others = d.homes.filter((h) => !h.offered);
    box.innerHTML = `<div class="card addreq">
      <h3>Add an open house request</h3>
      <p class="fine">For an agent who asked the team directly. Its hours are held for them as soon as it's added.</p>
      ${d.warning ? `<p class="ar-err">Repliers couldn't be reached, so only the built-in and team-added homes are listed.</p>` : ""}
      <section class="step" id="arWho">
        <label class="label" for="arAgent">Who's hosting the open house?</label>
        <select class="field" id="arAgent"><option value="">Choose an agent…</option>${d.agents.map(agentOpt).join("")}<option value="${OTHER}">Someone else…</option></select>
        <div class="pair" id="arOther" hidden>
          <label class="label">Name<input class="field" id="arName" autocomplete="off" maxlength="80"></label>
          <label class="label">Email<input class="field" id="arEmail" type="email" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
        </div>
      </section>
      <section class="step" id="arHomeStep" hidden>
        <label class="label" for="arHome">Home</label>
        <select class="field" id="arHome"><option value="">Choose a home…</option>
          ${published.length ? `<optgroup label="Published this week">${published.map(homeOpt).join("")}</optgroup>` : ""}
          ${others.length ? `<optgroup label="${published.length ? "Other homes" : "Homes"}">${others.map(homeOpt).join("")}</optgroup>` : ""}</select>
      </section>
      <section class="step" id="arDayStep" hidden>
        <p class="label">Day</p>
        <div class="ar-days" id="arDays"></div>
      </section>
      <section class="step" id="arTimeStep" hidden>
        <p class="label">Time</p>
        <p class="fine" style="margin:0">Tap the hour it starts, then a later hour to make it longer. Drag the block or its edges to change it.</p>
        <div class="timeline" id="arSlots"></div>
        <p class="fine" id="arHint" aria-live="polite"></p>
      </section>
      <section class="step" id="arSendStep" hidden>
        <label class="ar-auto"><input type="checkbox" id="arAuto" checked> Auto-Approve Showing Request</label>
        <label class="ar-auto" id="arEmailsRow"><input type="checkbox" id="arEmails" checked> Send Email Confirmations</label>
        <p class="fine" id="arAutoNote" style="margin:0"></p>
        <fieldset class="how" id="arHow" hidden><legend>How is this open house going on the MLS?</legend>
          <label class="opt"><input type="radio" name="arHow" value="manual"><span><b>Submitted manually</b><span class="fine">I've entered this open house on the MLS (NTREIS) myself.</span></span></label>
          <label class="opt"><input type="radio" name="arHow" value="agent" ${d.agentReady ? "" : "disabled"}><span><b>Schedule Open House with AI Agent</b><span class="fine">${d.agentReady
            ? `The AI agent enters it on NTREIS and reports back. It's approved once it's on the MLS.${d.mode === "dry_run" ? " Right now it runs as a <b>dry run</b>: it fills in the form but doesn't submit, so it isn't approved this way." : ""}`
            : "Not available yet: the AI agent isn't connected."}</span></span></label>
        </fieldset>
        <label class="label" for="arNotes">Notes (optional)</label>
        <textarea class="field" id="arNotes" maxlength="1000" placeholder="Anything the team should know, like a co-host"></textarea>
        <p class="ar-err" id="arErr" role="alert" hidden></p>
        <div class="ar-foot"><button class="btn" id="arSubmit" disabled>Add request</button><button class="btn ghost" id="arCancel">Cancel</button></div>
      </section>
    </div>`;

    // Who's hosting: someone from the list, or a name and email typed in.
    const agent = () => {
      const v = $("arAgent").value;
      if (v !== OTHER) return d.agents.find((a) => a.email === v) || null;
      const name = $("arName").value.trim(), email = $("arEmail").value.trim().toLowerCase();
      return name && looksLikeEmail(email) ? { name, email } : null;
    };
    const firstName = () => (agent()?.name || "the agent").split(" ")[0];
    const method = () => box.querySelector('input[name="arHow"]:checked')?.value || null;
    const onMls = () => !!home && !home.teamAdded;

    // Bring a step that just appeared into view; on a phone it's often below the fold.
    const reveal = (id) => requestAnimationFrame(() => $(id).scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" }));
    // Each step shows only once the one before it is done.
    function steps() {
      const who = !!agent();
      const was = { home: !$("arHomeStep").hidden, day: !$("arDayStep").hidden, time: !$("arTimeStep").hidden, send: !$("arSendStep").hidden };
      $("arHomeStep").hidden = !who;
      $("arDayStep").hidden = !(who && home);
      $("arTimeStep").hidden = !(who && home && day);
      $("arSendStep").hidden = !(who && home && day && sel);
      if (!was.home && who) reveal("arHomeStep");
      else if (!was.day && who && home) reveal("arDayStep");
      else if (!was.time && who && home && day) reveal("arTimeStep");
      else if (!was.send && !$("arSendStep").hidden) reveal("arSendStep");
      paintSend();
    }

    // ---- the day and its hours
    const held = () => requests.filter((r) => r.mls === home.mls && r.iso === day.iso && r.holds);
    // Open houses on the MLS that aren't one of ours: shown, but only an exact match entered by hand may share their hours.
    const onTheMls = () => home.mlsOpenHouses.filter((e) => e.iso === day.iso && !held().some((r) => r.from === e.from && r.to === e.to));
    const past = (h) => day.iso === d.today.date && h <= d.today.hour;
    const blocked = (h) => past(h) || held().some((r) => h >= r.from && h < r.to);
    const free = (a, b) => { for (let x = a; x < b; x++) if (blocked(x)) return false; return true; };

    // The days the home's seller allows, from today to the end of the week three weeks out.
    function paintDays() {
      const offered = d.days.filter((x) => home.days.includes(x.key));
      $("arDays").innerHTML = offered.length ? offered.map((x) => `<button type="button" class="ar-day" data-iso="${esc(x.iso)}" aria-pressed="${day?.iso === x.iso}">
          <b>${esc(x.label)}, ${esc(x.date)}</b><span>${x.iso === d.today.date ? "Today" : `${fmtH(FIRST)} to ${fmtH(LAST)}`}</span></button>`).join("")
        : '<p class="fine" style="margin:0">This home has no open house days set. Choose its days on Listings.</p>';
    }
    const blockAt = (r, cls, html) => `<div class="tl-b ${cls}" style="top:${(r.from - FIRST) * ROW + 2}px;height:${(r.to - r.from) * ROW - 3}px">${html}</div>`;
    function paintSlots() {
      let h = "";
      for (let x = FIRST; x < LAST; x++) h += `<button type="button" class="tl-hr" data-h="${x}" ${blocked(x) ? "disabled" : ""} aria-label="${fmtH(x)} to ${fmtH(x + 1)}${past(x) ? ", already passed" : blocked(x) ? ", booked" : ""}"></button>`;
      for (let x = FIRST; x <= LAST; x++) h += `<span class="tl-t" style="top:${(x - FIRST) * ROW}px" aria-hidden="true">${fmtH(x)}</span>`;
      h += held().map((r) => blockAt(r, "tl-held", `<b>${r.status === "approved" ? "Booked" : "Held"}</b>${esc(r.agent.name)}`)).join("");
      h += onTheMls().map((e) => blockAt(e, "tl-mls", "<b>On the MLS</b>")).join("");
      h += `<div class="tl-b tl-sel" id="arSel" tabindex="0" hidden><span id="arSelText"></span>
        <button type="button" class="tl-h" data-edge="from"></button><button type="button" class="tl-h" data-edge="to"></button></div>`;
      $("arSlots").innerHTML = h;
      $("arSlots").style.height = `${(LAST - FIRST) * ROW}px`;
      drawSel();
    }
    function drawSel() {
      const b = $("arSel"), n = sel ? sel.to - sel.from : 0;
      if (b) {
        b.hidden = !sel;
        if (sel) {
          b.style.top = `${(sel.from - FIRST) * ROW + 2}px`; b.style.height = `${n * ROW - 3}px`;
          $("arSelText").innerHTML = `<b>${fmtSpan(sel)}</b>${n > 1 ? `<span>${n} hours</span>` : ""}`;
          b.setAttribute("aria-label", `New open house, ${fmtSpan(sel)}. Use the up and down arrow keys to move it.`);
          b.querySelector('[data-edge="from"]').setAttribute("aria-label", `Start time, ${fmtH(sel.from)}. Use the up and down arrow keys to change it.`);
          b.querySelector('[data-edge="to"]').setAttribute("aria-label", `End time, ${fmtH(sel.to)}. Use the up and down arrow keys to change it.`);
        }
      }
      // Others waiting for a decision on this day don't hold their hours, but approving this one means theirs can't be.
      const waiting = requests.filter((r) => r.mls === home.mls && r.iso === day.iso && r.status === "pending" && !r.holds);
      $("arHint").innerHTML = [sel ? `${fmtSpan(sel)} (${n} hour${n === 1 ? "" : "s"})` : "",
        waiting.length ? `Also waiting for a decision: ${waiting.map((r) => `${esc(r.agent.name)}, ${esc(fmtSpan(r))}`).join("; ")}.` : ""].filter(Boolean).join("<br>");
      steps();
    }
    function setSel(next) {
      if (!next || (sel && next.from === sel.from && next.to === sel.to)) return;
      sel = next; drawSel();
    }
    // A tap on an hour picks it; right after picking one hour, a tap on a later hour stretches the request to it.
    function tapHour(h) {
      if (sel && sel.to - sel.from === 1 && h >= sel.to && free(sel.from, h + 1)) setSel({ from: sel.from, to: h + 1 });
      else setSel({ from: h, to: h + 1 });
    }
    // Where a drag lands, kept clear of booked hours: an edge stops at the first booked hour in its way; a moved
    // block goes where it's dropped if that's free, or else to the free spot nearest it on the way back.
    let drag = null;
    function dragTo(y) {
      const top = $("arSlots").getBoundingClientRect().top, line = FIRST + Math.round((y - top) / ROW);
      if (drag.kind === "from") {
        let f = sel.from;
        if (line < f) while (f > line && f > FIRST && !blocked(f - 1)) f--; else f = Math.min(line, sel.to - 1);
        return { from: f, to: sel.to };
      }
      if (drag.kind === "to") {
        let t = sel.to;
        if (line > t) while (t < line && t < LAST && !blocked(t)) t++; else t = Math.max(line, sel.from + 1);
        return { from: sel.from, to: t };
      }
      const o = drag.orig, n = o.to - o.from;
      let f = Math.min(LAST - n, Math.max(FIRST, o.from + Math.round((y - top - drag.y) / ROW)));
      while (f !== o.from && !free(f, f + n)) f += f < o.from ? 1 : -1;
      return { from: f, to: f + n };
    }
    const tl = $("arSlots");
    tl.addEventListener("pointerdown", (e) => {
      const edge = e.target.closest(".tl-h"), block = e.target.closest(".tl-sel");
      if (!sel || !(edge || block) || e.button > 0) return;
      drag = { kind: edge ? edge.dataset.edge : "move", y: e.clientY - tl.getBoundingClientRect().top, orig: { ...sel } };
      e.preventDefault(); tl.setPointerCapture(e.pointerId); $("arSel").classList.add("dragging");
    });
    tl.addEventListener("pointermove", (e) => { if (drag) setSel(dragTo(e.clientY)); });
    const endDrag = () => { drag = null; $("arSel")?.classList.remove("dragging"); };
    tl.addEventListener("pointerup", endDrag);
    tl.addEventListener("pointercancel", endDrag);
    // On iPhones a finger held still on the block would bring up the text magnifier; this keeps the touch for the drag.
    tl.addEventListener("touchstart", (e) => { if (e.target.closest(".tl-sel")) e.preventDefault(); }, { passive: false });
    tl.addEventListener("click", (e) => { const hr = e.target.closest(".tl-hr"); if (hr && !hr.disabled) tapHour(+hr.dataset.h); });
    tl.addEventListener("keydown", (e) => {
      if (!sel || (e.key !== "ArrowUp" && e.key !== "ArrowDown") || !e.target.closest(".tl-sel")) return;
      e.preventDefault();
      const s = e.key === "ArrowUp" ? -1 : 1, edge = e.target.closest(".tl-h")?.dataset.edge;
      const next = edge === "from" ? { from: sel.from + s, to: sel.to } : edge === "to" ? { from: sel.from, to: sel.to + s } : { from: sel.from + s, to: sel.to + s };
      if (next.from >= FIRST && next.to <= LAST && next.from < next.to && free(next.from, next.to)) setSel(next);
    });

    // ---- approving, and the button
    // An open house already on the MLS at those hours blocks it, unless it's exactly this one, entered by hand.
    function mlsClash() {
      if (!sel) return null;
      const byHand = $("arAuto").checked && method() === "manual";
      return onTheMls().find((e) => e.from < sel.to && sel.from < e.to && !(byHand && e.from === sel.from && e.to === sel.to)) || null;
    }
    function paintSend() {
      if ($("arSendStep").hidden) return;
      const auto = $("arAuto").checked, mail = $("arEmails").checked, how = method(), first = esc(firstName());
      $("arHow").hidden = !(auto && onMls());
      $("arEmailsRow").hidden = !auto; // only an approval sends confirmations
      $("arAutoNote").innerHTML = !auto ? `It waits under Waiting for a decision, with its hours held for ${first}. Nobody is emailed until it's approved.`
        : onMls() && how === "agent" ? `The AI agent enters it on the MLS. Once it's there, it's approved${mail ? ` and ${first} gets the confirmation email` : ", and nobody is emailed"}.`
        : onMls() && !how ? "Approved now. Choose how it goes on the MLS."
        : mail ? `Approved now. ${first} gets the confirmation email with the access details and a calendar invite, and the team gets a copy.`
        : `Approved now, and nobody is emailed: not ${first}, the team, or the team calendar. Let ${first} know yourself.`;
      const clash = mlsClash(), exact = clash && clash.from === sel.from && clash.to === sel.to;
      $("arErr").hidden = !clash;
      if (clash) $("arErr").textContent = exact ? "Those hours are already on the MLS. If that's this open house, keep Auto-Approve on and choose Submitted manually."
        : `That overlaps an open house already on the MLS (${fmtSpan(clash)}).`;
      const when = `${day.label}, ${day.date}, ${fmtSpan(sel)}`;
      $("arSubmit").textContent = !auto ? `Add request for ${when}` : onMls() && how === "agent" ? `Add and send to the AI agent: ${when}` : `Add and approve ${when}`;
      $("arSubmit").disabled = !!clash || (auto && onMls() && !how);
    }

    $("arAgent").onchange = () => { $("arOther").hidden = $("arAgent").value !== OTHER; if (!$("arOther").hidden) $("arName").focus(); steps(); };
    $("arName").oninput = $("arEmail").oninput = steps;
    $("arHome").onchange = () => { home = d.homes.find((h) => h.mls === $("arHome").value) || null; day = null; sel = null; if (home) paintDays(); steps(); };
    $("arDays").onclick = (e) => {
      const b = e.target.closest(".ar-day"); if (!b || b.disabled) return;
      day = d.days.find((x) => x.iso === b.dataset.iso); sel = null; paintDays(); paintSlots();
    };
    $("arAuto").onchange = $("arEmails").onchange = paintSend;
    box.querySelectorAll('input[name="arHow"]').forEach((i) => { i.onchange = paintSend; });
    $("arCancel").onclick = closeAddRequest;
    $("arSubmit").onclick = async () => {
      const btn = $("arSubmit"), a = agent(), auto = $("arAuto").checked, mail = !auto || $("arEmails").checked;
      btn.disabled = true; $("arErr").hidden = true;
      const r = await api("POST", "/api/team/new-request", { agent: a, mls: home.mls, iso: day.iso, from: sel.from, to: sel.to,
        notes: $("arNotes").value, autoApprove: auto, method: auto && onMls() ? method() : null, sendEmails: mail });
      if (!r.ok && r.status !== 502) { $("arErr").textContent = r.data.message || "Couldn't add the request. Try again."; $("arErr").hidden = false; btn.disabled = false; return; }
      const first = firstName();
      if (r.status === 502) toast(r.data.message || `Added, but the email to ${first} failed to send.`, true);
      else if (r.data.approving) return void (location.href = `/respond/?id=${encodeURIComponent(r.data.id)}`); // follow the AI agent there
      else toast(r.data.status !== "approved" ? `Added. It's waiting for a decision, with ${first}'s hours held.`
        : mail ? `Added and approved. ${first} was emailed the confirmation.` : "Added and approved. Nobody was emailed.");
      renderRequests();
    };
    $("arAgent").focus();
  }

  function exportCsv(list = filtered(), name = "open-house-requests") {
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Date", "Day", "Time", "Address", "City", "MLS", "Agent", "Agent email", "Phone", "Status", "Decided by", "Decided at", "Requested at", "Notes", ...FB_HEAD];
    const rows = list.map((r) => [r.iso, r.day, r.time, r.addr, r.city, r.mls, r.agent.name, r.agent.email, r.phone, STATUS[r.status] || r.status,
      r.decidedBy, r.decidedAt ? new Date(r.decidedAt).toISOString() : "", new Date(r.createdAt).toISOString(), r.notes, ...fbCsv(r.feedback)]);
    const blob = new Blob([[head, ...rows].map((row) => row.map(cell).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${name}-${todayIso()}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---- One agent's history -------------------------------------------------
  // Every open house the agent has requested, newest first, with a photo of each home. Search narrows the
  // table to an address (or MLS#), and it's split into pages like the Requests list.
  async function renderAgent(email) {
    const [ok, g] = await Promise.all([loadRequests(), api("GET", "/api/admin/agreements")]);
    if (!ok) { view.innerHTML = '<p class="empty">Could not load requests.</p>'; return; }
    const today = todayIso();
    const mine = requests.filter((r) => r.agent.email.toLowerCase() === email).sort((a, b) => b.iso.localeCompare(a.iso) || b.from - a.from);
    // Whether they've signed the Support and Referral Agreement, once it's required (the team doesn't sign it).
    const ag = g.ok && g.data.on && !g.data.exempt.includes(email) ? g.data.agreements.find((x) => x.email === email) || {} : null;
    const signed = !ag ? "" : ag.status === "signed" ? `Signed the Support and Referral Agreement ${esc(fmtSigned(ag.signedAt))} · ${signedCopy(email)}`
      : ag.status === "declined" ? "Declined the Support and Referral Agreement"
      : `Hasn't signed the Support and Referral Agreement yet${ag.status === "pending" ? " (started)" : ""}`;
    const name = (mine.find((r) => r.agent.name) || {}).agent?.name || ag?.name || email;
    const hosted = mine.filter((r) => r.status === "approved" && r.iso < today);
    const upcoming = mine.filter((r) => r.status === "approved" && r.iso >= today);
    const homes = new Set(hosted.map((r) => r.mls || r.addr));
    const phone = (mine.find((r) => r.phone) || {}).phone;
    let search = "", page = 1, per = PAGE_SIZES[0];
    view.innerHTML = `
      <p style="margin:22px 0 0"><a href="${me.admin ? "#agents" : "#requests"}">← ${me.admin ? "All agents" : "All requests"}</a></p>
      <section class="intro" style="padding-top:12px"><div><h1>${esc(name)}</h1>
        <p class="sub"><a href="mailto:${esc(email)}">${esc(email)}</a>${phone ? ` · ${esc(phone)}` : ""}</p>
        ${signed ? `<p class="sub" style="margin-top:4px">${signed}</p>` : ""}</div></section>
      <div class="stats">
        <div class="card stat"><b>${hosted.length}</b><span>Open houses hosted</span></div>
        <div class="card stat"><b>${upcoming.length}</b><span>Upcoming approved</span></div>
        <div class="card stat"><b>${homes.size}</b><span>Different homes hosted</span></div>
        <div class="card stat"><b>${mine.length}</b><span>Requests all time</span></div>
      </div>
      ${mine.length ? `<div class="toolbar">
        <input class="field" id="search" type="search" placeholder="Search address or MLS#" aria-label="Search ${esc(name)}'s open houses by address">
        <span class="spacer"></span>
        <button class="btn ghost small" id="csv">Export CSV</button>
      </div>` : ""}
      <div class="card table-wrap"><table class="stack hist"><thead><tr><th>Open house</th><th colspan="2">Home</th><th>Status</th><th>Decided</th></tr></thead><tbody id="rows"></tbody></table></div>
      ${pagerHtml("Pages of open houses", per)}`;

    const shown = () => {
      const s = search.trim().toLowerCase();
      return s ? mine.filter((r) => [r.addr, r.city, r.mls].join(" ").toLowerCase().includes(s)) : mine;
    };
    // The photo sits on a dark tile, which stays as a placeholder when a home has no photo or it fails to load.
    const thumb = (r) => `<span class="thumb">${r.img ? `<img src="${esc(photo(r.img))}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>`;
    const fill = () => {
      const list = shown();
      let first, last;
      ({ page, first, last } = paintPager(list.length, page, per));
      $("rows").innerHTML = list.slice(first, last).map((r) => `<tr>
          <td class="when" data-l="Open house"><b>${dayDate(r)}</b><div class="sub">${esc(hours(r))}</div></td>
          <td class="pic">${thumb(r)}</td>
          <td class="home" data-l="Home">${esc(place(r))}<div class="sub">${mlsNo(r)}</div></td>
          <td class="status" data-l="Status">${pill(r.status)}${fbNote(r)}</td>
          <td class="decided${r.decidedBy || r.imported ? "" : " none"}" data-l="Decided">${decided(r)}</td>
        </tr>`).join("") || `<tr><td colspan="5" class="empty">${mine.length ? "No open houses match that address." : "No open house requests yet."}</td></tr>`;
    };
    if (mine.length) {
      $("search").oninput = (e) => { search = e.target.value; page = 1; fill(); };
      $("csv").onclick = () => exportCsv(shown(), `open-houses-${email.split("@")[0]}`);
    }
    $("per").onchange = (e) => { const n = Number(e.target.value); page = resizedPage(page, per, n); per = n; fill(); };
    const turn = (n) => { page += n; fill(); $("rows").closest(".card").scrollIntoView({ block: "start" }); };
    $("prev").onclick = () => turn(-1);
    $("next").onclick = () => turn(1);
    fill();
  }

  // ---- Feedback by home ----------------------------------------------------
  // Every home that's hosted an open house, with what the agents said, kept after the home sells.
  // Links to one home look like #home/<key>, or #home/<key>/feedback for only the open houses with feedback;
  // the key is the home's street address and ZIP.
  const homeHref = (h, show = "") => `#home/${encodeURIComponent(h.key)}${show && show !== "all" ? `/${show}` : ""}`;
  const homeLink = (h, label) => `<a href="${homeHref(h)}">${esc(label)}</a>`;
  // Which of a home's open houses its page lists.
  const SHOW = { all: ["All", () => true], feedback: ["With feedback", (o) => !!o.feedback], none: ["No feedback", (o) => !o.feedback] };
  // A home's two numbers on its Listings card, on one line: open houses hosted, and how many have feedback. Each
  // opens the home's history; the second shows only the open houses with feedback (all of them while there's none).
  const homeCounts = (h) => [
    `<a href="${homeHref(h)}">${h.hosted} open house${h.hosted === 1 ? "" : "s"}</a>`,
    h.withFeedback ? `<a href="${homeHref(h, "feedback")}">${h.withFeedback} with feedback</a>` : `<a href="${homeHref(h)}">No feedback yet</a>`,
    h.flags ? `<a class="flagged" href="${homeHref(h, "feedback")}">⚠ ${h.flags} flagged</a>` : "",
  ].filter(Boolean).join('<span class="sep" aria-hidden="true">·</span>');
  // Older open houses show their year: the history goes back further than this season.
  const withYear = (o) => `${o.day}, ${o.date}${o.iso.slice(0, 4) !== todayIso().slice(0, 4) ? `, ${o.iso.slice(0, 4)}` : ""}`;
  const priceMix = (h) => Object.entries(PRICE).filter(([k]) => k !== "none" && h.price[k]).map(([k, v]) => `${v} ${h.price[k]}`).join(" · ") || "—";
  const interestMix = (h) => Object.entries(INTEREST).filter(([k]) => h.interest[k]).map(([k, v]) => `${v} ${h.interest[k]}`).join(" · ") || "—";
  let fbSearch = "";
  // Feedback tab: Active (on the market now, the Listings page's homes) by default, or Past (sold, expired or
  // withdrawn), or All. Kept while the console is open, so "All homes" on a home's page comes back to it.
  let fbStatus = "active";
  const HOME_STATUS = { active: ["Active", (h) => h.active], past: ["Past", (h) => !h.active], all: ["All", () => true] };

  async function loadHomes(withStatus = false) {
    const r = await api("GET", `/api/team/feedback${withStatus ? "?active=1" : ""}`);
    return r.ok ? (withStatus ? r.data : r.data.homes) : null;
  }

  async function renderFeedback() {
    const d = await loadHomes(true);
    if (!d) { view.innerHTML = '<p class="empty">Could not load feedback.</p>'; return; }
    const { homes, statusKnown } = d;
    view.innerHTML = `
      <section class="intro"><div><h1>Feedback by home</h1>
        <p class="sub">What agents said after hosting, collected for each home. Homes flagged for the broker are at the top. The history stays here after a home sells or is relisted.</p></div></section>
      <div class="stats" id="fbStats"></div>
      <div class="toolbar">
        ${statusKnown ? `<div class="chips" id="fbStatus" role="group" aria-label="Homes">${Object.entries(HOME_STATUS).map(([k, [label, f]]) =>
          `<button class="chip" data-status="${k}">${label} (${homes.filter(f).length})</button>`).join("")}</div>`
          : '<p class="fine" style="margin:0">Repliers couldn\'t be reached, so active and past homes can\'t be told apart right now. Showing all homes.</p>'}
        <input class="field" id="fbSearch" type="search" placeholder="Search address or city" value="${esc(fbSearch)}" aria-label="Search homes">
        <span class="spacer"></span>
        ${homes.length ? '<button class="btn ghost small" id="csv">Export CSV</button>' : ""}
      </div>
      <div class="card table-wrap"><table class="stack"><thead><tr><th>Home</th><th>Open houses</th><th>Visitors</th><th>Interest</th><th>Last hosted</th></tr></thead><tbody id="homeRows"></tbody></table></div>`;
    const status = () => (statusKnown ? fbStatus : "all");
    const matches = (h) => { const q = fbSearch.trim().toLowerCase(); return !q || [h.addr, h.city, h.zip, ...h.mls].join(" ").toLowerCase().includes(q); };
    const inStatus = () => homes.filter(HOME_STATUS[status()][1]);
    let shown = [];
    const fill = () => {
      const pool = inStatus(), sum = (k) => pool.reduce((n, h) => n + h[k], 0);
      shown = pool.filter(matches);
      $("fbStats").innerHTML = `
        <div class="card stat"><b>${pool.length}</b><span>Homes hosted</span></div>
        <div class="card stat"><b>${sum("hosted")}</b><span>Open houses hosted</span></div>
        <div class="card stat"><b>${sum("withFeedback")}</b><span>With feedback</span></div>
        <div class="card stat"><b>${sum("visitors")}</b><span>Visitors reported</span></div>`;
      view.querySelectorAll("[data-status]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.status === status())));
      // Nothing here, but the search finds homes under another filter: offer those.
      const elsewhere = !shown.length && fbSearch.trim() && status() !== "all" && homes.some(matches);
      const empty = !homes.length ? "No open houses hosted yet. Homes show up here once an approved open house has ended."
        : elsewhere ? `No ${HOME_STATUS[status()][0].toLowerCase()} homes match. <button class="link" data-status="all">Search all homes</button>`
        : fbSearch.trim() ? "No homes match."
        : status() === "active" ? "No homes on the market now have hosted an open house." : "No past homes yet.";
      $("homeRows").innerHTML = shown.length ? shown.map((h) => `<tr>
          <td data-l="Home"><div class="homecell">${h.img ? `<img class="thumb" src="${esc(photo(h.img))}" alt="" loading="lazy">` : '<div class="thumb"></div>'}
            <div><b>${homeLink(h, h.addr)}</b><div class="sub">${esc(h.city)}${status() === "all" && statusKnown ? ` · ${h.active ? "Active" : "Past"}` : ""}${h.flags ? ` · <b class="flagged">⚠ ${h.flags} flagged for broker</b>` : ""}</div></div></div></td>
          <td data-l="Open houses">${h.hosted}<div class="sub">${h.withFeedback ? `<a href="${homeHref(h, "feedback")}">${h.withFeedback} with feedback</a>` : "No feedback yet"}</div></td>
          <td data-l="Visitors">${h.withFeedback ? h.visitors : '<span class="sub">—</span>'}</td>
          <td data-l="Interest">${esc(interestMix(h))}</td>
          <td data-l="Last hosted">${esc(withYear(h.openHouses[0]))}</td>
        </tr>`).join("") : `<tr><td colspan="5" class="empty">${empty}</td></tr>`;
    };
    $("fbSearch").oninput = (e) => { fbSearch = e.target.value; fill(); };
    const pick = (e) => { const b = e.target.closest("[data-status]"); if (b && statusKnown) { fbStatus = b.dataset.status; fill(); } };
    if (statusKnown) $("fbStatus").onclick = pick;
    $("homeRows").onclick = pick; // "Search all homes" when the search finds nothing under this filter
    if (homes.length) $("csv").onclick = () => exportFeedbackCsv(shown, `open-house-feedback${status() === "all" ? "" : `-${status()}`}`);
    fill();
  }

  async function renderHome(key, sub) {
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
      <div class="chips ohshow" role="group" aria-label="Show">${Object.entries(SHOW).map(([k, [label, f]]) =>
        `<button class="chip" data-show="${k}">${label} (${h.openHouses.filter(f).length})</button>`).join("")}</div>
      <div class="fbq" id="ohList"></div>`;
    const card = (o) => `<article class="card fbcard${o.feedback?.brokerFlag ? " flag" : ""}" data-oh="${esc(o.id)}">
        <div>
          <h3>${esc(withYear(o))} · ${esc(o.time)} ${o.feedback?.brokerFlag ? '<span class="pill declined">⚠ Flagged for broker</span>' : ""}</h3>
          <div class="meta">Hosted by ${agentLink(o.agent.email, o.agent.name)}${o.feedback ? ` · ${o.feedback.enteredBy ? `feedback entered by ${esc(o.feedback.enteredBy.name || "the team")}` : "feedback sent"} ${esc(fmtDate(o.feedback.at))}` : ""}</div>
          ${o.feedback ? fbText(o.feedback) : waiting(o)}
        </div></article>`;
    // No feedback: who was emailed about it, and a button to email the agent a reminder with the feedback link.
    const waiting = (o) => {
      const first = esc(o.agent.name.split(" ")[0]);
      const said = o.reminded ? `No feedback yet. ${esc(o.reminded.byName || "The team")} emailed ${first} a reminder ${esc(fmtDate(o.reminded.at))}${o.reminders > 1 ? ` (${o.reminders} reminders so far)` : ""}.`
        : o.emailed ? "No feedback yet. The agent was emailed a link after the open house." : "No feedback for this open house.";
      return `<div class="notes fbwait"><span>${said}</span><span class="fbacts">
        <button class="btn ghost small" data-enter="${esc(o.id)}">Leave Feedback</button>
        <button class="btn ghost small" data-remind="${esc(o.id)}">${o.reminded ? "Send another reminder" : `Email ${first} a reminder`}</button></span></div>`;
    };
    // The team enters the feedback themselves (what the agent told them): the agent's questions, saved as their
    // feedback with nobody emailed (POST /api/team/feedback, action "feedback").
    const enterForm = (o) => {
      const id = esc(o.id), first = esc(o.agent.name.split(" ")[0]);
      const seg = (name, opts) => `<div class="seg" role="radiogroup" aria-labelledby="${name}L-${id}">${Object.entries(opts).map(([k, v]) =>
        `<label><input type="radio" name="${name}-${id}" value="${k}"><span>${esc(v)}</span></label>`).join("")}</div>`;
      return `<form class="fbenter" data-id="${id}" novalidate>
        <p class="fine">Enter what ${first} told you about this open house. It's saved as their feedback, and nobody is emailed.</p>
        <div class="fbrow">
          <div><label class="label" for="fv-${id}">Guests</label><input class="field" id="fv-${id}" data-k="visitors" type="number" inputmode="numeric" min="0" max="999"></div>
          <div><span class="label" id="interestL-${id}">Interest</span>${seg("interest", INTEREST)}</div>
          <div><span class="label" id="priceL-${id}">Price</span>${seg("price", PRICE)}</div>
        </div>
        <div class="two">
          <div><label class="label" for="fl-${id}">What guests liked</label><textarea class="field" id="fl-${id}" data-k="liked" maxlength="5000"></textarea></div>
          <div><label class="label" for="fd-${id}">What guests didn't like</label><textarea class="field" id="fd-${id}" data-k="disliked" maxlength="5000"></textarea></div>
        </div>
        <label class="label" for="fs-${id}">Additional feedback <span class="opt">(optional)</span></label>
        <textarea class="field" id="fs-${id}" data-k="forSeller" maxlength="5000" rows="2"></textarea>
        <label class="label" for="ft-${id}">Notes for the team <span class="opt">(optional)</span></label>
        <textarea class="field" id="ft-${id}" data-k="teamNotes" maxlength="5000" rows="2"></textarea>
        <label class="fbflag"><input type="checkbox" data-k="brokerFlag"> Flag for the broker <span class="opt">(describe it in the notes for the team)</span></label>
        <div class="fbph"><label class="btn ghost small">Add photos<input type="file" accept="image/*" multiple data-ph></label><span class="fine" data-phmsg role="status"></span></div>
        <div class="fbpend" data-phgrid></div>
        <p class="ar-err" role="alert" hidden></p>
        <div class="ar-foot"><button class="btn" type="submit">Save feedback</button><button class="btn ghost" type="button" data-cancel>Cancel</button></div>
      </form>`;
    };
    const formFor = (el) => el.closest("form.fbenter");
    const ohOf = (form) => h.openHouses.find((x) => x.id === form.dataset.id);
    const paintPending = (form, photos) => {
      form.photos = photos;
      form.querySelector("[data-phgrid]").innerHTML = photos.map((p) => `<span class="fbp"><img src="${esc(p.url)}" alt="Photo added to this feedback">
        <button type="button" data-unph="${esc(p.id)}" aria-label="Remove photo">×</button></span>`).join("");
    };
    let show = SHOW[sub] ? sub : "all";
    const paint = () => {
      const list = h.openHouses.filter(SHOW[show][1]);
      $("ohList").innerHTML = list.length ? list.map(card).join("")
        : `<p class="empty">${show === "feedback" ? "No feedback for this home yet." : "Every open house here has feedback."}</p>`;
      view.querySelectorAll("[data-show]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.show === show)));
    };
    $("ohList").onclick = async (e) => {
      // Leave Feedback: the form opens in the open house's card, in place of the buttons.
      const enter = e.target.closest("[data-enter]");
      if (enter) {
        const wait = enter.closest(".fbwait"), o = h.openHouses.find((x) => x.id === enter.dataset.enter);
        wait.hidden = true; wait.insertAdjacentHTML("afterend", enterForm(o));
        wait.nextElementSibling.querySelector("input").focus();
        return;
      }
      const cancel = e.target.closest("[data-cancel]");
      if (cancel) {
        const form = formFor(cancel), mine = form.added || [];
        form.previousElementSibling.hidden = false; form.remove();
        for (const p of mine) api("POST", "/api/team/feedback", { id: form.dataset.id, action: "unphoto", photo: p }); // photos added here, then cancelled
        return;
      }
      const unph = e.target.closest("[data-unph]");
      if (unph) {
        const form = formFor(unph); unph.disabled = true;
        const r = await api("POST", "/api/team/feedback", { id: form.dataset.id, action: "unphoto", photo: unph.dataset.unph });
        if (r.ok) paintPending(form, r.data.photos); else { unph.disabled = false; toast(r.data.message || "Couldn't remove that photo. Try again.", true); }
        return;
      }
      const btn = e.target.closest("[data-remind]"); if (!btn) return;
      const o = h.openHouses.find((x) => x.id === btn.dataset.remind); if (!o) return;
      if (!(await OHDialog.confirm({ title: `Email ${o.agent.name} a reminder?`, ok: "Send reminder",
        body: `${o.agent.name.split(" ")[0]} gets an email asking how the ${withYear(o)} open house at ${h.addr} went, with a link to leave feedback.` }))) return;
      btn.disabled = true; btn.textContent = "Sending…";
      const r = await api("POST", "/api/team/feedback", { id: o.id, action: "remind" });
      if (!r.ok) { toast(r.data.message || "The reminder didn't send. Try again.", true); paint(); return; }
      Object.assign(o, { reminded: r.data.reminded, reminders: r.data.reminders });
      toast(`Reminder sent to ${o.agent.name}.`);
      paint();
    };
    // Photos for the feedback: shrunk, then uploaded one at a time.
    $("ohList").onchange = async (e) => {
      const input = e.target.closest("[data-ph]"); if (!input) return;
      const form = formFor(input), files = [...input.files], msg = form.querySelector("[data-phmsg]"), save = form.querySelector('[type="submit"]');
      input.value = ""; if (!files.length || form.uploading) return;
      form.uploading = true; save.disabled = true; form.added = form.added || [];
      for (const [i, f] of files.entries()) {
        msg.textContent = `Uploading photo ${i + 1} of ${files.length}…`;
        const data = await shrink(f).catch(() => null);
        const r = data ? await api("POST", "/api/team/feedback", { id: form.dataset.id, action: "photo", data }) : { ok: false, data: { message: `Couldn't read ${f.name}. Use a JPEG or PNG.` } };
        if (!r.ok) { msg.textContent = r.data.message || "A photo didn't upload. Try again."; if (r.data.error === "too_many_photos") break; continue; }
        const before = new Set((form.photos || []).map((p) => p.id));
        form.added.push(...r.data.photos.filter((p) => !before.has(p.id)).map((p) => p.id));
        paintPending(form, r.data.photos); msg.textContent = "";
      }
      form.uploading = false; save.disabled = false;
    };
    $("ohList").onsubmit = async (e) => {
      const form = e.target.closest("form.fbenter"); if (!form) return;
      e.preventDefault();
      const o = ohOf(form), val = (k) => form.querySelector(`[data-k="${k}"]`).value, pick = (n) => form.querySelector(`input[name="${n}-${o.id}"]:checked`)?.value || "";
      const err = form.querySelector(".ar-err"), save = form.querySelector('[type="submit"]');
      const r = await (save.disabled = true, err.hidden = true, api("POST", "/api/team/feedback", { id: o.id, action: "feedback",
        visitors: val("visitors") === "" ? "" : Number(val("visitors")), interest: pick("interest"), price: pick("price"), liked: val("liked"),
        disliked: val("disliked"), forSeller: val("forSeller"), teamNotes: val("teamNotes"), brokerFlag: form.querySelector('[data-k="brokerFlag"]').checked }));
      if (!r.ok) { err.textContent = r.data.message || "Couldn't save the feedback. Try again."; err.hidden = false; save.disabled = false; return; }
      toast(`Saved ${o.agent.name}'s feedback.`);
      // Show the home again with its new totals, the saved feedback in view.
      const next = show === "none" ? "all" : show;
      history.replaceState(null, "", homeHref(h, next));
      await renderHome(h.key, next);
      view.querySelector(`[data-oh="${o.id}"]`)?.scrollIntoView({ block: "center" });
    };
    view.querySelector(".ohshow").onclick = (e) => {
      const b = e.target.closest("[data-show]"); if (!b) return;
      show = b.dataset.show; history.replaceState(null, "", homeHref(h, show)); paint();
    };
    paint();
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
    const head = ["Address", "City", "ZIP", "MLS", "Date", "Day", "Time", "Agent", "Agent email", ...FB_HEAD];
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
    ["price", "List price ($)", 'type="number" min="0" step="1"'], ["bd", "Bedrooms", 'type="number" min="0" step="0.1" inputmode="decimal"'],
    ["ba", "Bathrooms", 'type="number" min="0" step="0.1" inputmode="decimal"'], ["sf", "Square feet", 'type="number" min="0" step="1"'],
  ];
  const BATHS_TIP = '<p class="fine">Bathrooms are full.half, as on the MLS: 4 full and 1 half bath is 4.1.</p>';
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

  // fresh: ask Repliers again now (the Refresh button). Returns what was shown, or nothing if it couldn't load.
  async function renderListings(scrollTo, fresh) {
    const [r, homes] = await Promise.all([api("GET", `/api/inventory/listings${fresh ? "?fresh=1" : ""}`), loadHomes()]);
    // Each listing links to its home's feedback, matched by MLS number (or team-added home id).
    const fbFor = (mls) => (homes || []).find((h) => h.mls.includes(mls));
    if (!r.ok) { view.innerHTML = `<div class="card banner err">${esc(r.data.message || "Could not load listings from Repliers.")}</div>`; return; }
    const d = r.data;
    savers.clear();
    const stale = d.feedUpdatedOn && Math.floor((Date.now() - new Date(d.feedUpdatedOn + "T12:00:00Z")) / 86400000);
    // When Repliers last changed any listing, in Central time: "Oct 23, 2026 at 5:22 PM" (just the date if the time is missing).
    const updated = d.feedUpdatedAt?.length > 10 && !Number.isNaN(Date.parse(d.feedUpdatedAt))
      ? new Date(d.feedUpdatedAt).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).replace(/, (\d+:)/, " at $1")
      : d.feedUpdatedOn ? fmtIso(d.feedUpdatedOn) : "";
    view.innerHTML = `
      <section class="intro"><div><h1>Publish this week's homes</h1>
        <p class="sub">Week of ${esc(d.week.label)}. Requests close ${esc(d.closesLabel)}. Publish the homes agents can request; changes save as you make them. Publishing and Priority reset each week; days, Vacant, instructions and access details stay with the home.</p></div>
        ${me.admin ? '<div class="intro-actions"><button class="btn small" id="addHomeBtn">Add a home</button></div>' : ""}</section>
      ${me.admin ? `<div class="card panel" id="addHome" hidden>
        <h3>Add a home that isn't on the MLS yet</h3>
        <p class="fine">It works like any listing here: publish it, set Priority, instructions and access details, and add photos. Once it's on the MLS, link it to its MLS listing on its card and everything moves over.</p>
        <form id="addHomeForm"><div class="homegrid">${homeFields()}</div>${BATHS_TIP}
          <div class="actions"><button class="btn">Add home</button><button type="button" class="btn ghost" id="addHomeCancel">Cancel</button></div></form></div>` : ""}
      ${d.warning ? `<div class="card banner err"><b>Repliers problem:</b> ${esc(d.warning)}</div>` : ""}
      ${stale >= 3 ? `<div class="card banner"><b>Repliers data looks out of date.</b> Last updated ${esc(updated)} (${stale} days ago).</div>` : ""}
      <div class="toolbar">
        <div class="chips" id="lchips">${Object.entries(FILTERS).map(([f, [label]]) =>
          `<button class="chip" data-f="${f}" aria-pressed="${listFilter === f}">${label} (<span data-n="${f}">0</span>)</button>`).join("")}</div>
        <span class="spacer"></span>
        <span class="feed"><span class="fine">${updated ? `Repliers data updated ${esc(updated)}` : ""}</span>
          <button class="btn small refresh" id="refresh"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 3.5v5h-5"/></svg><span>Refresh</span></button></span>
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
      if (!shown.length) list.innerHTML = `<div class="card empty">${{ all: "No active listings found in Repliers.", published: "No homes published yet this week.", unpublished: "Every home is published this week." }[listFilter]}</div>`;
      shown.forEach((l) => list.append(listingCard(l, d, counts, fbFor(l.mls))));
    };
    $("lchips").onclick = (e) => { const b = e.target.closest(".chip"); if (!b) return; flushSaves(); listFilter = b.dataset.f; $("lchips").querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", c === b)); paint(); };
    $("raw").onclick = async () => { const j = await api("GET", "/api/inventory/listings?raw=1"); const o = $("rawOut"); o.hidden = false; o.textContent = JSON.stringify(j.data, null, 2); };
    // Refresh: edits still waiting to save go first, then Repliers is asked again and any new homes are named.
    $("refresh").onclick = async () => {
      const btn = $("refresh");
      btn.disabled = true; btn.classList.add("busy"); btn.querySelector("span").textContent = "Checking…";
      await Promise.all([...savers].map((s) => s.flush()));
      const seen = new Set(d.listings.map((l) => l.mls));
      const next = await renderListings(null, true);
      if (!next) return;
      const added = next.listings.filter((l) => !seen.has(l.mls));
      toast(added.length ? `New from the MLS: ${added.map(place).join("; ")}.` : "No new homes from the MLS yet.");
      if (added.length) $("list").querySelector(`[data-mls="${added[0].mls}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    if (me.admin) {
      $("addHomeBtn").onclick = () => { $("addHome").hidden = !$("addHome").hidden; if (!$("addHome").hidden) $("addHome").querySelector("input").focus(); };
      $("addHomeCancel").onclick = () => { $("addHome").hidden = true; };
      $("addHomeForm").onsubmit = async (e) => {
        e.preventDefault();
        const body = { action: "create" };
        $("addHomeForm").querySelectorAll("[data-h]").forEach((i) => { body[i.dataset.h] = i.value; });
        const res = await api("POST", "/api/admin/homes", body);
        if (!res.ok) return toast(res.data.message || "Couldn't add the home.", true);
        toast(`Added ${place(res.data.home)}. Add photos and publish it on its card.`);
        listFilter = "all";
        renderListings(res.data.home.id);
      };
    }
    counts();
    paint();
    if (scrollTo) list.querySelector(`[data-mls="${scrollTo}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    return d;
  }

  // A field's label with an "i" that shows a note about it: on hover, on keyboard focus, or tapped on a phone.
  const fieldLabel = (id, text, note) => `<div class="lab"><label class="label" for="${esc(id)}">${esc(text)}</label>${note ? `<span class="tip">
      <button type="button" class="tip-i" aria-label="About ${esc(text.replace(/ \(.*\)$/, "").toLowerCase())}" aria-describedby="${esc(id)}-tip">i</button>
      <span class="tip-text" role="tooltip" id="${esc(id)}-tip">${esc(note)}</span></span>` : ""}</div>`;

  function listingCard(l, d, onSaved, fb) {
    const c = document.createElement("article"); c.className = "card lcard" + (l.priority ? " pri" : ""); c.dataset.mls = l.mls;
    const oh = l.openHouses.length ? `<div class="mls-oh">Already on the MLS: ${l.openHouses.map((o) => `${SHORT_DAY[o.day] || ""} ${o.from}:00–${o.to}:00`).join(", ")}</div>` : "";
    const badges = () => `${l.offered ? '<span class="pill approved">Published</span>' : '<span class="pill">Unpublished</span>'}${l.priority ? '<span class="pill priority">★ Priority</span>' : ""}${l.teamAdded ? '<span class="pill pending">Not on the MLS yet</span>' : ""}`;
    const facts = () => `${l.teamAdded ? "Added by the team" : `MLS# ${esc(l.mls)}`} · ${money(l.price)}${l.bd ? ` · ${esc(l.bd)} bd / ${esc(l.ba)} ba` : ""}${l.sf ? ` · ${Number(l.sf).toLocaleString()} sq ft` : ""}`;
    const cover = () => (l.img ? `<img src="${esc(photo(l.img, "medium"))}" alt="" loading="lazy">` : "");
    const editable = l.teamAdded && me.admin;
    c.innerHTML = `
      <div class="photo">${cover()}</div>
      <div class="body">
        <h3><span class="addr">${esc(place(l))}</span><span class="badges">${badges()}</span></h3>
        <div class="fine facts">${facts()}</div>
        ${fb ? `<div class="lfb">${homeCounts(fb)}</div>` : ""}
        ${oh}
        <div class="toggles">
          <label class="check"><input type="checkbox" data-f="offered" ${l.offered ? "checked" : ""}> Publish this week</label>
          <label class="check"><input type="checkbox" data-f="priority" ${l.priority ? "checked" : ""}> Priority</label>
          <label class="check tip"><input type="checkbox" data-f="vacant" ${l.vacant ? "checked" : ""} aria-describedby="vacTip-${esc(l.mls)}"> Vacant <span class="tip-i" aria-hidden="true">i</span>
            <span class="tip-text" role="tooltip" id="vacTip-${esc(l.mls)}">${esc(VACANT_TIP)} Agents see a Vacant tag on this listing.</span></label>
        </div>
        <div class="daypick">
          <span class="dp-label" id="dpl-${esc(l.mls)}">Open house days</span>
          <div class="dp-days" role="group" aria-labelledby="dpl-${esc(l.mls)}">${WEEKDAYS.map(([k, s, full]) =>
            `<button type="button" class="dp-day" data-day="${k}" aria-pressed="${l.days.includes(k)}" aria-label="${full}">${s}</button>`).join("")}</div>
        </div>
        <div class="two">
          <div>${fieldLabel(`instr-${l.mls}`, "Instructions for agents (one per line)", d.standardInstr?.length ? `Every home also tells agents: ${d.standardInstr.join(" ")}` : "")}
            <textarea class="field" id="instr-${esc(l.mls)}" data-f="instr">${esc(l.instr.join("\n"))}</textarea></div>
          <div>${fieldLabel(`access-${l.mls}`, "Access details (private)", "Only sent in the Confirmed and Reminder emails. Never shown to agents on the site.")}
            <textarea class="field" id="access-${esc(l.mls)}" data-f="access" placeholder="Gate, lockbox, alarm codes">${esc(l.access)}</textarea></div>
        </div>
        ${editable ? homeEditor(l, d) : ""}
      </div>`;

    // Publishing, days, Priority, Vacant, instructions and access details save as they change.
    const q = (f) => c.querySelector(`[data-f="${f}"]`);
    const dayBtns = [...c.querySelectorAll(".dp-day")];
    const showDays = (days) => dayBtns.forEach((b) => b.setAttribute("aria-pressed", String(days.includes(b.dataset.day))));
    const settings = autosave(async () => {
      const days = dayBtns.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.day), instr = q("instr").value.split("\n"), access = q("access").value;
      const res = await api("PUT", "/api/inventory/listings", { mls: l.mls, offered: q("offered").checked, priority: q("priority").checked, vacant: q("vacant").checked, days, instr, access });
      if (!res.ok) {
        // Put the switches back to what's saved; typed text stays so nothing is lost.
        q("offered").checked = l.offered; q("priority").checked = l.priority; q("vacant").checked = l.vacant; showDays(l.days);
        return toast(res.data.message || "Couldn't save. Your change was not applied.", true);
      }
      Object.assign(l, { offered: q("offered").checked, priority: q("priority").checked, vacant: q("vacant").checked, days, instr: instr.map((s) => s.trim()).filter(Boolean), access });
      c.classList.toggle("pri", l.priority);
      c.querySelector(".badges").innerHTML = badges();
      toast(`Saved ${place(l)}.`);
      onSaved();
    });
    c.querySelectorAll(".toggles input").forEach((i) => { i.onchange = settings.now; });
    dayBtns.forEach((b) => { b.onclick = () => { b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); settings.now(); }; });
    ["instr", "access"].forEach((f) => { q(f).oninput = settings.soon; q(f).onblur = settings.flush; });
    if (editable) wireHomeEditor(c, l, d, { settings, badges, facts, cover });
    return c;
  }

  // Team-added homes (admins only): the home's details, its photos, linking it to its MLS listing, removing it.
  function homeEditor(l, d) {
    const suggested = (l.suggestions || []).map((m) => d.mlsChoices.find((x) => x.mls === m)).filter(Boolean);
    return `<div class="home-edit">
      <h4>Home details</h4>
      <div class="homegrid">${homeFields(l)}</div>${BATHS_TIP}
      <h4>Photos</h4>
      <div class="photos" data-photos></div>
      <div class="foot"><label class="btn ghost small">Add photos<input type="file" accept="image/*" multiple hidden data-upload></label>
        <span class="fine">The first photo is the cover. Large photos are resized before upload.</span></div>
      <h4>Link to its MLS listing</h4>
      ${suggested.length ? suggested.map((s) => `<div class="suggest"><span>Found on the MLS: <b>${esc(place(s))}</b> · MLS# ${esc(s.mls)}</span><button class="btn small" data-link="${esc(s.mls)}">Link</button></div>`).join("")
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
      c.querySelector(".addr").textContent = place(l); c.querySelector(".facts").innerHTML = facts();
      toast(`Saved ${place(l)}.`);
    });
    c.querySelectorAll("[data-h]").forEach((i) => { i.oninput = details.soon; i.onblur = details.flush; });

    const paintPhotos = () => {
      const box = c.querySelector("[data-photos]");
      box.innerHTML = l.photos.length ? l.photos.map((p, i) => `<figure><img src="${esc(p.url)}" alt="">
          <figcaption>${i === 0 ? "<b>Cover</b>" : `<button class="link" data-cover="${esc(p.id)}">Make cover</button>`} · <button class="link" data-unphoto="${esc(p.id)}">Remove</button></figcaption></figure>`).join("")
        : '<p class="fine">No photos yet.</p>';
      c.querySelector(".photo").innerHTML = cover();
      box.querySelectorAll("[data-cover]").forEach((b) => { b.onclick = () => photoAction("cover", b.dataset.cover, "Cover photo set."); });
      box.querySelectorAll("[data-unphoto]").forEach((b) => {
        b.onclick = async () => (await OHDialog.confirm({ title: "Remove this photo?", body: `It's deleted from ${place(l)}.`, ok: "Remove photo", cancel: "Keep it", danger: true }))
          && photoAction("unphoto", b.dataset.unphoto, "Photo removed.");
      });
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
      if (!(await OHDialog.confirm({ title: `Link to MLS# ${m.mls}?`, ok: "Link",
        body: `${place(l)} will be linked to ${place(l) === place(m) ? "its MLS listing" : `the MLS listing at ${place(m)}`}. Its settings, instructions, access details and open house requests move to the MLS listing, and this card is replaced by the MLS listing.` }))) return;
      await Promise.all([settings.flush(), details.flush()]); // the latest edits go over too
      const res = await api("POST", "/api/admin/homes", { action: "link", id: l.mls, mls });
      if (!res.ok) return toast(res.data.message || "Couldn't link the home.", true);
      toast(`Linked to MLS# ${mls}.${res.data.moved ? ` ${res.data.moved} request${res.data.moved === 1 ? "" : "s"} moved over.` : ""}`);
      if (res.data.enterByHand?.length) await OHDialog.alert({ title: "Enter these on the MLS by hand", ok: "Done",
        body: `MLS automation is off, so enter these approved open houses on the MLS for ${place(m)}:\n\n${res.data.enterByHand.join("\n")}` });
      renderListings(mls);
    };
    c.querySelectorAll("[data-link]").forEach((b) => { b.onclick = () => link(b.dataset.link); });
    c.querySelector("[data-linkpick]").onclick = () => link(c.querySelector("[data-pick]").value);

    c.querySelector("[data-remove]").onclick = async () => {
      if (!(await OHDialog.confirm({ title: "Remove this home?", ok: "Remove home", cancel: "Keep it", danger: true,
        body: `${place(l)} comes off the portal and its photos are deleted. This can't be undone.` }))) return;
      const res = await api("POST", "/api/admin/homes", { action: "remove", id: l.mls });
      if (!res.ok) return toast(res.data.message || "Couldn't remove the home.", true);
      toast(`Removed ${place(l)}.`);
      renderListings();
    };
  }

  // ---- Agents --------------------------------------------------------------
  async function renderAgents() {
    const [a, g] = await Promise.all([api("GET", "/api/admin/access"), api("GET", "/api/admin/agreements"), loadRequests()]);
    if (!a.ok) { view.innerHTML = '<p class="empty">Only administrators can manage agents.</p>'; return; }
    let access = a.data;
    const ag = g.ok && g.data.on ? g.data : null; // the Agreement column shows once the agreement is required

    const draw = () => {
      const domainOf = (e) => e.slice(e.lastIndexOf("@") + 1);
      const allowedDomains = [...new Set([...access.domains, ...access.env.domains])];
      const roster = new Map();
      const add = (email, name) => { const k = email.toLowerCase(); if (!roster.has(k)) roster.set(k, { email: k, name: name || "", requests: 0, approved: 0, last: 0 }); const p = roster.get(k); if (name && !p.name) p.name = name; return p; };
      access.emails.forEach((e) => add(e)); access.env.emails.forEach((e) => add(e));
      access.admins.forEach((e) => add(e)); (access.team || []).forEach((e) => add(e));
      requests.forEach((r) => { const p = add(r.agent.email, r.agent.name); p.requests++; if (r.status === "approved") p.approved++; p.last = Math.max(p.last, r.createdAt); });
      ag?.agreements.forEach((x) => add(x.email, x.name)); // signed in and signed, but hasn't requested yet

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
          <p class="sub">Who can sign in to the Open House Portal. Removing someone ends their access right away.${ag ? " Agents sign the Support and Referral Agreement the first time they sign in; the team doesn't." : ""}</p></div></section>
        <div class="card panel">
          <h3>Add an agent</h3>
          <p class="fine">For agents who sign in with an address outside an allowed domain, like a personal Gmail.</p>
          <form class="addrow" id="addEmail"><input class="field" id="newEmail" type="email" placeholder="agent@example.com" autocomplete="off" aria-label="Agent email"><button class="btn">Add agent</button></form>
        </div>
        <div class="card table-wrap"><table class="stack"><thead><tr><th>Person</th><th>Access</th>${ag ? "<th>Agreement</th>" : ""}<th>Requests</th><th>Approved</th><th>Last request</th><th></th></tr></thead>
          <tbody>${people.map((p) => `<tr>
            <td data-l="Person">${p.name ? `${agentLink(p.email, p.name)}<div class="sub">${esc(p.email)}</div>` : agentLink(p.email)}</td>
            <td data-l="Access">${how(p)}</td>
            ${ag ? `<td data-l="Agreement">${agreementCell(ag, p.email)}</td>` : ""}
            <td data-l="Requests">${p.requests}</td>
            <td data-l="Approved">${p.approved}</td>
            <td data-l="Last request">${p.last ? esc(fmtDate(p.last)) : '<span class="sub">—</span>'}</td>
            <td data-l="">${access.emails.includes(p.email) ? `<button class="link" data-rm="${esc(p.email)}">Remove</button>` : ""}</td>
          </tr>`).join("") || `<tr><td colspan="${ag ? 7 : 6}" class="empty">No one yet.</td></tr>`}</tbody></table></div>
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
      view.querySelectorAll("[data-rm]").forEach((b) => b.onclick = async () =>
        (await OHDialog.confirm({ title: `Remove ${b.dataset.rm}?`, body: "They lose access right away.", ok: "Remove", danger: true }))
        && save({ emails: access.emails.filter((x) => x !== b.dataset.rm), domains: access.domains }, `Removed ${b.dataset.rm}.`));
      view.querySelectorAll("[data-rmd]").forEach((b) => b.onclick = async () =>
        (await OHDialog.confirm({ title: `Remove @${b.dataset.rmd}?`, body: "Everyone at that domain who isn't listed loses access right away.", ok: "Remove domain", danger: true }))
        && save({ emails: access.emails, domains: access.domains.filter((x) => x !== b.dataset.rmd) }, `Removed @${b.dataset.rmd}.`));
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
      </div>
      <section class="card panel emails" aria-labelledby="emailsTitle">
        <h3 id="emailsTitle">Emails</h3>
        <p class="fine" id="emailsAbout">Every email the Open House platform sends.</p>
        <div id="emailList"><p class="fine">Loading…</p></div>
      </section>`;
    renderEmails();
    let last = r.data, seq = 0;
    const show = (d) => {
      last = d;
      $("cOn").checked = d.cutoff.enabled; $("cMore").hidden = !d.cutoff.enabled;
      $("cDay").value = String(d.cutoff.day); $("cTime").value = d.cutoff.time;
      $("cState").textContent = d.cutoff.enabled ? "Requests stop at the day and time you choose." : "Off. Requests stay open until Sunday evening.";
      $("cSum").innerHTML = `Requests for the week of <b>${esc(d.week)}</b> close <b>${esc(d.closesLabel)}</b>.`;
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

  // ---- Settings > Emails: every email the platform sends, previewed with a sample open house --------------
  // Each opens to its recipients, subject, attachments and the email itself, drawn in a frame that runs no scripts.
  // Links in a preview don't open: they'd point at a sample request that doesn't exist.
  async function renderEmails() {
    const r = await api("GET", "/api/admin/emails");
    if (!$("emailList")) return; // left Settings meanwhile
    if (!r.ok) { $("emailList").innerHTML = '<p class="fine">Couldn\'t load the email previews. Reload to try again.</p>'; return; }
    const { emails, team, calendar, home } = r.data;
    $("emailsAbout").innerHTML = `Every email the Open House platform sends, shown for a sample open house at ${esc(home)} with a made-up agent. Nothing is sent from here.
      "The team" is ${team.map((t) => `<b>${esc(t)}</b>`).join(", ")}; "the team calendar" is ${esc(calendar)}.`;
    const groups = [...new Set(emails.map((e) => e.group))];
    $("emailList").innerHTML = groups.map((g) => `<h4 class="eg">${esc(g)}</h4>${emails.filter((e) => e.group === g).map((e) => `
      <details class="email" data-key="${esc(e.key)}">
        <summary><span><span class="en">${esc(e.name)}</span><span class="ew">To ${esc(e.to.charAt(0).toLowerCase() + e.to.slice(1))}. ${esc(e.when)}</span></span><span class="ev" aria-hidden="true"></span></summary>
        <dl class="emeta"><dt>To</dt><dd>${esc(e.to)}</dd><dt>Subject</dt><dd>${esc(e.subject)}</dd>
          ${e.attachments.length ? `<dt>Attached</dt><dd>${e.attachments.map((a) => (a.endsWith(".ics") ? `Calendar file (${esc(a)})` : esc(a))).join(", ")}</dd>` : ""}</dl>
        <iframe class="eprev" sandbox="allow-same-origin" title="Preview of the ${esc(e.name)} email"></iframe>
      </details>`).join("")}`).join("");
    const byKey = Object.fromEntries(emails.map((e) => [e.key, e]));
    $("emailList").querySelectorAll("details.email").forEach((d) => d.addEventListener("toggle", () => {
      const f = d.querySelector("iframe");
      if (!d.open || f.srcdoc) return;
      const html = byKey[d.dataset.key].html, keep = '<base target="_blank"><style>a{pointer-events:none;cursor:default}</style>';
      f.srcdoc = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + keep)
        : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${keep}</head><body style="margin:16px">${html}</body></html>`;
      // Fit the frame to the email, and again as its photo loads. An email wider than the frame (on a phone) is
      // scaled down to fit, as a phone's mail app would show it.
      f.onload = () => {
        const doc = f.contentDocument; if (!doc) return;
        const root = doc.documentElement, scale = Math.min(1, f.clientWidth / root.scrollWidth);
        if (scale < 1) root.style.zoom = String(scale);
        const fit = () => { f.style.height = `${Math.max(120, Math.ceil(root.scrollHeight))}px`; };
        fit();
        doc.querySelectorAll("img").forEach((img) => { if (!img.complete) img.addEventListener("load", fit); });
      };
    }));
  }

  start();
})();
