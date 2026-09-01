#!/usr/bin/env node
/**
 * check_links.js — 站內連結／圖片／錨點健檢（無外部相依，CI 用）。
 *
 *   node scripts/check_links.js
 *
 * 檢查項目：
 *   1. 所有 href/src 指向的站內檔案確實存在
 *   2. 所有 #anchor 在該頁有對應的 id
 *   3. 同一頁沒有重複的 id
 *   4. 每個 <section id> 都有 data-nav（build_nav.js 產生側欄要用）
 *   5. chapters.json 列出的檔案都存在，且 sitemap.xml 有涵蓋每一頁
 *
 * 有任何錯誤就 exit 1。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const i18n = require('./lib/i18n');
const { repoRoot: REPO_ROOT, root: ROOT, subdir: SUBDIR, isPrimary: IS_PRIMARY } = i18n.resolveRoot(); // SITE_ROOT=en 時檢查 en/
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'chapters.json'), 'utf8'));
const LEDGER = i18n.loadLedger(REPO_ROOT);
const LOCALES = i18n.loadLocales(REPO_ROOT);
const LOCALE = IS_PRIMARY ? null : cfg.site.localeCode || SUBDIR;
const pageStatus = (f) => (IS_PRIMARY ? 'complete' : i18n.pageStatus(LEDGER, LOCALE, f));
// 與 build_nav.js 同一條規則：語系還沒 published，或該頁還沒翻完，就整頁不進 sitemap。
const LOCALE_LIVE = IS_PRIMARY || !!(LOCALES[LOCALE] && LOCALES[LOCALE].published);
const indexable = (f) => LOCALE_LIVE && pageStatus(f) !== 'pending';
const BASE_PREFIX = new URL(cfg.site.baseUrl).pathname.replace(/\/$/, '') + '/'; // 自訂網域時為 "/"

// hub 模式：index.html = 資源總覽、catalog = 教學目錄、hub.pages = 自帶樣式的獨立單檔手冊。
// 這三類不吃「內容頁房規」(kicker/FAQ/data-icon 對 style.css) — 連結/錨點/id 檢查照跑。
const CATALOG = (cfg.hub && cfg.hub.catalog) || 'index.html';
const HUB_PAGES = (cfg.hub && cfg.hub.pages) || [];
const NON_CONTENT = new Set(['index.html', '404.html', CATALOG, ...HUB_PAGES]);

const errors = [];
const htmlFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();

for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');

  // 1. 站內檔案
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    let target = m[1];
    if (/^(https?:|mailto:|data:|\/\/|#)/.test(target)) continue;
    target = target.split('#')[0];
    if (!target) continue;
    if (target.startsWith(BASE_PREFIX)) target = target.slice(BASE_PREFIX.length) || 'index.html';
    else if (target.startsWith('/')) target = target.slice(1) || 'index.html';
    if (target.endsWith('/')) target += 'index.html';
    if (!fs.existsSync(path.join(ROOT, target))) {
      errors.push(`${file}: 連結指向不存在的檔案 → ${m[1]}`);
    }
  }

  // 2 & 3. 錨點與重複 id
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  [...new Set(dupes)].forEach((id) => errors.push(`${file}: 重複的 id="${id}"`));

  for (const m of html.matchAll(/href="#([^"]+)"/g)) {
    if (!ids.includes(m[1])) errors.push(`${file}: 錨點 #${m[1]} 在本頁沒有對應的 id`);
  }

  // 4. section 一定要有 data-nav
  for (const m of html.matchAll(/<section id="([^"]+)"(?![^>]*data-nav)/g)) {
    errors.push(`${file}: <section id="${m[1]}"> 缺 data-nav（側欄產不出這個項目）`);
  }
}

// 6. data-icon 必須在 style.css 有對應字符，否則會顯示成空白方塊
const cssPath = [path.join(ROOT, 'assets', 'css', 'style.css'), path.join(REPO_ROOT, 'assets', 'css', 'style.css')].find((p) => fs.existsSync(p)) || '';
if (fs.existsSync(cssPath)) {
  const css = fs.readFileSync(cssPath, 'utf8');
  const defined = new Set(
    [...css.matchAll(/section h2\[data-icon="([^"]+)"\]::before/g)].map((m) => m[1])
  );
  for (const file of htmlFiles) {
    if (NON_CONTENT.has(file)) continue; // 獨立頁自帶樣式，不對 style.css 驗 data-icon
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const used = new Set([...html.matchAll(/<h2[^>]*\bdata-icon="([^"]+)"/g)].map((m) => m[1]));
    for (const icon of used) {
      if (!defined.has(icon)) {
        errors.push(`${file}: data-icon="${icon}" 在 style.css 沒有對應字符（會顯示空白方塊）`);
      }
    }
  }
}

// 7. 房規：內容頁不得夾帶 inline style 的表格，且 <head>/<aside>/<div class="pager"> 由產生器負責
for (const file of htmlFiles) {
  if (NON_CONTENT.has(file)) continue;
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const inlineTables = (html.match(/<table[^>]*style=/g) || []).length;
  if (inlineTables) {
    errors.push(`${file}: 有 ${inlineTables} 個 <table> 用 inline style，請改成 class="data-table"`);
  }
  if (!/<div class="chapter-header">\s*<div class="kicker">/.test(html)) {
    errors.push(`${file}: 找不到 chapter-header 的 kicker 區塊（build_nav.js 產生章節編號要用）`);
  }
  const faq = (html.match(/<details class="faq">/g) || []).length;
  if (faq < 3) errors.push(`${file}: 常見問題只有 ${faq} 則，房規要求至少 4 則`);
}

// 5. chapters.json ↔ 檔案 ↔ sitemap
const listed = [...cfg.chapters, ...cfg.appendices].map((c) => c.file);
listed.forEach((f) => {
  if (!fs.existsSync(path.join(ROOT, f))) errors.push(`chapters.json 列了不存在的檔案 → ${f}`);
});

const orphans = htmlFiles.filter((f) => !listed.includes(f) && !NON_CONTENT.has(f));
orphans.forEach((f) => errors.push(`${f}: 存在於 repo 但 chapters.json 沒列，不會出現在任何導覽`));

if (fs.existsSync(path.join(ROOT, 'sitemap.xml'))) {
  const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const covered = ['index.html', ...listed, ...HUB_PAGES];
  if (CATALOG !== 'index.html') covered.push(CATALOG);
  covered.forEach((f) => {
    const loc = cfg.site.baseUrl.replace(/\/$/, '') + '/' + (f === 'index.html' ? '' : f);
    const inMap = sitemap.includes(`<loc>${loc}</loc>`);
    // 其他語系尚未翻譯（pending）的頁面刻意不進 sitemap；反過來出現了就是錯
    if (!indexable(f)) {
      if (inMap) errors.push(`sitemap.xml 不該列出尚未上線的 ${f}`);
    } else if (!inMap) errors.push(`sitemap.xml 沒有涵蓋 ${f}`);
  });
} else {
  errors.push('缺少 sitemap.xml（跑 node scripts/build_nav.js 產生）');
}

if (errors.length) {
  console.error(`\n✗ 發現 ${errors.length} 個問題：`);
  errors.forEach((e) => console.error('  · ' + e));
  process.exit(1);
}

console.log(`✓ ${SUBDIR ? SUBDIR + '/ ' : ''}${htmlFiles.length} 個頁面的站內連結、錨點、id 與 sitemap 都正常`);
