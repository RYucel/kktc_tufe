// Fetches the latest KKTC İstatistik Kurumu TÜFE release, downloads the official
// archive workbook it links to, and rewrites docs/data/tufe.json + meta.json from it.
// The archive workbook is always the full time series (1977-present), so we treat it
// as the single source of truth and replace our data file wholesale each run rather
// than trying to merge incremental updates.
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import XLSX from "xlsx";

const RSS_URL = "https://istatistik.gov.ct.tr/HABERLER/rss/category/4213/haberler";
const UA = "Mozilla/5.0 (compatible; kktc-enflasyon-dashboard/1.0; +https://github.com/)";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT, "docs", "data", "tufe.json");
const META_FILE = path.join(ROOT, "docs", "data", "meta.json");

const MONTHS = [
  "OCAK", "ŞUBAT", "MART", "NİSAN", "MAYIS", "HAZİRAN",
  "TEMMUZ", "AĞUSTOS", "EYLÜL", "EKİM", "KASIM", "ARALIK",
];
const MONTH_INDEX = new Map(MONTHS.map((m, i) => [m, i + 1]));

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function parseRssItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const grab = (tag) => {
      const re = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`);
      const mm = block.match(re);
      return mm ? mm[1].trim() : "";
    };
    items.push({
      title: grab("title"),
      link: grab("link"),
      pubDate: grab("pubDate"),
      description: grab("description"),
    });
  }
  return items;
}

function findLatestTufeItem(items) {
  // Matches "Tüketici Fiyat Endeksi - <Ay> <Yıl>", excludes basket/weight bulletins etc.
  const re = /^T[üu]ketici Fiyat Endeksi\s*-\s*(\S+)\s+(\d{4})$/i;
  const candidates = items
    .map((it) => ({ it, mm: it.title.match(re) }))
    .filter((x) => x.mm);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => new Date(b.it.pubDate) - new Date(a.it.pubDate));
  return candidates[0];
}

async function findArchiveXlsUrl(newsPageUrl) {
  const html = await fetchText(newsPageUrl);
  const m = html.match(/https?:\/\/istatistik\.gov\.ct\.tr\/Portals\/\d+\/TUFE_ARSIV[^"'\s]+\.xls/i);
  if (!m) throw new Error(`Archive .xls link not found on ${newsPageUrl}`);
  return m[0];
}

function sheetToMap(sheet, firstYear, colStart = 1) {
  const map = new Map();
  const ref = sheet["!ref"];
  const range = XLSX.utils.decode_range(ref);
  for (let r = range.s.r; r <= range.e.r; r++) {
    const labelCell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
    const label = labelCell ? String(labelCell.v).trim().toUpperCase() : "";
    if (!MONTH_INDEX.has(label)) continue;
    const monthNum = MONTH_INDEX.get(label);
    for (let c = colStart; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell || cell.v === "" || cell.v === undefined || cell.v === null) continue;
      const year = firstYear + (c - colStart);
      const val = Number(cell.v);
      if (Number.isNaN(val)) continue;
      map.set(`${year}-${monthNum}`, Math.round(val * 10000) / 10000);
    }
  }
  return map;
}

function buildRecords(workbook) {
  const [sh0, sh1, sh2] = workbook.SheetNames.slice(0, 3).map((n) => workbook.Sheets[n]);
  const aylik = sheetToMap(sh0, 1977);
  const ytd = sheetToMap(sh1, 1978);
  const yillik = sheetToMap(sh2, 1978);

  const keys = new Set([...aylik.keys(), ...ytd.keys(), ...yillik.keys()]);
  const records = [...keys].map((key) => {
    const [year, month] = key.split("-").map(Number);
    return {
      year,
      month,
      aylikYuzde: aylik.has(key) ? aylik.get(key) : null,
      yilBasindanYuzde: ytd.has(key) ? ytd.get(key) : null,
      yillikYuzde: yillik.has(key) ? yillik.get(key) : null,
    };
  });
  records.sort((a, b) => a.year - b.year || a.month - b.month);
  return records;
}

async function readJsonSafe(file) {
  try {
    return JSON.parse(await readFile(file, "utf-8"));
  } catch {
    return null;
  }
}

async function main() {
  console.log("RSS feed çekiliyor:", RSS_URL);
  const rssXml = await fetchText(RSS_URL);
  const items = parseRssItems(rssXml);
  const latest = findLatestTufeItem(items);
  if (!latest) throw new Error("RSS içinde TÜFE haberi bulunamadı");

  console.log("En son TÜFE haberi:", latest.it.title, latest.it.link);
  const archiveUrl = await findArchiveXlsUrl(latest.it.link);
  console.log("Arşiv dosyası:", archiveUrl);

  const buf = await fetchBuffer(archiveUrl);
  const workbook = XLSX.read(buf, { type: "buffer" });
  const records = buildRecords(workbook);

  const previous = await readJsonSafe(DATA_FILE);
  const changed = JSON.stringify(previous) !== JSON.stringify(records);

  await writeFile(DATA_FILE, JSON.stringify(records, null, 2) + "\n", "utf-8");

  const meta = {
    lastChecked: new Date().toISOString(),
    lastChanged: changed ? new Date().toISOString() : (await readJsonSafe(META_FILE))?.lastChanged ?? new Date().toISOString(),
    latestHeadline: latest.it.title,
    latestNewsUrl: latest.it.link,
    latestPubDate: latest.it.pubDate,
    archiveUrl,
    recordCount: records.length,
  };
  await writeFile(META_FILE, JSON.stringify(meta, null, 2) + "\n", "utf-8");

  console.log(changed ? "Veri güncellendi." : "Veride değişiklik yok.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
