// Gemini service wrapper using @google/generative-ai
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

async function callGemini(model, messages) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set");
  }

  // Convert messages -> contents expected by SDK
  const contents = messages.map((m) => ({
    type: "text",
    text: m.content,
  }));

  const systemInstruction = messages?.[0]?.content || "";

  const currentModel = genClient.getGenerativeModel({
    model,
    systemInstruction,
  });

  const result = await currentModel.generateContent({ contents });

  // Normalize response
  if (typeof result?.response?.text === "function")
    return result.response.text();
  if (typeof result?.response === "string") return result.response;
  if (typeof result?.response?.text === "string") return result.response.text;
  return JSON.stringify(result);
}

module.exports = { callGemini };
// Gemini (Google Generative) service wrapper
const { GoogleGenerativeAI } = require("@google/generative-ai");

let client = null;
function getClient() {
  if (!client) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY not set");
    client = new GoogleGenerativeAI(key);
  }
  return client;
}

async function callGemini(model, messages) {
  const genai = getClient();
  // Convert messages -> contents expected by SDK
  const contents = messages.map((m) => ({ type: "text", text: m.content }));
  const systemInstruction = messages[0]?.content || "";
  const currentModel = genai.getGenerativeModel({ model, systemInstruction });
  const result = await currentModel.generateContent({ contents });

  if (typeof result?.response?.text === "function")
    return result.response.text();
  if (typeof result?.response === "string") return result.response;
  if (typeof result?.response?.text === "string") return result.response.text;
  return JSON.stringify(result);
}

module.exports = { callGemini };
