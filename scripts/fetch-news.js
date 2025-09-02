// scripts/fetch-news.js
// Node 18+ (má fetch). Bez závislostí.

const fs = require('fs');
const path = require('path');

const CELEBS = {
  "taylor-swift":"Taylor Swift",
  "rihanna":"Rihanna",
  "cristiano-ronaldo":"Cristiano Ronaldo",
  "selena-gomez":"Selena Gomez",
  "kim-kardashian":"Kim Kardashian",
  "dua-lipa":"Dua Lipa",
  "ariana-grande":"Ariana Grande",
  "scarlett-johansson":"Scarlett Johansson",
  "katy-perry":"Katy Perry",
  "margot-robbie":"Margot Robbie"
};

const MAX_ITEMS = 30;
const TIMEOUT_MS = 6500;
const SLEEP_MS = 600;              // drobná pauza mezi requesty
const USER_AGENT = "famefilter-bot/1.0 (+https://famefilter.com)";
const PROXY_BASE = process.env.PROXY_BASE || ""; // např. https://proxy.famefilter.com/proxy

/* ---------- Utils ---------- */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": USER_AGENT } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

function allOriginsRaw(url) {
  return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
}

function viaProxy(url) {
  return PROXY_BASE ? `${PROXY_BASE}?url=${encodeURIComponent(url)}` : null;
}

/* ---------- Google News ---------- */
function googleNewsRssFromQuery(q) {
  // q = třeba: `"Taylor Swift" when:90d`
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}

function buildQueries(name) {
  // “mezerové” dotazy + 90d default, plus další varianty, aby něco padlo vždy
  const quoted = `"${name}"`;
  const base = [
    `${quoted} when:90d`,
    `${name} when:90d`,
    `${quoted} when:30d`,
    `${name} when:30d`,
    `${quoted}`,
    `${name}`
  ];

  // Specifická jemná pomoc pro časté překlepy (Scarlett)
  if (name.toLowerCase().includes('scarlett johansson')) {
    base.push(`"Scarlett Johanssen" when:90d`);
    base.push(`"Scarlet Johansson" when:90d`);
  }

  return base;
}

async function fetchFromMirrors(sourceUrl) {
  const mirrors = [
    googleNewsRssFromQuery(sourceUrl).startsWith('http') ? null : null, // nic; jen pro přehled
  ];
  // sourceUrl už je QUERY, ne URL. tady postavíme URL:
  const url = googleNewsRssFromQuery(sourceUrl);
  const tries = [
    () => fetchWithTimeout(url),
    () => fetchWithTimeout(allOriginsRaw(url)),
  ];
  const proxied = viaProxy(url);
  if (proxied) tries.unshift(() => fetchWithTimeout(proxied)); // proxy preferovaně první

  let lastErr;
  for (const fn of tries) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("All mirrors failed");
}

/* ---------- RSS parser (lehký, bez závislostí) ---------- */
function parseRss(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml)) && items.length < MAX_ITEMS) {
    const block = m[1];
    const get = (tag) => {
      const mm = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
      const raw = mm ? mm[1] : "";
      // strip CDATA
      const clean = raw.replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1').trim();
      return clean;
    };
    const title = get('title');
    const link  = get('link');
    const pub   = get('pubDate');
    let source  = get('source');

    if (!source && link) { try { source = new URL(link).hostname.replace(/^www\./,''); } catch {} }

    if (title && link) {
      items.push({
        title,
        url: link,
        source: source || "News",
        published_at: pub ? new Date(pub).toISOString() : ""
      });
    }
  }

  // dedupe podle title (case-insensitive)
  const seen = new Set();
  const uniq = items.filter(x => {
    const k = (x.title || "").toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  // newest first
  uniq.sort((a,b) => new Date(b.published_at) - new Date(a.published_at));
  return uniq;
}

/* ---------- Hlavní logika na osobu ---------- */
async function fetchOne(name) {
  const queries = buildQueries(name);

  // postupně zkoušej dotazy; u každého mirror fallback + 2 pokusy
  for (const q of queries) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const xml = await fetchFromMirrors(q);
        const items = parseRss(xml);
        if (items.length) return items;
      } catch (_) {
        // zkusí další attempt / query
      }
    }
    // malá pauza mezi dotazy, aby se neroztočilo throttling
    await sleep(250);
  }
  return [];
}

/* ---------- Run ---------- */
async function run() {
  const outDir = path.join(process.cwd(), 'news');
  fs.mkdirSync(outDir, { recursive: true });

  for (const [slug, name] of Object.entries(CELEBS)) {
    try {
      // malý throttle mezi osobami
      await sleep(SLEEP_MS);

      const items = await fetchOne(name);
      // poslední záchrana: pokud by selhalo úplně, nepiš prázdný — ponecháš starý soubor
      if (!items.length) {
        const file = path.join(outDir, `${slug}.json`);
        if (fs.existsSync(file)) {
          console.warn(`× ${slug}: no fresh items; keeping existing file`);
          continue;
        }
      }

      const payload = {
        slug, name,
        updatedAt: new Date().toISOString(),
        items
      };
      const file = path.join(outDir, `${slug}.json`);
      fs.writeFileSync(file, JSON.stringify(payload, null, 2));
      console.log(`✓ ${slug} → ${items.length} items`);
    } catch (e) {
      console.error(`× ${slug}:`, e.message || String(e));
      // když selže a soubor neexistuje, vytvoř aspoň „prázdný“ s metadata (ať frontend má co číst)
      const file = path.join(outDir, `${slug}.json`);
      if (!fs.existsSync(file)) {
        const payload = { slug, name, updatedAt: new Date().toISOString(), items: [] };
        fs.writeFileSync(file, JSON.stringify(payload, null, 2));
      }
    }
  }
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
