/* ================= Journal finder ================= */
const APC_MAX=5000;   // slider ceiling - at max the price filter is off
function match(r){
  if(!state.fees.has(r.dia?'dia':'apc')) return false;
  if(r.src){                      // community-verified (not in DOAJ): shown only by their own toggle,
    if(!state.extra) return false; //   and never in SCImago, so the index / quartile filters don't apply
  } else {
    if(state.idxOnly && !r.idx) return false;
    if(!state.quarts.has(r.q||'')) return false;
  }
  if(state.area && !(r.areas||'').includes(state.area)) return false;
  if(state.country && r.c!==state.country) return false;
  if(state.weeks<52){ if(r.w==null||r.w>state.weeks) return false; }
  if(state.maxUsd<APC_MAX){ if(r.usd==null||r.usd>state.maxUsd) return false; }
  if(state.q){
    if(state.qISSN) return (r.issns||[r.issn]).includes(state.qISSN);
    if(state.qDOI){                      // resolved via Scopus → journal ISSNs
      if(!doiISSNs) return false;
      return (r.issns||[r.issn]).some(i=>doiISSNs.includes(i));
    }
    const hay=(r.t+' '+r.pub+' '+r.cats+' '+r.areas+' '+r.dsub+' '+r.c).toLowerCase();
    if(!hay.includes(state.q)) return false;
  }
  return true;
}
/* ISSN / DOI search: an ISSN matches the record directly; a DOI is resolved
   through the Scopus proxy to the journal's ISSNs, then the list re-renders. */
let doiISSNs=null, doiPending='', doiSeq=0;
function classifyQuery(){
  const raw=$('q').value.trim();
  const digits=raw.toUpperCase().replace(/[^0-9X]/g,'');
  state.qISSN=/^\d{7}[0-9X]$/.test(digits)&&/^[\d\-xX\s]+$/.test(raw)?digits:'';
  state.qDOI=!state.qISSN&&/^(https?:\/\/)?(dx\.)?doi\.org\/10\.\d{4,9}\/\S+$/i.test(raw)||/^10\.\d{4,9}\/\S+$/.test(raw)?raw.replace(/^.*doi\.org\//i,''):'';
  if(state.qDOI!==doiPending){
    doiPending=state.qDOI; doiISSNs=null;
    if(state.qDOI){
      const seq=++doiSeq;
      fetch(SCOPUS_FN+'?doi='+encodeURIComponent(state.qDOI)).then(r=>r.ok?r.json():null).then(d=>{
        if(seq!==doiSeq) return;
        doiISSNs=d&&!d.error?[d.issn,d.eIssn].map(x=>String(x||'').toUpperCase().replace(/[^0-9X]/g,'')).filter(x=>x.length===8):[];
        if(d&&d.publicationName&&!doiISSNs.length) doiISSNs=[];
        doiName=d&&d.publicationName||'';
        render();
      }).catch(()=>{ if(seq===doiSeq){ doiISSNs=[]; render(); } });
    }
  }
}
let doiName='';
/* Multi-key sort: state.sorts is an ordered list of {k,d} (d=1 asc, -1 desc).
   Missing values always sink to the bottom regardless of direction. */
const SORT_KEYS={
  q:  {label:'Quartile',   def:1,  val:r=>r.idx&&r.q?qRank[r.q]:null},
  sjr:{label:'SJR',        def:-1, val:r=>r.sjr},
  h:  {label:'H-index',    def:-1, val:r=>r.h},
  w:  {label:'Turnaround', def:1,  val:r=>r.w},
  usd:{label:'Price',      def:1,  val:r=>r.usd},
  t:  {label:'Title',      def:1,  val:r=>r.t.toLowerCase()},
};
const DEFAULT_SORTS=[];   // no key active: list falls back to quartile, then SJR, then title
function sortRecs(a,b){
  for(const {k,d} of state.sorts){
    const f=SORT_KEYS[k].val, x=f(a), y=f(b);
    if(x==null&&y==null) continue;
    if(x==null) return 1; if(y==null) return -1;
    if(x<y) return -d; if(x>y) return d;
  }
  const da=scopusStatus(a.issns), db=scopusStatus(b.issns);   // titles Scopus dropped sink below everything else
  const xa=da&&da.st!=='inactive'?1:0, xb=db&&db.st!=='inactive'?1:0;
  if(xa!==xb) return xa-xb;
  const d=qRank[a.idx&&a.q?a.q:'']-qRank[b.idx&&b.q?b.q:''];   // silent default order: quartile, higher SJR, title
  return d || (b.sjr??-1)-(a.sjr??-1) || a.t.localeCompare(b.t);
}
function speedHtml(w){
  if(w==null) return '<div class="speed na"><div class="stop"><span>'+t('Turnaround')+'</span><b class="val">'+t('n/a')+'</b></div><div class="bar mid"><i style="width:0"></i></div></div>';
  const pct=Math.max(4,Math.min(100,(w/52)*100));
  const cls=w<=12?'fast':(w<=26?'mid':'slow');
  return '<div class="speed"><div class="stop"><span>'+t('Turnaround')+'</span><b>'+w+'w</b></div><div class="bar '+cls+'"><i style="width:'+pct+'%"></i></div></div>';
}
function render(){
  syncHash();   // keep the URL shareable - it always reflects the current filters
  const filtered=R.filter(match).sort(sortRecs);
  $('resCount').textContent=filtered.length.toLocaleString();
  const shown=filtered.slice(0,state.limit);
  const list=$('list');
  if(!filtered.length){
    let msg='<div class="empty"><h3>'+t('No journals match')+'</h3><p>'+t('Try enabling more quartiles, turning off “indexed only”, or widening the turnaround.')+'</p></div>';
    if(state.qDOI&&doiISSNs===null) msg='<div class="empty"><h3>'+t('🔍 Resolving DOI via Scopus…')+'</h3></div>';
    else if(state.qDOI&&doiISSNs&&!doiISSNs.length) msg='<div class="empty"><h3>'+t('DOI not found in Scopus')+'</h3><p>'+t('Couldn’t resolve this DOI to a journal. Try the <b>Scopus</b> tab, or search the journal name.')+'</p></div>';
    else if(state.qDOI||state.qISSN){
      const what=state.qISSN?'ISSN '+fmtISSN(state.qISSN):(doiName?'<b>'+esc(doiName)+'</b>':t('this DOI’s journal'));
      const inS=state.qISSN?S.find(s=>s.issns.includes(state.qISSN)):(doiISSNs&&S.find(s=>s.issns.some(i=>doiISSNs.includes(i))));
      const ins=inS?t(', but it <b>is in Scopus</b> (SCImago {q}). ',{q:inS.q?t('best quartile <b>{q}</b>',{q:esc(inS.q)}):t('unranked')}):'. ';
      msg='<div class="empty"><h3>'+t('Not in the open-access (DOAJ) list')+'</h3><p>'+(I18N.lang==='en'?what+' isn’t a DOAJ open-access journal'+ins+'Check it on the <b>Scopus</b> tab. Also make sure the fee / quartile filters aren’t hiding it.':t('na.body',{what,ins}))+'</p></div>';
    }
    list.innerHTML=msg;
    $('pager').innerHTML=''; return;
  }
  list.innerHTML=shown.map(jrowHtml).join('');
  const pager=$('pager');
  if(filtered.length>shown.length){
    pager.innerHTML='<div class="more">'+t('Showing {a} of {b}',{a:shown.length.toLocaleString(),b:filtered.length.toLocaleString()})+'<br><button id="loadmore">'+t('Show 60 more')+'</button></div>';
    $('loadmore').onclick=()=>{state.limit+=60;render();};
  } else if(filtered.length>60){
    pager.innerHTML='<div class="more">'+t('All {n} shown',{n:filtered.length.toLocaleString()})+'</div>';
  } else pager.innerHTML='';
}
/* one journal card (shared by the Journals list and the AI match tab) */
function jrowHtml(r){
    const q=r.q||'none';
    const link=r.url?'<a href="'+esc(r.url)+'" target="_blank" rel="noopener">'+esc(r.t)+'</a>':esc(r.t);
    const sjr=r.sjr!=null?'<div class="metric"><div class="v">'+r.sjr.toFixed(3)+'</div><div class="k">SJR</div></div>':'';
    const hix=r.h!=null?'<div class="metric"><div class="v">'+r.h+'</div><div class="k">H-index</div></div>':'';
    const notIdx=!r.idx?'<span class="indexed-no">'+t('Not in SCImago')+'</span>':'';
    const info=r.src?'<span class="nodoaj"'+(r.ver?' title="'+t('Checked automatically on ')+esc(r.ver)+'"':'')+'>'+t('Not in DOAJ')+'</span>':'';
    const commT=r.src?'<span class="tag comm">'+t('Not in DOAJ · auto-checked')+'</span>':'';
    const feeT=r.dia?'<span class="tag fee-ok">'+t('Diamond · free')+'</span>'
                    :'<span class="tag fee">'+(r.fee?t('APC: ')+esc(r.fee)+(r.usd!=null&&!/USD/.test(r.fee)?' (≈ $'+r.usd.toLocaleString()+')':''):t('Has fees'))+'</span>';
    const areaT=(r.areas||'').split(';').map(s=>s.trim()).filter(Boolean).slice(0,3).map(a=>'<span class="tag area">'+esc(a)+'</span>').join('');
    const catT=catTags(r.cats);
    const fl=scopusFlag(r.idx?scopusStatus(r.issns):null);
    return '<div class="jrow'+fl.cls+(r.src?' comm':'')+'">'
      +'<div class="qbadge q-'+q+'"><span class="q">'+(r.idx?(r.q||'–'):'–')+'</span><span class="lbl">'+(r.idx?t('quartile'):t('unranked'))+'</span></div>'
      +'<div class="jmain"><h3 class="jtitle">'+link+'</h3>'
      +'<div class="jmeta"><span class="pub">'+esc(r.pub||'–')+'</span><span class="dot"></span><span>'+esc(r.c||'')+'</span>'+(r.lang?'<span class="dot"></span><span>'+esc(r.lang)+'</span>':'')+'</div>'
      +'<div class="tags">'+fl.tag+feeT+commT+areaT+'</div>'+(catT?'<div class="tags cats">'+catT+'</div>':'')+'</div>'
      +'<div class="jside'+(r.src?' comm':'')+'">'+info+notIdx+'<div style="display:flex;gap:16px">'+sjr+hix+'</div>'+speedHtml(r.w)
      +'<div style="display:flex;gap:12px;align-items:center">'
      +(r.issn?'<button class="scopus-btn" data-issn="'+esc(r.issn)+'" data-title="'+esc(r.t)+'">'+t('✓ Check Scopus')+'</button>':'')
      +(r.doaj?'<a href="'+esc(r.doaj)+'" target="_blank" rel="noopener" style="font-size:11px;color:var(--coral);font-weight:600;text-decoration:none">DOAJ ↗</a>':'')
      +'</div></div></div>';
}
