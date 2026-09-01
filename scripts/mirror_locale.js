#!/usr/bin/env node
/**
 * mirror_locale.js — 為一個語系建立第二個 site root（例：en/）。
 *
 *   node scripts/mirror_locale.js en            # 建立 en/（已存在的檔案不覆寫）
 *   node scripts/mirror_locale.js en --force    # 以 zh 原文重灌 en/ 的所有頁面（會丟掉已翻內容，慎用）
 *
 * 做的事：
 *   1. en/chapters.json：從根目錄 chapters.json 派生（baseUrl 加 /en、lang=en、assetBase=../…），人讀欄位先保留原文，之後逐欄翻。
 *   2. en/<每一頁>.html：複製 zh 頁面當「殼」，assets/ 路徑改成 ../assets/；正文仍是原文（ledger 標 pending，頁面 noindex）。
 *   3. i18n/ledger.json：為每個翻譯單元登錄 sourceHash / status=pending。
 *   4. i18n/locales.json：登錄語系（published=false）。
 *
 * 之後：SITE_ROOT=en node scripts/build_nav.js 會重生 chrome；翻譯完成的單元用 check_i18n.js --accept 記帳。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const i18n = require('./lib/i18n');

const REPO_ROOT = i18n.REPO_ROOT;
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FORCE = process.argv.includes('--force');
const code = args[0];
if (!code || !/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(code)) {
  console.error('用法：node scripts/mirror_locale.js <locale>   例：en');
  process.exit(2);
}

const LOCALE_META = {
  en: { lang: 'en', ogLocale: 'en_US', hreflang: 'en', label: 'EN', licenseDeed: 'deed.en', fonts: 'Outfit:wght@400;500;600;700&family=Poppins:wght@400;500;600;700&family=Yellowtail' },
};
const meta = LOCALE_META[code] || { lang: code, ogLocale: code, hreflang: code, label: code.toUpperCase(), licenseDeed: `deed.${code}`, fonts: 'Outfit:wght@400;500;600;700&family=Poppins:wght@400;500;600;700&family=Yellowtail' };

const rootCfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'chapters.json'), 'utf8'));
const dir = path.join(REPO_ROOT, code);
fs.mkdirSync(dir, { recursive: true });

const CATALOG = (rootCfg.hub && rootCfg.hub.catalog) || 'index.html';
const HUB_PAGES = (rootCfg.hub && rootCfg.hub.pages) || [];
const pages = [...rootCfg.chapters, ...rootCfg.appendices].map((p) => p.file);
const files = [...new Set(['index.html', CATALOG, ...pages, ...HUB_PAGES])];

/* 1. chapters.json */
const cfgPath = path.join(dir, 'chapters.json');
if (!fs.existsSync(cfgPath) || FORCE) {
  const cfg = JSON.parse(JSON.stringify(rootCfg));
  const base = rootCfg.site.baseUrl.replace(/\/$/, '');
  // 分享卡一定要換一張：zh 的卡上有中文，直接沿用等於英文站的分享卡是中文。
  // 命名規則 <name>.<locale>.<ext>，由 scripts/build_og.js 依各 root 的 chapters.json 產圖。
  const ogImage = (rootCfg.site.ogImage || '').replace(/(\.[a-z0-9]+)$/i, `.${code}$1`);
  cfg._readme = `Single source for the ${code}/ site root (nav, SEO, catalog, sitemap). Human-readable fields are translation units tracked in i18n/ledger.json. Rebuild with: SITE_ROOT=${code} node scripts/build_nav.js`;
  cfg.site = {
    ...rootCfg.site,
    baseUrl: `${base}/${code}`,
    assetBaseUrl: base,
    assetBase: '../',
    lang: meta.lang,
    localeCode: code,
    ogImage,
    locale: meta.ogLocale,
    localeAlternate: [rootCfg.site.locale],
    fontsUrl: `https://fonts.googleapis.com/css2?family=${meta.fonts}&display=swap`,
    license: { ...rootCfg.site.license, url: rootCfg.site.license.url.replace(/deed\.[a-z-]+$/i, meta.licenseDeed) },
  };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`✓ ${code}/chapters.json`);
} else {
  console.log(`· ${code}/chapters.json 已存在，略過`);
}

/* 2. pages */
const rewriteAssets = (html) =>
  html
    .replace(/(href|src)="assets\//g, '$1="../assets/')
    .replace(/url\((['"]?)assets\//g, 'url($1../assets/');

let copied = 0;
for (const f of files) {
  const src = path.join(REPO_ROOT, f);
  const dst = path.join(dir, f);
  if (!fs.existsSync(src)) {
    console.warn(`! 根目錄找不到 ${f}，略過`);
    continue;
  }
  if (fs.existsSync(dst) && !FORCE) continue;
  fs.writeFileSync(dst, rewriteAssets(fs.readFileSync(src, 'utf8')));
  copied++;
}
console.log(`✓ ${code}/ 頁面：新建 ${copied}，共 ${files.length}`);

/* 3. ledger */
const ledger = i18n.loadLedger(REPO_ROOT);
ledger._readme =
  'Translation ledger. Key = <locale>:<file>#<unit> or <locale>:chapters.json:<path>. status: pending | complete | stale | manual | localized | excluded | failed. sourceHash = hash of the zh unit; targetHash = hash of the translated unit. Maintained by scripts/check_i18n.js — do not hand-edit hashes.';
ledger.units = ledger.units || {};
let added = 0;
const today = new Date().toISOString().slice(0, 10);
for (const f of files) {
  const src = path.join(REPO_ROOT, f);
  if (!fs.existsSync(src)) continue;
  for (const u of i18n.extractUnits(fs.readFileSync(src, 'utf8'))) {
    const key = `${code}:${f}${u.key}`;
    if (!ledger.units[key]) {
      ledger.units[key] = { status: 'pending', sourceHash: u.hash, targetHash: null, registeredAt: today };
      added++;
    }
  }
}
for (const u of i18n.extractConfigUnits(rootCfg)) {
  const key = `${code}:${u.key}`;
  if (!ledger.units[key]) {
    ledger.units[key] = { status: 'pending', sourceHash: u.hash, targetHash: null, registeredAt: today };
    added++;
  }
}
i18n.saveLedger(REPO_ROOT, ledger);
console.log(`✓ i18n/ledger.json：新增 ${added} 個單元（共 ${Object.keys(ledger.units).length}）`);

/* 4. locales.json */
const locPath = path.join(REPO_ROOT, 'i18n', 'locales.json');
const locales = i18n.readJSON(locPath, {});
if (!locales[code]) {
  locales[code] = { dir: code, hreflang: meta.hreflang, label: meta.label, published: false };
  fs.writeFileSync(locPath, JSON.stringify(locales, null, 2) + '\n');
  console.log(`✓ i18n/locales.json：登錄 ${code}（published=false）`);
}

console.log(`\n下一步：SITE_ROOT=${code} node scripts/build_nav.js && SITE_ROOT=${code} node scripts/check_links.js && node scripts/check_i18n.js`);
