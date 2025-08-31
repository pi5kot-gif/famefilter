// scripts/fetch-news.js
// Node 18+ (má vestavěné fetch). Žádné dependency.

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

// Google News RSS (posledních 30 dní)
const googleNewsRss = (name) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(name + " when:30d")}&hl=en-US&gl=US&ceid=US:en`;

async function getText(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": "famefilter-bot/1.0 (+https://famefilter.com)" }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

// super jednoduchý parser <item>…</item> (bez závislostí)
function parseRss(xml) {
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
    const k = x.title.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // sort newest first
  uniq.sort((a,b) => new Date(b.published_at) - new Date(a.published_at));
  return uniq;
}

async function run() {
  const outDir = path.join(process.cwd(), 'news');
  fs.mkdirSync(outDir, { recursive: true });

  for (const [slug, name] of Object.entries(CELEBS)) {
    try {
      const xml = await getText(googleNewsRss(name));
      const items = parseRss(xml);
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
  }
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
