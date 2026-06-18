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

（開發建議）使用 `nodemon` 自動重啟：本專案已將 `nodemon` 安裝為 `devDependency`，建議使用 `npm run dev` 以確保團隊與 CI 的一致性。

```bash
npm run dev
```

或直接使用 `npx`（會優先使用本地安裝的版本）：

```bash
npx nodemon index.js
```

**Discord 注意事項**

- 本程式碼在 `index.js` 中使用了 `GatewayIntentBits.MessageContent`，請在 Discord Developer Portal 的 bot 設定中啟用 "MESSAGE CONTENT INTENT"，否則機器人將無法讀取訊息內容。
- 將機器人邀請到伺服器時，請確保授予必要權限（發送訊息、讀取訊息歷史等）。

**疑難排解**

- 若程式啟動後無回應，檢查 `.env` 內容是否正確並確認 bot token 有效。
- 檢查終端 / 日誌輸出以取得錯誤資訊。

**模型輪替與故障轉移**

- **說明**: 機器人會在多個 Gemini / Generative 模型之間輪替（failover），以減少單一模型達到速率或配額限制時造成的完全中斷。
- **目前使用的模型池**: `models/gemini-1.5-pro`, `models/gemini-2.5-flash`, `models/gemini-1.5-flash`, `models/gemini-1.5-flash-8k`, `models/gemini-2.5-pro`。
- **行為**: 當呼叫模型時遇到 HTTP `429`（Too Many Requests）或 `503`（Service Unavailable）等錯誤，程式會自動切換到下一個備援模型並重試，直到池中模型都試過一輪為止。如果所有模型皆失敗，機器人會回覆使用者提示請稍後再試。
- **日誌**: `index.js` 會在嘗試呼叫模型時輸出類似 `【嘗試呼叫】 模型: <modelName> (嘗試次數: N)` 的日誌，方便追蹤哪個模型被使用以及是否發生切換（請查看主控端的終端輸出）。
- **如何調整**: 若要新增或移除模型、或改變嘗試邏輯，可編輯 `MODELS_POOL` 陣列（參見 `index.js`）：[index.js](index.js#L1)
- **建議**: 若你發現常出現 429，請到 Google Generative API 控制台查看使用量與限額，並考慮申請更高配額或調整請求頻率（例如加上重試退避策略、降低 `temperature` 或減少 `maxOutputTokens`）。

---

檔案： [index.js](index.js#L1)
