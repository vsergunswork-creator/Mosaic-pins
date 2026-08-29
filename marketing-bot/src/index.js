const OPENAI_URL = "https://api.openai.com/v1/responses";
const TEST_MODEL = "gpt-5.6-luna";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "mosaic-marketing-bot",
        openaiConfigured: Boolean(String(env.OPENAI_API_KEY || "").trim()),
        adminSecretConfigured: Boolean(String(env.BOT_ADMIN_SECRET || "").trim())
      });
    }

    if (url.pathname === "/ai-test") {
      return handleAiTest(request, env, url);
    }

    return new Response("Mosaic Pins Marketing Bot is online ✅", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }
};

async function handleAiTest(request, env, url) {
  const requiredSecret = String(env.BOT_ADMIN_SECRET || "").trim();
  const providedSecret = String(
    request.headers.get("x-admin-secret") ||
    url.searchParams.get("secret") ||
    ""
  ).trim();

  if (!requiredSecret || providedSecret !== requiredSecret) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return json({ ok: false, error: "OPENAI_API_KEY is not configured" }, 500);
  }

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: TEST_MODEL,
      input: [
        {
          role: "developer",
          content: [
            {
              type: "input_text",
              text: "You are a connectivity test for Mosaic Pins Marketing Bot. Keep the answer extremely short."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Reply exactly with: Mosaic Marketing AI connected"
            }
          ]
        }
      ],
      max_output_tokens: 40
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return json({
      ok: false,
      error: "OpenAI request failed",
      status: response.status,
      details: safeApiError(data)
    }, 502);
  }

  return json({
    ok: true,
    model: data.model || TEST_MODEL,
    reply: extractOutputText(data),
    usage: data.usage || null
  });
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function safeApiError(data) {
  const err = data?.error;
  if (!err) return "Unknown OpenAI API error";
  return {
    message: String(err.message || "Unknown OpenAI API error"),
    type: err.type || null,
    code: err.code || null
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
