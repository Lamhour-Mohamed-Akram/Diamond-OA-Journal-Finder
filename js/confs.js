/* ================= Conference finder =================
   Data: https://ccfddl.com/conference/allconf.yml — an open, community-
   maintained dataset of CS conferences with CCF/CORE ranks and deadlines. */
const CONF_FEED='https://ccfddl.com/conference/allconf.yml';
const CONF_TTL=24*3600e3;
const SUBS={
  AI:'Artificial Intelligence', CG:'Graphics & Multimedia', CT:'Computing Theory',
  DB:'Databases / Data Mining / IR', DS:'Architecture / Parallel / Storage',
  HI:'Human–Computer Interaction', MX:'Interdisciplinary / Emerging',
  NW:'Networks', SC:'Security & Privacy', SE:'Software Engineering / PL'
};
const ccfOrder={A:1,B:2,C:3,N:4};
const coreOrder={'A*':1,A:2,B:3,C:4,N:5,'':6};

/* --- Minimal YAML-subset parser (maps, lists, scalars; handles the quirks
       present in the ccfddl feed: wrapped plain & quoted scalars, quoted
       values containing colons, and keys containing spaces). --- */
function parseYAML(text){
  const lines=text.split('\n').filter(l=>l.trim()!=='' && !l.trim().startsWith('#'));
  let pos=0;
  function indentOf(l){ let i=0; while(l[i]===' ') i++; return i; }
  function unquote(v){
    v=v.trim();
    if(v.length>1 && ((v[0]==="'"&&v.endsWith("'")) || (v[0]==='"'&&v.endsWith('"')))) return v.slice(1,-1).replace(/''/g,"'");
    return v;
  }
  function parseBlock(indent){
    const first=lines[pos];
    if(indentOf(first)!==indent) return null;
    if(first.trim().startsWith('- ')) return parseList(indent);
    return parseMap(indent);
  }
  function parseList(indent){
    const arr=[];
    while(pos<lines.length){
      const line=lines[pos];
      if(indentOf(line)!==indent || !line.trim().startsWith('- ')) break;
      const rest=line.slice(indent+2);
      if(/^[A-Za-z_][\w ]*:( |$)/.test(rest)){
        lines[pos]=' '.repeat(indent+2)+rest;  // rewrite "- key: v" as map at deeper indent
        arr.push(parseMap(indent+2));
      } else {
        pos++;
        arr.push(unquote(rest));
      }
    }
    return arr;
  }
  function parseMap(indent){
    const obj={};
    while(pos<lines.length){
      const line=lines[pos];
      const ind=indentOf(line);
      if(ind<indent || (ind===indent && line.trim().startsWith('- '))) break;
      if(ind>indent) break;
      const m=line.slice(indent).match(/^([A-Za-z_][\w ]*?):( (.*)|)$/);
      if(!m){ pos++; continue; }
      const key=m[1].replace(/ /g,'_'); let val=(m[3]||'').trim();
      pos++;
      if(val===''){
        if(pos<lines.length && indentOf(lines[pos])>indent) obj[key]=parseBlock(indentOf(lines[pos]));
        else if(pos<lines.length && indentOf(lines[pos])===indent && lines[pos].trim().startsWith('- ')) obj[key]=parseList(indent);
        else obj[key]=null;
      } else if((val[0]==="'"||val[0]==='"') && !(val.length>1 && val.endsWith(val[0]))){
        const qc=val[0];
        while(pos<lines.length && !val.endsWith(qc)){ val+=' '+lines[pos].trim(); pos++; }
        obj[key]=unquote(val);
      } else {
        while(pos<lines.length && indentOf(lines[pos])>indent
              && !lines[pos].trim().startsWith('- ')
              && !/^[A-Za-z_][\w ]*:( |$)/.test(lines[pos].trim())){
          val+=' '+lines[pos].trim(); pos++;
        }
        obj[key]=unquote(val);
      }
    }
    return obj;
  }
  return parseBlock(0);
}

const TZ_OFF={AoE:-12,PT:-8,UTC:0};
function tzOffset(tz){
  if(!tz) return 0;
  if(tz in TZ_OFF) return TZ_OFF[tz];
  const m=String(tz).match(/^UTC([+-]\d+)$/);
  return m?parseInt(m[1]):0;
}
function parseDeadline(str,tz){
  if(!str||str==='TBD') return null;
  const m=String(str).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if(!m) return null;
  return Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]) - tzOffset(tz)*3600e3;
}
function buildConfs(raw){
  const out=[];
  for(const c of (raw||[])){
    if(!c||!c.title) continue;
    const rank=c.rank||{};
    const eds=[];
    for(const ed of (c.confs||[])){
      if(!ed) continue;
      eds.push({
        y:ed.year||'', tz:ed.timezone||'', date:ed.date||'', place:ed.place||'', link:ed.link||'',
        tl:(ed.timeline||[]).filter(Boolean).map(t=>({a:t.abstract_deadline||'', d:t.deadline||'', c:t.comment||''}))
      });
    }
    let led=null;
    for(const ed of eds) if(!led || +ed.y>+led.y) led=ed;
    out.push({
      t:c.title, desc:c.description||'', sub:c.sub||'', dblp:c.dblp||'',
      ccf:rank.ccf||'N', core:rank.core||'', eds, led
    });
  }
  return out;
}
function confNext(c,now){
  let best=null;
  for(const ed of c.eds){
    for(const tl of ed.tl){
      for(const [str,typ] of [[tl.a,'abstract'],[tl.d,'submission']]){
        const ts=parseDeadline(str,ed.tz);
        if(ts!=null && ts>now && (!best||ts<best.ts))
          best={ts,typ,y:ed.y,date:ed.date,place:ed.place,link:ed.link,cm:tl.c};
      }
    }
  }
  return best;
}

let C=[], cstate=null, confsReady=false, confsLoading=false;
let M=[], mstate=null, maReady=false, csrc='ccf';
let ccfStats=null, maStats=null;
const cstatus=(msg,err)=>{ const el=$('cstatus');
  el.style.display=msg?'block':'none'; el.textContent=msg||''; el.classList.toggle('err',!!err); };
function curState(){ return csrc==='ma'?mstate:cstate; }
function refreshC(){ if(csrc==='ma') renderMa(); else renderConfs(); }
function applyStats(){
  const s=csrc==='ma'?maStats:ccfStats;
  const L=csrc==='ma'?['Events','Upcoming','Next 30 days']:['Conferences','Open calls','Due ≤ 30 days'];
  $('s-ctotal').textContent=s?s[0].toLocaleString():'–';
  $('s-copen').textContent=s?s[1].toLocaleString():'–';
  $('s-c30').textContent=s?s[2].toLocaleString():'–';
  $('s-ctotal-l').textContent=L[0]; $('s-copen-l').textContent=L[1]; $('s-c30-l').textContent=L[2];
}
function setSrc(src){
  csrc=src;
  document.querySelectorAll('.srcbar button').forEach(b=>b.classList.toggle('on',b.dataset.src===src));
  $('cinfo-ccf').style.display=src==='ccf'?'block':'none';
  $('cinfo-ma').style.display=src==='ma'?'block':'none';
  $('cflt-ccf').style.display=src==='ccf'?'block':'none';
  $('cflt-ma').style.display=src==='ma'?'block':'none';
  $('cresLbl').textContent=src==='ma'?'events':'conferences';
  $('openLbl').textContent=src==='ma'?'Upcoming events only':'Open calls only';
  $('openSub').textContent=src==='ma'?'hide events that already happened':'hide conferences with no upcoming deadline';
  $('cq').placeholder=src==='ma'?'Title, discipline, keyword…':'Acronym, name, place…';
  const sel=$('csort');
  sel.innerHTML= src==='ma'
    ? '<option value="tl">Date (upcoming first)</option><option value="az">Title A–Z</option>'
    : '<option value="dl">Deadline soonest</option><option value="ccf">CCF rank</option><option value="core">CORE rank</option><option value="az">Acronym A–Z</option>';
  const st=curState();
  if(st){ sel.value=st.sort; $('cq').value=st.q; $('openOnly').checked=st.open; }
  else { $('cq').value=''; $('openOnly').checked=true; }
  applyStats();
  $('clist').innerHTML=''; $('cpager').innerHTML=''; $('cresCount').textContent='0';
  $('maSetup').style.display='none';
  if(src==='ma') loadMa();
  else { cstatus(''); if(confsReady) refreshC(); else loadConfs(); }
}

async function loadConfs(force){
  if(confsLoading || (confsReady && !force)) return;
  confsLoading=true;
  try{
    const cached=await cacheGet('confs');
    if(cached && !force && (Date.now()-cached.ts)<CONF_TTL){
      useConfs(cached); return;
    }
    cstatus('Loading conference feed…');
    try{
      const res=await fetch(CONF_FEED);
      if(!res.ok) throw new Error('feed returned '+res.status);
      const confs=buildConfs(parseYAML(await res.text()));
      if(confs.length<50) throw new Error('feed parsed to only '+confs.length+' conferences');
      const payload={confs,ts:Date.now(),stamp:new Date().toLocaleString()};
      await cacheSet('confs',payload);
      useConfs(payload);
    }catch(e){
      if(cached){ useConfs(cached,' (offline — using saved copy)'); }
      else cstatus('Could not load the conference feed: '+e.message,true);
    }
  } finally { confsLoading=false; }
}
function useConfs(payload,note){
  C=payload.confs;
  confsReady=true;
  cstatus('');
  $('confStamp').textContent=payload.stamp+(note||'');
  const now=Date.now();
  const nexts=C.map(c=>confNext(c,now));
  ccfStats=[C.length, nexts.filter(Boolean).length, nexts.filter(n=>n&&(n.ts-now)<30*86400e3).length];
  if(csrc==='ccf') applyStats();
  const sel=$('csub');
  if(sel.options.length<=1){
    Object.keys(SUBS).sort((a,b)=>SUBS[a].localeCompare(SUBS[b])).forEach(k=>{
      const o=document.createElement('option'); o.value=k; o.textContent=SUBS[k]; sel.appendChild(o);
    });
  }
  if(!cstate) cstate={q:'',ranks:new Set(['A','B','C','N']),open:true,sub:'',sort:'dl',limit:60};
  renderConfs();
}

let cbound=false;
function bindConfsOnce(){
  if(cbound) return; cbound=true;
  document.querySelectorAll('#cchips .chip').forEach(ch=>{
    ch.addEventListener('click',()=>{
      ch.classList.toggle('on');
      if(!cstate) return;
      if(ch.classList.contains('on')) cstate.ranks.add(ch.dataset.r); else cstate.ranks.delete(ch.dataset.r);
      cstate.limit=60; renderConfs();
    });
  });
  $('cq').addEventListener('input',e=>{ const st=curState(); if(!st)return; st.q=e.target.value.toLowerCase().trim(); st.limit=60; refreshC(); });
  $('openOnly').addEventListener('change',e=>{ const st=curState(); if(!st)return; st.open=e.target.checked; st.limit=60; refreshC(); });
  $('csub').addEventListener('change',e=>{ if(!cstate)return; cstate.sub=e.target.value; cstate.limit=60; renderConfs(); });
  $('csort').addEventListener('change',e=>{ const st=curState(); if(!st)return; st.sort=e.target.value; refreshC(); });
  $('cresetBtn').addEventListener('click',()=>{
    if(csrc==='ma'){
      mstate={q:'',cat:'',open:true,sort:mstate?mstate.sort:'tl',limit:60};
      $('cq').value=''; $('openOnly').checked=true; $('macat').value='';
      renderMa(); return;
    }
    cstate={q:'',ranks:new Set(['A','B','C','N']),open:true,sub:'',sort:cstate?cstate.sort:'dl',limit:60};
    $('cq').value=''; $('openOnly').checked=true; $('csub').value='';
    document.querySelectorAll('#cchips .chip').forEach(ch=>ch.classList.add('on'));
    renderConfs();
  });
  $('confRefresh').addEventListener('click',()=>{ confsReady=false; loadConfs(true); });

  // ---- Morocco (CNRST) bindings ----
  document.querySelectorAll('.srcbar button').forEach(b=>b.addEventListener('click',()=>{ if(b.dataset.src!==csrc) setSrc(b.dataset.src); }));
  $('macat').addEventListener('change',e=>{ if(!mstate)return; mstate.cat=e.target.value; mstate.limit=60; renderMa(); });
  const maIngest=async f=>{
    const st=$('maStatus');
    try{
      st.classList.remove('err'); st.textContent='Reading '+f.name+'…';
      const evs=parseCnrstRss(await readFile(f));
      const payload={evs,ts:Date.now(),stamp:new Date().toLocaleDateString()+' · '+f.name+' · '+evs.length+' events'};
      await cacheSet('cnrst',payload);
      st.textContent='';
      useMa(payload);
    }catch(e){ st.textContent=e.message; st.classList.add('err'); }
  };
  $('maFile').addEventListener('change',e=>{ if(e.target.files[0]) maIngest(e.target.files[0]); });
  const madz=$('madz');
  madz.addEventListener('dragover',e=>{e.preventDefault();madz.classList.add('drag');});
  madz.addEventListener('dragleave',()=>madz.classList.remove('drag'));
  madz.addEventListener('drop',e=>{e.preventDefault();madz.classList.remove('drag'); if(e.dataTransfer.files[0]) maIngest(e.dataTransfer.files[0]);});
  $('maReload').addEventListener('click',()=>loadMa(true));
}

function fmtDeadline(ts){
  const d=new Date(ts);
  return d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})
    +' · '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
}
function renderConfs(){
  if(!confsReady||!cstate) return;
  const now=Date.now();
  const items=[];
  for(const c of C){
    if(!cstate.ranks.has(c.ccf||'N')) continue;
    if(cstate.sub && c.sub!==cstate.sub) continue;
    const next=confNext(c,now);
    if(cstate.open && !next) continue;
    if(cstate.q){
      const ed=next||c.led||{};
      const hay=(c.t+' '+c.desc+' '+(ed.place||'')+' '+(SUBS[c.sub]||'')).toLowerCase();
      if(!hay.includes(cstate.q)) continue;
    }
    items.push({c,next});
  }
  items.sort((x,y)=>{
    switch(cstate.sort){
      case 'ccf':{ const d=(ccfOrder[x.c.ccf]||9)-(ccfOrder[y.c.ccf]||9); return d!==0?d:(x.next?x.next.ts:Infinity)-(y.next?y.next.ts:Infinity); }
      case 'core':{ const d=(coreOrder[x.c.core]??9)-(coreOrder[y.c.core]??9); return d!==0?d:(x.next?x.next.ts:Infinity)-(y.next?y.next.ts:Infinity); }
      case 'az': return x.c.t.localeCompare(y.c.t);
      default:{ const d=(x.next?x.next.ts:Infinity)-(y.next?y.next.ts:Infinity); return d!==0?d:x.c.t.localeCompare(y.c.t); }
    }
  });
  $('cresCount').textContent=items.length.toLocaleString();
  const shown=items.slice(0,cstate.limit);
  const list=$('clist');
  if(!items.length){
    list.innerHTML='<div class="empty"><h3>No conferences match</h3><p>Try enabling more ranks, turning off “open calls only”, or clearing the search.</p></div>';
    $('cpager').innerHTML=''; return;
  }
  list.innerHTML=shown.map(({c,next})=>{
    const ed=next||c.led||{};
    const site=ed.link||'';
    const title=site?'<a href="'+esc(site)+'" target="_blank" rel="noopener">'+esc(c.t)+'</a>':esc(c.t);
    let dueHtml;
    if(next){
      const days=Math.max(0,Math.ceil((next.ts-now)/86400e3));
      const cls=days<=14?'due-soon':(days<=60?'due-mid':'due-far');
      dueHtml='<span class="due '+cls+'">in '+days+'d</span>'
        +'<div class="dueinfo"><b>'+esc(next.typ)+' deadline</b><br>'+esc(fmtDeadline(next.ts))
        +(next.cm?'<br>'+esc(next.cm):'')+'</div>';
    } else {
      dueHtml='<span class="due due-none">no open call</span>';
    }
    const core=c.core?'<div class="metric"><div class="v">'+esc(c.core)+'</div><div class="k">CORE</div></div>':'';
    const links='<div class="extlinks">'
      +(site?'<a href="'+esc(site)+'" target="_blank" rel="noopener">Website ↗</a>':'')
      +(c.dblp?'<a href="https://dblp.org/db/conf/'+esc(c.dblp)+'" target="_blank" rel="noopener">dblp ↗</a>':'')
      +'</div>';
    const when=(ed.date?esc(ed.date):'')+(ed.y&&!String(ed.date).includes(String(ed.y))?' '+esc(String(ed.y)):'');
    return '<div class="jrow">'
      +'<div class="qbadge q-'+esc(c.ccf||'N')+'"><span class="q">'+esc(c.ccf||'N')+'</span><span class="lbl">CCF</span></div>'
      +'<div class="jmain"><h3 class="jtitle">'+title+' <small>'+esc(c.desc)+'</small></h3>'
      +'<div class="jmeta">'+(ed.place?'<span class="pub">'+esc(ed.place)+'</span>':'')
      +(when?'<span class="dot"></span><span>'+when+'</span>':'')+'</div>'
      +'<div class="tags"><span class="tag area">'+esc(SUBS[c.sub]||c.sub)+'</span></div></div>'
      +'<div class="jside">'+dueHtml+core+links+'</div></div>';
  }).join('');
  const pager=$('cpager');
  if(items.length>shown.length){
    pager.innerHTML='<div class="more">Showing '+shown.length.toLocaleString()+' of '+items.length.toLocaleString()+'<br><button id="cloadmore">Show 60 more</button></div>';
    $('cloadmore').onclick=()=>{cstate.limit+=60;renderConfs();};
  } else if(items.length>60){
    pager.innerHTML='<div class="more">All '+items.length.toLocaleString()+' shown</div>';
  } else pager.innerHTML='';
}

/* ================= Morocco events (CNRST) =================
   Source: https://www.cnrst.ma/fr/liste-des-evenements/list?format=feed&type=rss
   The CNRST server sends no CORS headers, so the browser cannot fetch it
   directly — the user saves the RSS file once and drops it in. Each <item>
   carries the event title, page link, discipline (<category>) and the event
   date (<pubDate>). */
function parseCnrstRss(text){
  const doc=new DOMParser().parseFromString(text,'text/xml');
  if(doc.querySelector('parsererror')) throw new Error('That file isn’t valid XML/RSS — save the feed page itself (⌘S / Ctrl-S).');
  const norm=s=>s.toLowerCase().replace(/\s+/g,' ').trim();
  const tmp=document.createElement('div');
  const evs=[];
  for(const it of doc.querySelectorAll('item')){
    const g=t=>{const el=it.getElementsByTagName(t)[0];return el?el.textContent.trim():'';};
    let t=g('title'); const cat=g('category');
    const pm=t.match(/^(.*)\(([^)]*)\)\s*$/);          // feed appends "(discipline)" to titles
    if(pm && cat && norm(pm[2])===norm(cat)) t=pm[1].trim();
    if(!t) continue;
    const pd=g('pubDate'); const ts=pd?Date.parse(pd):NaN;
    tmp.innerHTML=g('description').replace(/<[^>]*>/g,' ');   // strip tags, keep entity decoding
    const snip=(tmp.textContent||'').replace(/\s+/g,' ').trim().slice(0,220);
    evs.push({t, url:g('link'), cat, ts:isNaN(ts)?null:ts, snip});
  }
  if(!evs.length) throw new Error('No events found in this file — is it the CNRST events RSS feed?');
  return evs;
}
/* The app never talks to cnrst.ma directly (no CORS there). A GitHub Action
   in this repo mirrors the feed daily; raw.githubusercontent.com serves it
   with CORS enabled. A same-directory copy is the second fallback (useful
   when self-hosting), and manual file drop remains the last resort. */
const MA_MIRRORS=[
  'https://raw.githubusercontent.com/Lamhour-Mohamed-Akram/Diamond-OA-Journal-Finder/main/cnrst.xml',
  'cnrst.xml'
];
const MA_TTL=24*3600e3;
let maLoading=false;
async function loadMa(force){
  if(maLoading) return;
  if(maReady && !force){ $('maSetup').style.display='none'; applyStats(); refreshC(); return; }
  maLoading=true;
  try{
    const cached=await cacheGet('cnrst');
    if(!force && cached && cached.evs && cached.evs.length && (Date.now()-cached.ts)<MA_TTL){
      useMa(cached); return;
    }
    if(csrc==='ma') cstatus('Loading Morocco events feed…');
    for(const url of MA_MIRRORS){
      try{
        const res=await fetch(url,{cache:'no-store'});
        if(!res.ok) throw new Error('feed returned '+res.status);
        const evs=parseCnrstRss(await res.text());
        const payload={evs,ts:Date.now(),stamp:new Date().toLocaleDateString()+' · auto-updated mirror · '+evs.length+' events'};
        await cacheSet('cnrst',payload);
        cstatus('');
        useMa(payload);
        return;
      }catch(e){ /* try the next mirror */ }
    }
    cstatus('');
    if(cached && cached.evs && cached.evs.length) useMa(cached,' (mirror unreachable — using saved copy)');
    else if(csrc==='ma'){ $('maSetup').style.display='block'; $('clist').innerHTML=''; $('cpager').innerHTML=''; }
  } finally { maLoading=false; }
}
function useMa(payload,note){
  M=payload.evs; maReady=true;
  $('maStamp').textContent=payload.stamp+(note||'');
  const now=Date.now();
  const up=M.filter(e=>e.ts&&e.ts>now);
  maStats=[M.length, up.length, up.filter(e=>(e.ts-now)<30*86400e3).length];
  const sel=$('macat'); sel.innerHTML='<option value="">All disciplines</option>';
  const cc={}; M.forEach(e=>{ if(e.cat) cc[e.cat]=(cc[e.cat]||0)+1; });
  Object.keys(cc).sort((a,b)=>cc[b]-cc[a]).forEach(c=>{
    const o=document.createElement('option'); o.value=c; o.textContent=c+' ('+cc[c]+')'; sel.appendChild(o);
  });
  if(!mstate) mstate={q:'',cat:'',open:true,sort:'tl',limit:60};
  if(csrc==='ma'){ $('maSetup').style.display='none'; applyStats(); renderMa(); }
}
function renderMa(){
  if(!maReady||!mstate) return;
  const now=Date.now();
  const items=M.filter(ev=>{
    if(mstate.open && !(ev.ts && ev.ts>now)) return false;
    if(mstate.cat && ev.cat!==mstate.cat) return false;
    if(mstate.q){
      const hay=(ev.t+' '+ev.cat+' '+ev.snip).toLowerCase();
      if(!hay.includes(mstate.q)) return false;
    }
    return true;
  });
  items.sort((a,b)=>{
    if(mstate.sort==='az') return a.t.localeCompare(b.t);
    const af=a.ts&&a.ts>now, bf=b.ts&&b.ts>now;
    if(af!==bf) return af?-1:1;        // upcoming before past
    if(af) return a.ts-b.ts;           // upcoming: soonest first
    return (b.ts||0)-(a.ts||0);        // past: most recent first
  });
  $('cresCount').textContent=items.length.toLocaleString();
  const shown=items.slice(0,mstate.limit);
  const list=$('clist');
  if(!items.length){
    list.innerHTML='<div class="empty"><h3>No events match</h3><p>Try turning off “upcoming events only” or clearing the search.</p></div>';
    $('cpager').innerHTML=''; return;
  }
  list.innerHTML=shown.map(ev=>{
    const d=ev.ts?new Date(ev.ts):null;
    const day=d?String(d.getDate()).padStart(2,'0'):'—';
    const mon=d?d.toLocaleDateString('en',{month:'short'}).toUpperCase()+' ’'+String(d.getFullYear()).slice(2):'';
    let due;
    if(d && ev.ts>now){
      const days=Math.max(0,Math.ceil((ev.ts-now)/86400e3));
      const cls=days<=14?'due-soon':(days<=60?'due-mid':'due-far');
      due='<span class="due '+cls+'">in '+days+'d</span>';
    } else due='<span class="due due-past">past</span>';
    const title=ev.url?'<a href="'+esc(ev.url)+'" target="_blank" rel="noopener">'+esc(ev.t)+'</a>':esc(ev.t);
    const dateLine=d?'<div class="dueinfo"><b>'+esc(d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}))+'</b></div>':'';
    return '<div class="jrow">'
      +'<div class="qbadge q-date"><span class="q">'+day+'</span><span class="lbl">'+esc(mon)+'</span></div>'
      +'<div class="jmain"><h3 class="jtitle">'+title+'</h3>'
      +(ev.snip?'<p class="jsnip">'+esc(ev.snip)+'</p>':'')
      +'<div class="tags">'+(ev.cat?'<span class="tag area">'+esc(ev.cat)+'</span>':'')+'</div></div>'
      +'<div class="jside">'+due+dateLine
      +(ev.url?'<div class="extlinks"><a href="'+esc(ev.url)+'" target="_blank" rel="noopener">Details ↗</a></div>':'')
      +'</div></div>';
  }).join('');
  const pager=$('cpager');
  if(items.length>shown.length){
    pager.innerHTML='<div class="more">Showing '+shown.length.toLocaleString()+' of '+items.length.toLocaleString()+'<br><button id="mloadmore">Show 60 more</button></div>';
    $('mloadmore').onclick=()=>{mstate.limit+=60;renderMa();};
  } else if(items.length>60){
    pager.innerHTML='<div class="more">All '+items.length.toLocaleString()+' shown</div>';
  } else pager.innerHTML='';
}
