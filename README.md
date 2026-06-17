# DND DM — Discord 城主機器人

簡短說明：這是一個使用 Google Gemini（Generative AI）與 Discord.js 建立的 DND 5e 城主（DM）機器人範例。

**Prerequisites**:

- Node.js (v16+ recommended)
- A Discord bot token (create an application in the Discord Developer Portal)
- A Google Gemini / Generative API key

**設定 `.env`**

1. 在專案根目錄建立一個名為 `.env` 的檔案。
2. 在 `.env` 中放入下面兩個環境變數（將右側的文字換成你自己的金鑰或 token）：

```
GEMINI_API_KEY=your_gemini_api_key_here
DISCORD_BOT_TOKEN=your_discord_bot_token_here
```

- `GEMINI_API_KEY`：你在 Google Generative AI / Gemini 管理後台取得的 API key。
- `DISCORD_BOT_TOKEN`：你在 Discord Developer Portal 取得的 bot token（切勿在公開 repo 中洩露）。

注意：本專案已將 `.env` 加入到 `.gitignore`，請勿將包含敏感金鑰的檔案提交到版本控制系統。

**安裝與執行**

1. 安裝相依套件：

```bash
npm install
```

1. 啟動機器人：

```bash
node index.js
```

（可選）使用 `nodemon` 開發時自動重啟：

```bash
npm install -g nodemon
nodemon index.js
```

**Discord 注意事項**

- 本程式碼在 `index.js` 中使用了 `GatewayIntentBits.MessageContent`，請在 Discord Developer Portal 的 bot 設定中啟用 "MESSAGE CONTENT INTENT"，否則機器人將無法讀取訊息內容。
- 將機器人邀請到伺服器時，請確保授予必要權限（發送訊息、讀取訊息歷史等）。

**疑難排解**

- 若程式啟動後無回應，檢查 `.env` 內容是否正確並確認 bot token 有效。
- 檢查終端 / 日誌輸出以取得錯誤資訊。

---

檔案： [index.js](index.js#L1)
