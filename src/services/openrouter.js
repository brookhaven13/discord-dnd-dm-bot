// OpenRouter service helper
async function callOpenRouter(model, messages) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not set");

  const res = await fetch("https://api.openrouter.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const choice = json?.choices?.[0] || {};
  return (
    choice?.message?.content ||
    choice?.message?.content?.parts?.[0] ||
    choice?.text ||
    JSON.stringify(json)
  );
}

module.exports = { callOpenRouter };
