const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";
const MODEL = "gpt-5.6-luna";
const IMAGE_MODEL = "gpt-image-2";

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
        facebookPageConfigured: has(env.FACEBOOK_PAGE_ID),
        facebookTokenConfigured: has(env.FACEBOOK_PAGE_ACCESS_TOKEN),
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
        "🔎 Поиск и анализ начаты.\nПроверяю актуальные обсуждения среди ножеделов, сравниваю несколько источников и готовлю один оригинальный кандидат EN/RU."
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
        "/new: поиск, анализ и создание одного нового кандидата\n" +
        "/rotation: показать следующую ротацию типа и тематики, бесплатно\n" +
        "/history: показать последние кандидаты, бесплатно\n\n" +
        "Кнопки под кандидатом:\n" +
        "✅ Принять: отметить готовым\n" +
        "🔄 Переписать: переписать EN + RU без нового поиска\n" +
        "❌ Пропустить: архивировать кандидата\n\n" +
        "После принятия:\n" +
        "📷 Фото товара: предложить реальное фото из mosaicpins.space без OpenAI\n" +
        "🚫 Без фото: подготовить текстовую публикацию\n" +
        "🖼 AI фото: сгенерировать одно тематическое изображение GPT Image 2 после принятия\n" +
        "🚀 Facebook: публикует только когда Page ID и Page Access Token подключены"
      );
    }

    return new Response("ok");
  }

  if (update.callback_query) {
    const callback = update.callback_query;
    const chatId = String(callback?.message?.chat?.id || "");
    if (!configuredChatId || chatId !== configuredChatId) {
      await answerCallback(env, callback.id, "Нет доступа");
      return new Response("ok");
    }

    const parts = String(callback.data || "").split(":");
    const action = parts[0];
    const postId = Number(parts[1]);
    const arg = Number(parts[2] || 0);
    const allowed = new Set([
      "approve", "rewrite", "skip",
      "photo", "photo_next", "photo_select", "no_photo", "ai_image", "ai_select", "facebook_publish"
    ]);

    if (!allowed.has(action) || !Number.isInteger(postId) || postId <= 0) {
      await answerCallback(env, callback.id, "Неизвестное действие");
      return new Response("ok");
    }

    if (action === "approve") {
      await answerCallback(env, callback.id, "Принято ✅");
      ctx.waitUntil(approveCandidate(env, postId, callback.message?.message_id));
    } else if (action === "skip") {
      await answerCallback(env, callback.id, "Пропущено");
      ctx.waitUntil(skipCandidate(env, postId, callback.message?.message_id));
    } else if (action === "rewrite") {
      await answerCallback(env, callback.id, "Переписываю...");
      ctx.waitUntil(rewriteCandidate(env, postId, callback.message?.message_id));
    } else if (action === "photo") {
      await answerCallback(env, callback.id, "Ищу реальное фото...");
      ctx.waitUntil(showRealPhotoPreview(env, postId, 0));
    } else if (action === "photo_next") {
      await answerCallback(env, callback.id, "Следующее фото");
      ctx.waitUntil(showRealPhotoPreview(env, postId, arg + 1, callback.message?.message_id));
    } else if (action === "photo_select") {
      await answerCallback(env, callback.id, "Фото выбрано ✅");
      ctx.waitUntil(selectRealPhoto(env, postId, arg, callback.message?.message_id));
    } else if (action === "no_photo") {
      await answerCallback(env, callback.id, "Без фото ✅");
      ctx.waitUntil(selectNoPhoto(env, postId));
    } else if (action === "ai_image") {
      await answerCallback(env, callback.id, "Генерирую AI-изображение...");
      ctx.waitUntil(generateAiImagePreview(env, postId));
    } else if (action === "ai_select") {
      await answerCallback(env, callback.id, "AI-изображение выбрано ✅");
      ctx.waitUntil(selectAiImage(env, postId, callback.message?.message_id));
    } else if (action === "facebook_publish") {
      ctx.waitUntil(handleFacebookPublish(env, postId, callback.id));
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
              topic_ru: { type: "string" },
              scope: {
                type: "string",
                enum: ["general", "mosaic_pin", "solid_pin", "fastener", "lanyard_tube", "other"]
              },
              research_summary_ru: { type: "string" },
              en: { type: "string" },
              ru: { type: "string" }
            },
            required: ["topic", "topic_ru", "scope", "research_summary_ru", "en", "ru"],
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
    await sendTelegramText(env, `⚠️ Ошибка поиска и анализа\n${body.details?.message || "Неизвестная ошибка OpenAI"}`);
    return { status: 502, body };
  }

  const candidate = parseStructuredOutput(data);
  if (!candidate) {
    const body = { ok: false, error: "Could not parse structured AI output" };
    await sendTelegramText(env, "⚠️ Поиск и анализ завершены, но не удалось разобрать формат кандидата.");
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
    composeRuPayload(candidate.topic_ru, candidate.ru),
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
    en_text: cleanPublicText(candidate.en),
    ru_text: composeRuPayload(candidate.topic_ru, candidate.ru),
    research_summary_ru: `Scope: ${candidate.scope}\n${cleanPublicText(candidate.research_summary_ru)}`,
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
    "STYLE RULE: Never use em dash (\u2014) or en dash (\u2013) characters anywhere in topic, topic_ru, EN, RU or research summary. " +
    "Use commas, periods, colons or parentheses instead. For numeric ranges, use a normal hyphen, for example 80-130. " +
    "Return a short English topic label, its natural Russian translation in topic_ru, " +
    "a brief Russian research summary explaining the signal you found, the final English post, " +
    "and its faithful Russian translation. The Russian version must preserve the meaning and tone, not be a word-for-word machine translation."
  );
}

async function rewriteCandidate(env, postId, telegramMessageId) {
  const db = env.mosaic_marketing_bot_db;
  const row = await getPost(env, postId);
  if (!row) {
    await sendTelegramText(env, `⚠️ Кандидат #${postId} не найден.`);
    return;
  }

  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    await sendTelegramText(env, "⚠️ OPENAI_API_KEY не настроен.");
    return;
  }

  await editTelegramText(
    env,
    telegramMessageId,
    formatCandidateMessage(row) + "\n\n🔄 Переписываю…",
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
              "Write natural American English, provide a faithful Russian translation, and provide a natural Russian translation of the topic in topic_ru. " +
              "Never use em dash (\u2014) or en dash (\u2013) characters anywhere. Use commas, periods, colons or parentheses instead; use a normal hyphen only for ranges or compounds. " +
              "Return structured JSON only."
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
              `Current RU:\n${splitRuPayload(row.ru_text).body}\n\n` +
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
              topic_ru: { type: "string" },
              scope: {
                type: "string",
                enum: ["general", "mosaic_pin", "solid_pin", "fastener", "lanyard_tube", "other"]
              },
              en: { type: "string" },
              ru: { type: "string" }
            },
            required: ["topic", "topic_ru", "scope", "en", "ru"],
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
      formatCandidateMessage(row) + "\n\n⚠️ Не удалось переписать текст.",
      candidateKeyboard(postId)
    );
    return;
  }

  const rewritten = parseStructuredOutput(data);
  if (!rewritten) {
    await editTelegramText(
      env,
      telegramMessageId,
      formatCandidateMessage(row) + "\n\n⚠️ Ошибка формата после переписывания.",
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
    composeRuPayload(rewritten.topic_ru, rewritten.ru),
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
  const current = await getPost(env, postId);
  if (!current) return;

  await ensurePublishingTables(env);

  // Normalize older candidates too when they are approved, without rewriting wording.
  const currentRu = splitRuPayload(current.ru_text);
  await db.prepare(`
    UPDATE content_posts
    SET status = 'approved', topic = ?, en_text = ?, ru_text = ?, research_summary_ru = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    cleanPublicText(current.topic),
    cleanPublicText(current.en_text),
    composeRuPayload(currentRu.topic, currentRu.body),
    cleanPublicText(current.research_summary_ru),
    now,
    postId
  ).run();

  const row = await getPost(env, postId);
  if (!row) return;
  const media = await getMediaSelection(env, postId);

  await editTelegramText(
    env,
    telegramMessageId,
    formatApprovedMessage(row, media),
    approvedKeyboard(postId)
  );
}

async function ensurePublishingTables(env) {
  const db = env.mosaic_marketing_bot_db;
  if (!db) return;

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS content_media (
      post_id INTEGER PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'unset',
      image_url TEXT,
      image_pin TEXT,
      image_title TEXT,
      updated_at TEXT NOT NULL
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS facebook_publications (
      post_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'not_published',
      facebook_post_id TEXT,
      facebook_page_id TEXT,
      published_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    )
  `).run();

  // Preview state is intentionally separate from the active media selection.
  // This prevents generating an AI preview from silently replacing a currently
  // selected product photo before the user presses "✅ Выбрать".
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS content_media_previews (
      post_id INTEGER PRIMARY KEY,
      ai_image_url TEXT,
      ai_image_title TEXT,
      product_message_id INTEGER,
      ai_message_id INTEGER,
      updated_at TEXT NOT NULL
    )
  `).run();
}

async function getMediaSelection(env, postId) {
  await ensurePublishingTables(env);
  return env.mosaic_marketing_bot_db.prepare(`
    SELECT post_id, mode, image_url, image_pin, image_title, updated_at
    FROM content_media
    WHERE post_id = ?
  `).bind(postId).first();
}

async function saveMediaSelection(env, postId, media) {
  await ensurePublishingTables(env);
  const now = new Date().toISOString();
  await env.mosaic_marketing_bot_db.prepare(`
    INSERT INTO content_media (post_id, mode, image_url, image_pin, image_title, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(post_id) DO UPDATE SET
      mode = excluded.mode,
      image_url = excluded.image_url,
      image_pin = excluded.image_pin,
      image_title = excluded.image_title,
      updated_at = excluded.updated_at
  `).bind(
    postId,
    String(media?.mode || "unset"),
    String(media?.imageUrl || ""),
    String(media?.pin || ""),
    String(media?.title || ""),
    now
  ).run();
}

async function getMediaPreviewState(env, postId) {
  await ensurePublishingTables(env);
  return env.mosaic_marketing_bot_db.prepare(`
    SELECT post_id, ai_image_url, ai_image_title, product_message_id, ai_message_id, updated_at
    FROM content_media_previews
    WHERE post_id = ?
  `).bind(postId).first();
}

async function saveMediaPreviewState(env, postId, patch = {}) {
  await ensurePublishingTables(env);
  const current = await getMediaPreviewState(env, postId);
  const next = {
    aiImageUrl: patch.aiImageUrl !== undefined ? String(patch.aiImageUrl || "") : String(current?.ai_image_url || ""),
    aiImageTitle: patch.aiImageTitle !== undefined ? String(patch.aiImageTitle || "") : String(current?.ai_image_title || ""),
    productMessageId: patch.productMessageId !== undefined ? (Number(patch.productMessageId) || null) : (Number(current?.product_message_id) || null),
    aiMessageId: patch.aiMessageId !== undefined ? (Number(patch.aiMessageId) || null) : (Number(current?.ai_message_id) || null)
  };
  const now = new Date().toISOString();
  await env.mosaic_marketing_bot_db.prepare(`
    INSERT INTO content_media_previews
      (post_id, ai_image_url, ai_image_title, product_message_id, ai_message_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(post_id) DO UPDATE SET
      ai_image_url = excluded.ai_image_url,
      ai_image_title = excluded.ai_image_title,
      product_message_id = excluded.product_message_id,
      ai_message_id = excluded.ai_message_id,
      updated_at = excluded.updated_at
  `).bind(
    postId, next.aiImageUrl, next.aiImageTitle, next.productMessageId, next.aiMessageId, now
  ).run();
}

async function visuallyDeselectOtherMedia(env, postId, keepKind) {
  const state = await getMediaPreviewState(env, postId);
  if (!state) return;

  if (keepKind !== "product" && state.product_message_id) {
    await editTelegramPhotoCaption(
      env,
      state.product_message_id,
      "⬜ Фото товара не выбрано\nЗаменено другим вариантом медиа.",
      null
    ).catch(() => {});
  }

  if (keepKind !== "ai" && state.ai_message_id) {
    await editTelegramPhotoCaption(
      env,
      state.ai_message_id,
      "⬜ AI-изображение не выбрано\nЗаменено другим вариантом медиа.",
      null
    ).catch(() => {});
  }
}

async function showRealPhotoPreview(env, postId, requestedIndex = 0, previewMessageId = null) {
  const row = await getPost(env, postId);
  if (!row || row.status !== "approved") {
    await sendTelegramText(env, `⚠️ Post #${postId} must be approved first.`);
    return;
  }

  const candidates = await getRealPhotoCandidates(row);
  if (!candidates.length) {
    await sendTelegramText(env, "⚠️ Не нашёл доступных фотографий товаров на mosaicpins.space.");
    return;
  }

  const index = ((Number(requestedIndex) || 0) % candidates.length + candidates.length) % candidates.length;
  const product = candidates[index];
  const imageUrl = String(product?.images?.[0] || "").trim();
  if (!imageUrl) return;

  const caption =
    `📷 Реальное фото из магазина\n` +
    `${product.title || product.pin}\n` +
    `PIN: ${product.pin}\n` +
    `В наличии: ${Number(product.stock || 0)}\n\n` +
    `Вариант ${index + 1} из ${candidates.length}. OpenAI не используется.`;

  const keyboard = realPhotoKeyboard(postId, index);
  if (previewMessageId) {
    await editTelegramPhoto(env, previewMessageId, imageUrl, caption, keyboard);
    await saveMediaPreviewState(env, postId, { productMessageId: previewMessageId });
  } else {
    const sent = await sendTelegramPhoto(env, imageUrl, caption, keyboard);
    if (sent?.messageId) {
      await saveMediaPreviewState(env, postId, { productMessageId: sent.messageId });
    }
  }
}

async function selectRealPhoto(env, postId, index, previewMessageId) {
  const row = await getPost(env, postId);
  if (!row || row.status !== "approved") return;

  const candidates = await getRealPhotoCandidates(row);
  if (!candidates.length) return;
  const normalizedIndex = ((Number(index) || 0) % candidates.length + candidates.length) % candidates.length;
  const product = candidates[normalizedIndex];
  const imageUrl = String(product?.images?.[0] || "").trim();
  if (!imageUrl) return;

  await saveMediaSelection(env, postId, {
    mode: "product",
    imageUrl,
    pin: product.pin,
    title: product.title || product.pin
  });
  await saveMediaPreviewState(env, postId, { productMessageId: previewMessageId || undefined });
  await visuallyDeselectOtherMedia(env, postId, "product");

  if (previewMessageId) {
    await editTelegramPhoto(
      env,
      previewMessageId,
      imageUrl,
      `✅ Фото выбрано\n${product.title || product.pin}\nPIN: ${product.pin}`,
      null
    );
  }

  await refreshApprovedTelegramMessage(env, postId);
}

async function selectNoPhoto(env, postId) {
  const row = await getPost(env, postId);
  if (!row || row.status !== "approved") return;
  await saveMediaSelection(env, postId, { mode: "none" });
  await visuallyDeselectOtherMedia(env, postId, "none");
  await refreshApprovedTelegramMessage(env, postId);
}

async function refreshApprovedTelegramMessage(env, postId) {
  const row = await getPost(env, postId);
  if (!row || !row.telegram_message_id) return;
  const media = await getMediaSelection(env, postId);
  await editTelegramText(
    env,
    row.telegram_message_id,
    formatApprovedMessage(row, media),
    approvedKeyboard(postId)
  );
}

async function getRealPhotoCandidates(row) {
  const response = await fetch("https://mosaicpins.space/api/products", {
    headers: { "accept": "application/json" }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return [];

  let products = (Array.isArray(data?.products) ? data.products : [])
    .filter(p => Array.isArray(p?.images) && p.images.some(Boolean));
  if (!products.length) return [];

  products = products.map(product => ({
    ...product,
    _score: scoreProductForPost(row, product)
  }));

  products.sort((a, b) =>
    Number(b._score || 0) - Number(a._score || 0) ||
    String(a.pin || "").localeCompare(String(b.pin || ""))
  );

  // Rotate equal-quality choices per post so different posts do not always show the same first product.
  const top = products.slice(0, Math.min(12, products.length));
  if (top.length > 1) {
    const shift = Number(row?.id || 0) % top.length;
    return top.slice(shift).concat(top.slice(0, shift));
  }
  return top;
}

function scoreProductForPost(row, product) {
  const haystack = [
    product?.pin,
    product?.title,
    product?.description,
    product?.type,
    product?.color,
    ...(Array.isArray(product?.materials) ? product.materials : [])
  ].join(" ").toLowerCase();

  let score = Number(product?.stock || 0) > 0 ? 20 : 0;
  const theme = String(row?.theme || "");
  const type = String(row?.content_type || "");
  const topic = String(row?.topic || "").toLowerCase();

  const themeKeywords = {
    glow_materials: ["glow", "moonglow", "luminous", "powder"],
    lanyards: ["lanyard", "tube"],
    pins_installation: ["mosaic", "pin"],
    drilling_and_fit: ["mosaic", "pin"],
    handle_design: ["mosaic", "pin"],
    finished_knives: ["mosaic", "pin"]
  }[theme] || [];

  for (const keyword of themeKeywords) {
    if (haystack.includes(keyword)) score += 12;
  }

  if (type === "mosaic_pins") score += 10;
  for (const token of topic.split(/[^a-z0-9]+/).filter(x => x.length >= 5)) {
    if (haystack.includes(token)) score += 2;
  }
  return score;
}

async function generateAiImagePreview(env, postId) {
  const row = await getPost(env, postId);
  if (!row || row.status !== "approved") {
    await sendTelegramText(env, `⚠️ Кандидат #${postId} сначала нужно принять.`);
    return;
  }

  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    await sendTelegramText(env, "⚠️ OPENAI_API_KEY не настроен.");
    return;
  }

  const prompt = buildAiImagePrompt(row);
  const response = await fetch(OPENAI_IMAGE_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      size: "1536x1024",
      quality: "low",
      n: 1
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = safeApiError(data);
    await sendTelegramText(
      env,
      `⚠️ Не удалось создать AI-изображение для #${postId}.\n${err.message || `OpenAI HTTP ${response.status}`}`
    );
    return;
  }

  const b64 = String(data?.data?.[0]?.b64_json || "").trim();
  if (!b64) {
    await sendTelegramText(env, `⚠️ OpenAI не вернул изображение для #${postId}.`);
    return;
  }

  let bytes;
  try {
    bytes = base64ToUint8Array(b64);
  } catch (_) {
    await sendTelegramText(env, `⚠️ Не удалось декодировать AI-изображение для #${postId}.`);
    return;
  }

  const caption =
    `🖼 AI-изображение для кандидата #${postId}\n` +
    `Тема: ${row.topic || ""}\n` +
    `Тематика: ${themeRu(row.theme)}\n` +
    `Область: ${scopeRu(extractScopeFromSummary(row.research_summary_ru))}\n\n` +
    `GPT Image 2, черновое качество low. Генерация выполняется только по нажатию кнопки.`;

  const sent = await sendTelegramPhotoBytes(
    env,
    bytes,
    `mosaic-post-${postId}.png`,
    caption,
    aiPhotoKeyboard(postId)
  );

  if (!sent.ok || !sent.fileId) {
    await sendTelegramText(env, `⚠️ Картинка создана, но Telegram не смог её принять для #${postId}.`);
    return;
  }

  await saveMediaPreviewState(env, postId, {
    aiImageUrl: `tgfile:${sent.fileId}`,
    aiImageTitle: `AI: ${row.topic || `Post ${postId}`}`,
    aiMessageId: sent.messageId || undefined
  });
  // Important: an AI preview is only a proposal. The currently selected media
  // stays active until the user explicitly presses "✅ Выбрать".
  await refreshApprovedTelegramMessage(env, postId);
}

async function selectAiImage(env, postId, previewMessageId) {
  const row = await getPost(env, postId);
  if (!row || row.status !== "approved") return;

  const preview = await getMediaPreviewState(env, postId);
  if (!preview || !String(preview.ai_image_url || "").startsWith("tgfile:")) {
    await sendTelegramText(env, `⚠️ Для #${postId} сначала создай AI-изображение.`);
    return;
  }

  await saveMediaSelection(env, postId, {
    mode: "ai",
    imageUrl: String(preview.ai_image_url || ""),
    pin: "",
    title: String(preview.ai_image_title || `AI: ${row.topic || ""}`)
  });
  await saveMediaPreviewState(env, postId, { aiMessageId: previewMessageId || preview.ai_message_id || undefined });
  await visuallyDeselectOtherMedia(env, postId, "ai");

  if (previewMessageId) {
    await editTelegramPhotoCaption(
      env,
      previewMessageId,
      `✅ AI-изображение выбрано для кандидата #${postId}\nТема: ${row.topic || ""}`,
      null
    );
  }
  await refreshApprovedTelegramMessage(env, postId);
}

function buildAiImagePrompt(row) {
  const scope = extractScopeFromSummary(row.research_summary_ru);
  const scopeInstruction = {
    mosaic_pin:
      "The hardware shown must clearly be a decorative mosaic pin used in a custom knife handle. Do not depict hammering, peening, mushrooming, or expanding the mosaic pin.",
    solid_pin:
      "The hardware shown must clearly be a plain solid metal pin, not a mosaic pin, not a Corby fastener, and not a lanyard tube.",
    fastener:
      "The hardware shown must clearly be a mechanical knife-handle fastener such as a Corby or Loveless-style fastener, and must not be confused with a mosaic pin.",
    lanyard_tube:
      "The hardware shown must clearly be a hollow lanyard tube in a knife handle, not a solid pin and not a mosaic pin.",
    general:
      "Keep any knife-handle hardware visually generic and do not imply a specific installation technique that the post does not discuss.",
    other:
      "Keep the visual tightly connected to the stated topic without inventing unsupported technical details."
  }[scope] || "Keep the visual tightly connected to the stated topic without inventing unsupported technical details.";

  const visualInstruction = buildMainVisualInstruction(row);

  return (
    "Create a realistic editorial social-media image for an English-language custom knife-making community. " +
    `The exact post topic is: ${cleanPublicText(row.topic)}. ` +
    `The thematic area is: ${humanize(row.theme)}. ` +
    `The post says: ${cleanPublicText(row.en_text)}\n\n` +
    scopeInstruction + " " +
    visualInstruction + " " +
    "The MAIN CLAIM OR PROBLEM from the post must be immediately visible in the image without needing any text explanation. " +
    "Do not settle for a generic knife-making scene merely related to the theme. Make the key visual evidence the dominant focal point. " +
    "Show a believable professional knife-maker workshop or finished custom-knife context that supports that exact idea. " +
    "Do not add any words, captions, labels, logos, watermarks, brand marks, charts, arrows, UI, or fake instructional text inside the image. " +
    "Do not copy a recognizable commercial product design. Do not make the image look like an advertisement. " +
    "Prefer one clear visual idea over a collage. Natural workshop materials, realistic metal, wood, Micarta or G10 textures are welcome when relevant. " +
    "If the post discusses fit, drilling, epoxy, finishing or another process, illustrate the actual cause, defect, fit, surface condition, or result discussed in the post instead of only showing the tool or process. " +
    "Landscape composition, close enough to clearly read the relevant craft detail, clean focal point, photorealistic workshop photography, suitable for a Facebook post."
  );
}

function buildMainVisualInstruction(row) {
  const topic = cleanPublicText(row?.topic).toLowerCase();
  const text = cleanPublicText(row?.en_text).toLowerCase();
  const theme = String(row?.theme || "").toLowerCase();
  const haystack = `${topic} ${text} ${theme}`;

  if (/deep scratch|deep scratches|scratch pattern|scratches/.test(haystack) && /polish|polishing|finish|finishing|sand|sanding/.test(haystack)) {
    return (
      "For this post, use a close-up of a knife blade where one or two unmistakably deep scratches remain clearly visible while the surrounding steel is already refined or polished. " +
      "A polishing wheel, abrasive setup, or workshop background may appear secondarily, but the persistent deep scratch itself must be the obvious focal point. " +
      "Do not show a flawless blade, because that would contradict the post."
    );
  }

  if (/drill|drilling|hole|fit|fitting|clearance|alignment/.test(haystack)) {
    return (
      "Make the fit or drilling issue visually explicit in a close-up: clearly show the relevant hole, pin, alignment, clearance, or dry-fit relationship that the post discusses. " +
      "The viewer should understand the fit problem or controlled-fit idea from the geometry alone."
    );
  }

  if (/epoxy|adhesive|glue|bond|joint/.test(haystack)) {
    return (
      "Make the adhesive-joint idea visually explicit. Show the real mating surfaces, joint line, or bonded handle assembly in close-up so the viewer can see the relationship between the parts, not merely a bottle of epoxy."
    );
  }

  if (/glow|moonglow|luminous|luminescent/.test(haystack)) {
    return (
      "Make the glow behavior itself clearly visible. Use a believable low-light workshop or finished-handle view where the glowing material or pin is visibly luminous while the surrounding knife remains realistic and readable."
    );
  }

  if (/lanyard/.test(haystack)) {
    return (
      "Use a close-up that makes the lanyard feature itself obvious in the knife handle. The hollow tube or lanyard opening must be clearly readable and not confused with a solid decorative pin."
    );
  }

  if (/mosaic pin|mosaic pins/.test(haystack)) {
    return (
      "Make the mosaic pin itself visually important and technically plausible. Show its patterned face clearly in a knife-handle or fitting context, with enough detail to distinguish it from a plain solid pin or fastener."
    );
  }

  return (
    "Identify the single most important physical detail, defect, material relationship, or finished result described by the post and make that detail the dominant, clearly readable focal point."
  );
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function sendTelegramPhotoBytes(env, bytes, filename, caption, replyMarkup = undefined) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId || !bytes?.byteLength) return { ok: false };

  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("caption", truncateTelegram(caption));
  if (replyMarkup) form.set("reply_markup", JSON.stringify(replyMarkup));
  form.set("photo", new Blob([bytes], { type: "image/png" }), filename || "image.png");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    body: form
  });
  const data = await response.json().catch(() => ({}));
  const sizes = Array.isArray(data?.result?.photo) ? data.result.photo : [];
  const fileId = sizes.length ? String(sizes[sizes.length - 1]?.file_id || "") : "";
  return {
    ok: response.ok && data?.ok === true,
    messageId: data?.result?.message_id || null,
    fileId,
    data
  };
}

async function editTelegramPhotoCaption(env, messageId, caption, replyMarkup = undefined) {
  if (!messageId) return { ok: false };
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId) return { ok: false };

  const payload = {
    chat_id: chatId,
    message_id: messageId,
    caption: truncateTelegram(caption)
  };
  if (replyMarkup !== undefined) payload.reply_markup = replyMarkup || { inline_keyboard: [] };

  const response = await fetch(`https://api.telegram.org/bot${token}/editMessageCaption`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok && data?.ok === true, data };
}

async function fetchTelegramStoredImage(env, fileId) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token || !fileId) throw new Error("Telegram file storage is unavailable");

  const metaResponse = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const meta = await metaResponse.json().catch(() => ({}));
  const filePath = String(meta?.result?.file_path || "").trim();
  if (!metaResponse.ok || meta?.ok !== true || !filePath) {
    throw new Error("Telegram could not resolve generated image file");
  }

  const fileResponse = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!fileResponse.ok) throw new Error(`Telegram image download failed (HTTP ${fileResponse.status})`);
  return await fileResponse.blob();
}

async function handleFacebookPublish(env, postId, callbackId) {
  const row = await getPost(env, postId);
  if (!row || row.status !== "approved") {
    await answerCallback(env, callbackId, "Сначала нужно принять пост", true);
    return;
  }

  await ensurePublishingTables(env);
  const previous = await env.mosaic_marketing_bot_db.prepare(`
    SELECT status, facebook_post_id, published_at
    FROM facebook_publications
    WHERE post_id = ?
  `).bind(postId).first();

  if (previous?.status === "published") {
    await answerCallback(env, callbackId, "Этот пост уже опубликован", true);
    return;
  }

  const pageId = String(env.FACEBOOK_PAGE_ID || "").trim();
  const token = String(env.FACEBOOK_PAGE_ACCESS_TOKEN || "").trim();
  if (!pageId || !token) {
    await answerCallback(env, callbackId, "Facebook пока не подключен. Ничего не опубликовано.", true);
    return;
  }

  const media = await getMediaSelection(env, postId);
  if (!media || media.mode === "unset") {
    await answerCallback(env, callbackId, "Сначала выбери фото или Без фото", true);
    return;
  }

  await answerCallback(env, callbackId, "Публикую...");
  const result = await publishToFacebookPage(env, row, media);
  const now = new Date().toISOString();

  await env.mosaic_marketing_bot_db.prepare(`
    INSERT INTO facebook_publications (
      post_id, status, facebook_post_id, facebook_page_id, published_at, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(post_id) DO UPDATE SET
      status = excluded.status,
      facebook_post_id = excluded.facebook_post_id,
      facebook_page_id = excluded.facebook_page_id,
      published_at = excluded.published_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `).bind(
    postId,
    result.ok ? "published" : "failed",
    String(result.postId || ""),
    pageId,
    result.ok ? now : "",
    result.ok ? "" : String(result.error || "Unknown Facebook error"),
    now
  ).run();

  if (!result.ok) {
    await sendTelegramText(env, `⚠️ Facebook publish failed for #${postId}\n${result.error || "Unknown error"}`);
    return;
  }

  await editTelegramText(
    env,
    row.telegram_message_id,
    `✅ ОПУБЛИКОВАНО В FACEBOOK\nPublished: ${now}\nFacebook ID: ${result.postId || ""}\n\n` + formatCandidateMessage(row, false),
    null
  );
}

async function publishToFacebookPage(env, row, media) {
  const pageId = String(env.FACEBOOK_PAGE_ID || "").trim();
  const token = String(env.FACEBOOK_PAGE_ACCESS_TOKEN || "").trim();
  const imageRef = String(media?.image_url || "").trim();
  const isProductPhoto = media?.mode === "product" && imageRef;
  const isAiPhoto = media?.mode === "ai" && imageRef.startsWith("tgfile:");

  let response;
  if (isAiPhoto) {
    const fileId = imageRef.slice("tgfile:".length);
    const imageBlob = await fetchTelegramStoredImage(env, fileId);
    const form = new FormData();
    form.set("access_token", token);
    form.set("caption", String(row.en_text || ""));
    form.set("source", imageBlob, `mosaic-ai-post-${row.id}.png`);
    response = await fetch(`https://graph.facebook.com/${encodeURIComponent(pageId)}/photos`, {
      method: "POST",
      body: form
    });
  } else if (isProductPhoto) {
    const body = new URLSearchParams();
    body.set("access_token", token);
    body.set("url", imageRef);
    body.set("caption", String(row.en_text || ""));
    response = await fetch(`https://graph.facebook.com/${encodeURIComponent(pageId)}/photos`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
  } else {
    const body = new URLSearchParams();
    body.set("access_token", token);
    body.set("message", String(row.en_text || ""));
    response = await fetch(`https://graph.facebook.com/${encodeURIComponent(pageId)}/feed`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    return {
      ok: false,
      error: String(data?.error?.message || `Facebook HTTP ${response.status}`)
    };
  }
  return { ok: true, postId: String(data?.post_id || data?.id || "") };
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
    "❌ ПРОПУЩЕНО\n\n" + formatCandidateMessage(row, false),
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
    ? `Исследование: ${domains.map(prettyDomain).join(" · ")}`
    : "Исследование: источники сохранены в D1";

  const scope = extractScopeFromSummary(row.research_summary_ru);
  const ruPayload = splitRuPayload(row.ru_text);

  return (
    `💡 POST CANDIDATE #${row.id}` +
    (includeStatus ? `\nStatus: ${row.status || "candidate"}` : "") +
    `\nType: ${humanize(row.content_type)}` +
    `\nTheme: ${humanize(row.theme)}` +
    `\nRewrites: ${Number(row.rewrite_count || 0)}` +
    `\nScope: ${humanize(scope)}` +
    `\n\n🧩 Topic: ${row.topic || ""}` +
    `\n\n🇺🇸 EN: Facebook post\n${row.en_text || ""}` +

    `\n\n🇷🇺 RU` +
    `\nСтатус: ${statusRu(row.status || "candidate")}` +
    `\nТип: ${contentTypeRu(row.content_type)}` +
    `\nТематика: ${themeRu(row.theme)}` +
    `\nПереписано: ${Number(row.rewrite_count || 0)}` +
    `\nОбласть: ${scopeRu(scope)}` +
    `\n\n🧩 Тема: ${ruPayload.topic || "нет темы"}` +
    `\n\n${ruPayload.body || ""}` +

    `\n\n🔎 Заметка по исследованию\n${stripScopePrefix(row.research_summary_ru) || ""}` +
    `\n\n${sourceLine}`
  );
}

function formatApprovedMessage(row, media) {
  let mediaLine = "📷 Медиа: не выбрано";
  if (media?.mode === "product") {
    mediaLine = `📷 Медиа: ${media.image_title || media.image_pin || "фото товара"}${media.image_pin ? ` · ${media.image_pin}` : ""}`;
  } else if (media?.mode === "none") {
    mediaLine = "📷 Медиа: без фото";
  } else if (media?.mode === "ai_preview") {
    // Compatibility with Step8c/8d rows created before previews were separated.
    mediaLine = "📷 Медиа: AI-картинка пока только предложена";
  } else if (media?.mode === "ai") {
    mediaLine = "📷 Медиа: AI-картинка выбрана";
  }

  return "✅ ПРИНЯТО: готово для Facebook\n" + mediaLine + "\n\n" + formatCandidateMessage(row, false);
}

function approvedKeyboard(postId) {
  return {
    inline_keyboard: [
      [
        { text: "📷 Фото товара", callback_data: `photo:${postId}` },
        { text: "🖼 AI фото", callback_data: `ai_image:${postId}` }
      ],
      [
        { text: "🚫 Без фото", callback_data: `no_photo:${postId}` }
      ],
      [
        { text: "🚀 Facebook", callback_data: `facebook_publish:${postId}` }
      ]
    ]
  };
}

function realPhotoKeyboard(postId, index) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Выбрать", callback_data: `photo_select:${postId}:${index}` },
        { text: "➡️ Другое", callback_data: `photo_next:${postId}:${index}` }
      ]
    ]
  };
}

function aiPhotoKeyboard(postId) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Выбрать", callback_data: `ai_select:${postId}` },
        { text: "🔄 Другое AI", callback_data: `ai_image:${postId}` }
      ]
    ]
  };
}

function candidateKeyboard(postId) {
  return {
    inline_keyboard: [[
      { text: "✅ Принять", callback_data: `approve:${postId}` },
      { text: "🔄 Переписать", callback_data: `rewrite:${postId}` },
      { text: "❌ Пропустить", callback_data: `skip:${postId}` }
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

async function sendTelegramPhoto(env, photoUrl, caption, replyMarkup = undefined) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId || !photoUrl) return { ok: false };

  const payload = {
    chat_id: chatId,
    photo: photoUrl,
    caption: truncateTelegram(caption)
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  return {
    ok: response.ok && data?.ok === true,
    messageId: data?.result?.message_id || null,
    data
  };
}

async function editTelegramPhoto(env, messageId, photoUrl, caption, replyMarkup = undefined) {
  if (!messageId || !photoUrl) return { ok: false };
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId) return { ok: false };

  const payload = {
    chat_id: chatId,
    message_id: messageId,
    media: {
      type: "photo",
      media: photoUrl,
      caption: truncateTelegram(caption)
    }
  };
  if (replyMarkup !== undefined) payload.reply_markup = replyMarkup || { inline_keyboard: [] };

  const response = await fetch(`https://api.telegram.org/bot${token}/editMessageMedia`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok && data?.ok === true, data };
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

async function answerCallback(env, callbackId, text, showAlert = false) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token || !callbackId) return;

  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackId,
      text,
      show_alert: Boolean(showAlert)
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
        topic_ru:
          typeof parsed.topic_ru === "string"
            ? cleanPublicText(parsed.topic_ru)
            : "",
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


function composeRuPayload(topicRu, body) {
  const topic = cleanPublicText(topicRu);
  const cleanBody = cleanPublicText(body);
  return `__TOPIC_RU__${topic}\n${cleanBody}`;
}

function splitRuPayload(value) {
  const text = String(value || "");
  const match = text.match(/^__TOPIC_RU__(.*)\n([\s\S]*)$/);
  if (match) {
    return {
      topic: match[1].trim(),
      body: match[2].trim()
    };
  }

  // Backward compatibility with candidates created before Step7.
  const visibleMatch = text.match(/^Тема:\s*(.+)\n+([\s\S]*)$/i);
  if (visibleMatch) {
    return {
      topic: visibleMatch[1].trim(),
      body: visibleMatch[2].trim()
    };
  }

  return {
    topic: "",
    body: text.trim()
  };
}

function statusRu(status) {
  const map = {
    candidate: "Кандидат",
    approved: "Одобрено",
    skipped: "Пропущено",
    published: "Опубликовано"
  };
  return map[String(status || "").toLowerCase()] || status || "Кандидат";
}

function contentTypeRu(value) {
  const map = {
    technical_tip: "Технический совет",
    interesting_fact: "Интересный факт / наблюдение",
    common_mistake: "Распространённая ошибка",
    workshop_idea: "Идея для мастерской",
    mini_guide: "Мини-гайд",
    maker_spotlight: "Мастер в фокусе",
    community_recap: "Обзор сообщества",
    discussion: "Обсуждение",
    poll: "Опрос",
    show_your_work: "Покажите свою работу",
    mosaic_pins: "Мозаичные пины"
  };
  return map[value] || humanize(value);
}

function themeRu(value) {
  const map = {
    pins_installation: "Установка пинов",
    handle_materials: "Материалы рукояти",
    epoxy_adhesives: "Эпоксидные клеи",
    drilling_and_fit: "Сверление и посадка",
    finishing_and_polishing: "Финишная обработка и полировка",
    lanyards: "Темляки",
    glow_materials: "Светящиеся материалы",
    handle_design: "Дизайн рукояти",
    workshop_process: "Процесс в мастерской",
    finished_knives: "Готовые ножи",
    tool_setup: "Настройка инструмента",
    maker_business: "Бизнес ножедела"
  };
  return map[value] || humanize(value);
}

function scopeRu(value) {
  const map = {
    general: "Общая",
    mosaic_pin: "Мозаичный пин",
    solid_pin: "Цельный металлический пин",
    fastener: "Крепёж",
    lanyard_tube: "Темлячная трубка",
    other: "Другое"
  };
  return map[value] || humanize(value);
}

function cleanPublicText(value) {
  return String(value || "")
    // Long-dash style guard: keep numeric ranges with a short hyphen,
    // replace other em/en dashes with a comma.
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, "$1-$2")
    .replace(/\s*[\u2013\u2014]\s*/g, ", ")
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
