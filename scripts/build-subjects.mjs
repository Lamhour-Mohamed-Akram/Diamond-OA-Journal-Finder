#!/usr/bin/env node
/* Generates one landing page per SCImago subject area from the bundled data
   (data/doaj.csv + data/scimago.csv), using the app's own join code so every
   number matches what the finder shows. Output:

     subjects/index.html            hub listing all areas
     subjects/<slug>/index.html     one page per area
     sitemap.xml                    rewritten with every page
     index.html                     "browse by subject" block refreshed
                                    (between <!-- subjects:start/end -->)

   Run after every data refresh:  node scripts/build-subjects.mjs
   Pure HTML output, no runtime dependency; the app itself is untouched. */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://openaccessfinder.de';
const TOP_N = 50;
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf-8');

/* ---- load the app's join logic (browser-neutral functions only) ---- */
const ctx = { indexedDB: undefined, console };
vm.createContext(ctx);
vm.runInContext(rd('js/data.js'), ctx, { filename: 'data.js' });
const { parseCSV, sniffDelim, doajCsvToInters, assemble } = ctx;

const load = f => { const t = rd(f); return parseCSV(t, sniffDelim(t.slice(0, t.indexOf('\n')))); };
const data = assemble(doajCsvToInters(load('data/doaj.csv')), load('data/scimago.csv'));
const R = data.records;
const stamp = (() => {
  const d = fs.statSync(path.join(ROOT, 'data/doaj.csv')).mtime;
  return d.toISOString().slice(0, 10);
})();
const monthYear = new Date(stamp).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

/* ---- helpers ---- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = a => a.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const num = n => n.toLocaleString('en-US');
const qRank = q => ({ Q1: 1, Q2: 2, Q3: 3, Q4: 4 }[q] || 5);
const byRank = (a, b) => qRank(a.q) - qRank(b.q) || (b.sjr ?? -1) - (a.sjr ?? -1) || a.t.localeCompare(b.t);
const top = (arr, key, n = 5) => {
  const c = new Map();
  for (const r of arr) { const k = (r[key] || '').trim(); if (k) c.set(k, (c.get(k) || 0) + 1); }
  return [...c].sort((a, b) => b[1] - a[1]).slice(0, n);
};
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const appLink = (area, extra = '') => SITE + '/#' + new URLSearchParams({ a: area, ...(extra && Object.fromEntries(new URLSearchParams(extra))) }).toString();

/* ---- per-area stats ---- */
const areas = data.areas.map(area => {
  const all = R.filter(r => r.areas && r.areas.split(';').some(x => x.trim() === area));
  const dia = all.filter(r => r.dia);
  const q = k => dia.filter(r => r.q === k).length;
  return {
    area, slug: slug(area), all, dia,
    q1: q('Q1'), q2: q('Q2'), q3: q('Q3'), q4: q('Q4'),
    apc: all.length - dia.length,
    countries: top(dia, 'c'), publishers: top(dia, 'pub'),
    langs: top(dia.map(r => ({ lang: (r.lang || '').split(',')[0] })), 'lang', 4),
    sorted: [...dia].sort(byRank),
    topList: [...dia].sort(byRank).slice(0, TOP_N),
  };
});
const totalDia = R.filter(r => r.dia).length;
const totalDiaIdx = R.filter(r => r.dia && r.idx).length;

/* ---- shared page chrome ---- */
const CSS = `
:root{--ink:#0E2A33;--ink-2:#1B4049;--paper:#F3F1EA;--paper-2:#EBE7DC;--line:#D8D2C4;--muted:#5E6B6A;--muted-2:#8A928C;--sea:#137C5A;--sea-soft:#E1F0E8;--coral:#E0563E;--card:#FBFAF5;--amber-soft:#F6EBD2}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--paper);color:var(--ink);font-family:Inter,system-ui,sans-serif;font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:var(--coral);font-weight:600;text-decoration:none}a:hover{text-decoration:underline}
.top{display:flex;align-items:center;gap:14px;padding:14px 24px;border-bottom:1px solid var(--line);background:var(--card)}
.top .mark{font-family:"IBM Plex Mono",monospace;font-weight:600;letter-spacing:.14em;font-size:11px;color:var(--coral)}
.top .brand{font-family:Spectral,Georgia,serif;font-weight:700;font-size:18px;color:var(--ink)}
.top nav{margin-left:auto;display:flex;gap:18px;font-size:13.5px}.top nav a{color:var(--ink-2)}
.wrap{max-width:980px;margin:0 auto;padding:36px 24px 70px}
.crumbs{font-size:12.5px;color:var(--muted-2);margin-bottom:18px}.crumbs a{color:var(--muted);font-weight:500}
h1{font-family:Spectral,Georgia,serif;font-weight:700;font-size:38px;line-height:1.1;margin:0 0 12px}
h2{font-family:Spectral,Georgia,serif;font-weight:700;font-size:24px;margin:38px 0 12px}
p.lead{font-size:17px;color:var(--ink-2);margin:0 0 22px;max-width:760px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:22px 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.stat b{display:block;font-family:"IBM Plex Mono",monospace;font-size:24px;color:var(--sea)}
.stat span{font-size:12.5px;color:var(--muted)}
.cta{display:inline-block;background:var(--sea);color:#fff;border-radius:10px;padding:12px 20px;font-weight:700;font-size:15px;margin:6px 10px 6px 0}
.cta:hover{filter:brightness(1.08);text-decoration:none}.cta.alt{background:var(--paper-2);color:var(--ink);border:1px solid var(--line)}
.tbl{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);background:var(--paper-2);white-space:nowrap}
tr:last-child td{border-bottom:0}td.n{color:var(--muted-2);font-family:"IBM Plex Mono",monospace;font-size:12px}
td a{color:var(--ink);font-weight:600}td a:hover{color:var(--coral)}
.q{display:inline-block;font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:12px;padding:2px 8px;border-radius:999px;background:var(--paper-2);color:var(--ink-2)}
.q.Q1{background:var(--sea-soft);color:var(--sea)}.q.Q2{background:#E4EEF6;color:#2A5C8A}.q.Q3{background:var(--amber-soft);color:#8A5F0C}.q.Q4{background:#F1E6E3;color:#8A3A2A}
.mono{font-family:"IBM Plex Mono",monospace;font-size:12.5px}.issn{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--muted-2)}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
.box{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.box h3{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.box ol{margin:0;padding-left:20px;font-size:13.5px}.box li{margin:3px 0}.box li span{color:var(--muted-2);font-family:"IBM Plex Mono",monospace;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.card{display:block;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;color:var(--ink);font-weight:600;transition:.12s}
.card:hover{border-color:var(--coral);text-decoration:none}.card small{display:block;font-weight:400;color:var(--muted);font-size:12.5px;margin-top:4px}
.note{font-size:13px;color:var(--muted);margin-top:20px;line-height:1.6}
.fbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:0 0 12px}
.fbar input,.fbar select{font-family:inherit;font-size:13px;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-width:150px}
.fbar input{flex:1 1 220px}
.freset{background:transparent;border:1px solid var(--line);border-radius:8px;padding:7px 11px;font-family:inherit;font-size:12.5px;font-weight:600;color:var(--coral);cursor:pointer}.freset:hover{border-color:var(--coral)}
.fcount{margin-left:auto;font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--muted)}
th[data-sort]{cursor:pointer;user-select:none}th[data-sort]:not(.on)::after{content:" ↕";color:var(--muted-2);font-size:10px}
th.on{color:var(--ink)}th .pri{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:var(--coral);color:#fff;font-size:10px;margin-left:4px;vertical-align:middle}th .dir{color:var(--sea);margin-left:3px}
.sorthint{flex-basis:100%;font-size:12px;color:var(--muted);margin-top:2px}th[data-sort]:hover{color:var(--ink)}
footer{border-top:1px solid var(--line);padding:22px 24px;font-size:12.5px;color:var(--muted)}
@media(max-width:600px){h1{font-size:30px}.wrap{padding:24px 16px 50px}.top nav{display:none}}
`;
const head = ({ title, desc, url, ld }) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="openaccessfinder.de">
<meta property="og:image" content="${SITE}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Cpolygon%20points='50,4%2096,50%2050,96%204,50'%20fill='%23E0563E'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Spectral:wght@700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
${ld.map(o => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n')}
</head>
<body>
<header class="top"><span class="mark">◆ OA</span><a class="brand" href="/">Diamond Open Access Journal Finder</a>
<nav><a href="/">Search journals</a><a href="/subjects/">All subjects</a><a href="/#tab=s">Scopus check</a></nav></header>
<main class="wrap">`;
const foot = () => `</main>
<footer>Data: <a href="https://doaj.org" rel="noopener">DOAJ</a> (journal list, fees) and <a href="https://www.scimagojr.com" rel="noopener">SCImago Journal Rank</a> (quartiles, SJR, Scopus coverage), snapshot of ${esc(monthYear)}. Pages regenerate automatically with every data refresh. Built by Mohamed-Akram Lamhour · <a href="/">openaccessfinder.de</a></footer>
</body>
</html>
`;
const crumbs = (...items) => `<div class="crumbs">${items.map(([t, h]) => h ? `<a href="${h}">${esc(t)}</a>` : esc(t)).join(' › ')}</div>`;
const breadcrumbLd = items => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url })) });

/* ---- one page per area ---- */
for (const a of areas) {
  const url = `${SITE}/subjects/${a.slug}/`;
  const n = a.dia.length;
  const title = `Diamond Open Access Journals in ${a.area}: ${num(n)} Free-to-Publish Journals Ranked`;
  const desc = `${num(n)} peer-reviewed open access journals in ${a.area} with no publication fee (no APC), ranked by SCImago quartile: ${num(a.q1)} in Q1 and ${num(a.q2)} in Q2. Updated ${monthYear}.`;
  const lang1 = r => (r.lang || '').split(',')[0].trim();
  const rows = a.sorted.map((r, i) => `<tr${i >= TOP_N ? ' hidden' : ''} data-q="${r.q || ''}" data-c="${esc(r.c)}" data-pub="${esc(r.pub)}" data-lang="${esc(lang1(r))}" data-w="${r.w ?? ''}" data-sjr="${r.sjr ?? ''}" data-h="${r.h ?? ''}">
<td class="n">${i + 1}</td>
<td><a href="${esc(r.url || r.doaj)}" rel="noopener nofollow" target="_blank">${esc(r.t)}</a><br><span class="issn">${esc(r.issn ? r.issn.slice(0, 4) + '-' + r.issn.slice(4) : '')}</span></td>
<td>${r.q ? `<span class="q ${r.q}">${r.q}</span>` : '<span class="q">–</span>'}</td>
<td class="mono">${r.sjr ?? '–'}</td>
<td class="mono">${r.h ?? '–'}</td>
<td>${esc(r.pub)}</td>
<td>${esc(r.c)}</td>
<td class="mono">${r.w != null ? r.w + ' wk' : '–'}</td>
</tr>`).join('\n');

  const list = (items, label) => items.length ? `<div class="box"><h3>${label}</h3><ol>${items.map(([k, v]) => `<li>${esc(k)} <span>${num(v)}</span></li>`).join('')}</ol></div>` : '';
  const ld = [
    breadcrumbLd([['Home', SITE + '/'], ['Subjects', SITE + '/subjects/'], [a.area, url]]),
    {
      '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description: desc, url,
      isPartOf: { '@type': 'WebSite', name: 'Diamond Open Access Journal Finder', url: SITE + '/' },
      dateModified: stamp,
      mainEntity: {
        '@type': 'ItemList', name: `Top Diamond open access journals in ${a.area}`, numberOfItems: a.topList.length,
        itemListElement: a.topList.slice(0, 20).map((r, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'Periodical', name: r.t, issn: r.issn || undefined, publisher: r.pub ? { '@type': 'Organization', name: r.pub } : undefined, url: r.url || undefined } })),
      },
    },
    {
      '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [
        { '@type': 'Question', name: `How many free-to-publish open access journals are there in ${a.area}?`, acceptedAnswer: { '@type': 'Answer', text: `As of ${monthYear}, ${num(n)} journals in ${a.area} listed in the DOAJ and indexed in Scopus charge no APC and no other author fees. ${num(a.q1)} of them are ranked Q1 and ${num(a.q2)} Q2 by SCImago.` } },
        { '@type': 'Question', name: `Which Diamond open access journal in ${a.area} has the highest ranking?`, acceptedAnswer: { '@type': 'Answer', text: a.topList[0] ? `${a.topList[0].t} (${a.topList[0].q || 'unranked'}, SJR ${a.topList[0].sjr ?? 'n/a'}), published by ${a.topList[0].pub || 'an independent publisher'}.` : 'No ranked journal in this area yet.' } },
      ],
    },
  ];
  const html = head({ title, desc, url, ld }) + `
${crumbs(['Home', '/'], ['Subjects', '/subjects/'], [a.area])}
<h1>Diamond open access journals in ${esc(a.area)}</h1>
<p class="lead">${num(n)} peer-reviewed journals in ${esc(a.area)} are <b>free to publish in</b>: no article processing charge and no other author fees, according to the <a href="https://doaj.org" rel="noopener">DOAJ</a>. All of them are indexed in Scopus and ranked below by their <a href="https://www.scimagojr.com" rel="noopener">SCImago</a> quartile and SJR score. Data snapshot: ${esc(monthYear)}.</p>
<div class="stats">
<div class="stat"><b>${num(n)}</b><span>journals with no APC</span></div>
<div class="stat"><b>${num(a.q1)}</b><span>ranked Q1 (top 25%)</span></div>
<div class="stat"><b>${num(a.q2)}</b><span>ranked Q2</span></div>
<div class="stat"><b>${num(a.q3 + a.q4)}</b><span>ranked Q3 or Q4</span></div>
<div class="stat"><b>${num(a.apc)}</b><span>more journals charge an APC</span></div>
</div>
<a class="cta" href="${appLink(a.area)}">Open all ${num(n)} in the finder →</a>
<a class="cta alt" href="${appLink(a.area, 'qt=Q1,Q2,Q3,Q4,none')}">Include Q3, Q4 and unranked</a>
<a class="cta alt" href="${appLink(a.area, 'f=apc,dia&qt=Q1,Q2,Q3,Q4,none')}">Include journals with fees</a>

<h2>All ${num(n)} free-to-publish journals in ${esc(a.area)}</h2>
<p>Sorted by best SCImago quartile, then SJR. Click a column header to sort by it; click a second column to add a tiebreak (sort levels combine in the order you pick them). Click a column again to reverse it, a third time to remove it. The search box narrows the list. Publication time is the journal's own DOAJ figure for the average number of weeks from submission to publication.</p>
<div class="fbar" id="fbar">
  <input type="search" id="f-q" placeholder="Search by title, publisher, country or ISSN…" autocomplete="off">
  <button id="f-reset" class="freset" type="button">✕ Reset</button>
  <span class="fcount" id="f-count"></span>
  <span class="sorthint" id="sorthint"></span>
</div>
<div class="tbl"><table id="jt">
<thead><tr><th>#</th><th data-sort="t">Journal</th><th data-sort="q">Quartile</th><th data-sort="sjr">SJR</th><th data-sort="h">H-index</th><th data-sort="pub">Publisher</th><th data-sort="c">Country</th><th data-sort="w">Time to publish</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>
<p class="note" id="more-note"><button id="show-all" class="cta alt" type="button">Show all ${num(n)} journals</button> Showing the first ${Math.min(TOP_N, n)}. The <a href="${appLink(a.area)}">interactive finder</a> adds live Scopus checks, CSV export and shareable filter links.</p>
<script>
(function(){
  var $=function(id){return document.getElementById(id)};
  var rows=[].slice.call(document.querySelectorAll('#jt tbody tr')), N=rows.length, LIMIT=${TOP_N}, showAll=false;
  rows.forEach(function(r,i){ r.dataset.rank=i; r.dataset.t=(r.cells[1].textContent+' '+r.dataset.pub+' '+r.dataset.c).toLowerCase(); });
  function apply(){
    var q=$('f-q').value.trim().toLowerCase(), i=0, shown=0;
    rows.forEach(function(r){
      if(!q||r.dataset.t.indexOf(q)>=0){ i++; var vis=showAll||q||i<=LIMIT; r.hidden=!vis; if(vis){ shown++; r.firstElementChild.textContent=i; } }
      else r.hidden=true;
    });
    $('f-count').textContent=q?(i+' of '+N+' match'):(shown+' of '+N);
    $('more-note').style.display=(q||showAll||N<=LIMIT)?'none':'';
  }
  $('f-q').addEventListener('input',apply);
  $('f-reset').addEventListener('click',function(){ $('f-q').value=''; showAll=false; sorts=[]; resort(); });
  $('show-all').addEventListener('click',function(){ showAll=true; apply(); });
  var rank={Q1:1,Q2:2,Q3:3,Q4:4,'':5}, DEF={sjr:-1,h:-1}, sorts=[];
  function key(r,k,d){ if(k==='q') return rank[r.dataset.q]; if(k==='sjr'||k==='h'||k==='w'){ var v=r.dataset[k]; return v===''?null:+v; } return (k==='t'?r.querySelector('a').textContent:r.dataset[k]).toLowerCase(); }
  function cmp(a,b){
    for(var i=0;i<sorts.length;i++){ var k=sorts[i].k, d=sorts[i].d, x=key(a,k), y=key(b,k);
      if(x==null&&y==null) continue; if(x==null) return 1; if(y==null) return -1;
      if(x<y) return -d; if(x>y) return d; }
    return +a.dataset.rank-+b.dataset.rank;
  }
  function paint(){
    [].forEach.call(document.querySelectorAll('#jt th[data-sort]'),function(th){
      var i=-1; sorts.forEach(function(s,j){ if(s.k===th.dataset.sort) i=j; });
      th.classList.toggle('on',i>=0);
      th.innerHTML=th.dataset.label+(i>=0?' <span class="pri">'+(i+1)+'</span><span class="dir">'+(sorts[i].d<0?'↓':'↑')+'</span>':'');
    });
    var h=document.getElementById('sorthint'); if(h) h.textContent=sorts.length?('Sorted by '+sorts.map(function(s){return document.querySelector('#jt th[data-sort="'+s.k+'"]').dataset.label+(s.d<0?' ↓':' ↑')}).join(', then ')):'Click a column to sort; click a second column to add a tiebreak.';
  }
  function resort(){ rows.sort(cmp); var tb=document.querySelector('#jt tbody'); rows.forEach(function(r){ tb.appendChild(r); }); paint(); apply(); }
  [].forEach.call(document.querySelectorAll('#jt th[data-sort]'),function(th){ th.dataset.label=th.textContent.trim(); th.addEventListener('click',function(){
    var k=th.dataset.sort, def=DEF[k]||1, i=-1; sorts.forEach(function(s,j){ if(s.k===k) i=j; });
    if(i<0) sorts.push({k:k,d:def}); else if(sorts[i].d===def) sorts[i].d=-def; else sorts.splice(i,1);
    resort(); }); });
  paint();
  apply();
})();
</script>

<h2>Where these journals come from</h2>
<div class="cols">
${list(a.countries, 'Top countries of publication')}
${list(a.publishers, 'Top publishers')}
${list(a.langs, 'Main manuscript languages')}
</div>

<h2>About this list</h2>
<p><b>Diamond open access</b> (also called Platinum) means the journal is free to read and free to publish in. The journals above are those the DOAJ records with "APC: no" and "other fees: no" and that SCImago lists under the subject area <i>${esc(a.area)}</i> (a journal can belong to several areas). Quartiles come from SCImago's SJR ranking for the latest edition: Q1 is the top 25% of journals in a category, Q4 the bottom 25%. Journals that are in the DOAJ but not in Scopus have no quartile and are not counted here; the finder can show them too.</p>
<p>Before submitting, always confirm the journal on its own website and in the DOAJ, verify Scopus indexing by ISSN with the <a href="/#tab=s">Scopus check</a> rather than trusting claims on the journal's site, and be wary of look-alike titles.</p>

<h2>Other subject areas</h2>
<div class="grid">
${areas.filter(o => o !== a).map(o => `<a class="card" href="/subjects/${o.slug}/">${esc(o.area)}<small>${num(o.dia.length)} free-to-publish journals · ${num(o.q1)} Q1</small></a>`).join('\n')}
</div>
` + foot();
  fs.mkdirSync(path.join(ROOT, 'subjects', a.slug), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'subjects', a.slug, 'index.html'), html);
}

/* ---- hub page ---- */
{
  const url = `${SITE}/subjects/`;
  const title = `Diamond Open Access Journals by Subject: ${areas.length} Fields, ${num(totalDiaIdx)} Free-to-Publish Journals`;
  const desc = `Browse ${num(totalDiaIdx)} Scopus-indexed open access journals with no publication fee across ${areas.length} subject areas, from Medicine to Computer Science, each ranked by SCImago quartile. Updated ${monthYear}.`;
  const ld = [
    breadcrumbLd([['Home', SITE + '/'], ['Subjects', url]]),
    { '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description: desc, url, dateModified: stamp, hasPart: areas.map(a => ({ '@type': 'WebPage', name: `Diamond open access journals in ${a.area}`, url: `${SITE}/subjects/${a.slug}/` })) },
  ];
  const sorted = [...areas].sort((x, y) => y.dia.length - x.dia.length);
  const html = head({ title, desc, url, ld }) + `
${crumbs(['Home', '/'], ['Subjects'])}
<h1>Free-to-publish open access journals by subject</h1>
<p class="lead">The DOAJ lists ${num(totalDia)} journals that charge no APC and no other author fees. ${num(totalDiaIdx)} of them are also indexed in Scopus and therefore carry a SCImago ranking. Pick a subject area to see how many exist in your field, which are Q1 or Q2, and who publishes them. Data snapshot: ${esc(monthYear)}.</p>
<div class="tbl"><table>
<thead><tr><th>Subject area</th><th>No-APC journals</th><th>Q1</th><th>Q2</th><th>Q3 + Q4</th><th>Share Q1/Q2</th></tr></thead>
<tbody>
${sorted.map(a => `<tr><td><a href="/subjects/${a.slug}/">${esc(a.area)}</a></td><td class="mono">${num(a.dia.length)}</td><td class="mono">${num(a.q1)}</td><td class="mono">${num(a.q2)}</td><td class="mono">${num(a.q3 + a.q4)}</td><td class="mono">${pct(a.q1 + a.q2, a.dia.length)}%</td></tr>`).join('\n')}
</tbody></table></div>
<p class="note">A journal can belong to more than one area, so the column does not sum to the total. Q counts use the journal's best quartile across its categories. Journals without a Scopus listing are not counted on these pages but are searchable in the <a href="/">finder</a>.</p>
<h2>What "Diamond open access" means</h2>
<p>Diamond (or Platinum) open access journals are free for readers and free for authors: no article processing charge, no submission fee, no page charges. They are typically funded by universities, research institutes, learned societies or public programmes. Publishing in them costs nothing and keeps your work openly available, which is why funders increasingly recommend them. The quality signal to look at is the same as for any journal: peer review process, indexing (Scopus, Web of Science) and the SCImago quartile, all of which the <a href="/">finder</a> shows for every title.</p>
` + foot();
  fs.mkdirSync(path.join(ROOT, 'subjects'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'subjects', 'index.html'), html);
}

/* ---- sitemap ---- */
{
  const urls = [[SITE + '/', '1.0'], [SITE + '/subjects/', '0.9'], ...areas.map(a => [`${SITE}/subjects/${a.slug}/`, '0.8'])];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([loc, pr]) => `  <url><loc>${loc}</loc><lastmod>${stamp}</lastmod><changefreq>weekly</changefreq><priority>${pr}</priority></url>`).join('\n')}
</urlset>
`;
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml);
}

/* ---- homepage "browse by subject" block ---- */
{
  const p = path.join(ROOT, 'index.html');
  let s = fs.readFileSync(p, 'utf-8');
  const block = `<!-- subjects:start (generated by scripts/build-subjects.mjs) -->
    <h2 style="margin-top:34px">Free-to-publish journals by subject</h2>
    <p>${num(totalDiaIdx)} Scopus-indexed journals with no APC, grouped by SCImago subject area. <a href="/subjects/">See all ${areas.length} areas →</a></p>
    <div class="subj-grid">
${[...areas].sort((x, y) => y.dia.length - x.dia.length).map(a => `      <a href="/subjects/${a.slug}/">${esc(a.area)} <span>${num(a.dia.length)}</span></a>`).join('\n')}
    </div>
    <!-- subjects:end -->`;
  const re = /<!-- subjects:start[\s\S]*?<!-- subjects:end -->/;
  if (re.test(s)) s = s.replace(re, block);
  else s = s.replace('    <p class="guide-foot">', block + '\n    <p class="guide-foot">');
  fs.writeFileSync(p, s);
}

console.log(`built ${areas.length} subject pages + hub · ${num(totalDiaIdx)} indexed no-APC journals · snapshot ${stamp}`);
for (const a of [...areas].sort((x, y) => y.dia.length - x.dia.length)) console.log(`  ${String(a.dia.length).padStart(5)}  Q1 ${String(a.q1).padStart(4)}  ${a.area}`);
