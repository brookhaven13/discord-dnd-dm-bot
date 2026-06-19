// Dispatcher to call the configured model provider
let callGemini;
try {
  callGemini = require("./gemini").callGemini;
} catch (e) {
  // gemini service may be unavailable if SDK or key not configured
  callGemini = null;
}

const { callOpenRouter } = require("./openrouter");

async function callModel(model, messages) {
  const provider = (process.env.MODEL_PROVIDER || "openrouter").toLowerCase();
  if (provider === "gemini") {
    if (!callGemini)
      throw new Error(
        "Gemini service not available. Ensure @google/generative-ai is installed and GEMINI_API_KEY is set.",
      );
    return callGemini(model, messages);
  }
  // default: openrouter
  return callOpenRouter(model, messages);
}

module.exports = { callModel };
