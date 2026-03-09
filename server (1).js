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

// Cache
var cache = { users: null, contacts: null, opportunities: null, conversations: null, lastFetch: null };

async function fetchAll() {
  try {
    var [usersRes, contactsRes, oppsRes, convsRes] = await Promise.all([
      axios.get(GHL_API + "/users/?locationId=" + GHL_LOCATION, { headers: authHeaders() }),
      axios.get(GHL_API + "/contacts/?locationId=" + GHL_LOCATION + "&limit=100", { headers: authHeaders() }),
      axios.get(GHL_API + "/opportunities/search?location_id=" + GHL_LOCATION + "&limit=100", { headers: authHeaders() }),
      axios.get(GHL_API + "/conversations/?locationId=" + GHL_LOCATION + "&limit=100", { headers: authHeaders() })
    ]);
    cache.users = usersRes.data.users || usersRes.data.data || [];
    cache.contacts = contactsRes.data.contacts || contactsRes.data.data || [];
    cache.opportunities = oppsRes.data.opportunities || oppsRes.data.data || [];
    cache.conversations = convsRes.data.conversations || convsRes.data.data || [];
    cache.lastFetch = new Date().toISOString();
    console.log("Cache refreshed at", cache.lastFetch);
  } catch(e) {
    console.log("fetchAll error:", e.response ? JSON.stringify(e.response.data) : e.message);
  }
}

// Refresh every 5 minutes
fetchAll();
setInterval(fetchAll, 5 * 60 * 1000);

// Stats API
app.get("/stats", async (req, res) => {
  if (!cache.users) await fetchAll();

  var users = cache.users || [];
  var contacts = cache.contacts || [];
  var opportunities = cache.opportunities || [];
  var conversations = cache.conversations || [];

  var today = new Date();
  today.setHours(0,0,0,0);

  var stats = users.map(function(u) {
    var uid = u.id;
    var name = u.name || ((u.firstName||"")+" "+(u.lastName||"")).trim() || u.email;

    var myContacts = contacts.filter(function(c){ return c.assignedTo === uid || c.userId === uid; });
    var myContactsToday = myContacts.filter(function(c){ return new Date(c.dateAdded||c.createdAt) >= today; });

    var myOpps = opportunities.filter(function(o){ return o.assignedTo === uid || o.userId === uid; });
    var myOppsToday = myOpps.filter(function(o){ return new Date(o.createdAt||o.dateAdded) >= today; });
    var myOppsWon = myOpps.filter(function(o){ return o.status === "won"; });

    var myConvs = conversations.filter(function(c){ return c.assignedTo === uid || c.userId === uid; });
    var myConvsToday = myConvs.filter(function(c){ return new Date(c.lastMessageDate||c.dateUpdated||c.createdAt) >= today; });

    // Last activity = most recent action across all data
    var dates = [
      ...myContacts.map(function(c){ return c.dateUpdated||c.updatedAt||c.dateAdded; }),
      ...myOpps.map(function(o){ return o.updatedAt||o.dateUpdated||o.createdAt; }),
      ...myConvs.map(function(c){ return c.lastMessageDate||c.dateUpdated; })
    ].filter(Boolean).map(function(d){ return new Date(d); }).filter(function(d){ return !isNaN(d); });

    var lastActivity = dates.length > 0 ? new Date(Math.max.apply(null, dates)).toISOString() : null;

    return {
      id: uid,
      name: name,
      email: u.email || "—",
      role: u.role || u.type || "—",
      lastActivity: lastActivity,
      contacts: { total: myContacts.length, today: myContactsToday.length },
      opportunities: { total: myOpps.length, today: myOppsToday.length, won: myOppsWon.length },
      conversations: { total: myConvs.length, today: myConvsToday.length }
    };
  });

  res.json({ stats: stats, lastFetch: cache.lastFetch });
});

app.get("/team", async (req, res) => {
  try {
    var r = await axios.get(GHL_API + "/users/?locationId=" + GHL_LOCATION, { headers: authHeaders() });
    res.json(r.data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/accounts", async (req, res) => {
  try {
    var r = await axios.get(GHL_API + "/locations/search?companyId=" + GHL_LOCATION, { headers: authHeaders() });
    res.json(r.data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/env-check", (req, res) => {
  res.json({ hasToken: !!GHL_TOKEN, startsWithPit: GHL_TOKEN.startsWith("pit-"), hasLocationId: !!GHL_LOCATION, locationId: GHL_LOCATION, lastFetch: cache.lastFetch });
});

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>MAYBEL Team Tracker</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;background:#f0f2f8;color:#1f2937;padding:20px}
    h1{font-size:20px;font-weight:700;margin-bottom:4px}
    .subtitle{color:#6b7280;font-size:13px;margin-bottom:18px}
    .top-row{display:flex;align-items:center;gap:10px;margin-bottom:18px;flex-wrap:wrap}
    .tab{padding:9px 20px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600;background:#e5e7eb;color:#374151}
    .tab.active{background:#111827;color:#fff}
    .refresh-btn{margin-left:auto;padding:9px 16px;border-radius:8px;border:none;cursor:pointer;font-size:13px;background:#6366f1;color:#fff;font-weight:600}
    .last-fetch{font-size:11px;color:#9ca3af}
    .summary-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}
    .stat-card{background:#fff;border-radius:12px;padding:16px;box-shadow:0 2px 10px rgba(0,0,0,.06);text-align:center}
    .stat-num{font-size:28px;font-weight:700}
    .stat-label{font-size:11px;color:#6b7280;margin-top:3px}
    .green{color:#16a34a}.red{color:#dc2626}.blue{color:#2563eb}.purple{color:#7c3aed}
    .alert-box{background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:12px 16px;margin-bottom:16px;display:none}
    .alert-box h3{color:#dc2626;font-size:13px;margin-bottom:6px}
    .alert-box ul{color:#7f1d1d;font-size:12px;padding-left:16px;line-height:1.9}
    .cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
    .user-card{background:#fff;border-radius:14px;padding:18px;box-shadow:0 2px 10px rgba(0,0,0,.06);border-left:4px solid #e5e7eb;transition:.2s}
    .user-card.active-today{border-left-color:#16a34a}
    .user-card.inactive{border-left-color:#dc2626}
    .card-header{display:flex;align-items:center;gap:10px;margin-bottom:12px}
    .avatar{width:38px;height:38px;border-radius:50%;background:#6366f1;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0}
    .card-name{font-weight:600;font-size:14px}
    .card-email{font-size:11px;color:#6b7280}
    .badge{display:inline-block;padding:3px 9px;border-radius:999px;font-size:10px;font-weight:700}
    .badge.online{background:#dcfce7;color:#16a34a}
    .badge.today{background:#fef9c3;color:#92400e}
    .badge.offline{background:#fee2e2;color:#dc2626}
    .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
    .metric{background:#f8fafc;border-radius:8px;padding:8px;text-align:center}
    .metric-num{font-size:18px;font-weight:700;color:#111827}
    .metric-today{font-size:10px;color:#16a34a;font-weight:600}
    .metric-label{font-size:10px;color:#6b7280;margin-top:2px}
    .last-seen{font-size:11px;color:#6b7280;margin-top:10px;padding-top:8px;border-top:1px solid #f1f3f9}
    .section{display:none}
    .section.active{display:block}
    .loading{text-align:center;padding:40px;color:#6b7280;font-size:14px}
    table{width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.06)}
    thead tr{background:#f8fafc}
    th{padding:11px 14px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em}
    td{padding:11px 14px;font-size:13px;border-top:1px solid #f1f3f9}
  </style>
</head>
<body>
<h1>MAYBEL Team Tracker</h1>
<p class="subtitle">Auto-refreshes every 5 minutes from GHL</p>

<div class="top-row">
  <button class="tab active" onclick="switchTab('staff')">👥 Staff Activity</button>
  <button class="tab" onclick="switchTab('accounts')">🏢 Sub-Accounts</button>
  <button class="refresh-btn" onclick="loadAll()">🔄 Refresh Now</button>
  <span class="last-fetch" id="last-fetch">Loading...</span>
</div>

<div id="section-staff" class="section active">
  <div class="summary-row">
    <div class="stat-card"><div class="stat-num" id="s-total">—</div><div class="stat-label">Total Staff</div></div>
    <div class="stat-card"><div class="stat-num green" id="s-active">—</div><div class="stat-label">Active Today</div></div>
    <div class="stat-card"><div class="stat-num red" id="s-inactive">—</div><div class="stat-label">No Activity Today</div></div>
    <div class="stat-card"><div class="stat-num purple" id="s-actions">—</div><div class="stat-label">Total Actions Today</div></div>
  </div>
  <div class="alert-box" id="staff-alert">
    <h3>⚠️ No activity today:</h3>
    <ul id="staff-alert-list"></ul>
  </div>
  <div id="staff-output" class="loading">Loading staff data from GHL...</div>
</div>

<div id="section-accounts" class="section">
  <div id="accounts-output" class="loading">Loading accounts...</div>
</div>

<script>
function switchTab(t) {
  document.querySelectorAll('.tab').forEach(function(b,i){b.classList.toggle('active',(i===0&&t==='staff')||(i===1&&t==='accounts'));});
  document.querySelectorAll('.section').forEach(function(s){s.classList.remove('active');});
  document.getElementById('section-'+t).classList.add('active');
}
function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function initials(n){if(!n)return '?';var p=n.trim().split(' ');return(p[0][0]+(p[1]?p[1][0]:'')).toUpperCase();}
function timeSince(d){
  if(!d)return'Never';
  var mins=Math.floor((new Date()-new Date(d))/60000);
  if(mins<1)return'Just now';
  if(mins<60)return mins+'m ago';
  var h=Math.floor(mins/60);
  if(h<24)return h+'h ago';
  return Math.floor(h/24)+'d ago';
}
function isToday(d){
  if(!d)return false;
  var dt=new Date(d),n=new Date();
  return dt.getFullYear()===n.getFullYear()&&dt.getMonth()===n.getMonth()&&dt.getDate()===n.getDate();
}
function badge(d){
  if(!d)return'<span class="badge offline">No Activity</span>';
  var m=Math.floor((new Date()-new Date(d))/60000);
  if(m<60)return'<span class="badge online">🟢 Active</span>';
  if(isToday(d))return'<span class="badge today">🟡 Active Today</span>';
  return'<span class="badge offline">🔴 Inactive</span>';
}

async function loadAll(){loadStaff();loadAccounts();}

async function loadStaff(){
  var out=document.getElementById('staff-output');
  try{
    var res=await fetch('/stats');
    var data=await res.json();
    var stats=data.stats||[];

    if(data.lastFetch){
      document.getElementById('last-fetch').textContent='Last updated: '+timeSince(data.lastFetch);
    }

    var total=stats.length;
    var activeToday=stats.filter(function(s){return isToday(s.lastActivity);}).length;
    var totalActions=stats.reduce(function(sum,s){return sum+s.contacts.today+s.opportunities.today+s.conversations.today;},0);

    document.getElementById('s-total').textContent=total;
    document.getElementById('s-active').textContent=activeToday;
    document.getElementById('s-inactive').textContent=total-activeToday;
    document.getElementById('s-actions').textContent=totalActions;

    var noActivity=stats.filter(function(s){return !isToday(s.lastActivity);});
    var alertBox=document.getElementById('staff-alert');
    var alertList=document.getElementById('staff-alert-list');
    if(noActivity.length>0){
      alertBox.style.display='block';
      alertList.innerHTML=noActivity.map(function(s){return'<li>'+esc(s.name)+'</li>';}).join('');
    } else {
      alertBox.style.display='none';
    }

    if(!stats.length){out.innerHTML='<div class="loading">No staff found.</div>';return;}

    var html='<div class="cards-grid">';
    stats.forEach(function(s){
      var cardClass=isToday(s.lastActivity)?'active-today':'inactive';
      html+='<div class="user-card '+cardClass+'">';
      html+='<div class="card-header">';
      html+='<div class="avatar">'+esc(initials(s.name))+'</div>';
      html+='<div><div class="card-name">'+esc(s.name)+'</div><div class="card-email">'+esc(s.email)+'</div></div>';
      html+='<div style="margin-left:auto">'+badge(s.lastActivity)+'</div>';
      html+='</div>';
      html+='<div class="metrics">';
      html+='<div class="metric"><div class="metric-num">'+s.contacts.total+'</div>';
      if(s.contacts.today>0)html+='<div class="metric-today">+'+s.contacts.today+' today</div>';
      html+='<div class="metric-label">Contacts</div></div>';
      html+='<div class="metric"><div class="metric-num">'+s.opportunities.total+'</div>';
      if(s.opportunities.today>0)html+='<div class="metric-today">+'+s.opportunities.today+' today</div>';
      html+='<div class="metric-label">Opportunities</div></div>';
      html+='<div class="metric"><div class="metric-num">'+s.conversations.total+'</div>';
      if(s.conversations.today>0)html+='<div class="metric-today">+'+s.conversations.today+' today</div>';
      html+='<div class="metric-label">Conversations</div></div>';
      html+='</div>';
      html+='<div class="last-seen">⏱ Last activity: <strong>'+timeSince(s.lastActivity)+'</strong></div>';
      html+='</div>';
    });
    html+='</div>';
    out.innerHTML=html;
  }catch(e){
    out.innerHTML='<div class="loading" style="color:#dc2626">Error: '+esc(e.message)+'</div>';
  }
}

async function loadAccounts(){
  var out=document.getElementById('accounts-output');
  try{
    var res=await fetch('/accounts');
    var data=await res.json();
    var accounts=data.locations||data.data||[];
    if(!accounts.length){out.innerHTML='<div class="loading">No accounts found.</div>';return;}
    var html='<table><thead><tr><th>Account</th><th>Email</th><th>Last Updated</th><th>Status</th></tr></thead><tbody>';
    accounts.forEach(function(a){
      var name=a.name||a.businessName||'—';
      html+='<tr><td>'+esc(name)+'</td><td>'+esc(a.email||'—')+'</td><td>'+timeSince(a.updatedAt)+'</td><td>'+badge(a.updatedAt)+'</td></tr>';
    });
    html+='</tbody></table>';
    out.innerHTML=html;
  }catch(e){
    out.innerHTML='<div class="loading" style="color:#dc2626">Error: '+esc(e.message)+'</div>';
  }
}

loadAll();
setInterval(loadAll,5*60*1000);
</script>
</body>
</html>`);
});

app.listen(process.env.PORT || 3000, function(){
  console.log("MAYBEL Tracker running on port "+(process.env.PORT||3000));
});
