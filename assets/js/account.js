(() => {
  const $ = (id) => document.getElementById(id);
  const loading = $("accountLoading");
  const guest = $("accountGuest");
  const signed = $("accountSignedIn");
  const emailForm = $("emailForm");
  const codeForm = $("codeForm");
  const emailInput = $("accountEmail");
  const codeInput = $("accountCode");
  const sentEmail = $("sentEmail");
  const message = $("accountMessage");
  const logoutBtn = $("logoutBtn");
  const signedInEmail = $("signedInEmail");
  const ordersSection = $("ordersSection");
  const ordersEyebrow = $("ordersEyebrow");
  const ordersTitle = $("ordersTitle");
  const ordersCount = $("ordersCount");
  const ordersLoading = $("ordersLoading");
  const ordersEmpty = $("ordersEmpty");
  const ordersList = $("ordersList");
  const ordersFootnote = $("ordersFootnote");
  let pendingEmail = "";

  const translations = {
    de: {
      signIn:"Anmelden",
      intro:"Gib deine E-Mail-Adresse ein. Wir senden dir einen 6-stelligen Anmeldecode. Kein Passwort nötig.",
      emailLabel:"E-Mail-Adresse", sendCode:"Anmeldecode senden", sentTo:"Code gesendet an",
      codeLabel:"6-stelliger Code", verify:"Anmelden", changeEmail:"Andere E-Mail verwenden",
      signedIn:"Du bist angemeldet", signedInAs:"Angemeldet als", logout:"Abmelden",
      ordersEyebrow:"Käufe", myOrders:"Meine Bestellungen", loadingOrders:"Bestellungen werden geladen…",
      noOrders:"Für diese E-Mail wurden noch keine Bestellungen gefunden.", orderLabel:"Bestellung",
      total:"Gesamt", destination:"Ziel", tracking:"Sendungsnummer", quantity:"Menge", diameter:"Durchmesser",
      verifiedSoon:"Bewertungen verifizierter Käufe werden als Nächstes mit diesen Bestellungen verknüpft.",
      paid:"Bezahlt", shipped:"Versendet", processing:"In Bearbeitung", refunded:"Erstattet",
      cancelled:"Storniert", notRefunded:"Nicht erstattet"
    },
    ru: {
      signIn:"Войти",
      intro:"Введите email, и мы отправим 6-значный код для входа. Пароль не нужен.",
      emailLabel:"Электронная почта", sendCode:"Отправить код", sentTo:"Код отправлен на",
      codeLabel:"6-значный код", verify:"Войти", changeEmail:"Использовать другой email",
      signedIn:"Вы вошли в аккаунт", signedInAs:"Вы вошли как", logout:"Выйти",
      ordersEyebrow:"Покупки", myOrders:"Мои заказы", loadingOrders:"Загружаем заказы…",
      noOrders:"Для этого email пока не найдено заказов.", orderLabel:"Заказ",
      total:"Итого", destination:"Доставка", tracking:"Трек-номер", quantity:"Количество", diameter:"Диаметр",
      verifiedSoon:"Следующим этапом мы привяжем к этим заказам отзывы с отметкой «Подтверждённая покупка».",
      paid:"Оплачен", shipped:"Отправлен", processing:"В обработке", refunded:"Возвращён",
      cancelled:"Отменён", notRefunded:"Без возврата"
    },
    fr: {
      signIn:"Se connecter",
      intro:"Saisissez votre e-mail et nous vous enverrons un code de connexion à 6 chiffres. Aucun mot de passe requis.",
      emailLabel:"Adresse e-mail", sendCode:"Envoyer le code", sentTo:"Code envoyé à",
      codeLabel:"Code à 6 chiffres", verify:"Se connecter", changeEmail:"Utiliser un autre e-mail",
      signedIn:"Vous êtes connecté", signedInAs:"Connecté en tant que", logout:"Se déconnecter",
      ordersEyebrow:"Achats", myOrders:"Mes commandes", loadingOrders:"Chargement des commandes…",
      noOrders:"Aucune commande n’a encore été trouvée pour cet e-mail.", orderLabel:"Commande",
      total:"Total", destination:"Destination", tracking:"Suivi", quantity:"Quantité", diameter:"Diamètre",
      verifiedSoon:"Les avis d’achats vérifiés seront ensuite liés à ces commandes.",
      paid:"Payée", shipped:"Expédiée", processing:"En traitement", refunded:"Remboursée",
      cancelled:"Annulée", notRefunded:"Non remboursée"
    }
  };

  function lang() {
    try {
      const value = String(localStorage.getItem("mp_language") || "en").toLowerCase();
      return ["en","de","ru","fr"].includes(value) ? value : "en";
    } catch (_) { return "en"; }
  }

  function applyTranslations() {
    const dict = translations[lang()] || {};
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const value = dict[el.dataset.i18n];
      if (value) el.textContent = value;
    });
  }

  function t(key) {
    const english = {
      ordersEyebrow:"Purchases", myOrders:"My Orders", loadingOrders:"Loading orders…",
      noOrders:"No orders have been found for this email yet.", orderLabel:"Order",
      total:"Total", destination:"Destination", tracking:"Tracking", quantity:"Quantity", diameter:"Diameter",
      verifiedSoon:"Verified-purchase reviews will be linked to these orders next.",
      paid:"Paid", shipped:"Shipped", processing:"Processing", refunded:"Refunded",
      cancelled:"Cancelled", notRefunded:"Not refunded"
    };
    return (translations[lang()] || {})[key] || english[key] || key;
  }

  function locale() {
    return ({ en:"en-GB", de:"de-DE", ru:"ru-RU", fr:"fr-FR" })[lang()] || "en-GB";
  }

  function statusLabel(status) {
    const raw = String(status || "").trim().toLowerCase();
    if (raw === "paid") return t("paid");
    if (raw === "shipped") return t("shipped");
    if (raw === "processing" || raw === "pending") return t("processing");
    if (raw === "refunded") return t("refunded");
    if (raw === "cancelled" || raw === "canceled") return t("cancelled");
    return raw ? raw.replace(/_/g, " ") : "—";
  }

  function formatMoney(amount, currency) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return "—";
    try {
      return new Intl.NumberFormat(locale(), {
        style: "currency",
        currency: String(currency || "EUR").toUpperCase()
      }).format(value);
    } catch (_) {
      return `${value.toFixed(2)} ${String(currency || "EUR").toUpperCase()}`;
    }
  }

  function formatDate(value) {
    const date = new Date(String(value || ""));
    if (Number.isNaN(date.getTime())) return "";
    try {
      return new Intl.DateTimeFormat(locale(), {
        year:"numeric", month:"short", day:"2-digit"
      }).format(date);
    } catch (_) {
      return date.toLocaleDateString();
    }
  }

  function countryName(code) {
    const value = String(code || "").trim().toUpperCase();
    if (!value) return "—";
    try {
      const dn = new Intl.DisplayNames([locale()], { type:"region" });
      return dn.of(value) || value;
    } catch (_) {
      return value;
    }
  }

  function make(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function renderOrders(orders = []) {
    ordersSection.hidden = false;
    ordersEyebrow.textContent = t("ordersEyebrow");
    ordersTitle.textContent = t("myOrders");
    ordersCount.textContent = String(orders.length);
    ordersLoading.hidden = true;
    ordersEmpty.hidden = orders.length !== 0;
    ordersEmpty.textContent = t("noOrders");
    ordersFootnote.textContent = t("verifiedSoon");
    ordersList.replaceChildren();

    for (const order of orders) {
      const card = make("article", "order-card");

      const head = make("div", "order-card-head");
      const headLeft = make("div");
      headLeft.append(
        make("div", "order-number", order.orderId || t("orderLabel")),
        make("div", "order-date", formatDate(order.createdAt))
      );
      const badge = make("span", "order-status", statusLabel(order.status));
      badge.dataset.status = String(order.status || "").trim().toLowerCase();
      head.append(headLeft, badge);
      card.appendChild(head);

      const itemsWrap = make("div", "order-items");
      const items = Array.isArray(order.items) ? order.items : [];

      for (const item of items) {
        const row = make("div", "order-item");

        let media;
        if (item.image) {
          media = make("img", "order-item-image");
          media.src = item.image;
          media.alt = item.title || item.pin || "";
          media.loading = "lazy";
          media.addEventListener("error", () => {
            const fallback = make("div", "order-item-image-fallback", "◆");
            media.replaceWith(fallback);
          }, { once:true });
        } else {
          media = make("div", "order-item-image-fallback", "◆");
        }

        const info = make("div");
        info.appendChild(make("div", "order-item-title", item.title || item.pin || "Mosaic Pin"));
        if (item.pin) info.appendChild(make("div", "order-item-pin", item.pin));

        const meta = make("div", "order-item-meta");
        if (Number.isFinite(Number(item.diameter))) {
          meta.appendChild(make("span", "", `Ø${Number(item.diameter)} mm`));
        }
        if (Number.isFinite(Number(item.quantity))) {
          meta.appendChild(make("span", "", `${t("quantity")}: ${Number(item.quantity)}`));
        }
        if (meta.childNodes.length) info.appendChild(meta);

        row.append(media, info);
        itemsWrap.appendChild(row);
      }

      if (items.length) card.appendChild(itemsWrap);

      const summary = make("div", "order-summary");
      const details = [
        [t("total"), formatMoney(order.amountTotal, order.currency)],
        [t("destination"), countryName(order.shippingCountry)]
      ];
      if (order.trackingNumber) details.push([t("tracking"), String(order.trackingNumber)]);

      for (const [label, value] of details) {
        const detail = make("div", "order-detail");
        detail.append(
          make("div", "order-detail-label", label),
          make("div", "order-detail-value", value)
        );
        summary.appendChild(detail);
      }

      card.appendChild(summary);
      ordersList.appendChild(card);
    }
  }

  async function loadOrders() {
    ordersSection.hidden = false;
    ordersEyebrow.textContent = t("ordersEyebrow");
    ordersTitle.textContent = t("myOrders");
    ordersCount.textContent = "…";
    ordersLoading.hidden = false;
    ordersLoading.textContent = t("loadingOrders");
    ordersEmpty.hidden = true;
    ordersList.replaceChildren();
    ordersFootnote.textContent = "";

    try {
      const data = await api("/api/account/orders");
      renderOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch (error) {
      ordersLoading.textContent = error.message || t("noOrders");
      ordersCount.textContent = "!";
    }
  }

  function show(which) {
    loading.hidden = which !== "loading";
    guest.hidden = which !== "guest";
    signed.hidden = which !== "signed";
  }

  function setMessage(text = "", type = "") {
    message.textContent = text;
    message.className = `message${type ? ` ${type}` : ""}`;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || "Request failed.");
    }
    return data;
  }

  async function loadSession() {
    try {
      const data = await api("/api/account/me");
      if (data.authenticated) {
        signedInEmail.textContent = data.user?.email || "";
        show("signed");
        loadOrders();
      } else {
        show("guest");
      }
    } catch (_) {
      show("guest");
      setMessage("Unable to check your account right now.", "error");
    }
  }

  emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    pendingEmail = String(emailInput.value || "").trim().toLowerCase();
    if (!pendingEmail) return;

    const button = $("sendCodeBtn");
    button.disabled = true;
    setMessage("");

    try {
      await api("/api/account/request-code", {
        method: "POST",
        body: JSON.stringify({ email: pendingEmail })
      });
      sentEmail.textContent = pendingEmail;
      emailForm.hidden = true;
      codeForm.hidden = false;
      codeInput.value = "";
      codeInput.focus();
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = String(codeInput.value || "").trim();
    const button = $("verifyCodeBtn");
    button.disabled = true;
    setMessage("");

    try {
      const data = await api("/api/account/verify-code", {
        method: "POST",
        body: JSON.stringify({ email: pendingEmail, code })
      });
      if (data.authenticated) {
        signedInEmail.textContent = data.user?.email || pendingEmail;
        show("signed");
        loadOrders();
      }
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  $("changeEmailBtn").addEventListener("click", () => {
    codeForm.hidden = true;
    emailForm.hidden = false;
    codeInput.value = "";
    setMessage("");
    emailInput.focus();
  });

  logoutBtn.addEventListener("click", async () => {
    logoutBtn.disabled = true;
    try {
      await api("/api/account/logout", { method: "POST", body: "{}" });
      pendingEmail = "";
      emailInput.value = "";
      codeInput.value = "";
      codeForm.hidden = true;
      emailForm.hidden = false;
      show("guest");
      ordersSection.hidden = true;
      ordersList.replaceChildren();
      setMessage("");
    } catch (_) {
      logoutBtn.disabled = false;
    } finally {
      logoutBtn.disabled = false;
    }
  });

  applyTranslations();
  loadSession();
})();
