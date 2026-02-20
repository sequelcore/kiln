// Dev Inspector: self-contained HTML page for engine observability.
// Served at GET /dev/ when devMode is true. Zero external dependencies.

export function createDevInspectorHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kiln Dev Inspector</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#09090b;color:#d4d4d8;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:13px;line-height:1.5}
a{color:#60a5fa;text-decoration:none}
.header{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #27272a}
.header h1{font-size:14px;font-weight:600;color:#fafafa}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot-ok{background:#22c55e}
.dot-err{background:#ef4444}
.dot-wait{background:#71717a}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px;height:calc(100vh - 49px);grid-template-rows:auto 1fr auto}
.card{background:#18181b;border:1px solid #27272a;border-radius:6px;overflow:hidden;display:flex;flex-direction:column}
.card-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#71717a;padding:8px 12px;border-bottom:1px solid #27272a}
.card-body{padding:12px;overflow-y:auto;flex:1;min-height:0}
.phases{display:flex;gap:4px;align-items:center;flex-wrap:wrap}
.phase{padding:4px 10px;border-radius:4px;font-size:11px;background:#27272a;color:#71717a}
.phase-done{background:#052e16;color:#4ade80}
.phase-active{background:#172554;color:#60a5fa;font-weight:600}
.filter-input{width:100%;padding:4px 8px;background:#09090b;border:1px solid #3f3f46;border-radius:4px;color:#d4d4d8;font-family:inherit;font-size:12px;margin-bottom:8px}
.filter-input:focus{outline:none;border-color:#60a5fa}
.event-log{font-size:12px;white-space:pre-wrap;word-break:break-all}
.ev{padding:2px 0;border-bottom:1px solid #1c1c1e}
.ev-time{color:#52525b}
.ev-type{font-weight:600;display:inline-block;min-width:120px}
.ev-phase{color:#60a5fa}
.ev-task{color:#4ade80}
.ev-tool{color:#facc15}
.ev-memory{color:#c084fc}
.ev-error{color:#ef4444}
.ev-security{color:#fb923c}
.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.stat{background:#09090b;border-radius:4px;padding:8px 12px}
.stat-value{font-size:18px;font-weight:700;color:#fafafa}
.stat-label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#71717a;margin-top:2px}
.info-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1c1c1e}
.info-label{color:#71717a}
.info-value{color:#d4d4d8}
pre.json{font-size:12px;color:#a1a1aa;white-space:pre-wrap;word-break:break-all}
.full-width{grid-column:1/-1}
</style>
</head>
<body>
<div class="header">
  <div id="status-dot" class="dot dot-wait"></div>
  <h1>Kiln Dev Inspector</h1>
  <span id="conn-label" style="color:#71717a;font-size:12px">Connecting...</span>
</div>
<div class="grid">
  <div class="card full-width">
    <div class="card-title">Phase Pipeline</div>
    <div class="card-body"><div id="phases" class="phases"></div></div>
  </div>
  <div class="card" style="min-height:0">
    <div class="card-title">Event Stream</div>
    <div class="card-body" style="display:flex;flex-direction:column;min-height:0">
      <input id="filter" class="filter-input" placeholder="Filter events..." />
      <div id="events" class="event-log" style="flex:1;overflow-y:auto;min-height:0"></div>
    </div>
  </div>
  <div class="card" style="min-height:0;display:flex;flex-direction:column">
    <div class="card-title">Security</div>
    <div class="card-body" style="flex:1;display:flex;flex-direction:column;gap:12px;min-height:0">
      <div class="stats-grid" id="sec-stats">
        <div class="stat"><div class="stat-value" id="s-scans">0</div><div class="stat-label">Scans</div></div>
        <div class="stat"><div class="stat-value" id="s-blocked">0</div><div class="stat-label">Blocked</div></div>
        <div class="stat"><div class="stat-value" id="s-guardian">0</div><div class="stat-label">Guardian Reviews</div></div>
        <div class="stat"><div class="stat-value" id="s-violations">0</div><div class="stat-label">Violations</div></div>
      </div>
      <div id="sec-events" class="event-log" style="flex:1;overflow-y:auto;min-height:0"></div>
    </div>
  </div>
  <div class="card full-width">
    <div class="card-title">Info</div>
    <div class="card-body" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
      <div><div style="color:#71717a;font-size:11px;margin-bottom:4px">Cost</div><pre id="cost-info" class="json">Loading...</pre></div>
      <div><div style="color:#71717a;font-size:11px;margin-bottom:4px">Apps</div><div id="apps-info">Loading...</div></div>
      <div><div style="color:#71717a;font-size:11px;margin-bottom:4px">Triggers</div><div id="triggers-info">Loading...</div></div>
    </div>
  </div>
</div>
<script>
(function(){
  var events=[];
  var MAX=1000;
  var secCounts={scans:0,blocked:0,guardian:0,violations:0};
  var secEvents=[];
  var filterText="";

  var dot=document.getElementById("status-dot");
  var connLabel=document.getElementById("conn-label");
  var phasesEl=document.getElementById("phases");
  var eventsEl=document.getElementById("events");
  var filterEl=document.getElementById("filter");
  var secEventsEl=document.getElementById("sec-events");

  function setConnected(ok){
    dot.className="dot "+(ok?"dot-ok":"dot-err");
    connLabel.textContent=ok?"Connected":"Disconnected";
  }

  function evColor(type){
    if(type.startsWith("phase")||type==="approval_requested"||type==="approval_received"||type==="worker_assigned"||type==="error"||type.startsWith("handoff")||type.startsWith("interrupt"))return type==="error"?"ev-error":"ev-phase";
    if(type.startsWith("task"))return"ev-task";
    if(type.startsWith("tool")||type==="verification_result")return"ev-tool";
    if(type.startsWith("memory"))return"ev-memory";
    if(type.startsWith("injection")||type.startsWith("guardian")||type.startsWith("audit")||type.startsWith("tenant_isolation")||type.startsWith("security"))return"ev-security";
    return"";
  }

  function isSecurity(type){
    return type==="injection_scanned"||type==="guardian_reviewed"||type==="audit_entry"||type==="tenant_isolation_violation"||type==="security_alert";
  }

  function fmtTime(ts){
    if(!ts)return"";
    var d=new Date(ts);
    return d.toLocaleTimeString("en",{hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"});
  }

  function truncate(s,n){return s.length>n?s.slice(0,n)+"...":s}

  function renderEvents(){
    var filt=filterText.toLowerCase();
    var html="";
    for(var i=events.length-1;i>=0;i--){
      var ev=events[i];
      if(filt&&ev.type.toLowerCase().indexOf(filt)===-1)continue;
      var rest=Object.assign({},ev);
      delete rest.type;delete rest.timestamp;delete rest.sessionId;
      var detail=Object.keys(rest).length?truncate(JSON.stringify(rest),120):"";
      html+='<div class="ev"><span class="ev-time">'+fmtTime(ev.timestamp)+'</span> <span class="ev-type '+evColor(ev.type)+'">'+ev.type+'</span> '+detail+'</div>';
    }
    eventsEl.innerHTML=html;
  }

  function renderSecEvents(){
    document.getElementById("s-scans").textContent=secCounts.scans;
    document.getElementById("s-blocked").textContent=secCounts.blocked;
    document.getElementById("s-guardian").textContent=secCounts.guardian;
    document.getElementById("s-violations").textContent=secCounts.violations;
    var html="";
    for(var i=secEvents.length-1;i>=Math.max(0,secEvents.length-20);i--){
      var ev=secEvents[i];
      var rest=Object.assign({},ev);
      delete rest.type;delete rest.timestamp;delete rest.sessionId;
      html+='<div class="ev"><span class="ev-time">'+fmtTime(ev.timestamp)+'</span> <span class="ev-type ev-security">'+ev.type+'</span> '+truncate(JSON.stringify(rest),100)+'</div>';
    }
    secEventsEl.innerHTML=html;
  }

  function renderPhases(state){
    if(!state)return;
    var phases=state.phases||["analyze","research","architect","implement","verify","synthesize"];
    var current=state.phase||state.phaseName||null;
    var currentIdx=current?phases.indexOf(current):-1;
    var html="";
    for(var i=0;i<phases.length;i++){
      var cls="phase";
      if(i<currentIdx)cls+=" phase-done";
      else if(i===currentIdx)cls+=" phase-active";
      html+='<div class="'+cls+'">'+(i<currentIdx?"\\u2713 ":"")+phases[i]+'</div>';
      if(i<phases.length-1)html+='<span style="color:#3f3f46">\\u2192</span>';
    }
    phasesEl.innerHTML=html;
  }

  function pushEvent(ev){
    events.push(ev);
    if(events.length>MAX)events.shift();
    if(isSecurity(ev.type)){
      secEvents.push(ev);
      if(ev.type==="injection_scanned")secCounts.scans++;
      if(ev.type==="injection_scanned"&&ev.safe===false)secCounts.blocked++;
      if(ev.type==="guardian_reviewed")secCounts.guardian++;
      if(ev.type==="tenant_isolation_violation"||ev.type==="security_alert")secCounts.violations++;
      renderSecEvents();
    }
    if(ev.type==="phase_changed")renderPhases({phase:ev.phaseName||ev.phase,phases:null});
    renderEvents();
  }

  filterEl.addEventListener("input",function(){filterText=this.value;renderEvents()});

  // Fetch initial data
  fetch("/dev/state").then(function(r){return r.json()}).then(renderPhases).catch(function(){});
  fetch("/dev/cost").then(function(r){return r.json()}).then(function(d){
    document.getElementById("cost-info").textContent=JSON.stringify(d,null,2);
  }).catch(function(){document.getElementById("cost-info").textContent="Unavailable"});
  fetch("/dev/apps").then(function(r){return r.json()}).then(function(d){
    var apps=d.apps||[];
    document.getElementById("apps-info").innerHTML=apps.length?apps.map(function(a){return'<div class="info-row"><span class="info-value">'+a+'</span></div>'}).join(""):'<span style="color:#71717a">No apps loaded</span>';
  }).catch(function(){document.getElementById("apps-info").textContent="Unavailable"});
  fetch("/dev/triggers").then(function(r){return r.json()}).then(function(d){
    var triggers=d.triggers||[];
    document.getElementById("triggers-info").innerHTML=triggers.length?triggers.map(function(t){return'<div class="info-row"><span class="info-label">'+t.appName+'</span><span class="info-value">'+t.name+' ('+t.type+')</span></div>'}).join(""):'<span style="color:#71717a">No triggers</span>';
  }).catch(function(){document.getElementById("triggers-info").textContent="Unavailable"});

  // SSE connection
  function connectSSE(){
    var es=new EventSource("/dev/events");
    es.onopen=function(){setConnected(true)};
    es.onerror=function(){
      setConnected(false);
      es.close();
      setTimeout(connectSSE,3000);
    };
    es.onmessage=function(e){
      try{pushEvent(JSON.parse(e.data))}catch(err){}
    };
    // Named event types from the SSE stream
    var types=["phase_changed","task_started","task_completed","tool_called","tool_result","thinking",
      "verification_result","cost_update","memory_saved","memory_recalled","memory_sync",
      "approval_requested","approval_received","worker_assigned","error","trace_span",
      "handoff_requested","handoff_completed","interrupt_requested","interrupt_resumed",
      "injection_scanned","guardian_reviewed","audit_entry","tenant_isolation_violation","security_alert",
      "webhook_received","trigger_fired","trigger_failed","schedule_fired"];
    types.forEach(function(t){
      es.addEventListener(t,function(e){
        try{pushEvent(JSON.parse(e.data))}catch(err){}
      });
    });
  }
  connectSSE();
})();
</script>
</body>
</html>`;
}
