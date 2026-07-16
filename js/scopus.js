/* ================= Scopus check =================
   Searches the full SCImago source list (built from Scopus data — includes
   all source types, not only open access). Coverage years reveal journals
   that were dropped from Scopus but still advertise "Scopus indexed". */
function fmtISSN(n){ return n.slice(0,4)+'-'+n.slice(4); }

/* ---- per-journal Scopus popup ---- */
let modalSeq=0;
function closeModal(){ $('modal').style.display='none'; modalSeq++; }
async function openScopusModal(issn,title){
  const seq=++modalSeq;
  $('modalTitle').textContent=title||'Journal';
  $('modalBody').innerHTML='<div class="mv load">🔍 Checking Scopus live…</div>';
  $('modal').style.display='flex';
  // offline snapshot info for this ISSN (if the SCImago data is loaded)
  const snap=S.find(s=>s.issns.includes(issn));
  let d=null;
  try{
    const res=await fetch(SCOPUS_FN+'?issn='+encodeURIComponent(issn));
    if(res.ok) d=await res.json();
  }catch(e){}
  if(seq!==modalSeq) return;   // closed or superseded
  const issnLine='<div class="mv-row"><span>ISSN</span><b>'+esc(fmtISSN(issn))+'</b></div>';
  const scopusLink='<div class="modal-links"><a href="https://www.scopus.com/sources" target="_blank" rel="noopener">Verify on scopus.com/sources ↗</a></div>';
  if(d && !d.error){
    if(d.indexed){
      const yr=d.latestCoverDate?String(d.latestCoverDate).slice(0,4):'';
      const active=yr && (+yr>=(new Date().getFullYear()-1));
      $('modalBody').innerHTML='<div class="mv '+(active?'yes':'warn')+'">'
        +'<div class="mv-head">'+(active?'✓ Indexed in Scopus':'⚠ In Scopus — check recency')+'</div>'
        +'<div class="mv-body">'
        +issnLine
        +'<div class="mv-row"><span>Documents indexed</span><b>'+d.documentCount.toLocaleString()+'</b></div>'
        +(d.publicationName?'<div class="mv-row"><span>Source name</span><b>'+esc(d.publicationName)+'</b></div>':'')
        +(d.latestCoverDate?'<div class="mv-row"><span>Most recent paper</span><b>'+esc(d.latestCoverDate)+'</b></div>':'')
        +(snap&&snap.q?'<div class="mv-row"><span>SCImago quartile</span><b>'+esc(snap.q)+'</b></div>':'')
        +'</div>'+scopusLink
        +'<div class="modal-foot">Live from Scopus (Elsevier API)'+(active?'':' — latest indexed paper isn’t recent; the journal may have been discontinued from Scopus.')+'</div></div>';
    } else {
      $('modalBody').innerHTML='<div class="mv no"><div class="mv-head">✗ Not found in Scopus</div>'
        +'<div class="mv-body">'+issnLine
        +'<div class="mv-row"><span>Documents indexed</span><b>0</b></div></div>'
        +'<div class="mv-body" style="margin-top:6px">This ISSN returned no documents in Scopus — it is most likely <b>not indexed</b>. Be cautious of any “Scopus indexed” claim on the journal’s own site.</div>'
        +scopusLink+'<div class="modal-foot">Live from Scopus (Elsevier API)</div></div>';
    }
    return;
  }
  // proxy unavailable → fall back to the offline SCImago snapshot
  if(snap){
    const active=covActive(snap.cov);
    $('modalBody').innerHTML='<div class="mv '+(active?'yes':'warn')+'"><div class="mv-head">'+(active?'✓ In Scopus (snapshot)':'⚠ Coverage ended (snapshot)')+'</div>'
      +'<div class="mv-body">'+issnLine
      +'<div class="mv-row"><span>Scopus coverage</span><b>'+esc(snap.cov||'—')+'</b></div>'
      +(snap.q?'<div class="mv-row"><span>SCImago quartile</span><b>'+esc(snap.q)+'</b></div>':'')
      +'</div>'+scopusLink
      +'<div class="modal-foot">From the offline SCImago snapshot (live check unavailable).</div></div>';
  } else {
    $('modalBody').innerHTML='<div class="mv no"><div class="mv-head">✗ Not in Scopus</div>'
      +'<div class="mv-body">'+issnLine+'Not found in Scopus (offline snapshot; live check unavailable).</div>'
      +scopusLink+'</div>';
  }
}

/* Live check via the Netlify Scopus proxy (falls back silently when the proxy
   isn't available, e.g. running the file locally without `netlify dev`). */
const SCOPUS_FN='/.netlify/functions/scopus';
let liveSeq=0;
function looksDOI(s){ return /^10\.\d{4,9}\/\S+$/.test(s) || /doi\.org\/10\./i.test(s); }
async function liveScopus(kind,val){
  const box=$('slive'); if(!box) return;
  const seq=++liveSeq;
  box.innerHTML='<div class="live load">🔍 Checking Scopus live…</div>';
  let d=null;
  try{
    const qs=kind==='doi'?'doi='+encodeURIComponent(val.replace(/^.*doi\.org\//i,'')):'issn='+encodeURIComponent(val);
    const res=await fetch(SCOPUS_FN+'?'+qs);
    if(res.ok) d=await res.json();
  }catch(e){}
  if(seq!==liveSeq) return;            // a newer query superseded this one
  if(!d || d.error){ box.innerHTML=''; return; }   // proxy unavailable → rely on snapshot
  const label=kind==='doi'?'This paper':'This ISSN';
  if(d.indexed){
    const yr=d.latestCoverDate?String(d.latestCoverDate).slice(0,4):'';
    box.innerHTML='<div class="live yes"><div class="lv-top">✓ Indexed in Scopus'
      +'<span class="lv-badge">live</span></div>'
      +'<div class="lv-body">'+label+' is in Scopus — <b>'+d.documentCount.toLocaleString()+'</b> document'+(d.documentCount===1?'':'s')+' indexed'
      +(d.publicationName?' in <b>'+esc(d.publicationName)+'</b>':'')
      +(yr?'. Most recent indexed: <b>'+esc(d.latestCoverDate)+'</b>'+(+yr>=(new Date().getFullYear()-1)?' — actively covered':'')+'.':'.')
      +'</div><div class="lv-src">Live from Scopus (Elsevier API) · '+esc(d.query)+'</div></div>';
  } else {
    box.innerHTML='<div class="live no"><div class="lv-top">✗ Not found in Scopus'
      +'<span class="lv-badge">live</span></div>'
      +'<div class="lv-body">'+label+' returned <b>0</b> documents in Scopus. It is most likely <b>not indexed</b> — be cautious of any "Scopus indexed" claim.</div>'
      +'<div class="lv-src">Live from Scopus (Elsevier API) · '+esc(d.query)+'</div></div>';
  }
}

let sLimit=20, sLastQ='';
function renderScopus(){
  const box=$('slist'); if(!box) return;
  const raw=($('sq').value||'').trim();
  if(raw!==sLastQ){ sLastQ=raw; sLimit=20; }   // new search — restart pagination
  const digits=raw.toUpperCase().replace(/[^0-9X]/g,'');
  const isISSN=/^\d{7}[0-9X]$/.test(digits);
  const isDOI=looksDOI(raw);
  // fire the live check for exact ISSN / DOI
  if(isISSN) liveScopus('issn',digits);
  else if(isDOI) liveScopus('doi',raw);
  else { $('slive').innerHTML=''; liveSeq++; }

  if(isDOI && !S.length){ $('sresCount').textContent='–'; box.innerHTML=''; return; }
  if(!S.length){
    $('sresCount').textContent='–';
    box.innerHTML='<div class="empty"><h3>Load journal data first</h3><p>The offline snapshot uses the SCImago file. Go to the <b>Journals</b> tab and load the data once — then come back here. (Live ISSN/DOI checks work without it.)</p></div>';
    return;
  }
  if(!raw){
    $('sresCount').textContent='–';
    box.innerHTML='<div class="empty"><h3>Is it in Scopus?</h3><p>Type an <b>ISSN</b> or paper <b>DOI</b> for a live check, or a <b>journal name</b> to search the snapshot.<br>Green = currently covered · amber = coverage ended (possibly discontinued).</p></div>';
    return;
  }
  if(isDOI){ box.innerHTML='<div class="empty"><p>DOI checked live above. Search an ISSN or journal name to also browse the offline snapshot.</p></div>'; $('sresCount').textContent='–'; return; }
  let hits;
  if(isISSN){
    hits=S.filter(s=>s.issns.includes(digits));
  } else {
    const lq=raw.toLowerCase();
    hits=S.filter(s=>s.t.toLowerCase().includes(lq));
    hits.sort((a,b)=>{
      const ap=a.t.toLowerCase().startsWith(lq)?0:1, bp=b.t.toLowerCase().startsWith(lq)?0:1;
      return (ap-bp) || (a.t.length-b.t.length);
    });
  }
  $('sresCount').textContent=hits.length.toLocaleString();
  if(!hits.length){
    box.innerHTML='<div class="empty"><h3>✗ Not found in the Scopus source list</h3><p>“'+esc(raw)+'” doesn’t match any of the '+S.length.toLocaleString()+' sources in the SCImago/Scopus snapshot — it is most likely <b>not indexed in Scopus</b>.<br><br>Double-check the exact ISSN on <a href="https://www.scopus.com/sources" target="_blank" rel="noopener" style="color:var(--coral);font-weight:600">scopus.com/sources ↗</a> — and be careful with journals that claim indexing on their own website.</p></div>';
    return;
  }
  box.innerHTML=hits.slice(0,sLimit).map(s=>{
    const end=covEnd(s.cov);
    const active=covActive(s.cov);
    const verdict=active
      ?'<span class="tag fee-ok">✓ In Scopus — coverage '+esc(s.cov)+'</span>'
      :'<span class="tag fee">⚠ Coverage ended '+(end||'?')+' — may be discontinued from Scopus</span>';
    const q=s.q||'none';
    const issns=s.issns.map(fmtISSN).join(', ');
    const sjr=s.sjr!=null?'<div class="metric"><div class="v">'+s.sjr.toFixed(3)+'</div><div class="k">SJR</div></div>':'';
    const hix=s.h!=null?'<div class="metric"><div class="v">'+s.h+'</div><div class="k">H-index</div></div>':'';
    const areaT=(s.areas||'').split(';').map(x=>x.trim()).filter(Boolean).slice(0,3).map(a=>'<span class="tag area">'+esc(a)+'</span>').join('');
    return '<div class="jrow">'
      +'<div class="qbadge q-'+q+'"><span class="q">'+(s.q||'—')+'</span><span class="lbl">'+(s.q?'quartile':'unranked')+'</span></div>'
      +'<div class="jmain"><h3 class="jtitle">'+esc(s.t)+' <small>'+esc(s.ty)+(issns?' · ISSN '+esc(issns):'')+'</small></h3>'
      +'<div class="jmeta"><span class="pub">'+esc(s.pub||'—')+'</span></div>'
      +'<div class="tags">'+verdict+areaT+'</div></div>'
      +'<div class="jside"><div style="display:flex;gap:16px">'+sjr+hix+'</div>'
      +'<a href="https://www.scopus.com/sources" target="_blank" rel="noopener" style="font-size:11px;color:var(--coral);font-weight:600;text-decoration:none">Verify on scopus.com ↗</a>'
      +'</div></div>';
  }).join('')+(hits.length>sLimit
    ?'<div class="more">Showing '+Math.min(sLimit,hits.length).toLocaleString()+' of '+hits.length.toLocaleString()+'<br><button id="sloadmore">Show 20 more</button></div>'
    :(hits.length>20?'<div class="more">All '+hits.length.toLocaleString()+' shown</div>':''));
  const more=$('sloadmore');
  if(more) more.onclick=()=>{sLimit+=20;renderScopus();};
}
