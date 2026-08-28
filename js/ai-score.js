/* ================= AI match: pure scoring logic =================
   No DOM, no model calls - shared by js/ai.js (browser) and
   scripts/test-ai-match.mjs (node regression tests).

   Two separate numbers per journal:
   - scope  (0..1): topical relevance ONLY = calibrated cosine between the
     manuscript vector and the journal's scope vector. This is what the UI
     shows as the match percentage. APC / quartile never touch it.
   - rank   (0..1+): scope plus small preference bonuses (quartile, free to
     publish, shared keywords) used ONLY to order journals that already
     passed the relevance threshold. Never displayed as a percentage.

   Calibration (all-MiniLM-L6-v2, journal text = title + keywords + subjects
   + SCImago categories): for a typical abstract the nearest journals score
   cos 0.30-0.46, the 99th percentile is ~0.20 and unrelated fields sit
   below 0.07. scope = (cos - 0.12) / 0.38 maps that to 0-90 %. */
var AI_COS_LO=0.12, AI_COS_HI=0.50;
var AI_MIN_SCOPE=0.20;           // below this a journal is not a recommendation at all
var AI_GATE_BYPASS=0.50;         // strong direct evidence overrides the discipline gate (interdisciplinary work)
var AI_QS={Q1:1,Q2:.75,Q3:.5,Q4:.25,'':0};

function scopeFromCos(cos){ return Math.max(0,Math.min(1,(cos-AI_COS_LO)/(AI_COS_HI-AI_COS_LO))); }
/* label bucket for a scope percentage (0-100) */
function aiBucket(p){ return p>=70?'strong':p>=50?'good':p>=35?'possible':p>=20?'weak':'none'; }
/* ordering only: preferences are worth at most ~0.16 on top of scope */
function rankScore(scope,r,kwHits){ return scope+.08*AI_QS[r.idx&&r.q?r.q:'']+.03*(r.dia?1:0)+.05*Math.min(1,(kwHits||0)/3); }

/* ---- discipline families (normalized subject vocabulary) ----
   Each family has a short descriptor that is embedded once; the manuscript's
   families are the ones its vector is closest to. Journals get families from
   their SCImago areas and/or DOAJ (LCC) subject strings. */
var AI_FAMILIES={
  med:  'medicine, clinical medicine, health care, patients, disease diagnosis and treatment, nursing, surgery, oncology, pharmacology',
  bio:  'biology, biochemistry, genetics, molecular biology, microbiology, immunology, ecology, organisms',
  agri: 'agriculture, crop science, horticulture, greenhouse cultivation, soil, plant production, food science, animal science, veterinary',
  eng:  'engineering, mechanical, electrical, civil and industrial engineering, control systems, sensors, instrumentation, automation, energy systems, materials',
  cs:   'computer science, software, algorithms, machine learning, artificial intelligence, data science, internet of things, networks, signal processing',
  math: 'mathematics, statistics, applied mathematics, probability, optimization, mathematical modelling',
  phys: 'physics, astronomy, chemistry, materials science, chemical engineering, optics, quantum',
  earth:'earth sciences, geology, geography, climate, meteorology, environmental science, water, remote sensing',
  econ: 'economics, finance, business, management, accounting, marketing, entrepreneurship',
  social:'social sciences, sociology, education, political science, law, psychology, communication, public policy',
  arts: 'arts and humanities, literature, linguistics, history, philosophy, religion, theology, music, cultural studies',
};
var AI_AREA_FAM={
  'Medicine':['med'],'Nursing':['med'],'Dentistry':['med'],'Health Professions':['med'],'Pharmacology, Toxicology and Pharmaceutics':['med','bio'],
  'Neuroscience':['med','bio'],'Immunology and Microbiology':['med','bio'],'Veterinary':['med','agri'],
  'Biochemistry, Genetics and Molecular Biology':['bio'],'Agricultural and Biological Sciences':['agri','bio'],
  'Engineering':['eng'],'Energy':['eng'],'Materials Science':['eng','phys'],'Chemical Engineering':['eng','phys'],
  'Computer Science':['cs'],'Decision Sciences':['cs','math','econ'],'Mathematics':['math'],
  'Physics and Astronomy':['phys'],'Chemistry':['phys'],
  'Earth and Planetary Sciences':['earth'],'Environmental Science':['earth'],
  'Business, Management and Accounting':['econ'],'Economics, Econometrics and Finance':['econ'],
  'Social Sciences':['social'],'Psychology':['social'],'Arts and Humanities':['arts'],
  'Multidisciplinary':['*'],
};
/* DOAJ subjects are LCC strings like "Technology: Electrical engineering" or "Medicine: Internal medicine" */
var AI_LCC_RULES=[
  [/^medicine|nursing|pharmac|dentistry|surgery|therapeutics|public health/i,['med']],
  [/biolog|botany|zoology|microbiol|genetic|biochem|physiolog|ecolog/i,['bio']],
  [/^agriculture|plant culture|forestry|animal culture|aquaculture|food|horticult/i,['agri']],
  [/engineering|electrical|mechanical|manufactur|construction|hydraulic|mining|metallurg|chemical technology|building|transportation/i,['eng']],
  [/computer|information technology|cybernetics|telecommunication|electronics|software|data/i,['cs']],
  [/mathemat|statistic/i,['math']],
  [/physics|chemistry|astronom|optic/i,['phys']],
  [/geolog|geograph|environment|meteorolog|oceanogr|climat|hydrolog|natural resources|environmental/i,['earth']],
  [/commerce|business|finance|econom|management|industries|accounting|marketing/i,['econ']],
  [/^social|sociolog|education|law$|^law|political|psycholog|communication|anthropolog|recreation|sport|library|bibliograph|military|naval/i,['social']],
  [/language|literature|philosoph|religion|theolog|fine arts|music|history|arts$|humanities|linguist/i,['arts']],
  [/^technology$/i,['eng','cs']],
  [/^science$/i,['bio','phys','math','earth','cs']],
  [/general works/i,['*']],
];
function journalFamilies(r){
  if(r._fam) return r._fam;
  const f=new Set();
  for(const a of String(r.areas||'').split(';')){ const k=a.trim(); if(AI_AREA_FAM[k]) AI_AREA_FAM[k].forEach(x=>f.add(x)); }
  if(!f.size) for(const s of String(r.dsub||'').split('|')){
    const sub=s.trim(); if(!sub) continue;
    let hit=false;
    for(const [re,fams] of AI_LCC_RULES){ if(re.test(sub)){ fams.forEach(x=>f.add(x)); hit=true; break; } }
    if(!hit){ const top=sub.split(':')[0].trim(); for(const [re,fams] of AI_LCC_RULES){ if(re.test(top)){ fams.forEach(x=>f.add(x)); break; } } }
  }
  r._fam=[...f];
  return r._fam;
}
/* manuscript families from its cosine to each family descriptor:
   primary = best; secondaries = within 55 % of the best and above 0.10.
   Returns [] when nothing is convincing (then the gate is not applied). */
function manuscriptFamilies(cosByFam){
  const e=Object.entries(cosByFam).sort((a,b)=>b[1]-a[1]);
  if(!e.length||e[0][1]<0.10) return [];
  const cut=Math.max(0.10,e[0][1]*0.55);
  return e.filter(([,c])=>c>=cut).map(([k])=>k);
}
/* the discipline gate: a journal passes when it shares a family with the
   manuscript, is multidisciplinary / unclassified, or its scope alone is
   strong enough to be direct evidence of compatibility */
function gatePasses(r,msFams,scope){
  if(!msFams.length||scope>=AI_GATE_BYPASS) return true;
  const jf=journalFamilies(r);
  if(!jf.length||jf.includes('*')) return true;
  return jf.some(x=>msFams.includes(x));
}
