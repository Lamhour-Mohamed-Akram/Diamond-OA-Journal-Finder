/* ================= Scopus check =================
   Searches the full SCImago source list (built from Scopus data - includes
   all source types, not only open access). Coverage years reveal journals
   that were dropped from Scopus but still advertise "Scopus indexed". */
function fmtISSN(n){ return n.slice(0,4)+'-'+n.slice(4); }

/* ---- per-journal Scopus popup ---- */
let modalSeq=0;
function closeModal(){ $('modal').style.display='none'; modalSeq++; }
async function openScopusModal(issn,title){
  const seq=++modalSeq;
  $('modalTitle').textContent=title||t('Journal');
  $('modalBody').innerHTML='<div class="mv load">'+t('🔍 Checking Scopus live…')+'</div>';
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
  const stv=scopusStatus(snap?snap.issns:[issn]);
  const offLine=stv&&stv.st!=='inactive'?'<div class="mv-off">'+scopusFlag(stv).tag+'<div>'+t(stv.st==='policy'?'Removed from the Scopus index after a journal policy change.':'Removed from the Scopus index (quality or publication concerns). Its SCImago ranking is historical.')+' '+t('Source: Elsevier’s official Scopus source list.')+'</div></div>':'';
  const scopusLink='<div class="modal-links"><a href="https://www.scopus.com/sources" target="_blank" rel="noopener">'+t('Verify on scopus.com/sources ↗')+'</a></div>';
  if(d && !d.error){
    if(d.indexed){
      const yr=d.latestCoverDate?String(d.latestCoverDate).slice(0,4):'';
      const active=yr && (+yr>=(new Date().getFullYear()-1));
      const off=!!offLine;
      $('modalBody').innerHTML='<div class="mv '+(off?'no':(active?'yes':'warn'))+'">'
        +'<div class="mv-head">'+(off?t('⛔ Discontinued by Scopus'):t(active?'✓ Indexed in Scopus':'⚠ In Scopus, check recency'))+'</div>'
        +offLine
        +'<div class="mv-body">'
        +issnLine
        +'<div class="mv-row"><span>'+t('Documents indexed')+'</span><b>'+d.documentCount.toLocaleString()+'</b></div>'
        +(d.publicationName?'<div class="mv-row"><span>'+t('Source name')+'</span><b>'+esc(d.publicationName)+'</b></div>':'')
        +(d.latestCoverDate?'<div class="mv-row"><span>'+t('Most recent paper')+'</span><b>'+esc(d.latestCoverDate)+'</b></div>':'')
        +(snap&&snap.q?'<div class="mv-row"><span>'+t('SCImago best quartile')+'</span><b>'+esc(snap.q)+'</b></div>':'')
        +(snap&&snap.cats?'<div class="tags cats" style="margin-top:8px">'+catTags(snap.cats)+'</div>':'')
        +'</div>'+scopusLink
        +'<div class="modal-foot">'+t('Live from Scopus (Elsevier API)')+(active||off?'':t('. Latest indexed paper isn’t recent; the journal may have been discontinued from Scopus.'))+'</div></div>';
    } else {
      $('modalBody').innerHTML='<div class="mv no"><div class="mv-head">'+t('✗ Not found in Scopus')+'</div>'
        +'<div class="mv-body">'+issnLine
        +'<div class="mv-row"><span>'+t('Documents indexed')+'</span><b>0</b></div></div>'
        +'<div class="mv-body" style="margin-top:6px">'+t('This ISSN returned no documents in Scopus. It is most likely <b>not indexed</b>. Be cautious of any “Scopus indexed” claim on the journal’s own site.')+'</div>'
        +scopusLink+'<div class="modal-foot">'+t('Live from Scopus (Elsevier API)')+'</div></div>';
    }
    return;
  }
  // proxy unavailable → fall back to the offline SCImago snapshot
  if(snap){
    const active=covActive(snap.cov);
    const off=!!offLine;
    $('modalBody').innerHTML='<div class="mv '+(off?'no':(active?'yes':'warn'))+'"><div class="mv-head">'+(off?t('⛔ Discontinued by Scopus'):t(active?'✓ In Scopus (snapshot)':'⚠ Coverage ended (snapshot)'))+'</div>'
      +offLine
      +'<div class="mv-body">'+issnLine
      +'<div class="mv-row"><span>'+t('Scopus coverage')+'</span><b>'+esc(snap.cov||'–')+'</b></div>'
      +(snap.q?'<div class="mv-row"><span>'+t('SCImago best quartile')+'</span><b>'+esc(snap.q)+'</b></div>':'')
      +(snap.cats?'<div class="tags cats" style="margin-top:8px">'+catTags(snap.cats)+'</div>':'')
      +'</div>'+scopusLink
      +'<div class="modal-foot">'+t('From the offline SCImago snapshot (live check unavailable).')+'</div></div>';
  } else {
    $('modalBody').innerHTML='<div class="mv no"><div class="mv-head">'+t('✗ Not in Scopus')+'</div>'
      +'<div class="mv-body">'+issnLine+t('Not found in Scopus (offline snapshot; live check unavailable).')+'</div>'
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
  box.innerHTML='<div class="live load">'+t('🔍 Checking Scopus live…')+'</div>';
  let d=null;
  try{
    const qs=kind==='doi'?'doi='+encodeURIComponent(val.replace(/^.*doi\.org\//i,'')):'issn='+encodeURIComponent(val);
    const res=await fetch(SCOPUS_FN+'?'+qs);
    if(res.ok) d=await res.json();
  }catch(e){}
  if(seq!==liveSeq) return;            // a newer query superseded this one
  if(!d || d.error){ box.innerHTML=''; return; }   // proxy unavailable → rely on snapshot
  const label=t(kind==='doi'?'This paper':'This ISSN');
  if(d.indexed){
    const yr=d.latestCoverDate?String(d.latestCoverDate).slice(0,4):'';
    // SCImago quartile from the offline snapshot: match by ISSN (the queried one
    // or the ones Scopus returned), else by exact source name
    const issns=[kind==='issn'?val:'',d.issn,d.eIssn].map(x=>String(x||'').toUpperCase().replace(/[^0-9X]/g,'')).filter(x=>x.length===8);
    let snap=S.find(s=>s.issns.some(i=>issns.includes(i)));
    if(!snap && d.publicationName){ const pn=d.publicationName.toLowerCase(); snap=S.find(s=>s.t.toLowerCase()===pn); }
    const qLine=snap?'<div class="lv-q"><span class="qbadge q-'+(snap.q||'none')+'"><span class="q">'+(snap.q||'–')+'</span><span class="lbl">'+t(snap.q?'quartile':'unranked')+'</span></span>'
      +'<span>'+(snap.q?t('SCImago best quartile <b>{q}</b>',{q:esc(snap.q)}):t('SCImago <b>unranked</b>'))+(snap.sjr!=null?' · SJR <b>'+snap.sjr.toFixed(3)+'</b>':'')+(snap.h!=null?' · H-index <b>'+snap.h+'</b>':'')+'</span></div>'
      :(S.length?'<div class="lv-q"><span>'+t('No SCImago ranking found for this journal in the snapshot.')+'</span></div>':'');
    const catLine=snap&&snap.cats?'<div class="tags cats" style="margin-top:8px">'+catTags(snap.cats)+'</div>':'';
    const s1=d.documentCount===1?'':'s';
    const body=I18N.lang==='en'
      ? label+' is in Scopus: <b>'+d.documentCount.toLocaleString()+'</b> document'+s1+' indexed'+(d.publicationName?' in <b>'+esc(d.publicationName)+'</b>':'')+(yr?'. Most recent indexed: <b>'+esc(d.latestCoverDate)+'</b>'+(+yr>=(new Date().getFullYear()-1)?' (actively covered)':'')+'.':'.')
      : t('lv.yes',{label,n:d.documentCount.toLocaleString(),s:s1,in:d.publicationName?t(' in <b>{name}</b>',{name:esc(d.publicationName)}):'',recent:yr?t('. Most recent indexed: <b>{d}</b>{active}.',{d:esc(d.latestCoverDate),active:+yr>=(new Date().getFullYear()-1)?t(' (actively covered)'):''}):'.'});
    const stv=scopusStatus(snap?snap.issns:issns), off=stv&&stv.st!=='inactive';
    const offLine=off?'<div class="lv-off">'+scopusFlag(stv).tag+' '+t(stv.st==='policy'?'Removed from the Scopus index after a journal policy change.':'Removed from the Scopus index (quality or publication concerns). Its SCImago ranking is historical.')+' '+t('Source: Elsevier’s official Scopus source list.')+'</div>':'';
    box.innerHTML='<div class="live '+(off?'no':'yes')+'"><div class="lv-top">'+(off?t('⛔ Discontinued by Scopus'):t('✓ Indexed in Scopus'))
      +'<span class="lv-badge">'+t('live')+'</span></div>'
      +offLine+'<div class="lv-body">'+body
      +'</div>'+qLine+catLine+'<div class="lv-src">'+t('Live from Scopus (Elsevier API)')+' · '+esc(d.query)+'</div></div>';
  } else {
    box.innerHTML='<div class="live no"><div class="lv-top">'+t('✗ Not found in Scopus')
      +'<span class="lv-badge">'+t('live')+'</span></div>'
      +'<div class="lv-body">'+(I18N.lang==='en'?label+' returned <b>0</b> documents in Scopus. It is most likely <b>not indexed</b>. Be cautious of any "Scopus indexed" claim.':t('lv.no',{label}))+'</div>'
      +'<div class="lv-src">'+t('Live from Scopus (Elsevier API)')+' · '+esc(d.query)+'</div></div>';
  }
}

let sLimit=20, sLastQ='';
function renderScopus(){
  const box=$('slist'); if(!box) return;
  const raw=($('sq').value||'').trim();
  if(raw!==sLastQ){ sLastQ=raw; sLimit=20; }   // new search - restart pagination
  const digits=raw.toUpperCase().replace(/[^0-9X]/g,'');
  const isISSN=/^\d{7}[0-9X]$/.test(digits);
  const isDOI=looksDOI(raw);
  // fire the live check for exact ISSN / DOI
  if(isISSN) liveScopus('issn',digits);
  else if(isDOI) liveScopus('doi',raw);
  else { $('slive').innerHTML=''; liveSeq++; }

  if(isDOI && !S.length){ $('sresCount').textContent=''; box.innerHTML=''; return; }
  if(!S.length){
    $('sresCount').textContent='';
    box.innerHTML='<div class="empty"><h3>'+t('Load journal data first')+'</h3><p>'+t('The offline snapshot uses the SCImago file. Go to the <b>Journals</b> tab and load the data once, then come back here. (Live ISSN/DOI checks work without it.)')+'</p></div>';
    return;
  }
  if(!raw){
    $('sresCount').textContent='';
    box.innerHTML='<div class="empty"><h3>'+t('Is it in Scopus?')+'</h3><p>'+t('Type an <b>ISSN</b> or paper <b>DOI</b> for a live check, or a <b>journal name</b> to search the snapshot.<br>Green = currently covered · amber = coverage ended (possibly discontinued).')+'</p></div>';
    return;
  }
  if(isDOI){ box.innerHTML='<div class="empty"><p>'+t('DOI checked live above. Search an ISSN or journal name to also browse the offline snapshot.')+'</p></div>'; $('sresCount').textContent=''; return; }
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
    const enBody='“'+esc(raw)+'” doesn’t match any of the '+S.length.toLocaleString()+' sources in the SCImago/Scopus snapshot. It is most likely <b>not indexed in Scopus</b>.<br><br>Double-check the exact ISSN on <a href="https://www.scopus.com/sources" target="_blank" rel="noopener" style="color:var(--coral);font-weight:600">scopus.com/sources ↗</a>, and be careful with journals that claim indexing on their own website.';
    box.innerHTML='<div class="empty"><h3>'+t('✗ Not found in the Scopus source list')+'</h3><p>'+(I18N.lang==='en'?enBody:t('snf.body',{q:esc(raw),n:S.length.toLocaleString()}))+'</p></div>';
    return;
  }
  box.innerHTML=hits.slice(0,sLimit).map(s=>{
    const end=covEnd(s.cov);
    const active=covActive(s.cov);
    const stv=scopusStatus(s.issns), fl=scopusFlag(stv);
    const verdict=stv&&stv.st!=='inactive'?fl.tag
      :(stv?'<span class="tag fee">'+t('⚠ Scopus coverage ended{y}',{y:stv.y?' ('+stv.y+')':''})+'</span>'
      :(active
      ?'<span class="tag fee-ok">'+t('✓ In Scopus, coverage {c}',{c:esc(s.cov)})+'</span>'
      :'<span class="tag fee">'+t('⚠ Coverage ended {y}, may be discontinued from Scopus',{y:end||'?'})+'</span>'));
    const q=s.q||'none';
    const issns=s.issns.map(fmtISSN).join(', ');
    const sjr=s.sjr!=null?'<div class="metric"><div class="v">'+s.sjr.toFixed(3)+'</div><div class="k">SJR</div></div>':'';
    const hix=s.h!=null?'<div class="metric"><div class="v">'+s.h+'</div><div class="k">H-index</div></div>':'';
    const areaT=(s.areas||'').split(';').map(x=>x.trim()).filter(Boolean).slice(0,3).map(a=>'<span class="tag area">'+esc(a)+'</span>').join('');
    return '<div class="jrow'+fl.cls+'">'
      +'<div class="qbadge q-'+q+'"><span class="q">'+(s.q||'–')+'</span><span class="lbl">'+t(s.q?'quartile':'unranked')+'</span></div>'
      +'<div class="jmain"><h3 class="jtitle">'+esc(s.t)+' <small>'+esc(s.ty)+(issns?' · ISSN '+esc(issns):'')+'</small></h3>'
      +'<div class="jmeta"><span class="pub">'+esc(s.pub||'–')+'</span></div>'
      +'<div class="tags">'+verdict+areaT+'</div>'+(s.cats?'<div class="tags cats">'+catTags(s.cats)+'</div>':'')+'</div>'
      +'<div class="jside"><div style="display:flex;gap:16px">'+sjr+hix+'</div>'
      +'<a href="https://www.scopus.com/sources" target="_blank" rel="noopener" style="font-size:11px;color:var(--coral);font-weight:600;text-decoration:none">'+t('Verify on scopus.com ↗')+'</a>'
      +'</div></div>';
  }).join('')+(hits.length>sLimit
    ?'<div class="more">'+t('Showing {a} of {b}',{a:Math.min(sLimit,hits.length).toLocaleString(),b:hits.length.toLocaleString()})+'<br><button id="sloadmore">'+t('Show 20 more')+'</button></div>'
    :(hits.length>20?'<div class="more">'+t('All {n} shown',{n:hits.length.toLocaleString()})+'</div>':''));
  const more=$('sloadmore');
  if(more) more.onclick=()=>{sLimit+=20;renderScopus();};
}
