const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const GHL_API = "https://services.leadconnectorhq.com";
const GHL_TOKEN = "pit-d6e4af69-dfb1-419d-950e-a12b1871ad2f";
const GHL_LOCATION = "vDPsiitUXcHrxv7zaNda";

// ── helper ──────────────────────────────────────────────
function authHeaders() {
  return {
    "Authorization": "Bearer " + GHL_TOKEN,
    "Version": "2021-07-28",
    "Accept": "application/json"
  };
}

// ── MAIN PAGE ───────────────────────────────────────────
app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>MAYBEL Team Tracker</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;background:#f0f2f8;color:#1f2937;padding:24px}
    h1{font-size:22px;font-weight:700;margin-bottom:4px}
    .subtitle{color:#6b7280;font-size:14px;margin-bottom:20px}
    .tabs{display:flex;gap:8px;margin-bottom:20px}
    .tab{padding:10px 22px;border-radius:8px;border:none;cursor:pointer;font-size:14px;font-weight:600;background:#e5e7eb;color:#374151;transition:.2s}
    .tab.active{background:#111827;color:#fff}
    .refresh-btn{margin-left:auto;padding:10px 18px;border-radius:8px;border:none;cursor:pointer;font-size:13px;background:#6366f1;color:#fff;font-weight:600}
    .refresh-btn:hover{opacity:.88}
    .summary-row{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:22px}
    .stat-card{background:#fff;border-radius:14px;padding:18px;box-shadow:0 2px 12px rgba(0,0,0,.07);text-align:center}
    .stat-num{font-size:32px;font-weight:700;color:#111827}
    .stat-label{font-size:12px;color:#6b7280;margin-top:4px}
    .stat-card.green .stat-num{color:#16a34a}
    .stat-card.red .stat-num{color:#dc2626}
    .stat-card.blue .stat-num{color:#2563eb}
    table{width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.07)}
    thead tr{background:#f8fafc}
    th{padding:13px 16px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em}
    td{padding:13px 16px;font-size:14px;border-top:1px solid #f1f3f9}
    tr:hover td{background:#fafbff}
    .badge{display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700}
    .badge.online{background:#dcfce7;color:#16a34a}
    .badge.warning{background:#fef9c3;color:#92400e}
    .badge.offline{background:#fee2e2;color:#dc2626}
    .features{display:flex;flex-wrap:wrap;gap:4px}
    .feat{background:#ede9fe;color:#5b21b6;padding:3px 8px;border-radius:6px;font-size:11px}
    .alert-box{background:#fef2f2;border:1px solid #fca5a5;border-radius:12px;padding:14px 18px;margin-bottom:18px;display:none}
    .alert-box h3{color:#dc2626;font-size:14px;margin-bottom:8px}
    .alert-box ul{color:#7f1d1d;font-size:13px;padding-left:18px}
    .section{display:none}
    .section.active{display:block}
    .loading{text-align:center;padding:40px;color:#6b7280}
    .avatar{width:32px;height:32px;border-radius:50%;background:#6366f1;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;margin-right:8px;vertical-align:middle}
    .hours-bar{background:#e5e7eb;border-radius:999px;height:8px;width:100%;margin-top:4px}
    .hours-fill{background:#6366f1;border-radius:999px;height:8px;transition:.5s}
  </style>
</head>
<body>

<h1>MAYBEL Team Tracker</h1>
<p class="subtitle">Real-time activity tracking — employees & sub-accounts</p>

<div class="tabs">
  <button class="tab active" onclick="switchTab('staff')">👥 Staff</button>
  <button class="tab" onclick="switchTab('accounts')">🏢 Sub-Accounts</button>
  <button class="refresh-btn" onclick="loadAll()">🔄 Refresh</button>
</div>

<!-- STAFF SECTION -->
<div id="section-staff" class="section active">
  <div class="summary-row" id="staff-summary">
    <div class="stat-card"><div class="stat-num" id="s-total">—</div><div class="stat-label">Total Staff</div></div>
    <div class="stat-card green"><div class="stat-num" id="s-active">—</div><div class="stat-label">Active Today</div></div>
    <div class="stat-card red"><div class="stat-num" id="s-inactive">—</div><div class="stat-label">Not Logged In Today</div></div>
    <div class="stat-card blue"><div class="stat-num" id="s-avg">—</div><div class="stat-label">Avg Hours/Day</div></div>
  </div>
  <div class="alert-box" id="staff-alert">
    <h3>⚠️ Did not log in today:</h3>
    <ul id="staff-alert-list"></ul>
  </div>
  <div id="staff-output" class="loading">Loading staff data...</div>
</div>

<!-- ACCOUNTS SECTION -->
<div id="section-accounts" class="section">
  <div class="summary-row" id="accounts-summary">
    <div class="stat-card"><div class="stat-num" id="a-total">—</div><div class="stat-label">Total Accounts</div></div>
    <div class="stat-card green"><div class="stat-num" id="a-active">—</div><div class="stat-label">Active Today</div></div>
    <div class="stat-card red"><div class="stat-num" id="a-inactive">—</div><div class="stat-label">Inactive Today</div></div>
    <div class="stat-card blue"><div class="stat-num" id="a-features">—</div><div class="stat-label">Avg Features Used</div></div>
  </div>
  <div class="alert-box" id="accounts-alert">
    <h3>⚠️ No activity today:</h3>
    <ul id="accounts-alert-list"></ul>
  </div>
  <div id="accounts-output" class="loading">Loading accounts data...</div>
</div>

<script>
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(function(t,i){
    t.classList.toggle('active', (i===0&&tab==='staff')||(i===1&&tab==='accounts'));
  });
  document.querySelectorAll('.section').forEach(function(s){s.classList.remove('active')});
  document.getElementById('section-'+tab).classList.add('active');
}

function getInitials(name) {
  if (!name) return '?';
  var parts = name.trim().split(' ');
  return (parts[0][0]+(parts[1]?parts[1][0]:'')).toUpperCase();
}

function timeSince(dateStr) {
  if (!dateStr) return 'Never';
  var d = new Date(dateStr);
  if (isNaN(d)) return 'Unknown';
  var now = new Date();
  var mins = Math.floor((now-d)/60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins/60);
  if (hrs < 24) return hrs + 'h ago';
  var days = Math.floor(hrs/24);
  return days + 'd ago';
}

function isToday(dateStr) {
  if (!dateStr) return false;
  var d = new Date(dateStr);
  var now = new Date();
  return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth() && d.getDate()===now.getDate();
}

function statusBadge(dateStr) {
  if (!dateStr) return '<span class="badge offline">Never</span>';
  var d = new Date(dateStr);
  var mins = Math.floor((new Date()-d)/60000);
  if (mins < 30) return '<span class="badge online">Online</span>';
  if (isToday(dateStr)) return '<span class="badge warning">Active Today</span>';
  return '<span class="badge offline">Offline</span>';
}

async function loadAll() {
  loadStaff();
  loadAccounts();
}

async function loadStaff() {
  var out = document.getElementById('staff-output');
  out.innerHTML = '<div class="loading">Loading...</div>';
  try {
    var res = await fetch('/team');
    var data = await res.json();
    var users = data.users || data.data || [];

    var total = users.length;
    var activeToday = users.filter(function(u){ return isToday(u.lastLoginAt || u.updatedAt); }).length;
    var inactive = total - activeToday;
    document.getElementById('s-total').textContent = total;
    document.getElementById('s-active').textContent = activeToday;
    document.getElementById('s-inactive').textContent = inactive;
    document.getElementById('s-avg').textContent = '—';

    // Alert box
    var notLoggedIn = users.filter(function(u){ return !isToday(u.lastLoginAt || u.updatedAt); });
    var alertBox = document.getElementById('staff-alert');
    var alertList = document.getElementById('staff-alert-list');
    if (notLoggedIn.length > 0) {
      alertBox.style.display = 'block';
      alertList.innerHTML = notLoggedIn.map(function(u){
        var name = u.name || ((u.firstName||'')+ ' '+(u.lastName||'')).trim() || u.email;
        return '<li>' + escHtml(name) + '</li>';
      }).join('');
    } else {
      alertBox.style.display = 'none';
    }

    if (!users.length) { out.innerHTML = '<div class="loading">No staff found.</div>'; return; }

    var html = '<table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last Seen</th><th>Status</th></tr></thead><tbody>';
    users.forEach(function(u) {
      var name = u.name || ((u.firstName||'')+ ' '+(u.lastName||'')).trim() || '—';
      var email = u.email || '—';
      var role = u.role || u.type || '—';
      var lastSeen = u.lastLoginAt || u.updatedAt || null;
      html += '<tr>';
      html += '<td><span class="avatar">'+escHtml(getInitials(name))+'</span>'+escHtml(name)+'</td>';
      html += '<td>'+escHtml(email)+'</td>';
      html += '<td>'+escHtml(role)+'</td>';
      html += '<td>'+timeSince(lastSeen)+'</td>';
      html += '<td>'+statusBadge(lastSeen)+'</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    out.innerHTML = html;
  } catch(e) {
    out.innerHTML = '<div class="loading" style="color:#dc2626">Error: '+escHtml(e.message)+'</div>';
  }
}

async function loadAccounts() {
  var out = document.getElementById('accounts-output');
  out.innerHTML = '<div class="loading">Loading...</div>';
  try {
    var res = await fetch('/accounts');
    var data = await res.json();
    var accounts = data.locations || data.data || [];

    document.getElementById('a-total').textContent = accounts.length;
    var activeAcc = accounts.filter(function(a){ return isToday(a.lastActivity || a.updatedAt); }).length;
    document.getElementById('a-active').textContent = activeAcc;
    document.getElementById('a-inactive').textContent = accounts.length - activeAcc;
    document.getElementById('a-features').textContent = '—';

    var notActive = accounts.filter(function(a){ return !isToday(a.lastActivity || a.updatedAt); });
    var alertBox = document.getElementById('accounts-alert');
    var alertList = document.getElementById('accounts-alert-list');
    if (notActive.length > 0) {
      alertBox.style.display = 'block';
      alertList.innerHTML = notActive.map(function(a){
        return '<li>'+escHtml(a.name || a.businessName || a.id)+'</li>';
      }).join('');
    } else {
      alertBox.style.display = 'none';
    }

    if (!accounts.length) { out.innerHTML = '<div class="loading">No accounts found.</div>'; return; }

    var html = '<table><thead><tr><th>Account</th><th>Email</th><th>Plan</th><th>Last Activity</th><th>Status</th></tr></thead><tbody>';
    accounts.forEach(function(a) {
      var name = a.name || a.businessName || '—';
      var email = a.email || '—';
      var plan = a.plan || a.subscriptionPlan || '—';
      var lastAct = a.lastActivity || a.updatedAt || null;
      html += '<tr>';
      html += '<td><span class="avatar" style="background:#0891b2">'+escHtml(getInitials(name))+'</span>'+escHtml(name)+'</td>';
      html += '<td>'+escHtml(email)+'</td>';
      html += '<td>'+escHtml(plan)+'</td>';
      html += '<td>'+timeSince(lastAct)+'</td>';
      html += '<td>'+statusBadge(lastAct)+'</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    out.innerHTML = html;
  } catch(e) {
    out.innerHTML = '<div class="loading" style="color:#dc2626">Error: '+escHtml(e.message)+'</div>';
  }
}

function escHtml(v) {
  return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

loadAll();
setInterval(loadAll, 60000);
</script>
</body>
</html>`);
});

// ── ENV CHECK ────────────────────────────────────────────
app.get("/env-check", (req, res) => {
  res.json({
    hasToken: !!GHL_TOKEN,
    tokenPreview: GHL_TOKEN.slice(0,8)+"..."+GHL_TOKEN.slice(-4),
    tokenLength: GHL_TOKEN.length,
    startsWithPit: GHL_TOKEN.startsWith("pit-"),
    hasLocationId: !!GHL_LOCATION,
    locationId: GHL_LOCATION
  });
});

// ── STAFF ────────────────────────────────────────────────
app.get("/team", async (req, res) => {
  try {
    var response = await axios.get(GHL_API + "/users/?locationId=" + GHL_LOCATION, {
      headers: authHeaders()
    });
    console.log("TEAM:", JSON.stringify(response.data).slice(0,300));
    res.json(response.data);
  } catch (err) {
    console.log("TEAM ERROR:", err.response ? err.response.data : err.message);
    res.status(err.response ? err.response.status : 500).json({
      success: false,
      error: err.response ? err.response.data : err.message
    });
  }
});

// ── SUB-ACCOUNTS ─────────────────────────────────────────
app.get("/accounts", async (req, res) => {
  try {
    var response = await axios.get(GHL_API + "/locations/search?companyId=" + GHL_LOCATION, {
      headers: authHeaders()
    });
    console.log("ACCOUNTS:", JSON.stringify(response.data).slice(0,300));
    res.json(response.data);
  } catch (err) {
    console.log("ACCOUNTS ERROR:", err.response ? err.response.data : err.message);
    res.status(err.response ? err.response.status : 500).json({
      success: false,
      error: err.response ? err.response.data : err.message
    });
  }
});

// ── START ────────────────────────────────────────────────
app.listen(process.env.PORT || 3000, function() {
  console.log("MAYBEL Tracker running on port " + (process.env.PORT || 3000));
});
