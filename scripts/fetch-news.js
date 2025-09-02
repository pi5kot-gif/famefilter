// scripts/fetch-news.js
// Node 18+ (vestavěné fetch). Bez externích závislostí.

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
const USER_AGENT = "famefilter-bot/1.0 (+https://famefilter.com)";
const FETCH_TIMEOUT_MS = 6000;
const SLEEP_BETWEEN_PEOPLE_MS = 1200; // malá „mezera“ mezi celebritami
const SLEEP_BETWEEN_QUERIES_MS = 400; // a i mezi alternativními dotazy

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Google News RSS
const gnews = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

// Mirrors
const mirrors = (q) => {
  const base = gnews(q);
  return [
    base, // přímo
    `https://api.allorigins.win/raw?url=${encodeURIComponent(base)}`,
    `https://api.allorigins.win/get?url=${encodeURIComponent(base)}`, // vrací JSON {contents}
  ];
};

// fetch s timeoutem
async function fetchWithTimeout(url, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { "User-Agent": USER_AGENT, ...(init.headers || {}) }
    });
    return r;
  } finally {
    clearTimeout(t);
  }
}

// udělej 1 dotaz přes všechny mirrory, první úspěšný vyhrává
async function fetchOneQuery(q) {
  const urls = mirrors(q);
  let lastErr;
  for (const url of urls) {
    try {
      const r = await fetchWithTimeout(url);
      if (!r.ok) { lastErr = new Error(`HTTP ${r.status}`); continue; }
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        const j = await r.json();
        return typeof j.contents === "string" ? j.contents : "";
      }
      return await r.text();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("All mirrors failed");
}

// jednoduchý parser <item>…</item>
function parseRss(xml) {
  if (!xml || typeof xml !== "string") return [];
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml)) && items.length < MAX_ITEMS) {
    const block = m[1];
    const get = (tag) => {
      const mm = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
      return mm ? mm[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : "";
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
    const k = (x.title||"").toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // sort newest first
  uniq.sort((a,b) => new Date(b.published_at) - new Date(a.published_at));
  return uniq;
}

// postav sadu dotazů pro jméno (vždy 90d + fallbacky)
// — používáme uvozovky i bez, aby Google nevázal až moc striktně.
function buildQueries(name) {
  const quoted = `"${name}"`;
  const q = [
    `${quoted} when:90d`,
    `${quoted}`,
    `${name} when:90d`,
  ];
  // speciální případy / překlepy
  const lower = name.toLowerCase();
  if (lower.includes("scarlett johansson")) {
    q.push(
      `"Scarlett Johanssen" when:90d`,
      `"Scarlett Ingrid Johansson" when:90d`,
      `Scarlett+Johansson when:90d`
    );
  }
  if (lower.includes("cristiano ronaldo")) {
    q.push(`"Cristiano Ronaldo dos Santos Aveiro" when:90d`);
  }
  return q;
}

// zkus dotazy postupně; jakmile najdeme nenulový seznam, bereme ho
async function getItemsForName(name) {
  const queries = buildQueries(name);
  for (const q of queries) {
    try {
      const xml = await fetchOneQuery(q);
      const items = parseRss(xml);
      if (items.length) return items;
    } catch (_) {
      // zkusíme další dotaz
    }
    await sleep(SLEEP_BETWEEN_QUERIES_MS);
  }
  return [];
}

async function run() {
  const outDir = path.join(process.cwd(), 'news');
  fs.mkdirSync(outDir, { recursive: true });

  for (const [slug, name] of Object.entries(CELEBS)) {
    try {
      const items = await getItemsForName(name);
      const payload = {
        slug, name,
        updatedAt: new Date().toISOString(),
        items
      };
      const file = path.join(outDir, `${slug}.json`);
      fs.writeFileSync(file, JSON.stringify(payload, null, 2));
      console.log(`✓ ${slug} → ${items.length} items`);
    } catch (e) {
      console.error(`× ${slug}:`, e.message);
    }
    await sleep(SLEEP_BETWEEN_PEOPLE_MS); // mezera mezi lidmi
  }
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
