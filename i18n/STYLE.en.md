# STYLE.en.md — writing rules for the en/ site root

Companion to `STYLE.md` (zh-TW). Same voice, English surface.

## Voice
- Second person **you**; WoowTech speaks as **we**. Direct, plain, like a senior engineer onboarding a beginner.
- One idea per paragraph. Prefer short sentences. Steps are imperative ("Create a user", not "You should create a user").
- No filler openers ("In this chapter we will…", "In summary…"), no marketing adjectives (seamless, powerful, robust), no emoji.

## Spelling and typography
- **US spelling** (color, center, license, authorized).
- Headings, nav labels and buttons in **sentence case**. Product names and WoowTech series names in Title Case (Resource Hub, Onboarding Guide, Sales Handbook, Prompt Library, Skill Handbook).
- Full-width punctuation becomes ASCII: `／` → `/`, `（）` → `()`, `「」` → **bold** for UI labels or plain quotes, `：` → `: `, `、` → `, `. Menu arrows `→` and separators `·` stay.
- `第 N 章` → `Chapter N`; `附錄 A` → `Appendix A`; `圖 N-M` → `Figure N-M`. Numbers, versions, ports and dates stay exactly as in the Chinese source.

## What never changes
- Everything inside `<pre>`, `<code>`, `<kbd>`: commands, config keys, file names, hostnames, URLs. Chinese placeholders inside code become `<your-password>`-style English placeholders only via the code-translate whitelist.
- `id`, `class`, `data-icon`, `data-task-field`, `href`, `src`, section order, list/FAQ/table counts. Translate text nodes, `data-nav`, `alt`, `title`, `aria-label`, `placeholder`, `figcaption` only.
- Facts. Do not "helpfully" update a version number, a menu path or a command; if the source looks outdated, leave it and open an issue on the zh side.

## Callouts and labels
- `.callout` → **Concept:**, `.tip` → **Tip:**, `.warn` → **Warning:**, `.danger` → **Danger:**. Secondary labels: Chapter task:, Prerequisite:, Verify:, Version note:, Hard stop:.
- Section headings that recur across chapters use one fixed English form (Why this matters / Core concepts / Hands-on / Common pitfalls / Troubleshooting / FAQ / Official sources). `data-nav` labels ≤ 3 words.

## Localization (policy = localize)
- Replace Taiwan-specific framing with a generic one (internal hostnames → `your-host.example`, LINE → Telegram/Slack, 台電 → your utility, Asia/Taipei → your timezone) and add a short `Note:` when the substitution changes the example.
- Keep the English version as thorough as the Chinese one: never drop FAQ, troubleshooting or sources rows.
