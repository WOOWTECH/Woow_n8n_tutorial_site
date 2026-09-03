#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const enRoot = path.join(repoRoot, 'en');
const files = fs.readdirSync(enRoot).filter((file) => file.endsWith('.html')).sort();
let figureCount = 0;

for (const file of files) {
  const html = fs.readFileSync(path.join(enRoot, file), 'utf8');

  for (const match of html.matchAll(/<figcaption><strong>Figure [^<]+<\/strong>(\s*)/g)) {
    figureCount++;
    assert.strictEqual(match[1], ' ', `${file}: figure label must be followed by exactly one space`);
  }

  const prose = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/g, '')
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/g, '<code></code>');
  prose.split('\n').forEach((line, index) => {
    const content = line.trimStart();
    assert.doesNotMatch(content, / {2,}/, `${file}:${index + 1}: repeated space in visible prose`);
    assert.doesNotMatch(
      content,
      /<\/(?:a|code|em|kbd|strong)> +(?:[,;:!?]|\.(?!\.))/,
      `${file}:${index + 1}: space between inline content and punctuation`,
    );
  });

  assert.doesNotMatch(
    html,
    /\b(?:GET|POST|PUT|PATCH|DELETE) \/(?!api\/v1\/)(?:workflows|executions|credentials|audit)\b/,
    `${file}: n8n Public API route must start with /api/v1`,
  );
}

assert.strictEqual(figureCount, 30, 'expected to validate all 30 English figure captions');

const prompts = fs.readFileSync(path.join(enRoot, 'prompts.html'), 'utf8');
const linePrompt = prompts.match(/Create a workflow whose Webhook listens for <code>POST \/line-webhook<\/code>[\s\S]*?<\/p>/);
assert.ok(linePrompt, 'LINE Webhook prompt not found');
assert.match(linePrompt[0], /response mode <code>responseNode<\/code> \(“Using Respond to Webhook Node” in the UI\)/);
assert.match(linePrompt[0], /Ordinary Code nodes cannot read named n8n credentials/);
assert.match(linePrompt[0], /deployment-approved self-hosted environment-variable access \(which is configuration-dependent\)/);
assert.match(linePrompt[0], /dedicated service\/custom node/);
assert.match(linePrompt[0], /original raw bytes/);
assert.match(linePrompt[0], /timing-safe comparison/);
assert.doesNotMatch(linePrompt[0], /response mode <code>lastNode<\/code>/);

console.log(`English content regression checks: passed (${files.length} files, ${figureCount} figure captions)`);
