const { Client, GatewayIntentBits } = require("discord.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { systemInstruction, MODELS_POOL } = require("./bot-config");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Generative AI 初始化，使用環境變數中的 API Key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); // 若使用 Gemini AI 請解註解

// 全局模型指標，記錄目前用到哪一個，不用每次都從第一個開始試
let currentModelIndex = 0;

const channelHistories = new Map();
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

client.once("ready", () => {
  console.log(
    `🏰 城主機器人 ${client.user.tag} 已上線！模型輪詢故障轉移機制已啟動。`,
  );
});

client.on("messageCreate", async (message) => {
  // 排除機器人自己，且必須有 @ 機器人
  if (message.author.bot || !message.mentions.has(client.user)) return;

  const channelId = message.channel.id;
  const userMessage = message.content
    .replace(`<@${client.user.id}>`, "")
    .trim();

  if (!channelHistories.has(channelId)) {
    channelHistories.set(channelId, []);
  }

  let history = channelHistories.get(channelId);

  try {
    await message.channel.sendTyping();

    let responseText = null;
    let attempts = 0;

    // 拷貝一份當前的歷史紀錄，用來丟給 API 測試
    // 並且把這一次的新訊息暫時塞進去這個臨時陣列裡
    const tempContents = [
      ...history,
      { role: "user", parts: [{ text: userMessage }] },
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

        const currentModel = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: systemInstruction,
        });

        // 餵給 API 的是包含新訊息的臨時陣列
        const result = await currentModel.generateContent({
          contents: tempContents,
        });
        // 支援不同回傳型態的取值（某些 SDK 會包成 function 或屬性）
        if (typeof result?.response?.text === "function") {
          responseText = result.response.text();
        } else if (typeof result?.response === "string") {
          responseText = result.response;
        } else if (typeof result?.response?.text === "string") {
          responseText = result.response.text;
        } else if (typeof result === "string") {
          responseText = result;
        } else {
          responseText = JSON.stringify(result?.response || result || "");
        }

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

    // 【關鍵修正】：只有完全成功拿到回應後，才正式把對話寫入真正的記憶 Map
    history.push({ role: "user", parts: [{ text: userMessage }] });
    history.push({ role: "model", parts: [{ text: responseText }] });

    // 限縮記憶長度
    if (history.length > MAX_HISTORY) {
      history.splice(0, 2);
    }

    channelHistories.set(channelId, history);

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
