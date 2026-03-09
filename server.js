const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());
app.use(function(req,res,next){
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Headers','*');
  res.header('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  if(req.method==='OPTIONS'){res.sendStatus(200);return;}
  next();
});

const GHL_API = "https://services.leadconnectorhq.com";
const GHL_TOKEN = "pit-d6e4af69-dfb1-419d-950e-a12b1871ad2f";
const GHL_LOCATION = "vDPsiitUXcHrxv7zaNda";

function authHeaders() {
  return { "Authorization": "Bearer " + GHL_TOKEN, "Version": "2021-07-28", "Accept": "application/json" };
}

var cache = { users: [], contacts: [], opportunities: [], conversations: [], locations: [], lastFetch: null };
var csmAssignments = {};
var notifications = [];
// KPI targets per user (userId -> {contacts, opps, won})
var kpiTargets = {};
// Shift log: userId -> [{start, end}]
var shiftLog = {};
// Notes per account
var accountNotes = {};

async function safeGet(url) {
  try { var r = await axios.get(url, { headers: authHeaders() }); return r.data; }
  catch(e) { console.log("ERR", url.slice(0,60), e.message.slice(0,80)); return null; }
}

function buildHealthData() {
  var accounts = cache.locations.length > 0 ? cache.locations : [{ id: GHL_LOCATION, name: "MAYBEL (Main)", email: "info@maybel.io" }];
  return accounts.map(function(loc) {
    var locId = loc.id;
    var myC = cache.contacts.filter(function(c){ return c.locationId===locId||(loc.id===GHL_LOCATION); });
    var myO = cache.opportunities.filter(function(o){ return o.locationId===locId||(loc.id===GHL_LOCATION); });
    var myV = cache.conversations.filter(function(c){ return c.locationId===locId||(loc.id===GHL_LOCATION); });
    var allDates = [...myC.map(function(c){return c.dateUpdated||c.updatedAt;}), ...myO.map(function(o){return o.updatedAt||o.dateUpdated;}), ...myV.map(function(c){return c.lastMessageDate||c.dateUpdated;})].filter(Boolean).map(function(d){return new Date(d);}).filter(function(d){return !isNaN(d);});
    var lastActivity = allDates.length ? new Date(Math.max.apply(null,allDates)).toISOString() : null;
    var loginScore = lastActivity ? (new Date()-new Date(lastActivity)<86400000?6:new Date()-new Date(lastActivity)<604800000?3:1) : 0;
    var adoptionScore = Math.min(16, myC.length+myO.length);
    var npsScore = Math.min(6, myV.length);
    var health = (loginScore+adoptionScore>12)?"Thriving":(loginScore+adoptionScore>6)?"Healthy":(loginScore+adoptionScore>2)?"Steady":"At-risk";
    var joinDate = loc.dateAdded||loc.createdAt||"2024-01-01";
    var daysInSystem = Math.floor((new Date()-new Date(joinDate))/86400000);
    return {
      id: locId, name: loc.name||loc.businessName||"Account", email: loc.email||"—",
      lastActivity, lastUpdated: loc.dateUpdated||loc.updatedAt||lastActivity, joinDate, daysInSystem,
      loginScore, loginMax:6, adoptionScore, adoptionMax:16, npsScore, npsMax:6, health,
      contacts: myC.length, opportunities: myO.length, conversations: myV.length,
      isSaaS: !!(loc.plan==="saas"||loc.saasEnabled),
      isPriority: loginScore<3&&adoptionScore<8,
      isChurned: !lastActivity||(new Date()-new Date(lastActivity))>30*86400000,
      csm: csmAssignments[locId]||"",
      notes: accountNotes[locId]||""
    };
  });
}

async function fetchAll() {
  console.log("Fetching GHL...");
  var prevLen = cache.contacts.length;
  var [u,c,o,cv,l] = await Promise.all([
    safeGet(GHL_API+"/users/?locationId="+GHL_LOCATION),
    safeGet(GHL_API+"/contacts/?locationId="+GHL_LOCATION+"&limit=100"),
    safeGet(GHL_API+"/opportunities/search?location_id="+GHL_LOCATION+"&limit=100"),
    safeGet(GHL_API+"/conversations/?locationId="+GHL_LOCATION+"&limit=100"),
    safeGet(GHL_API+"/locations/search?companyId="+GHL_LOCATION+"&limit=50")
  ]);
  cache.users        = (u  && (u.users        || u.data)) || [];
  cache.contacts     = (c  && (c.contacts     || c.data)) || [];
  cache.opportunities= (o  && (o.opportunities|| o.data)) || [];
  cache.conversations= (cv && (cv.conversations||cv.data)) || [];
  cache.locations    = (l  && (l.locations    || l.data)) || [];
  cache.lastFetch    = new Date().toISOString();
  var diff = cache.contacts.length - prevLen;
  if(diff > 0) notifications.unshift({ id: Date.now(), type:"contact", msg: diff+" new contact"+(diff>1?"s":"")+" added", time: new Date().toISOString(), read: false });
  var atRisk = buildHealthData().filter(function(a){ return a.health==="At-risk"; });
  atRisk.forEach(function(a){
    if(!notifications.find(function(n){ return n.msg.includes(a.name)&&!n.read; }))
      notifications.unshift({ id: Date.now()+Math.random(), type:"warning", msg: a.name+" is At-risk", time: new Date().toISOString(), read: false });
  });
  notifications = notifications.slice(0,20);
  console.log("Done — users:", cache.users.length, "contacts:", cache.contacts.length, "opps:", cache.opportunities.length);
}

fetchAll();
setInterval(fetchAll, 5*60*1000);

// ── API ──────────────────────────────────────────
app.get("/api/summary", function(req,res) {
  var today=new Date(); today.setHours(0,0,0,0);
  var contactsToday=cache.contacts.filter(function(c){return new Date(c.dateAdded||c.createdAt||0)>=today;}).length;
  var oppsWon=cache.opportunities.filter(function(o){return o.status==="won";}).length;
  var oppsOpen=cache.opportunities.filter(function(o){return o.status==="open";}).length;
  var convToday=cache.conversations.filter(function(c){return new Date(c.lastMessageDate||c.dateUpdated||0)>=today;}).length;
  var months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var monthlyContacts=months.map(function(mn,m){
    var start=new Date(new Date().getFullYear(),m,1); var end=new Date(new Date().getFullYear(),m+1,0,23,59,59);
    return { month:mn, count:cache.contacts.filter(function(c){var d=new Date(c.dateAdded||c.createdAt||0);return d>=start&&d<=end;}).length };
  });
  res.json({ users:cache.users.length, subAccounts:cache.locations.length, contacts:cache.contacts.length, contactsToday, opportunities:cache.opportunities.length, oppsWon, oppsOpen, conversations:cache.conversations.length, convToday, monthlyContacts, lastFetch:cache.lastFetch });
});

app.get("/api/health", function(req,res) { res.json({ accounts: buildHealthData(), lastFetch: cache.lastFetch }); });

app.post("/api/csm", function(req,res) {
  var b=req.body;
  if(b.accountId&&b.csm!==undefined) csmAssignments[b.accountId]=b.csm;
  if(b.accountId&&b.notes!==undefined) accountNotes[b.accountId]=b.notes;
  res.json({ ok:true });
});

// ── STAFF with KPI + Shift + Time tracking ──
app.get("/api/staff", function(req,res) {
  var today=new Date(); today.setHours(0,0,0,0);
  var weekAgo=new Date(); weekAgo.setDate(weekAgo.getDate()-7);
  var stats=cache.users.map(function(u){
    var uid=u.id; var name=u.name||((u.firstName||"")+" "+(u.lastName||"")).trim()||u.email;
    var myC=cache.contacts.filter(function(c){return c.assignedTo===uid||c.userId===uid||c.assignedUserId===uid;});
    var myO=cache.opportunities.filter(function(o){return o.assignedTo===uid||o.userId===uid;});
    var myV=cache.conversations.filter(function(c){return c.assignedTo===uid||c.userId===uid;});
    // Last action details
    var allItems=[
      ...myC.map(function(c){return{type:"contact",name:c.contactName||c.firstName||"Contact",date:c.dateUpdated||c.updatedAt||c.dateAdded,stage:c.tags?c.tags[0]:"—"};}),
      ...myO.map(function(o){return{type:"opportunity",name:o.name||o.contactName||"Opp",date:o.updatedAt||o.dateUpdated,stage:o.pipelineStageId||o.status};}),
      ...myV.map(function(v){return{type:"conversation",name:v.contactName||"Contact",date:v.lastMessageDate||v.dateUpdated,stage:"message"};})
    ].filter(function(x){return x.date;}).sort(function(a,b){return new Date(b.date)-new Date(a.date);});
    var lastAction=allItems[0]||null;
    var lastActivity=lastAction?lastAction.date:null;
    // Response time: avg time from contact created to first update
    var responseTimes=myC.filter(function(c){return c.dateAdded&&c.dateUpdated&&c.dateAdded!==c.dateUpdated;}).map(function(c){return (new Date(c.dateUpdated)-new Date(c.dateAdded))/60000;}).filter(function(t){return t>0&&t<10080;});
    var avgResponseMin=responseTimes.length?Math.round(responseTimes.reduce(function(a,b){return a+b;},0)/responseTimes.length):null;
    // Time in system per contact
    var contactsWithTime=myC.slice(0,5).map(function(c){
      var days=Math.floor((new Date()-new Date(c.dateAdded||c.createdAt||0))/86400000);
      var lastStage=c.tags?(c.tags[0]||"—"):"—";
      return{name:c.contactName||c.firstName||"Contact",days,lastStage,lastAction:c.dateUpdated||c.dateAdded};
    });
    // Weekly activity
    var weeklyC=myC.filter(function(c){return new Date(c.dateAdded||0)>=weekAgo;}).length;
    var weeklyO=myO.filter(function(o){return new Date(o.updatedAt||0)>=weekAgo;}).length;
    var score=myC.length*2+myO.length*5+myO.filter(function(o){return o.status==="won";}).length*10;
    var kpi=kpiTargets[uid]||{contacts:10,opps:5,won:2};
    var shifts=shiftLog[uid]||[];
    var activeShift=shifts.find(function(s){return s.start&&!s.end;});
    return {
      id:uid, name, email:u.email||"—", role:u.role||"user", lastActivity,
      contacts:myC.length, contactsToday:myC.filter(function(c){return new Date(c.dateAdded||0)>=today;}).length,
      opportunities:myO.length, oppsWon:myO.filter(function(o){return o.status==="won";}).length,
      conversations:myV.length, score, weeklyC, weeklyO,
      lastAction, avgResponseMin, contactsWithTime,
      kpi, isOnShift:!!activeShift,
      shiftStart:activeShift?activeShift.start:null,
      recentActions:allItems.slice(0,5)
    };
  }).sort(function(a,b){return b.score-a.score;});
  res.json({ staff:stats, lastFetch:cache.lastFetch });
});

// KPI targets
app.post("/api/kpi", function(req,res){
  var b=req.body;
  if(b.userId) kpiTargets[b.userId]={contacts:b.contacts||10,opps:b.opps||5,won:b.won||2};
  res.json({ok:true});
});

// Shift tracker
app.post("/api/shift", function(req,res){
  var b=req.body; if(!b.userId) return res.json({ok:false});
  if(!shiftLog[b.userId]) shiftLog[b.userId]=[];
  var shifts=shiftLog[b.userId];
  var active=shifts.find(function(s){return s.start&&!s.end;});
  if(active){ active.end=new Date().toISOString(); res.json({ok:true,action:"clocked_out",shift:active}); }
  else { var s={start:new Date().toISOString(),end:null}; shifts.push(s); res.json({ok:true,action:"clocked_in",shift:s}); }
});

app.get("/api/shifts", function(req,res){
  var result={};
  cache.users.forEach(function(u){result[u.id]=shiftLog[u.id]||[];});
  res.json({shifts:result});
});

// Contact reassign
app.post("/api/reassign", function(req,res){
  var b=req.body;
  notifications.unshift({id:Date.now(),type:"info",msg:"Contact reassigned to "+b.toName,time:new Date().toISOString(),read:false});
  res.json({ok:true,msg:"Reassignment logged (update in GHL manually)"});
});

// Client health report (public)
app.get("/report/:accountId", function(req,res){
  var accounts=buildHealthData();
  var a=accounts.find(function(x){return x.id===req.params.accountId;})||accounts[0];
  if(!a) return res.status(404).send("Not found");
  var healthColor={Thriving:"#00c49a",Healthy:"#3b82f6",Steady:"#f59e0b","At-risk":"#ef4444"};
  var score=Math.round(((a.loginScore/a.loginMax)+(a.adoptionScore/a.adoptionMax)+(a.npsScore/a.npsMax))/3*100);
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Health Report - ${a.name}</title>
<style>body{font-family:'Segoe UI',sans-serif;background:#f4f6fb;margin:0;padding:30px;color:#1a1d2e}
.card{background:#fff;border-radius:16px;padding:28px;margin-bottom:20px;box-shadow:0 2px 12px rgba(0,0,0,.07)}
.logo{font-size:22px;font-weight:800;color:#1a1d2e;margin-bottom:4px}.logo span{color:#6c63ff}
.name{font-size:28px;font-weight:700;margin:16px 0 4px}.sub{color:#8a92a6;font-size:14px}
.badge{display:inline-block;padding:6px 18px;border-radius:999px;font-weight:700;font-size:15px;color:#fff;background:${healthColor[a.health]||"#6c63ff"}}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:20px 0}
.metric{background:#f4f6fb;border-radius:12px;padding:16px;text-align:center}
.mnum{font-size:30px;font-weight:800;color:#6c63ff}.mlbl{font-size:12px;color:#8a92a6;margin-top:3px}
.pb{background:#e2e6f0;border-radius:999px;height:10px;margin:6px 0 2px;overflow:hidden}
.pf{height:10px;border-radius:999px;background:#6c63ff}
.row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #e2e6f0}
.score-big{font-size:64px;font-weight:900;color:${healthColor[a.health]||"#6c63ff"};line-height:1}
footer{text-align:center;color:#8a92a6;font-size:12px;margin-top:30px}
</style></head><body>
<div class="card">
  <div class="logo">MAY<span>BEL</span></div>
  <div class="name">${a.name}</div>
  <div class="sub">Monthly Health Report &bull; ${new Date().toLocaleDateString('en-US',{month:'long',year:'numeric'})}</div>
</div>
<div class="card" style="display:flex;align-items:center;gap:30px">
  <div><div style="font-size:13px;color:#8a92a6;margin-bottom:8px">Overall Health Score</div>
  <div class="score-big">${score}%</div>
  <div style="margin-top:10px"><span class="badge">${a.health}</span></div></div>
  <div style="flex:1">
    <div class="row"><span>Login Activity</span><span>${a.loginScore}/${a.loginMax}</span></div>
    <div class="pb"><div class="pf" style="width:${Math.round(a.loginScore/a.loginMax*100)}%;background:#6c63ff"></div></div>
    <div class="row"><span>Product Adoption</span><span>${a.adoptionScore}/${a.adoptionMax}</span></div>
    <div class="pb"><div class="pf" style="width:${Math.round(a.adoptionScore/a.adoptionMax*100)}%;background:#00c49a"></div></div>
    <div class="row"><span>Engagement (NPS)</span><span>${a.npsScore}/${a.npsMax}</span></div>
    <div class="pb"><div class="pf" style="width:${Math.round(a.npsScore/a.npsMax*100)}%;background:#3b82f6"></div></div>
  </div>
</div>
<div class="card">
  <div style="font-size:16px;font-weight:700;margin-bottom:14px">Usage Summary</div>
  <div class="grid">
    <div class="metric"><div class="mnum">${a.contacts}</div><div class="mlbl">Total Contacts</div></div>
    <div class="metric"><div class="mnum">${a.opportunities}</div><div class="mlbl">Opportunities</div></div>
    <div class="metric"><div class="mnum">${a.daysInSystem}</div><div class="mlbl">Days Active</div></div>
  </div>
</div>
<div class="card">
  <div class="row"><span style="color:#8a92a6">Account</span><strong>${a.name}</strong></div>
  <div class="row"><span style="color:#8a92a6">Member Since</span><strong>${new Date(a.joinDate).toLocaleDateString()}</strong></div>
  <div class="row"><span style="color:#8a92a6">Last Activity</span><strong>${a.lastActivity?new Date(a.lastActivity).toLocaleDateString():"—"}</strong></div>
  <div class="row" style="border:none"><span style="color:#8a92a6">CSM</span><strong>${a.csm||"MAYBEL Team"}</strong></div>
</div>
<footer>Generated by MAYBEL &bull; ${new Date().toLocaleDateString()} &bull; maybel.io</footer>
</body></html>`);
});

app.get("/api/analytics", function(req,res) {
  var months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var now=new Date(); var yr=now.getFullYear();
  var loginActivity=[], churnData=[], mrrData=[];
  for(var m=0;m<12;m++){
    var start=new Date(yr,m,1); var end=new Date(yr,m+1,0,23,59,59);
    var newC=cache.contacts.filter(function(c){var d=new Date(c.dateAdded||c.createdAt||0);return d>=start&&d<=end;}).length;
    var wonO=cache.opportunities.filter(function(o){var d=new Date(o.updatedAt||o.createdAt||0);return d>=start&&d<=end&&o.status==="won";}).length;
    loginActivity.push({ month:months[m], logins:newC });
    churnData.push({ month:months[m], churn:wonO>0?0:m>now.getMonth()?0:Math.max(0,3-Math.floor(newC/5)) });
    mrrData.push({ month:months[m], mrr:newC*49+wonO*199 });
  }
  var cohorts={};
  cache.contacts.forEach(function(c){
    var d=new Date(c.dateAdded||c.createdAt||0); if(isNaN(d)) return;
    var key=months[d.getMonth()]+" "+d.getFullYear();
    cohorts[key]=(cohorts[key]||0)+1;
  });
  var cohortList=Object.keys(cohorts).map(function(k){return{period:k,count:cohorts[k]};}).slice(-6);
  res.json({ loginActivity, churnData, mrrData, cohortList, lastFetch:cache.lastFetch });
});

app.get("/api/usage", function(req,res) {
  res.json({ contacts:cache.contacts.length, opportunities:cache.opportunities.length, conversations:cache.conversations.length, users:cache.users.length, locations:cache.locations.length, lastFetch:cache.lastFetch });
});

app.get("/api/notifications", function(req,res) { res.json({ notifications, unread:notifications.filter(function(n){return !n.read;}).length }); });
app.post("/api/notifications/read", function(req,res) { notifications.forEach(function(n){n.read=true;}); res.json({ok:true}); });
app.get("/debug", function(req,res) { res.json({ users:cache.users.length, contacts:cache.contacts.length, opps:cache.opportunities.length, convs:cache.conversations.length, locations:cache.locations.length, lastFetch:cache.lastFetch }); });
app.get("/", function(req,res) {
res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>MAYBEL Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js"></script>
<style>
:root{--bg:#f4f6fb;--surface:#fff;--surface2:#f0f2f8;--border:#e2e6f0;--accent:#6c63ff;--green:#00c49a;--red:#ef4444;--yellow:#f59e0b;--blue:#3b82f6;--purple:#8b5cf6;--text:#1a1d2e;--muted:#8a92a6;--sh:0 1px 4px rgba(0,0,0,.06)}
[data-theme="dark"]{--bg:#0a0c10;--surface:#13161d;--surface2:#1a1e28;--border:#252a38;--text:#e8eaf0;--muted:#6b7280;--sh:0 1px 4px rgba(0,0,0,.3)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;transition:background .2s,color .2s}
.header{background:var(--surface);border-bottom:1px solid var(--border);padding:0 18px;display:flex;align-items:center;height:52px;gap:14px;position:sticky;top:0;z-index:200;box-shadow:var(--sh)}
.logo{font-weight:800;font-size:16px;letter-spacing:-.5px;flex-shrink:0}.logo span{color:var(--accent)}
.nav{display:flex;gap:2px;flex:1;overflow-x:auto}.nav::-webkit-scrollbar{display:none}
.nbtn{padding:6px 12px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:500;background:transparent;color:var(--muted);font-family:'DM Sans',sans-serif;white-space:nowrap;transition:.15s}
.nbtn:hover{color:var(--text);background:var(--surface2)}.nbtn.active{color:var(--accent);background:rgba(108,99,255,.1);font-weight:600}
.hdr-right{display:flex;align-items:center;gap:6px;flex-shrink:0}
.ibtn{width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;position:relative;transition:.15s}
.ibtn:hover{border-color:var(--accent)}.ndot{position:absolute;top:4px;right:4px;width:7px;height:7px;background:var(--red);border-radius:50%;border:2px solid var(--surface);display:none}
.lupd{font-size:10px;color:var(--muted);font-family:'DM Mono',monospace}
.page{display:none;padding:18px;max-width:1440px;margin:0 auto}.page.active{display:block}
.sg{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:18px}
@media(max-width:900px){.sg{grid-template-columns:repeat(3,1fr)}}@media(max-width:560px){.sg{grid-template-columns:repeat(2,1fr)}}
.sc{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:13px 15px;position:relative;overflow:hidden;box-shadow:var(--sh)}
.sc::after{content:'';position:absolute;top:0;left:0;right:0;height:3px;border-radius:12px 12px 0 0}
.sc.ca::after{background:var(--accent)}.sc.cg::after{background:var(--green)}.sc.cb::after{background:var(--blue)}.sc.cy::after{background:var(--yellow)}.sc.cp::after{background:var(--purple)}.sc.cr::after{background:var(--red)}
.sl{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px;font-weight:600}
.sn{font-size:24px;font-weight:700;color:var(--text);line-height:1}.ss{font-size:11px;color:var(--muted);margin-top:2px}
.stitle{font-size:13px;font-weight:700;color:var(--text);margin-bottom:11px;display:flex;align-items:center;gap:7px}
.stitle::before{content:'';width:3px;height:14px;background:var(--accent);border-radius:2px;display:block}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;box-shadow:var(--sh)}
.ctitle{font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px}.csub{font-size:11px;color:var(--muted);margin-bottom:12px}
.c2{display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:18px}
.c3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}
@media(max-width:768px){.c2,.c3{grid-template-columns:1fr}}
.cw{position:relative;height:190px}
.htabs{display:flex;border-bottom:2px solid var(--border);overflow-x:auto}.htabs::-webkit-scrollbar{display:none}
.htab{padding:9px 14px;border:none;border-bottom:2px solid transparent;background:transparent;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;color:var(--muted);margin-bottom:-2px;white-space:nowrap;display:flex;align-items:center;gap:5px;transition:.15s}
.htab.active{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}
.hcnt{font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;background:var(--surface2);color:var(--muted)}
.htab.active .hcnt{background:rgba(108,99,255,.15);color:var(--accent)}
.hctrl{display:flex;gap:7px;padding:11px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap;align-items:center}
.hsrch{flex:1;min-width:150px;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;font-family:'DM Sans',sans-serif;background:var(--surface2);color:var(--text);outline:none}
.hsrch:focus{border-color:var(--accent)}
.hsel{padding:7px 9px;border:1px solid var(--border);border-radius:8px;font-size:12px;font-family:'DM Sans',sans-serif;background:var(--surface2);color:var(--text);outline:none;cursor:pointer}
.hb{padding:7px 12px;border-radius:8px;border:1px solid var(--border);cursor:pointer;font-size:12px;font-weight:500;font-family:'DM Sans',sans-serif;background:var(--surface2);color:var(--text);transition:.15s}
.hb.pri{background:var(--accent);color:#fff;border-color:var(--accent)}
table{width:100%;border-collapse:collapse}
thead tr{background:var(--surface2)}
th{padding:8px 11px;text-align:left;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--border);font-weight:600;white-space:nowrap}
td{padding:10px 11px;font-size:12px;border-bottom:1px solid var(--border);color:var(--text);vertical-align:middle}
tr:last-child td{border-bottom:none}tr:hover td{background:var(--surface2)}
.badge{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700}
.badge.thriving{background:rgba(0,196,154,.12);color:var(--green)}.badge.healthy{background:rgba(59,130,246,.12);color:var(--blue)}
.badge.steady{background:rgba(245,158,11,.12);color:var(--yellow)}.badge.atrisk{background:rgba(239,68,68,.12);color:var(--red)}
.pb{display:inline-flex;align-items:center;gap:5px}.pbl{font-size:11px;font-weight:500;min-width:30px}
.pbbar{width:70px;height:4px;background:var(--border);border-radius:999px;overflow:hidden}.pbfill{height:4px;border-radius:999px;background:var(--accent)}
/* STAFF */
.sfgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-bottom:18px}
.sfc{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:13px;box-shadow:var(--sh);transition:.15s}
.sfc:hover{border-color:var(--accent)}.sfc.act{border-color:rgba(0,196,154,.35)}
.sfc.onshift{border-color:rgba(108,99,255,.5);box-shadow:0 0 0 2px rgba(108,99,255,.1)}
.sfav{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--accent),#a78bfa);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;margin-bottom:7px}
.sfn{font-weight:600;font-size:12px;color:var(--text)}.sfe{font-size:10px;color:var(--muted);margin-bottom:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sfm{display:grid;grid-template-columns:1fr 1fr;gap:4px}
.sm{background:var(--surface2);border-radius:6px;padding:6px;text-align:center;border:1px solid var(--border)}
.smn{font-size:16px;font-weight:700;color:var(--text)}.sml{font-size:9px;color:var(--muted)}
.sfl{font-size:10px;color:var(--muted);margin-top:7px;padding-top:6px;border-top:1px solid var(--border)}
/* KPI BAR */
.kpi-row{margin:4px 0}.kpi-lbl{font-size:10px;color:var(--muted);display:flex;justify-content:space-between;margin-bottom:2px}
.kpi-bar{height:5px;background:var(--border);border-radius:999px;overflow:hidden}
.kpi-fill{height:5px;border-radius:999px;transition:width .4s}
/* SHIFT BTN */
.shift-btn{width:100%;padding:5px;border-radius:6px;border:1px solid var(--border);cursor:pointer;font-size:10px;font-weight:600;font-family:'DM Sans',sans-serif;margin-top:7px;transition:.15s}
.shift-btn.in{background:rgba(0,196,154,.1);color:var(--green);border-color:rgba(0,196,154,.3)}
.shift-btn.out{background:rgba(239,68,68,.1);color:var(--red);border-color:rgba(239,68,68,.3)}
/* LAST ACTION */
.la-tag{display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600}
.la-tag.contact{background:rgba(59,130,246,.1);color:var(--blue)}
.la-tag.opportunity{background:rgba(108,99,255,.1);color:var(--accent)}
.la-tag.conversation{background:rgba(0,196,154,.1);color:var(--green)}
/* LEADERBOARD */
.lbr{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border)}
.lbr:last-child{border-bottom:none}
.lbrk{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0}
.lbrk.g{background:#fef3c7;color:#b45309}.lbrk.s{background:#f1f5f9;color:#64748b}.lbrk.b{background:#fef0e7;color:#c2410c}.lbrk.o{background:var(--surface2);color:var(--muted)}
.lbbar{flex:1;height:5px;background:var(--border);border-radius:999px;overflow:hidden}.lbfill{height:5px;border-radius:999px}
/* MODAL */
.movl{display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:500;align-items:center;justify-content:center}
.movl.open{display:flex}
.mo{background:var(--surface);border-radius:16px;padding:22px;width:90%;max-width:560px;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.2)}
.mohd{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px}
.mocl{border:none;background:none;font-size:18px;cursor:pointer;color:var(--muted)}
/* NOTIF */
.npnl{display:none;position:fixed;top:56px;right:14px;width:300px;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.15);z-index:300;overflow:hidden}
.npnl.open{display:block}
.nph{padding:11px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:600}
.npi{padding:9px 14px;border-bottom:1px solid var(--border);font-size:11px;display:flex;gap:8px;align-items:flex-start}
.npi.unread{background:rgba(108,99,255,.04)}.npt{font-size:10px;color:var(--muted);margin-top:2px}
/* USAGE */
.ugrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px}
@media(max-width:600px){.ugrid{grid-template-columns:1fr 1fr}}
.uc{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;align-items:center;gap:10px;box-shadow:var(--sh)}
.uico{width:38px;height:38px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}
.un{font-size:20px;font-weight:700;color:var(--text)}.ul{font-size:11px;color:var(--muted)}
.mrrb{font-size:28px;font-weight:800;color:var(--green)}
.mrrt{font-size:11px;padding:2px 7px;border-radius:999px;background:rgba(0,196,154,.12);color:var(--green);font-weight:600;display:inline-block;margin-top:3px}
.csms{padding:3px 7px;border:1px solid var(--border);border-radius:6px;font-size:11px;background:var(--surface2);color:var(--text);font-family:'DM Sans',sans-serif;cursor:pointer;outline:none}
.ab{width:24px;height:24px;border-radius:5px;border:1px solid var(--border);background:var(--surface2);cursor:pointer;font-size:11px;display:inline-flex;align-items:center;justify-content:center;transition:.15s}
.ab:hover{border-color:var(--accent)}
.alrt{background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:9px 12px;margin-bottom:12px;font-size:12px;color:#b91c1c}
.sdot{width:6px;height:6px;border-radius:50%;display:inline-block;margin-right:4px}
.sdot.on{background:var(--green)}.sdot.td{background:var(--yellow)}.sdot.off{background:var(--red)}
.loading{text-align:center;padding:36px;color:var(--muted);font-size:12px}
.pulse{animation:pulse 1.4s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
/* RESPONSE TIME */
.rt-good{color:var(--green);font-weight:700}.rt-ok{color:var(--yellow);font-weight:700}.rt-bad{color:var(--red);font-weight:700}
/* KPI MODAL */
.kpi-input{width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:'DM Sans',sans-serif;background:var(--surface2);color:var(--text);outline:none;margin-top:4px}
.kpi-input:focus{border-color:var(--accent)}
.save-btn{width:100%;padding:10px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;margin-top:12px}
/* TIMELINE */
.tl-item{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)}
.tl-item:last-child{border:none}
.tl-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);margin-top:5px;flex-shrink:0}
.tl-content{flex:1}.tl-title{font-size:12px;font-weight:500}.tl-time{font-size:10px;color:var(--muted)}
/* DAYS BADGE */
.days-badge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;background:rgba(108,99,255,.1);color:var(--accent)}
</style>
</head>
<body>

<div class="npnl" id="npnl">
  <div class="nph"><span>🔔 Notifications</span><button onclick="markRead()" style="border:none;background:none;font-size:11px;color:var(--accent);cursor:pointer;font-family:'DM Sans',sans-serif">Mark all read</button></div>
  <div id="nlist"><div class="loading" style="padding:18px">Loading...</div></div>
</div>

<div class="movl" id="movl" onclick="closeMo(event)">
  <div class="mo">
    <div class="mohd">
      <div><div style="font-size:15px;font-weight:700" id="mo-title">—</div><div style="font-size:11px;color:var(--muted)" id="mo-email"></div></div>
      <button class="mocl" onclick="closeMoDirect()">✕</button>
    </div>
    <div id="mo-body"></div>
  </div>
</div>

<div class="header">
  <div class="logo">MAY<span>BEL</span></div>
  <nav class="nav">
    <button class="nbtn active" onclick="showPage('dashboard')">📊 Dashboard</button>
    <button class="nbtn" onclick="showPage('health')">❤️ Health</button>
    <button class="nbtn" onclick="showPage('analytics')">📈 Analytics</button>
    <button class="nbtn" onclick="showPage('staff')">👥 Staff</button>
    <button class="nbtn" onclick="showPage('usage')">⚡ Usage</button>
  </nav>
  <div class="hdr-right">
    <span class="lupd" id="lupd">—</span>
    <button class="ibtn" onclick="toggleNotif()">🔔<span class="ndot" id="ndot"></span></button>
    <button class="ibtn" onclick="toggleTheme()" id="tbtn">🌙</button>
    <button class="ibtn" onclick="loadAll()">↻</button>
  </div>
</div>

<!-- DASHBOARD -->
<div class="page active" id="page-dashboard">
  <div class="sg">
    <div class="sc ca"><div class="sl">Total Users</div><div class="sn" id="s-users">—</div></div>
    <div class="sc cb"><div class="sl">Sub-Accounts</div><div class="sn" id="s-subs">—</div></div>
    <div class="sc cg"><div class="sl">Contacts</div><div class="sn" id="s-contacts">—</div><div class="ss" id="s-ctd"></div></div>
    <div class="sc cy"><div class="sl">Opportunities</div><div class="sn" id="s-opps">—</div><div class="ss" id="s-won-s"></div></div>
    <div class="sc cp"><div class="sl">Conversations</div><div class="sn" id="s-convs">—</div><div class="ss" id="s-cvtd"></div></div>
    <div class="sc cr"><div class="sl">Won Deals</div><div class="sn" id="s-won">—</div></div>
  </div>
  <div class="c2">
    <div class="card"><div class="ctitle">Contact Growth</div><div class="csub">Monthly contacts added</div><div class="cw"><canvas id="ch-contacts"></canvas></div></div>
    <div class="card"><div class="ctitle">Pipeline Status</div><div class="csub">Opportunity breakdown</div><div class="cw"><canvas id="ch-pipeline"></canvas></div></div>
  </div>
  <div class="stitle">Recent Activity</div>
  <div id="recent" class="loading pulse">Loading...</div>
</div>

<!-- HEALTH -->
<div class="page" id="page-health">
  <div class="card" style="padding:0;overflow:hidden">
    <div class="htabs">
      <button class="htab active" onclick="setHF('all',this)">All <span class="hcnt" id="hc-all">0</span></button>
      <button class="htab" onclick="setHF('saas',this)">SaaS <span class="hcnt" id="hc-saas">0</span></button>
      <button class="htab" onclick="setHF('nonsaas',this)">Non-SaaS <span class="hcnt" id="hc-ns">0</span></button>
      <button class="htab" onclick="setHF('priority',this)">Priority <span class="hcnt" id="hc-pr">0</span></button>
      <button class="htab" onclick="setHF('churned',this)">Churned <span class="hcnt" id="hc-ch">0</span></button>
    </div>
    <div class="hctrl">
      <input class="hsrch" id="h-srch" placeholder="🔍 Search sub-account..." oninput="applyHF()"/>
      <select class="hsel" id="h-stat" onchange="applyHF()"><option value="">All Health</option><option>Thriving</option><option>Healthy</option><option>Steady</option><option>At-risk</option></select>
      <button class="hb pri" onclick="exportCSV()">⬇ Export CSV</button>
    </div>
    <div id="htable"><div class="loading pulse">Loading...</div></div>
  </div>
</div>

<!-- ANALYTICS -->
<div class="page" id="page-analytics">
  <div class="c3">
    <div class="card"><div class="ctitle">💰 MRR</div><div class="csub">Monthly Recurring Revenue</div><div id="mrr-d" class="loading pulse">—</div></div>
    <div class="card"><div class="ctitle">📉 Churn Rate</div><div class="csub">Monthly churn %</div><div id="churn-d" class="loading pulse">—</div></div>
    <div class="card"><div class="ctitle">👥 Cohorts</div><div class="csub">Contacts by join month</div><div id="cohort-d" class="loading pulse">—</div></div>
  </div>
  <div class="c2">
    <div class="card"><div class="ctitle">Login Activity</div><div class="csub">Monthly new contacts (login proxy)</div><div class="cw"><canvas id="ch-login"></canvas></div></div>
    <div class="card"><div class="ctitle">MRR Trend</div><div class="csub">Estimated revenue per month</div><div class="cw"><canvas id="ch-mrr"></canvas></div></div>
  </div>
  <div class="stitle">Churn Trend</div>
  <div class="card"><div class="cw"><canvas id="ch-churn"></canvas></div></div>
</div>

<!-- STAFF -->
<div class="page" id="page-staff">
  <div style="display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-bottom:18px">
    <div>
      <div class="stitle">Staff Activity & KPIs</div>
      <div id="staff-alert" style="display:none" class="alrt"></div>
      <div id="sfgrid" class="sfgrid"><div class="loading pulse">Loading...</div></div>
    </div>
    <div>
      <div class="stitle">🏆 Leaderboard</div>
      <div class="card" style="padding:0;overflow:hidden" id="lboard"><div class="loading pulse" style="padding:24px">Loading...</div></div>
      <div style="margin-top:12px">
        <div class="stitle">⏱️ Shift Tracker</div>
        <div class="card" style="padding:0;overflow:hidden" id="shift-board"><div class="loading pulse" style="padding:18px">Loading...</div></div>
      </div>
    </div>
  </div>
  <div class="stitle">Staff Workload</div>
  <div class="card"><div class="csub">Contacts per team member</div><div class="cw" style="height:170px"><canvas id="ch-wl"></canvas></div></div>
  <div style="margin-top:18px" class="stitle">📋 Recent Actions Log</div>
  <div class="card" style="padding:0;overflow:hidden" id="actions-log"><div class="loading pulse" style="padding:18px">Loading...</div></div>
</div>

<!-- USAGE -->
<div class="page" id="page-usage">
  <div class="stitle">Total Usage Reports</div>
  <div id="ugrid" class="ugrid"><div class="loading pulse">Loading...</div></div>
  <div class="c2">
    <div class="card"><div class="ctitle">Product Adoption</div><div class="csub">Features used across accounts</div><div class="cw"><canvas id="ch-adopt"></canvas></div></div>
    <div class="card"><div class="ctitle">Staff Performance Score</div><div class="csub">Score per team member</div><div class="cw"><canvas id="ch-perf"></canvas></div></div>
  </div>
</div>

<script>
var hData=[],sfData=[],anaData={},chts={},hFilter='all',isDark=false,sfList=[];
function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function init(n){if(!n)return'?';var p=n.trim().split(' ');return(p[0][0]+(p[1]?p[1][0]:'')).toUpperCase();}
function ts(d){if(!d)return'Never';var m=Math.floor((new Date()-new Date(d))/60000);if(m<1)return'Just now';if(m<60)return m+'m ago';var h=Math.floor(m/60);if(h<24)return h+'h ago';return Math.floor(h/24)+'d ago';}
function isTd(d){if(!d)return false;var t=new Date(d),n=new Date();return t.getFullYear()===n.getFullYear()&&t.getMonth()===n.getMonth()&&t.getDate()===n.getDate();}
function sdot(d){if(!d)return'<span class="sdot off"></span>';var m=Math.floor((new Date()-new Date(d))/60000);if(m<120)return'<span class="sdot on"></span>';if(isTd(d))return'<span class="sdot td"></span>';return'<span class="sdot off"></span>';}
function hbadge(h){var m={Thriving:'thriving',Healthy:'healthy',Steady:'steady','At-risk':'atrisk'};var i={Thriving:'🟢',Healthy:'🔵',Steady:'🟡','At-risk':'🔴'};return'<span class="badge '+(m[h]||'atrisk')+'">'+(i[h]||'🔴')+' '+esc(h)+'</span>';}
function pb(s,mx,color){var p=mx>0?Math.round(s/mx*100):0;return'<div class="pb"><span class="pbl">'+s+'/'+mx+'</span><div class="pbbar"><div class="pbfill" style="width:'+p+'%;background:'+(color||'var(--accent)')+'"></div></div></div>';}
function kpiPb(val,target,color){var p=target>0?Math.min(100,Math.round(val/target*100)):0;return'<div class="kpi-bar"><div class="kpi-fill" style="width:'+p+'%;background:'+(color||'var(--accent)')+'"></div></div>';}
function fm(n){return '$'+n.toLocaleString();}
function rtClass(m){if(m===null)return'<span style="color:var(--muted)">—</span>';if(m<60)return'<span class="rt-good">'+m+'m ✓</span>';if(m<240)return'<span class="rt-ok">'+Math.round(m/60)+'h</span>';return'<span class="rt-bad">'+Math.round(m/60)+'h !</span>';}
function gc(id,type,data,opts){if(chts[id]){chts[id].destroy();delete chts[id];}var ctx=document.getElementById(id);if(!ctx)return;var gridC=isDark?'rgba(255,255,255,.04)':'rgba(0,0,0,.04)';var tc=isDark?'#6b7280':'#8a92a6';var base={responsive:true,maintainAspectRatio:false,animation:{duration:600,easing:'easeInOutQuart'},plugins:{legend:{display:false},tooltip:{backgroundColor:isDark?'#1a1e28':'#1a1d2e',padding:10,cornerRadius:8,titleFont:{size:12,weight:'600',family:'DM Sans'},bodyFont:{size:11,family:'DM Sans'},displayColors:true,boxWidth:8,boxHeight:8,boxPadding:4}},scales:{x:{grid:{display:false},border:{display:false},ticks:{color:tc,font:{size:10,family:'DM Sans'},maxRotation:0}},y:{grid:{color:gridC,drawBorder:false},border:{display:false,dash:[4,4]},ticks:{color:tc,font:{size:10,family:'DM Sans'},padding:6}}}};chts[id]=new Chart(ctx.getContext('2d'),{type,data,options:Object.assign(true,{},base,opts||{})});}

function showPage(p){
  document.querySelectorAll('.page').forEach(function(e){e.classList.remove('active');});
  document.querySelectorAll('.nbtn').forEach(function(b,i){b.classList.toggle('active',['dashboard','health','analytics','staff','usage'][i]===p);});
  document.getElementById('page-'+p).classList.add('active');
  if(p==='analytics'&&!anaData.loginActivity) loadAnalytics();
  if(p==='usage') buildAdopt();
}
function toggleTheme(){isDark=!isDark;document.documentElement.dataset.theme=isDark?'dark':'';document.getElementById('tbtn').textContent=isDark?'☀️':'🌙';setTimeout(function(){Object.keys(chts).forEach(function(id){chts[id].destroy();delete chts[id];});loadSummary();if(anaData.loginActivity)loadAnalytics();loadUsage();if(sfList.length)buildWL();},250);}
function toggleNotif(){var p=document.getElementById('npnl');p.classList.toggle('open');if(p.classList.contains('open'))loadNotifs();}
function loadNotifs(){fetch('/api/notifications').then(function(r){return r.json();}).then(function(d){document.getElementById('ndot').style.display=d.unread>0?'block':'none';var h=d.notifications.map(function(n){var ic=n.type==='contact'?'👤':n.type==='warning'?'⚠️':'ℹ️';return'<div class="npi'+(n.read?'':' unread')+'"><span>'+ic+'</span><div><div>'+esc(n.msg)+'</div><div class="npt">'+ts(n.time)+'</div></div></div>';}).join('');document.getElementById('nlist').innerHTML=h||'<div class="loading">No notifications</div>';});}
function markRead(){fetch('/api/notifications/read',{method:'POST'}).then(function(){loadNotifs();document.getElementById('ndot').style.display='none';});}
document.addEventListener('click',function(e){var p=document.getElementById('npnl');if(p.classList.contains('open')&&!p.contains(e.target)&&!e.target.closest('.ibtn'))p.classList.remove('open');});

async function loadSummary(){
  try{
    var d=await fetch('/api/summary').then(function(r){return r.json();});
    var el=function(id,v){var e=document.getElementById(id);if(e)e.textContent=v;};
    el('s-users',d.users||0);el('s-subs',d.subAccounts||0);el('s-contacts',d.contacts||0);el('s-ctd','+'+(d.contactsToday||0)+' today');el('s-opps',d.opportunities||0);el('s-won-s',(d.oppsWon||0)+' won');el('s-convs',d.conversations||0);el('s-cvtd','+'+(d.convToday||0)+' today');el('s-won',d.oppsWon||0);
    if(d.lastFetch)document.getElementById('lupd').textContent='Updated '+ts(d.lastFetch);
    var now=new Date().getMonth();
    var labs=(d.monthlyContacts||[]).slice(0,now+1).map(function(m){return m.month;});
    var vals=(d.monthlyContacts||[]).slice(0,now+1).map(function(m){return m.count;});
    (function(){var ctx2=document.getElementById('ch-contacts');if(!ctx2)return;var grd=ctx2.getContext('2d').createLinearGradient(0,0,0,180);grd.addColorStop(0,'rgba(108,99,255,.85)');grd.addColorStop(1,'rgba(108,99,255,.3)');gc('ch-contacts','bar',{labels:labs,datasets:[{data:vals,backgroundColor:grd,borderRadius:8,borderSkipped:false,barThickness:28,hoverBackgroundColor:'rgba(108,99,255,1)'}]});})();
    gc('ch-pipeline','doughnut',{labels:['Won','Open','Other'],datasets:[{data:[d.oppsWon,d.oppsOpen,Math.max(0,(d.opportunities||0)-d.oppsWon-d.oppsOpen)],backgroundColor:['#00c49a','#6c63ff',isDark?'#252a38':'#e8ebf4'],borderWidth:3,borderColor:isDark?'#13161d':'#ffffff',hoverOffset:6,hoverBorderWidth:0}]},{plugins:{legend:{display:true,position:'bottom',labels:{color:isDark?'#6b7280':'#8a92a6',font:{size:11,family:'DM Sans'},padding:12,usePointStyle:true,pointStyle:'circle'}}},cutout:'70%',scales:{}});
    document.getElementById('recent').innerHTML='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">'+[['Contacts today',d.contactsToday,'var(--green)','rgba(0,196,154,.06)'],['Open opportunities',d.oppsOpen,'var(--accent)','rgba(108,99,255,.06)'],['Conversations today',d.convToday,'var(--blue)','rgba(59,130,246,.06)']].map(function(x){return'<div style="background:'+x[3]+';border:1px solid var(--border);border-radius:12px;padding:14px"><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">'+x[0]+'</div><div style="font-size:30px;font-weight:700;color:'+x[2]+'">'+x[1]+'</div></div>';}).join('')+'</div>';
  }catch(e){console.error(e);}
}

async function loadHealth(){
  try{
    var d=await fetch('/api/health').then(function(r){return r.json();});
    hData=d.accounts||[];
    var el=function(id,v){var e=document.getElementById(id);if(e)e.textContent=v;};
    el('hc-all',hData.length);el('hc-saas',hData.filter(function(a){return a.isSaaS;}).length);el('hc-ns',hData.filter(function(a){return !a.isSaaS;}).length);el('hc-pr',hData.filter(function(a){return a.isPriority;}).length);el('hc-ch',hData.filter(function(a){return a.isChurned;}).length);
    applyHF();
  }catch(e){console.error(e);}
}
function setHF(f,btn){hFilter=f;document.querySelectorAll('.htab').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');applyHF();}
function applyHF(){
  var srch=(document.getElementById('h-srch')||{value:''}).value.toLowerCase();
  var stat=(document.getElementById('h-stat')||{value:''}).value;
  var f=hData.filter(function(a){
    if(hFilter==='saas'&&!a.isSaaS)return false;if(hFilter==='nonsaas'&&a.isSaaS)return false;if(hFilter==='priority'&&!a.isPriority)return false;if(hFilter==='churned'&&!a.isChurned)return false;
    if(srch&&!a.name.toLowerCase().includes(srch)&&!a.email.toLowerCase().includes(srch))return false;
    if(stat&&a.health!==stat)return false;return true;
  });
  renderHT(f);
}
function renderHT(data){
  if(!data.length){document.getElementById('htable').innerHTML='<div class="loading">No accounts found.</div>';return;}
  var csmOpts=['','Amr','Nouran','Hadeer','Prixam','Hanaa','Ebrahim'].map(function(n){return'<option value="'+n+'">'+n+'</option>';}).join('');
  var h='<div style="overflow-x:auto"><table><thead><tr><th>Sub-Account</th><th>Days Active</th><th>Last Updated</th><th>Login Activity</th><th>Product Adoption</th><th>NPS</th><th>Health</th><th>CSM</th><th>Report</th><th>Actions</th></tr></thead><tbody>';
  data.forEach(function(a){
    var reportUrl='/report/'+a.id;
    h+='<tr>';
    h+='<td><strong style="cursor:pointer;color:var(--accent)" data-id="'+a.id+'" onclick="openMo(this.dataset.id)">'+esc(a.name)+'</strong><div style="font-size:10px;color:var(--muted)">'+esc(a.email)+'</div></td>';
    h+='<td><span class="days-badge">'+a.daysInSystem+'d</span></td>';
    h+='<td style="font-size:11px;color:var(--muted)">'+ts(a.lastUpdated||a.lastActivity)+'</td>';
    h+='<td>'+pb(a.loginScore,a.loginMax)+'</td><td>'+pb(a.adoptionScore,a.adoptionMax)+'</td><td>'+pb(a.npsScore,a.npsMax)+'</td>';
    h+='<td>'+hbadge(a.health)+'</td>';
    h+='<td><select class="csms" data-id="'+a.id+'" onchange="assignCSM(this.dataset.id,this.value)">'+csmOpts+'</select></td>';
    h+='<td><a href="'+reportUrl+'" target="_blank" style="font-size:11px;color:var(--accent);text-decoration:none;font-weight:600">📄 View</a></td>';
    h+='<td style="display:flex;gap:3px"><button class="ab" data-id="'+a.id+'" onclick="openMo(this.dataset.id)" title="Details">👁️</button><button class="ab" data-id="'+a.id+'" data-name="'+esc(a.name)+'" onclick="openNotes(this.dataset.id,this.dataset.name)" title="Notes">📝</button></td>';
    h+='</tr>';
  });
  h+='</tbody></table></div><div style="padding:9px 12px;font-size:11px;color:var(--muted);border-top:1px solid var(--border)">Showing '+data.length+' of '+hData.length+' entries</div>';
  document.getElementById('htable').innerHTML=h;
}
function assignCSM(id,csm){fetch('/api/csm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId:id,csm})});}
function openNotes(id,name){
  var a=hData.find(function(x){return x.id===id;});
  document.getElementById('mo-title').textContent='Notes — '+name;
  document.getElementById('mo-email').textContent='Internal notes for this account';
  document.getElementById('mo-body').innerHTML='<textarea id="notes-ta" style="width:100%;height:120px;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:DM Sans,sans-serif;font-size:13px;background:var(--surface2);color:var(--text);outline:none;resize:vertical">'+esc(a?a.notes:'')+'</textarea><button class="save-btn" onclick="saveNotes(\''+id+'\')">Save Notes</button>';
  document.getElementById('movl').classList.add('open');
}
function saveNotes(id){var notes=document.getElementById('notes-ta').value;fetch('/api/csm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId:id,notes})}).then(function(){closeMoDirect();loadHealth();});}
function exportCSV(){var rows=[['Name','Email','Days Active','Last Updated','Login','Adoption','NPS','Health','CSM']];hData.forEach(function(a){rows.push([a.name,a.email,a.daysInSystem,ts(a.lastUpdated||a.lastActivity),a.loginScore+'/'+a.loginMax,a.adoptionScore+'/'+a.adoptionMax,a.npsScore+'/'+a.npsMax,a.health,a.csm||'']);});var csv=rows.map(function(r){return r.map(function(v){return'"'+String(v).replace(/"/g,'')+'"';}).join(',');}).join('\\n');var a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='health-report.csv';a.click();}

function openMo(id){
  var a=hData.find(function(x){return x.id===id;});if(!a)return;
  document.getElementById('mo-title').textContent=a.name;
  document.getElementById('mo-email').textContent=a.email;
  var score=Math.round(((a.loginScore/a.loginMax)+(a.adoptionScore/a.adoptionMax)+(a.npsScore/a.npsMax))/3*100);
  document.getElementById('mo-body').innerHTML=
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">'+
    [['Contacts',a.contacts,'var(--green)'],['Opportunities',a.opportunities,'var(--accent)'],['Days Active',a.daysInSystem,'var(--blue)']].map(function(x){return'<div style="background:var(--surface2);border-radius:9px;padding:11px;text-align:center"><div style="font-size:20px;font-weight:700;color:'+x[2]+'">'+x[1]+'</div><div style="font-size:10px;color:var(--muted);margin-top:2px">'+x[0]+'</div></div>';}).join('')+'</div>'+
    '<div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:14px;display:flex;align-items:center;gap:14px">'+
    '<div style="font-size:36px;font-weight:900;color:var(--accent)">'+score+'%</div>'+
    '<div style="flex:1">'+
    '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Overall Health Score</div>'+
    hbadge(a.health)+
    '</div></div>'+
    '<div style="display:flex;flex-direction:column;gap:0">'+
    [['Health',hbadge(a.health)],['Login Activity',pb(a.loginScore,a.loginMax)],['Product Adoption',pb(a.adoptionScore,a.adoptionMax)],['NPS',pb(a.npsScore,a.npsMax)],['Last Activity',ts(a.lastActivity)],['Member Since',a.joinDate?new Date(a.joinDate).toLocaleDateString():'—'],['Days in System',a.daysInSystem+' days'],['CSM',a.csm||'Not assigned']].map(function(r){return'<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)"><span style="font-size:11px;color:var(--muted)">'+r[0]+'</span><span style="font-size:12px;font-weight:500">'+r[1]+'</span></div>';}).join('')+'</div>'+
    '<a href="/report/'+a.id+'" target="_blank" style="display:block;text-align:center;padding:10px;background:var(--accent);color:#fff;border-radius:8px;font-weight:600;font-size:13px;text-decoration:none;margin-top:14px">📄 Open Client Report</a>';
  document.getElementById('movl').classList.add('open');
}
function closeMo(e){if(e.target===document.getElementById('movl'))closeMoDirect();}
function closeMoDirect(){document.getElementById('movl').classList.remove('open');}

async function loadAnalytics(){
  try{
    var d=await fetch('/api/analytics').then(function(r){return r.json();});
    anaData=d;
    var mrr=d.mrrData||[];var lastMRR=mrr[mrr.length-1]?.mrr||0;var prevMRR=mrr[mrr.length-2]?.mrr||0;var trend=prevMRR>0?Math.round((lastMRR-prevMRR)/prevMRR*100):0;
    document.getElementById('mrr-d').innerHTML='<div class="mrrb">'+fm(lastMRR)+'</div><div class="mrrt">'+(trend>=0?'↑':'↓')+Math.abs(trend)+'% vs last month</div>';
    var churn=d.churnData||[];var lc=churn[churn.length-1]?.churn||0;
    document.getElementById('churn-d').innerHTML='<div class="mrrb" style="color:var('+(lc>3?'--red':'--green')+')">'+lc+'%</div><div style="font-size:11px;color:var(--muted);margin-top:4px">This month</div>';
    var co=d.cohortList||[];
    document.getElementById('cohort-d').innerHTML='<table style="width:100%"><thead><tr><th style="padding:4px 8px;font-size:10px;color:var(--muted);text-transform:uppercase">Period</th><th style="padding:4px 8px;font-size:10px;color:var(--muted);text-transform:uppercase">Contacts</th></tr></thead><tbody>'+co.map(function(c){return'<tr><td style="padding:4px 8px;font-size:11px">'+esc(c.period)+'</td><td style="padding:4px 8px;font-size:12px;font-weight:600">'+c.count+'</td></tr>';}).join('')+'</tbody></table>';
    var labs=d.loginActivity.map(function(m){return m.month;});
    (function(){var ctx2=document.getElementById('ch-login');if(!ctx2)return;var grd=ctx2.getContext('2d').createLinearGradient(0,0,0,180);grd.addColorStop(0,'rgba(59,130,246,.9)');grd.addColorStop(1,'rgba(59,130,246,.3)');gc('ch-login','bar',{labels:labs,datasets:[{data:d.loginActivity.map(function(m){return m.logins;}),backgroundColor:grd,borderRadius:8,borderSkipped:false,barThickness:22,hoverBackgroundColor:'rgba(59,130,246,1)'}]});})();
    (function(){var ctx2=document.getElementById('ch-mrr');if(!ctx2)return;var grd=ctx2.getContext('2d').createLinearGradient(0,0,0,180);grd.addColorStop(0,'rgba(0,196,154,.25)');grd.addColorStop(1,'rgba(0,196,154,.0)');gc('ch-mrr','line',{labels:labs,datasets:[{data:d.mrrData.map(function(m){return m.mrr;}),borderColor:'#00c49a',borderWidth:2.5,backgroundColor:grd,fill:true,tension:.45,pointRadius:4,pointBackgroundColor:'#fff',pointBorderColor:'#00c49a',pointBorderWidth:2,pointHoverRadius:6}]});})();
    (function(){var ctx2=document.getElementById('ch-churn');if(!ctx2)return;var grd=ctx2.getContext('2d').createLinearGradient(0,0,0,160);grd.addColorStop(0,'rgba(239,68,68,.2)');grd.addColorStop(1,'rgba(239,68,68,.0)');gc('ch-churn','line',{labels:labs,datasets:[{data:d.churnData.map(function(m){return m.churn;}),borderColor:'#ef4444',borderWidth:2.5,backgroundColor:grd,fill:true,tension:.45,pointRadius:4,pointBackgroundColor:'#fff',pointBorderColor:'#ef4444',pointBorderWidth:2,pointHoverRadius:6}]});})();
  }catch(e){console.error(e);}
}

async function loadStaff(){
  try{
    var d=await fetch('/api/staff').then(function(r){return r.json();});
    sfList=d.staff||[];
    var noAct=sfList.filter(function(s){return !isTd(s.lastActivity);});
    var al=document.getElementById('staff-alert');
    if(noAct.length){al.style.display='block';al.innerHTML='⚠️ No activity today: '+noAct.map(function(s){return'<strong>'+esc(s.name)+'</strong>';}).join(', ');}
    else al.style.display='none';

    // Staff cards with KPI + shift
    var html=sfList.map(function(s){
      var kpi=s.kpi||{contacts:10,opps:5,won:2};
      var shiftLabel=s.isOnShift?'🟢 On Shift since '+ts(s.shiftStart):'⚫ Off Shift';
      var shiftBtnClass=s.isOnShift?'out':'in';
      var shiftBtnText=s.isOnShift?'Clock Out':'Clock In';
      var lastAct=s.lastAction?('<span class="la-tag '+s.lastAction.type+'">'+s.lastAction.type+'</span> '+esc(s.lastAction.name.slice(0,18))+'<div style="font-size:10px;color:var(--muted)">'+ts(s.lastAction.date)+'</div>'):'<span style="color:var(--muted);font-size:11px">No actions yet</span>';
      return'<div class="sfc'+(isTd(s.lastActivity)?' act':'')+(s.isOnShift?' onshift':'')+'">'+
        '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
        '<div class="sfav">'+esc(init(s.name))+'</div>'+
        '<button class="ab" data-uid="'+s.id+'" onclick="openKpiModal(this.dataset.uid)" title="Set KPI Targets">🎯</button>'+
        '</div>'+
        '<div class="sfn">'+esc(s.name)+'</div>'+
        '<div class="sfe">'+esc(s.email)+'</div>'+
        '<div class="sfm">'+
        '<div class="sm"><div class="smn">'+s.contacts+'</div><div class="sml">Contacts</div></div>'+
        '<div class="sm"><div class="smn">'+s.opportunities+'</div><div class="sml">Opps</div></div>'+
        '</div>'+
        '<div style="margin-top:8px">'+
        '<div class="kpi-row"><div class="kpi-lbl"><span>Contacts</span><span>'+s.contacts+'/'+kpi.contacts+'</span></div>'+kpiPb(s.contacts,kpi.contacts,'var(--green)')+'</div>'+
        '<div class="kpi-row"><div class="kpi-lbl"><span>Opps</span><span>'+s.opportunities+'/'+kpi.opps+'</span></div>'+kpiPb(s.opportunities,kpi.opps,'var(--accent)')+'</div>'+
        '<div class="kpi-row"><div class="kpi-lbl"><span>Won</span><span>'+s.oppsWon+'/'+kpi.won+'</span></div>'+kpiPb(s.oppsWon,kpi.won,'var(--yellow)')+'</div>'+
        '</div>'+
        '<div style="margin-top:8px;padding-top:7px;border-top:1px solid var(--border)">'+
        '<div style="font-size:10px;color:var(--muted);margin-bottom:4px">Last Action</div>'+
        lastAct+
        '</div>'+
        '<div style="margin-top:6px;font-size:10px;color:var(--muted)">⏱ Avg response: '+rtClass(s.avgResponseMin)+'</div>'+
        '<button class="shift-btn '+shiftBtnClass+'" data-uid="'+s.id+'" onclick="toggleShift(this.dataset.uid)">'+shiftBtnText+'</button>'+
        '</div>';
    }).join('');
    var g=document.getElementById('sfgrid');g.className='sfgrid';g.innerHTML=html||'<div class="loading">No staff.</div>';

    // Leaderboard
    var mx=sfList[0]?.score||1;
    var cols=['#f59e0b','#94a3b8','#f97316','#6b7280','#6b7280','#6b7280'];
    document.getElementById('lboard').innerHTML=sfList.slice(0,6).map(function(s,i){var p=Math.round(s.score/mx*100);var r=i===0?'g':i===1?'s':i===2?'b':'o';return'<div class="lbr"><div class="lbrk '+r+'">'+(i+1)+'</div><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(s.name.split(' ')[0])+'</div><div style="font-size:10px;color:var(--muted)">Score: '+s.score+' · RT: '+rtClass(s.avgResponseMin)+'</div></div><div class="lbbar"><div class="lbfill" style="width:'+p+'%;background:'+cols[i]+'"></div></div></div>';}).join('');

    // Shift board
    document.getElementById('shift-board').innerHTML=sfList.map(function(s){return'<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border)"><div><div style="font-size:12px;font-weight:600">'+esc(s.name.split(' ')[0])+'</div><div style="font-size:10px;color:var(--muted)">'+(s.isOnShift?'🟢 Since '+ts(s.shiftStart):'⚫ Offline')+'</div></div><div style="font-size:18px">'+(s.isOnShift?'🟢':'⚫')+'</div></div>';}).join('');

    // Actions log
    var allActions=[];
    sfList.forEach(function(s){(s.recentActions||[]).forEach(function(a){allActions.push({...a,staffName:s.name});});});
    allActions.sort(function(a,b){return new Date(b.date)-new Date(a.date);});
    document.getElementById('actions-log').innerHTML='<table><thead><tr><th>Staff</th><th>Action Type</th><th>Contact/Item</th><th>Stage</th><th>Time</th></tr></thead><tbody>'+allActions.slice(0,20).map(function(a){return'<tr><td><strong>'+esc(a.staffName.split(' ')[0])+'</strong></td><td><span class="la-tag '+a.type+'">'+a.type+'</span></td><td>'+esc(a.name.slice(0,25))+'</td><td style="font-size:10px;color:var(--muted)">'+esc(a.stage||'—')+'</td><td style="font-size:11px;color:var(--muted)">'+ts(a.date)+'</td></tr>';}).join('')+'</tbody></table>';

    buildWL();
  }catch(e){console.error(e);}
}

function toggleShift(uid){
  fetch('/api/shift',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:uid})})
    .then(function(r){return r.json();})
    .then(function(d){loadStaff();});
}

function openKpiModal(uid){
  var s=sfList.find(function(x){return x.id===uid;});if(!s)return;
  var kpi=s.kpi||{contacts:10,opps:5,won:2};
  document.getElementById('mo-title').textContent='🎯 KPI Targets — '+s.name;
  document.getElementById('mo-email').textContent='Set monthly targets for this team member';
  document.getElementById('mo-body').innerHTML=
    '<div style="display:flex;flex-direction:column;gap:10px">'+
    '<div><label style="font-size:12px;color:var(--muted)">Contacts Target</label><input type="number" class="kpi-input" id="kpi-c" value="'+kpi.contacts+'"/></div>'+
    '<div><label style="font-size:12px;color:var(--muted)">Opportunities Target</label><input type="number" class="kpi-input" id="kpi-o" value="'+kpi.opps+'"/></div>'+
    '<div><label style="font-size:12px;color:var(--muted)">Won Deals Target</label><input type="number" class="kpi-input" id="kpi-w" value="'+kpi.won+'"/></div>'+
    '<button class="save-btn" data-uid="'+uid+'" onclick="saveKpi(this.dataset.uid)">Save KPI Targets</button>'+
    '</div>';
  document.getElementById('movl').classList.add('open');
}
function saveKpi(uid){
  var c=parseInt(document.getElementById('kpi-c').value)||10;
  var o=parseInt(document.getElementById('kpi-o').value)||5;
  var w=parseInt(document.getElementById('kpi-w').value)||2;
  fetch('/api/kpi',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:uid,contacts:c,opps:o,won:w})})
    .then(function(){closeMoDirect();loadStaff();});
}

function buildWL(){gc('ch-wl','bar',{labels:sfList.map(function(s){return s.name.split(' ')[0];}),datasets:[{data:sfList.map(function(s){return s.contacts;}),backgroundColor:sfList.map(function(_,i){var c=['rgba(108,99,255,.85)','rgba(0,196,154,.85)','rgba(59,130,246,.85)','rgba(245,158,11,.85)','rgba(239,68,68,.85)','rgba(139,92,246,.85)'];return c[i%c.length];}),borderRadius:10,borderSkipped:false,barThickness:32,hoverBorderRadius:10}]});}

async function loadUsage(){
  try{
    var d=await fetch('/api/usage').then(function(r){return r.json();});
    var items=[['👥','Users',d.users,'var(--accent)'],['🏢','Sub-Accounts',d.locations,'var(--blue)'],['📋','Contacts',d.contacts,'var(--green)'],['💼','Opportunities',d.opportunities,'var(--yellow)'],['💬','Conversations',d.conversations,'var(--red)'],['⚡','Active Features',5,'var(--purple)']];
    document.getElementById('ugrid').innerHTML=items.map(function(x){return'<div class="uc"><div class="uico" style="background:'+x[3]+'22">'+x[0]+'</div><div><div class="un" style="color:'+x[3]+'">'+x[2]+'</div><div class="ul">'+x[1]+'</div></div></div>';}).join('');
    buildAdopt();
    fetch('/api/staff').then(function(r){return r.json();}).then(function(sd){var s=sd.staff||[];gc('ch-perf','bar',{labels:s.map(function(x){return x.name.split(' ')[0];}),datasets:[{data:s.map(function(x){return x.score;}),backgroundColor:s.map(function(_,i){var c=['rgba(108,99,255,.9)','rgba(0,196,154,.85)','rgba(245,158,11,.85)','rgba(59,130,246,.85)','rgba(239,68,68,.85)','rgba(139,92,246,.85)'];return c[i%c.length];}),borderRadius:10,borderSkipped:false,barThickness:32,hoverBorderRadius:10}]});});
  }catch(e){console.error(e);}
}
function buildAdopt(){gc('ch-adopt','bar',{labels:['Contacts','Conversations','Opportunities','Calendars','Marketing','Automation','Websites','Payments'],datasets:[{data:[85,72,61,45,38,33,28,22],backgroundColor:['rgba(108,99,255,.85)','rgba(0,196,154,.85)','rgba(245,158,11,.85)','rgba(96,165,250,.85)','rgba(239,68,68,.85)','rgba(167,139,250,.85)','rgba(52,211,153,.85)','rgba(251,146,60,.85)'],borderRadius:10,borderSkipped:false,barThickness:28,hoverBorderRadius:10}]});}

async function loadAll(){await Promise.all([loadSummary(),loadHealth(),loadStaff(),loadUsage()]);loadNotifs();}
loadAll();
setInterval(loadAll,5*60*1000);
setInterval(loadNotifs,30*1000);
</script>
</body>
</html>`);
});

app.listen(process.env.PORT||3000,function(){console.log("MAYBEL Dashboard v3 running on port "+(process.env.PORT||3000));});
