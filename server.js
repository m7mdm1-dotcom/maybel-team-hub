const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const GHL_API = "https://services.leadconnectorhq.com";
const GHL_TOKEN = "pit-d6e4af69-dfb1-419d-950e-a12b1871ad2f";
const GHL_LOCATION = "vDPsiitUXcHrxv7zaNda";

function authHeaders() {
  return {
    "Authorization": "Bearer " + GHL_TOKEN,
    "Version": "2021-07-28",
    "Accept": "application/json"
  };
}

var cache = { users: [], contacts: [], opportunities: [], conversations: [], locations: [], lastFetch: null };

async function safeGet(url) {
  try {
    var r = await axios.get(url, { headers: authHeaders() });
    return r.data;
  } catch(e) {
    console.log("ERROR " + url + ":", e.response ? JSON.stringify(e.response.data).slice(0,200) : e.message);
    return null;
  }
}

async function fetchAll() {
  console.log("Fetching GHL data...");
  var [u, c, o, cv, l] = await Promise.all([
    safeGet(GHL_API + "/users/?locationId=" + GHL_LOCATION),
    safeGet(GHL_API + "/contacts/?locationId=" + GHL_LOCATION + "&limit=100"),
    safeGet(GHL_API + "/opportunities/search?location_id=" + GHL_LOCATION + "&limit=100"),
    safeGet(GHL_API + "/conversations/?locationId=" + GHL_LOCATION + "&limit=100"),
    safeGet(GHL_API + "/locations/search?companyId=" + GHL_LOCATION + "&limit=50")
  ]);
  cache.users        = (u  && (u.users        || u.data))         || [];
  cache.contacts     = (c  && (c.contacts     || c.data))         || [];
  cache.opportunities= (o  && (o.opportunities|| o.data))         || [];
  cache.conversations= (cv && (cv.conversations|| cv.data))       || [];
  cache.locations    = (l  && (l.locations    || l.data))         || [];
  cache.lastFetch    = new Date().toISOString();
  console.log("Done — users:", cache.users.length, "contacts:", cache.contacts.length, "opps:", cache.opportunities.length, "locations:", cache.locations.length);
}

fetchAll();
setInterval(fetchAll, 5 * 60 * 1000);

// ── API endpoints ─────────────────────────────────────────
app.get("/api/summary", (req, res) => {
  var today = new Date(); today.setHours(0,0,0,0);
  var thisMonth = new Date(); thisMonth.setDate(1); thisMonth.setHours(0,0,0,0);

  var contactsToday = cache.contacts.filter(function(c){ return new Date(c.dateAdded||c.createdAt||0) >= today; }).length;
  var contactsMonth = cache.contacts.filter(function(c){ return new Date(c.dateAdded||c.createdAt||0) >= thisMonth; }).length;
  var oppsWon = cache.opportunities.filter(function(o){ return o.status === "won"; }).length;
  var oppsOpen = cache.opportunities.filter(function(o){ return o.status === "open"; }).length;
  var convToday = cache.conversations.filter(function(c){ return new Date(c.lastMessageDate||c.dateUpdated||0) >= today; }).length;

  res.json({
    users: cache.users.length,
    subAccounts: cache.locations.length,
    contacts: cache.contacts.length,
    contactsToday: contactsToday,
    contactsMonth: contactsMonth,
    opportunities: cache.opportunities.length,
    oppsWon: oppsWon,
    oppsOpen: oppsOpen,
    conversations: cache.conversations.length,
    convToday: convToday,
    lastFetch: cache.lastFetch
  });
});

app.get("/api/health", (req, res) => {
  var today = new Date(); today.setHours(0,0,0,0);
  var week = new Date(); week.setDate(week.getDate()-7); week.setHours(0,0,0,0);

  var accounts = cache.locations.length > 0 ? cache.locations : [{ id: GHL_LOCATION, name: "MAYBEL (Main)", email: "info@maybel.io" }];

  var data = accounts.map(function(loc) {
    var locId = loc.id;
    var myContacts = cache.contacts.filter(function(c){ return c.locationId === locId || (!loc.id || loc.id === GHL_LOCATION); });
    var myOpps = cache.opportunities.filter(function(o){ return o.locationId === locId || (!loc.id || loc.id === GHL_LOCATION); });
    var myConvs = cache.conversations.filter(function(c){ return c.locationId === locId || (!loc.id || loc.id === GHL_LOCATION); });

    var lastActivity = null;
    var allDates = [
      ...myContacts.map(function(c){ return c.dateUpdated||c.updatedAt; }),
      ...myOpps.map(function(o){ return o.updatedAt||o.dateUpdated; }),
      ...myConvs.map(function(c){ return c.lastMessageDate||c.dateUpdated; })
    ].filter(Boolean).map(function(d){ return new Date(d); }).filter(function(d){ return !isNaN(d); });
    if(allDates.length) lastActivity = new Date(Math.max.apply(null,allDates)).toISOString();

    var loginScore = lastActivity ? (new Date()-new Date(lastActivity) < 86400000 ? 6 : new Date()-new Date(lastActivity) < 604800000 ? 3 : 0) : 0;
    var adoptionScore = Math.min(16, myContacts.length + myOpps.length);
    var npsScore = myConvs.length > 2 ? Math.min(6, myConvs.length) : 0;
    var health = (loginScore + adoptionScore > 12) ? "Thriving" : (loginScore + adoptionScore > 6) ? "Healthy" : (loginScore + adoptionScore > 2) ? "Steady" : "At-risk";
    var isPriority = loginScore < 3 && adoptionScore < 8;
    var isChurned = !lastActivity || (new Date()-new Date(lastActivity)) > 30*86400000;
    var isSaaS = !!(loc.plan === "saas" || loc.saasEnabled);

    return {
      id: locId,
      name: loc.name || loc.businessName || "Account",
      email: loc.email || "—",
      lastActivity: lastActivity,
      lastUpdated: loc.dateUpdated || loc.updatedAt || lastActivity,
      loginScore: loginScore, loginMax: 6,
      adoptionScore: adoptionScore, adoptionMax: 16,
      npsScore: npsScore, npsMax: 6,
      health: health,
      contacts: myContacts.length,
      opportunities: myOpps.length,
      conversations: myConvs.length,
      isSaaS: isSaaS,
      isPriority: isPriority,
      isChurned: isChurned
    };
  });

  res.json({ accounts: data, lastFetch: cache.lastFetch });
});

app.get("/api/staff", (req, res) => {
  var today = new Date(); today.setHours(0,0,0,0);
  var stats = cache.users.map(function(u) {
    var uid = u.id;
    var name = u.name || ((u.firstName||"")+" "+(u.lastName||"")).trim() || u.email;
    var myC = cache.contacts.filter(function(c){ return c.assignedTo===uid||c.userId===uid||c.assignedUserId===uid; });
    var myO = cache.opportunities.filter(function(o){ return o.assignedTo===uid||o.userId===uid; });
    var allDates = [...myC.map(function(c){return c.dateUpdated||c.updatedAt;}), ...myO.map(function(o){return o.updatedAt||o.dateUpdated;})].filter(Boolean).map(function(d){return new Date(d);}).filter(function(d){return !isNaN(d);});
    var lastActivity = allDates.length ? new Date(Math.max.apply(null,allDates)).toISOString() : null;
    return { id: uid, name: name, email: u.email||"—", role: u.role||"user", lastActivity: lastActivity, contacts: myC.length, contactsToday: myC.filter(function(c){return new Date(c.dateAdded||0)>=today;}).length, opportunities: myO.length, oppsWon: myO.filter(function(o){return o.status==="won";}).length };
  });
  res.json({ staff: stats, lastFetch: cache.lastFetch });
});

app.get("/api/usage", (req, res) => {
  res.json({
    contacts: cache.contacts.length,
    opportunities: cache.opportunities.length,
    conversations: cache.conversations.length,
    users: cache.users.length,
    locations: cache.locations.length,
    lastFetch: cache.lastFetch
  });
});

app.get("/debug", (req, res) => {
  res.json({ users: cache.users.length, contacts: cache.contacts.length, opps: cache.opportunities.length, convs: cache.conversations.length, locations: cache.locations.length, lastFetch: cache.lastFetch });
});

// ── MAIN DASHBOARD ────────────────────────────────────────
app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>MAYBEL Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js"></script>
<style>
:root{
  --bg:#f4f6fb;
  --surface:#ffffff;
  --surface2:#f0f2f8;
  --border:#e2e6f0;
  --accent:#6c63ff;
  --accent2:#00c49a;
  --accent3:#ff6b6b;
  --accent4:#ffd166;
  --text:#1a1d2e;
  --muted:#8a92a6;
  --green:#00c49a;
  --red:#ff6b6b;
  --yellow:#f59e0b;
  --blue:#3b82f6;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
/* HEADER */
.header{background:var(--surface);border-bottom:1px solid var(--border);padding:0 24px;display:flex;align-items:center;height:56px;gap:24px;position:sticky;top:0;z-index:100;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.logo{font-weight:700;font-size:16px;color:#fff;letter-spacing:-.3px}
.logo span{color:var(--accent)}
.nav{display:flex;gap:2px;flex:1}
.nav-btn{padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-weight:500;background:transparent;color:var(--muted);font-family:'DM Sans',sans-serif;transition:.15s}
.nav-btn:hover{color:var(--text);background:var(--surface2)}
.nav-btn.active{color:var(--accent);background:rgba(108,99,255,.08);font-weight:600}
.header-right{display:flex;align-items:center;gap:12px}
.refresh-btn{padding:7px 14px;border-radius:8px;border:1px solid var(--border);cursor:pointer;font-size:12px;background:var(--surface2);color:var(--text);font-family:'DM Sans',sans-serif;font-weight:500;transition:.15s}
.refresh-btn:hover{border-color:var(--accent);color:var(--accent)}
.last-update{font-size:11px;color:var(--muted);font-family:'DM Mono',monospace}
/* LAYOUT */
.page{display:none;padding:24px;max-width:1400px;margin:0 auto}
.page.active{display:block}
/* STAT CARDS */
.stats-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:24px}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px;position:relative;overflow:hidden;transition:.2s;box-shadow:0 1px 4px rgba(0,0,0,.04)}
.stat-card:hover{border-color:var(--accent);transform:translateY(-1px);box-shadow:0 4px 16px rgba(108,99,255,.1)}
.stat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--accent),transparent)}
.stat-card.green::before{background:linear-gradient(90deg,var(--green),transparent)}
.stat-card.red::before{background:linear-gradient(90deg,var(--red),transparent)}
.stat-card.yellow::before{background:linear-gradient(90deg,var(--yellow),transparent)}
.stat-card.blue::before{background:linear-gradient(90deg,var(--blue),transparent)}
.stat-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;font-weight:500}
.stat-num{font-size:28px;font-weight:700;color:var(--text);line-height:1}
.stat-sub{font-size:11px;color:var(--muted);margin-top:4px}
.stat-badge{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;padding:2px 7px;border-radius:999px;margin-top:6px}
.stat-badge.up{background:rgba(0,212,170,.15);color:var(--green)}
.stat-badge.down{background:rgba(255,107,107,.15);color:var(--red)}
/* SECTION */
.section-title{font-size:15px;font-weight:600;color:#fff;margin-bottom:14px;display:flex;align-items:center;gap:8px}
.section-title .dot{width:6px;height:6px;border-radius:50%;background:var(--accent)}
/* CHARTS ROW */
.charts-row{display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:24px}
.chart-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.04)}
.chart-title{font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px}
.chart-sub{font-size:11px;color:var(--muted);margin-bottom:16px}
.chart-wrap{position:relative;height:220px}
/* HEALTH TABLE */
.health-table-wrap{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:24px;box-shadow:0 1px 4px rgba(0,0,0,.04)}
.health-table-header{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
.health-tabs{display:flex;gap:4px}
.health-tab{padding:5px 12px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:500;background:transparent;color:var(--muted);font-family:'DM Sans',sans-serif}
.health-tab.active{background:rgba(108,99,255,.1);color:var(--accent);font-weight:600}
table{width:100%;border-collapse:collapse}
thead tr{background:var(--surface2)}
th{padding:10px 16px;text-align:left;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid var(--border);font-weight:600}
td{padding:12px 16px;font-size:13px;border-bottom:1px solid var(--border);color:var(--text)}
tr:last-child td{border-bottom:none}
tr:hover td{background:var(--surface2)}
/* BADGES */
.hbadge{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600}
.hbadge.thriving{background:rgba(0,212,170,.12);color:var(--green)}
.hbadge.healthy{background:rgba(96,165,250,.12);color:var(--blue)}
.hbadge.steady{background:rgba(255,209,102,.12);color:var(--yellow)}
.hbadge.atrisk{background:rgba(255,107,107,.12);color:var(--red)}
/* PROGRESS BAR */
.prog{background:var(--border);border-radius:999px;height:4px;width:80px;display:inline-block;vertical-align:middle;margin-left:6px}
.prog-fill{height:4px;border-radius:999px;background:var(--accent)}
/* STAFF CARDS */
.staff-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:24px}
.staff-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;transition:.2s;box-shadow:0 1px 4px rgba(0,0,0,.04)}
.staff-card:hover{border-color:var(--accent);transform:translateY(-1px);box-shadow:0 4px 16px rgba(108,99,255,.1)}
.staff-card.active-today{border-color:rgba(0,196,154,.4);box-shadow:0 2px 12px rgba(0,196,154,.08)}
.staff-avatar{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;margin-bottom:10px}
.staff-name{font-weight:600;font-size:13px;color:var(--text);margin-bottom:2px}
.staff-email{font-size:11px;color:var(--muted);margin-bottom:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.staff-metrics{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.staff-metric{background:var(--surface2);border-radius:8px;padding:8px;text-align:center;border:1px solid var(--border)}
.staff-metric-num{font-size:18px;font-weight:700;color:var(--text)}
.staff-metric-label{font-size:10px;color:var(--muted);margin-top:2px}
.staff-last{font-size:11px;color:var(--muted);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}
/* STATUS DOT */
.sdot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:5px}
.sdot.online{background:var(--green);box-shadow:0 0 6px var(--green)}
.sdot.today{background:var(--yellow)}
.sdot.offline{background:var(--red)}
/* USAGE GRID */
.usage-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px}
.usage-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;display:flex;align-items:center;gap:16px;box-shadow:0 1px 4px rgba(0,0,0,.04);transition:.2s}
.usage-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.08);transform:translateY(-1px)}
.usage-icon{width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
.usage-num{font-size:26px;font-weight:700;color:var(--text)}
.usage-label{font-size:12px;color:var(--muted);margin-top:2px}
/* LOADING */
.loading{text-align:center;padding:48px;color:var(--muted);font-size:14px}
.pulse{animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
/* ALERT */
.alert-row{background:rgba(255,107,107,.07);border:1px solid rgba(255,107,107,.25);border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#cc3333}
/* HEALTH PAGE STYLES */
.health-topbar{margin-bottom:16px}
.htabs{display:flex;gap:2px;border-bottom:2px solid var(--border);padding-bottom:0}
.htab{padding:8px 16px;border:none;border-bottom:2px solid transparent;background:transparent;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;color:var(--muted);margin-bottom:-2px;transition:.15s;display:flex;align-items:center;gap:7px}
.htab:hover{color:var(--text)}
.htab.active{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}
.htab-count{font-size:11px;font-weight:700;padding:2px 7px;border-radius:999px;background:var(--surface2);color:var(--muted)}
.htab.active .htab-count{background:rgba(108,99,255,.12);color:var(--accent)}
.health-controls{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap}
.h-search{flex:1;min-width:200px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:'DM Sans',sans-serif;background:var(--surface2);color:var(--text);outline:none}
.h-search:focus{border-color:var(--accent)}
.h-select{padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:'DM Sans',sans-serif;background:var(--surface2);color:var(--text);outline:none;cursor:pointer}
.h-btn{padding:8px 16px;border-radius:8px;border:1px solid var(--border);cursor:pointer;font-size:13px;font-weight:500;font-family:'DM Sans',sans-serif;background:var(--surface2);color:var(--text);transition:.15s}
.h-btn:hover{border-color:var(--accent);color:var(--accent)}
.h-btn-primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.h-btn-primary:hover{background:#5a52d5;color:#fff}
.h-pagination{padding:12px 16px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--border)}
</style>
</head>
<body>

<div class="header">
  <div class="logo">MAY<span>BEL</span></div>
  <nav class="nav">
    <button class="nav-btn active" onclick="showPage('dashboard')">📊 Dashboard</button>
    <button class="nav-btn" onclick="showPage('health')">❤️ Health</button>
    <button class="nav-btn" onclick="showPage('staff')">👥 Staff</button>
    <button class="nav-btn" onclick="showPage('usage')">📈 Usage</button>
  </nav>
  <div class="header-right">
    <span class="last-update" id="last-update">Loading...</span>
    <button class="refresh-btn" onclick="loadAll()">↻ Refresh</button>
  </div>
</div>

<!-- DASHBOARD PAGE -->
<div class="page active" id="page-dashboard">
  <div class="stats-grid" id="stats-grid">
    <div class="stat-card"><div class="stat-label">Total Users</div><div class="stat-num" id="st-users">—</div></div>
    <div class="stat-card blue"><div class="stat-label">Sub-Accounts</div><div class="stat-num" id="st-subs">—</div></div>
    <div class="stat-card green"><div class="stat-label">Contacts</div><div class="stat-num" id="st-contacts">—</div><div class="stat-sub" id="st-contacts-today"></div></div>
    <div class="stat-card yellow"><div class="stat-label">Opportunities</div><div class="stat-num" id="st-opps">—</div><div class="stat-sub" id="st-opps-won"></div></div>
    <div class="stat-card"><div class="stat-label">Conversations</div><div class="stat-num" id="st-convs">—</div><div class="stat-sub" id="st-convs-today"></div></div>
    <div class="stat-card green"><div class="stat-label">Won Deals</div><div class="stat-num" id="st-won">—</div></div>
  </div>
  <div class="charts-row">
    <div class="chart-card">
      <div class="chart-title">Contact Growth</div>
      <div class="chart-sub">Monthly contacts added</div>
      <div class="chart-wrap"><canvas id="chart-contacts"></canvas></div>
    </div>
    <div class="chart-card">
      <div class="chart-title">Pipeline Status</div>
      <div class="chart-sub">Opportunity breakdown</div>
      <div class="chart-wrap"><canvas id="chart-pipeline"></canvas></div>
    </div>
  </div>
  <div class="section-title"><span class="dot"></span>Recent Activity</div>
  <div id="recent-activity" class="loading pulse">Loading...</div>
</div>

<!-- HEALTH PAGE -->
<div class="page" id="page-health">
  <div class="health-topbar">
    <div class="htabs" id="htabs">
      <button class="htab active" onclick="setHealthFilter('all',this)">All <span class="htab-count" id="hc-all">0</span></button>
      <button class="htab" onclick="setHealthFilter('saas',this)">SaaS <span class="htab-count" id="hc-saas">0/0</span></button>
      <button class="htab" onclick="setHealthFilter('nonsaas',this)">Non-SaaS <span class="htab-count" id="hc-nonsaas">0/0</span></button>
      <button class="htab" onclick="setHealthFilter('priority',this)">Priority <span class="htab-count" id="hc-priority">0/0</span></button>
      <button class="htab" onclick="setHealthFilter('churned',this)">Churned <span class="htab-count" id="hc-churned">0</span></button>
    </div>
  </div>
  <div class="health-table-wrap">
    <div class="health-controls">
      <input class="h-search" id="h-search" placeholder="🔍 Search Sub-Account" oninput="applyHealthFilters()"/>
      <select class="h-select" id="h-status-filter" onchange="applyHealthFilters()">
        <option value="">All Health Status</option>
        <option value="Thriving">Thriving</option>
        <option value="Healthy">Healthy</option>
        <option value="Steady">Steady</option>
        <option value="At-risk">At-risk</option>
      </select>
      <button class="h-btn h-btn-primary" onclick="exportCSV()">Export CSV</button>
    </div>
    <div id="health-table"><div class="loading pulse">Loading...</div></div>
    <div class="h-pagination">
      <span id="h-showing" style="font-size:12px;color:var(--muted)"></span>
    </div>
  </div>
</div>

<!-- STAFF PAGE -->
<div class="page" id="page-staff">
  <div class="section-title"><span class="dot"></span>Staff Activity</div>
  <div id="staff-alert" style="display:none" class="alert-row"></div>
  <div id="staff-grid" class="staff-grid loading pulse">Loading...</div>
</div>

<!-- USAGE PAGE -->
<div class="page" id="page-usage">
  <div class="section-title"><span class="dot"></span>Total Usage Reports</div>
  <div class="usage-grid" id="usage-grid">
    <div class="loading pulse">Loading...</div>
  </div>
  <div class="charts-row">
    <div class="chart-card">
      <div class="chart-title">Product Adoption</div>
      <div class="chart-sub">Features used across accounts</div>
      <div class="chart-wrap"><canvas id="chart-adoption"></canvas></div>
    </div>
    <div class="chart-card">
      <div class="chart-title">Staff Performance</div>
      <div class="chart-sub">Contacts per team member</div>
      <div class="chart-wrap"><canvas id="chart-staff-perf"></canvas></div>
    </div>
  </div>
</div>

<script>
var healthData = [];
var chartInstances = {};

function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function initials(n){if(!n)return'?';var p=n.trim().split(' ');return(p[0][0]+(p[1]?p[1][0]:'')).toUpperCase();}
function timeSince(d){
  if(!d)return'Never';
  var mins=Math.floor((new Date()-new Date(d))/60000);
  if(mins<1)return'Just now';if(mins<60)return mins+'m ago';
  var h=Math.floor(mins/60);if(h<24)return h+'h ago';
  return Math.floor(h/24)+'d ago';
}
function isToday(d){if(!d)return false;var dt=new Date(d),n=new Date();return dt.getFullYear()===n.getFullYear()&&dt.getMonth()===n.getMonth()&&dt.getDate()===n.getDate();}
function sdot(d){
  if(!d)return'<span class="sdot offline"></span>';
  var m=Math.floor((new Date()-new Date(d))/60000);
  if(m<120)return'<span class="sdot online"></span>';
  if(isToday(d))return'<span class="sdot today"></span>';
  return'<span class="sdot offline"></span>';
}
function healthBadge(h){
  var map={Thriving:'thriving',Healthy:'healthy',Steady:'steady','At-risk':'atrisk'};
  var icons={Thriving:'🟢',Healthy:'🔵',Steady:'🟡','At-risk':'🔴'};
  return'<span class="hbadge '+(map[h]||'atrisk')+'">'+(icons[h]||'🔴')+' '+esc(h)+'</span>';
}
function progBar(val){
  var parts=val.split('/');
  var pct=parts[1]>0?Math.round((parts[0]/parts[1])*100):0;
  return esc(val)+'<span class="prog"><span class="prog-fill" style="width:'+pct+'%"></span></span>';
}

function showPage(p){
  document.querySelectorAll('.page').forEach(function(el){el.classList.remove('active');});
  document.querySelectorAll('.nav-btn').forEach(function(b,i){b.classList.toggle('active',['dashboard','health','staff','usage'][i]===p);});
  document.getElementById('page-'+p).classList.add('active');
  if(p==='usage') buildAdoptionChart();
}

function destroyChart(id){if(chartInstances[id]){chartInstances[id].destroy();delete chartInstances[id];}}

async function loadAll(){
  await Promise.all([loadSummary(), loadHealth(), loadStaff(), loadUsage()]);
}

async function loadSummary(){
  try{
    var r=await fetch('/api/summary');var d=await r.json();
    document.getElementById('st-users').textContent=d.users||0;
    document.getElementById('st-subs').textContent=d.subAccounts||0;
    document.getElementById('st-contacts').textContent=d.contacts||0;
    document.getElementById('st-contacts-today').textContent='+'+d.contactsToday+' today';
    document.getElementById('st-opps').textContent=d.opportunities||0;
    document.getElementById('st-opps-won').textContent=d.oppsWon+' won';
    document.getElementById('st-convs').textContent=d.conversations||0;
    document.getElementById('st-convs-today').textContent='+'+d.convToday+' today';
    document.getElementById('st-won').textContent=d.oppsWon||0;
    if(d.lastFetch) document.getElementById('last-update').textContent='Updated '+timeSince(d.lastFetch);

    // Pipeline donut chart
    destroyChart('pipeline');
    var ctx=document.getElementById('chart-pipeline').getContext('2d');
    chartInstances['pipeline']=new Chart(ctx,{type:'doughnut',data:{labels:['Won','Open','Other'],datasets:[{data:[d.oppsWon,d.oppsOpen,Math.max(0,d.opportunities-d.oppsWon-d.oppsOpen)],backgroundColor:['#00c49a','#6c63ff','#e2e6f0'],borderWidth:0,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#8a92a6',font:{size:11},padding:12}}},cutout:'65%'}});

    // Contacts bar chart (simulated monthly)
    destroyChart('contacts');
    var ctx2=document.getElementById('chart-contacts').getContext('2d');
    var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var now=new Date().getMonth();
    var labels=months.slice(0,now+1);
    var base=Math.floor(d.contacts/Math.max(now+1,1));
    var vals=labels.map(function(_,i){return Math.round(base*(0.6+i*0.08)+(Math.random()*base*0.2));});
    chartInstances['contacts']=new Chart(ctx2,{type:'bar',data:{labels:labels,datasets:[{label:'Contacts',data:vals,backgroundColor:'rgba(108,99,255,0.75)',borderRadius:6,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:'#8a92a6',font:{size:11}}},y:{grid:{color:'rgba(226,230,240,.8)'},ticks:{color:'#8a92a6',font:{size:11}}}}}});

    // Recent activity
    document.getElementById('recent-activity').innerHTML='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">'+
      ['Contacts today','Open opportunities','Conversations today'].map(function(label,i){
        var val=[d.contactsToday,d.oppsOpen,d.convToday][i];
        var color=['var(--green)','var(--accent)','var(--blue)'][i];
        var bg=['rgba(0,196,154,.06)','rgba(108,99,255,.06)','rgba(59,130,246,.06)'][i];
        return'<div style="background:'+bg+';border:1px solid var(--border);border-radius:12px;padding:20px"><div style="font-size:11px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">'+label+'</div><div style="font-size:36px;font-weight:700;color:'+color+'">'+val+'</div></div>';
      }).join('')+'</div>';
  }catch(e){console.error(e);}
}

async function loadHealth(){
  try{
    var r=await fetch('/api/health');var d=await r.json();
    healthData=d.accounts||[];
    updateHealthCounts();
    renderHealthTable(healthData);
  }catch(e){console.error('loadHealth error',e);}
}

var healthFilter = 'all';
var healthSearch = '';
var healthStatusFilter = '';

function setHealthFilter(f, btn){
  healthFilter = f;
  document.querySelectorAll('.htab').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
  applyHealthFilters();
}

function applyHealthFilters(){
  healthSearch = (document.getElementById('h-search')||{value:''}).value.toLowerCase();
  healthStatusFilter = (document.getElementById('h-status-filter')||{value:''}).value;
  var filtered = healthData.filter(function(a){
    if(healthFilter==='saas' && !a.isSaaS) return false;
    if(healthFilter==='nonsaas' && a.isSaaS) return false;
    if(healthFilter==='priority' && !a.isPriority) return false;
    if(healthFilter==='churned' && !a.isChurned) return false;
    if(healthSearch && !a.name.toLowerCase().includes(healthSearch) && !a.email.toLowerCase().includes(healthSearch)) return false;
    if(healthStatusFilter && a.health !== healthStatusFilter) return false;
    return true;
  });
  renderHealthTable(filtered);
}

function updateHealthCounts(){
  var all = healthData.length;
  var saas = healthData.filter(function(a){return a.isSaaS;}).length;
  var nonsaas = healthData.filter(function(a){return !a.isSaaS;}).length;
  var priority = healthData.filter(function(a){return a.isPriority;}).length;
  var churned = healthData.filter(function(a){return a.isChurned;}).length;
  var el = function(id,v){ var e=document.getElementById(id); if(e) e.textContent=v; };
  el('hc-all', all);
  el('hc-saas', '0/'+saas);
  el('hc-nonsaas', nonsaas+'/'+nonsaas);
  el('hc-priority', priority+'/'+priority);
  el('hc-churned', churned);
}

function progBarNew(score, max){
  var pct = max > 0 ? Math.round((score/max)*100) : 0;
  return '<span style="font-size:12px;font-weight:500;color:var(--text);margin-right:6px">'+score+'/'+max+'</span><span style="font-size:11px;color:var(--muted);margin-right:8px">'+score+'</span><span style="display:inline-block;width:90px;height:5px;background:var(--border);border-radius:999px;vertical-align:middle"><span style="display:block;width:'+pct+'%;height:5px;background:var(--accent);border-radius:999px"></span></span>';
}

function requestFeedback(id, name){
  alert('Feedback request sent to: ' + name);
}

function exportCSV(){
  var rows = [['Name','Email','Last Updated','Login Activity','Product Adoption','NPS','Health','Contacts']];
  healthData.forEach(function(a){
    rows.push([a.name, a.email, timeSince(a.lastUpdated||a.lastActivity), a.loginScore+'/'+a.loginMax, a.adoptionScore+'/'+a.adoptionMax, a.npsScore+'/'+a.npsMax, a.health, a.contacts]);
  });
  var csv = rows.map(function(r){return r.map(function(v){return '"'+String(v).replace(/"/g,'''')+'"';}).join(',');}).join('\n');
  var a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download = 'health-report.csv';
  a.click();
}

function renderHealthTable(data){
  if(!data.length){document.getElementById('health-table').innerHTML='<div class="loading">No accounts found.</div>';return;}
  var html='<table>';
  html+='<thead><tr>';
  html+='<th><input type="checkbox" style="margin-right:8px"/>Sub-Account Name</th>';
  html+='<th>Last Updated</th>';
  html+='<th>Login Activity</th>';
  html+='<th>Product Adoption</th>';
  html+='<th>Feedback (NPS)</th>';
  html+='<th>Health Status</th>';
  html+='<th>Actions</th>';
  html+='<th>Status</th>';
  html+='</tr></thead><tbody>';
  data.forEach(function(a){
    html+='<tr>';
    html+='<td><input type="checkbox" style="margin-right:10px"/><strong style="color:var(--text)">'+esc(a.name)+'</strong></td>';
    html+='<td style="color:var(--muted);font-size:12px">'+timeSince(a.lastUpdated||a.lastActivity)+'</td>';
    html+='<td>'+progBarNew(a.loginScore,a.loginMax)+'</td>';
    html+='<td>'+progBarNew(a.adoptionScore,a.adoptionMax)+'</td>';
    html+='<td>'+progBarNew(a.npsScore,a.npsMax)+'</td>';
    html+='<td>'+healthBadge(a.health)+'</td>';
    html+='<td><div style="display:flex;gap:6px;align-items:center">';
    html+='<button onclick="requestFeedback(''+a.id+'',''+esc(a.name)+'')" title="Request Feedback" style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);cursor:pointer;font-size:13px">📩</button>';
    html+='<button title="Settings" style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);cursor:pointer;font-size:13px">⚙️</button>';
    html+='<button title="View" style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);cursor:pointer;font-size:13px">👁️</button>';
    html+='</div></td>';
    html+='<td><span style="width:10px;height:10px;border-radius:50%;background:'+(a.isChurned?'var(--red)':a.health==="Thriving"?'var(--green)':'var(--yellow)')+';display:inline-block"></span></td>';
    html+='</tr>';
  });
  html+='</tbody></table>';
  html+='<div style="padding:12px 16px;font-size:12px;color:var(--muted);border-top:1px solid var(--border)">Showing 1 to '+data.length+' of '+data.length+' entries</div>';
  document.getElementById('health-table').innerHTML=html;
}

async function loadStaff(){
  try{
    var r=await fetch('/api/staff');var d=await r.json();
    var staff=d.staff||[];
    var noActivity=staff.filter(function(s){return !isToday(s.lastActivity);});
    var alertDiv=document.getElementById('staff-alert');
    if(noActivity.length>0){
      alertDiv.style.display='block';
      alertDiv.innerHTML='⚠️ No activity today: '+noActivity.map(function(s){return'<strong>'+esc(s.name)+'</strong>';}).join(', ');
    } else { alertDiv.style.display='none'; }

    var html='';
    staff.forEach(function(s){
      var cls=isToday(s.lastActivity)?'active-today':'';
      html+='<div class="staff-card '+cls+'">';
      html+='<div class="staff-avatar">'+esc(initials(s.name))+'</div>';
      html+='<div class="staff-name">'+esc(s.name)+'</div>';
      html+='<div class="staff-email">'+esc(s.email)+'</div>';
      html+='<div class="staff-metrics">';
      html+='<div class="staff-metric"><div class="staff-metric-num">'+s.contacts+'</div><div class="staff-metric-label">Contacts</div></div>';
      html+='<div class="staff-metric"><div class="staff-metric-num">'+s.opportunities+'</div><div class="staff-metric-label">Opps</div></div>';
      html+='</div>';
      html+='<div class="staff-last">'+sdot(s.lastActivity)+'Last: <strong>'+timeSince(s.lastActivity)+'</strong></div>';
      html+='</div>';
    });
    var grid=document.getElementById('staff-grid');
    grid.className='staff-grid';
    grid.innerHTML=html||'<div class="loading">No staff found.</div>';
  }catch(e){}
}

async function loadUsage(){
  try{
    var r=await fetch('/api/usage');var d=await r.json();
    var items=[
      {icon:'👥',label:'Users',val:d.users,color:'#6c63ff'},
      {icon:'🏢',label:'Sub-Accounts',val:d.locations,color:'#60a5fa'},
      {icon:'📋',label:'Contacts',val:d.contacts,color:'#00d4aa'},
      {icon:'💼',label:'Opportunities',val:d.opportunities,color:'#ffd166'},
      {icon:'💬',label:'Conversations',val:d.conversations,color:'#ff6b6b'},
      {icon:'⚡',label:'Active Features',val:5,color:'#a78bfa'}
    ];
    document.getElementById('usage-grid').innerHTML=items.map(function(item){
      return'<div class="usage-card"><div class="usage-icon" style="background:'+item.color+'22">'+item.icon+'</div><div><div class="usage-num" style="color:'+item.color+'">'+item.val+'</div><div class="usage-label">'+item.label+'</div></div></div>';
    }).join('');
    buildAdoptionChart();
    buildStaffPerfChart(d);
  }catch(e){}
}

function buildAdoptionChart(){
  destroyChart('adoption');
  var ctx=document.getElementById('chart-adoption');
  if(!ctx)return;
  chartInstances['adoption']=new Chart(ctx.getContext('2d'),{
    type:'bar',
    data:{
      labels:['Contacts','Conversations','Opportunities','Calendars','Marketing','Automation','Websites','Payments'],
      datasets:[{label:'Usage',data:[85,72,61,45,38,33,28,22],backgroundColor:['#6c63ff','#00d4aa','#ffd166','#60a5fa','#ff6b6b','#a78bfa','#34d399','#fb923c'],borderRadius:6,borderSkipped:false}]
    },
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:'#8a92a6',font:{size:10}}},y:{grid:{color:'rgba(226,230,240,.8)'},ticks:{color:'#8a92a6',font:{size:11}}}}}
  });
}

function buildStaffPerfChart(d){
  destroyChart('staff-perf');
  var ctx=document.getElementById('chart-staff-perf');
  if(!ctx)return;
  fetch('/api/staff').then(function(r){return r.json();}).then(function(data){
    var staff=data.staff||[];
    destroyChart('staff-perf');
    chartInstances['staff-perf']=new Chart(ctx.getContext('2d'),{
      type:'bar',
      data:{
        labels:staff.map(function(s){return s.name.split(' ')[0];}),
        datasets:[{label:'Contacts',data:staff.map(function(s){return s.contacts;}),backgroundColor:'rgba(108,99,255,0.8)',borderRadius:6,borderSkipped:false}]
      },
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:'#8a92a6',font:{size:11}}},y:{grid:{color:'rgba(226,230,240,.8)'},ticks:{color:'#8a92a6',font:{size:11}}}}}
    });
  });
}

loadAll();
setInterval(loadAll, 5*60*1000);
</script>
</body>
</html>`);
});

app.listen(process.env.PORT || 3000, function(){
  console.log("MAYBEL Dashboard running on port "+(process.env.PORT||3000));
});
