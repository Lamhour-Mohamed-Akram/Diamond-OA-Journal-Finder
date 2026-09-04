#!/usr/bin/env node
/* Precomputes one semantic embedding per DOAJ journal for the in-browser
   "AI match" tab (js/ai.js). Output: data/embeddings.bin

   Model: Xenova/all-MiniLM-L6-v2 (384 dims, int8 ONNX, ~23 MB), the same
   model the browser runs through Transformers.js, so both sides live in the
   same vector space. Each journal's vector is the weighted sum of separate
   field embeddings - title, DOAJ keywords, DOAJ subjects, SCImago categories,
   SCImago areas - with explicit weights from js/ai-score.js and generic terms
   removed (DOAJ has no aims & scope text, only a URL to it). In the app, only the visitor's abstract is embedded live; the
   journals are compared against this file with a cosine similarity.

   Binary layout (little-endian):
     "OAE3"            4 bytes  magic / format version (OAE3 = weighted per-field vectors + official-scope evidence vectors)
     uint32 n          number of journals
     uint32 dim        vector length (384)
     float32 scale     int8 → float multiplier (vectors are unit-length)
     n × 8 bytes       ISSN (ASCII, digits/X) the app joins on
     n × dim int8      quantized vectors, row-major
     n × 8 bytes       (trailing, optional) input signature per journal for incremental rebuilds; readers ignore it
   ≈ 9 MB for 23k journals (fp32 would be 35 MB). Quantization error is far
   below the differences that matter for ranking.

   Run after every DOAJ refresh:
     cd scripts && npm install && npm run build:embeddings            # incremental: only new/changed journals are embedded
     cd scripts && npm run build:embeddings -- --full                  # re-embed everything (model or weight change)
     cd scripts && npm run build:embeddings -- --reuse                 # CI: also keep vectors whose scope text isn't on this machine
   First run downloads the model from the Hugging Face hub (cached afterwards). */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data/embeddings.bin');
const MODEL = 'Xenova/all-MiniLM-L6-v2';
const BATCH = 64;
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf-8');

/* ---- load the app's join logic so the journal set is exactly the app's ---- */
const ctx = { indexedDB: undefined, console };
vm.createContext(ctx);
vm.runInContext(rd('js/data.js'), ctx, { filename: 'data.js' });
const { parseCSV, sniffDelim, doajCsvToInters, assemble } = ctx;
const load = f => { const t = rd(f); return parseCSV(t, sniffDelim(t.slice(0, t.indexOf('\n')))); };
const R = assemble(doajCsvToInters(load('data/doaj.csv')), load('data/scimago.csv')).records.filter(r => r.issn);

/* ---- the matching document: per-field embeddings combined with explicit
   weights (AI_FIELD_WEIGHTS in js/ai-score.js), generic terms removed ---- */
vm.runInContext(rd('js/ai-score.js'), ctx, { filename: 'ai-score.js' });
const { journalFields, AI_FIELD_WEIGHTS, aiConfidence, AI_EVIDENCE_WEIGHTS, AI_OFFICIAL } = ctx;
const FIELDS = Object.keys(AI_FIELD_WEIGHTS);

/* ---- official Aims & Scope evidence (offline enrichment; ignored local outputs) ----
   data/scope-evidence.csv: status per ISSN (deployed, no text);
   out/scope_v2/cache/embedding_inputs.jsonl: the verbatim official scope text per DOAJ row (never deployed).
   Journals with an ACCEPTED official scope get vector = normalize(0.80·scope + 0.15·doaj(keywords+subjects) + 0.05·categories);
   the title carries no weight there. Everything else keeps the metadata scheme (AI_FIELD_WEIGHTS). */
const EV_CSV = path.join(ROOT, 'data/scope-evidence.csv'), EV_TXT = path.join(ROOT, 'out/scope_v2/cache/embedding_inputs.jsonl');
const SCOPE_EV = {}; const SCOPE_TXT = new Map();
if (fs.existsSync(EV_CSV)) for (const row of parseCSV(rd('data/scope-evidence.csv'), ',').slice(1)) { const [a, b, st, conf, url] = row; if (st) { if (a) SCOPE_EV[a] = { st, conf: +conf, url }; if (b) SCOPE_EV[b] = { st, conf: +conf, url }; } }
if (fs.existsSync(EV_TXT)) for (const line of fs.readFileSync(EV_TXT, 'utf-8').split('\n')) { if (!line.trim()) continue; const o = JSON.parse(line); if (o.official_scope_text && o.key) SCOPE_TXT.set(o.key.replace(/-/g, '').toUpperCase(), o.official_scope_text); }
/* PJIP export (data/pjip-scopes.json, CC BY-NC, shipped): licensed Aims & Scope text, used as the scope
   evidence when the local crawl cache has none for the journal (that is always the case in CI, where out/ is absent) */
const PJIP_JSON = path.join(ROOT, 'data/pjip-scopes.json'); const PJIP = fs.existsSync(PJIP_JSON) ? JSON.parse(rd('data/pjip-scopes.json')) : null;
const pjipText = r => { if (!PJIP) return null; for (const i of r.issns || []) { const k = PJIP.issns[i]; if (k != null) return PJIP.j[k].t; } return null; };
const officialText = r => { const e = ctx.scopeEvidence(r, SCOPE_EV); if (!e || !AI_OFFICIAL.has(e.st)) return null; for (const i of r.issns || []) { const t = SCOPE_TXT.get(i); if (t) return t; } return pjipText(r); };
/* --reuse: keep the vector already in data/embeddings.bin for journals whose official scope text is not
   available on this machine (CI has neither out/ nor the crawl cache) instead of downgrading them to a
   metadata-only vector; only journals that are new or whose text is at hand are (re)embedded. */
/* Incremental builds (default): the file ends with one 8-byte signature per journal = hash of everything that
   went into its vector (field texts, scope text, weights). A journal whose signature is unchanged keeps its
   vector; only new or changed journals are embedded, so a data refresh takes seconds, not 20 minutes.
   Readers (js/ai.js, the tests) compute offsets from n × dim and ignore the trailing block.
     --full    ignore the previous file and re-embed everything
     --reuse   additionally keep the vector of a journal whose official scope text is not on this machine
               (CI has no crawl cache): it is reused even though its signature cannot be recomputed */
import { createHash } from 'node:crypto';
const FULL = process.argv.includes('--full'), REUSE = process.argv.includes('--reuse');
const sigOf = jobs => createHash('sha1').update(JSON.stringify(jobs.map(x => [x.w, x.text]))).digest().subarray(0, 8);
const OLD = new Map();   // issn -> {v: Float32Array, sig: Buffer|null}
if (!FULL && fs.existsSync(OUT)) {
  const b = fs.readFileSync(OUT);
  if (b.toString('ascii', 0, 4) === 'OAE3') {
    const n = b.readUInt32LE(4), dim = b.readUInt32LE(8), sc = b.readFloatLE(12), sigOff = 16 + n * 8 + n * dim, hasSig = b.length >= sigOff + n * 8;
    for (let i = 0; i < n; i++) { const id = b.toString('latin1', 16 + i * 8, 16 + i * 8 + 8).trim(); const v = new Float32Array(dim); for (let d = 0; d < dim; d++) v[d] = ((b[16 + n * 8 + i * dim + d] << 24) >> 24) * sc; OLD.set(id, { v, sig: hasSig ? b.subarray(sigOff + i * 8, sigOff + i * 8 + 8) : null }); }
    console.log(`incremental: ${OLD.size.toLocaleString()} vectors in the current ${path.relative(ROOT, OUT)}${hasSig ? ' (with input signatures)' : ' (no signatures: everything is re-embedded once)'}`);
  } else console.log('incremental: current embeddings.bin is not OAE3, full build');
}
const SIGS = Buffer.alloc(R.length * 8); let nKept = 0; const KEPT = new Uint8Array(R.length);
/* MiniLM reads ~256 word pieces: long scope texts are split into ≤150-word sentence chunks whose vectors are averaged */
function chunks(text) { const out = []; let cur = []; for (const s of text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)) { const w = s.split(' ').length; if (cur.length && cur.reduce((a, x) => a + x.split(' ').length, 0) + w > 150) { out.push(cur.join(' ')); cur = []; } cur.push(s); } if (cur.length) out.push(cur.join(' ')); return out.slice(0, MAX_CHUNKS); }
/* the scope statement proper sits at the top of the section; ≤ 4 chunks (~600 words) capture it and keep the
   build to minutes rather than hours (each chunk costs a full 256-token forward pass) */
const MAX_CHUNKS = 4;
console.log(`official scope evidence: ${Object.values(SCOPE_EV).filter(e => AI_OFFICIAL.has(e.st)).length} accepted statuses, ${SCOPE_TXT.size} crawled scope texts, ${PJIP ? PJIP.j.length : 0} PJIP scope texts available`);

env.allowLocalModels = false;
console.log(`Embedding ${R.length.toLocaleString()} journals × ${FIELDS.length} fields with ${MODEL} …`);
const extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
const dimProbe = await extractor('probe', { pooling: 'mean', normalize: true });
const DIM = dimProbe.dims[1];
const vecs = new Float32Array(R.length * DIM);
const conf = { high: 0, medium: 0, low: 0, insufficient: 0 };
const t0 = Date.now();
conf.official = 0; let nOfficial = 0, nReused = 0;
for (let i = 0; i < R.length; i += BATCH) {
  const batch = R.slice(i, i + BATCH);
  // embed every non-empty field of every journal in the batch in one call
  const jobs = [];
  batch.forEach((r, j) => {
    const f = journalFields(r), sc = officialText(r);
    const ev = ctx.scopeEvidence(r, SCOPE_EV), official = ev && AI_OFFICIAL.has(ev.st);
    const old = OLD.get(r.issn), o = (i + j) * DIM;
    if (!sc && official && REUSE && old) {   // official scope, text not on this machine: keep the deployed vector
      conf.official++; nOfficial++; nReused++; KEPT[i + j] = 1; for (let d = 0; d < DIM; d++) vecs[o + d] = old.v[d]; if (old.sig) old.sig.copy(SIGS, (i + j) * 8);
      return;
    }
    const mine = [];
    if (sc) {   // explicit evidence weights: scope chunks (averaged) 80 %, DOAJ keywords+subjects 15 %, SCImago categories 5 %
      const ch = chunks(sc); ch.forEach(c => mine.push({ j, w: AI_EVIDENCE_WEIGHTS.scope / ch.length, text: c }));
      const doaj = [f.keywords, f.subjects].filter(Boolean).join(', '); if (doaj) mine.push({ j, w: AI_EVIDENCE_WEIGHTS.doaj, text: doaj });
      const cats = [f.categories, f.areas].filter(Boolean).join(', '); if (cats) mine.push({ j, w: AI_EVIDENCE_WEIGHTS.categories, text: cats });
    } else for (const k of FIELDS) if (f[k]) mine.push({ j, w: AI_FIELD_WEIGHTS[k], text: f[k] });
    if (sc) { conf.official++; nOfficial++; } else conf[aiConfidence(r, SCOPE_EV)]++;
    const sig = sigOf(mine); sig.copy(SIGS, (i + j) * 8);
    if (old && old.sig && old.sig.equals(sig)) { nKept++; KEPT[i + j] = 1; for (let d = 0; d < DIM; d++) vecs[o + d] = old.v[d]; return; }   // unchanged inputs: keep the vector
    jobs.push(...mine);
  });
  // short metadata fields and long scope chunks are embedded in separate calls: a mixed batch is padded to
  // its longest input, which made every 5-word field cost as much as a 150-word chunk
  const groups = [jobs.filter(x => x.text.length < 400), jobs.filter(x => x.text.length >= 400)];
  for (const g of groups) {
    if (!g.length) continue;
    const out = await extractor(g.map(x => x.text), { pooling: 'mean', normalize: true });
    g.forEach((x, n) => { const o = (i + x.j) * DIM, w = x.w; for (let d = 0; d < DIM; d++) vecs[o + d] += w * out.data[n * DIM + d]; });
  }
  for (let j = 0; j < batch.length; j++) { if (KEPT[i + j]) continue; const o = (i + j) * DIM; let nrm = 0; for (let d = 0; d < DIM; d++) nrm += vecs[o + d] * vecs[o + d]; nrm = Math.sqrt(nrm) || 1; for (let d = 0; d < DIM; d++) vecs[o + d] /= nrm; }
  if ((i / BATCH) % 20 === 0 || i + BATCH >= R.length) {
    const done = Math.min(i + BATCH, R.length), s = (Date.now() - t0) / 1000;
    process.stdout.write(`  ${done.toLocaleString()} / ${R.length.toLocaleString()}  (${s.toFixed(0)}s, ETA ${(s / done * (R.length - done)).toFixed(0)}s)\n`);
  }
}
console.log('evidence:', JSON.stringify(conf), `(${nOfficial} journals with official-scope vectors · ${nKept} unchanged vectors kept · ${nReused} reused without local text · ${R.length - nKept - nReused} embedded)`);

/* ---- quantize to int8 with one global scale ---- */
let maxAbs = 0;
for (let i = 0; i < vecs.length; i++) { const a = Math.abs(vecs[i]); if (a > maxAbs) maxAbs = a; }
const scale = maxAbs / 127;
const head = Buffer.alloc(16);
head.write('OAE3', 0, 'ascii');   // OAE2 = weighted per-field vectors (see js/ai-score.js)
head.writeUInt32LE(R.length, 4);
head.writeUInt32LE(DIM, 8);
head.writeFloatLE(scale, 12);
const ids = Buffer.alloc(R.length * 8, ' ');
R.forEach((r, i) => ids.write(r.issn.padEnd(8).slice(0, 8), i * 8, 'ascii'));
const q = Buffer.alloc(R.length * DIM);
for (let i = 0; i < vecs.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(vecs[i] / scale))) & 0xff;

/* sanity check before overwriting: enough journals, and quantized vectors still rank sensibly */
if (R.length < 15000) throw new Error(`only ${R.length} journals - refusing to write a truncated file`);
const dot = (a, b) => { let s = 0; for (let k = 0; k < DIM; k++) s += a[k] * b[k]; return s; };
const deq = i => Array.from(q.subarray(i * DIM, (i + 1) * DIM), b => ((b << 24) >> 24) * scale);
const self = dot(deq(0), Array.from(vecs.subarray(0, DIM)));
if (self < 0.98) throw new Error(`quantization check failed (cos = ${self.toFixed(3)})`);

fs.writeFileSync(OUT, Buffer.concat([head, ids, q, SIGS]));   // trailing per-journal input signatures (see 'Incremental builds')
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${R.length.toLocaleString()} × ${DIM} int8, ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB, scale ${scale.toExponential(3)}`);
