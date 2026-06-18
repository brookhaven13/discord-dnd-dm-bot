require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const systemInstruction = "你是一位精通龍與地下城（DND 5e）規則的傳奇地下城主（DM）。你的回覆風格客觀、嚴謹且充滿奇幻冒險的沉浸感。請負責引導玩家們的冒險、描述環境、扮演 NPC，並在適當時機要求玩家進行骰點判定。請用繁體中文回應。你的職責與規則如下：\n\n1. 角色扮演：你負責描述世界、環境、NPC 的行動與反應，以及玩家行動後的後果。你絕對不能替玩家的角色做決定或說話。\n2. 擲骰機制：所有的判定由玩家自行擲骰。當玩家嘗試行動時，會告知你骰出的點數，調整值與難度等級（DC）由你判定並計算總值。若需要玩家進行特定的檢定（如：力量、感知），請明確告知。\n3. 戰鬥與流程：在戰鬥時，請協助記錄主動權、敵人的 HP 與 AC，並等待玩家們輪流做出動作後，再描述戰鬥結果。\n4. 遊戲狀態：每次對話結束時，請僅以一行文字精簡提示「當前任務」即可。絕對不要主動列出玩家的血量、位置、道具或詳細能力狀態。其他所有角色狀態與數值，一律等到玩家們主動詢問時再行透露。\n5. 地圖繪製：在探索或戰鬥場景中，請用純文字與符號（如 #, @, T, E 等）繪製簡易的 ASCII 地圖，並附上符號對照表。\n6. 記憶連連貫性：請保持對話的連貫性，並嚴格記住之前的事件與角色互動。\n7. 完全沉浸：請不要提供任何現實世界的資訊或建議，所有回覆應該完全沉浸在 D&D 的奇幻世界中。\n\n【魔法世界設定】：以下為本 campaign 的魔法世界規則與風格，回覆時請遵守這些設定以維持一致性。\n\nA. 魔法來源：世界中的魔法主要分為「奧術（Arcane）」與「神聖（Divine）」兩大流派；奧術源自對宇宙法則的理解，神聖來自眾神或自然精靈的祝福。\nB. 咒語與材料：施法通常需要語言、手勢與材料組件（除非玩家使用可以忽略組件的特殊能力或法術製品）。若法術描述需要消耗貴重材料，請在場景中明確說明。\nC. 法力資源：本世界採用傳統法術位（spell slots）系統而非可回復的 \"mana\" 條；恢復方式依 D&D 規則（長休/短休）為主。\nD. 魔法限制與副作用：高階或禁忌魔法可能留下持久副作用（如咒痕、精神疲憊或世界扭曲），在適當情節可作為劇情推進工具。非凡魔法行為可能吸引異界注意或觸發守護機制。\nE. 魔法物品與罕見性：強力魔法物品稀有且需特殊儀式啟動；玩家若需使用，請描述取得或啟動所需步驟。\nF. 風格與語氣：魔法描寫偏向神秘與莊嚴，避免過度科技化或現代術語。\n\n【準備工作】：請先提供三個不同的冒險背景選項給我們，包含故事風格與基調。等我們討論並選擇其中一個後，再開始描述開場情境。"

// 【優化點 1】：定義 6 個免費層通用的模型備援陣列
const MODELS_POOL = [
    "gemini-2.5-flash-lite",   // 1. 實測秒通主力！最省 Token、速度最快 (Stable)
    "gemini-2.5-flash",        // 2. 2.5 核心主力標準版 (Stable)
    "gemini-3.5-flash",        // 3. 最新 3.5 世代 Flash，專攻長對話與長線推理 (Stable)
    "gemini-3.1-flash-lite",   // 4. 3.1 輕量穩定版，極致省油 (Stable)
    "gemini-3-flash",          // 5. 3.0 世代 Flash (Preview)
    "gemini-2.5-pro"           // 6. 2.5 高階邏輯大腦（當作最後一條死線備援）(Stable)
];

// 全局模型指標，記錄目前用到哪一個，不用每次都從第一個開始試
let currentModelIndex = 0;

const channelHistories = new Map(); 
const MAX_HISTORY = 14; 

// 回覆守護：避免對同一則訊息在同一個 process 中回覆多次
const repliedMessages = new Set();

async function safeReply(message, content) {
    try {
        if (repliedMessages.has(message.id)) {
            console.log(`[safeReply] already replied - pid=${process.pid} messageId=${message.id}`);
            return;
        }
        console.log(`[safeReply] sending reply - pid=${process.pid} messageId=${message.id}`);
        await message.reply(content);
        repliedMessages.add(message.id);
        // 在一段時間後自動清理，以免集合無限增長（例如 10 分鐘）
        setTimeout(() => repliedMessages.delete(message.id), 10 * 60 * 1000);
    } catch (err) {
        console.error('safeReply error:', err);
    }
}

client.once('ready', () => {
    console.log(`🏰 城主機器人 ${client.user.tag} 已上線！模型輪詢故障轉移機制已啟動。`);
});

client.on('messageCreate', async (message) => {
    // 排除機器人自己，且必須有 @ 機器人
    if (message.author.bot || !message.mentions.has(client.user)) return;

    const channelId = message.channel.id;
    const userMessage = message.content.replace(`<@${client.user.id}>`, '').trim();

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
        const tempContents = [...history, { role: 'user', parts: [{ text: userMessage }] }];

        // 使用本次請求的本地索引來嘗試不同模型，避免在失敗時改變全域指標直到成功
        while (attempts < MODELS_POOL.length) {
            const modelIndexToTry = (currentModelIndex + attempts) % MODELS_POOL.length;
            const modelName = MODELS_POOL[modelIndexToTry];
            try {
                console.log(`[嘗試呼叫] 模型: ${modelName} (嘗試次數: ${attempts + 1})`);

                const currentModel = genAI.getGenerativeModel({
                    model: modelName,
                    systemInstruction: systemInstruction,
                });

                // 餵給 API 的是包含新訊息的臨時陣列
                const result = await currentModel.generateContent({ contents: tempContents });
                // 支援不同回傳型態的取值（某些 SDK 會包成 function 或屬性）
                if (typeof result?.response?.text === 'function') {
                    responseText = result.response.text();
                } else if (typeof result?.response === 'string') {
                    responseText = result.response;
                } else if (typeof result?.response?.text === 'string') {
                    responseText = result.response.text;
                } else if (typeof result === 'string') {
                    responseText = result;
                } else {
                    responseText = JSON.stringify(result?.response || result || '');
                }

                // 成功：把全域索引更新為本次成功的模型，供下一次起始使用
                currentModelIndex = modelIndexToTry;
                break;

            } catch (error) {
                // 詳細紀錄錯誤以利除錯
                try {
                    console.warn(`⚠️ 模型 ${modelName} 呼叫失敗 (嘗試 ${attempts + 1}):`, {
                        status: error?.status || error?.response?.status || null,
                        message: error?.message || error?.toString(),
                    });
                } catch (logErr) {
                    console.warn('⚠️ 無法記錄完整錯誤資訊', logErr);
                }

                // 如果是常見的限制或資源不可用錯誤，嘗試下一個備援
                const status = error?.status || error?.response?.status || 0;
                const msg = String(error?.message || '');
                if (status === 429 || status === 503 || status === 404 || msg.includes('429') || msg.includes('503') || msg.includes('404')) {
                    console.warn(`⚠️ 模型 ${modelName} 無法使用 (狀態碼: ${status})。切換至下一個備援...`);
                    attempts++;
                    // 迴圈會用 attempts 計算下一個要嘗試的 modelIndexToTry
                } else {
                    // 其他錯誤則直接丟出，讓外層 catch 處理
                    throw error;
                }
            }
        }

        if (!responseText) {
            await safeReply(message, "⚠️ 所有的城主分身此時都累了... (全部模型皆觸發限制，請稍候再試)");
            return;
        }

        // 【關鍵修正】：只有完全成功拿到回應後，才正式把對話寫入真正的記憶 Map
        history.push({ role: 'user', parts: [{ text: userMessage }] });
        history.push({ role: 'model', parts: [{ text: responseText }] });

        // 限縮記憶長度
        if (history.length > MAX_HISTORY) {
            history.splice(0, 2); 
        }
        
        channelHistories.set(channelId, history);

        // 最後只發送一次回覆（改用 safeReply 以避免重複）
        console.log(`[reply] pid=${process.pid} channel=${channelId} messageIdToReply=${message.id}`);
        await safeReply(message, responseText);

    } catch (error) {
        console.error("關鍵錯誤:", error);
        await safeReply(message, "⚠️ 城主規則書掉到地上了，請重新輸入動作。");
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);