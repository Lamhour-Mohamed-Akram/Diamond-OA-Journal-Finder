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

   Calibration (all-MiniLM-L6-v2, OAE2 weighted field vectors): for a typical
   abstract the nearest journals score cos 0.30-0.45, the 98th percentile is
   ~0.19, the 95th ~0.135 and unrelated fields sit below 0.08.
   scope = (cos - 0.13) / 0.33 maps that to 0-95 %; the 20 % floor therefore
   sits at cos ≈ 0.196 (top ~2 % of journals). Re-check with `npm test`
   whenever embeddings.bin is rebuilt with another model or weights. */
/* ---- matching document: explicit per-field weights ----
   Journal vector = normalize( Σ weight_f · embed(field_f) ) over the topical
   fields below (built offline by scripts/build-embeddings.mjs and, for the
   journals not in DOAJ, in the browser). Cosine(manuscript, journal) is then
   the weighted sum of per-field cosines divided by the combined norm - so the
   weights are explicit and testable, no field is repeated as a hack, and no
   non-topical field (publisher, country, language, fees, quartile, SJR,
   H-index, turnaround, notes, URLs) is ever embedded. */
var AI_FIELD_WEIGHTS={title:0.15,keywords:0.35,subjects:0.30,categories:0.15,areas:0.05};
/* ---- official Aims & Scope evidence (offline enrichment, scripts/scope_enrichment) ----
   When a journal has an ACCEPTED official scope (official_scope_clean / official_scope_minor_noise,
   verified against the journal's own page), its vector is built from explicit evidence weights:
   official scope text 80 % · DOAJ keywords+subjects 15 % · SCImago categories 5 %. The title carries
   no weight in that case and never absorbs the scope weight when the scope is missing: journals
   without accepted scope keep the metadata scheme above and are labelled metadata-only.
   Only derived vectors and a status table (data/scope-evidence.csv) are deployed - never the text. */
var AI_EVIDENCE_WEIGHTS={scope:0.80,doaj:0.15,categories:0.05};
var AI_OFFICIAL=new Set(['official_scope_clean','official_scope_minor_noise']);
var AI_EVIDENCE_LABEL={official:'Official aims & scope',metadata:'Official scope unavailable — metadata only'};
/* SCOPE_EV: {issn8: {st, conf, url}} loaded from data/scope-evidence.csv (app.js); absent in tests unless injected */
var SCOPE_EV=(typeof SCOPE_EV!=='undefined')?SCOPE_EV:null;
function scopeEvidence(r,map){
  const m=map||SCOPE_EV; if(!m) return null;
  for(const i of (r.issns||[r.issn]).filter(Boolean)){ const e=m[i]||m.get&&m.get(i); if(e) return e; }
  return null;
}
/* 'official' when accepted official scope text backs the vector, else 'metadata' */
function journalEvidence(r,map){ const e=scopeEvidence(r,map); return e&&AI_OFFICIAL.has(e.st)?'official':'metadata'; }
function evidenceLabel(r,map){ return AI_EVIDENCE_LABEL[journalEvidence(r,map)]; }
/* the direct verification link: the official page the scope was taken from, else the journal site */
function verifyScopeUrl(r,map){ const e=scopeEvidence(r,map); return (e&&e.url)||r.url||''; }
/* generic terms carry no topical evidence on their own; they are removed from
   the journal fields before embedding (a keyword list left empty after this
   counts as "no meaningful keywords") */
var AI_GENERIC=/\b(research|researches|science|sciences|scientific|journal|journals|international|advances|advanced|system|systems|model|models|modeling|modelling|engineering|technology|technologies|analysis|data|intelligent|intelligence|energy|prediction|predictions|control|application|applications|applied|studies|study|review|reviews|general|innovation|innovative|development|management|open access|multidisciplinary|interdisciplinary)\b/gi;
function aiClean(s){ return String(s||'').replace(/\s*\(Q[1-4]\)\s*/g,' ').replace(/[|;]/g,', ').replace(/\s+/g,' ').trim(); }
/* item-level normalization: a field is split into items (commas, semicolons,
   pipes, LCC colons); an item made only of generic terms / connectors is
   dropped, compound items ("artificial intelligence", "computer science")
   are kept intact. "(miscellaneous)" and "(Qn)" tags are removed. */
var AI_CONNECT=/\b(and|of|for|in|the|on|to|with|its|their|general|miscellaneous)\b/gi;
function aiStripGeneric(s){
  const items=aiClean(s).replace(/\(miscellaneous\)/gi,' ').split(/[,;|:]+|\.\s+/);
  const kept=[];
  for(let it of items){
    it=it.replace(/\s+/g,' ').trim(); if(!it) continue;
    const core=it.replace(AI_GENERIC,' ').replace(AI_CONNECT,' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    if(core.length<3) continue;              // nothing but generic words
    kept.push(it);
  }
  return kept.join(', ');
}
/* the five topical fields, cleaned; empty string = field absent */
function journalFields(r){
  return {
    title:aiStripGeneric(r.t),
    keywords:aiStripGeneric(r.kw),
    subjects:aiStripGeneric(String(r.dsub||'').replace(/\|/g,', ')),
    categories:aiStripGeneric(r.cats),
    areas:aiStripGeneric(r.areas),
  };
}
/* metadata confidence: what topical evidence exists for this journal */
function aiConfidence(r,map){
  if(journalEvidence(r,map)==='official') return 'official';
  const f=journalFields(r);
  const kw=f.keywords.length>=3, sub=f.subjects.length>=3, cat=f.categories.length>=3||f.areas.length>=3, ti=f.title.length>=3;
  if(kw&&sub&&cat) return 'high';
  if(kw||sub) return 'medium';
  if(cat||ti) return 'low';
  return 'insufficient';
}
var AI_COS_LO=0.13, AI_COS_HI=0.46;
var AI_MIN_SCOPE=0.20;           // below this a journal is not shown at all
var AI_POSSIBLE=0.35;            // 35-49 %: "possible - verify aims & scope" section
var AI_MAIN=0.50;                // >= 50 %: a recommendation
var AI_GATE_BYPASS=0.50;         // strong direct evidence overrides the discipline gate (interdisciplinary work)
var AI_QS={Q1:1,Q2:.75,Q3:.5,Q4:.25,'':0};

function scopeFromCos(cos){ return Math.max(0,Math.min(1,(cos-AI_COS_LO)/(AI_COS_HI-AI_COS_LO))); }
/* label bucket for a scope percentage (0-100) */
function aiBucket(p){ return p>=70?'strong':p>=50?'good':p>=35?'possible':p>=20?'weak':'none'; }
/* presentation tier: main (>= 50 %), possible (35-49 %), weak (20-34 %, collapsed), or none */
function aiTier(scope){ return scope>=AI_MAIN?'main':scope>=AI_POSSIBLE?'possible':scope>=AI_MIN_SCOPE?'weak':'none'; }
/* low-confidence records (title / broad categories only) are never promoted
   above "possible"; insufficient ones are not matched at all */
/* only journals backed by accepted official scope can be a "main" recommendation; metadata-only
   journals (no official scope evidence) are capped at "possible" and shown in the separate
   "verify" section - they are never presented as an official-scope match */
function aiTierCap(tier,conf){ return tier==='main'&&conf!=='official'?'possible':tier; }
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
/* ---- specialist-scope gate ----
   Some journals have a narrow scope that a broad family (Engineering, Energy,
   Earth science, Business...) does not capture. If the journal's own text
   signals such a specialism, the manuscript must show direct evidence of the
   same specialism, otherwise the journal is excluded regardless of the
   cosine. Domain lexicon only - no journal names. */
var AI_SPECIALIST=[
  {id:'power-grid',   j:/\b(power (grid|system|transmission|electronic)s?|smart grid|electric(al)? power|energy interconnection|grid technolog)/i, m:/\b(grid|power system|transmission line|substation|electric(al)? power|voltage|load forecast|smart grid|distribution network)/i},
  {id:'vehicles',     j:/\b(vehicle|automotive|driving|autonomous car|traffic|transport(ation)?( engineering| systems?)?|railway|aviation|aeronautic|maritime|ship)/i, m:/\b(vehicle|car|driver|driving|traffic|road|transport|railway|aircraft|drone|ship|fleet|logistic)/i},
  {id:'built-env',    j:/\b(built environment|building(s| physics| construction| energy)|construction|hvac|indoor air|architectur|civil engineering|structural engineering)/i, m:/\b(building|indoor|hvac|construction|structural|civil|architect|urban|occupant)/i},
  {id:'supply-chain', j:/\b(supply chain|logistics|operations research|operations management|procurement|inventory)/i, m:/\b(supply chain|logistic|inventory|procurement|warehouse|operations|scheduling)/i},
  {id:'earth-atmo',   j:/\b(geophysic|meteorolog|climatolog|atmospheric science|oceanograph|hydrolog|geolog|seismolog|earth science)/i, m:/\b(weather|meteorolog|atmospher|climate change|climate model|earth|geolog|ocean|hydrolog|precipitation|rainfall|soil moisture|satellite|remote sensing)/i},
  {id:'medicine',     j:/\b(clinical|patient|medic(al|ine)|nursing|surg(ery|ical)|oncolog|cancer|hospital|disease|therap|pharmac|rehabilitat|dental|psychiatr)/i, m:/\b(patient|clinical|medical|disease|hospital|diagnos(is|tic)s? of|treatment|therap|cancer|tumou?r|health|nurs|surg)/i},
  {id:'law',          j:/\b(law|legal|jurisprud|legislat|judicial|court)/i, m:/\b(law|legal|regulat|liabilit|legislat|court|compliance|gdpr|jurisdiction)/i},
  {id:'religion-arts',j:/\b(theolog|religio|islamic studies|biblical|church|music|musicolog|literature|literary|linguistic|philosoph|theatre|fine arts|art history)/i, m:/\b(religio|theolog|faith|church|quran|bible|music|song|literary|novel|poem|linguistic|philosoph|artist)/i},
  {id:'finance',      j:/\b(finance|financial|banking|accounting|marketing|econom(ics|etric)|stock market|insurance)/i, m:/\b(financ|bank|accounting|marketing|econom|market price|stock|insurance|investment|revenue|firm)/i},
];
function journalScopeText(r){ return [r.t,r.kw,r.dsub,r.cats].map(x=>String(x||'')).join(' | '); }
/* a specialism only counts when it is the journal's DOMINANT scope: the title
   signals it, or at least half of the keyword / category / subject items do.
   One application keyword ("aeronautics" in a prognostics journal) or one
   Scopus category ("Transportation") is not enough. */
function specialistSignal(r,s){
  if(s.j.test(String(r.t||''))) return true;
  const items=[...String(r.kw||'').split(/[,;]+/),...String(r.cats||'').split(';'),...String(r.dsub||'').split('|')].map(x=>x.replace(/\(Q[1-4]\)/g,'').trim()).filter(Boolean);
  if(!items.length) return false;
  const hits=items.filter(it=>s.j.test(it)).length;
  return hits/items.length>=0.5;
}
/* returns the specialism id that blocks the journal, or null */
function specialistBlock(r,manuscriptLow){
  for(const s of AI_SPECIALIST){ if(!s.m.test(manuscriptLow)&&specialistSignal(r,s)) return s.id; }
  return null;
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
