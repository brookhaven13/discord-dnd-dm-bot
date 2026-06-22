const { Client, GatewayIntentBits } = require("discord.js");
const {
  systemInstruction,
  GEMINI_MODELS,
  OPENROUTER_MODELS,
} = require("./bot-config");

// Choose model pool based on MODEL_PROVIDER env var (default: openrouter)
const _provider = (process.env.MODEL_PROVIDER || "openrouter").toLowerCase();
let MODELS_POOL = _provider === "gemini" ? GEMINI_MODELS : OPENROUTER_MODELS;
if (!MODELS_POOL || MODELS_POOL.length === 0) {
  // fallback: prefer OPENROUTER then GEMINI
  MODELS_POOL = OPENROUTER_MODELS.length ? OPENROUTER_MODELS : GEMINI_MODELS;
}
console.log(
  `[config] model provider=${_provider} models=${MODELS_POOL.join(", ")}`,
);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// AI 初始化，使用環境變數中的 API Key
const { callModel } = require("./services/dispatcher");

// 全局模型指標，記錄目前用到哪一個，不用每次都從第一個開始試
let currentModelIndex = 0;

// 【架構升級】：此 Map 將儲存各房間的歷史紀錄與專屬的「動態角色卡」
const activeRooms = new Map();
const MAX_HISTORY = 14;

// 回覆守護：避免對同一則訊息在同一個 process 中回覆多次
const repliedMessages = new Set();

async function safeReply(message, content) {
  try {
    if (repliedMessages.has(message.id)) {
      console.log(
        `[safeReply] already replied - pid=${process.pid} messageId=${message.id}`,
      );
      return;
    }
    console.log(
      `[safeReply] sending reply - pid=${process.pid} messageId=${message.id}`,
    );
    await message.reply(content);
    repliedMessages.add(message.id);
    // 在一段時間後自動清理，以免集合無限增長（例如 10 分鐘）
    setTimeout(() => repliedMessages.delete(message.id), 10 * 60 * 1000);
  } catch (err) {
    console.error("safeReply error:", err);
  }
}

// The `ready` event has been renamed to `clientReady` in newer discord.js versions.
client.once("clientReady", () => {
  console.log(
    `🏰 城主機器人 ${client.user.tag} 已上線！模型輪詢故障轉移機制已啟動。`,
  );
});

client.on("messageCreate", async (message) => {
  // 排除機器人自己，且必須有 @ 機器人
  if (message.author.bot || !message.mentions.has(client.user)) return;

  const channelId = message.channel.id;

  // 【動態防搞混】：取得發話玩家在該伺服器內的當前暱稱
  const playerNickname = message.member
    ? message.member.displayName
    : message.author.username;

  const userMessage = message.content
    .replace(`<@${client.user.id}>`, "")
    .trim();

  // 【房間初始化】：如果該頻道尚未建立資料，初始化歷史紀錄與空白角色卡
  if (!activeRooms.has(channelId)) {
    activeRooms.set(channelId, {
      history: [],
      sheets: `*(目前此房間尚未設定動態角色卡，城主將依據預設劇本帶團)*`,
    });
  }

  let room = activeRooms.get(channelId);

  // 🔥【動態角色卡設定指令】：攔截關鍵字，直接更新該房間設定而不推進劇情
  if (userMessage.startsWith("設定角色卡")) {
    const newSheets = userMessage.replace("設定角色卡", "").trim();
    if (!newSheets) {
      await safeReply(
        message,
        `⚠️ 請在指令後方加上具體 Role Card 內容。請將整份角色卡貼在指令後（範例，可直接複製貼上）：
          \n\n\`\`\`\n@城主 設定角色卡
          - 玩家 Discord 暱稱: 請填入你的 Discord 顯示名稱
          - 角色名字:
          - 種族 / 職業:
          - 角色等級: Level 1
          - 陣營 (Alignment): 例如：中立善良 / 混亂中立
          - 最大血量 (Max HP):
          - 當前血量 (Current HP):
          - 護甲等級 (Armor Class, AC):
          - 力量 (STR): [數值]（調整值: +X）
          - 敏捷 (DEX): [數值]（調整值: +X）
          - 體質 (CON): [數值]（調整值: +X）
          - 智力 (INT): [數值]（調整值: +X）
          - 感知 (WIS): [數值]（調整值: +X）
          - 魅力 (CHA): [數值]（調整值: +X）
          - 擅長技能 (Proficiencies): 例如：運動、奧術、隱匿
          - 種族 / 職業核心能力: 例如：黑暗視覺、狂暴
          \`\`\`
          `,
      );
      return;
    }
    room.sheets = newSheets;
    activeRooms.set(channelId, room);

    await safeReply(
      message,
      `✅ **【系統通知】**：本房間的新角色卡已成功載入！新劇本開跑時城主將自動採用此設定，無需重啟 Bot。`,
    );
    return;
  }

  // 【結構化標籤】：手動強迫 AI 知道這句話是誰講的，解決混淆或玩家變 NPC 的問題
  const formattedUserMessage = `[Discord 玩家: ${playerNickname}] 宣告行動: ${userMessage}`;

  try {
    // 讓機器人在頻道顯示「正在輸入」的狀態，增加互動感
    await message.channel.sendTyping();

    let responseText = null;
    let attempts = 0;

    // 拷貝一份當前的歷史紀錄，用來丟給 API 測試
    // 並且把這一次帶有發話者標籤的新訊息暫時塞進去這個臨時陣列裡
    const tempContents = [
      ...room.history,
      { role: "user", parts: [{ text: formattedUserMessage }] },
    ];

    // 使用本次請求的本地索引來嘗試不同模型，避免在失敗時改變全域指標直到成功
    while (attempts < MODELS_POOL.length) {
      const modelIndexToTry =
        (currentModelIndex + attempts) % MODELS_POOL.length;
      const modelName = MODELS_POOL[modelIndexToTry];
      try {
        console.log(
          `[嘗試呼叫] 模型: ${modelName} (嘗試次數: ${attempts + 1})`,
        );

        // If MODELS_POOL entry looks like a prompt (contains space), fallback to env OPENROUTER_MODEL
        let modelToUse = modelName;
        if (!modelToUse || modelToUse.includes(" ")) {
          modelToUse = process.env.OPENROUTER_MODEL;
          console.warn(
            `MODELS_POOL entry looks like a prompt; falling back to OPENROUTER_MODEL=${modelToUse}`,
          );
        }
        if (!modelToUse)
          throw new Error(
            "No valid model available (set OPENROUTER_MODEL or update MODELS_POOL)",
          );

        // 【新舊融合】：將 bot-config 的系統規則、本房間當前動態角色卡與強烈約束動態組裝成 System Prompt
        const dynamicSystemInstruction = `
          ${systemInstruction}

          # 【本房間當前玩家角色卡（動態載入）】
          ${room.sheets}

          ---

          # 【硬核運算與防搶戲約束】
          * **精確辨識玩家**：本聊天室包含多位真實玩家。請根據訊息前綴的 \`[Discord 玩家: XXX]\` 標籤精確區分角色身份與行動。嚴禁將任何玩家角色變更為 NPC。
          * **嚴禁自行代骰（搶戲）**：當玩家宣告行動時，你**只能描述到行動前的準備或環境的即時變化**。你必須明確下達指令要求該玩家進行特定骰點檢定（例如：「請進行力量檢定」），並**在此處立即中斷你的回覆**，絕對不可自行虛構骰點結果或自行推進後續劇情。
          * **精確數值計算**：所有的數值變更（如受到攻擊扣除血量）必須嚴格基於【本房間當前玩家角色卡】的當前數值進行加減法運算。在玩家沒有主動回報新數值或骰點結果前，**嚴禁自行捏造、虛構或繼承錯誤的血量上限與基礎數值**。
        `;

        // Build messages array for OpenRouter
        const messages = [
          { role: "system", content: dynamicSystemInstruction },
          ...tempContents.map((c) => ({
            role: c.role === "model" ? "assistant" : c.role,
            content: (c.parts || []).map((p) => p.text).join(" "),
          })),
        ];

        // Call configured model provider (OpenRouter or Gemini)
        // 這裡限制 max_tokens: 450 做物理斷句，強迫 AI 遇到要求骰子時停下
        responseText = await callModel(modelToUse, messages, {
          max_tokens: 450,
        });

        // 成功：把全域索引更新為本次成功的模型，供下一次起始使用
        currentModelIndex = modelIndexToTry;
        break;
      } catch (error) {
        // 詳細紀錄錯誤以利除錯
        try {
          console.warn(
            `⚠️ 模型 ${modelName} 呼叫失敗 (嘗試 ${attempts + 1}):`,
            {
              status: error?.status || error?.response?.status || null,
              message: error?.message || error?.toString(),
            },
          );
        } catch (logErr) {
          console.warn("⚠️ 無法記錄完整錯誤資訊", logErr);
        }

        // 如果是常見的限制或資源不可用錯誤，嘗試下一個備援
        const status = error?.status || error?.response?.status || 0;
        const msg = String(error?.message || "");
        if (
          status === 429 ||
          status === 503 ||
          status === 404 ||
          msg.includes("429") ||
          msg.includes("503") ||
          msg.includes("404")
        ) {
          console.warn(
            `⚠️ 模型 ${modelName} 無法使用 (狀態碼: ${status})。切換至下一個備援...`,
          );
          attempts++;
          // 迴圈會用 attempts 計算下一個要嘗試的 modelIndexToTry
        } else {
          // 其他錯誤則直接丟出，讓外層 catch 處理
          throw error;
        }
      }
    }

    if (!responseText) {
      await safeReply(
        message,
        "⚠️ 所有的城主分身此時都累了... (全部模型皆觸發限制，請稍候再試)",
      );
      return;
    }

    // 【關鍵修正】：只有完全成功拿到回應後，才正式把帶有暱稱標籤的對話寫入真正的記憶 Map
    room.history.push({
      role: "user",
      parts: [{ text: formattedUserMessage }],
    });
    room.history.push({ role: "model", parts: [{ text: responseText }] });

    // 限縮記憶長度
    if (room.history.length > MAX_HISTORY) {
      room.history.splice(0, 2);
    }

    activeRooms.set(channelId, room);

    // 最後只發送一次回覆（改用 safeReply 以避免重複）
    console.log(
      `[reply] pid=${process.pid} channel=${channelId} messageIdToReply=${message.id}`,
    );
    await safeReply(message, responseText);
  } catch (error) {
    console.error("關鍵錯誤:", error);
    await safeReply(message, "⚠️ 城主規則書掉到地上了，請重新輸入動作。");
  }
});

async function start() {
  await client.login(process.env.DISCORD_BOT_TOKEN);
}

module.exports = { start, client };
