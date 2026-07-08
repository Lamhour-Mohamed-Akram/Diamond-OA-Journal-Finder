/* ================= Journal finder ================= */
function match(r){
  if(!state.fees.has(r.dia?'dia':'apc')) return false;
  if(state.idxOnly && !r.idx) return false;
  if(!state.quarts.has(r.q||'')) return false;
  if(state.area && !(r.areas||'').includes(state.area)) return false;
  if(state.country && r.c!==state.country) return false;
  if(state.weeks<52){ if(r.w==null||r.w>state.weeks) return false; }
  if(state.q){
    const hay=(r.t+' '+r.pub+' '+r.cats+' '+r.areas+' '+r.dsub+' '+r.c).toLowerCase();
    if(!hay.includes(state.q)) return false;
  }
  return true;
}
function sortRecs(a,b){
  switch(state.sort){
    case 'sjr': return (b.sjr??-1)-(a.sjr??-1);
    case 'wk': return (a.w??999)-(b.w??999);
    case 'h': return (b.h??-1)-(a.h??-1);
    case 'az': return a.t.localeCompare(b.t);
    default:{const d=qRank[a.q||'']-qRank[b.q||''];return d!==0?d:(b.sjr??-1)-(a.sjr??-1);}
  }
}
function speedHtml(w){
  if(w==null) return '<div class="speed na"><div class="stop"><span>Turnaround</span><b class="val">n/a</b></div><div class="bar mid"><i style="width:0"></i></div></div>';
  const pct=Math.max(4,Math.min(100,(w/52)*100));
  const cls=w<=12?'fast':(w<=26?'mid':'slow');
  return '<div class="speed"><div class="stop"><span>Turnaround</span><b>'+w+'w</b></div><div class="bar '+cls+'"><i style="width:'+pct+'%"></i></div></div>';
}
function render(){
  const filtered=R.filter(match).sort(sortRecs);
  $('resCount').textContent=filtered.length.toLocaleString();
  const shown=filtered.slice(0,state.limit);
  const list=$('list');
  if(!filtered.length){
    list.innerHTML='<div class="empty"><h3>No journals match</h3><p>Try enabling more quartiles, turning off “indexed only”, or widening the turnaround.</p></div>';
    $('pager').innerHTML=''; return;
  }
  list.innerHTML=shown.map(r=>{
    const q=r.q||'none';
    const link=r.url?'<a href="'+esc(r.url)+'" target="_blank" rel="noopener">'+esc(r.t)+'</a>':esc(r.t);
    const sjr=r.sjr!=null?'<div class="metric"><div class="v">'+r.sjr.toFixed(3)+'</div><div class="k">SJR</div></div>':'';
    const hix=r.h!=null?'<div class="metric"><div class="v">'+r.h+'</div><div class="k">H-index</div></div>':'';
    const notIdx=!r.idx?'<span class="indexed-no">Not in SCImago</span>':'';
    const feeT=r.dia?'<span class="tag fee-ok">Diamond · free</span>'
                    :'<span class="tag fee">'+(r.fee?'APC: '+esc(r.fee):'Has fees')+'</span>';
    const areaT=(r.areas||'').split(';').map(s=>s.trim()).filter(Boolean).slice(0,3).map(a=>'<span class="tag area">'+esc(a)+'</span>').join('');
    const catT=(r.cats||'').split(';').map(s=>s.trim()).filter(Boolean).slice(0,3).map(c=>'<span class="tag">'+esc(c)+'</span>').join('');
    return '<div class="jrow">'
      +'<div class="qbadge q-'+q+'"><span class="q">'+(r.idx?(r.q||'—'):'—')+'</span><span class="lbl">'+(r.idx?'quartile':'unranked')+'</span></div>'
      +'<div class="jmain"><h3 class="jtitle">'+link+'</h3>'
      +'<div class="jmeta"><span class="pub">'+esc(r.pub||'—')+'</span><span class="dot"></span><span>'+esc(r.c||'')+'</span>'+(r.lang?'<span class="dot"></span><span>'+esc(r.lang)+'</span>':'')+'</div>'
      +'<div class="tags">'+feeT+areaT+catT+'</div></div>'
      +'<div class="jside">'+notIdx+'<div style="display:flex;gap:16px">'+sjr+hix+'</div>'+speedHtml(r.w)
      +'<div style="display:flex;gap:12px;align-items:center">'
      +(r.issn?'<button class="scopus-btn" data-issn="'+esc(r.issn)+'" data-title="'+esc(r.t)+'">✓ Check Scopus</button>':'')
      +(r.doaj?'<a href="'+esc(r.doaj)+'" target="_blank" rel="noopener" style="font-size:11px;color:var(--coral);font-weight:600;text-decoration:none">DOAJ ↗</a>':'')
      +'</div></div></div>';
  }).join('');
  const pager=$('pager');
  if(filtered.length>shown.length){
    pager.innerHTML='<div class="more">Showing '+shown.length.toLocaleString()+' of '+filtered.length.toLocaleString()+'<br><button id="loadmore">Show 60 more</button></div>';
    $('loadmore').onclick=()=>{state.limit+=60;render();};
  } else if(filtered.length>60){
    pager.innerHTML='<div class="more">All '+filtered.length.toLocaleString()+' shown</div>';
  } else pager.innerHTML='';
}
