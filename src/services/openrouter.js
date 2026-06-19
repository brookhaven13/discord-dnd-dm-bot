// OpenRouter service helper using the official OpenAI SDK pointed at OpenRouter
const { OpenAI } = require("openai");

function createClient() {
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "DND Discord Bot",
    },
  });
}

async function callOpenRouter(model, messages) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not set");

  const client = createClient();

  const res = await client.chat.completions.create({ model, messages });
  const choice = res?.choices?.[0] || {};

  return (
    choice?.message?.content ||
    choice?.message?.content?.parts?.[0] ||
    choice?.text ||
    JSON.stringify(res)
  );
}

module.exports = { callOpenRouter };
