#!/usr/bin/env node
/**
 * build_nav.js — 從 chapters.json 產生所有重複的導覽結構。
 *
 * 單一來源：`chapters.json`（章節順序、標題、卡片文案、SEO 描述）
 *          + 每個 <section id="..." data-nav="..."> 的 data-nav（章內錨點標題）
 *
 * 產生／覆寫：
 *   - 每頁的 <head>（<title>、description、canonical、hreflang、Open Graph、Twitter Card）
 *   - 每頁的 <aside class="sidebar">（品牌、語言切換、章節清單、本章錨點、附錄清單）
 *   - 每頁的 <div class="pager">（上一章／下一章）
 *   - 每頁的 <footer class="site-footer">（授權標示）
 *   - 目錄頁的章節與附錄卡片
 *   - sitemap.xml（lastmod 取 git 最後提交日）
 *   - 404.html 的 <head>
 *
 * 多語系：
 *   node scripts/build_nav.js                 # 建置 zh-TW（repo 根目錄）
 *   SITE_ROOT=en node scripts/build_nav.js    # 建置 en/（同一支程式、同一套規則；chrome 字串讀 i18n/strings.en.json）
 *   翻譯進度看 i18n/ledger.json：pending 頁 noindex、不進 sitemap、不輸出 hreflang，並顯示「尚未翻譯」橫幅。
 *
 * 用法：
 *   node scripts/build_nav.js            # 寫入檔案
 *   node scripts/build_nav.js --check    # 只檢查有無漂移，有的話 exit 1（CI 用）
 *
 * 新增一章：在 chapters.json 加一筆 + 建好該 HTML 的 <main> 內容，再跑一次本腳本。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const i18n = require('./lib/i18n');

const { repoRoot: REPO_ROOT, root: ROOT, subdir: SUBDIR, isPrimary: IS_PRIMARY } = i18n.resolveRoot();
const CHECK = process.argv.includes('--check');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'chapters.json'), 'utf8'));
const { site } = cfg;
// 字串表三層：lib/i18n.js 的 zh 字面值 → i18n/strings.<lang>.json（語系共用）→ chapters.json 的 site.strings（本站專屬，
// 例：pager 標籤要帶 mdi 圖示、404 標題不同）。這樣 13 站可以共用同一支 generator，站別差異全部留在 chapters.json。
const S = { ...i18n.loadStrings(REPO_ROOT, site.lang), ...(site.strings || {}), lang: (site.strings && site.strings.lang) || i18n.loadStrings(REPO_ROOT, site.lang).lang };
// 版面旋鈕（預設值 = headscale 的現行輸出；其他站在 chapters.json 的 site.chrome 裡調）
const CHROME = {
  hideEmptyAppendices: false, // true：沒有附錄時，側欄與目錄頁都不輸出「附錄」空區塊
  catalogGroupClass: null,    // 例 "spaced"：目錄頁第二組以後用 class 而非 inline style
  firstPrevDisabled: true,    // 第一章的「上一章」：true = class="prev disabled"
  manage404: 'auto',          // auto：404.html 的 <head> 沒有 <title> 才接管；true/false 強制
  ...((site.chrome) || {}),
};
const LOCALES = i18n.loadLocales(REPO_ROOT);
const LEDGER = i18n.loadLedger(REPO_ROOT);
const LOCALE = IS_PRIMARY ? null : site.localeCode || SUBDIR;
const X_DEFAULT = (cfg.i18n && cfg.i18n.xDefault) || (IS_PRIMARY ? null : null);
const primaryCfg = IS_PRIMARY ? cfg : JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'chapters.json'), 'utf8'));
const PRIMARY_BASE = primaryCfg.site.baseUrl.replace(/\/$/, '');
const PRIMARY_LANGS = (primaryCfg.i18n && primaryCfg.i18n.hreflang) || ['zh-Hant', 'zh'];
const XDEF = (primaryCfg.i18n && primaryCfg.i18n.xDefault) || null;
const ASSET_BASE = site.assetBase || ''; // 例：en/ 用 "../"
const ASSET_BASE_URL = (site.assetBaseUrl || site.baseUrl).replace(/\/$/, '');
const FONTS_URL =
  site.fontsUrl ||
  'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Poppins:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;600;700&family=Yellowtail&display=swap';

// hub 模式：index.html 為人手維護的資源總覽，教學目錄頁輸出到 hub.catalog。
const HUB = cfg.hub || null;
const CATALOG = (HUB && HUB.catalog) || 'index.html';
const HUB_PAGES = (HUB && HUB.pages) || [];

const chapters = cfg.chapters.map((c) => ({ ...c, kind: 'chapter' }));
const appendices = cfg.appendices.map((a) => ({ ...a, kind: 'appendix' }));
const pages = [...chapters, ...appendices];

const problems = [];
const drifted = [];

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) =>
  String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
const stripTags = (s) => s.replace(/<[^>]+>/g, '');
const url = (rel) => `${site.baseUrl.replace(/\/$/, '')}/${rel === 'index.html' ? '' : rel}`;
const status = (file) => (IS_PRIMARY ? 'complete' : i18n.pageStatus(LEDGER, LOCALE, file));
// published 是「上線開關」，跟「翻完了沒」是兩件事：翻完但還沒上線的語系整個 root 維持 noindex、
// 不進 sitemap、不發 hreflang，zh 那邊也不會出現語言切換——所以 zh 產物在上線前逐位元不變。
const LOCALE_LIVE = IS_PRIMARY || !!(LOCALES[LOCALE] && LOCALES[LOCALE].published);
const indexable = (file) => LOCALE_LIVE && status(file) !== 'pending';
// i18n.css 只在真的要用時才載入：建置其他語系的 root，或 zh 已經要顯示語言切換／hreflang。
// 這樣單語系階段的 zh 產物完全不會多出一行。
const NEEDS_I18N_CSS = !IS_PRIMARY || Object.entries(LOCALES).some(([k, v]) => !k.startsWith('_') && v.published);
const I18N_CSS = NEEDS_I18N_CSS ? `\n  <link rel="stylesheet" href="${site.assetBase || ''}assets/css/i18n.css" />` : '';

/* ---------------------------------------------------------------- head --- */

function alternateLinks(file) {
  const list = i18n.alternates({
    isPrimary: IS_PRIMARY,
    locale: LOCALE,
    page: file,
    primaryBase: PRIMARY_BASE,
    primaryLangs: PRIMARY_LANGS,
    localeBase: site.baseUrl.replace(/\/$/, ''),
    ledger: LEDGER,
    locales: LOCALES,
    xDefault: XDEF,
  });
  return list.map((a) => `\n  <link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />`).join('');
}

function buildHead(page, html) {
  const isIndex = page.file === CATALOG;
  const title = isIndex
    ? i18n.fmt(S.titleCatalog, { site: site.title, subtitle: site.subtitle })
    : page.kind === 'appendix'
      ? i18n.fmt(S.titleAppendix, { n: page.num, title: page.title, site: site.title })
      : i18n.fmt(S.titleChapter, { n: Number(page.num), title: page.title, site: site.title });
  const desc = page.description || site.description;
  const firstImg = (html.match(/<img[^>]+src="(?:\.\.\/)?(assets\/screenshots\/[^"]+)"/) || [])[1];
  const ogImage = `${ASSET_BASE_URL}/${firstImg || site.ogImage}`;
  const robots = indexable(page.file) ? 'index, follow, max-image-preview:large' : 'noindex, follow';
  const ogAlt = (site.localeAlternate || []).map((l) => `\n  <meta property="og:locale:alternate" content="${l}" />`).join('');
  const ogMeta = site.ogImageMeta
    ? `\n  <meta property="og:image:type" content="${site.ogImageMeta.type || 'image/png'}" />\n  <meta property="og:image:width" content="${site.ogImageMeta.width || 1200}" />\n  <meta property="og:image:height" content="${site.ogImageMeta.height || 630}" />`
    : '';

  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <meta name="author" content="${esc(site.license.holder)}" />
  <link rel="canonical" href="${url(page.file)}" />${alternateLinks(page.file)}
  <meta name="robots" content="${robots}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="${esc(site.title)}" />
  <meta property="og:locale" content="${site.locale}" />${ogAlt}
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${url(page.file)}" />
  <meta property="og:image" content="${ogImage}" />${ogMeta}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(desc)}" />
  <meta name="twitter:image" content="${ogImage}" />
  <meta name="theme-color" content="#6183FC" />
  <link rel="license" href="${site.license.url}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="${FONTS_URL}" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css" />
  <link rel="stylesheet" href="${ASSET_BASE}assets/css/style.css" />${I18N_CSS}
</head>`;
}

function build404Head() {
  const title = i18n.fmt(S.title404, { site: site.title });
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="robots" content="noindex, follow" />
  <meta name="theme-color" content="#6183FC" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="${FONTS_URL}" />
  <link rel="stylesheet" href="${ASSET_BASE_URL}/assets/css/style.css" />
  <link rel="stylesheet" href="${ASSET_BASE_URL}/assets/css/i18n.css" />
</head>`;
}

/* --------------------------------------------------- data-nav 自動補寫 --- */

// 章內錨點標題放在 <section data-nav="...">。舊檔案還沒有這個屬性時，
// 依 chapters.json 的 sectionLabels 補寫；查不到就從 <h2> 內文推一個短標題。
function shortLabel(h2) {
  let t = stripTags(h2).trim();
  t = t.split(/\s*[—–]\s*/)[0];
  t = t.replace(/（[^）]*）$/, '').trim();
  return t;
}

function migrateDataNav(file, html) {
  const map = (cfg.sectionLabels || {})[file] || {};
  return html.replace(
    /<section id="([^"]+)"(?![^>]*data-nav)([^>]*)>(\s*)<h2([^>]*)>([\s\S]*?)<\/h2>/g,
    (m, id, rest, ws, h2attrs, h2) =>
      `<section id="${id}" data-nav="${esc(unesc(map[id] || shortLabel(h2)))}"${rest}>${ws}<h2${h2attrs}>${h2}</h2>`
  );
}

/* ------------------------------------------------------------- sidebar --- */

function buildSidebar(page, html) {
  const sections = [...html.matchAll(/<section id="([^"]+)"[^>]*\bdata-nav="([^"]*)"/g)].map((m) => ({
    id: m[1],
    nav: unesc(m[2]),
  }));
  const bare = [...html.matchAll(/<section id="([^"]+)"(?![^>]*data-nav)/g)].map((m) => m[1]);
  if (bare.length) problems.push(`${page.file}: <section> 缺 data-nav → ${bare.join(', ')}`);
  if (!sections.length) problems.push(`${page.file}: 找不到任何 <section id data-nav>`);

  let lastPart = null;
  const chapterItems = chapters
    .map((c) => {
      const rows = [];
      if (c.part && c.part !== lastPart) {
        lastPart = c.part;
        rows.push(`      <li class="part-label">${esc(c.part)}</li>`);
      }
      const pending = status(c.file) === 'pending' ? ' data-i18n="pending"' : '';
      rows.push(
        `      <li${pending}><a href="${c.file}"${c.file === page.file ? ' class="active"' : ''}>${esc(c.navLabel)}</a></li>`
      );
      return rows.join('\n');
    })
    .join('\n');

  const inChapter = sections
    .map((s) => `      <a href="#${s.id}">${esc(s.nav)}</a>`)
    .join('\n');

  const appendixItems = appendices
    .map(
      (a) =>
        `      <a href="${a.file}"${a.file === page.file ? ' class="active"' : ''}>${esc(a.navLabel)}</a>`
    )
    .join('\n');

  const hubLink = HUB
    ? `\n    <a class="hub-link" href="index.html">${i18n.fmt(S.hubLink, { label: esc(HUB.navLabel || S.hubLabelDefault) })}</a>`
    : '';
  const sw = i18n.langSwitch({
    isPrimary: IS_PRIMARY,
    locale: LOCALE,
    page: page.file,
    primaryBase: PRIMARY_BASE,
    locales: LOCALES,
    strings: S,
    ledger: LEDGER,
    catalog: CATALOG,
  });
  const switchHtml = sw ? `\n    ${sw}` : '';
  const appendixBlock =
    CHROME.hideEmptyAppendices && !appendices.length
      ? ''
      : `
    <div class="toc-in-chapter">
      <h2>${S.sidebarAppendices}</h2>
${appendixItems}
    </div>`;
  return `<aside class="sidebar">
    <a class="brand" href="${CATALOG}">${esc(site.brand)}</a>
    <div class="brand-sub">${esc(site.subtitle)}</div>${switchHtml}${hubLink}
    <h2>${S.sidebarChapters}</h2>
    <ol>
${chapterItems}
    </ol>
    <div class="toc-in-chapter">
      <h2>${S.sidebarInChapter}</h2>
${inChapter}
    </div>${appendixBlock}
  </aside>`;
}

/* --------------------------------------------------------------- pager --- */

function buildPager(page) {
  const i = pages.findIndex((p) => p.file === page.file);
  const prev = i > 0 ? pages[i - 1] : null;
  const next = i < pages.length - 1 ? pages[i + 1] : null;

  const prevHtml = prev
    ? `      <a class="prev" href="${prev.file}">
        <span class="label">${prev.kind === 'appendix' ? i18n.fmt(S.pagerPrevAppendix, { n: prev.num }) : S.pagerPrev}</span>
        <span class="title">${esc(prev.pagerTitle)}</span>
      </a>`
    : `      <a class="prev${CHROME.firstPrevDisabled ? ' disabled' : ''}" href="${CATALOG}">
        <span class="label">${S.pagerFirstPrev || S.pagerPrev}</span>
        <span class="title">${S.pagerFirstPrevTitle || S.pagerContents}</span>
      </a>`;

  const nextLabel = !next
    ? S.pagerContentsNext
    : next.kind === 'appendix'
      ? page.kind === 'appendix'
        ? S.pagerNextAppendixFromAppendix
        : i18n.fmt(S.pagerNextAppendix, { n: next.num })
      : S.pagerNext;

  const nextHtml = next
    ? `      <a class="next" href="${next.file}">
        <span class="label">${nextLabel}</span>
        <span class="title">${esc(next.pagerTitle)}</span>
      </a>`
    : `      <a class="next" href="${CATALOG}">
        <span class="label">${S.pagerContentsNext}</span>
        <span class="title">${S.pagerDone}</span>
      </a>`;

  return `<div class="pager">
${prevHtml}
${nextHtml}
    </div>`;
}

/* -------------------------------------------------------------- footer --- */

// 站別句子（商標／版本聲明）住在各 root 的 chapters.json site.footerMeta，是翻譯單元；kit 本身不含任何站名。
function buildFooter() {
  if (!site.footerMeta) problems.push('chapters.json: 缺 site.footerMeta（頁尾的商標／來源聲明句）');
  const license = i18n.fmt(S.footerLicense, {
    site: esc(site.title),
    repoUrl: site.repoUrl,
    holder: esc(site.license.holder),
    licenseUrl: site.license.url,
    licenseName: esc(site.license.name),
  });
  const meta = site.footerMeta || '';
  const links = (site.footerLinks || []).length
    ? `\n      <div class="link-row">${site.footerLinks.map((l) => `<a href="${l.href === 'repo' ? site.repoUrl : l.href}" rel="noopener">${esc(l.label)}</a>`).join('')}</div>`
    : '';
  return `<footer class="site-footer">
      <p>${license}</p>${links}
      <p class="footer-meta">${meta} · <a href="${site.repoUrl}" rel="noopener">${S.footerSource}</a></p>
    </footer>`;
}

/* ------------------------------------------------------- i18n extras ----- */

// 非主要語系才有：翻譯狀態橫幅 + 給 toc.js 的 UI 字串。zh-TW 產物完全不受影響。
function applyLocaleExtras(page, html) {
  if (IS_PRIMARY) return html;
  html = html.replace(/\n\s*<div class="callout i18n-(?:stale|pending)">[\s\S]*?<\/div>(?=\n)/g, '');
  const st = status(page.file);
  const zhHref = `../${page.file}`;
  let banner = '';
  if (st === 'pending') {
    banner = `\n    <div class="callout i18n-pending">${i18n.fmt(S.pendingBanner, { zhHref })}</div>`;
  } else if (st === 'stale') {
    banner = `\n    <div class="callout i18n-stale">${i18n.fmt(S.staleBanner, { date: i18n.latestZhChange(LEDGER, LOCALE, page.file) || '', zhHref })}</div>`;
  }
  if (banner) {
    html = html.replace(/(\n\s*)(<div class="chapter-header">)/, (m, ws, open_) => `${ws}${banner.trim()}${ws}${open_}`);
  }
  html = html.replace(/\n?\s*<script id="ui-strings"[^>]*>[\s\S]*?<\/script>/, '');
  const ui = JSON.stringify({ tocToggle: S.tocToggle, tocExpand: S.tocExpand, tocCollapse: S.tocCollapse });
  html = html.replace(/(<script src="(?:\.\.\/)?assets\/js\/toc\.js"><\/script>)/, `<script id="ui-strings" type="application/json">${ui}</script>\n$1`);
  return html;
}

function setHtmlLang(html) {
  return html.replace(/<html lang="[^"]*">/, `<html lang="${site.htmlLang || S.lang}">`);
}

/* ---------------------------------------------------------------- apply -- */

function replaceOne(file, html, re, next, what) {
  if (!re.test(html)) {
    problems.push(`${file}: 找不到 ${what} 區塊`);
    return html;
  }
  return html.replace(re, () => next);
}

function buildPage(page) {
  const p = path.join(ROOT, page.file);
  const original = fs.readFileSync(p, 'utf8');
  let html = migrateDataNav(page.file, original);

  html = setHtmlLang(html);
  html = replaceOne(page.file, html, /<head>[\s\S]*?<\/head>/, buildHead(page, html), '<head>');
  html = replaceOne(
    page.file,
    html,
    /<aside class="sidebar">[\s\S]*?<\/aside>/,
    buildSidebar(page, html),
    'sidebar'
  );
  const kicker =
    page.kind === 'appendix' ? i18n.fmt(S.kickerAppendix, { n: page.num }) : i18n.fmt(S.kickerChapter, { n: Number(page.num) });
  const kickerRe = /(<div class="chapter-header">\s*<div class="kicker">)[\s\S]*?(<\/div>)/;
  if (kickerRe.test(html)) {
    html = html.replace(kickerRe, (m, open_, close_) => `${open_}${esc(kicker)}${close_}`);
  } else {
    problems.push(`${page.file}: 找不到 chapter-header 的 kicker 區塊`);
  }

  html = replaceOne(page.file, html, /<div class="pager">[\s\S]*?<\/div>/, buildPager(page), 'pager');

  const footer = buildFooter();
  if (/<footer class="site-footer">/.test(html)) {
    html = html.replace(/<footer class="site-footer">[\s\S]*?<\/footer>/, () => footer);
  } else {
    html = html.replace(/(<div class="pager">[\s\S]*?<\/div>)/, (m) => `${m}\n\n    ${footer}`);
  }

  html = applyLocaleExtras(page, html);
  return { file: page.file, path: p, original, html };
}

function buildIndex() {
  const p = path.join(ROOT, CATALOG);
  const original = fs.readFileSync(p, 'utf8');
  let html = original;

  const card = (e) => `        <a class="chapter-card" href="${e.file}"${status(e.file) === 'pending' ? ' data-i18n="pending"' : ''}>
          <span class="num">${esc(e.num)}</span>
          <h3>${esc(e.title)}</h3>
          <p>${esc(e.card)}</p>
        </a>`;

  // 依 part 分組；沒有 part 的章節全部歸在「章節目錄」下
  const groups = [];
  for (const c of chapters) {
    const title = c.part || S.indexGroupDefault;
    const g = groups.find((x) => x.title === title);
    if (g) g.items.push(c);
    else groups.push({ title, items: [c] });
  }
  if (!(CHROME.hideEmptyAppendices && !appendices.length)) groups.push({ title: S.indexGroupAppendices, items: appendices });

  const groupOpen = (i) =>
    !i ? '<section class="chapter-index">' : CHROME.catalogGroupClass ? `<section class="chapter-index ${CHROME.catalogGroupClass}">` : '<section class="chapter-index" style="margin-top:56px;">';
  const grids = groups
    .map(
      (g, i) => `${groupOpen(i)}
      <h2 class="index-title">${esc(g.title)}</h2>
      <div class="chapter-grid">
${g.items.map(card).join('\n')}
      </div>
    </section>`
    )
    .join('\n\n    ');

  html = setHtmlLang(html);
  html = replaceOne(CATALOG, html, /<head>[\s\S]*?<\/head>/, buildHead({ file: CATALOG }, original), '<head>');
  html = replaceOne(
    CATALOG,
    html,
    /<section class="chapter-index">[\s\S]*<\/section>/,
    grids,
    'chapter grids'
  );

  const footer = buildFooter();
  if (/<footer class="site-footer">/.test(html)) {
    html = html.replace(/<footer class="site-footer">[\s\S]*?<\/footer>/, () => footer);
  } else {
    html = html.replace(/(\s*)<\/main>/, `\n\n    ${footer}\n  </main>`);
  }

  html = applyLangSwitch(html, CATALOG);
  return { file: CATALOG, path: p, original, html };
}

// hub 首頁（index.html）人手維護；generator 只接管 <html lang>、hreflang 與（有其他語系時的）語言切換標記。
function buildHubIndex() {
  if (CATALOG === 'index.html') return null;
  const p = path.join(ROOT, 'index.html');
  if (!fs.existsSync(p)) return null;
  const original = fs.readFileSync(p, 'utf8');
  let html = setHtmlLang(original);
  html = applyRobots(html, 'index.html');
  html = applyI18nCss(html);
  html = applyLocaleUrls(html, 'index.html');
  html = applyAlternates(html, 'index.html');
  html = applyLangSwitch(html, 'index.html');
  return { file: 'index.html', path: p, original, html };
}

// 自帶樣式的獨立手冊頁（sales/prompts/skills）：generator 只接管 <html lang>；其他語系尚未翻譯時加 noindex。
function buildHubPage(file) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return null;
  const original = fs.readFileSync(p, 'utf8');
  let html = setHtmlLang(original);
  html = applyRobots(html, file);
  html = applyI18nCss(html);
  html = applyLocaleUrls(html, file);
  html = applyAlternates(html, file);
  html = applyLangSwitch(html, file);
  return { file, path: p, original, html };
}

// 手寫頁的 <head> 不歸 generator 管，只補／收一行 i18n.css（用註解夾住，可反覆執行）
function applyI18nCss(html) {
  html = html.replace(/\n?\s*<!-- i18n:css -->[\s\S]*?<!-- \/i18n:css -->/, '');
  if (!NEEDS_I18N_CSS) return html;
  const link = `<link rel="stylesheet" href="${site.assetBase || ''}assets/css/i18n.css" />`;
  if (/<link rel="stylesheet" href="[^"]*assets\/css\/style\.css" \/>/.test(html)) {
    return html.replace(/([ \t]*)(<link rel="stylesheet" href="[^"]*assets\/css\/style\.css" \/>)/, (m, ws, tag) => `${ws}${tag}\n${ws}<!-- i18n:css -->${link}<!-- /i18n:css -->`);
  }
  // 自帶樣式的單檔手冊沒有 style.css 可以掛，改掛在 </head> 前；i18n.css 的 token 都有 fallback。
  return html.replace(/([ \t]*)<\/head>/, (m, ws) => `${ws}<!-- i18n:css -->${link}<!-- /i18n:css -->\n${ws}</head>`);
}

// 手寫頁的 <head> 文案不歸 generator 管，但「這一頁住在哪個站根」是結構不是翻譯：
// 鏡像出來的 en/ 會原封不動沿用 zh 的 canonical／og:url，等於整個英文站自己宣告 canonical 是中文頁。
// 這些網址一律由 generator 依 chapters.json 改寫，人不用記，也不會翻譯時被漏掉。
function applyLocaleUrls(html, file) {
  if (IS_PRIMARY) return html;
  const self = url(file);
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${self}$2`);
  html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${self}$2`);
  html = html.replace(/(<meta property="og:locale" content=")[^"]*(")/, `$1${site.locale}$2`);
  html = html.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${ASSET_BASE_URL}/${site.ogImage}$2`);
  html = html.replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${ASSET_BASE_URL}/${site.ogImage}$2`);
  // 字型與授權條款也跟著語系走：中文站要 Noto Sans TC、英文站不用；CC 條款有各語言的 deed 頁。
  html = html.replace(/(<link rel="stylesheet" href=")https:\/\/fonts\.googleapis\.com\/css2[^"]*(")/, `$1${FONTS_URL}$2`);
  html = html.replace(/(<a rel="license noopener" href=")[^"]*(")/, `$1${site.license.url}$2`);
  // og:locale:alternate 用註解夾住，反覆執行不會疊加
  html = html.replace(/\n?\s*<!-- i18n:oglocale -->[\s\S]*?<!-- \/i18n:oglocale -->/, '');
  const ogAlt = (site.localeAlternate || []).map((l) => `<meta property="og:locale:alternate" content="${l}" />`).join('');
  if (ogAlt) {
    html = html.replace(/([ \t]*)(<meta property="og:locale" content="[^"]*" \/>)/, (m, ws, tag) => `${ws}${tag}\n${ws}<!-- i18n:oglocale -->${ogAlt}<!-- /i18n:oglocale -->`);
  }
  return html;
}

// hreflang：手寫頁也要有，缺一邊 Google 會整組忽略。用註解夾住，未發布時 alternates() 回空陣列，zh 產物不動。
function applyAlternates(html, file) {
  html = html.replace(/\n?\s*<!-- i18n:alternates -->[\s\S]*?<!-- \/i18n:alternates -->/, '');
  const alt = alternateLinks(file);
  if (!alt) return html;
  return html.replace(/(<link rel="canonical"[^>]*\/>)/, (m) => `${m}\n  <!-- i18n:alternates -->${alt}\n  <!-- /i18n:alternates -->`);
}

// 手寫頁（資源總覽、三本手冊）與目錄頁的語言切換：章節頁的側欄是 generator 產的，這幾頁不是，
// 所以用註解夾住單獨插一塊。未發布語系時 langSwitch() 回空字串，zh 產物不動。
function applyLangSwitch(html, file) {
  html = html.replace(/\n?\s*<!-- i18n:switch -->[\s\S]*?<!-- \/i18n:switch -->/, '');
  const sw = i18n.langSwitch({
    isPrimary: IS_PRIMARY,
    locale: LOCALE,
    page: file,
    primaryBase: PRIMARY_BASE,
    locales: LOCALES,
    strings: S,
    ledger: LEDGER,
    catalog: CATALOG,
  });
  if (!sw) return html;
  if (/<a class="hub-link"/.test(html)) {
    return html.replace(/([ \t]*)(<a class="hub-link")/, (m, ws, tag) => `${ws}<!-- i18n:switch -->${sw}<!-- /i18n:switch -->\n${ws}${tag}`);
  }
  // 各站 hero 容器寫法不一：<div class="hero">、<header class="hero">、<div class="resource-hero">；第一個命中的就是插入點。
  const heroRe = /(<(?:div|header) class="(?:hero|resource-hero)"[^>]*>)/;
  if (!heroRe.test(html)) problems.push(`${file}: 找不到放語言切換的位置（hub-link 或 hero 容器）`);
  return html.replace(heroRe, (m) => `${m}\n      <!-- i18n:switch -->\n      ${sw}\n      <!-- /i18n:switch -->`);
}

function applyRobots(html, file) {
  if (IS_PRIMARY) return html;
  const want = indexable(file) ? 'index, follow' : 'noindex, follow';
  if (/<meta name="robots" content="[^"]*"\s*\/?>/.test(html)) {
    return html.replace(/<meta name="robots" content="[^"]*"(\s*\/?>)/, `<meta name="robots" content="${want}"$1`);
  }
  return html.replace(/(<link rel="canonical"[^>]*\/>)/, (m) => `${m}\n  <meta name="robots" content="${want}" />`);
}

function build404() {
  if (!IS_PRIMARY) return null;
  const p = path.join(ROOT, '404.html');
  if (!fs.existsSync(p)) return null;
  const original = fs.readFileSync(p, 'utf8');
  // auto：手寫的 404 <head>（有 <title>）不碰；只有空殼才由 generator 補。
  const manage = CHROME.manage404 === 'auto' ? !/<head>[\s\S]*?<title>[\s\S]*?<\/head>/.test(original) : !!CHROME.manage404;
  if (!manage) return null;
  let html = replaceOne('404.html', original, /<head>[\s\S]*?<\/head>/, build404Head(), '<head>');
  return { file: '404.html', path: p, original, html };
}

function buildSitemap() {
  const fallback = new Date().toISOString().slice(0, 10);
  const files = ['index.html'];
  if (CATALOG !== 'index.html') files.push(CATALOG);
  files.push(...pages.map((p) => p.file), ...HUB_PAGES);
  const listed = files.filter(indexable);
  const entries = listed.map((f) => {
    const rel = SUBDIR ? `${SUBDIR}/${f}` : f;
    const lastmod = site.sitemap && site.sitemap.lastmod === 'none' ? null : i18n.gitLastMod(REPO_ROOT, rel) || fallback;
    return `  <url>
    <loc>${url(f)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>monthly</changefreq>
    <priority>${f === 'index.html' ? '1.0' : '0.8'}</priority>
  </url>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
  const p = path.join(ROOT, 'sitemap.xml');
  const original = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  return { file: 'sitemap.xml', path: p, original, html: xml };
}

/* ------------------------------------------------------------ validate --- */

function validateLinks(outputs) {
  const byFile = new Map(outputs.map((o) => [o.file, o.html]));
  for (const [file, html] of byFile) {
    if (!file.endsWith('.html')) continue;
    for (const m of html.matchAll(/(?:href|src)="([^"#:]+)(?:#[^"]*)?"/g)) {
      const target = m[1];
      if (!target || target.startsWith('//') || target.startsWith('mailto:')) continue;
      if (!fs.existsSync(path.join(ROOT, target))) {
        problems.push(`${file}: 連結指向不存在的檔案 → ${target}`);
      }
    }
    for (const m of html.matchAll(/href="#([^"]+)"/g)) {
      if (!html.includes(`id="${m[1]}"`)) problems.push(`${file}: 錨點 #${m[1]} 無對應 id`);
    }
  }
}

/* ----------------------------------------------------------------- run --- */

const outputs = [...pages.map(buildPage), buildIndex(), buildHubIndex(), ...HUB_PAGES.map(buildHubPage), build404()].filter(Boolean);
outputs.push(buildSitemap());
validateLinks(outputs);

for (const o of outputs) {
  if (o.original !== o.html) {
    drifted.push(o.file);
    if (!CHECK) fs.writeFileSync(o.path, o.html);
  }
}

const where = SUBDIR ? `${SUBDIR}/` : '';
if (problems.length) {
  console.error('\n✗ 發現問題：');
  problems.forEach((p) => console.error('  · ' + where + p));
}

if (CHECK) {
  if (drifted.length) {
    console.error(`\n✗ 以下檔案與 ${where}chapters.json 不同步，請跑 \`${SUBDIR ? `SITE_ROOT=${SUBDIR} ` : ''}node scripts/build_nav.js\` 後重新提交：`);
    drifted.forEach((f) => console.error('  · ' + where + f));
  } else {
    console.log(`✓ ${where}導覽結構與 chapters.json 同步`);
  }
  process.exit(drifted.length || problems.length ? 1 : 0);
}

console.log(
  drifted.length ? `✓ 已更新 ${drifted.length} 個檔案：\n  ${drifted.map((f) => where + f).join('\n  ')}` : '✓ 無變更，已是最新'
);
process.exit(problems.length ? 1 : 0);
