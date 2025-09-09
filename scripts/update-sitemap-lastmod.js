// scripts/update-sitemap-lastmod.js
// Node 18+
import fs from "fs";

const file = "sitemap.xml";
const xml = fs.readFileSync(file, "utf8");

// ISO datum dnes
const today = new Date().toISOString().slice(0, 10);

// Přepiš <lastmod> jen u homepage a person URLs (credits necháme být)
const updated = xml.replace(
  /(<url>\s*<loc>https:\/\/famefilter\.com\/(?:|person\.html\?slug=[^<]+)<\/loc>[\s\S]*?<lastmod>)([^<]*)(<\/lastmod>)/g,
  (_m, p1, _old, p3) => `${p1}${today}${p3}`
);

if (updated !== xml) {
  fs.writeFileSync(file, updated);
  console.log(`sitemap.xml updated to lastmod=${today}`);
} else {
  console.log("sitemap.xml unchanged");
}
