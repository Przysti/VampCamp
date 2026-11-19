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
  return { steamid, name: sum.personaname, avatar: sum.avatarfull, stats };
}

const HTML = String.raw`<!doctype html>
<html lang="pl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0e1621">
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
["Godziny gry",function(s){return s.total_time_played/3600},function(v){return Math.round(v).toLocaleString("pl")+" h"},0]
];
function val(f,s){var v=f(s);return isFinite(v)?v:null}
function load(){
 var ids=[0,1,2].map(function(i){return $("#p"+i).value.trim()}).filter(Boolean);
 try{localStorage.setItem("cs2ids",JSON.stringify(ids))}catch(e){}
 if(!ids.length){$("#err").textContent="Wpisz co najmniej jedno ID.";return}
 $("#go").disabled=true;$("#go").textContent="Ładuję...";$("#err").textContent="";$("#out").innerHTML="";
 Promise.all(ids.map(function(id){
  return fetch("/api/player?id="+encodeURIComponent(id)).then(function(r){return r.json()});
 })).then(function(res){
  var ok=res.filter(function(r){return !r.error}),errs=res.filter(function(r){return r.error}).map(function(r){return r.error});
  $("#err").textContent=errs.join("\n");
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
  var vals=ps.map(function(p){return val(m[1],p.stats)});
  var nums=vals.filter(function(v){return v!==null});
  var best=nums.length>1?(m[3]?Math.max.apply(null,nums):null):null;
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
try{(JSON.parse(localStorage.getItem("cs2ids"))||[]).forEach(function(v,i){$("#p"+i).value=v})}catch(e){}
$("#go").onclick=load;
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
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(HTML);
  })
  .listen(PORT, () => console.log("Działa na http://localhost:" + PORT));
