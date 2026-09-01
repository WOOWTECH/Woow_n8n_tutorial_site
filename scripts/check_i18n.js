#!/usr/bin/env node
/**
 * check_i18n.js — 翻譯品質閘門 + 翻譯帳本（ledger）維護。無外部相依。
 *
 *   node scripts/check_i18n.js                         # 報告：每頁狀態 + 所有閘門（不改檔）
 *   node scripts/check_i18n.js --strict                # CI（PR）：任何閘門失敗或帳本漂移 → exit 1
 *   node scripts/check_i18n.js --update-ledger         # main：zh 變了 → 該單元標 stale 並記日期；新單元登錄 pending
 *   node scripts/check_i18n.js --accept en:ch7_acl.html#steps [more…]   # 翻好一個單元：記 targetHash、status=complete
 *   node scripts/check_i18n.js --accept en:ch7_acl.html                  # 整頁所有單元
 *   node scripts/check_i18n.js --locale en             # 只看一個語系（預設全部）
 *   node scripts/check_i18n.js --preflight             # 譯者用：C 閘門連 pending 頁一起驗（正式流程不用，pending 頁本來就不對外）
 *
 * 閘門（對每個非主要語系的每一頁，與 zh 對照）：
 *   A 結構 parity  ：unit 序列相同；每個 unit 的 tag 骨架（tag 名 + id/class/data-icon/href/src）相同
 *   B Code freeze  ：<pre>/<code>/<kbd> 內容逐字相同（白名單 i18n/code-translate.json 可放行指定替換）
 *   C CJK 外漏     ：status ≠ pending 的頁面，可見文字與 alt/title/aria-label/placeholder/data-nav/<title>/meta 內不得有漢字
 *                    （<pre>/<code> 內、標了 lang="zh-Hant" 的元素除外）
 *   D Chrome canary：所有頁面的 generator 區（側欄標題、hub-link、kicker、pager label、footer、ui-strings）零漢字
 *   E 帳本一致     ：sourceHash 與現在的 zh 一致（否則 --strict 失敗、--update-ledger 標 stale）；
 *                    status=complete 的單元 targetHash 與現在的譯文一致（手改要標 manual）
 *   F 索引一致     ：未上線（語系 published=false 或該頁 pending）→ noindex、不進 sitemap、兩邊都不發 hreflang；
 *                    已上線 → index、進 sitemap、zh/en 互指 hreflang（全有或全無）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const i18n = require('./lib/i18n');

const REPO_ROOT = i18n.REPO_ROOT;
const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict');
const UPDATE = argv.includes('--update-ledger');
const acceptIdx = argv.indexOf('--accept');
const ACCEPT = acceptIdx >= 0 ? argv.slice(acceptIdx + 1).filter((a) => !a.startsWith('--')) : [];
const PREFLIGHT = argv.includes('--preflight');
const localeIdx = argv.indexOf('--locale');
const ONLY = localeIdx >= 0 ? argv[localeIdx + 1] : null;

const locales = i18n.loadLocales(REPO_ROOT);
const ledger = i18n.loadLedger(REPO_ROOT);
ledger.units = ledger.units || {};
const rootCfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'chapters.json'), 'utf8'));
const CATALOG = (rootCfg.hub && rootCfg.hub.catalog) || 'index.html';
const HUB_PAGES = (rootCfg.hub && rootCfg.hub.pages) || [];
const PAGES = [...rootCfg.chapters, ...rootCfg.appendices].map((p) => p.file);
const ALL_FILES = [...new Set(['index.html', CATALOG, ...PAGES, ...HUB_PAGES])];
const whitelist = i18n.readJSON(path.join(REPO_ROOT, 'i18n', 'code-translate.json'), { allow: [] });
const today = new Date().toISOString().slice(0, 10);

// 一-鿿 基本區、㐀-䶿 擴充 A、豈-﫿 相容區。用轉義寫，避免複製時被正規化成別的碼位。
const HAN = /[㐀-䶿一-鿿豈-﫿]/;
const errors = [];
const warnings = [];
let ledgerChanged = false;
const err = (s) => errors.push(s);
const warn = (s) => warnings.push(s);

/* ------------------------------------------------------------ helpers --- */

function read(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

// tag 骨架：保留 tag 名與結構性屬性，去掉文字與其他屬性
function skeleton(html) {
  const out = [];
  for (const m of html.matchAll(/<\/?([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const closing = m[0].startsWith('</');
    const tag = m[1].toLowerCase();
    if (closing) {
      out.push(`/${tag}`);
      continue;
    }
    const attrs = [];
    for (const a of ['id', 'class', 'data-icon', 'data-task-field', 'href', 'src']) {
      const v = m[2].match(new RegExp(`\\s${a}="([^"]*)"`));
      if (v) attrs.push(`${a}=${v[1].replace(/^\.\.\//, '')}`);
    }
    out.push(tag + (attrs.length ? `[${attrs.join(' ')}]` : ''));
  }
  return out;
}

function codeBlocks(html) {
  const list = [];
  for (const m of html.matchAll(/<pre\b[^>]*>[\s\S]*?<\/pre>|<code\b[^>]*>[\s\S]*?<\/code>|<kbd\b[^>]*>[\s\S]*?<\/kbd>/g)) list.push(m[0]);
  return list;
}

function stripForCjk(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/g, '')
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<(a|span|em|strong|i|b|q)\b[^>]*\blang="zh-Hant[^"]*"[^>]*>[\s\S]*?<\/\1>/g, '');
}

function cjkHits(html, label) {
  const hits = [];
  const clean = stripForCjk(html);
  // 文字節點
  for (const m of clean.matchAll(/>([^<]+)</g)) {
    if (HAN.test(m[1])) hits.push(`${label} 文字：「${m[1].trim().slice(0, 40)}」`);
  }
  // 屬性
  for (const m of clean.matchAll(/\s(alt|title|aria-label|placeholder|data-nav|content)="([^"]*)"/g)) {
    if (HAN.test(m[2])) hits.push(`${label} ${m[1]}=「${m[2].slice(0, 40)}」`);
  }
  return hits;
}

function chromeRegions(html) {
  const r = {};
  r.sidebarHeadings = [...html.matchAll(/<aside class="sidebar">[\s\S]*?<\/aside>/g)].flatMap((m) => [...m[0].matchAll(/<h2>([^<]*)<\/h2>/g)].map((h) => h[1]));
  r.hubLink = (html.match(/<a class="hub-link"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '';
  r.kicker = (html.match(/<div class="kicker">([^<]*)<\/div>/) || [])[1] || '';
  r.pagerLabels = [...html.matchAll(/<span class="label">([\s\S]*?)<\/span>/g)].map((m) => m[1]);
  r.footer = (html.match(/<footer class="site-footer">([\s\S]*?)<\/footer>/) || [])[1] || '';
  r.uiStrings = (html.match(/<script id="ui-strings"[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';
  r.langSwitch = (html.match(/<nav class="lang-switch"[^>]*aria-label="([^"]*)"/) || [])[1] || '';
  r.banner = (html.match(/<div class="callout i18n-(?:stale|pending)">([\s\S]*?)<\/div>/) || [])[1] || '';
  return r;
}

/* ---------------------------------------------------------- per locale -- */

const report = [];

for (const [code, loc] of Object.entries(locales)) {
  if (code.startsWith('_')) continue;
  if (ONLY && ONLY !== code) continue;
  const dir = path.join(REPO_ROOT, loc.dir || code);
  const cfgPath = path.join(dir, 'chapters.json');
  if (!fs.existsSync(cfgPath)) {
    err(`${code}: 找不到 ${loc.dir}/chapters.json（先跑 mirror_locale.js ${code}）`);
    continue;
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const sitemap = read(path.join(dir, 'sitemap.xml')) || '';
  /* D0. strings.<lang>.json 本身零漢字（標 lang="zh-Hant" 的片段除外）；頁尾聲明句住在該 root 的 chapters.json site.footerMeta，是翻譯單元，由 C／E 閘門管 */
  const strings = i18n.readJSON(path.join(REPO_ROOT, 'i18n', `strings.${cfg.site.lang}.json`), null);
  if (!strings) err(`${code}: 缺少 i18n/strings.${cfg.site.lang}.json`);
  else {
    for (const [k, v] of Object.entries(strings)) {
      if (k.startsWith('_')) continue;
      if (HAN.test(stripForCjk(String(v)).replace(/<[^>]+>/g, ''))) err(`${code}: [D] strings.${cfg.site.lang}.json 的 ${k} 含漢字`);
    }
  }
  if (!cfg.site.footerMeta) err(`${code}: [D] ${code}/chapters.json 缺 site.footerMeta（頁尾會是空的）`);
  const localeBase = cfg.site.baseUrl.replace(/\/$/, '');
  const primaryBase = rootCfg.site.baseUrl.replace(/\/$/, '');

  /* ---- E1: config units (chapters.json 人讀欄位) */
  const zhCfgUnits = new Map(i18n.extractConfigUnits(rootCfg).map((u) => [u.key, u.hash]));
  const enCfgUnits = new Map(i18n.extractConfigUnits(cfg).map((u) => [u.key, u.hash]));
  for (const [ukey, zhHash] of zhCfgUnits) {
    const key = `${code}:${ukey}`;
    const entry = ledger.units[key];
    const enHash = enCfgUnits.get(ukey);
    reconcile(key, entry, zhHash, enHash, `${code}/${ukey}`);
  }

  /* ---- pages */
  for (const f of ALL_FILES) {
    const zh = read(path.join(REPO_ROOT, f));
    const en = read(path.join(dir, f));
    if (!zh) continue;
    if (!en) {
      err(`${code}/${f}: 檔案不存在（跑 mirror_locale.js ${code}）`);
      continue;
    }
    const zhUnits = i18n.extractUnits(zh);
    const enUnits = i18n.extractUnits(en);
    const status = i18n.pageStatus(ledger, code, f);
    const isChapter = PAGES.includes(f);

    /* A. 結構 parity */
    const zhKeys = zhUnits.map((u) => u.key).join(' ');
    const enKeys = enUnits.map((u) => u.key).join(' ');
    if (zhKeys !== enKeys) {
      err(`${code}/${f}: [A] unit 序列不同\n      zh: ${zhKeys}\n      ${code}: ${enKeys}`);
    } else {
      zhUnits.forEach((zu, idx) => {
        const eu = enUnits[idx];
        const a = skeleton(zu.html);
        const b = skeleton(eu.html);
        if (a.join('|') !== b.join('|')) {
          const at = a.findIndex((t, i2) => t !== b[i2]);
          err(`${code}/${f}${zu.key}: [A] tag 骨架不同（第 ${at + 1} 個 tag：zh=${a[at] || '∅'} ${code}=${b[at] || '∅'}）`);
        }
        /* B. code freeze */
        const ca = codeBlocks(zu.html);
        const cb = codeBlocks(eu.html);
        if (ca.length !== cb.length) err(`${code}/${f}${zu.key}: [B] code 區塊數 zh=${ca.length} ${code}=${cb.length}`);
        else
          ca.forEach((c, i2) => {
            if (c !== cb[i2]) {
              const ok = (whitelist.allow || []).some((w) => w.file === f && w.unit === zu.key && w.zh === c && w[code] === cb[i2]);
              if (!ok) err(`${code}/${f}${zu.key}: [B] code 區塊 #${i2 + 1} 與 zh 不同且不在白名單：${cb[i2].slice(0, 60).replace(/\n/g, '⏎')}`);
            }
          });
        /* E2. ledger */
        reconcile(`${code}:${f}${zu.key}`, ledger.units[`${code}:${f}${zu.key}`], zu.hash, eu.hash, `${code}/${f}${zu.key}`);
      });
    }

    /* C. CJK 外漏（只看已翻頁；--preflight 讓譯者在 accept 前就看得到） */
    if (status !== 'pending' || PREFLIGHT) {
      const body = en.replace(/<div class="callout i18n-(?:stale|pending)">[\s\S]*?<\/div>/, '');
      const hits = cjkHits(body, `${code}/${f}`);
      hits.slice(0, 20).forEach((h) => err(`[C] ${h}`));
      if (hits.length > 20) err(`[C] ${code}/${f}: …另有 ${hits.length - 20} 處`);
    }

    /* D. chrome canary：只看 generator 純字串產生的區域（hub-link／footer 混有 chapters.json 欄位，那些由 C 閘門在翻完後檢查）。
          hub 手冊頁（sales/prompts/skills）與 hub 首頁為人手維護的整頁 unit，只驗 <html lang>。 */
    if (isChapter || f === CATALOG) {
      const r = chromeRegions(en);
      const canary = [
        ...r.sidebarHeadings.map((t) => ['sidebar h2', t]),
        ['kicker', isChapter ? r.kicker : ''],
        ...r.pagerLabels.map((t) => ['pager label', t]),
        ['ui-strings', r.uiStrings],
        ['lang-switch aria-label', r.langSwitch],
        ['banner', stripForCjk(r.banner)],
      ];
      for (const [where, text] of canary) {
        if (HAN.test(text.replace(/<[^>]+>/g, ''))) err(`${code}/${f}: [D] ${where} 含漢字：「${text.replace(/<[^>]+>/g, '').trim().slice(0, 40)}」`);
      }
    }
    if (!/<html lang="([^"]+)">/.test(en) || en.match(/<html lang="([^"]+)">/)[1] !== cfg.site.lang) err(`${code}/${f}: [D] <html lang> 不是 ${cfg.site.lang}`);

    /* F. 索引一致 */
    const pageUrl = `${localeBase}/${f === 'index.html' ? '' : f}`;
    const inMap = sitemap.includes(`<loc>${pageUrl}</loc>`);
    const noindex = /<meta name="robots" content="noindex/.test(en);
    // 上線 = 語系 published 且該頁翻完。兩者缺一，整頁 noindex、不進 sitemap、不發 hreflang。
    const live = !!loc.published && status !== 'pending';
    const zhRel = f === 'index.html' ? '' : f;
    if (!live) {
      if (!noindex) err(`${code}/${f}: [F] 未上線的頁必須 noindex（${loc.published ? 'pending 未翻完' : `語系 ${code} published=false`}；重跑 SITE_ROOT=${code} build_nav.js）`);
      if (inMap) err(`${code}/${f}: [F] 未上線的頁不得進 sitemap`);
      if (en.includes(`<link rel="alternate" hreflang=`)) err(`${code}/${f}: [F] 未上線卻發了 hreflang（單向 hreflang 會讓整組被忽略）`);
      if (zh.includes(`href="${primaryBase}/${loc.dir || code}/${zhRel}"`)) err(`${f}: [F] zh 頁指向未上線的 ${code}`);
    } else {
      if (noindex) err(`${code}/${f}: [F] 已上線頁卻 noindex`);
      if (!inMap) err(`${code}/${f}: [F] 已上線頁不在 sitemap`);
      // hreflang 是全有或全無：少一邊 return tag，整組會被 Google 忽略，所以兩邊都驗。
      const zhHas = zh.includes(`hreflang="${loc.hreflang || code}" href="${primaryBase}/${loc.dir || code}/${zhRel}"`);
      const enHas = en.includes(`hreflang="zh-Hant" href="${primaryBase}/${zhRel}"`);
      if (!zhHas) err(`${f}: [F] zh 頁缺少指向 ${code} 的 hreflang（重跑 node scripts/build_nav.js）`);
      if (!enHas) err(`${code}/${f}: [F] 缺少指回 zh 的 hreflang`);
    }

    report.push({ locale: code, file: f, status, units: zhUnits.length });
  }
}

/* ------------------------------------------------------------ reconcile -- */

function reconcile(key, entry, zhHash, enHash, label) {
  if (!entry) {
    if (UPDATE) {
      ledger.units[key] = { status: 'pending', sourceHash: zhHash, targetHash: null, registeredAt: today };
      ledgerChanged = true;
      warn(`${label}: 新單元 → 登錄 pending`);
    } else {
      err(`${label}: [E] 帳本沒有這個單元（跑 --update-ledger 登錄）`);
    }
    return;
  }
  if (ACCEPT.length && ACCEPT.some((a) => key === a || key.startsWith(a + '#') || key.startsWith(a + '.') || key.startsWith(a + ':'))) {
    if (enHash == null) err(`${label}: [E] 找不到譯文，無法 accept`);
    else {
      entry.status = entry.status === 'localized' ? 'localized' : 'complete';
      entry.sourceHash = zhHash;
      entry.targetHash = enHash;
      entry.translatedAt = today;
      delete entry.zhChangedAt;
      ledgerChanged = true;
    }
    return;
  }
  if (entry.sourceHash !== zhHash) {
    if (UPDATE) {
      if (entry.status === 'complete' || entry.status === 'localized' || entry.status === 'manual') entry.status = 'stale';
      entry.sourceHash = zhHash;
      entry.zhChangedAt = today;
      ledgerChanged = true;
      warn(`${label}: zh 已變 → ${entry.status}`);
    } else if (STRICT) {
      err(`${label}: [E] zh 來源已變但帳本未更新（同 PR 翻譯後 --accept，或 --update-ledger 標 stale）`);
    } else {
      warn(`${label}: zh 來源已變（status=${entry.status}）`);
    }
  }
  if ((entry.status === 'complete' || entry.status === 'localized') && enHash != null && entry.targetHash !== enHash) {
    err(`${label}: [E] 譯文被手改但帳本未記錄（跑 --accept ${key}，或把 status 改為 manual）`);
  }
  if (entry.status === 'complete' && enHash != null && zhHash === enHash) {
    warn(`${label}: status=complete 但譯文與原文完全相同（像 DNS／FAQ 這類本來就相同的可忽略）`);
  }
}

/* ---------------------------------------------------------------- out ---- */

if (ledgerChanged) i18n.saveLedger(REPO_ROOT, ledger);

if (report.length) {
  const byLocale = {};
  for (const r of report) (byLocale[r.locale] = byLocale[r.locale] || []).push(r);
  for (const [code, rows] of Object.entries(byLocale)) {
    const counts = rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
    console.log(`\n${code}/  ${rows.length} 頁 → ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    for (const r of rows) console.log(`  ${r.status.padEnd(8)} ${r.file}  (${r.units} units)`);
  }
}
if (warnings.length) {
  console.log(`\n⚠ ${warnings.length} 個提醒：`);
  warnings.forEach((w) => console.log('  · ' + w));
}
if (errors.length) {
  console.error(`\n✗ ${errors.length} 個問題：`);
  errors.forEach((e) => console.error('  · ' + e));
  process.exit(1);
}
console.log(`\n✓ check_i18n：${ACCEPT.length ? `已 accept ${ACCEPT.join(', ')}；` : ''}${UPDATE ? '帳本已更新；' : ''}所有閘門通過`);
