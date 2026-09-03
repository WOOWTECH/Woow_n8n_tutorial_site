#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const sourceRoot = path.resolve(__dirname, '..', '..');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-code-translations-'));

try {
  fs.mkdirSync(path.join(fixtureRoot, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'i18n', '_proposals'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'en'), { recursive: true });
  fs.copyFileSync(
    path.join(sourceRoot, 'scripts', 'apply_code_translations.js'),
    path.join(fixtureRoot, 'scripts', 'apply_code_translations.js'),
  );
  fs.copyFileSync(
    path.join(sourceRoot, 'scripts', 'lib', 'i18n.js'),
    path.join(fixtureRoot, 'scripts', 'lib', 'i18n.js'),
  );
  fs.writeFileSync(
    path.join(fixtureRoot, 'i18n', 'locales.json'),
    JSON.stringify({ en: { dir: 'en', hreflang: 'en', published: false } }),
  );
  fs.writeFileSync(
    path.join(fixtureRoot, 'i18n', 'code-translate.json'),
    JSON.stringify({ _readme: '', allow: [] }),
  );
  fs.writeFileSync(
    path.join(fixtureRoot, 'i18n', '_proposals', 'swap.html.json'),
    JSON.stringify({
      file: 'swap.html',
      entries: [
        { unit: '#swap', zh: '<code>alpha</code>', en: '<code>beta</code>' },
        { unit: '#swap', zh: '<code>beta</code>', en: '<code>alpha</code>' },
        { unit: '#plain', zh: '<code>原文</code>', en: '<code>translation</code>' },
      ],
    }),
  );
  const initial = '<section id="swap"><code>alpha</code><code>beta</code></section><section id="plain"><code>原文</code></section>\n';
  fs.writeFileSync(path.join(fixtureRoot, 'en', 'swap.html'), initial);

  const run = () => spawnSync(process.execPath, ['scripts/apply_code_translations.js', 'en', '--write'], {
    cwd: fixtureRoot,
    encoding: 'utf8',
  });

  const first = run();
  assert.strictEqual(first.status, 0, first.stderr || first.stdout);
  const afterFirst = fs.readFileSync(path.join(fixtureRoot, 'en', 'swap.html'), 'utf8');
  assert.strictEqual(
    afterFirst,
    '<section id="swap"><code>beta</code><code>alpha</code></section><section id="plain"><code>translation</code></section>\n',
  );
  const whitelistAfterFirst = fs.readFileSync(path.join(fixtureRoot, 'i18n', 'code-translate.json'), 'utf8');

  const second = run();
  assert.strictEqual(second.status, 0, second.stderr || second.stdout);
  assert.match(second.stdout, /已套用 0 筆/);
  assert.strictEqual(fs.readFileSync(path.join(fixtureRoot, 'en', 'swap.html'), 'utf8'), afterFirst);
  assert.strictEqual(
    fs.readFileSync(path.join(fixtureRoot, 'i18n', 'code-translate.json'), 'utf8'),
    whitelistAfterFirst,
  );

  console.log('apply_code_translations double-run and swap fixture: passed');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
