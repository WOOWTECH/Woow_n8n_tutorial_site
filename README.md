# Woow n8n 資源總站（教學 · 銷售 · API/MCP 提示詞 · Skill）

[n8n](https://n8n.io/) 自動化平台的四本手冊集中地，繁體中文靜態網站：

| 分類 | 頁面 | 給誰 | 下載 |
|---|---|---|---|
| **入住教學** | [`tutorial.html`](https://n8n-guide.woowtech.io/tutorial.html) ＋ 22 章＋3 附錄 | 業務／行銷／內部同仁 | 整站 zip（GitHub archive） |
| **銷售手冊** | [`sales.html`](https://n8n-guide.woowtech.io/sales.html) | 客戶與經銷商（HAOS add-on / 雲端兩種模式） | 自包含單檔 HTML |
| **API／MCP 提示詞庫** | [`prompts.html`](https://n8n-guide.woowtech.io/prompts.html) | 工程師與 AI agent（44 條可複製） | 自包含單檔 HTML |
| **Skill 手冊** | [`skills.html`](https://n8n-guide.woowtech.io/skills.html) | 進階用戶（community node 型錄＋MCP 速查） | 自包含單檔 HTML |

四類共用一個對外入口 [`index.html`（資源總覽）](https://n8n-guide.woowtech.io/)，hub 上提供各分冊的線上閱讀與下載載點。

- **教學讀者**：業務／行銷／內部同仁；Zapier/Make 風格使用者
- **銷售讀者**：想自動化但不想維護 n8n 的中小企業
- **提示詞庫讀者**：用 Claude／Cursor／Windsurf 掛上 n8n MCP server 的工程師
- **Skill 手冊讀者**：想擴充 n8n 節點或給 AI 加 workflow 建置能力的進階用戶
- **前提**：Home Assistant 已裝好（走 add-on 模式）或有 [`n8n.woowtech.io`](https://n8n.woowtech.io/) 帳號（雲端模式）
- **語言**：繁體中文（台灣用語）
- **授權**：CC BY 4.0

## 部署

GitHub Pages ＋ 自訂網域：**https://n8n-guide.woowtech.io/**（DNS 為 Cloudflare 上的 CNAME → `woowtech.github.io`，proxied）

Woow n8n 實例：**https://n8n.woowtech.io/**（v2.32.7 Community Edition；帳號向 IT 索取）

## 站內結構（hub 模式）

```
index.html          資源總覽 hub    ← 人手維護，build_nav 不碰
tutorial.html       教學目錄        ← build_nav 產生（chapters.json 的 hub.catalog）
ch*.html / appendix_*  教學內容頁   ← head/側欄/pager/footer 由 build_nav 產生
sales.html          銷售手冊        ← 自包含單檔（自帶樣式與圖示，可直接下載）
prompts.html        API/MCP 提示詞庫 ← 自包含單檔，同上
skills.html         Skill 手冊      ← 自包含單檔，同上
chapters.json       單一來源        ← 章節順序/文案/SEO + hub 設定（catalog、pages）
```

規則：

- 教學章節照舊由 `chapters.json` ＋ `<section data-nav>` 驅動，改完跑 `node scripts/build_nav.js`；目錄卡片輸出到 `tutorial.html`，側欄自帶「◂ 資源總覽」回 hub。
- `sales.html` / `prompts.html` / `skills.html` 是**自包含單檔**（樣式、圖示全部內嵌，離線可開），列在 `chapters.json` 的 `hub.pages`，會納入 sitemap 與 `check_links` 白名單，但不吃內容頁房規（kicker/FAQ/data-icon 對 style.css 的檢查）。
- 新增第五本手冊：寫好自包含 HTML → `hub.pages` 加一筆 → `index.html` 加卡片 → 重跑 build_nav。

## 本地開發

```bash
git clone https://github.com/WOOWTECH/Woow_n8n_tutorial_site
cd Woow_n8n_tutorial_site

node scripts/build_nav.js --check   # 導覽與 chapters.json 是否同步
node scripts/check_links.js         # 站內連結/錨點/sitemap 健檢
node scripts/build_nav.js           # 產生 head、側欄、pager、footer、sitemap
```

所有 `<head>`、側欄、上下章導覽、教學目錄卡片、`sitemap.xml` 都是 `scripts/build_nav.js` 產生的——手動改會在下一次 CI 被覆蓋回去（`index.html` 與三本單檔手冊除外）。

新章節寫作規範：見 [`STYLE.md`](STYLE.md)。

## 這個站是怎麼建起來的

Fork 自姊妹站《[HA 入住指南](https://github.com/WOOWTECH/Woow_ha_tutorial_site)》，共用同一套 build_nav / check_links / capture 管線與 WoowTech 品牌樣式；銷售手冊、提示詞庫、Skill 手冊為 WoowTech 品牌規範（Brand Prompt Library v2）下的自包含單檔版型。建站 recipe 打包在 [`authoring-woowtech-tutorial-site`](https://github.com/WOOWTECH) skill 裡。

## 授權與致謝

《Woow n8n 入住指南》與三本分冊由 [WoowTech](https://github.com/WOOWTECH) 製作，以 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.zh-hant) 授權釋出——可自由分享與改作，請保留出處。

n8n 是 [n8n.io](https://n8n.io/) 的開源工作流自動化平台（Sustainable Use License）。本站與 n8n GmbH 無隸屬關係，僅為社群教學。Skill 手冊中的第三方 community node 與 MCP server 各依其原始授權；集合規模與 star 數據為 2026-08 調查當日之 GitHub／npm 公開資訊。

截圖取自 Woow 內部 n8n 實例與 n8n 官方文件。
