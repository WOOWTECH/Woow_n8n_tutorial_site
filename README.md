# Woow n8n 入住指南（把重複工作外包給流程自動化）

22 章＋3 附錄的繁體中文 [n8n](https://n8n.io/) 教學靜態網站，寫給業務／行銷／內部同仁看：從打開 Woow n8n 登入、抄別人做好的 template、做出第一個 workflow，一路帶到 Expression、Code node、AI Agent 與 Webhook。

- **讀者**：業務／行銷／內部同仁；Zapier/Make 風格使用者
- **前提**：會用瀏覽器、有 Google/Slack 帳號、看過 Zapier 或 Make 更好（沒看過也 OK）
- **語言**：繁體中文（台灣用語）
- **授權**：CC BY 4.0

## 部署

網站部署在 GitHub Pages：**https://woowtech.github.io/Woow_n8n_tutorial_site/**（未來對外走 `https://n8n-guide.woowtech.io/`）

Woow n8n 實例：**https://n8n.woowtech.io/**（帳號向 IT 索取）

## 本地開發

```bash
git clone https://github.com/WOOWTECH/Woow_n8n_tutorial_site
cd Woow_n8n_tutorial_site

# 檢查導覽與連結
node scripts/build_nav.js --check
node scripts/check_links.js

# 產生／更新 head、sidebar、pager、footer、sitemap
node scripts/build_nav.js
```

## 站內結構

單一來源：`chapters.json`（章節順序、標題、SEO copy）+ 每章 HTML 的 `<section data-nav="...">`。所有 `<head>`、側欄、上下章導覽、目錄卡片、`sitemap.xml` 都是 `scripts/build_nav.js` 產生的 —— 手動改會在下一次 CI 被覆蓋回去。

新章節寫作規範：見 [`STYLE.md`](STYLE.md)。

## 這個站是怎麼建起來的

Fork 自姐妹站《[HA 入住指南](https://github.com/WOOWTECH/Woow_ha_tutorial_site)》，共用同一套 build_nav / check_links / capture 管線與 WoowTech 品牌樣式。建站 recipe 打包在 [`authoring-woowtech-tutorial-site`](../.claude/skills/authoring-woowtech-tutorial-site) skill 裡，22 章由 22 個作者 agent 並行產出、每章配一個 reviewer agent 對抗式覆核。

## 授權與致謝

《Woow n8n 入住指南》由 [WoowTech](https://github.com/WOOWTECH) 製作，以 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.zh-hant) 授權釋出 —— 可自由分享與改作，請保留出處。

n8n 是 [n8n.io](https://n8n.io/) 的開源工作流自動化平台（Sustainable Use License）。本站與 n8n GmbH 無隸屬關係，僅為社群教學。截圖取自 Woow 內部 n8n 實例與 n8n 官方文件。
