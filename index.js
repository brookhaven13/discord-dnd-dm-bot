require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const systemInstruction = "你是一位精通龍與地下城（DND 5e）規則的傳奇地下城主（DM）。你的回覆風格客觀、嚴謹且充滿奇幻冒險的沉浸感。請負責引導玩家們的冒險、描述環境、扮演 NPC，並在適當時機要求玩家進行骰點判定。請用繁體中文回應。你的職責與規則如下：\n\n1. 角色扮演：你負責描述世界、環境、NPC 的行動與反應，以及玩家行動後的後果。你絕對不能替玩家的角色做決定或說話。\n2. 擲骰機制：所有的判定由玩家自行擲骰。當玩家嘗試行動時，會告知你骰出的點數，調整值與難度等級（DC）由你判定並計算總值。若需要玩家進行特定的檢定（如：力量、感知），請明確告知。\n3. 戰鬥與流程：在戰鬥時，請協助記錄主動權、敵人的 HP 與 AC，並等待玩家們輪流做出動作後，再描述戰鬥結果。\n4. 遊戲狀態：每次對話結束時，請僅以一行文字精簡提示「當前任務」即可。絕對不要主動列出玩家的血量、位置、道具或詳細能力狀態。其他所有角色狀態與數值，一律等到玩家們主動詢問時再行透露。\n5. 地圖繪製：在探索或戰鬥場景中，請用純文字與符號（如 #, @, T, E 等）繪製簡易的 ASCII 地圖，並附上符號對照表。\n6. 記憶連連貫性：請保持對話的連貫性，並嚴格記住之前的事件與角色互動。\n7. 完全沉浸：請不要提供任何現實世界的資訊或建議，所有回覆應該完全沉浸在 D&D 的奇幻世界中。\n\n【準備工作】：請先提供三個不同的冒險背景選項給我們，包含故事風格與基調。等我們討論並選擇其中一個後，再開始描述開場情境。";

const generationConfig = {
    maxOutputTokens: 800,
    temperature: 0.7
};

// 【優化點 1】：定義 5 個免費層通用的模型備援陣列
const MODELS_POOL = [
    "models/gemini-1.5-pro",      // 1.5 高階版
    "models/gemini-2.5-flash",
    "models/gemini-1.5-flash",
    "models/gemini-1.5-flash-8k", // 備用輕量版
    "models/gemini-2.5-pro",      // 2.5 高階版（免費層額度較低，適合備援）
];

// 全局模型指標，記錄目前用到哪一個，不用每次都從第一個開始試
let currentModelIndex = 0;

const channelHistories = new Map(); 
const MAX_HISTORY = 14; 

client.once('clientReady', () => {
    console.log(`🏰 城主機器人 ${client.user.tag} 已上線！模型輪詢故障轉移機制已啟動。`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.mentions.has(client.user)) return;

    const channelId = message.channel.id;
    const userMessage = message.content.replace(`<@${client.user.id}>`, '').trim();

    if (!channelHistories.has(channelId)) {
        channelHistories.set(channelId, []);
    }

    let history = channelHistories.get(channelId);
    history.push({ role: 'user', parts: [{ text: userMessage }] });

    try {
        await message.channel.sendTyping();

        let responseText = null;
        let attempts = 0;

        // 【優化點 2】：核心 Failover 輪詢機制
        while (attempts < MODELS_POOL.length) {
            const modelName = MODELS_POOL[currentModelIndex];
            try {
                console.log(`[嘗試呼叫] 模型: ${modelName} (嘗試次數: ${attempts + 1})`);
                
                // 動態取得當前要使用的模型實例
                const currentModel = genAI.getGenerativeModel({ 
                    model: modelName,
                    systemInstruction: systemInstruction,
                    generationConfig: generationConfig
                });

                const result = await currentModel.generateContent({ contents: history });
                responseText = result.response.text();
                
                // 如果成功拿到回應，就中斷迴圈
                break; 
            } catch (error) {
                // 如果捕獲到 429 或是 503 等錯誤，自動換下一個模型
                if (error.status === 429 || error.status === 503 || error.message?.includes('429') || error.message?.includes('503')) {
                    console.warn(`⚠️ 模型 ${modelName} 遇到限制或塞車 (${error.status})。正在切換至下一個備援模型...`);
                    currentModelIndex = (currentModelIndex + 1) % MODELS_POOL.length;
                    attempts++;
                } else {
                    // 如果是其他程式碼或語法錯誤，直接拋出不輪詢
                    throw error; 
                }
            }
        }

        // 如果五個模型全部都試過一輪都掛了
        if (!responseText) {
            await message.reply("⚠️ 所有的城主分身此時都累了... (全部模型皆觸發限制，請稍候再試)");
            return;
        }

        // 成功取得回應後的正常處理
        await message.reply(responseText);
        history.push({ role: 'model', parts: [{ text: responseText }] });

        if (history.length > MAX_HISTORY) {
            history.splice(0, 2); 
        }
        
        channelHistories.set(channelId, history);

    } catch (error) {
        console.error("關鍵錯誤:", error);
        await message.reply("⚠️ 城主規則書掉到地上了，請重新輸入動作。");
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);