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
  let pendingEmail = "";

  const translations = {
    de: {
      signIn:"Anmelden",
      intro:"Gib deine E-Mail-Adresse ein. Wir senden dir einen 6-stelligen Anmeldecode. Kein Passwort nötig.",
      emailLabel:"E-Mail-Adresse", sendCode:"Anmeldecode senden", sentTo:"Code gesendet an",
      codeLabel:"6-stelliger Code", verify:"Anmelden", changeEmail:"Andere E-Mail verwenden",
      signedIn:"Du bist angemeldet", signedInAs:"Angemeldet als", accountReady:"Dein Mosaic Pins Konto ist bereit.",
      ordersSoon:"Bestellverlauf und Bewertungen verifizierter Käufe werden als Nächstes hinzugefügt.", logout:"Abmelden"
    },
    ru: {
      signIn:"Войти",
      intro:"Введите email, и мы отправим 6-значный код для входа. Пароль не нужен.",
      emailLabel:"Электронная почта", sendCode:"Отправить код", sentTo:"Код отправлен на",
      codeLabel:"6-значный код", verify:"Войти", changeEmail:"Использовать другой email",
      signedIn:"Вы вошли в аккаунт", signedInAs:"Вы вошли как", accountReady:"Ваш аккаунт Mosaic Pins готов.",
      ordersSoon:"История заказов и отзывы о подтверждённых покупках будут добавлены следующим этапом.", logout:"Выйти"
    },
    fr: {
      signIn:"Se connecter",
      intro:"Saisissez votre e-mail et nous vous enverrons un code de connexion à 6 chiffres. Aucun mot de passe requis.",
      emailLabel:"Adresse e-mail", sendCode:"Envoyer le code", sentTo:"Code envoyé à",
      codeLabel:"Code à 6 chiffres", verify:"Se connecter", changeEmail:"Utiliser un autre e-mail",
      signedIn:"Vous êtes connecté", signedInAs:"Connecté en tant que", accountReady:"Votre compte Mosaic Pins est prêt.",
      ordersSoon:"L’historique des commandes et les avis d’achats vérifiés seront ajoutés ensuite.", logout:"Se déconnecter"
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
