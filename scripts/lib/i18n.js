'use strict';
/**
 * scripts/lib/i18n.js — 多語系共用邏輯（13 個教學站 byte-identical，請勿放站別內容）。
 *
 * 設計：
 *   - 「site root」= 放 chapters.json 的目錄。zh-TW 永遠是 repo 根目錄；其他語系是子目錄（例：en/）。
 *   - 由環境變數 SITE_ROOT 指定要建置哪個 root（空 = 根目錄）。generator 只要把 ROOT 換掉，其餘不變。
 *   - chrome 字串（第 N 章、上一章…）預設為 zh-TW 字面值；其他語系由 i18n/strings.<lang>.json 覆寫。
 *   - 翻譯進度存在 repo 根目錄 i18n/ledger.json，以「unit」為單位（章首 + 每個 <section id> + chapters.json 欄位）。
 *
 * 任何站都不應修改本檔；站別差異一律走 chapters.json（site.*）與 i18n/strings.<lang>.json。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/* ------------------------------------------------------------- roots ---- */

function resolveRoot() {
  const sub = (process.env.SITE_ROOT || '').replace(/^[./]+|[/]+$/g, '');
  if (!sub) return { repoRoot: REPO_ROOT, root: REPO_ROOT, subdir: '', isPrimary: true };
  const root = path.join(REPO_ROOT, sub);
  if (!fs.existsSync(path.join(root, 'chapters.json'))) {
    throw new Error(`SITE_ROOT=${sub} 下找不到 chapters.json（先跑 node scripts/mirror_locale.js ${sub}）`);
  }
  return { repoRoot: REPO_ROOT, root, subdir: sub, isPrimary: false };
}

function readJSON(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/* ----------------------------------------------------------- strings ---- */

// zh-TW 字面值 = 現行 generator 的輸出，逐字保留，確保 root 產物 byte-identical。
const ZH = {
  lang: 'zh-Hant',
  sidebarChapters: '章節',
  sidebarInChapter: '本章',
  sidebarAppendices: '附錄',
  hubLink: '◂ {label}',
  hubLabelDefault: '資源總覽',
  kickerChapter: '第 {n} 章',
  kickerAppendix: '附錄 {n}',
  titleChapter: '第 {n} 章 · {title} · {site}',
  titleAppendix: '附錄 {n} · {title} · {site}',
  titleCatalog: '{site} · {subtitle}',
  pagerPrev: '← 上一章',
  pagerPrevAppendix: '← 附錄 {n}',
  pagerNext: '下一章 →',
  pagerNextAppendix: '附錄 {n} →',
  pagerNextAppendixFromAppendix: '下一附錄 →',
  pagerContents: '回目錄',
  pagerContentsNext: '回目錄 →',
  pagerDone: '全套完成！',
  indexGroupDefault: '章節目錄',
  indexGroupAppendices: '附錄',
  footerLicense: '《{site}》由 <a href="{repoUrl}" rel="noopener">{holder}</a> 製作，以 <a rel="license noopener" href="{licenseUrl}">{licenseName}</a> 授權釋出 — 可自由分享與改作，請保留出處。',
  footerSource: '原始碼與勘誤',
  langSwitchLabel: '語言',
  langNameSelf: '中文',
  staleBanner: '<strong>中文版已於 {date} 更新：</strong>本章翻譯尚未同步，內容可能落後。',
  pendingBanner: '<strong>本章尚未翻譯：</strong>目前顯示的是原文。',
  tocToggle: '目錄',
  tocExpand: '展開章節與本章目錄',
  tocCollapse: '收合章節與本章目錄',
  title404: '404 · {site}',
};

function loadStrings(repoRoot, lang) {
  const base = { ...ZH };
  if (!lang || lang === ZH.lang) return base;
  const file = path.join(repoRoot, 'i18n', `strings.${lang}.json`);
  const over = readJSON(file, null);
  if (!over) throw new Error(`缺少 ${path.relative(repoRoot, file)}：非 zh-TW 的 root 需要 chrome 字串表`);
  return { ...base, ...over, lang };
}

function fmt(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/* ------------------------------------------------------------ ledger ---- */

const LEDGER_FILE = (repoRoot) => path.join(repoRoot, 'i18n', 'ledger.json');
const LOCALES_FILE = (repoRoot) => path.join(repoRoot, 'i18n', 'locales.json');

function loadLedger(repoRoot) {
  return readJSON(LEDGER_FILE(repoRoot), { _readme: '', units: {} });
}
function saveLedger(repoRoot, ledger) {
  fs.mkdirSync(path.dirname(LEDGER_FILE(repoRoot)), { recursive: true });
  fs.writeFileSync(LEDGER_FILE(repoRoot), JSON.stringify(ledger, null, 1) + '\n');
}
function loadLocales(repoRoot) {
  // { "en": { "dir": "en", "lang": "en", "published": false } }
  return readJSON(LOCALES_FILE(repoRoot), {});
}

const normalize = (html) => String(html).replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\s+/g, ' ').trim();
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);

/**
 * 從一頁 HTML 切出翻譯單元。
 *   #header  = <div class="chapter-header"> 內的 h1 + p.lead（kicker 由 generator 產，不算）
 *   #<id>    = 每個 <section id="…"> 完整內容（含 data-nav 與 h2）
 * hub 頁（index/tutorial/sales/prompts/skills/404）整頁 <main> 為一個 unit。
 */
function extractUnits(html) {
  const units = [];
  const header = html.match(/<div class="chapter-header">([\s\S]*?)<\/div>\s*(?=<section|<div|<p)/);
  if (header) {
    const inner = header[1]
      .replace(/<div class="kicker">[\s\S]*?<\/div>/, '')
      .replace(/<div class="callout i18n-(stale|pending)">[\s\S]*?<\/div>/g, '');
    units.push({ key: '#header', html: inner });
  }
  for (const m of html.matchAll(/<section id="([^"]+)"[^>]*>[\s\S]*?<\/section>/g)) {
    units.push({ key: '#' + m[1], html: m[0] });
  }
  if (!units.length) {
    const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
    if (main)
      units.push({
        key: '#main',
        html: main[1]
          .replace(/<footer class="site-footer">[\s\S]*?<\/footer>/, '')
          .replace(/\n?\s*<!-- i18n:switch -->[\s\S]*?<!-- \/i18n:switch -->/g, ''),
      });
  }
  return units.map((u) => ({ ...u, hash: sha(normalize(u.html)) }));
}

/** chapters.json 裡「人讀」的欄位也是 unit。 */
const HUMAN_FIELDS = ['title', 'navLabel', 'pagerTitle', 'card', 'description', 'part'];
const SITE_HUMAN_FIELDS = ['title', 'brand', 'subtitle', 'description', 'footerMeta'];
function extractConfigUnits(cfg) {
  const units = [];
  for (const f of SITE_HUMAN_FIELDS) {
    if (cfg.site && cfg.site[f] != null) units.push({ key: `chapters.json:site.${f}`, hash: sha(normalize(cfg.site[f])) });
  }
  if (cfg.hub && cfg.hub.navLabel) units.push({ key: 'chapters.json:hub.navLabel', hash: sha(normalize(cfg.hub.navLabel)) });
  // 本站字串覆寫（pager／hub-link 帶圖示的標籤等）也是人讀文字：一鍵一單元，翻譯時保留圖示標記只換文字。
  for (const [k, v] of Object.entries((cfg.site && cfg.site.strings) || {})) {
    if (typeof v === 'string' && k !== 'lang') units.push({ key: `chapters.json:site.strings.${k}`, hash: sha(normalize(v)) });
  }
  for (const [i, l] of ((cfg.site && cfg.site.footerLinks) || []).entries()) {
    if (l && l.label) units.push({ key: `chapters.json:site.footerLinks.${i}.label`, hash: sha(normalize(l.label)) });
  }
  for (const c of [...(cfg.chapters || []), ...(cfg.appendices || [])]) {
    for (const f of HUMAN_FIELDS) {
      if (c[f] != null) units.push({ key: `chapters.json:${c.file}.${f}`, hash: sha(normalize(c[f])) });
    }
  }
  return units;
}

/**
 * 一頁的翻譯狀態 = 該頁所有 unit 的彙總：
 *   pending  : 任一 unit 尚未翻譯（頁面 noindex、不進 sitemap、不輸出 hreflang）
 *   stale    : 全部翻過，但有 unit 的 zh 來源已變（頁面照常索引，顯示提醒橫幅）
 *   complete : 全部同步
 */
function pageStatus(ledger, locale, file) {
  const prefix = `${locale}:${file}#`;
  const cfgPrefix = `${locale}:chapters.json:${file}.`;
  const entries = Object.entries(ledger.units || {}).filter(([k]) => k.startsWith(prefix) || k.startsWith(cfgPrefix));
  if (!entries.length) return 'pending';
  const statuses = entries.map(([, v]) => v.status);
  if (statuses.some((s) => s === 'pending' || s === 'failed')) return 'pending';
  if (statuses.some((s) => s === 'stale')) return 'stale';
  return 'complete';
}

function latestZhChange(ledger, locale, file) {
  const prefix = `${locale}:${file}#`;
  let latest = '';
  for (const [k, v] of Object.entries(ledger.units || {})) {
    if (k.startsWith(prefix) && v.status === 'stale' && v.zhChangedAt && v.zhChangedAt > latest) latest = v.zhChangedAt;
  }
  return latest || null;
}

/* ---------------------------------------------------------- alternates -- */

/**
 * 產生 <link rel="alternate" hreflang> 清單。
 *   primary 頁：對每個 published 語系，只在該頁狀態 ∈ {complete, stale} 時輸出。
 *   locale 頁：自指 + x-default（指自己）+ 回指 primary；狀態 pending 時整組不輸出。
 * 回傳 [{hreflang, href}]，順序固定，方便 byte-level 比對。
 */
function alternates({ isPrimary, locale, page, primaryBase, primaryLangs, localeBase, ledger, locales, xDefault }) {
  const rel = page === 'index.html' ? '' : page;
  const out = [];
  if (isPrimary) {
    const published = Object.entries(locales).filter(([, v]) => v.published);
    const live = published.filter(([code]) => pageStatus(ledger, code, page) !== 'pending');
    if (!live.length) return out;
    for (const l of primaryLangs) out.push({ hreflang: l, href: `${primaryBase}/${rel}` });
    for (const [code, v] of live) {
      out.push({ hreflang: v.hreflang || code, href: `${primaryBase}/${v.dir}/${rel}` });
      if (xDefault === code) out.push({ hreflang: 'x-default', href: `${primaryBase}/${v.dir}/${rel}` });
    }
    if (xDefault === 'primary') out.push({ hreflang: 'x-default', href: `${primaryBase}/${rel}` });
    return out;
  }
  const me = locales[locale] || {};
  // hreflang 是全有或全無：語系還沒上線就一個都不發，免得單向指向被 Google 整組忽略。
  if (!me.published || pageStatus(ledger, locale, page) === 'pending') return out;
  const self = `${localeBase}/${rel}`;
  out.push({ hreflang: me.hreflang || locale, href: self });
  if (xDefault === locale) out.push({ hreflang: 'x-default', href: self });
  for (const l of primaryLangs) out.push({ hreflang: l, href: `${primaryBase}/${rel}` });
  if (xDefault === 'primary') out.push({ hreflang: 'x-default', href: `${primaryBase}/${rel}` });
  return out;
}

/* ------------------------------------------------------- lang switch ---- */

function langSwitch({ isPrimary, locale, page, primaryBase, locales, strings, ledger, catalog }) {
  const rel = page === 'index.html' ? '' : page;
  const pills = [];
  if (isPrimary) {
    const published = Object.entries(locales).filter(([, v]) => v.published);
    if (!published.length) return '';
    pills.push(`<a class="active" href="${rel || 'index.html'}" lang="${ZH.lang}" aria-current="page">${ZH.langNameSelf}</a>`);
    for (const [code, v] of published) {
      const target = pageStatus(ledger, code, page) === 'pending' ? `${v.dir}/${catalog}` : `${v.dir}/${rel}`;
      pills.push(`<a href="${target}" lang="${v.hreflang || code}" hreflang="${v.hreflang || code}">${v.label || code.toUpperCase()}</a>`);
    }
  } else {
    const me = locales[locale] || {};
    pills.push(`<a href="../${rel || 'index.html'}" lang="${ZH.lang}" hreflang="${ZH.lang}">${ZH.langNameSelf}</a>`);
    pills.push(`<a class="active" href="${rel || 'index.html'}" lang="${me.hreflang || locale}" aria-current="page">${me.label || locale.toUpperCase()}</a>`);
  }
  return `<nav class="lang-switch" aria-label="${strings.langSwitchLabel}">${pills.join('')}</nav>`;
}

/* --------------------------------------------------------- git dates ---- */

let gitDates = null;
function gitLastMod(repoRoot, relFile) {
  if (gitDates === null) {
    gitDates = new Map();
    try {
      const { execFileSync } = require('child_process');
      const out = execFileSync('git', ['-C', repoRoot, 'log', '--format=%cs', '--name-only', '--diff-filter=AMR'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let date = null;
      for (const line of out.split('\n')) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(line)) date = line;
        else if (line.trim() && date && !gitDates.has(line.trim())) gitDates.set(line.trim(), date);
      }
    } catch (e) {
      gitDates = new Map();
    }
  }
  return gitDates.get(relFile) || null;
}

module.exports = {
  REPO_ROOT,
  ZH,
  resolveRoot,
  readJSON,
  loadStrings,
  fmt,
  loadLedger,
  saveLedger,
  loadLocales,
  normalize,
  sha,
  extractUnits,
  extractConfigUnits,
  HUMAN_FIELDS,
  SITE_HUMAN_FIELDS,
  pageStatus,
  latestZhChange,
  alternates,
  langSwitch,
  gitLastMod,
};
