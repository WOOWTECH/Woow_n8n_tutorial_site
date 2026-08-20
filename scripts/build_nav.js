#!/usr/bin/env node
/**
 * build_nav.js — 從 chapters.json 產生所有重複的導覽結構。
 *
 * 單一來源：`chapters.json`（章節順序、標題、卡片文案、SEO 描述）
 *          + 每個 <section id="..." data-nav="..."> 的 data-nav（章內錨點標題）
 *
 * 產生／覆寫：
 *   - 每頁的 <head>（<title>、description、canonical、Open Graph、Twitter Card）
 *   - 每頁的 <aside class="sidebar">（品牌、12 章清單、本章錨點、附錄清單）
 *   - 每頁的 <div class="pager">（上一章／下一章）
 *   - 每頁的 <footer class="site-footer">（授權標示）
 *   - index.html 的章節與附錄卡片
 *   - sitemap.xml
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

const ROOT = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'chapters.json'), 'utf8'));
const { site } = cfg;

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

/* ---------------------------------------------------------------- head --- */

function buildHead(page, html) {
  const isIndex = page.file === CATALOG;
  const title = isIndex
    ? `${site.title} · ${site.subtitle}`
    : page.kind === 'appendix'
      ? `附錄 ${page.num} · ${page.title} · ${site.title}`
      : `第 ${Number(page.num)} 章 · ${page.title} · ${site.title}`;
  const desc = page.description || site.description;
  const firstImg = (html.match(/<img[^>]+src="(assets\/screenshots\/[^"]+)"/) || [])[1];
  const ogImage = url(firstImg || site.ogImage);

  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <meta name="author" content="${esc(site.license.holder)}" />
  <link rel="canonical" href="${url(page.file)}" />
  <meta name="robots" content="index, follow, max-image-preview:large" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="${esc(site.title)}" />
  <meta property="og:locale" content="${site.locale}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${url(page.file)}" />
  <meta property="og:image" content="${ogImage}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(desc)}" />
  <meta name="twitter:image" content="${ogImage}" />
  <meta name="theme-color" content="#6183FC" />
  <link rel="license" href="${site.license.url}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Poppins:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;600;700&family=Yellowtail&display=swap" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css" />
  <link rel="stylesheet" href="assets/css/style.css" />
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
      rows.push(
        `      <li><a href="${c.file}"${c.file === page.file ? ' class="active"' : ''}>${esc(c.navLabel)}</a></li>`
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
    ? `\n    <a class="hub-link" href="index.html">◂ ${esc(HUB.navLabel || '資源總覽')}</a>`
    : '';
  return `<aside class="sidebar">
    <a class="brand" href="${CATALOG}">${esc(site.brand)}</a>
    <div class="brand-sub">${esc(site.subtitle)}</div>${hubLink}
    <h2>章節</h2>
    <ol>
${chapterItems}
    </ol>
    <div class="toc-in-chapter">
      <h2>本章</h2>
${inChapter}
    </div>
    <div class="toc-in-chapter">
      <h2>附錄</h2>
${appendixItems}
    </div>
  </aside>`;
}

/* --------------------------------------------------------------- pager --- */

function buildPager(page) {
  const i = pages.findIndex((p) => p.file === page.file);
  const prev = i > 0 ? pages[i - 1] : null;
  const next = i < pages.length - 1 ? pages[i + 1] : null;

  const prevHtml = prev
    ? `      <a class="prev" href="${prev.file}">
        <span class="label">${prev.kind === 'appendix' ? `← 附錄 ${prev.num}` : '← 上一章'}</span>
        <span class="title">${esc(prev.pagerTitle)}</span>
      </a>`
    : `      <a class="prev disabled" href="${CATALOG}">
        <span class="label">← 上一章</span>
        <span class="title">回目錄</span>
      </a>`;

  const nextLabel = !next
    ? '回目錄 →'
    : next.kind === 'appendix'
      ? page.kind === 'appendix'
        ? '下一附錄 →'
        : `附錄 ${next.num} →`
      : '下一章 →';

  const nextHtml = next
    ? `      <a class="next" href="${next.file}">
        <span class="label">${nextLabel}</span>
        <span class="title">${esc(next.pagerTitle)}</span>
      </a>`
    : `      <a class="next" href="${CATALOG}">
        <span class="label">回目錄 →</span>
        <span class="title">全套完成！</span>
      </a>`;

  return `<div class="pager">
${prevHtml}
${nextHtml}
    </div>`;
}

/* -------------------------------------------------------------- footer --- */

function buildFooter() {
  return `<footer class="site-footer">
      <p>《${esc(site.title)}》由 <a href="${site.repoUrl}" rel="noopener">${esc(site.license.holder)}</a> 製作，以 <a rel="license noopener" href="${site.license.url}">${esc(site.license.name)}</a> 授權釋出 — 可自由分享與改作，請保留出處。</p>
      <p class="footer-meta">截圖取自 Home Assistant 官方介面。Home Assistant 為 Open Home Foundation 的商標，本站與其無隸屬關係。 · <a href="${site.repoUrl}" rel="noopener">原始碼與勘誤</a></p>
    </footer>`;
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

  html = replaceOne(page.file, html, /<head>[\s\S]*?<\/head>/, buildHead(page, html), '<head>');
  html = replaceOne(
    page.file,
    html,
    /<aside class="sidebar">[\s\S]*?<\/aside>/,
    buildSidebar(page, html),
    'sidebar'
  );
  const kicker = page.kind === 'appendix' ? `附錄 ${page.num}` : `第 ${Number(page.num)} 章`;
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

  return { file: page.file, path: p, original, html };
}

function buildIndex() {
  const p = path.join(ROOT, CATALOG);
  const original = fs.readFileSync(p, 'utf8');
  let html = original;

  const card = (e) => `        <a class="chapter-card" href="${e.file}">
          <span class="num">${esc(e.num)}</span>
          <h3>${esc(e.title)}</h3>
          <p>${esc(e.card)}</p>
        </a>`;

  // 依 part 分組；沒有 part 的章節全部歸在「章節目錄」下
  const groups = [];
  for (const c of chapters) {
    const title = c.part || '章節目錄';
    const g = groups.find((x) => x.title === title);
    if (g) g.items.push(c);
    else groups.push({ title, items: [c] });
  }
  groups.push({ title: '附錄', items: appendices });

  const grids = groups
    .map(
      (g, i) => `<section class="chapter-index"${i ? ' style="margin-top:56px;"' : ''}>
      <h2 class="index-title">${esc(g.title)}</h2>
      <div class="chapter-grid">
${g.items.map(card).join('\n')}
      </div>
    </section>`
    )
    .join('\n\n    ');

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

  return { file: CATALOG, path: p, original, html };
}

function buildSitemap(outputs) {
  const today = fs.statSync(path.join(ROOT, 'chapters.json')).mtime.toISOString().slice(0, 10);
  const files = ['index.html'];
  if (CATALOG !== 'index.html') files.push(CATALOG);
  files.push(...pages.map((p) => p.file), ...HUB_PAGES);
  const entries = files.map(
    (f) => `  <url>
    <loc>${url(f)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${f === 'index.html' ? '1.0' : '0.8'}</priority>
  </url>`
  );
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

const outputs = [...pages.map(buildPage), buildIndex()];
outputs.push(buildSitemap(outputs));
validateLinks(outputs);

for (const o of outputs) {
  if (o.original !== o.html) {
    drifted.push(o.file);
    if (!CHECK) fs.writeFileSync(o.path, o.html);
  }
}

if (problems.length) {
  console.error('\n✗ 發現問題：');
  problems.forEach((p) => console.error('  · ' + p));
}

if (CHECK) {
  if (drifted.length) {
    console.error(`\n✗ 以下檔案與 chapters.json 不同步，請跑 \`node scripts/build_nav.js\` 後重新提交：`);
    drifted.forEach((f) => console.error('  · ' + f));
  } else {
    console.log('✓ 導覽結構與 chapters.json 同步');
  }
  process.exit(drifted.length || problems.length ? 1 : 0);
}

console.log(
  drifted.length ? `✓ 已更新 ${drifted.length} 個檔案：\n  ${drifted.join('\n  ')}` : '✓ 無變更，已是最新'
);
process.exit(problems.length ? 1 : 0);
