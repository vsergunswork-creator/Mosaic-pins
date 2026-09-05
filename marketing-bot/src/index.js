const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";
const MODEL = "gpt-5.6-luna";
const IMAGE_MODEL = "gpt-image-2";
const AI_IMAGE_CHECK_MODEL = MODEL;

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

    // Private Content Library for approved, published and archived posts.
    // Uses BOT_ADMIN_SECRET only for login and stores only its SHA-256 hash in
    // an HttpOnly cookie. No new Cloudflare variable is required.
    if (url.pathname === "/library" && request.method === "GET") {
      if (!(await isLibraryAuthorized(request, env))) {
        return html(libraryLoginPage(url.searchParams.get("error") === "1"), 401);
      }
      return renderContentLibrary(env);
    }

    if (url.pathname === "/library/login" && request.method === "POST") {
      const form = await request.formData().catch(() => null);
      const provided = String(form?.get("secret") || "").trim();
      const required = String(env.BOT_ADMIN_SECRET || "").trim();
      if (!required || provided !== required) {
        return new Response(null, {
          status: 303,
          headers: { location: "/library?error=1" }
        });
      }
      const cookieValue = await libraryCookieValue(env);
      return new Response(null, {
        status: 303,
        headers: {
          location: "/library",
          "set-cookie": `mb_library_auth=${cookieValue}; Path=/library; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`
        }
      });
    }

    if (url.pathname === "/library/logout" && request.method === "POST") {
      return new Response(null, {
        status: 303,
        headers: {
          location: "/library",
          "set-cookie": "mb_library_auth=; Path=/library; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
        }
      });
    }

    if (url.pathname === "/library/media" && request.method === "GET") {
      if (!(await isLibraryAuthorized(request, env))) {
        return new Response("Unauthorized", { status: 401 });
      }
      const postId = Number(url.searchParams.get("id") || 0);
      if (!Number.isInteger(postId) || postId <= 0) {
        return new Response("Bad request", { status: 400 });
      }
      return serveLibraryMedia(env, postId);
    }

    if (url.pathname === "/library/preview-media" && request.method === "GET") {
      if (!(await isLibraryAuthorized(request, env))) {
        return new Response("Unauthorized", { status: 401 });
      }
      const postId = Number(url.searchParams.get("id") || 0);
      if (!Number.isInteger(postId) || postId <= 0) {
        return new Response("Bad request", { status: 400 });
      }
      return serveLibraryPreviewMedia(env, postId);
    }

    if (url.pathname === "/library/product-options" && request.method === "GET") {
      if (!(await isLibraryAuthorized(request, env))) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
      const postId = Number(url.searchParams.get("id") || 0);
      if (!Number.isInteger(postId) || postId <= 0) {
        return json({ ok: false, error: "Bad post id" }, 400);
      }
      return libraryProductOptions(env, postId);
    }

    if (url.pathname === "/library/ai-history" && request.method === "GET") {
      if (!(await isLibraryAuthorized(request, env))) return json({ ok: false, error: "Unauthorized" }, 401);
      const postId = Number(url.searchParams.get("id") || 0);
      if (!Number.isInteger(postId) || postId <= 0) return json({ ok: false, error: "Bad post id" }, 400);
      return libraryAiHistory(env, postId);
    }

    if (url.pathname === "/library/history-media" && request.method === "GET") {
      if (!(await isLibraryAuthorized(request, env))) return new Response("Unauthorized", { status: 401 });
      const historyId = Number(url.searchParams.get("id") || 0);
      if (!Number.isInteger(historyId) || historyId <= 0) return new Response("Bad request", { status: 400 });
      return serveLibraryHistoryMedia(env, historyId);
    }

    if (url.pathname === "/library/action" && request.method === "POST") {
      if (!(await isLibraryAuthorized(request, env))) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
      return handleLibraryAction(request, env);
    }

    return new Response("Mosaic Pins Marketing Bot is online ✅", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(processScheduledPosts(env));
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
        "/history: показать последние кандидаты, бесплатно\n" +
        "Marketing Dashboard: /library, темы, фото и Facebook прямо из браузера; вход через BOT_ADMIN_SECRET\n\n" +
        "Кнопки под кандидатом:\n" +
        "✅ Принять: отметить готовым\n" +
        "🔄 Переписать: переписать EN + RU без нового поиска\n" +
        "❌ Пропустить: архивировать кандидата\n\n" +
        "После принятия:\n" +
        "📷 Фото товара: предложить реальное фото из mosaicpins.space без OpenAI\n" +
        "🚫 Без фото: подготовить текстовую публикацию\n" +
        "🖼 AI фото: сгенерировать одно тематическое изображение GPT Image 2 после принятия\n" +
        "🛡 AI image check: после генерации автоматически проверяет геометрию и соответствие теме; Reject нельзя выбрать\n" +
        "🚀 Facebook: публикует только когда Page ID и Page Access Token подключены\n" +
        "📊 Poll: для Facebook Page оформляется как вопрос с 2-4 вариантами и голосованием цифрой в комментариях"
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
      const preview = await getMediaPreviewState(env, postId).catch(() => null);
      if (normalizeAiCheckStatus(preview?.ai_check_status) === "reject") {
        await answerCallback(env, callback.id, "⛔ AI check: Reject. Выбор заблокирован.");
      } else {
        await answerCallback(env, callback.id, normalizeAiCheckStatus(preview?.ai_check_status) === "warning" ? "⚠️ AI фото выбрано после предупреждения" : "AI-изображение выбрано ✅");
        ctx.waitUntil(selectAiImage(env, postId, callback.message?.message_id));
      }
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
              "You are the research editor for Mosaic Pins Space, an English-language maker page for custom knife makers, " +
              "bladesmiths, knife-handle makers and related craftspeople, focused mainly on the United States. " +
              "EDITORIAL IDENTITY: Mosaic Pins Space is a careful curator of maker practice, not a guru, instructor, certification body, or all-knowing expert. " +
              "The page may share verified practical checks, recurring workshop practices, material observations, and thoughtful discussion prompts, but must never pretend first-hand expertise it does not have. " +
              "You must synthesize current public discussions into NEW original community content. " +
              "Never copy, lightly paraphrase, imitate the structure of, or quote another person's post. " +
              "Community posts and comments are useful for discovering topics, but a single comment, single thread, or repeated unsupported anecdote is NOT sufficient evidence for a technical instruction. " +
              "For factual or prescriptive technical claims, verify the point using stronger evidence when available, such as manufacturer instructions, material or adhesive documentation, recognized maker organizations, established educational references, or multiple independent credible sources. " +
              "Do not present a single post as a trend. Prefer signals repeated across multiple independent public communities/sites. " +
              "Search current knife-making communities such as Reddit knife-making/bladesmith communities, KnifeDogs, BladeForums, " +
              "American Bladesmith Society discussions, Bushcraft USA maker discussions and other relevant public sources when useful. " +
              "Write natural American English. The Russian version is for the owner to review and must faithfully match the English meaning. " +
              "Do not fabricate sources, consensus, statistics, expert claims, or safety facts. " +
              "Never turn a weakly supported opinion into a universal rule. If evidence is mixed, say the practice varies or turn the idea into a discussion/checklist instead of advice. " +
              "Do not give exact cure times, temperatures, ratios, dimensions, heat-treatment parameters, chemical-safety instructions, structural-strength claims, or other consequential process values unless reliable evidence directly supports them. " +
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
              ru: { type: "string" },
              poll_options_en: {
                type: "array",
                items: { type: "string" },
                maxItems: 4
              },
              poll_options_ru: {
                type: "array",
                items: { type: "string" },
                maxItems: 4
              }
            },
            required: ["topic", "topic_ru", "scope", "research_summary_ru", "en", "ru", "poll_options_en", "poll_options_ru"],
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
    finalizePollPostText(rotation.contentType, candidate.en, candidate.poll_options_en, "en"),
    composeRuPayload(candidate.topic_ru, finalizePollPostText(rotation.contentType, candidate.ru, candidate.poll_options_ru, "ru")),
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
    en_text: finalizePollPostText(rotation.contentType, candidate.en, candidate.poll_options_en, "en"),
    ru_text: composeRuPayload(candidate.topic_ru, finalizePollPostText(rotation.contentType, candidate.ru, candidate.poll_options_ru, "ru")),
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

function finalizePollPostText(contentType, baseText, options, lang = "en") {
  const base = cleanPublicText(baseText);
  if (String(contentType || "") !== "poll") return base;

  const cleanOptions = (Array.isArray(options) ? options : [])
    .map(cleanPublicText)
    .map(x => x.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 4);

  if (cleanOptions.length < 2) return base;

  const optionLines = cleanOptions.map((option, index) => `${index + 1}. ${option}`);
  const optionNumbers = cleanOptions.map((_, index) => index + 1).join(", ");
  const voteLine = lang === "ru"
    ? `Голосуйте в комментариях номером варианта (${optionNumbers}) и, если хотите, напишите почему.`
    : `Vote in the comments with the option number (${optionNumbers}), and tell us why if you want.`;

  return cleanPublicText([base, ...optionLines, voteLine].filter(Boolean).join("\n\n"));
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
      "Create a Facebook Page poll-style engagement post. Keep the intro/question short and specific. Return 2-4 mutually distinct, easy-to-vote options in poll_options_en, plus faithful Russian equivalents in poll_options_ru. Do NOT embed the option list inside en or ru because the bot formats it consistently. For non-poll content, both poll option arrays must be empty.",
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
    "When possible, use at least 3 independent public sources/domains before treating something as a recurring community signal. " +
    "EVIDENCE GATE: forum posts, Reddit comments and casual maker replies may identify a topic, but they must not be the sole basis for a prescriptive technical recommendation. " +
    "For technical_tip, common_mistake, workshop_idea or mini_guide, verify the key claim with at least 2 independent credible sources whenever possible, and prefer at least one source stronger than a casual forum comment. " +
    "If that verification is not available, do NOT invent a solution or repeat a confident-sounding anecdote. Reframe the post as a cautious observation, verification checklist, discussion question, poll, or show-your-work prompt that does not tell readers to perform an unverified procedure. " +
    "For safety-sensitive, chemical, heat-treatment, structural, electrical or exact process-parameter claims, rely on primary/authoritative documentation or omit the claim. " +
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
    "a brief Russian research summary explaining the signal you found. The research_summary_ru MUST begin with exactly one of these lines: 'Проверка: высокая', 'Проверка: средняя', or 'Проверка: низкая'. " +
    "Use 'Проверка: высокая' only when the key factual/technical claim is well corroborated. Use 'Проверка: средняя' for cautious non-universal maker practice or mixed evidence. Use 'Проверка: низкая' only for discussion/engagement ideas, never for a technical instruction. " +
    "On the next line write 'Основание:' and briefly explain what kind of evidence supports the idea without naming sites or adding URLs. If evidence is mixed or limited, say that clearly. Then provide the final English post, " +
    "and its faithful Russian translation. The Russian version must preserve the meaning and tone, not be a word-for-word machine translation. " +
    "Always return poll_options_en and poll_options_ru arrays. They must contain 2-4 concise matching options only when content type is poll, otherwise both arrays must be empty. " +
    "For polls, en and ru should contain only the short setup/question, not the numbered option list or voting instruction, because the bot adds those deterministically."
  );
}

async function rewriteCandidate(env, postId, telegramMessageId, options = {}) {
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

  const differentAngle = Boolean(options?.differentAngle);
  const avoidTopic = cleanPublicText(options?.avoidTopic || "");
  const modeInstruction = differentAngle
    ? "Keep the researched evidence, but deliberately choose a different editorial angle from the similar prior topic. Do not merely rephrase the same hook. Change the question, practical focus, audience takeaway, or structure while staying inside the supplied evidence. "
    : "";

  await editTelegramText(
    env,
    telegramMessageId,
    formatCandidateMessage(row) + (differentAngle ? "\n\n↪ Ищу другой угол подачи…" : "\n\n🔄 Переписываю…"),
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
              "Rewrite a knife-making community post into a clearly different, stronger version while preserving the same researched evidence. " +
              modeInstruction +
              "Do not perform or claim new web research. Do not add new factual claims that are not supported by the supplied research summary. " +
              "Never strengthen uncertainty during a rewrite. If the research summary says evidence is medium, low, mixed or limited, keep the wording cautious and do not turn an observation into an instruction or universal rule. " +
              "Write natural American English, provide a faithful Russian translation, and provide a natural Russian translation of the topic in topic_ru. " +
              "If content type is poll, return a short setup/question in en and ru plus 2-4 concise matching choices in poll_options_en and poll_options_ru. Do not embed the option list inside en or ru. " +
              "For every non-poll content type, return empty poll option arrays. " +
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
              (differentAngle && avoidTopic ? `Avoid duplicating this prior topic/hook: ${avoidTopic}

` : "") +
              "Create a substantially different phrasing/structure, not a cosmetic word swap. Keep it concise and useful. " +
              "If this is a poll, rebuild it as a short clear question with 2-4 genuinely distinct answer choices."
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
              ru: { type: "string" },
              poll_options_en: {
                type: "array",
                items: { type: "string" },
                maxItems: 4
              },
              poll_options_ru: {
                type: "array",
                items: { type: "string" },
                maxItems: 4
              }
            },
            required: ["topic", "topic_ru", "scope", "en", "ru", "poll_options_en", "poll_options_ru"],
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
    finalizePollPostText(row.content_type, rewritten.en, rewritten.poll_options_en, "en"),
    composeRuPayload(rewritten.topic_ru, finalizePollPostText(row.content_type, rewritten.ru, rewritten.poll_options_ru, "ru")),
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
      product_index INTEGER,
      product_image_url TEXT,
      product_pin TEXT,
      product_title TEXT,
      updated_at TEXT NOT NULL
    )
  `).run();

  // Step8g migration for existing D1 databases: remember the exact product
  // preview so "Без фото" can restore the choice buttons under that same
  // Telegram card instead of forcing a new preview message.
  await ensureD1Column(db, "content_media_previews", "product_index", "INTEGER");
  await ensureD1Column(db, "content_media_previews", "product_image_url", "TEXT");
  await ensureD1Column(db, "content_media_previews", "product_pin", "TEXT");
  await ensureD1Column(db, "content_media_previews", "product_title", "TEXT");

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS content_library_meta (
      post_id INTEGER PRIMARY KEY,
      favorite INTEGER NOT NULL DEFAULT 0,
      priority TEXT NOT NULL DEFAULT 'normal',
      tags TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      scheduled_at TEXT,
      schedule_status TEXT NOT NULL DEFAULT 'none',
      updated_at TEXT NOT NULL
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS content_ai_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      image_url TEXT NOT NULL,
      image_title TEXT,
      ai_check_status TEXT,
      ai_check_score INTEGER,
      ai_check_summary TEXT,
      ai_check_issues_json TEXT,
      created_at TEXT NOT NULL
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_content_ai_history_post ON content_ai_history(post_id, id DESC)`).run();

  // Step13: persist the automatic vision QA result for the latest preview and
  // every saved AI image. Existing D1 databases are migrated automatically.
  await ensureD1Column(db, "content_media_previews", "ai_check_status", "TEXT");
  await ensureD1Column(db, "content_media_previews", "ai_check_score", "INTEGER");
  await ensureD1Column(db, "content_media_previews", "ai_check_summary", "TEXT");
  await ensureD1Column(db, "content_media_previews", "ai_check_issues_json", "TEXT");
  await ensureD1Column(db, "content_ai_history", "ai_check_status", "TEXT");
  await ensureD1Column(db, "content_ai_history", "ai_check_score", "INTEGER");
  await ensureD1Column(db, "content_ai_history", "ai_check_summary", "TEXT");
  await ensureD1Column(db, "content_ai_history", "ai_check_issues_json", "TEXT");

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS facebook_metrics (
      post_id INTEGER PRIMARY KEY,
      reactions INTEGER NOT NULL DEFAULT 0,
      comments INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER,
      reach INTEGER,
      updated_at TEXT,
      last_error TEXT
    )
  `).run();
  await ensureD1Column(db, "facebook_metrics", "impressions", "INTEGER");
  await ensureD1Column(db, "facebook_metrics", "reach", "INTEGER");
}

async function ensureD1Column(db, table, column, definition) {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all();
  const rows = Array.isArray(info?.results) ? info.results : [];
  if (rows.some(row => String(row?.name || "") === column)) return;
  await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
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
    SELECT post_id, ai_image_url, ai_image_title, product_message_id, ai_message_id,
           product_index, product_image_url, product_pin, product_title,
           ai_check_status, ai_check_score, ai_check_summary, ai_check_issues_json, updated_at
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
    aiMessageId: patch.aiMessageId !== undefined ? (Number(patch.aiMessageId) || null) : (Number(current?.ai_message_id) || null),
    productIndex: patch.productIndex !== undefined ? Math.max(0, Number(patch.productIndex) || 0) : Math.max(0, Number(current?.product_index) || 0),
    productImageUrl: patch.productImageUrl !== undefined ? String(patch.productImageUrl || "") : String(current?.product_image_url || ""),
    productPin: patch.productPin !== undefined ? String(patch.productPin || "") : String(current?.product_pin || ""),
    productTitle: patch.productTitle !== undefined ? String(patch.productTitle || "") : String(current?.product_title || ""),
    aiCheckStatus: patch.aiCheckStatus !== undefined ? normalizeAiCheckStatus(patch.aiCheckStatus) : normalizeAiCheckStatus(current?.ai_check_status),
    aiCheckScore: patch.aiCheckScore !== undefined ? normalizeAiCheckScore(patch.aiCheckScore) : normalizeAiCheckScore(current?.ai_check_score),
    aiCheckSummary: patch.aiCheckSummary !== undefined ? String(patch.aiCheckSummary || "") : String(current?.ai_check_summary || ""),
    aiCheckIssuesJson: patch.aiCheckIssuesJson !== undefined ? String(patch.aiCheckIssuesJson || "[]") : String(current?.ai_check_issues_json || "[]")
  };
  const now = new Date().toISOString();
  await env.mosaic_marketing_bot_db.prepare(`
    INSERT INTO content_media_previews
      (post_id, ai_image_url, ai_image_title, product_message_id, ai_message_id,
       product_index, product_image_url, product_pin, product_title,
       ai_check_status, ai_check_score, ai_check_summary, ai_check_issues_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(post_id) DO UPDATE SET
      ai_image_url = excluded.ai_image_url,
      ai_image_title = excluded.ai_image_title,
      product_message_id = excluded.product_message_id,
      ai_message_id = excluded.ai_message_id,
      product_index = excluded.product_index,
      product_image_url = excluded.product_image_url,
      product_pin = excluded.product_pin,
      product_title = excluded.product_title,
      ai_check_status = excluded.ai_check_status,
      ai_check_score = excluded.ai_check_score,
      ai_check_summary = excluded.ai_check_summary,
      ai_check_issues_json = excluded.ai_check_issues_json,
      updated_at = excluded.updated_at
  `).bind(
    postId, next.aiImageUrl, next.aiImageTitle, next.productMessageId, next.aiMessageId,
    next.productIndex, next.productImageUrl, next.productPin, next.productTitle,
    next.aiCheckStatus, next.aiCheckScore, next.aiCheckSummary, next.aiCheckIssuesJson, now
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
    await saveMediaPreviewState(env, postId, {
      productMessageId: previewMessageId,
      productIndex: index,
      productImageUrl: imageUrl,
      productPin: product.pin,
      productTitle: product.title || product.pin
    });
  } else {
    const sent = await sendTelegramPhoto(env, imageUrl, caption, keyboard);
    if (sent?.messageId) {
      await saveMediaPreviewState(env, postId, {
        productMessageId: sent.messageId,
        productIndex: index,
        productImageUrl: imageUrl,
        productPin: product.pin,
        productTitle: product.title || product.pin
      });
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
  await saveMediaPreviewState(env, postId, {
    productMessageId: previewMessageId || undefined,
    productIndex: normalizedIndex,
    productImageUrl: imageUrl,
    productPin: product.pin,
    productTitle: product.title || product.pin
  });
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

  // "Без фото" means nothing is selected, not that the previews disappear.
  // Remove the selected checkmarks but keep both preview cards reusable by
  // restoring their choice buttons underneath.
  await restoreMediaPreviewChoices(env, postId, row);
  await refreshApprovedTelegramMessage(env, postId);
}

async function restoreMediaPreviewChoices(env, postId, row = null) {
  const state = await getMediaPreviewState(env, postId);
  if (!state) return;
  const post = row || await getPost(env, postId);

  if (state.product_message_id) {
    const index = Math.max(0, Number(state.product_index) || 0);
    const imageUrl = String(state.product_image_url || "").trim();
    const pin = String(state.product_pin || "").trim();
    const title = String(state.product_title || pin || "Фото товара").trim();
    const caption =
      `⬜ Фото товара не выбрано\n${title}` +
      (pin ? `\nPIN: ${pin}` : "") +
      `\n\nМожно выбрать снова или посмотреть другой вариант.`;

    if (imageUrl) {
      await editTelegramPhoto(
        env,
        state.product_message_id,
        imageUrl,
        caption,
        realPhotoKeyboard(postId, index)
      ).catch(() => {});
    } else {
      // Compatibility for previews created before Step8g metadata existed.
      await editTelegramPhotoCaption(
        env,
        state.product_message_id,
        "⬜ Фото товара не выбрано\nМожно снова выбрать фото товара.",
        { inline_keyboard: [[{ text: "📷 Выбрать фото", callback_data: `photo:${postId}` }]] }
      ).catch(() => {});
    }
  }

  if (state.ai_message_id) {
    const topic = String(post?.topic || "").trim();
    await editTelegramPhotoCaption(
      env,
      state.ai_message_id,
      `⬜ AI-изображение не выбрано для кандидата #${postId}` +
        (topic ? `\nТема: ${topic}` : "") +
        `\n\nМожно выбрать его снова или создать другое AI.`,
      aiPhotoKeyboard(postId)
    ).catch(() => {});
  }
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

  const aiCheck = await checkGeneratedAiImage(env, row, b64).catch(error => ({
    status: "warning",
    score: 50,
    summary: "Автоматическая vision-проверка не завершилась. Проверь изображение вручную.",
    issues: [String(error?.message || error || "Vision check unavailable").slice(0, 180)]
  }));

  const caption = buildAiPreviewCaption(row, postId, aiCheck);

  const sent = await sendTelegramPhotoBytes(
    env,
    bytes,
    `mosaic-post-${postId}.png`,
    caption,
    aiPhotoKeyboard(postId, aiCheck.status)
  );

  if (!sent.ok || !sent.fileId) {
    await sendTelegramText(env, `⚠️ Картинка создана, но Telegram не смог её принять для #${postId}.`);
    return;
  }

  const aiRef = `tgfile:${sent.fileId}`;
  const aiTitle = `AI: ${row.topic || `Post ${postId}`}`;
  await saveMediaPreviewState(env, postId, {
    aiImageUrl: aiRef,
    aiImageTitle: aiTitle,
    aiMessageId: sent.messageId || undefined,
    aiCheckStatus: aiCheck.status,
    aiCheckScore: aiCheck.score,
    aiCheckSummary: aiCheck.summary,
    aiCheckIssuesJson: JSON.stringify(aiCheck.issues || [])
  });
  await saveAiHistoryEntry(env, postId, aiRef, aiTitle, aiCheck).catch(() => {});
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
    return { ok: false, reason: "missing" };
  }
  const checkStatus = normalizeAiCheckStatus(preview.ai_check_status);
  if (checkStatus === "reject") {
    await sendTelegramText(env, `⛔ AI image check: REJECT для #${postId}. Этот вариант нельзя выбрать. Создай другой AI-вариант или используй реальное фото.`);
    return { ok: false, reason: "reject" };
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
      `${checkStatus === "warning" ? "⚠️" : "✅"} AI-изображение выбрано для кандидата #${postId}\n` +
      `AI image check: ${aiCheckLabel(checkStatus)}${preview.ai_check_score != null ? ` (${normalizeAiCheckScore(preview.ai_check_score)}/100)` : ""}\n` +
      `Тема: ${row.topic || ""}`,
      null
    );
  }
  await refreshApprovedTelegramMessage(env, postId);
  return { ok: true, warning: checkStatus === "warning" };
}


function normalizeAiCheckStatus(value) {
  const status = String(value || "unknown").toLowerCase().trim();
  return ["ok", "warning", "reject"].includes(status) ? status : "unknown";
}

function normalizeAiCheckScore(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function aiCheckLabel(status) {
  const normalized = normalizeAiCheckStatus(status);
  return normalized === "ok" ? "OK" : normalized === "warning" ? "WARNING" : normalized === "reject" ? "REJECT" : "UNKNOWN";
}

function aiCheckIcon(status) {
  const normalized = normalizeAiCheckStatus(status);
  return normalized === "ok" ? "✅" : normalized === "warning" ? "⚠️" : normalized === "reject" ? "⛔" : "❔";
}

function compactAiCheckText(value, max = 220) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function buildAiPreviewCaption(row, postId, aiCheck) {
  const status = normalizeAiCheckStatus(aiCheck?.status);
  const score = aiCheck?.score == null ? null : normalizeAiCheckScore(aiCheck.score);
  const summary = compactAiCheckText(aiCheck?.summary, 230);
  const issues = (Array.isArray(aiCheck?.issues) ? aiCheck.issues : []).map(x => compactAiCheckText(x, 120)).filter(Boolean).slice(0, 3);
  const issueText = issues.length ? `\nЗамечания:\n${issues.map(x => `• ${x}`).join("\n")}` : "";
  const lockText = status === "reject" ? "\n⛔ Выбор этого варианта заблокирован. Создай другое AI фото или используй реальное." : status === "warning" ? "\n⚠️ Можно выбрать только после ручной проверки." : "";
  return (
    `🖼 AI-изображение для кандидата #${postId}\n` +
    `Тема: ${row.topic || ""}\n` +
    `Тематика: ${themeRu(row.theme)}\n` +
    `Область: ${scopeRu(extractScopeFromSummary(row.research_summary_ru))}\n\n` +
    `${aiCheckIcon(status)} AI image check: ${aiCheckLabel(status)}${score == null ? "" : ` (${score}/100)`}\n` +
    `${summary || "Автоматическая оценка не дала пояснения."}${issueText}${lockText}\n\n` +
    `GPT Image 2, черновое качество low. Генерация выполняется только по нажатию кнопки.`
  ).slice(0, 1000);
}

async function checkGeneratedAiImage(env, row, b64) {
  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return { status:"warning", score:50, summary:"OPENAI_API_KEY недоступен для vision-проверки. Проверь изображение вручную.", issues:[] };
  }

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: AI_IMAGE_CHECK_MODEL,
      reasoning: { effort: "low" },
      input: [
        {
          role: "developer",
          content: [{
            type: "input_text",
            text:
              "You are a strict but fair visual QA reviewer for AI-generated editorial images used by a custom knife-making community. " +
              "Judge only what is visibly present. Do not invent hidden defects and do not reject because an unseen detail cannot be verified. " +
              "Prioritize physical plausibility, coherent tang/scale relationships, believable hole and pin placement, correct hardware type, and visual agreement with the post's main claim. " +
              "REJECT only for a clear serious problem: impossible or contradictory assembly geometry, obviously mismatched mating parts, duplicated or floating hardware, impossible intersections, clearly wrong main object/hardware for the topic, or a visual that materially contradicts the post. " +
              "WARNING for suspicious but not definitive geometry, minor AI artifacts near technical details, weak topic match, or an image that could mislead unless manually reviewed. " +
              "OK when the visible scene is physically plausible enough for an editorial social post and clearly supports the stated topic. " +
              "Cosmetic imperfections that do not affect technical meaning are not grounds for REJECT. " +
              "Score 0-100 where 100 means highly plausible and strongly topic-aligned. Keep summary and issues concise. Write summary and issues in Russian. Never use em dash or en dash characters in the returned text. Return structured JSON only."
          }]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                `Post topic: ${cleanPublicText(row?.topic)}\n` +
                `Theme: ${humanize(row?.theme)}\n` +
                `Scope: ${extractScopeFromSummary(row?.research_summary_ru)}\n` +
                `Post text: ${cleanPublicText(row?.en_text)}\n\n` +
                "Review the attached generated image for technical plausibility and topic match."
            },
            {
              type: "input_image",
              image_url: `data:image/png;base64,${b64}`,
              detail: "auto"
            }
          ]
        }
      ],
      max_output_tokens: 650,
      text: {
        format: {
          type: "json_schema",
          name: "mosaic_ai_image_qa",
          strict: true,
          schema: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["ok", "warning", "reject"] },
              score: { type: "integer", minimum: 0, maximum: 100 },
              summary: { type: "string" },
              issues: { type: "array", items: { type: "string" }, maxItems: 6 }
            },
            required: ["status", "score", "summary", "issues"],
            additionalProperties: false
          }
        }
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = safeApiError(data);
    return {
      status: "warning",
      score: 50,
      summary: "Автоматическая vision-проверка временно недоступна. Проверь изображение вручную.",
      issues: [compactAiCheckText(err.message || `OpenAI HTTP ${response.status}`, 180)]
    };
  }

  const raw = extractOutputText(data);
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
  if (!parsed || typeof parsed !== "object") {
    return {
      status: "warning",
      score: 50,
      summary: "Vision-проверка вернула неполный результат. Проверь изображение вручную.",
      issues: []
    };
  }

  return {
    status: normalizeAiCheckStatus(parsed.status) === "unknown" ? "warning" : normalizeAiCheckStatus(parsed.status),
    score: normalizeAiCheckScore(parsed.score),
    summary: compactAiCheckText(parsed.summary, 320),
    issues: (Array.isArray(parsed.issues) ? parsed.issues : []).map(x => compactAiCheckText(x, 180)).filter(Boolean).slice(0, 6)
  };
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
  const geometryGuardrails = buildTechnicalGeometryGuardrails(row);

  return (
    "Create a realistic editorial social-media image for an English-language custom knife-making community. " +
    `The exact post topic is: ${cleanPublicText(row.topic)}. ` +
    `The thematic area is: ${humanize(row.theme)}. ` +
    `The post says: ${cleanPublicText(row.en_text)}\n\n` +
    scopeInstruction + " " +
    visualInstruction + " " +
    geometryGuardrails + " " +
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

function buildTechnicalGeometryGuardrails(row) {
  const topic = cleanPublicText(row?.topic).toLowerCase();
  const text = cleanPublicText(row?.en_text).toLowerCase();
  const theme = String(row?.theme || "").toLowerCase();
  const haystack = `${topic} ${text} ${theme}`;
  const technical = /drill|drilling|hole|fit|fitting|clearance|alignment|epoxy|adhesive|glue|bond|joint|handle|scale|tang|pin|fastener|lanyard|polish|sanding|finish/.test(haystack);

  const base = (
    "PHYSICAL PLAUSIBILITY IS MORE IMPORTANT THAN DRAMA. Never invent extra holes, pins, screws, fasteners, slots, cutouts, or duplicate parts merely to make the image look technical. " +
    "Never show a blade blank or tang next to handle scales whose overall length, outline, front/rear shape, hole count, or hole positions obviously do not correspond. " +
    "If two handle scales are visible as a pair, they must read as a believable matching left/right pair. " +
    "If a pin or tube is shown aligned with a hole, the diameter and position must be mechanically plausible. " +
    "Avoid impossible intersections, floating hardware, warped straight edges, duplicated holes, and parts that could not physically assemble. "
  );

  if (!technical) {
    return base +
      " Prefer a finished assembled object or a simple isolated material detail rather than an exploded pseudo-engineering layout.";
  }

  return base +
    " For technical workshop topics, DO NOT use a full exploded knife assembly unless every mating part can be shown consistently. " +
    "When exact full-assembly geometry is not essential to the post, use a macro crop of ONE local feature, such as one hole and one pin, one joint line, one scratch, one tube opening, or one finished handle detail. " +
    "It is better to hide the rest of the knife outside the frame than to show contradictory geometry. " +
    "Do not present the AI image as an engineering drawing, dimensional reference, drilling template, or authoritative assembly diagram.";
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
      "Make the fit or drilling issue visually explicit using a MACRO VIEW of only the local relationship that matters: preferably one clearly formed hole and one matching pin/tube, or one small dry-fit interface. " +
      "Do not show a full blade blank plus full handle scales just to explain alignment. Do not invent a row of holes. Keep unrelated holes and the rest of the assembly outside the frame. " +
      "The viewer should understand the local fit idea without relying on a fake full-length technical layout."
    );
  }

  if (/epoxy|adhesive|glue|bond|joint/.test(haystack)) {
    return (
      "Make the adhesive-joint idea visually explicit with a tight macro of a believable joint line or two truly matching mating surfaces. " +
      "Avoid a full exploded knife assembly. The local surfaces must correspond physically, and no extra holes or hardware should appear unless the post actually discusses them. Do not merely show a bottle of epoxy."
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

  if (/handle design|handle material|handle materials|scale|scales|tang|finished knife|finished knives/.test(haystack)) {
    return (
      "Prefer a believable FINISHED ASSEMBLED HANDLE or an isolated handle-material sample. " +
      "Do not show full detached scales beside a blade/tang unless their outline, length and all visible hole positions match convincingly. " +
      "For a general handle topic, a finished handle close-up is safer and more credible than an exploded layout."
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

  const trust = researchTrustMeta(row);
  if (trust.lock) {
    await answerCallback(env, callbackId, "Публикация заблокирована: технический пост с низкой проверкой", true);
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

function aiPhotoKeyboard(postId, checkStatus = "unknown") {
  const status = normalizeAiCheckStatus(checkStatus);
  if (status === "reject") {
    return { inline_keyboard: [[{ text: "⛔ Reject, создать другое", callback_data: `ai_image:${postId}` }]] };
  }
  return {
    inline_keyboard: [
      [
        { text: status === "warning" ? "⚠️ Выбрать всё равно" : "✅ Выбрать", callback_data: `ai_select:${postId}` },
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

async function deleteTelegramMessage(env, messageId) {
  if (!messageId) return { ok: false };
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId) return { ok: false };

  const response = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId })
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


async function libraryCookieValue(env) {
  const secret = String(env.BOT_ADMIN_SECRET || "").trim();
  if (!secret) return "";
  const bytes = new TextEncoder().encode(`mosaic-library:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request, name) {
  const cookie = String(request.headers.get("cookie") || "");
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

async function isLibraryAuthorized(request, env) {
  const expected = await libraryCookieValue(env);
  if (!expected) return false;
  return cookieValue(request, "mb_library_auth") === expected;
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'self'; img-src 'self' https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    }
  });
}

function libraryLoginPage(hasError = false) {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mosaic Pins Content Library</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080d0b;color:#f4f7f5;font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:20px}.box{width:min(430px,100%);background:#101713;border:1px solid #26352d;border-radius:20px;padding:26px;box-shadow:0 20px 60px #0008}.brand{font-weight:800;font-size:22px}.sub{color:#aab7b0;margin:7px 0 22px}.error{background:#35191b;border:1px solid #6f3035;color:#ffd5d8;padding:10px 12px;border-radius:12px;margin-bottom:14px}label{display:block;font-size:13px;color:#b9c4be;margin-bottom:7px}input{width:100%;border:1px solid #34473d;background:#0b110e;color:white;border-radius:12px;padding:13px 14px;font-size:16px;outline:none}input:focus{border-color:#52ad70;box-shadow:0 0 0 3px #52ad7024}button{width:100%;margin-top:14px;border:0;border-radius:12px;padding:13px 16px;background:#2f9e58;color:white;font-weight:800;font-size:15px;cursor:pointer}.note{font-size:12px;color:#7f8e86;margin-top:16px}</style></head>
<body><form class="box" method="post" action="/library/login"><div class="brand">Mosaic Pins Content Library</div><div class="sub">Закрытый архив Marketing Bot</div>${hasError ? '<div class="error">Неверный BOT_ADMIN_SECRET</div>' : ''}<label for="secret">BOT_ADMIN_SECRET</label><input id="secret" name="secret" type="password" autocomplete="current-password" required autofocus><button type="submit">Войти</button><div class="note">Секрет не сохраняется в URL. В браузере остаётся только HttpOnly cookie с SHA-256 отпечатком.</div></form></body></html>`;
}

async function getLibraryRows(env) {
  await ensurePublishingTables(env);
  const result = await env.mosaic_marketing_bot_db.prepare(`
    SELECT
      p.id, p.created_at, p.updated_at, p.status, p.category, p.content_type, p.theme,
      p.topic, p.en_text, p.ru_text, p.research_summary_ru, p.source_json, p.rewrite_count,
      p.telegram_message_id,
      m.mode AS media_mode, m.image_url, m.image_pin, m.image_title,
      pr.ai_image_url AS preview_ai_image_url, pr.ai_image_title AS preview_ai_image_title,
      pr.ai_check_status AS preview_ai_check_status, pr.ai_check_score AS preview_ai_check_score,
      pr.ai_check_summary AS preview_ai_check_summary, pr.ai_check_issues_json AS preview_ai_check_issues_json,
      pr.product_index AS preview_product_index, pr.product_image_url AS preview_product_image_url,
      pr.product_pin AS preview_product_pin, pr.product_title AS preview_product_title,
      f.status AS facebook_status, f.facebook_post_id, f.published_at, f.last_error,
      lm.favorite, lm.priority, lm.tags, lm.note, lm.scheduled_at, lm.schedule_status,
      fm.reactions, fm.comments, fm.shares, fm.impressions, fm.reach, fm.updated_at AS metrics_updated_at, fm.last_error AS metrics_error
    FROM content_posts p
    LEFT JOIN content_media m ON m.post_id = p.id
    LEFT JOIN content_media_previews pr ON pr.post_id = p.id
    LEFT JOIN facebook_publications f ON f.post_id = p.id
    LEFT JOIN content_library_meta lm ON lm.post_id = p.id
    LEFT JOIN facebook_metrics fm ON fm.post_id = p.id
    ORDER BY p.created_at DESC
    LIMIT 400
  `).all();
  return Array.isArray(result?.results) ? result.results : [];
}

function libraryBucket(row) {
  if (String(row?.facebook_status || "") === "published") return "published";
  if (String(row?.status || "") === "skipped") return "archive";
  if (String(row?.status || "") === "approved") return "ready";
  return "candidate";
}

function libraryMediaLabel(row) {
  const mode = String(row?.media_mode || "unset");
  if (mode === "product") return row?.image_pin ? `Реальное фото · ${row.image_pin}` : "Реальное фото";
  if (mode === "ai") return "AI фото";
  if (mode === "none") return "Без фото";
  return "Медиа не выбрано";
}

function libraryMediaHtml(row) {
  const mode = String(row?.media_mode || "unset");
  if (mode === "product" && String(row?.image_url || "").startsWith("http")) {
    return `<img src="${escapeHtml(row.image_url)}" alt="${escapeHtml(row.image_title || row.topic || "Selected product photo")}" loading="lazy">`;
  }
  if (mode === "ai" && String(row?.image_url || "").startsWith("tgfile:")) {
    return `<img src="/library/media?id=${Number(row.id)}" alt="Selected AI image" loading="lazy">`;
  }
  if (mode === "none") return `<div class="media-empty"><span>🚫</span><b>Без фото</b></div>`;
  return `<div class="media-empty"><span>📷</span><b>Медиа не выбрано</b></div>`;
}

function libraryPreviewHtml(row) {
  const hasAi = String(row?.preview_ai_image_url || "").startsWith("tgfile:");
  if (!hasAi) return "";
  const status = normalizeAiCheckStatus(row?.preview_ai_check_status);
  const score = row?.preview_ai_check_score == null ? null : normalizeAiCheckScore(row.preview_ai_check_score);
  const summary = String(row?.preview_ai_check_summary || "").trim();
  const issues = safeJsonArray(row?.preview_ai_check_issues_json).slice(0, 4);
  const blocked = status === "reject";
  const check = `<div class="ai-check ${status}"><b>${aiCheckIcon(status)} AI image check: ${escapeHtml(aiCheckLabel(status))}${score == null ? "" : ` · ${score}/100`}</b>${summary ? `<span>${escapeHtml(summary)}</span>` : ""}${issues.length ? `<ul>${issues.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}</div>`;
  const select = blocked
    ? `<button class="action secondary disabled" disabled title="AI image check: Reject">⛔ Выбор заблокирован</button>`
    : `<button class="action secondary" data-action="ai_select" data-id="${Number(row.id)}">${status === "warning" ? "⚠️ Выбрать всё равно" : "✅ Выбрать AI"}</button>`;
  return `<div class="preview-box"><div class="preview-title">Последний AI вариант</div><img src="/library/preview-media?id=${Number(row.id)}" alt="AI preview" loading="lazy">${check}<div class="preview-actions">${select}<button class="action ghost" data-action="ai_generate" data-id="${Number(row.id)}">🔄 Другое AI</button></div></div>`;
}

function libraryDate(value) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit", timeZone:"Europe/Berlin" }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function libraryActionsHtml(row, bucket) {
  const id = Number(row.id);
  const deleteLabel = bucket === "published" ? "🗑 Удалить из панели" : "🗑 Удалить";
  const favorite = Number(row.favorite || 0) === 1;
  const common = `<div class="actions meta-actions"><button class="action favorite${favorite ? " active" : ""}" data-action="favorite" data-id="${id}">${favorite ? "★ В избранном" : "☆ В избранное"}</button></div>`;
  const deleteAction = `<div class="actions cleanup-actions"><button class="action delete" data-action="delete_post" data-id="${id}">${deleteLabel}</button></div>`;
  if (bucket === "candidate") {
    return `${common}<div class="actions"><button class="action primary" data-action="approve" data-id="${id}">✅ Принять</button><button class="action secondary" data-action="rewrite" data-id="${id}">🔄 Переписать</button><button class="action danger" data-action="skip" data-id="${id}">❌ Пропустить</button></div>${deleteAction}`;
  }
  if (bucket !== "ready") return `${common}${deleteAction}`;

  const mediaChosen = ["product","ai","none"].includes(String(row.media_mode || ""));
  const trustLocked = researchTrustMeta(row).lock;
  const canPublish = mediaChosen && !trustLocked;
  return `${common}<div class="actions media-actions"><button class="action secondary" data-action="product_picker" data-id="${id}">📷 Фото товара</button><button class="action secondary" data-action="ai_generate" data-id="${id}">🖼 AI фото</button>${libraryAiHistoryButtonHtml(row,bucket)}<button class="action ghost" data-action="no_photo" data-id="${id}">🚫 Без фото</button></div>
  <div class="actions publish-actions"><button class="action facebook${canPublish ? "" : " disabled"}" data-action="facebook_publish" data-id="${id}" ${canPublish ? "" : "disabled"} title="${trustLocked ? "Низкой проверки недостаточно для технической публикации" : mediaChosen ? "" : "Сначала выбери медиа или Без фото"}">🚀 Facebook</button>${trustLocked ? '<span class="publish-lock">⛔ Публикация заблокирована: технический пост с низкой проверкой</span>' : ""}</div>${deleteAction}`;
}

function researchConfidenceMeta(summary) {
  const text = String(summary || "");
  if (/Проверка:\s*высокая/i.test(text)) return { level: "high", label: "Проверка: высокая" };
  if (/Проверка:\s*средняя/i.test(text)) return { level: "medium", label: "Проверка: средняя" };
  if (/Проверка:\s*низкая/i.test(text)) return { level: "low", label: "Проверка: низкая" };
  return null;
}

function researchConfidenceBadgeHtml(row) {
  const meta = researchConfidenceMeta(row?.research_summary_ru);
  return meta ? `<span class="confidence ${meta.level}">${escapeHtml(meta.label)}</span>` : "";
}

function researchEvidenceBasis(summary) {
  const text = String(summary || "");
  const match = text.match(/(?:^|\n)Основание:\s*([^\n]+)/i);
  return match ? match[1].trim() : "";
}

function isTechnicalContentType(contentType) {
  return ["technical_tip", "common_mistake", "workshop_idea", "mini_guide"].includes(String(contentType || ""));
}

function researchTrustMeta(row) {
  const confidence = researchConfidenceMeta(row?.research_summary_ru) || { level: "unknown", label: "Проверка: не указана" };
  const sources = safeJsonArray(row?.source_json);
  const domains = uniqueDomains(sources);
  const basis = researchEvidenceBasis(row?.research_summary_ru);
  const technical = isTechnicalContentType(row?.content_type);
  let verdict = "Используй как аккуратно проверенную тему, но всё равно прочитай текст перед публикацией.";
  if (confidence.level === "high") {
    verdict = technical
      ? "Ключевой технический тезис хорошо подтверждён. Можно публиковать после обычной ручной проверки формулировки."
      : "Идея хорошо подтверждена несколькими сигналами. Можно публиковать после обычной ручной проверки.";
  } else if (confidence.level === "medium") {
    verdict = technical
      ? "Есть подтверждение, но практика может зависеть от материала и процесса. Оставляй формулировку осторожной и не превращай её в универсальное правило."
      : "Сигнал подтверждён не полностью. Лучше подавать как наблюдение, вопрос или практику, которая может различаться у мастеров.";
  } else if (confidence.level === "low") {
    verdict = technical
      ? "Стоп: низкой проверки недостаточно для технического совета. Такой пост нельзя публиковать как инструкцию."
      : "Это только идея для обсуждения. Не выдавай её за установленный технический факт.";
  }
  const lock = technical && confidence.level === "low";
  return { confidence, sources: sources.length, domains: domains.length, basis, verdict, lock };
}

function researchTrustHtml(row) {
  const trust = researchTrustMeta(row);
  const sourceText = trust.sources
    ? `Источников: ${trust.sources} · независимых доменов: ${trust.domains}`
    : "Список источников пока не сохранён";
  const basis = trust.basis || "Бот не записал отдельное основание для этого старого кандидата. Открой блок исследования и проверь заметку вручную.";
  return `<div class="trust trust-${trust.confidence.level}${trust.lock ? " trust-lock" : ""}">
    <div class="trust-head"><span>🛡 Почему этому можно доверять</span><span class="trust-level">${escapeHtml(trust.confidence.label)}</span></div>
    <div class="trust-grid"><div><b>Основание</b><span>${escapeHtml(basis)}</span></div><div><b>Источники</b><span>${escapeHtml(sourceText)}</span></div></div>
    <div class="trust-verdict">${trust.lock ? "⛔ " : trust.confidence.level === "medium" ? "⚠️ " : trust.confidence.level === "low" ? "⚠️ " : "✅ "}${escapeHtml(trust.verdict)}</div>
    <div class="trust-note">Это внутренний контроль качества, а не гарантия абсолютной точности.</div>
  </div>`;
}


function normalizeTopicWords(value) {
  const stop = new Set(["the","a","an","and","or","for","to","of","in","on","with","from","your","you","is","are","why","how","what","when","this","that","knife","knives","maker","makers","making"]);
  return String(value || "").toLowerCase().replace(/[^a-z0-9а-яё]+/gi," ").split(/\s+/).filter(w => w.length > 2 && !stop.has(w));
}

function topicSimilarity(a, b) {
  const aa = new Set(normalizeTopicWords(a));
  const bb = new Set(normalizeTopicWords(b));
  if (!aa.size || !bb.size) return 0;
  let inter = 0;
  for (const w of aa) if (bb.has(w)) inter++;
  const union = new Set([...aa, ...bb]).size;
  return union ? inter / union : 0;
}

function decorateDuplicateWarnings(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let best = null, bestScore = 0;
    for (let j = 0; j < rows.length; j++) {
      if (i === j) continue;
      const other = rows[j];
      if (Number(other.id) >= Number(row.id)) continue;
      const score = topicSimilarity(row.topic, other.topic);
      if (score > bestScore) { bestScore = score; best = other; }
    }
    if (best && bestScore >= 0.42) {
      row._duplicate = { id: Number(best.id), topic: String(best.topic || ""), score: bestScore };
    }
  }
  return rows;
}

function priorityMeta(value) {
  const key = ["high","normal","later"].includes(String(value || "")) ? String(value) : "normal";
  const map = { high:["Высокий","🔥"], normal:["Обычный","•"], later:["Позже","🕓"] };
  return { key, label: map[key][0], icon: map[key][1] };
}

function tagsArray(value) {
  return String(value || "").split(",").map(x => x.trim()).filter(Boolean).slice(0,12);
}

function librarySourceDetailsHtml(row) {
  const sources = safeJsonArray(row?.source_json).slice(0,18);
  if (!sources.length) return '<div class="source-empty">Ссылки на источники для этого кандидата не сохранены.</div>';
  const list = sources.map((source, index) => {
    let domain = "Источник";
    try { domain = prettyDomain(new URL(String(source.url || "")).hostname.replace(/^www\./,"")); } catch (_) {}
    const title = String(source.title || domain || `Источник ${index+1}`);
    const href = String(source.url || "");
    return `<a class="source-row" href="${escapeHtml(href)}" target="_blank" rel="noreferrer"><b>${escapeHtml(domain)}</b><span>${escapeHtml(title)}</span></a>`;
  }).join("");
  return `<div class="source-list">${list}</div>`;
}

function libraryFacebookPreviewHtml(row) {
  const ru = splitRuPayload(row.ru_text);
  const mode = String(row.media_mode || "unset");
  let image = "";
  if (mode === "product" && String(row.image_url || "").startsWith("http")) image = `<img src="${escapeHtml(row.image_url)}" alt="">`;
  if (mode === "ai" && String(row.image_url || "").startsWith("tgfile:")) image = `<img src="/library/media?id=${Number(row.id)}" alt="">`;
  return `<details class="fb-preview"><summary>👀 Preview Facebook</summary><div class="fbmock"><div class="fbhead"><span class="fbavatar">MP</span><div><b>Mosaic Pins Space</b><small>Just now · 🌐</small></div></div><div class="fbtext">${escapeHtml(row.en_text || "")}</div>${image}<div class="fbfooter">Like &nbsp; Comment &nbsp; Share</div></div></details>`;
}

function libraryMetaEditorHtml(row, bucket) {
  const id = Number(row.id);
  const ru = splitRuPayload(row.ru_text);
  const priority = priorityMeta(row.priority);
  const disabled = bucket === "published" ? " disabled" : "";
  const title = bucket === "published" ? "Опубликованный Facebook-пост не меняется. Метаданные библиотеки можно редактировать ниже." : "Редактирование сохранит текст в D1 и синхронизирует Telegram.";
  return `<details class="editor"><summary>✏️ Редактировать и заметки</summary><div class="editgrid" data-editor="${id}">
    <label>Тема EN<input class="ed-topic" value="${escapeHtml(row.topic || "")}"${disabled}></label>
    <label>Тема RU<input class="ed-topic-ru" value="${escapeHtml(ru.topic || "")}"${disabled}></label>
    <label class="wide">Facebook EN<textarea class="ed-en" rows="7"${disabled}>${escapeHtml(row.en_text || "")}</textarea></label>
    <label class="wide">Проверка RU<textarea class="ed-ru" rows="7"${disabled}>${escapeHtml(ru.body || "")}</textarea></label>
    <label>Теги<input class="ed-tags" value="${escapeHtml(row.tags || "")}" placeholder="Glow, Epoxy, Beginner"></label>
    <label>Приоритет<select class="ed-priority"><option value="high"${priority.key==="high"?" selected":""}>🔥 Высокий</option><option value="normal"${priority.key==="normal"?" selected":""}>Обычный</option><option value="later"${priority.key==="later"?" selected":""}>🕓 Позже</option></select></label>
    <label class="wide">Личная заметка<textarea class="ed-note" rows="3" placeholder="Только для себя">${escapeHtml(row.note || "")}</textarea></label>
    <div class="wide edit-help">${escapeHtml(title)}</div>
    <div class="wide actions"><button class="action primary" data-action="save_edit" data-id="${id}">💾 Сохранить</button></div>
  </div></details>`;
}

function libraryScheduleHtml(row, bucket) {
  if (bucket !== "ready") return "";
  const id = Number(row.id);
  const scheduled = String(row.schedule_status || "") === "scheduled" && row.scheduled_at;
  const when = scheduled ? libraryDate(row.scheduled_at) : "";
  return `<div class="schedule"><div><b>📅 Очередь публикаций</b>${scheduled ? `<span class="scheduled-badge">Запланировано: ${escapeHtml(when)}</span>` : '<span class="schedule-note">Можно опубликовать автоматически по расписанию</span>'}</div><div class="schedule-row"><input type="datetime-local" class="schedule-at" data-id="${id}"><button class="action secondary" data-action="schedule" data-id="${id}">📅 Запланировать</button>${scheduled ? `<button class="action ghost" data-action="cancel_schedule" data-id="${id}">Отменить</button>` : ""}</div></div>`;
}

function libraryMetricsHtml(row, bucket) {
  if (bucket !== "published") return "";
  const id = Number(row.id);
  return `<div class="metrics"><div><b>📊 Facebook</b><span>Реакции <strong>${Number(row.reactions || 0)}</strong></span><span>Комментарии <strong>${Number(row.comments || 0)}</strong></span><span>Репосты <strong>${Number(row.shares || 0)}</strong></span><span>Охват <strong>${row.reach == null ? "—" : Number(row.reach)}</strong></span><span>Показы <strong>${row.impressions == null ? "—" : Number(row.impressions)}</strong></span></div><button class="action ghost" data-action="refresh_metrics" data-id="${id}">↻ Обновить</button>${row.metrics_updated_at ? `<small>${escapeHtml(libraryDate(row.metrics_updated_at))}</small>` : ""}${row.reach == null ? '<small title="Для охвата и показов Meta может потребовать read_insights">Insights могут потребовать доп. право Meta</small>' : ""}</div>`;
}

function libraryDuplicateHtml(row, bucket) {
  if (!row?._duplicate || !["candidate","ready"].includes(bucket)) return "";
  const d = row._duplicate;
  const pct = Math.round(Number(d.score || 0) * 100);
  return `<div class="duplicate">⚠️ Похожая тема уже была в #${Number(d.id)} (${pct}%): <b>${escapeHtml(d.topic)}</b>${bucket === "candidate" ? `<button class="action ghost" data-action="angle_rewrite" data-id="${Number(row.id)}">↪ Другой угол</button>` : ""}</div>`;
}

function libraryAiHistoryButtonHtml(row, bucket) {
  if (bucket !== "ready") return "";
  return `<button class="action ghost" data-action="ai_history" data-id="${Number(row.id)}">🖼 История AI</button>`;
}

function libraryCard(row) {
  const ru = splitRuPayload(row.ru_text);
  const bucket = libraryBucket(row);
  const titleRu = ru.topic || "";
  const tags = tagsArray(row.tags);
  const priority = priorityMeta(row.priority);
  const search = [row.id,row.topic,titleRu,row.en_text,ru.body,row.content_type,row.theme,row.image_pin,row.image_title,row.preview_product_pin,row.preview_product_title,row.tags,row.note].join(" ").toLowerCase();
  const facebookMeta = bucket === "published"
    ? `<span class="facebook-ok">Facebook · ${escapeHtml(libraryDate(row.published_at))}</span>`
    : row.facebook_status === "failed"
      ? `<span class="facebook-fail" title="${escapeHtml(row.last_error || "")}">Ошибка Facebook</span>`
      : "";
  const tagHtml = tags.length ? `<div class="tagline">${tags.map(t=>`<span>#${escapeHtml(t)}</span>`).join("")}</div>` : "";
  return `<article class="card" data-bucket="${bucket}" data-favorite="${Number(row.favorite||0)===1?"1":"0"}" data-search="${escapeHtml(search)}" id="post-${Number(row.id)}">
    <div class="selectbox"><input type="checkbox" class="bulk-check" value="${Number(row.id)}" aria-label="Выбрать #${Number(row.id)}"></div>
    <div class="media">${libraryMediaHtml(row)}<div class="media-label">${escapeHtml(libraryMediaLabel(row))}</div></div>
    <div class="body">
      <div class="topline"><span class="id">#${Number(row.id)}</span><span>${escapeHtml(contentTypeRu(row.content_type))}</span><span>${escapeHtml(themeRu(row.theme))}</span><span class="priority ${priority.key}">${priority.icon} ${escapeHtml(priority.label)}</span>${Number(row.favorite||0)===1?'<span class="fav-badge">★</span>':""}</div>
      <h2>${escapeHtml(titleRu || row.topic || `Post #${row.id}`)}</h2>
      ${titleRu && row.topic ? `<div class="en-topic">${escapeHtml(row.topic)}</div>` : ""}
      ${tagHtml}
      <div class="statusline"><span class="status ${bucket}">${bucket === "ready" ? "Готов к публикации" : bucket === "published" ? "Опубликовано" : bucket === "archive" ? "Архив" : "Кандидат"}</span>${researchConfidenceBadgeHtml(row)}${facebookMeta}<span class="date">${escapeHtml(libraryDate(row.created_at))}</span></div>
      ${libraryDuplicateHtml(row,bucket)}
      <div class="posttext">${escapeHtml(row.en_text || "")}</div>
      ${researchTrustHtml(row)}
      <details class="sources"><summary>🔎 Показать источники</summary>${librarySourceDetailsHtml(row)}</details>
      ${libraryActionsHtml(row, bucket)}
      ${libraryScheduleHtml(row,bucket)}
      ${libraryMetricsHtml(row,bucket)}
      ${bucket === "ready" ? libraryPreviewHtml(row) : ""}
      ${libraryFacebookPreviewHtml(row)}
      ${libraryMetaEditorHtml(row,bucket)}
      <details><summary>Русская версия</summary><div class="ru-text">${escapeHtml(ru.body || "")}</div></details>
      <details><summary>Исследование и данные</summary><div class="research">${escapeHtml(stripScopePrefix(row.research_summary_ru) || "Нет заметки")}</div><div class="mini">Rewrite: ${Number(row.rewrite_count || 0)} · Media: ${escapeHtml(row.media_mode || "unset")}${row.facebook_post_id ? ` · FB ID: ${escapeHtml(row.facebook_post_id)}` : ""}</div></details>
    </div>
  </article>`;
}

async function renderContentLibrary(env) {
  if (!env.mosaic_marketing_bot_db) return html("D1 is not configured", 500);
  const rows = decorateDuplicateWarnings(await getLibraryRows(env));
  const counts = { ready:0, published:0, archive:0, candidate:0, favorites:0 };
  for (const row of rows) { counts[libraryBucket(row)]++; if (Number(row.favorite || 0) === 1) counts.favorites++; }
  const cards = rows.map(libraryCard).join("");
  const published10 = rows.filter(row => libraryBucket(row) === "published").slice(0,10);
  const balance = {};
  for (const row of published10) balance[row.content_type] = (balance[row.content_type] || 0) + 1;
  const balanceHtml = Object.entries(balance).map(([key,value]) => `<span>${escapeHtml(contentTypeRu(key))} <b>${Number(value)}</b></span>`).join("") || '<span>Пока нет опубликованных постов</span>';
  const upcoming = rows.filter(row => String(row.schedule_status||"") === "scheduled" && row.scheduled_at).sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at)).slice(0,6);
  const upcomingHtml = upcoming.length ? upcoming.map(row => `<span><b>#${Number(row.id)}</b> ${escapeHtml(libraryDate(row.scheduled_at))} · ${escapeHtml(splitRuPayload(row.ru_text).topic || row.topic)}</span>`).join("") : '<span>Очередь пока пустая</span>';
  const history = await getRecentHistory(env, 30);
  const next = chooseRotation(history);
  const fbReady = has(env.FACEBOOK_PAGE_ID) && has(env.FACEBOOK_PAGE_ACCESS_TOKEN);
  return html(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mosaic Pins Marketing Dashboard</title>
<style>
:root{color-scheme:dark;--bg:#08100c;--panel:#101914;--panel2:#141f19;--line:#29392f;--muted:#92a198;--text:#f3f7f4;--green:#38a75c;--green2:#256f41;--danger:#7b3439;--blue:#245f9b}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#07100b,#0a0f0c 420px);color:var(--text);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}.wrap{max-width:1240px;margin:auto;padding:22px}.header{display:flex;gap:16px;align-items:center;justify-content:space-between;margin-bottom:16px}.title{font-size:26px;font-weight:900;letter-spacing:-.02em}.subtitle{color:var(--muted);margin-top:2px}.head-actions{display:flex;gap:8px;align-items:center}.logout{background:transparent;color:#cbd6d0;border:1px solid var(--line);border-radius:10px;padding:9px 12px;cursor:pointer}.create{border:1px solid #58b979;background:linear-gradient(180deg,#2e9250,#236f3e);color:white;border-radius:14px;padding:14px 28px;font-weight:900;font-size:16px;letter-spacing:.01em;cursor:pointer;box-shadow:0 10px 26px #1e7d4140,0 0 0 1px #ffffff0a inset}.create:hover{filter:brightness(1.08);transform:translateY(-1px)}.new-topic-row{display:flex;justify-content:center;padding:12px 0 2px}.new-topic-row .create{width:min(360px,100%)}.editorial{max-width:980px;margin:0 auto 14px;background:linear-gradient(180deg,#101914,#0d1711);border:1px solid #2d4436;border-radius:14px;padding:11px 14px;color:#aebdb4;font-size:12px}.editorial b{color:#dcebe2}.confidence{border-radius:999px;padding:4px 8px;font-weight:800}.confidence.high{background:#123b24;color:#9fe8b5}.confidence.medium{background:#423518;color:#f0d68d}.confidence.low{background:#4b2429;color:#ffb9bd}.trust{margin-top:13px;border:1px solid #2f4437;background:#0d1711;border-radius:13px;padding:11px 12px}.trust-high{border-color:#28583a;background:#0d1d13}.trust-medium{border-color:#66542a;background:#1b180d}.trust-low,.trust-unknown{border-color:#643238;background:#1d1012}.trust-lock{box-shadow:0 0 0 1px #7f343c44 inset}.trust-head{display:flex;gap:10px;align-items:center;justify-content:space-between;font-weight:900;color:#e9f4ed;margin-bottom:9px}.trust-level{font-size:10px;border:1px solid #ffffff1d;border-radius:999px;padding:3px 7px;color:#b7c5bd;white-space:nowrap}.trust-grid{display:grid;grid-template-columns:1.45fr .8fr;gap:10px}.trust-grid>div{background:#09120d;border:1px solid #25362c;border-radius:10px;padding:8px 9px}.trust-grid b{display:block;color:#93a59a;text-transform:uppercase;letter-spacing:.04em;font-size:9px;margin-bottom:3px}.trust-grid span{display:block;color:#d9e4dd;font-size:11px}.trust-verdict{margin-top:9px;color:#dbe6df;font-size:11px;line-height:1.45}.trust-note{margin-top:6px;color:#71837a;font-size:9px}.publish-lock{align-self:center;color:#ffb2b7;font-size:11px;font-weight:800}.rotation{background:#101914;border:1px solid var(--line);border-radius:14px;padding:10px 13px;margin-bottom:12px;color:#b7c3bc;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.rotation b{color:#e8f3ec}.dot{color:#607168}.toolbar{position:sticky;top:0;z-index:5;background:#08100ce8;backdrop-filter:blur(14px);padding:10px 0 14px;margin-bottom:10px}.tabs{display:flex;gap:8px;overflow:auto;padding-bottom:8px}.tab{white-space:nowrap;border:1px solid var(--line);background:#101914;color:#c6d1cb;border-radius:999px;padding:9px 13px;cursor:pointer}.tab.active{background:var(--green2);border-color:#3f9b61;color:#fff}.search{width:100%;background:#0e1712;border:1px solid var(--line);color:white;border-radius:12px;padding:12px 14px;font-size:15px;outline:none}.search:focus{border-color:#4baa69;box-shadow:0 0 0 3px #4baa6920}.grid{display:grid;grid-template-columns:1fr;gap:14px;max-width:980px;margin:0 auto}.card{display:grid;grid-template-columns:230px minmax(0,1fr);min-height:0;background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 12px 35px #0003}.card.focused{border-color:#58b979;box-shadow:0 0 0 3px #38a75c30,0 14px 42px #0005;transition:border-color .25s,box-shadow .25s}.media{background:#0b130f;min-height:0;padding:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;border-right:1px solid #203027}.media img{width:auto;height:auto;max-width:100%;max-height:250px;object-fit:contain;display:block;border-radius:12px}.media-empty{width:100%;min-height:180px;display:grid;place-items:center;align-content:center;gap:8px;color:#819188}.media-empty span{font-size:34px}.media-label{position:static;width:100%;margin-top:10px;background:#07110d;border:1px solid #ffffff1f;border-radius:9px;padding:6px 8px;font-size:11px;color:#dbe5df;text-align:center}.body{padding:16px;min-width:0}.topline{display:flex;gap:7px;flex-wrap:wrap;color:#93a59a;font-size:11px}.topline span{background:#17241d;border:1px solid #293a30;border-radius:999px;padding:3px 7px}.topline .id{color:#bceac9;border-color:#31553e}h2{font-size:18px;line-height:1.25;margin:11px 0 4px}.en-topic{color:#9eaca4;font-size:12px;margin-bottom:10px}.statusline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:9px 0 12px;font-size:11px}.status{border-radius:999px;padding:4px 8px;font-weight:800}.status.ready{background:#143d23;color:#aaf0bc}.status.published{background:#17304d;color:#b8dafb}.status.archive{background:#3a2525;color:#efbbbb}.status.candidate{background:#3b341d;color:#f2de9c}.facebook-ok{color:#9dd7ad}.facebook-fail{color:#ffaaaa}.date{color:#77877e;margin-left:auto}.posttext,.ru-text,.research{white-space:pre-wrap;color:#e8eeea}.posttext{display:-webkit-box;-webkit-line-clamp:7;-webkit-box-orient:vertical;overflow:hidden}.actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.action{border:1px solid #34483c;border-radius:10px;padding:8px 10px;font-size:12px;font-weight:800;cursor:pointer;background:#17231c;color:#e6eee9}.action.primary{background:#236d3d;border-color:#398858}.action.secondary{background:#183526;border-color:#315b40}.action.ghost{background:#111a15}.action.danger{background:#492329;border-color:#70383e}.action.facebook{background:#1e5c93;border-color:#3179b9}.action.delete{background:#241416;border-color:#66343a;color:#ffc6ca}.action.delete:hover{background:#351b1f;border-color:#8b454d}.cleanup-actions{margin-top:10px;padding-top:8px;border-top:1px dashed #2b3931}.action.disabled,.action:disabled{opacity:.4;cursor:not-allowed}.action.busy,.create.busy{opacity:.55;pointer-events:none}.ai-check{margin-top:10px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:grid;gap:5px;font-size:12px}.ai-check b{font-size:13px}.ai-check span{color:#c0cbc5}.ai-check ul{margin:2px 0 0 18px;padding:0;color:#aebbb4}.ai-check.ok{border-color:#2f7047;background:#10291a}.ai-check.warning{border-color:#7a6128;background:#2d2614}.ai-check.reject{border-color:#873f45;background:#321719}.ai-check.unknown{background:#151c18}.ai-history-check{font-size:12px;display:grid;gap:4px}.ai-history-check.ok{color:#9fe8b5}.ai-history-check.warning{color:#f0d68d}.ai-history-check.reject{color:#ffb3b8}.ai-history-check.unknown{color:#aab7b0}.preview-box{margin-top:12px;border:1px solid #31463a;background:#0c1510;border-radius:13px;padding:10px}.preview-title{font-size:11px;color:#9cacA2;font-weight:800;margin-bottom:7px}.preview-box img{width:auto;height:auto;max-width:100%;max-height:280px;object-fit:contain;border-radius:10px;display:block;margin:0 auto}.preview-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}details{margin-top:11px;border-top:1px solid #24332a;padding-top:9px}summary{cursor:pointer;color:#a8b8ae;font-weight:700}.ru-text,.research{margin-top:9px;color:#cbd5cf}.mini{margin-top:8px;color:#76867d;font-size:11px}.empty{display:none;padding:50px 10px;text-align:center;color:#89998f}.foot{padding:28px 0 10px;color:#718078;text-align:center;font-size:12px}.toast{position:fixed;right:18px;bottom:18px;z-index:30;max-width:min(420px,calc(100vw - 36px));background:#152019;border:1px solid #3d5949;color:#eef6f1;border-radius:12px;padding:11px 14px;box-shadow:0 18px 50px #0008;display:none}.toast.error{background:#35191b;border-color:#713239;color:#ffd9db}.modal{position:fixed;inset:0;z-index:20;background:#000a;display:none;align-items:flex-start;justify-content:center;padding:6vh 16px 30px;overflow:auto}.modal.open{display:flex}.modal-box{width:min(980px,100%);background:#101914;border:1px solid #304238;border-radius:18px;padding:16px;box-shadow:0 24px 80px #000b}.modal-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:13px}.modal-head h3{margin:0;font-size:19px}.close{border:1px solid #33483c;background:#151f19;color:#dce5df;border-radius:9px;padding:7px 10px;cursor:pointer}.products{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.product-option{background:#0b130f;border:1px solid #293a30;border-radius:13px;overflow:hidden}.product-option img{width:100%;height:180px;object-fit:contain;display:block;background:#08100c;padding:8px}.product-option .po-body{padding:10px}.po-title{font-weight:800;line-height:1.25}.po-meta{color:#8fa096;font-size:11px;margin:4px 0 8px}.product-option button{width:100%}.loader{padding:35px;text-align:center;color:#aab8b0}.dashboard-widgets{max-width:980px;margin:0 auto 12px;display:grid;grid-template-columns:1fr 1fr;gap:10px}.widget{background:#0f1813;border:1px solid #2b3b31;border-radius:14px;padding:11px 13px}.widget>b{font-size:11px;color:#dbe7df}.widget-pills,.upcoming{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}.widget-pills span,.upcoming span{font-size:10px;color:#9fb0a6;background:#0a120e;border:1px solid #26362c;border-radius:999px;padding:4px 7px}.upcoming{display:grid}.upcoming span{border-radius:8px}.selectbox{position:absolute;z-index:3;margin:10px}.card{position:relative}.bulk-check{width:18px;height:18px;accent-color:#38a75c}.bulkbar{display:none;align-items:center;gap:7px;flex-wrap:wrap;margin-top:9px;padding:8px 10px;background:#121d16;border:1px solid #304238;border-radius:11px}.bulkbar.show{display:flex}.bulkbar span{margin-right:auto;color:#b9c8bf}.priority.high{border-color:#8a4b2c!important;color:#ffd0ae!important}.priority.later{color:#b5b5d2!important}.fav-badge{color:#ffd76b!important}.action.favorite.active{border-color:#8a7130;background:#392f17;color:#ffe499}.tagline{display:flex;gap:5px;flex-wrap:wrap;margin:6px 0}.tagline span{font-size:10px;color:#9ccbb0;background:#0d2116;border:1px solid #275038;border-radius:999px;padding:3px 6px}.duplicate{margin:8px 0;border:1px solid #6b5427;background:#201a0c;color:#e9d89c;border-radius:11px;padding:9px 10px;font-size:11px}.duplicate .action{margin-left:7px;padding:5px 7px}.sources{border-top:0!important}.source-list{display:grid;gap:6px;margin-top:9px}.source-row{display:grid;gap:2px;color:#d7e4dc;text-decoration:none;background:#0b130f;border:1px solid #293a30;border-radius:9px;padding:8px 9px}.source-row:hover{border-color:#4b7b5d}.source-row b{font-size:10px;color:#8ecda4}.source-row span{font-size:11px}.source-empty{color:#819188;padding:8px 0}.editor{border:1px solid #2b3d32!important;border-radius:12px;padding:9px 10px!important;background:#0c1510}.editgrid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:10px}.editgrid label{display:grid;gap:5px;color:#9fb0a6;font-size:10px;font-weight:700}.editgrid .wide{grid-column:1/-1}.editgrid input,.editgrid textarea,.editgrid select,.schedule-row input{width:100%;background:#09110d;color:#eef5f0;border:1px solid #32453a;border-radius:9px;padding:9px;font:12px/1.45 system-ui}.editgrid textarea{resize:vertical}.edit-help{font-size:10px;color:#71837a}.schedule{margin-top:11px;border:1px solid #32463a;background:#0c1610;border-radius:12px;padding:10px}.schedule>div:first-child{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.schedule-note{font-size:10px;color:#84968b}.scheduled-badge{font-size:10px;background:#183622;color:#a9eabc;border-radius:999px;padding:3px 7px}.schedule-row{display:grid;grid-template-columns:minmax(180px,1fr) auto auto;gap:7px;margin-top:8px}.metrics{margin-top:11px;border:1px solid #27445e;background:#0c1720;border-radius:12px;padding:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.metrics>div{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-right:auto}.metrics span{font-size:10px;color:#a9c5da}.metrics small{color:#6d8799}.fb-preview{border:1px solid #2b3c34!important;border-radius:12px;padding:9px 10px!important}.fbmock{max-width:520px;margin:10px auto 0;background:#18191a;border:1px solid #303234;border-radius:12px;overflow:hidden;color:#e4e6eb}.fbhead{display:flex;gap:9px;padding:12px;align-items:center}.fbavatar{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#274f35;font-weight:900}.fbhead small{display:block;color:#b0b3b8}.fbtext{padding:0 12px 12px;white-space:pre-wrap}.fbmock>img{width:100%;max-height:360px;object-fit:contain;background:#0c0c0c}.fbfooter{border-top:1px solid #3a3b3c;padding:9px;text-align:center;color:#b0b3b8}.ai-history-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.ai-history-item{border:1px solid #2e4136;border-radius:12px;background:#0a120e;padding:8px}.ai-history-item img{width:100%;height:160px;object-fit:contain;background:#070b09;border-radius:8px}.ai-history-item small{display:block;color:#82938a;margin:5px 0}.ai-history-item button{width:100%}.modal-box.small{width:min(720px,100%)}@media(max-width:900px){.grid{max-width:100%}.card{grid-template-columns:200px minmax(0,1fr)}.media img{max-height:220px}.products{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.dashboard-widgets{grid-template-columns:1fr}.editgrid{grid-template-columns:1fr}.editgrid .wide{grid-column:auto}.schedule-row{grid-template-columns:1fr}.ai-history-grid{grid-template-columns:1fr 1fr}.wrap{padding:14px}.header{align-items:flex-start}.head-actions{flex-direction:column;align-items:stretch}.title{font-size:22px}.card{display:block}.media{padding:12px;border-right:0;border-bottom:1px solid #203027}.media img{max-height:220px}.media-empty{min-height:150px}.body{padding:14px}.date{margin-left:0}.toolbar{top:0}.posttext{-webkit-line-clamp:9}.products{grid-template-columns:1fr}.product-option img{height:210px}.rotation{font-size:12px}.new-topic-row{padding-top:10px}.new-topic-row .create{font-size:15px;padding:13px 18px}.trust-grid{grid-template-columns:1fr}.trust-head{align-items:flex-start;flex-direction:column;gap:5px}}
</style></head>
<body><div class="wrap"><header class="header"><div><div class="title">Mosaic Pins Marketing Dashboard</div><div class="subtitle">Темы, фото, согласование и публикация Facebook в одном месте</div></div><div class="head-actions"><form method="post" action="/library/logout"><button class="logout">Выйти</button></form></div></header>
<div class="rotation"><span>Следующая ротация:</span><b>${escapeHtml(contentTypeRu(next.contentType))}</b><span class="dot">·</span><b>${escapeHtml(themeRu(next.theme))}</b><span class="dot">·</span><span>Facebook ${fbReady ? "подключён ✅" : "не подключён"}</span></div>
<div class="dashboard-widgets"><div class="widget"><b>🎯 Баланс последних 10 постов</b><div class="widget-pills">${balanceHtml}</div></div><div class="widget"><b>📅 Ближайшие публикации</b><div class="upcoming">${upcomingHtml}</div></div></div>
<div class="editorial"><b>Наш подход:</b> Mosaic Pins Space не изображает из себя гуру. Бот использует обсуждения для поиска тем, а технические советы публикует только после дополнительной проверки. Слабые или спорные сигналы должны превращаться в вопрос, наблюдение или обсуждение, а не в уверенную инструкцию.</div>
<div class="toolbar"><div class="tabs"><button class="tab active" data-tab="ready">Готово · ${counts.ready}</button><button class="tab" data-tab="published">Опубликовано · ${counts.published}</button><button class="tab" data-tab="candidate">Кандидаты · ${counts.candidate}</button><button class="tab" data-tab="archive">Архив · ${counts.archive}</button><button class="tab" data-tab="favorites">★ Избранное · ${counts.favorites}</button><button class="tab" data-tab="all">Все · ${rows.length}</button></div><input id="search" class="search" type="search" placeholder="Поиск по теме, тексту, PIN, тегам или заметкам..." autocomplete="off"><div class="bulkbar" id="bulkbar"><span>Выбрано: <b id="bulkCount">0</b></span><button class="action ghost" id="bulkArchive">В архив</button><button class="action delete" id="bulkDelete">Удалить</button><button class="action ghost" id="bulkClear">Снять выбор</button></div><div class="new-topic-row"><button id="newTopic" class="create">✨ Создать новую тему</button></div></div>
<main id="grid" class="grid">${cards}</main><div id="empty" class="empty">Ничего не найдено</div><div class="foot">Один D1 и одна логика для Telegram и веб-панели. AI фото создаётся только по нажатию.</div></div>
<div id="productModal" class="modal"><div class="modal-box"><div class="modal-head"><h3>Выбрать реальное фото товара</h3><button id="closeModal" class="close">Закрыть</button></div><div id="products" class="products"><div class="loader">Загрузка…</div></div></div></div>
<div class="modal" id="aiModal"><div class="modal-box small"><div class="modal-head"><h3>🖼 История AI</h3><button class="close" id="closeAiModal">Закрыть</button></div><div class="ai-history-grid" id="aiHistory"><div class="loader">Загрузка…</div></div></div></div><div id="toast" class="toast"></div>
<script>(()=>{
const tabs=[...document.querySelectorAll('.tab')],cards=[...document.querySelectorAll('.card')],search=document.getElementById('search'),empty=document.getElementById('empty'),toast=document.getElementById('toast'),modal=document.getElementById('productModal'),products=document.getElementById('products'),aiModal=document.getElementById('aiModal'),aiHistory=document.getElementById('aiHistory'),bulkbar=document.getElementById('bulkbar'),bulkCount=document.getElementById('bulkCount');let bucket='ready',modalPostId=0;
function apply(){const q=search.value.trim().toLowerCase();let shown=0;for(const card of cards){const okBucket=bucket==='all'||(bucket==='favorites'?card.dataset.favorite==='1':card.dataset.bucket===bucket);const okSearch=!q||card.dataset.search.includes(q);const show=okBucket&&okSearch;card.style.display=show?'':'none';if(show)shown++}empty.style.display=shown?'none':'block'}
function say(text,error=false){toast.textContent=text;toast.className='toast'+(error?' error':'');toast.style.display='block';clearTimeout(window.__toastTimer);window.__toastTimer=setTimeout(()=>toast.style.display='none',4200)}
async function action(actionName,id=0,extra={}){const res=await fetch('/library/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:actionName,id,...extra})});const data=await res.json().catch(()=>({ok:false,error:'Некорректный ответ'}));if(!res.ok||!data.ok)throw new Error(data.error||'Ошибка');return data}
async function runButton(btn,actionName,id,extra={},returnTab=''){const old=btn.textContent;btn.classList.add('busy');btn.textContent='Подождите…';try{const data=await action(actionName,id,extra);say(data.message||'Готово');setTimeout(()=>{if(returnTab){location.href='/library?tab='+encodeURIComponent(returnTab)}else{location.reload()}},350)}catch(e){say(e.message||'Ошибка',true);btn.classList.remove('busy');btn.textContent=old}}
for(const tab of tabs){tab.addEventListener('click',()=>{for(const x of tabs)x.classList.remove('active');tab.classList.add('active');bucket=tab.dataset.tab;apply()})}search.addEventListener('input',apply);
document.getElementById('newTopic').addEventListener('click',async e=>{const btn=e.currentTarget,old=btn.textContent;btn.classList.add('busy');btn.textContent='Создаю тему…';try{const data=await action('new',0);say(data.message||'Новый кандидат создан');const id=Number(data.id||0);if(id>0){setTimeout(()=>{location.href='/library?tab=candidate&focus='+encodeURIComponent(id)+'#post-'+encodeURIComponent(id)},250)}else setTimeout(()=>location.reload(),350)}catch(err){say(err.message||'Ошибка',true);btn.classList.remove('busy');btn.textContent=old}});
function updateBulk(){const n=document.querySelectorAll('.bulk-check:checked').length;bulkCount.textContent=String(n);bulkbar.classList.toggle('show',n>0)}document.addEventListener('change',e=>{if(e.target.matches('.bulk-check'))updateBulk()});document.getElementById('bulkClear').addEventListener('click',()=>{document.querySelectorAll('.bulk-check').forEach(x=>x.checked=false);updateBulk()});
async function bulkDo(type){const ids=[...document.querySelectorAll('.bulk-check:checked')].map(x=>Number(x.value)).filter(Boolean);if(!ids.length)return;const msg=type==='bulk_delete'?\`Удалить \${ids.length} записей? Опубликованные Facebook-посты останутся на Facebook.\`:\`Переместить \${ids.length} кандидатов в архив?\`;if(!confirm(msg))return;try{const data=await action(type,0,{ids});say(data.message||'Готово');setTimeout(()=>location.href='/library?tab='+encodeURIComponent(bucket),350)}catch(e){say(e.message||'Ошибка',true)}}document.getElementById('bulkDelete').addEventListener('click',()=>bulkDo('bulk_delete'));document.getElementById('bulkArchive').addEventListener('click',()=>bulkDo('bulk_archive'));
document.addEventListener('click',async e=>{const btn=e.target.closest('[data-action]');if(!btn||btn.disabled)return;const a=btn.dataset.action,id=Number(btn.dataset.id||0);
if(a==='product_picker'){modalPostId=id;modal.classList.add('open');products.innerHTML='<div class="loader">Ищу подходящие фотографии…</div>';try{const res=await fetch('/library/product-options?id='+encodeURIComponent(id));const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||'Не удалось получить фото');products.innerHTML='';for(const p of data.products){const card=document.createElement('div');card.className='product-option';const img=document.createElement('img');img.src=p.image;img.alt=p.title||p.pin||'Product photo';img.loading='lazy';const body=document.createElement('div');body.className='po-body';const title=document.createElement('div');title.className='po-title';title.textContent=p.title||p.pin||'Фото товара';const meta=document.createElement('div');meta.className='po-meta';meta.textContent='PIN: '+(p.pin||'')+' · Stock: '+Number(p.stock||0);const pick=document.createElement('button');pick.className='action primary';pick.textContent='✅ Выбрать';pick.addEventListener('click',()=>runButton(pick,'product_select',modalPostId,{index:p.index}));body.append(title,meta,pick);card.append(img,body);products.append(card)}if(!data.products.length)products.innerHTML='<div class="loader">Подходящих фотографий не найдено</div>'}catch(err){products.innerHTML='<div class="loader">'+String(err.message||'Ошибка')+'</div>'}return}
if(a==='ai_history'){aiModal.classList.add('open');aiHistory.innerHTML='<div class="loader">Загрузка…</div>';try{const res=await fetch('/library/ai-history?id='+encodeURIComponent(id));const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||'Ошибка');aiHistory.innerHTML='';for(const h of data.items){const item=document.createElement('div');item.className='ai-history-item';const img=document.createElement('img');img.src='/library/history-media?id='+encodeURIComponent(h.id);img.loading='lazy';const small=document.createElement('small');small.textContent=h.createdAt||'';const check=document.createElement('div');check.className='ai-history-check '+(h.checkStatus||'unknown');const checkTitle=document.createElement('b');const icon=h.checkStatus==='ok'?'✅':h.checkStatus==='warning'?'⚠️':h.checkStatus==='reject'?'⛔':'❔';checkTitle.textContent=icon+' AI image check: '+String(h.checkStatus||'unknown').toUpperCase()+(h.checkScore==null?'':' · '+h.checkScore+'/100');check.append(checkTitle);if(h.checkSummary){const sum=document.createElement('span');sum.textContent=h.checkSummary;check.append(sum)}if(Array.isArray(h.checkIssues)&&h.checkIssues.length){const ul=document.createElement('ul');for(const issue of h.checkIssues.slice(0,4)){const li=document.createElement('li');li.textContent=issue;ul.append(li)}check.append(ul)}const pick=document.createElement('button');pick.className='action primary';pick.textContent=h.checkStatus==='reject'?'⛔ Reject, выбор заблокирован':h.checkStatus==='warning'?'⚠️ Выбрать всё равно':'✅ Выбрать';if(h.checkStatus==='reject'){pick.disabled=true;pick.classList.add('disabled')}else pick.addEventListener('click',()=>runButton(pick,'ai_select_history',id,{historyId:h.id}));item.append(img,small,check,pick);aiHistory.append(item)}if(!data.items.length)aiHistory.innerHTML='<div class="loader">Сохранённых AI вариантов пока нет</div>'}catch(err){aiHistory.innerHTML='<div class="loader">'+String(err.message||'Ошибка')+'</div>'}return}
if(a==='save_edit'){const ed=document.querySelector(\`[data-editor="\${id}"]\`);if(!ed)return;const extra={topic:ed.querySelector('.ed-topic')?.value||'',topicRu:ed.querySelector('.ed-topic-ru')?.value||'',enText:ed.querySelector('.ed-en')?.value||'',ruText:ed.querySelector('.ed-ru')?.value||'',tags:ed.querySelector('.ed-tags')?.value||'',priority:ed.querySelector('.ed-priority')?.value||'normal',note:ed.querySelector('.ed-note')?.value||''};return runButton(btn,'save_edit',id,extra,bucket)}
if(a==='schedule'){const input=document.querySelector(\`.schedule-at[data-id="\${id}"]\`);if(!input?.value){say('Выбери дату и время',true);return}const iso=new Date(input.value).toISOString();return runButton(btn,'schedule',id,{scheduledAt:iso},bucket)}
if(a==='facebook_publish'&&!confirm('Опубликовать этот пост на Facebook Page?'))return;
if(a==='delete_post'){const card=btn.closest('.card'),published=card?.dataset?.bucket==='published';const msg=published?'Удалить эту запись из панели? Пост в Facebook останется опубликованным. Это действие нельзя отменить.':'Удалить этот пост без возможности восстановления? Если связанные сообщения Telegram ещё доступны, бот попробует удалить и их.';if(!confirm(msg))return}
const map={approve:'approve',rewrite:'rewrite',angle_rewrite:'angle_rewrite',skip:'skip',no_photo:'no_photo',ai_generate:'ai_generate',ai_select:'ai_select',facebook_publish:'facebook_publish',delete_post:'delete_post',favorite:'favorite',cancel_schedule:'cancel_schedule',refresh_metrics:'refresh_metrics'};if(map[a])runButton(btn,map[a],id,{},a==='delete_post'?bucket:bucket)});
document.getElementById('closeModal').addEventListener('click',()=>modal.classList.remove('open'));modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.remove('open')});document.getElementById('closeAiModal').addEventListener('click',()=>aiModal.classList.remove('open'));aiModal.addEventListener('click',e=>{if(e.target===aiModal)aiModal.classList.remove('open')});
const params=new URLSearchParams(location.search),initialTab=params.get('tab'),focusId=Number(params.get('focus')||0);if(['ready','published','candidate','archive','favorites','all'].includes(initialTab)){bucket=initialTab;for(const tab of tabs)tab.classList.toggle('active',tab.dataset.tab===bucket)}apply();if(focusId>0){setTimeout(()=>{const card=document.getElementById('post-'+focusId);if(card){card.classList.add('focused');card.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>card.classList.remove('focused'),2600)}},180)}
})();</script></script></body></html>`);
}


async function saveAiHistoryEntry(env, postId, imageUrl, imageTitle, aiCheck = null) {
  await ensurePublishingTables(env);
  const ref = String(imageUrl || "");
  if (!ref.startsWith("tgfile:")) return;
  const exists = await env.mosaic_marketing_bot_db.prepare(`SELECT id FROM content_ai_history WHERE post_id = ? AND image_url = ? LIMIT 1`).bind(postId, ref).first();
  if (exists) return;
  const status = normalizeAiCheckStatus(aiCheck?.status);
  const score = aiCheck?.score == null ? null : normalizeAiCheckScore(aiCheck.score);
  const summary = String(aiCheck?.summary || "");
  const issuesJson = JSON.stringify(Array.isArray(aiCheck?.issues) ? aiCheck.issues.slice(0, 6) : []);
  await env.mosaic_marketing_bot_db.prepare(`INSERT INTO content_ai_history(post_id,image_url,image_title,ai_check_status,ai_check_score,ai_check_summary,ai_check_issues_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).bind(postId, ref, String(imageTitle || ""), status, score, summary, issuesJson, new Date().toISOString()).run();
}

async function libraryAiHistory(env, postId) {
  await ensurePublishingTables(env);
  const result = await env.mosaic_marketing_bot_db.prepare(`SELECT id, image_title, ai_check_status, ai_check_score, ai_check_summary, ai_check_issues_json, created_at FROM content_ai_history WHERE post_id = ? ORDER BY id DESC LIMIT 20`).bind(postId).all();
  const items = Array.isArray(result?.results) ? result.results.map(row => ({
    id:Number(row.id),
    title:String(row.image_title||""),
    createdAt:libraryDate(row.created_at),
    checkStatus:normalizeAiCheckStatus(row.ai_check_status),
    checkScore:row.ai_check_score == null ? null : normalizeAiCheckScore(row.ai_check_score),
    checkSummary:String(row.ai_check_summary||""),
    checkIssues:safeJsonArray(row.ai_check_issues_json).slice(0,6)
  })) : [];
  return json({ ok:true, items });
}

async function serveLibraryHistoryMedia(env, historyId) {
  await ensurePublishingTables(env);
  const row = await env.mosaic_marketing_bot_db.prepare(`SELECT image_url FROM content_ai_history WHERE id = ?`).bind(historyId).first();
  const ref = String(row?.image_url || "");
  if (!ref.startsWith("tgfile:")) return new Response("Media not found", { status:404 });
  try {
    const blob = await fetchTelegramStoredImage(env, ref.slice("tgfile:".length));
    return new Response(blob, { headers:{ "content-type":blob.type||"image/jpeg", "cache-control":"private, max-age=3600", "x-content-type-options":"nosniff" } });
  } catch (_) { return new Response("Media unavailable", { status:502 }); }
}

async function getLibraryMeta(env, postId) {
  await ensurePublishingTables(env);
  return env.mosaic_marketing_bot_db.prepare(`SELECT * FROM content_library_meta WHERE post_id = ?`).bind(postId).first();
}

async function saveLibraryMeta(env, postId, patch = {}) {
  await ensurePublishingTables(env);
  const current = await getLibraryMeta(env, postId) || {};
  const favorite = patch.favorite !== undefined ? (patch.favorite ? 1 : 0) : Number(current.favorite || 0);
  const priority = ["high","normal","later"].includes(String(patch.priority || current.priority || "normal")) ? String(patch.priority || current.priority || "normal") : "normal";
  const tags = patch.tags !== undefined ? String(patch.tags || "").slice(0,500) : String(current.tags || "");
  const note = patch.note !== undefined ? String(patch.note || "").slice(0,4000) : String(current.note || "");
  const scheduledAt = patch.scheduledAt !== undefined ? (patch.scheduledAt || null) : (current.scheduled_at || null);
  const scheduleStatus = patch.scheduleStatus !== undefined ? String(patch.scheduleStatus || "none") : String(current.schedule_status || "none");
  await env.mosaic_marketing_bot_db.prepare(`INSERT INTO content_library_meta(post_id,favorite,priority,tags,note,scheduled_at,schedule_status,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(post_id) DO UPDATE SET favorite=excluded.favorite,priority=excluded.priority,tags=excluded.tags,note=excluded.note,scheduled_at=excluded.scheduled_at,schedule_status=excluded.schedule_status,updated_at=excluded.updated_at`).bind(postId,favorite,priority,tags,note,scheduledAt,scheduleStatus,new Date().toISOString()).run();
}

async function findMostSimilarStoredPost(env, row) {
  const history = await getRecentHistory(env, 200);
  let best = null, bestScore = 0;
  for (const other of history) {
    if (Number(other.id) === Number(row.id)) continue;
    const score = topicSimilarity(row.topic, other.topic);
    if (score > bestScore) { bestScore=score; best=other; }
  }
  return best && bestScore >= 0.42 ? { ...best, score:bestScore } : null;
}

async function refreshFacebookMetrics(env, postId) {
  await ensurePublishingTables(env);
  const pub = await env.mosaic_marketing_bot_db.prepare(`SELECT facebook_post_id FROM facebook_publications WHERE post_id = ? AND status = 'published'`).bind(postId).first();
  const objectId = String(pub?.facebook_post_id || "").trim();
  const token = String(env.FACEBOOK_PAGE_ACCESS_TOKEN || "").trim();
  if (!objectId || !token) return { ok:false, status:409, error:"Нет опубликованного Facebook ID или токена" };
  const fields = "reactions.limit(0).summary(true),comments.limit(0).summary(true),shares";
  const url = `https://graph.facebook.com/${encodeURIComponent(objectId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const data = await res.json().catch(()=>({}));
  const now = new Date().toISOString();
  if (!res.ok || data?.error) {
    const error = String(data?.error?.message || `Facebook HTTP ${res.status}`);
    await env.mosaic_marketing_bot_db.prepare(`INSERT INTO facebook_metrics(post_id,updated_at,last_error) VALUES(?,?,?) ON CONFLICT(post_id) DO UPDATE SET updated_at=excluded.updated_at,last_error=excluded.last_error`).bind(postId,now,error).run();
    return { ok:false, status:502, error:`Не удалось получить статистику: ${error}` };
  }
  const reactions = Number(data?.reactions?.summary?.total_count || 0);
  const comments = Number(data?.comments?.summary?.total_count || 0);
  const shares = Number(data?.shares?.count || 0);
  let impressions = null, reach = null;
  try {
    const insightsUrl = `https://graph.facebook.com/${encodeURIComponent(objectId)}/insights?metric=post_impressions,post_impressions_unique&period=lifetime&access_token=${encodeURIComponent(token)}`;
    const ir = await fetch(insightsUrl);
    const idata = await ir.json().catch(()=>({}));
    if (ir.ok && Array.isArray(idata?.data)) {
      for (const metric of idata.data) {
        const value = Number(metric?.values?.[0]?.value);
        if (metric?.name === "post_impressions" && Number.isFinite(value)) impressions = value;
        if (metric?.name === "post_impressions_unique" && Number.isFinite(value)) reach = value;
      }
    }
  } catch (_) {}
  await env.mosaic_marketing_bot_db.prepare(`INSERT INTO facebook_metrics(post_id,reactions,comments,shares,impressions,reach,updated_at,last_error) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(post_id) DO UPDATE SET reactions=excluded.reactions,comments=excluded.comments,shares=excluded.shares,impressions=excluded.impressions,reach=excluded.reach,updated_at=excluded.updated_at,last_error=''`).bind(postId,reactions,comments,shares,impressions,reach,now,"").run();
  return { ok:true, reactions, comments, shares, impressions, reach };
}

async function refreshStaleFacebookMetrics(env) {
  await ensurePublishingTables(env);
  const cutoff = new Date(Date.now()-3*3600*1000).toISOString();
  const result = await env.mosaic_marketing_bot_db.prepare(`SELECT f.post_id FROM facebook_publications f LEFT JOIN facebook_metrics m ON m.post_id=f.post_id WHERE f.status='published' AND (m.updated_at IS NULL OR m.updated_at < ?) ORDER BY f.published_at DESC LIMIT 5`).bind(cutoff).all();
  for (const row of Array.isArray(result?.results)?result.results:[]) await refreshFacebookMetrics(env, Number(row.post_id)).catch(()=>{});
}

async function processScheduledPosts(env) {
  if (!env.mosaic_marketing_bot_db) return;
  await ensurePublishingTables(env);
  const now = new Date().toISOString();
  const result = await env.mosaic_marketing_bot_db.prepare(`SELECT post_id FROM content_library_meta WHERE schedule_status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 5`).bind(now).all();
  for (const item of Array.isArray(result?.results)?result.results:[]) {
    const postId = Number(item.post_id);
    const out = await publishFromLibrary(env, postId).catch(error=>({ok:false,error:String(error?.message||error)}));
    await saveLibraryMeta(env, postId, { scheduleStatus:out.ok?"published":"failed" }).catch(()=>{});
    if (!out.ok) await sendTelegramText(env, `⚠️ Запланированная публикация #${postId} не вышла\\n${out.error || "Неизвестная ошибка"}`).catch(()=>{});
  }
  await refreshStaleFacebookMetrics(env).catch(()=>{});
}

async function serveLibraryMedia(env, postId) {
  const media = await getMediaSelection(env, postId);
  if (!media || media.mode !== "ai" || !String(media.image_url || "").startsWith("tgfile:")) {
    return new Response("Media not found", { status: 404 });
  }
  const fileId = String(media.image_url).slice("tgfile:".length);
  try {
    const blob = await fetchTelegramStoredImage(env, fileId);
    return new Response(blob, {
      headers: {
        "content-type": blob.type || "image/jpeg",
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    return new Response("Media unavailable", { status: 502 });
  }
}


async function serveLibraryPreviewMedia(env, postId) {
  const preview = await getMediaPreviewState(env, postId);
  const ref = String(preview?.ai_image_url || "");
  if (!ref.startsWith("tgfile:")) return new Response("Preview not found", { status: 404 });
  try {
    const blob = await fetchTelegramStoredImage(env, ref.slice("tgfile:".length));
    return new Response(blob, {
      headers: {
        "content-type": blob.type || "image/jpeg",
        "cache-control": "private, max-age=900",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (_) {
    return new Response("Preview unavailable", { status: 502 });
  }
}

async function libraryProductOptions(env, postId) {
  const row = await getPost(env, postId);
  if (!row) return json({ ok: false, error: "Кандидат не найден" }, 404);
  if (row.status !== "approved") return json({ ok: false, error: "Сначала нужно принять пост" }, 409);
  try {
    const candidates = await getRealPhotoCandidates(row);
    return json({
      ok: true,
      products: candidates.slice(0, 12).map((product, index) => ({
        index,
        pin: String(product?.pin || ""),
        title: String(product?.title || product?.pin || ""),
        stock: Number(product?.stock || 0),
        image: String(product?.images?.[0] || "")
      })).filter(product => product.image)
    });
  } catch (error) {
    return json({ ok: false, error: `Не удалось получить фото: ${String(error?.message || error)}` }, 502);
  }
}

async function handleLibraryAction(request, env) {
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return json({ ok: false, error: "Некорректный запрос" }, 400);
  const action = String(payload.action || "").trim();
  const postId = Number(payload.id || 0);

  try {
    if (action === "new") {
      const result = await generateAndSendCandidate(env, { trigger: "library_new" });
      const ok = result?.status >= 200 && result?.status < 300 && result?.body?.ok;
      return json({
        ...(result?.body || {}),
        ok: Boolean(ok),
        message: ok ? `Новый кандидат #${result.body.id} создан` : undefined,
        error: ok ? undefined : String(result?.body?.error || "Не удалось создать кандидата")
      }, ok ? 200 : (result?.status || 500));
    }

    if (action === "bulk_delete" || action === "bulk_archive") {
      const ids = Array.isArray(payload.ids) ? [...new Set(payload.ids.map(Number).filter(id => Number.isInteger(id) && id > 0))].slice(0,100) : [];
      if (!ids.length) return json({ ok:false, error:"Ничего не выбрано" },400);
      let done = 0;
      for (const id of ids) {
        const item = await getPost(env,id);
        if (!item) continue;
        if (action === "bulk_delete") { const out = await deleteLibraryPost(env,item); if (out.ok) done++; }
        else if (item.status === "candidate") { await skipCandidate(env,id,item.telegram_message_id); done++; }
      }
      return json({ ok:true, message: action === "bulk_delete" ? `Удалено: ${done}` : `В архив перемещено: ${done}` });
    }

    if (!Number.isInteger(postId) || postId <= 0) return json({ ok: false, error: "Некорректный ID поста" }, 400);
    const row = await getPost(env, postId);
    if (!row) return json({ ok: false, error: "Кандидат не найден" }, 404);

    if (action === "approve") {
      if (row.status !== "candidate") return json({ ok: false, error: "Этот пост уже обработан" }, 409);
      await approveCandidate(env, postId, row.telegram_message_id);
      const updated = await getPost(env, postId);
      return json({ ok: updated?.status === "approved", message: "Пост принят ✅", error: updated?.status === "approved" ? undefined : "Не удалось принять пост" }, updated?.status === "approved" ? 200 : 500);
    }

    if (action === "rewrite") {
      if (row.status !== "candidate") return json({ ok: false, error: "Переписывать можно только кандидата" }, 409);
      const before = Number(row.rewrite_count || 0);
      await rewriteCandidate(env, postId, row.telegram_message_id);
      const updated = await getPost(env, postId);
      const ok = Number(updated?.rewrite_count || 0) > before;
      return json({ ok, message: ok ? "Текст переписан" : undefined, error: ok ? undefined : "Не удалось переписать текст" }, ok ? 200 : 502);
    }

    if (action === "angle_rewrite") {
      if (row.status !== "candidate") return json({ ok:false, error:"Другой угол можно сделать только для кандидата" },409);
      const similar = await findMostSimilarStoredPost(env,row);
      const before = Number(row.rewrite_count || 0);
      await rewriteCandidate(env,postId,row.telegram_message_id,{differentAngle:true,avoidTopic:similar?.topic||""});
      const updated = await getPost(env,postId);
      const ok = Number(updated?.rewrite_count||0) > before;
      return json({ok,message:ok?"Сделан другой угол подачи":undefined,error:ok?undefined:"Не удалось изменить угол"},ok?200:502);
    }

    if (action === "favorite") {
      const meta = await getLibraryMeta(env,postId);
      const next = Number(meta?.favorite||0) === 1 ? 0 : 1;
      await saveLibraryMeta(env,postId,{favorite:next});
      return json({ok:true,message:next?"Добавлено в избранное ★":"Убрано из избранного"});
    }

    if (action === "save_edit") {
      const priority = ["high","normal","later"].includes(String(payload.priority||"")) ? String(payload.priority) : "normal";
      await saveLibraryMeta(env,postId,{tags:String(payload.tags||""),priority,note:String(payload.note||"")});
      if (row.status !== "published") {
        const topic = cleanPublicText(payload.topic || row.topic);
        const topicRu = cleanPublicText(payload.topicRu || splitRuPayload(row.ru_text).topic);
        const enText = cleanPublicText(payload.enText || row.en_text);
        const ruText = cleanPublicText(payload.ruText || splitRuPayload(row.ru_text).body);
        await env.mosaic_marketing_bot_db.prepare(`UPDATE content_posts SET topic=?,en_text=?,ru_text=?,updated_at=? WHERE id=?`).bind(topic,enText,composeRuPayload(topicRu,ruText),new Date().toISOString(),postId).run();
        const updated = await getPost(env,postId);
        if (updated?.telegram_message_id) {
          if (updated.status === "approved") await editTelegramText(env,updated.telegram_message_id,formatApprovedMessage(updated,await getMediaSelection(env,postId)),approvedKeyboard(postId)).catch(()=>{});
          else await editTelegramText(env,updated.telegram_message_id,formatCandidateMessage(updated),candidateKeyboard(postId)).catch(()=>{});
        }
      }
      return json({ok:true,message:"Изменения сохранены"});
    }

    if (action === "skip") {
      if (row.status !== "candidate") return json({ ok: false, error: "Этот пост уже обработан" }, 409);
      await skipCandidate(env, postId, row.telegram_message_id);
      return json({ ok: true, message: "Кандидат отправлен в архив" });
    }

    if (action === "delete_post") {
      const result = await deleteLibraryPost(env, row);
      return json(result, result.ok ? 200 : (result.status || 500));
    }

    if (action === "refresh_metrics") {
      const result = await refreshFacebookMetrics(env,postId);
      return json({ ...result, message: result.ok ? `Статистика обновлена: ${result.reactions} реакций, ${result.comments} комментариев, ${result.shares} репостов` : undefined }, result.ok?200:(result.status||502));
    }

    if (action === "cancel_schedule") {
      await saveLibraryMeta(env,postId,{scheduledAt:null,scheduleStatus:"none"});
      return json({ok:true,message:"Публикация снята с расписания"});
    }

    if (row.status !== "approved") return json({ ok: false, error: "Сначала нужно принять пост" }, 409);

    if (action === "no_photo") {
      await selectNoPhoto(env, postId);
      return json({ ok: true, message: "Выбрано: без фото" });
    }

    if (action === "product_select") {
      const index = Number(payload.index || 0);
      if (!Number.isInteger(index) || index < 0) return json({ ok: false, error: "Некорректный вариант фото" }, 400);
      const candidates = await getRealPhotoCandidates(row);
      if (!candidates[index]) return json({ ok: false, error: "Фото больше недоступно, обнови список" }, 409);
      await selectRealPhoto(env, postId, index, null);
      const media = await getMediaSelection(env, postId);
      return json({ ok: media?.mode === "product", message: media?.mode === "product" ? `Фото ${media.image_pin || "товара"} выбрано` : undefined, error: media?.mode === "product" ? undefined : "Не удалось выбрать фото" }, media?.mode === "product" ? 200 : 500);
    }

    if (action === "ai_generate") {
      const before = await getMediaPreviewState(env, postId);
      const beforeStamp = String(before?.updated_at || "");
      await generateAiImagePreview(env, postId);
      const after = await getMediaPreviewState(env, postId);
      const ok = String(after?.ai_image_url || "").startsWith("tgfile:") && String(after?.updated_at || "") !== beforeStamp;
      return json({ ok, message: ok ? "Новое AI фото создано" : undefined, error: ok ? undefined : "AI фото не создалось, проверь Telegram/лог Worker" }, ok ? 200 : 502);
    }

    if (action === "ai_select") {
      const preview = await getMediaPreviewState(env, postId);
      if (!String(preview?.ai_image_url || "").startsWith("tgfile:")) return json({ ok: false, error: "Сначала создай AI фото" }, 409);
      if (normalizeAiCheckStatus(preview?.ai_check_status) === "reject") return json({ ok:false, error:"AI image check: Reject. Этот вариант заблокирован от выбора" },409);
      const selected = await selectAiImage(env, postId, null);
      const media = await getMediaSelection(env, postId);
      const ok = Boolean(selected?.ok) && media?.mode === "ai";
      return json({ ok, message: ok ? (selected.warning ? "AI фото выбрано с предупреждением" : "AI фото выбрано") : undefined, error: ok ? undefined : "Не удалось выбрать AI фото" }, ok ? 200 : 500);
    }

    if (action === "ai_select_history") {
      const historyId = Number(payload.historyId||0);
      const h = await env.mosaic_marketing_bot_db.prepare(`SELECT image_url,image_title,ai_check_status,ai_check_score,ai_check_summary,ai_check_issues_json FROM content_ai_history WHERE id=? AND post_id=?`).bind(historyId,postId).first();
      if (!String(h?.image_url||"").startsWith("tgfile:")) return json({ok:false,error:"AI вариант не найден"},404);
      const checkStatus = normalizeAiCheckStatus(h.ai_check_status);
      if (checkStatus === "reject") return json({ok:false,error:"Этот AI вариант имеет статус Reject и заблокирован от выбора"},409);
      await saveMediaPreviewState(env,postId,{
        aiImageUrl:String(h.image_url),
        aiImageTitle:String(h.image_title||"AI"),
        aiCheckStatus:checkStatus,
        aiCheckScore:h.ai_check_score,
        aiCheckSummary:String(h.ai_check_summary||""),
        aiCheckIssuesJson:String(h.ai_check_issues_json||"[]")
      });
      const selected = await selectAiImage(env,postId,null);
      return json({ok:Boolean(selected?.ok),message:selected?.ok ? (selected.warning ? "Старый AI вариант выбран с предупреждением" : "Старый AI вариант снова выбран") : undefined,error:selected?.ok ? undefined : "Не удалось выбрать AI вариант"}, selected?.ok ? 200 : 409);
    }

    if (action === "schedule") {
      const when = new Date(String(payload.scheduledAt||""));
      if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()+60000) return json({ok:false,error:"Выбери время хотя бы на минуту вперёд"},400);
      const media = await getMediaSelection(env,postId);
      if (!media || media.mode === "unset") return json({ok:false,error:"Сначала выбери фото или Без фото"},409);
      const trust = researchTrustMeta(row);
      if (trust.lock) return json({ok:false,error:"Технический пост с низкой проверкой нельзя ставить в очередь"},409);
      if (!has(env.FACEBOOK_PAGE_ID) || !has(env.FACEBOOK_PAGE_ACCESS_TOKEN)) return json({ok:false,error:"Facebook не подключён"},503);
      await saveLibraryMeta(env,postId,{scheduledAt:when.toISOString(),scheduleStatus:"scheduled"});
      return json({ok:true,message:`Запланировано: ${libraryDate(when.toISOString())}`});
    }

    if (action === "facebook_publish") {
      const result = await publishFromLibrary(env, postId);
      return json(result, result.ok ? 200 : (result.status || 502));
    }

    return json({ ok: false, error: "Неизвестное действие" }, 400);
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error || "Неизвестная ошибка") }, 500);
  }
}

async function deleteLibraryPost(env, row) {
  const db = env.mosaic_marketing_bot_db;
  if (!db || !row?.id) return { ok: false, status: 500, error: "D1 недоступна" };
  await ensurePublishingTables(env);

  const postId = Number(row.id);
  const preview = await getMediaPreviewState(env, postId).catch(() => null);
  const telegramIds = [...new Set([
    Number(row.telegram_message_id || 0),
    Number(preview?.product_message_id || 0),
    Number(preview?.ai_message_id || 0)
  ].filter(id => Number.isInteger(id) && id > 0))];

  // Telegram cleanup is best-effort. D1 deletion should not fail just because
  // an old Telegram message is already gone or can no longer be deleted.
  for (const messageId of telegramIds) {
    await deleteTelegramMessage(env, messageId).catch(() => {});
  }

  const published = String(row.facebook_status || "") === "published";
  await db.batch([
    db.prepare(`DELETE FROM content_media_previews WHERE post_id = ?`).bind(postId),
    db.prepare(`DELETE FROM content_media WHERE post_id = ?`).bind(postId),
    db.prepare(`DELETE FROM content_ai_history WHERE post_id = ?`).bind(postId),
    db.prepare(`DELETE FROM facebook_metrics WHERE post_id = ?`).bind(postId),
    db.prepare(`DELETE FROM content_library_meta WHERE post_id = ?`).bind(postId),
    db.prepare(`DELETE FROM facebook_publications WHERE post_id = ?`).bind(postId),
    db.prepare(`DELETE FROM content_posts WHERE id = ?`).bind(postId)
  ]);

  return {
    ok: true,
    message: published
      ? "Запись удалена из панели. Пост в Facebook оставлен без изменений."
      : "Пост удалён из панели и D1. Связанные сообщения Telegram очищены, где это было возможно."
  };
}

async function publishFromLibrary(env, postId) {
  const row = await getPost(env, postId);
  if (!row || row.status !== "approved") return { ok: false, status: 409, error: "Сначала нужно принять пост" };
  await ensurePublishingTables(env);
  const previous = await env.mosaic_marketing_bot_db.prepare(`
    SELECT status, facebook_post_id, published_at FROM facebook_publications WHERE post_id = ?
  `).bind(postId).first();
  if (previous?.status === "published") return { ok: false, status: 409, error: "Этот пост уже опубликован", facebookPostId: previous.facebook_post_id || "" };

  const trust = researchTrustMeta(row);
  if (trust.lock) return { ok: false, status: 409, error: "Публикация заблокирована: технический пост с низкой проверкой. Перепиши его как обсуждение или создай новую тему." };

  const pageId = String(env.FACEBOOK_PAGE_ID || "").trim();
  const token = String(env.FACEBOOK_PAGE_ACCESS_TOKEN || "").trim();
  if (!pageId || !token) return { ok: false, status: 503, error: "Facebook Page ID или Page Access Token не подключены" };
  const media = await getMediaSelection(env, postId);
  if (!media || media.mode === "unset") return { ok: false, status: 409, error: "Сначала выбери фото или Без фото" };

  const result = await publishToFacebookPage(env, row, media);
  const now = new Date().toISOString();
  await env.mosaic_marketing_bot_db.prepare(`
    INSERT INTO facebook_publications (post_id, status, facebook_post_id, facebook_page_id, published_at, last_error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(post_id) DO UPDATE SET
      status = excluded.status, facebook_post_id = excluded.facebook_post_id,
      facebook_page_id = excluded.facebook_page_id, published_at = excluded.published_at,
      last_error = excluded.last_error, updated_at = excluded.updated_at
  `).bind(postId, result.ok ? "published" : "failed", String(result.postId || ""), pageId, result.ok ? now : "", result.ok ? "" : String(result.error || "Unknown Facebook error"), now).run();

  if (!result.ok) {
    await sendTelegramText(env, `⚠️ Facebook publish failed for #${postId}\n${result.error || "Unknown error"}`).catch(() => {});
    return { ok: false, status: 502, error: String(result.error || "Facebook publish failed") };
  }

  await saveLibraryMeta(env,postId,{scheduleStatus:"published"}).catch(()=>{});
  if (row.telegram_message_id) {
    await editTelegramText(env, row.telegram_message_id, `✅ ОПУБЛИКОВАНО В FACEBOOK\nPublished: ${now}\nFacebook ID: ${result.postId || ""}\n\n` + formatCandidateMessage(row, false), null).catch(() => {});
  }
  await refreshFacebookMetrics(env,postId).catch(()=>{});
  return { ok: true, message: "Опубликовано в Facebook ✅", facebookPostId: String(result.postId || ""), publishedAt: now };
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
