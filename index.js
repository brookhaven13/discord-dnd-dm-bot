require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 1. 初始化 Discord 客戶端，並開啟接收訊息的權限
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// 2. 初始化 Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "models/gemini-2.5-flash",
  systemInstruction: "你是一位精通龍與地下城（DND 5e）規則的傳奇地下城主（DM）。你的回覆風格客觀、嚴謹且充滿奇幻冒險的沉浸感。請負責引導玩家們的冒險、描述環境、扮演 NPC，並在適當時機要求玩家進行骰點判定。請用繁體中文回應。你的職責與規則如下：\n\n1. 角色扮演：你負責描述世界、環境、NPC 的行動與反應，以及玩家行動後的後果。你絕對不能替玩家的角色做決定或說話。\n2. 擲骰機制：所有的判定由玩家自行擲骰。當玩家嘗試行動時，會告知你骰出的點數，調整值與難度等級（DC）由你判定並計算總值。若需要玩家進行特定的檢定（如：力量、感知），請明確告知。\n3. 戰鬥與流程：在戰鬥時，請協助記錄主動權、敵人的 HP 與 AC，並等待玩家們輪流做出動作後，再描述戰鬥結果。\n4. 遊戲狀態：每次對話結束時，請以極簡短的格式附帶當前遊戲狀態（如：各玩家生命值、當前位置、主要任務）。\n5. 地圖繪製：在探索或戰鬥場景中，請用純文字與符號（如 #, @, T, E 等）繪製簡易的 ASCII 地圖，並附上符號對照表。\n6. 記憶連連貫性：請保持對話的連貫性，並嚴格記住之前的事件與角色互動。\n7. 完全沉浸：請不要提供任何現實世界的資訊或建議，所有回覆應該完全沉浸在 D&D 的奇幻世界中。\n\n【準備工作】：請先提供三個不同的冒險背景選項給我們，包含故事風格與基調。等我們討論並選擇其中一個後，再開始描述開場情境。",
  // generationConfig: {
  //   maxOutputTokens: 800, // 限制城主單次最多回覆約 400-600 個中文字
  //   temperature: 0.7      // 保持適度的奇幻創意，不至於太死板
  // }
});

// 3. 建立一個對話記憶池 (Map)，以頻道 ID 作為 Key，確保不同頻道的冒險互不干擾
const chatSessions = new Map();

client.once('clientReady', () => {
    console.log(`🏰 城主機器人 ${client.user.tag} 已上線！準備帶團。`);
});

client.on('messageCreate', async (message) => {
    // 忽略機器人自己的訊息，避免無限迴圈
    if (message.author.bot) return;

    // 當有人 @提及 這個機器人時才觸發
    if (message.mentions.has(client.user)) {
        const channelId = message.channel.id;
        
        // 過濾掉 @提及 的字眼，只留下玩家的真實指令
        const userMessage = message.content.replace(`<@${client.user.id}>`, '').trim();

        try {
            // 讓 Discord 顯示機器人「正在輸入訊息...」，提升沉浸感
            await message.channel.sendTyping();

            // 如果這個頻道還沒開始過對話，就初始化一個新的 Chat
            if (!chatSessions.has(channelId)) {
                const chat = model.startChat({
                    history: [
                        // 你可以在這裡預先塞入 System Prompt（例如：你現在是一個嚴格但公平的 DND 5e 城主...）
                    ]
                });
                chatSessions.set(channelId, chat);
            }

            // 取得這個頻道的對話實例，並傳送玩家的新動作
            const currentChat = chatSessions.get(channelId);
            const result = await currentChat.sendMessage(userMessage);
            const response = result.response.text();

            // 回覆玩家
            await message.reply(response);

        } catch (error) {
            console.error("生成回應時發生錯誤:", error);
            await message.reply("⚠️ 城主需要翻一下規則書... (系統發生錯誤，請稍後再試)");
        }
    }
});

// 啟動機器人
client.login(process.env.DISCORD_BOT_TOKEN);