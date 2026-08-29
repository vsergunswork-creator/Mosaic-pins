const OPENAI_URL = "https://api.openai.com/v1/responses";
const MODEL = "gpt-5.6-luna";

const CONTENT_TYPES = {
  utility: [
    "technical_tip",
    "interesting_fact",
    "common_mistake",
    "workshop_idea",
    "mini_guide",
    "maker_spotlight",
    "community_recap"
  ],
  engagement: [
    "discussion",
    "poll",
    "show_your_work"
  ],
  brand: [
    "mosaic_pins"
  ]
};

// Exact long-term mix: 50% useful / 30% engagement / 20% Mosaic Pins.
const CATEGORY_CYCLE = [
  "utility",
  "engagement",
  "utility",
  "brand",
  "utility",
  "engagement",
  "utility",
  "brand",
  "engagement",
  "utility"
];

const THEMES = [
  "pins_installation",
  "handle_materials",
  "epoxy_adhesives",
  "drilling_and_fit",
  "finishing_and_polishing",
  "lanyards",
  "glow_materials",
  "handle_design",
  "workshop_process",
  "finished_knives",
  "tool_setup",
  "maker_business"
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "mosaic-marketing-bot",
        openaiConfigured: has(env.OPENAI_API_KEY),
        adminSecretConfigured: has(env.BOT_ADMIN_SECRET),
        telegramConfigured: has(env.TELEGRAM_BOT_TOKEN),
        telegramChatConfigured: has(env.TELEGRAM_CHAT_ID),
        d1Configured: Boolean(env.mosaic_marketing_bot_db)
      });
    }

    if (url.pathname === "/telegram-webhook" && request.method === "POST") {
      return handleTelegramWebhook(request, env, ctx);
    }

    if (url.pathname === "/setup-webhook") {
      if (!isAuthorized(request, env, url)) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
      return setupTelegramWebhook(request, env);
    }

    if (url.pathname === "/generate") {
      if (!isAuthorized(request, env, url)) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
      const result = await generateAndSendCandidate(env, { trigger: "admin_url" });
      return json(result.body, result.status);
    }

    if (url.pathname === "/rotation") {
      if (!isAuthorized(request, env, url)) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
      const history = await getRecentHistory(env, 30);
      return json({
        ok: true,
        next: chooseRotation(history),
        historyCount: history.length
      });
    }

    return new Response("Mosaic Pins Marketing Bot is online ✅", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }
};

function has(value) {
  return Boolean(String(value || "").trim());
}

function isAuthorized(request, env, url) {
  const requiredSecret = String(env.BOT_ADMIN_SECRET || "").trim();
  const providedSecret = String(
    request.headers.get("x-admin-secret") ||
    url.searchParams.get("secret") ||
    ""
  ).trim();

  return Boolean(requiredSecret) && providedSecret === requiredSecret;
}

async function handleTelegramWebhook(request, env, ctx) {
  const update = await request.json().catch(() => null);
  if (!update) return new Response("ok");

  const configuredChatId = String(env.TELEGRAM_CHAT_ID || "").trim();

  if (update.message) {
    const chatId = String(update.message?.chat?.id || "");
    if (!configuredChatId || chatId !== configuredChatId) {
      return new Response("ok");
    }

    const text = String(update.message?.text || "").trim();
    const command = text.split(/\s+/)[0].split("@")[0].toLowerCase();

    if (command === "/new") {
      await sendTelegramText(
        env,
        "🔎 Research started.\nI’m checking current knife-making discussions and preparing one original EN/RU candidate."
      );
      ctx.waitUntil(generateAndSendCandidate(env, {
        trigger: "telegram_new",
        requestedBy: String(update.message?.from?.id || "")
      }));
    } else if (command === "/rotation") {
      ctx.waitUntil(sendRotationStatus(env));
    } else if (command === "/history") {
      ctx.waitUntil(sendHistory(env));
    } else if (command === "/help" || command === "/start") {
      await sendTelegramText(
        env,
        "Mosaic Pins Marketing Bot\n\n" +
        "/new — research + create one new candidate\n" +
        "/rotation — show the next planned content type/theme (free)\n" +
        "/history — show recent candidates (free)\n\n" +
        "Buttons under a candidate:\n" +
        "✅ Approve — mark ready\n" +
        "🔄 Rewrite — rewrite EN + RU without another web search\n" +
        "❌ Skip — archive candidate"
      );
    }

    return new Response("ok");
  }

  if (update.callback_query) {
    const callback = update.callback_query;
    const chatId = String(callback?.message?.chat?.id || "");
    if (!configuredChatId || chatId !== configuredChatId) {
      await answerCallback(env, callback.id, "Not allowed");
      return new Response("ok");
    }

    const match = String(callback.data || "").match(/^(approve|rewrite|skip):(\d+)$/);
    if (!match) {
      await answerCallback(env, callback.id, "Unknown action");
      return new Response("ok");
    }

    const action = match[1];
    const postId = Number(match[2]);

    if (action === "approve") {
      await answerCallback(env, callback.id, "Approved ✅");
      ctx.waitUntil(approveCandidate(env, postId, callback.message?.message_id));
    } else if (action === "skip") {
      await answerCallback(env, callback.id, "Skipped");
      ctx.waitUntil(skipCandidate(env, postId, callback.message?.message_id));
    } else if (action === "rewrite") {
      await answerCallback(env, callback.id, "Rewriting…");
      ctx.waitUntil(rewriteCandidate(env, postId, callback.message?.message_id));
    }

    return new Response("ok");
  }

  return new Response("ok");
}

async function setupTelegramWebhook(request, env) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) {
    return json({ ok: false, error: "TELEGRAM_BOT_TOKEN is not configured" }, 500);
  }

  const origin = new URL(request.url).origin;
  const webhookUrl = `${origin}/telegram-webhook`;

  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true
    })
  });

  const data = await response.json().catch(() => ({}));

  return json({
    ok: response.ok && data?.ok === true,
    webhook: webhookUrl,
    telegram: data
  }, response.ok && data?.ok === true ? 200 : 502);
}

async function generateAndSendCandidate(env, meta = {}) {
  const db = env.mosaic_marketing_bot_db;
  if (!db) {
    return {
      status: 500,
      body: { ok: false, error: "D1 binding mosaic_marketing_bot_db is not configured" }
    };
  }

  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return {
      status: 500,
      body: { ok: false, error: "OPENAI_API_KEY is not configured" }
    };
  }

  const history = await getRecentHistory(env, 30);
  const rotation = chooseRotation(history);
  const recentTopics = history
    .filter(row => row.topic)
    .slice(0, 15)
    .map(row => row.topic);

  const researchPrompt = buildResearchPrompt(rotation, recentTopics);

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      reasoning: { effort: "low" },
      tools: [{
        type: "web_search_preview",
        search_context_size: "medium",
        user_location: {
          type: "approximate",
          country: "US"
        }
      }],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      input: [
        {
          role: "developer",
          content: [{
            type: "input_text",
            text:
              "You are the research editor for an English-language community of custom knife makers, " +
              "bladesmiths, knife-handle makers and related craftspeople, focused mainly on the United States. " +
              "You must synthesize current public discussions into NEW original community content. " +
              "Never copy, lightly paraphrase, imitate the structure of, or quote another person's post. " +
              "Do not present a single post as a trend. Prefer signals repeated across multiple independent public communities/sites. " +
              "Search current knife-making communities such as Reddit knife-making/bladesmith communities, KnifeDogs, BladeForums, " +
              "American Bladesmith Society discussions, Bushcraft USA maker discussions and other relevant public sources when useful. " +
              "Write natural American English. The Russian version is for the owner to review and must faithfully match the English meaning. " +
              "Do not fabricate sources, consensus, statistics, expert claims, or safety facts. " +
              "IMPORTANT: distinguish mosaic pins, solid metal pins, Corby/Loveless-style fasteners and lanyard tubes. " +
              "Never transfer peening, expansion or installation advice from solid pins to mosaic pins unless the research specifically supports it. " +
              "If a post is about one pin type, name that type clearly in the post so readers cannot confuse it with another. " +
              "The final EN post, RU translation and research_summary_ru must contain NO URLs, markdown links, source citations or source names. " +
              "Sources are for internal research only and are stored separately. " +
              "If the research signal is weak, create a timeless useful post inspired by the broader subject and say so in research_summary_ru."
          }]
        },
        {
          role: "user",
          content: [{
            type: "input_text",
            text: researchPrompt
          }]
        }
      ],
      max_output_tokens: 1400,
      text: {
        format: {
          type: "json_schema",
          name: "knife_community_post",
          strict: true,
          schema: {
            type: "object",
            properties: {
              topic: { type: "string" },
              scope: {
                type: "string",
                enum: ["general", "mosaic_pin", "solid_pin", "fastener", "lanyard_tube", "other"]
              },
              research_summary_ru: { type: "string" },
              en: { type: "string" },
              ru: { type: "string" }
            },
            required: ["topic", "scope", "research_summary_ru", "en", "ru"],
            additionalProperties: false
          }
        }
      }
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const body = {
      ok: false,
      error: "OpenAI research request failed",
      upstreamStatus: response.status,
      details: safeApiError(data)
    };
    await sendTelegramText(env, `⚠️ Research failed\n${body.details?.message || "Unknown OpenAI error"}`);
    return { status: 502, body };
  }

  const candidate = parseStructuredOutput(data);
  if (!candidate) {
    const body = { ok: false, error: "Could not parse structured AI output" };
    await sendTelegramText(env, "⚠️ Research completed, but the candidate format could not be parsed.");
    return { status: 502, body };
  }

  const sources = extractWebSources(data);
  const now = new Date().toISOString();

  const insert = await db.prepare(`
    INSERT INTO content_posts (
      created_at, updated_at, status, category, content_type, theme,
      topic, en_text, ru_text, research_summary_ru, source_json,
      openai_response_id, rewrite_count, trigger_source
    ) VALUES (?, ?, 'candidate', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).bind(
    now,
    now,
    rotation.category,
    rotation.contentType,
    rotation.theme,
    candidate.topic,
    cleanPublicText(candidate.en),
    cleanPublicText(candidate.ru),
    `Scope: ${candidate.scope}\n${cleanPublicText(candidate.research_summary_ru)}`,
    JSON.stringify(sources),
    String(data.id || ""),
    String(meta.trigger || "unknown")
  ).run();

  const postId = Number(insert?.meta?.last_row_id);
  if (!postId) {
    return {
      status: 500,
      body: { ok: false, error: "Candidate created but D1 did not return a post id" }
    };
  }

  const message = formatCandidateMessage({
    id: postId,
    status: "candidate",
    category: rotation.category,
    content_type: rotation.contentType,
    theme: rotation.theme,
    topic: candidate.topic,
    en_text: candidate.en,
    ru_text: candidate.ru,
    research_summary_ru: candidate.research_summary_ru,
    source_json: JSON.stringify(sources),
    rewrite_count: 0
  });

  const sent = await sendTelegramText(env, message, candidateKeyboard(postId));

  if (sent.ok && sent.messageId) {
    await db.prepare(`
      UPDATE content_posts
      SET telegram_message_id = ?, updated_at = ?
      WHERE id = ?
    `).bind(sent.messageId, new Date().toISOString(), postId).run();
  }

  return {
    status: sent.ok ? 200 : 502,
    body: {
      ok: sent.ok,
      id: postId,
      rotation,
      sources: sources.length,
      usage: data.usage || null,
      messageId: sent.messageId || null
    }
  };
}

function buildResearchPrompt(rotation, recentTopics) {
  const typeInstruction = {
    technical_tip:
      "Create a concise practical technical tip. It should be useful, careful, and not overclaim.",
    interesting_fact:
      "Create an interesting material/process insight with enough context to be genuinely useful, not trivia bait.",
    common_mistake:
      "Create a post about a common mistake or misconception, explaining the practical consequence and a better approach.",
    workshop_idea:
      "Create a practical workshop idea or workflow improvement makers can consider trying.",
    mini_guide:
      "Create a compact mini-guide with a few clear steps or checks.",
    maker_spotlight:
      "Create a community-oriented maker spotlight angle based on a broader craft practice or technique. Do not promote or identify a specific individual unless the current public research clearly supports it and attribution is necessary.",
    community_recap:
      "Create a concise recap of a recurring discussion theme you found across current communities, without quoting or naming individual posters.",
    discussion:
      "Create a discussion starter with enough technical/contextual substance before one natural question.",
    poll:
      "Create a poll-style post with 3-4 clear options and a short invitation to explain why.",
    show_your_work:
      "Create a show-your-work prompt around a specific craft detail. Invite photos or experiences without sounding generic.",
    mosaic_pins:
      "Create a useful, non-pushy Mosaic Pins post. Focus on craft, design, installation, selection, process or application. Do not invent specific products, prices or stock."
  }[rotation.contentType] || "Create a useful original community post.";

  const recent = recentTopics.length
    ? recentTopics.map((t, i) => `${i + 1}. ${t}`).join("\n")
    : "(No previous topics yet.)";

  return (
    `Planned content category: ${rotation.category}\n` +
    `Planned content type: ${rotation.contentType}\n` +
    `Planned thematic area: ${rotation.theme}\n\n` +
    `${typeInstruction}\n\n` +
    "Research CURRENT public discussions around this thematic area across multiple relevant knife-making communities/sites. " +
    "When possible, use at least 3 independent public sources/domains before treating something as a recurring signal. " +
    "Do not copy wording, titles, examples, anecdotes or post structure from any source. " +
    "The final post must stand on its own as an original contribution to our future community.\n\n" +
    "Avoid repeating or closely recreating any of these recent topics:\n" +
    recent + "\n\n" +
    "For a Technical Tip, target roughly 80-130 English words. For other short formats, stay concise unless the format genuinely needs more. " +
    "If the theme concerns pins or installation, explicitly choose the correct hardware scope (mosaic pin, solid pin, fastener, lanyard tube, or general) and never blur them together. " +
    "Do not add hashtags unless they genuinely help. Do not add a shop link. Do not include any source links or citations in the post or translation. " +
    "Return a short topic label, a brief Russian research summary explaining the signal you found, " +
    "the final English post, and its faithful Russian translation."
  );
}

async function rewriteCandidate(env, postId, telegramMessageId) {
  const db = env.mosaic_marketing_bot_db;
  const row = await getPost(env, postId);
  if (!row) {
    await sendTelegramText(env, `⚠️ Candidate #${postId} was not found.`);
    return;
  }

  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    await sendTelegramText(env, "⚠️ OPENAI_API_KEY is not configured.");
    return;
  }

  await editTelegramText(
    env,
    telegramMessageId,
    formatCandidateMessage(row) + "\n\n🔄 Rewriting…",
    null
  );

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      reasoning: { effort: "low" },
      input: [
        {
          role: "developer",
          content: [{
            type: "input_text",
            text:
              "Rewrite a knife-making community post into a clearly different, stronger version while preserving the same researched topic. " +
              "Do not perform or claim new web research. Do not add new factual claims that are not supported by the supplied research summary. " +
              "Write natural American English and provide a faithful Russian translation. Return structured JSON only."
          }]
        },
        {
          role: "user",
          content: [{
            type: "input_text",
            text:
              `Content type: ${row.content_type}\n` +
              `Theme: ${row.theme}\n` +
              `Topic: ${row.topic}\n` +
              `Scope: ${extractScopeFromSummary(row.research_summary_ru)}\n` +
              `Research summary (RU): ${row.research_summary_ru || ""}\n\n` +
              `Current EN:\n${row.en_text}\n\n` +
              `Current RU:\n${row.ru_text}\n\n` +
              "Create a substantially different phrasing/structure, not a cosmetic word swap. Keep it concise and useful."
          }]
        }
      ],
      max_output_tokens: 1000,
      text: {
        format: {
          type: "json_schema",
          name: "knife_community_rewrite",
          strict: true,
          schema: {
            type: "object",
            properties: {
              topic: { type: "string" },
              scope: {
                type: "string",
                enum: ["general", "mosaic_pin", "solid_pin", "fastener", "lanyard_tube", "other"]
              },
              en: { type: "string" },
              ru: { type: "string" }
            },
            required: ["topic", "scope", "en", "ru"],
            additionalProperties: false
          }
        }
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    await editTelegramText(
      env,
      telegramMessageId,
      formatCandidateMessage(row) + "\n\n⚠️ Rewrite failed.",
      candidateKeyboard(postId)
    );
    return;
  }

  const rewritten = parseStructuredOutput(data);
  if (!rewritten) {
    await editTelegramText(
      env,
      telegramMessageId,
      formatCandidateMessage(row) + "\n\n⚠️ Rewrite format error.",
      candidateKeyboard(postId)
    );
    return;
  }

  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE content_posts
    SET topic = ?, en_text = ?, ru_text = ?, research_summary_ru = ?, rewrite_count = rewrite_count + 1,
        updated_at = ?, openai_response_id = ?
    WHERE id = ?
  `).bind(
    cleanPublicText(rewritten.topic),
    cleanPublicText(rewritten.en),
    cleanPublicText(rewritten.ru),
    `Scope: ${rewritten.scope || extractScopeFromSummary(row.research_summary_ru)}\n${stripScopePrefix(row.research_summary_ru)}`,
    now,
    String(data.id || ""),
    postId
  ).run();

  const updated = await getPost(env, postId);
  await editTelegramText(
    env,
    telegramMessageId,
    formatCandidateMessage(updated),
    candidateKeyboard(postId)
  );
}

async function approveCandidate(env, postId, telegramMessageId) {
  const db = env.mosaic_marketing_bot_db;
  const now = new Date().toISOString();

  await db.prepare(`
    UPDATE content_posts
    SET status = 'approved', updated_at = ?
    WHERE id = ?
  `).bind(now, postId).run();

  const row = await getPost(env, postId);
  if (!row) return;

  await editTelegramText(
    env,
    telegramMessageId,
    "✅ APPROVED — ready for Facebook\n\n" + formatCandidateMessage(row, false),
    null
  );
}

async function skipCandidate(env, postId, telegramMessageId) {
  const db = env.mosaic_marketing_bot_db;
  const now = new Date().toISOString();

  await db.prepare(`
    UPDATE content_posts
    SET status = 'skipped', updated_at = ?
    WHERE id = ?
  `).bind(now, postId).run();

  const row = await getPost(env, postId);
  if (!row) return;

  await editTelegramText(
    env,
    telegramMessageId,
    "❌ SKIPPED\n\n" + formatCandidateMessage(row, false),
    null
  );
}

async function sendRotationStatus(env) {
  const history = await getRecentHistory(env, 30);
  const next = chooseRotation(history);

  await sendTelegramText(
    env,
    "🧭 NEXT ROTATION (no AI used)\n\n" +
    `Category: ${next.category}\n` +
    `Type: ${humanize(next.contentType)}\n` +
    `Theme: ${humanize(next.theme)}\n` +
    `History loaded: ${history.length}`
  );
}

async function sendHistory(env) {
  const history = await getRecentHistory(env, 8);

  if (!history.length) {
    await sendTelegramText(env, "📚 History is empty.");
    return;
  }

  const lines = history.map(row =>
    `#${row.id} ${statusIcon(row.status)} ${humanize(row.content_type)} / ${humanize(row.theme)}\n${row.topic || "(no topic)"}`
  );

  await sendTelegramText(env, "📚 RECENT CONTENT\n\n" + lines.join("\n\n"));
}

async function getRecentHistory(env, limit = 30) {
  const db = env.mosaic_marketing_bot_db;
  if (!db) return [];

  const result = await db.prepare(`
    SELECT
      id, created_at, updated_at, status, category, content_type, theme,
      topic, en_text, ru_text, research_summary_ru, source_json,
      telegram_message_id, rewrite_count, trigger_source
    FROM content_posts
    ORDER BY id DESC
    LIMIT ?
  `).bind(limit).all();

  return Array.isArray(result?.results) ? result.results : [];
}

async function getPost(env, id) {
  const db = env.mosaic_marketing_bot_db;
  if (!db) return null;

  return db.prepare(`
    SELECT
      id, created_at, updated_at, status, category, content_type, theme,
      topic, en_text, ru_text, research_summary_ru, source_json,
      telegram_message_id, rewrite_count, trigger_source
    FROM content_posts
    WHERE id = ?
  `).bind(id).first();
}

function chooseRotation(history) {
  const slot = history.length % CATEGORY_CYCLE.length;
  const category = CATEGORY_CYCLE[slot];

  const contentType = leastRecentlyUsed(
    CONTENT_TYPES[category],
    history.map(row => row.content_type).filter(Boolean)
  );

  const theme = leastRecentlyUsed(
    THEMES,
    history.map(row => row.theme).filter(Boolean),
    2
  );

  return { category, contentType, theme, cycleSlot: slot + 1 };
}

function leastRecentlyUsed(options, recentValues, avoidRecentCount = 1) {
  const avoid = new Set(recentValues.slice(0, avoidRecentCount));
  const candidates = options.filter(value => !avoid.has(value));
  const pool = candidates.length ? candidates : options;

  let best = pool[0];
  let bestDistance = -1;

  for (const option of pool) {
    const index = recentValues.indexOf(option);
    const distance = index === -1 ? Number.MAX_SAFE_INTEGER : index;
    if (distance > bestDistance) {
      best = option;
      bestDistance = distance;
    }
  }

  return best;
}

function formatCandidateMessage(row, includeStatus = true) {
  const sources = safeJsonArray(row.source_json);
  const domains = uniqueDomains(sources).slice(0, 6);
  const sourceLine = domains.length
    ? `Research: ${domains.map(prettyDomain).join(" · ")}`
    : "Research: sources stored in D1";

  return (
    `💡 POST CANDIDATE #${row.id}` +
    (includeStatus ? `\nStatus: ${row.status || "candidate"}` : "") +
    `\nType: ${humanize(row.content_type)}` +
    `\nTheme: ${humanize(row.theme)}` +
    `\nRewrites: ${Number(row.rewrite_count || 0)}` +
    `\nScope: ${humanize(extractScopeFromSummary(row.research_summary_ru))}` +
    `\n\n🧩 Topic: ${row.topic || ""}` +
    `\n\n🇺🇸 EN — Facebook post\n${row.en_text || ""}` +
    `\n\n🇷🇺 RU — перевод для проверки\n${row.ru_text || ""}` +
    `\n\n🔎 Research note\n${row.research_summary_ru || ""}` +
    `\n\n${sourceLine}`
  );
}

function candidateKeyboard(postId) {
  return {
    inline_keyboard: [[
      { text: "✅ Approve", callback_data: `approve:${postId}` },
      { text: "🔄 Rewrite", callback_data: `rewrite:${postId}` },
      { text: "❌ Skip", callback_data: `skip:${postId}` }
    ]]
  };
}

async function sendTelegramText(env, text, replyMarkup = undefined) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(env.TELEGRAM_CHAT_ID || "").trim();

  if (!token || !chatId) {
    return { ok: false, error: "Telegram is not configured" };
  }

  const payload = {
    chat_id: chatId,
    text: truncateTelegram(text),
    disable_web_page_preview: true
  };

  if (replyMarkup) payload.reply_markup = replyMarkup;

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  return {
    ok: response.ok && data?.ok === true,
    status: response.status,
    messageId: data?.result?.message_id || null,
    data
  };
}

async function editTelegramText(env, messageId, text, replyMarkup = undefined) {
  if (!messageId) return { ok: false };

  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(env.TELEGRAM_CHAT_ID || "").trim();

  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: truncateTelegram(text),
    disable_web_page_preview: true
  };

  if (replyMarkup !== undefined) {
    payload.reply_markup = replyMarkup || { inline_keyboard: [] };
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  return { ok: response.ok && data?.ok === true, data };
}

async function answerCallback(env, callbackId, text) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token || !callbackId) return;

  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackId,
      text,
      show_alert: false
    })
  });
}

function parseStructuredOutput(data) {
  const raw = extractOutputText(data);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.topic === "string" &&
      typeof parsed?.en === "string" &&
      typeof parsed?.ru === "string"
    ) {
      return {
        topic: cleanPublicText(parsed.topic),
        scope:
          typeof parsed.scope === "string"
            ? parsed.scope.trim()
            : "general",
        en: cleanPublicText(parsed.en),
        ru: cleanPublicText(parsed.ru),
        research_summary_ru:
          typeof parsed.research_summary_ru === "string"
            ? cleanPublicText(parsed.research_summary_ru)
            : ""
      };
    }
  } catch (_) {}

  return null;
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

function extractWebSources(data) {
  const sources = [];

  for (const item of Array.isArray(data?.output) ? data.output : []) {
    const actionSources = item?.action?.sources;
    if (!Array.isArray(actionSources)) continue;

    for (const source of actionSources) {
      const url = String(source?.url || "").trim();
      if (!url) continue;

      sources.push({
        url,
        title: String(source?.title || "").trim()
      });
    }
  }

  const seen = new Set();
  return sources.filter(source => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

function safeApiError(data) {
  const err = data?.error;
  if (!err) return { message: "Unknown OpenAI API error" };

  return {
    message: String(err.message || "Unknown OpenAI API error"),
    type: err.type || null,
    code: err.code || null
  };
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function uniqueDomains(sources) {
  const result = [];
  const seen = new Set();

  for (const source of sources) {
    try {
      let domain = new URL(source.url).hostname.replace(/^www\./, "");
      if (domain === "en.reddit.com" || domain.endsWith(".reddit.com")) domain = "reddit.com";
      if (!seen.has(domain)) {
        seen.add(domain);
        result.push(domain);
      }
    } catch (_) {}
  }

  return result;
}


function cleanPublicText(value) {
  return String(value || "")
    // Markdown links: [label](https://example.com) -> label
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, "$1")
    // Bare URLs
    .replace(/https?:\/\/\S+/gi, "")
    // Common citation remnants
    .replace(/\(\s*(?:source|sources|reddit|bladeforums|knifedogs)[^)]*\)/gi, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractScopeFromSummary(summary) {
  const match = String(summary || "").match(/^Scope:\s*([a-z_]+)/i);
  return match ? match[1].toLowerCase() : "general";
}

function stripScopePrefix(summary) {
  return String(summary || "").replace(/^Scope:\s*[a-z_]+\s*\n?/i, "").trim();
}

function prettyDomain(domain) {
  const key = String(domain || "").toLowerCase();
  if (key === "reddit.com" || key === "en.reddit.com" || key.endsWith(".reddit.com")) return "Reddit";
  if (key === "bladeforums.com" || key.endsWith(".bladeforums.com")) return "BladeForums";
  if (key === "knifedogs.com" || key.endsWith(".knifedogs.com")) return "KnifeDogs";
  if (key.includes("americanbladesmith")) return "American Bladesmith Society";
  if (key.includes("bushcraftusa")) return "Bushcraft USA";
  return domain;
}

function humanize(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function statusIcon(status) {
  if (status === "approved") return "✅";
  if (status === "skipped") return "❌";
  if (status === "published") return "📣";
  return "💡";
}

function truncateTelegram(text) {
  const value = String(text || "");
  return value.length <= 4050 ? value : value.slice(0, 4040) + "\n…";
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
