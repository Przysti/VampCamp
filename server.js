// Porównywarka statystyk CS2 dla ekipy. Bez zewnętrznych paczek, wymaga Node 18+.
// Uruchomienie: STEAM_API_KEY=twoj_klucz node server.js
const http = require("http");

const KEY = process.env.STEAM_API_KEY;
const PORT = process.env.PORT || 3000;
const STEAM = "https://api.steampowered.com";

async function resolveId(input) {
  input = String(input || "").trim();
  const prof = input.match(/steamcommunity\.com\/profiles\/(\d{17})/);
  if (prof) return prof[1];
  if (/^\d{17}$/.test(input)) return input;
  const vanity = (input.match(/steamcommunity\.com\/id\/([^/?#]+)/) || [])[1] || input;
  const r = await fetch(
    STEAM + "/ISteamUser/ResolveVanityURL/v1/?key=" + KEY + "&vanityurl=" + encodeURIComponent(vanity)
  );
  const j = await r.json();
  if (j.response && j.response.success === 1) return j.response.steamid;
  throw new Error("Nie znaleziono profilu: " + input);
}

async function getLeetify(steamid) {
  try {
    const h = {};
    if (process.env.LEETIFY_API_KEY) {
      h.Authorization = "Bearer " + process.env.LEETIFY_API_KEY;
      h._leetify_key = process.env.LEETIFY_API_KEY;
    }
    const r = await fetch("https://api-public.cs-prod.leetify.com/v3/profile?steam64_id=" + steamid, { headers: h });
    if (!r.ok) return { error: "HTTP " + r.status };
    return { data: await r.json() };
  } catch (e) {
    return { error: "brak połączenia" };
  }
}

async function getPlayer(input) {
  const steamid = await resolveId(input);
  const [sumRes, statRes] = await Promise.all([
    fetch(STEAM + "/ISteamUser/GetPlayerSummaries/v2/?key=" + KEY + "&steamids=" + steamid),
    fetch(STEAM + "/ISteamUserStats/GetUserStatsForGame/v2/?appid=730&key=" + KEY + "&steamid=" + steamid),
  ]);
  const sum = ((await sumRes.json()).response.players || [])[0];
  if (!sum) throw new Error("Brak profilu o ID " + steamid);
  if (!statRes.ok)
    throw new Error(sum.personaname + ": statystyki prywatne. Ustaw Game details na Public w prywatności Steam.");
  const raw = (await statRes.json()).playerstats.stats || [];
  const stats = {};
  raw.forEach((s) => (stats[s.name] = s.value));
  return { steamid, name: sum.personaname, avatar: sum.avatarfull, stats, ...(await getLeetify(steamid).then((l) => ({ leetify: l.data || null, leetifyError: l.error || null }))) };
}

const HTML = String.raw`<!doctype html>
<html lang="pl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0e1621"><link rel="manifest" href="/manifest.json"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="CS2 Ekipa">
<title>CS2 Ekipa</title>
<style>
:root{--bg:#0e1621;--panel:#16212f;--line:#263548;--text:#e6edf5;--muted:#8a9bb0;--best:#f2b84b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px;max-width:720px;margin-inline:auto}
h1{font-size:1.5rem;margin:0 0 4px}
p.sub{color:var(--muted);margin:0 0 16px;font-size:.9rem}
.inputs{display:grid;gap:8px;margin-bottom:12px}
input{width:100%;padding:12px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--text);font-size:16px}
button{width:100%;padding:13px;border:0;border-radius:8px;background:var(--best);color:#1a1405;font-weight:700;font-size:16px;cursor:pointer}
button:disabled{opacity:.6}
button:focus-visible,input:focus-visible{outline:2px solid var(--best);outline-offset:2px}
#err{color:#ff8a80;margin:12px 0;font-size:.9rem;white-space:pre-line}
.players,.row{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:8px}
.players{margin:20px 0 4px;text-align:center}
.players img{width:56px;height:56px;border-radius:50%;border:2px solid var(--line)}
.players div{font-size:.85rem;overflow-wrap:anywhere}
.metric{padding:10px 0;border-top:1px solid var(--line)}
.metric small{display:block;color:var(--muted);font-size:.75rem;margin-bottom:2px;text-align:center}
.row span{text-align:center;font-size:1.15rem;font-variant-numeric:tabular-nums}
.pod h2{font-size:1.1rem;margin:22px 0 4px}.pod .lead{color:var(--best);margin:4px 0 8px}.pod .row{display:block}.pod .row span{margin:0 8px;font-size:.95rem}
.row span.best{color:var(--best);font-weight:700}
</style></head><body>
<h1>CS2 Ekipa</h1>
<p class="sub">Wklej Steam ID, link do profilu lub nazwę z linku. Profile muszą mieć publiczne statystyki gier.</p>
<div class="inputs">
<input id="p0" placeholder="Gracz 1" autocomplete="off">
<input id="p1" placeholder="Gracz 2" autocomplete="off">
<input id="p2" placeholder="Gracz 3" autocomplete="off">
</div>
<button id="go">Porównaj</button>
<div id="err"></div>
<p class="sub">Link do OBS (Browser Source): <span id="ov" style="user-select:all;overflow-wrap:anywhere"></span></p>
<div id="out"></div>
<script>
var $=function(s){return document.querySelector(s)};
var M=[
["K/D",function(s){return s.total_kills/s.total_deaths},function(v){return v.toFixed(2)},1],
["Zabójstwa",function(s){return s.total_kills},function(v){return v.toLocaleString("pl")},1],
["Headshoty %",function(s){return 100*s.total_kills_headshot/s.total_kills},function(v){return v.toFixed(1)+"%"},1],
["Celność %",function(s){return 100*s.total_shots_hit/s.total_shots_fired},function(v){return v.toFixed(1)+"%"},1],
["Wygrane rundy %",function(s){return 100*s.total_wins/s.total_rounds_played},function(v){return v.toFixed(1)+"%"},1],
["Dmg na rundę",function(s){return s.total_damage_done/s.total_rounds_played},function(v){return v.toFixed(0)},1],
["MVP",function(s){return s.total_mvps},function(v){return v.toLocaleString("pl")},1],
["Wygrane mecze",function(s){return s.total_matches_won},function(v){return v.toLocaleString("pl")},1],
["CS Rating (Premier)",function(s,p){return p.leetify&&p.leetify.ranks&&p.leetify.ranks.premier},function(v){return Math.round(v).toLocaleString("pl")},1],
["Aim (Leetify)",function(s,p){return p.leetify&&p.leetify.rating&&p.leetify.rating.aim},function(v){return v.toFixed(1)},1],
["Pozycjonowanie",function(s,p){return p.leetify&&p.leetify.rating&&p.leetify.rating.positioning},function(v){return v.toFixed(1)},1],
["Utility",function(s,p){return p.leetify&&p.leetify.rating&&p.leetify.rating.utility},function(v){return v.toFixed(1)},1],
["Clutch",function(s,p){return p.leetify&&p.leetify.rating&&p.leetify.rating.clutch},function(v){return v.toFixed(2)},1],
["Otwarcia rund",function(s,p){return p.leetify&&p.leetify.rating&&p.leetify.rating.opening},function(v){return v.toFixed(2)},1],
["Godziny gry",function(s){return s.total_time_played/3600},function(v){return Math.round(v).toLocaleString("pl")+" h"},0]
];
function val(f,p){var v;try{v=f(p.stats,p)}catch(e){return null}return(typeof v==="number"&&isFinite(v))?v:null}
function load(){
 var ids=[0,1,2].map(function(i){return $("#p"+i).value.trim()}).filter(Boolean);
 try{localStorage.setItem("cs2ids",JSON.stringify(ids))}catch(e){}
 $("#ov").textContent=location.origin+"/overlay?p="+encodeURIComponent(ids.join(","));
 if(!ids.length){$("#err").textContent="Wpisz co najmniej jedno ID.";return}
 $("#go").disabled=true;$("#go").textContent="Ładuję...";$("#err").textContent="";$("#out").innerHTML="";
 Promise.all(ids.map(function(id){
  return fetch("/api/player?id="+encodeURIComponent(id)).then(function(r){return r.json()});
 })).then(function(res){
  var ok=res.filter(function(r){return !r.error}),errs=res.filter(function(r){return r.error}).map(function(r){return r.error});
  $("#err").textContent=errs.join("\n");
  var le=ok.filter(function(r){return r.leetifyError});
  if(ok.length&&le.length===ok.length)$("#err").textContent+="\nLeetify nie zwrócił danych ("+le[0].leetifyError+"), więc CS Rating i oceny z Leetify są ukryte.";
  if(ok.length)render(ok);
 }).catch(function(){$("#err").textContent="Błąd połączenia z serwerem."})
 .then(function(){$("#go").disabled=false;$("#go").textContent="Porównaj"});
}
function render(ps){
 var h='<div class="players" style="--n:'+ps.length+'">';
 ps.forEach(function(p){h+='<div><img src="'+p.avatar+'" alt=""><div></div></div>'});
 h+='</div>';
 var o=$("#out");o.innerHTML=h;
 var names=o.querySelectorAll(".players div div");
 ps.forEach(function(p,i){names[i].textContent=p.name});
 
 M.forEach(function(m){
  var vals=ps.map(function(p){return val(m[1],p)});
  var nums=vals.filter(function(v){return v!==null});
  if(!nums.length)return;var best=null;
  var d=document.createElement("div");d.className="metric";
  var s=document.createElement("small");s.textContent=m[0];d.appendChild(s);
  var r=document.createElement("div");r.className="row";r.style.setProperty("--n",ps.length);
  vals.forEach(function(v){
   var c=document.createElement("span");
   c.textContent=v===null?"–":m[2](v);
   if(v!==null&&v===best)c.className="best";
   r.appendChild(c);
  });
  d.appendChild(r);o.appendChild(d);
 });
}
var PODIUM=["K/D","Headshoty %","Celność %","Wygrane rundy %","Dmg na rundę","CS Rating (Premier)","Aim (Leetify)","Utility","Clutch"];
function podium(ps,o){
 var pts=ps.map(function(){return 0});
 var pod=document.createElement("div");pod.className="pod";
 var h=document.createElement("h2");h.textContent="Podium ekipy";pod.appendChild(h);
 var lead=document.createElement("div");lead.className="lead";pod.appendChild(lead);
 var medals=["🥇","🥈","🥉"];
 M.forEach(function(m){
  if(PODIUM.indexOf(m[0])<0)return;
  var arr=[];
  ps.forEach(function(p,i){var v=val(m[1],p);if(v!==null)arr.push({i:i,v:v})});
  if(arr.length<2)return;
  arr.sort(function(a,b){return b.v-a.v});
  var d=document.createElement("div");d.className="metric";
  var s=document.createElement("small");s.textContent=m[0];d.appendChild(s);
  var r=document.createElement("div");r.className="row";
  arr.slice(0,3).forEach(function(a,k){
   pts[a.i]+=3-k;
   var c=document.createElement("span");c.textContent=medals[k]+" "+ps[a.i].name;r.appendChild(c);
  });
  d.appendChild(r);pod.appendChild(d);
 });
 var max=Math.max.apply(null,pts);
 if(max>0){var li=pts.indexOf(max);lead.textContent="Lider ekipy: "+ps[li].name+" ("+max+" pkt)"}
 o.insertBefore(pod,o.children[1]);
}
try{(JSON.parse(localStorage.getItem("cs2ids"))||[]).forEach(function(v,i){$("#p"+i).value=v})}catch(e){}
$("#go").onclick=load;
(function(){
 var has=[0,1,2].some(function(i){return $("#p"+i).value});
 if(has){load();return}
 fetch("/api/default").then(function(r){return r.json()}).then(function(a){
  a.slice(0,3).forEach(function(v,i){$("#p"+i).value=v});
  if(a.length)load();
 }).catch(function(){});
})();
</script></body></html>`;

function brief(p) {
  const s = p.stats, r1 = (v) => (isFinite(v) ? +v.toFixed(1) : null);
  return {
    name: p.name, avatar: p.avatar,
    kd: isFinite(s.total_kills / s.total_deaths) ? +(s.total_kills / s.total_deaths).toFixed(2) : null,
    hs: r1((100 * s.total_kills_headshot) / s.total_kills),
    wr: r1((100 * s.total_wins) / s.total_rounds_played),
    dmg: isFinite(s.total_damage_done / s.total_rounds_played) ? Math.round(s.total_damage_done / s.total_rounds_played) : null,
    premier: (p.leetify && p.leetify.ranks && p.leetify.ranks.premier) || null,
  };
}

const OVERLAY = String.raw`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>CS2 Overlay</title>
<style>
body{margin:0;background:transparent;color:#fff;font:700 20px system-ui,sans-serif;text-shadow:0 2px 6px #000}
#w{display:flex;gap:14px;padding:10px;flex-wrap:wrap}
.c{background:rgba(14,22,33,.85);border-radius:12px;padding:12px 16px;min-width:200px}
.n{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.n img{width:36px;height:36px;border-radius:50%}
.r{display:flex;justify-content:space-between;gap:18px;font-weight:600;font-size:17px;line-height:1.5}
.r span:first-child{color:#9fb0c4}
</style></head><body><div id="w"></div><script>
var q=new URLSearchParams(location.search);
function run(){
 var p=q.get("p");
 fetch("/api/team"+(p?"?p="+encodeURIComponent(p):"")).then(function(r){return r.json()}).then(function(a){
  var w=document.getElementById("w");w.innerHTML="";
  a.forEach(function(x){
   var c=document.createElement("div");c.className="c";
   var n=document.createElement("div");n.className="n";
   var im=document.createElement("img");im.src=x.avatar;n.appendChild(im);
   var nm=document.createElement("span");nm.textContent=x.name;n.appendChild(nm);c.appendChild(n);
   [["K/D",x.kd],["HS %",x.hs],["Wygrane rundy %",x.wr],["Dmg/runda",x.dmg],["CS Rating",x.premier]].forEach(function(m){
    if(m[1]===null||m[1]===undefined)return;
    var r=document.createElement("div");r.className="r";
    var a1=document.createElement("span");a1.textContent=m[0];var b=document.createElement("span");b.textContent=m[1];
    r.appendChild(a1);r.appendChild(b);c.appendChild(r);
   });
   w.appendChild(c);
  });
 }).catch(function(){});
}
run();setInterval(run,120000);
</script></body></html>`;

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/player") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      if (!KEY) {
        res.statusCode = 500;
        return res.end(JSON.stringify({ error: "Brak STEAM_API_KEY na serwerze." }));
      }
      try {
        res.end(JSON.stringify(await getPlayer(url.searchParams.get("id"))));
      } catch (e) {
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    if (url.pathname === "/api/team") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Access-Control-Allow-Origin", "*");
      const ids = (url.searchParams.get("p") || process.env.PLAYERS || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 5);
      const all = await Promise.allSettled(ids.map(getPlayer));
      return res.end(JSON.stringify(all.filter((x) => x.status === "fulfilled").map((x) => brief(x.value))));
    }
    if (url.pathname === "/overlay") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(OVERLAY);
    }
    if (url.pathname === "/manifest.json") {
      res.setHeader("Content-Type", "application/manifest+json");
      return res.end(JSON.stringify({ name: "CS2 Ekipa", short_name: "CS2 Ekipa", start_url: "/", display: "standalone", background_color: "#0e1621", theme_color: "#0e1621" }));
    }
    if (url.pathname === "/api/default") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify((process.env.PLAYERS || "").split(",").map((x) => x.trim()).filter(Boolean)));
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(HTML);
  })
  .listen(PORT, () => console.log("Działa na http://localhost:" + PORT));
