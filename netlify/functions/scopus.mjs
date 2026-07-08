// Serverless proxy for the Elsevier Scopus Search API.
// Keeps the API key server-side (env var SCOPUS_API_KEY) so it never ships to
// the browser. Accepts ?issn=XXXX-XXXX or ?doi=... and returns a small,
// already-summarized JSON verdict.

const API = 'https://api.elsevier.com/content/search/scopus';

export default async (request) => {
  const key = process.env.SCOPUS_API_KEY;
  if (!key) return json({ error: 'Server not configured' }, 500);

  const url = new URL(request.url);
  const issnRaw = (url.searchParams.get('issn') || '').toUpperCase().replace(/[^0-9X]/g, '');
  const doi = (url.searchParams.get('doi') || '').trim();

  let query;
  if (/^\d{7}[0-9X]$/.test(issnRaw)) query = `ISSN(${issnRaw.slice(0, 4)}-${issnRaw.slice(4)})`;
  else if (doi) query = `DOI(${doi})`;
  else return json({ error: 'Provide a valid issn or doi parameter' }, 400);

  const api = `${API}?query=${encodeURIComponent(query)}&count=1&sort=-coverDate&apiKey=${key}&httpAccept=application/json`;

  let res;
  try {
    res = await fetch(api);
  } catch {
    return json({ error: 'Scopus API unreachable' }, 502);
  }
  if (!res.ok) return json({ error: `Scopus API error ${res.status}` }, 502);

  const data = await res.json();
  const sr = data['search-results'] || {};
  const total = parseInt(sr['opensearch:totalResults'] || '0', 10) || 0;
  const entry = (sr.entry && sr.entry[0]) || {};

  return json({
    query,
    indexed: total > 0,
    documentCount: total,
    latestCoverDate: entry['prism:coverDate'] || null,
    latestTitle: entry['dc:title'] || null,
    publicationName: entry['prism:publicationName'] || null,
  }, 200, 3600);
};

function json(body, status = 200, cacheSeconds = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': cacheSeconds ? `public, max-age=${cacheSeconds}` : 'no-store',
    },
  });
}
