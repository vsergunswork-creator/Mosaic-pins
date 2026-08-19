(() => {
  const LANG_KEY = "mp_language";
  const SUPPORTED = ["en", "de", "ru", "fr"];

  const TEXT = {
    de: {
      "Info":"Info",
      "Returns & Refunds":"Rückgabe & Erstattung",
      "Support for issues, returns (if accepted) and refunds":"Hilfe bei Problemen, Rückgaben (sofern akzeptiert) und Erstattungen",
      "We want you to be happy with your purchase. If something is wrong, contact us and we’ll help.":"Wir möchten, dass du mit deinem Kauf zufrieden bist. Wenn etwas nicht stimmt, kontaktiere uns – wir helfen dir gerne.",
      "Damaged / wrong item":"Beschädigter / falscher Artikel",
      "If your order arrives damaged or you receive the wrong item, please contact us within":"Wenn deine Bestellung beschädigt ankommt oder du den falschen Artikel erhältst, kontaktiere uns bitte innerhalb von",
      "7 days":"7 Tagen",
      "of delivery.":"nach der Zustellung.",
      "Include your order details and photos.":"Füge deine Bestelldaten und Fotos hinzu.",
      "We will arrange replacement or refund where applicable.":"Falls zutreffend, organisieren wir einen Ersatz oder eine Erstattung.",
      "Returns (if accepted)":"Rückgaben (sofern akzeptiert)",
      "Returns may be accepted in certain cases. Items must be unused and in original condition.":"In bestimmten Fällen können Rückgaben akzeptiert werden. Die Artikel müssen unbenutzt und im Originalzustand sein.",
      "Return shipping costs are paid by the buyer (unless we made a mistake).":"Die Rücksendekosten trägt der Käufer (außer wenn der Fehler bei uns liegt).",
      "We recommend using a tracked service.":"Wir empfehlen einen Versand mit Sendungsverfolgung.",
      "Refunds":"Erstattungen",
      "Approved refunds are processed back to the original payment method.\n              Bank processing time can take a few business days.":"Genehmigte Erstattungen werden auf die ursprüngliche Zahlungsmethode zurückgebucht.\n              Die Bearbeitung durch die Bank kann einige Werktage dauern.",
      "How to contact us":"So erreichst du uns",
      "Email:":"E-Mail:",
      "Please include: order/session ID (if available) and a short description.":"Bitte gib die Bestell-/Session-ID (falls vorhanden) und eine kurze Beschreibung an.",
      "Important":"Wichtig",
      "We do not accept returns for custom or personalized items unless they arrive damaged or defective.":"Individuell angefertigte oder personalisierte Artikel können nicht zurückgegeben werden, außer sie kommen beschädigt oder fehlerhaft an.",
      "Worldwide tracked shipping • Processing & delivery info":"Weltweiter Versand mit Sendungsverfolgung • Bearbeitung & Lieferinformationen",
      "← Back to Shop":"← Zurück zum Shop",
      "We ship mosaic pins worldwide. Below is a simple overview of processing time, delivery and tracking.":"Wir versenden Mosaic Pins weltweit. Hier findest du einen kurzen Überblick über Bearbeitungszeit, Lieferung und Sendungsverfolgung.",
      "Processing time":"Bearbeitungszeit",
      "Orders are typically processed within":"Bestellungen werden normalerweise innerhalb von",
      "1–3 business days":"1–3 Werktagen",
      ".\n              During peak periods it may take a little longer.":".\n              In Stoßzeiten kann die Bearbeitung etwas länger dauern.",
      "Handcrafted & carefully packed":"Handgefertigt & sorgfältig verpackt",
      "Shipping & tracking":"Versand & Sendungsverfolgung",
      "All shipments include a":"Alle Sendungen enthalten eine",
      "tracking number":"Sendungsnummer",
      ".\n              Packages are sent as tracked parcels (up to":".\n              Pakete werden als Sendungen mit Sendungsverfolgung verschickt (bis",
      "2 kg":"2 kg",
      ").":").",
      "Tracking updates may appear with a delay.":"Tracking-Updates können mit Verzögerung erscheinen.",
      "Delivery time depends on destination and carrier.":"Die Lieferzeit hängt vom Zielland und dem Versanddienstleister ab.",
      "Live DHL shipping rates":"Aktuelle DHL-Versandtarife",
      "Shipping is calculated automatically in your cart using the current DHL rate for your destination.\n              We use a":"Die Versandkosten werden im Warenkorb automatisch anhand des aktuellen DHL-Tarifs für dein Zielland berechnet.\n              Wir verwenden ein",
      "tracked DHL Paket up to 2 kg":"DHL Paket mit Sendungsverfolgung bis 2 kg",
      "whenever that service is available.":"sofern dieser Service verfügbar ist.",
      "Select your shipping country in the cart.":"Wähle dein Versandland im Warenkorb aus.",
      "The current tracked DHL price appears before payment.":"Der aktuelle DHL-Preis mit Sendungsverfolgung wird vor der Zahlung angezeigt.",
      "The same destination and rate are verified again on the server during checkout.":"Zielland und Tarif werden beim Checkout auf dem Server erneut überprüft.",
      "No fixed country zones • live destination pricing":"Keine festen Länderzonen • aktuelle Preise nach Zielland",
      "Delivery estimates":"Voraussichtliche Lieferzeiten",
      "Delivery time depends on the destination, customs processing and the local delivery network.\n              Your tracking number will be emailed after dispatch.":"Die Lieferzeit hängt vom Zielland, der Zollabfertigung und dem lokalen Zustellnetz ab.\n              Deine Sendungsnummer wird nach dem Versand per E-Mail verschickt.",
      "Delivery estimates are not guarantees.":"Die angegebenen Lieferzeiten sind unverbindlich.",
      "Customs & import taxes":"Zoll & Einfuhrabgaben",
      "International orders may be subject to customs fees, VAT or import taxes.\n              These charges are the buyer’s responsibility.":"Bei internationalen Bestellungen können Zollgebühren, Mehrwertsteuer oder Einfuhrabgaben anfallen.\n              Diese Kosten trägt der Käufer.",
      "Need help with shipping?":"Brauchst du Hilfe beim Versand?",
      "Contact:":"Kontakt:",
      "Shop":"Shop","About":"Über uns","Shipping":"Versand","Returns":"Rückgabe","Reviews":"Bewertungen",
      "Filters":"Filter","Cart":"Warenkorb","In stock":"Auf Lager","Selected":"Ausgewählt","Clear":"Löschen",
      "Diameter (Ø)":"Durchmesser (Ø)","Shipping country":"Versandland","Subtotal":"Zwischensumme","Total":"Gesamt",
      "Checkout":"Mit Karte zahlen","Clear cart":"Warenkorb leeren","PayPal is loading…":"PayPal wird geladen…",
      "Your cart is empty.":"Dein Warenkorb ist leer.","Add to cart":"In den Warenkorb","Pay by card":"Mit Karte zahlen",
      "Quantity":"Menge","Loading…":"Wird geladen…","No image":"Kein Bild","Product":"Produkt","Notice":"Hinweis",
      "Sold out":"Ausverkauft","Buy":"Kaufen","All":"Alle","Any size":"Alle Größen","Exact":"Exakt",
      "Privacy Policy":"Datenschutz","Impressum":"Impressum","Support":"Support",
      "Choose a destination to calculate DHL tracked shipping.":"Wähle ein Versandland, um den DHL-Versand mit Sendungsverfolgung zu berechnen.",
      "Loading DHL countries…":"DHL-Länder werden geladen…","Add an item to calculate shipping.":"Lege einen Artikel in den Warenkorb, um den Versand zu berechnen.",
      "Please select a shipping country and wait for the DHL rate.":"Bitte wähle ein Versandland und warte auf den DHL-Tarif.",
      "Legal":"Rechtliches",
      "How we collect, use, and protect your data":"Wie wir deine Daten erheben, verwenden und schützen",
      "Privacy Policy of Vitalijs Serguns / Mosaic Pins":"Datenschutzerklärung von Vitalijs Serguns / Mosaic Pins",
      "This Privacy Policy explains how and when I collect, use, and share information when you purchase from me, contact me, or otherwise use my services through":"Diese Datenschutzerklärung erläutert, wie und wann ich Informationen erhebe, verwende und weitergebe, wenn du bei mir kaufst, mich kontaktierst oder meine Dienste über",
      "1. Information I Collect":"1. Informationen, die ich erhebe",
      "To fulfill your order, I need certain information, including your name, email address, mailing address, payment details, and information about the product you ordered.":"Zur Bearbeitung deiner Bestellung benötige ich bestimmte Informationen, darunter deinen Namen, deine E-Mail-Adresse, deine Postanschrift, Zahlungsdaten und Angaben zum bestellten Produkt.",
      "When you contact me directly, you may also provide additional personal information (for example, for custom orders).":"Wenn du mich direkt kontaktierst, kannst du mir außerdem weitere personenbezogene Daten mitteilen (zum Beispiel bei Sonderanfertigungen).",
      "2. Why I Need Your Information and How I Use It":"2. Warum ich deine Informationen benötige und wie ich sie verwende",
      "I collect, use, and share your information based on several legal grounds, including:":"Ich erhebe, verwende und teile deine Informationen auf Grundlage verschiedener Rechtsgrundlagen, darunter:",
      "When necessary to provide my services, such as fulfilling orders, resolving disputes, and offering customer support;":"Wenn dies zur Erbringung meiner Leistungen erforderlich ist, etwa zur Abwicklung von Bestellungen, Beilegung von Streitigkeiten und für den Kundensupport;",
      "When required to comply with legal obligations, such as storing tax-related information about your purchases;":"Wenn dies zur Erfüllung gesetzlicher Pflichten erforderlich ist, etwa zur Aufbewahrung steuerrelevanter Informationen zu deinen Käufen;",
      "To the extent necessary for my legitimate business interests, provided these interests do not override your rights and interests (for example, to provide and improve my services).":"Soweit dies für meine berechtigten geschäftlichen Interessen erforderlich ist und diese Interessen deine Rechte und Interessen nicht überwiegen (zum Beispiel zur Bereitstellung und Verbesserung meiner Leistungen).",
      "I do not use your information for marketing or promotional emails.":"Ich verwende deine Informationen nicht für Marketing- oder Werbe-E-Mails.",
      "3. Information Sharing and Disclosure":"3. Weitergabe und Offenlegung von Informationen",
      "Your information is important to my business. I share your personal information only in the following circumstances:":"Deine Informationen sind für mein Geschäft wichtig. Ich gebe personenbezogene Daten nur in folgenden Fällen weiter:",
      "Service Providers:":"Dienstleister:",
      "I may use trusted third parties (such as shipping companies) to fulfill orders. These parties receive only the information necessary to perform their services;":"Ich kann vertrauenswürdige Dritte (z. B. Versandunternehmen) zur Abwicklung von Bestellungen einsetzen. Diese erhalten nur die Informationen, die zur Erbringung ihrer Leistungen erforderlich sind;",
      "Legal Compliance:":"Gesetzliche Verpflichtungen:",
      "I may disclose your information if required by law, to prevent fraud, or to protect the rights and safety of my customers and others.":"Ich kann deine Informationen offenlegen, wenn dies gesetzlich vorgeschrieben ist, zur Betrugsprävention oder zum Schutz der Rechte und Sicherheit meiner Kunden und anderer Personen.",
      "4. Data Retention":"4. Speicherdauer",
      "I retain your personal data only as long as necessary to fulfill my obligations and comply with legal requirements. Typically, data is kept for up to":"Ich speichere deine personenbezogenen Daten nur so lange, wie es zur Erfüllung meiner Verpflichtungen und gesetzlicher Anforderungen erforderlich ist. In der Regel werden Daten bis zu",
      "4 years":"4 Jahre",
      "5. International Data Transfers":"5. Internationale Datenübermittlungen",
      "Your information may be stored and processed by third-party cloud services outside the EU. Where this occurs, I take reasonable steps to ensure such transfers comply with GDPR requirements.":"Deine Informationen können von Cloud-Diensten Dritter außerhalb der EU gespeichert und verarbeitet werden. In solchen Fällen ergreife ich angemessene Maßnahmen, damit diese Übermittlungen den Anforderungen der DSGVO entsprechen.",
      "6. Your Rights":"6. Deine Rechte",
      "If you reside in the EU, you have certain rights regarding your personal data, including:":"Wenn du in der EU wohnst, hast du bestimmte Rechte in Bezug auf deine personenbezogenen Daten, darunter:",
      "Access and obtaining a copy of your data;":"Auskunft und Erhalt einer Kopie deiner Daten;",
      "Correction, restriction, or deletion of your data;":"Berichtigung, Einschränkung oder Löschung deiner Daten;",
      "Objecting to processing and marketing communications;":"Widerspruch gegen die Verarbeitung und gegen Marketingmitteilungen;",
      "Filing complaints with EU data protection authorities.":"Beschwerden bei Datenschutzbehörden in der EU einzureichen.",
      "Contact Me":"Kontakt",
      "As the data controller under EU law, I am":"Verantwortlicher im Sinne des EU-Rechts bin ich,",
      "For any questions or concerns, please contact me at:":"Bei Fragen oder Anliegen kontaktiere mich bitte unter:",
      "Legal notice (Germany)":"Rechtliche Hinweise (Deutschland)",
      "Information according to § 5 TMG":"Angaben gemäß § 5 TMG",
      "Provider information and contact details.":"Anbieterinformationen und Kontaktdaten.",
      "Name":"Name",
      "Address":"Anschrift",
      "Germany":"Deutschland",
      "Email":"E-Mail",
      "VAT ID (USt-IdNr.)":"USt-IdNr.",
      "Disclaimer":"Haftungsausschluss",
      "Despite careful control, we assume no liability for the content of external links. The operators of the linked pages are solely responsible for their content.":"Trotz sorgfältiger inhaltlicher Kontrolle übernehmen wir keine Haftung für die Inhalte externer Links. Für den Inhalt der verlinkten Seiten sind ausschließlich deren Betreiber verantwortlich.",
      "Legal details":"Rechtliche Angaben",
      "Contact":"Kontakt",
      "About us":"Über uns",
      "Gallery":"Galerie",
      "Previous":"Zurück",
      "Next":"Weiter",
      "Close":"Schließen",
      "Gallery large":"Große Galerieansicht",
      "How it works":"So funktioniert es",
      "Leave a review and share your experience.":"Hinterlasse eine Bewertung und teile deine Erfahrung.",
      "Rating: 1–5 stars.":"Bewertung: 1–5 Sterne.",
      "Customer reviews":"Kundenbewertungen",
      "Average rating":"Durchschnittsbewertung",
      "Average stars":"Durchschnittliche Sterne",
      "Leave a review":"Bewertung abgeben",
      "Will be published after approval":"Wird nach der Freigabe veröffentlicht",
      "Country (optional)":"Land (optional)",
      "Rating":"Bewertung",
      "Selected: 5/5":"Ausgewählt: 5/5",
      "Review text":"Bewertungstext",
      "Photos (optional, up to 4)":"Fotos (optional, bis zu 4)",
      "Add photos to your review":"Fotos zur Bewertung hinzufügen",
      "JPG, PNG or WebP · up to 4 photos · max 8 MB each":"JPG, PNG oder WebP · bis zu 4 Fotos · max. 8 MB pro Foto",
      "Choose photos":"Fotos auswählen",
      "Send review":"Bewertung senden",
      "Thank you very much for your feedback! 😉":"Vielen Dank für dein Feedback! 😉",
      "Reviews":"Bewertungen",
      "Showing customer reviews.":"Kundenbewertungen werden angezeigt.",
      "No reviews yet. Be the first 🙂":"Noch keine Bewertungen. Sei der Erste 🙂",
      "Published ✅ Thank you for your review!":"Veröffentlicht ✅ Vielen Dank für deine Bewertung!",
      "Your name":"Dein Name",
      "Germany, USA…":"Deutschland, USA…",
      "Tell us what you liked…":"Erzähl uns, was dir gefallen hat…",
      "Choose rating":"Bewertung auswählen",
      "Back to shop":"Zurück zum Shop",
      "Photo large":"Großes Foto",
      "Footer links":"Footer-Links",
      "Payment canceled":"Zahlung abgebrochen",
      "❌ Payment canceled":"❌ Zahlung abgebrochen",
      "No worries — you can try again.":"Kein Problem – du kannst es erneut versuchen.",
      "← Back to home":"← Zurück zur Startseite",
      "Payment success":"Zahlung erfolgreich",
      "✅ Payment successful":"✅ Zahlung erfolgreich",
      "Updating your cart…":"Dein Warenkorb wird aktualisiert…",
      "High-quality handcrafted mosaic pins for knife handles":"Hochwertige handgefertigte Mosaik-Pins für Messergriffe"
    },
    ru: {
      "Info":"Информация",
      "Returns & Refunds":"Возвраты и возврат средств",
      "Support for issues, returns (if accepted) and refunds":"Помощь при проблемах, возвратах (если они принимаются) и возврате средств",
      "We want you to be happy with your purchase. If something is wrong, contact us and we’ll help.":"Мы хотим, чтобы вы были довольны покупкой. Если что-то не так, свяжитесь с нами — мы поможем.",
      "Damaged / wrong item":"Повреждённый / неправильный товар",
      "If your order arrives damaged or you receive the wrong item, please contact us within":"Если заказ пришёл повреждённым или вы получили не тот товар, пожалуйста, свяжитесь с нами в течение",
      "7 days":"7 дней",
      "of delivery.":"с момента доставки.",
      "Include your order details and photos.":"Укажите данные заказа и приложите фотографии.",
      "We will arrange replacement or refund where applicable.":"В соответствующих случаях мы организуем замену или возврат средств.",
      "Returns (if accepted)":"Возврат товара (если принимается)",
      "Returns may be accepted in certain cases. Items must be unused and in original condition.":"В некоторых случаях возврат товара может быть принят. Товар должен быть неиспользованным и в первоначальном состоянии.",
      "Return shipping costs are paid by the buyer (unless we made a mistake).":"Расходы на обратную доставку оплачивает покупатель (если ошибка была не с нашей стороны).",
      "We recommend using a tracked service.":"Рекомендуем использовать доставку с отслеживанием.",
      "Refunds":"Возврат средств",
      "Approved refunds are processed back to the original payment method.\n              Bank processing time can take a few business days.":"Одобренный возврат средств производится на исходный способ оплаты.\n              Банковская обработка может занять несколько рабочих дней.",
      "How to contact us":"Как с нами связаться",
      "Email:":"Электронная почта:",
      "Please include: order/session ID (if available) and a short description.":"Пожалуйста, укажите ID заказа/сессии (если имеется) и кратко опишите ситуацию.",
      "Important":"Важно",
      "We do not accept returns for custom or personalized items unless they arrive damaged or defective.":"Мы не принимаем возвраты индивидуальных или персонализированных товаров, кроме случаев, когда они пришли повреждёнными или с дефектом.",
      "Worldwide tracked shipping • Processing & delivery info":"Доставка по всему миру с отслеживанием • Обработка и сроки доставки",
      "← Back to Shop":"← Назад в магазин",
      "We ship mosaic pins worldwide. Below is a simple overview of processing time, delivery and tracking.":"Мы отправляем Mosaic Pins по всему миру. Ниже — краткая информация о сроках обработки заказа, доставке и отслеживании.",
      "Processing time":"Срок обработки",
      "Orders are typically processed within":"Обычно заказы обрабатываются в течение",
      "1–3 business days":"1–3 рабочих дней",
      ".\n              During peak periods it may take a little longer.":".\n              В периоды высокой загрузки обработка может занять немного больше времени.",
      "Handcrafted & carefully packed":"Ручная работа и бережная упаковка",
      "Shipping & tracking":"Доставка и отслеживание",
      "All shipments include a":"Все отправления имеют",
      "tracking number":"номер отслеживания",
      ".\n              Packages are sent as tracked parcels (up to":".\n              Посылки отправляются с отслеживанием (до",
      "2 kg":"2 кг",
      ").":").",
      "Tracking updates may appear with a delay.":"Обновления отслеживания могут появляться с задержкой.",
      "Delivery time depends on destination and carrier.":"Срок доставки зависит от страны назначения и перевозчика.",
      "Live DHL shipping rates":"Актуальные тарифы DHL",
      "Shipping is calculated automatically in your cart using the current DHL rate for your destination.\n              We use a":"Стоимость доставки автоматически рассчитывается в корзине по актуальному тарифу DHL для выбранной страны.\n              Мы используем",
      "tracked DHL Paket up to 2 kg":"DHL Paket с отслеживанием до 2 кг",
      "whenever that service is available.":"если эта услуга доступна для выбранного направления.",
      "Select your shipping country in the cart.":"Выберите страну доставки в корзине.",
      "The current tracked DHL price appears before payment.":"Актуальная стоимость DHL с отслеживанием отображается до оплаты.",
      "The same destination and rate are verified again on the server during checkout.":"Страна назначения и тариф повторно проверяются сервером при оформлении заказа.",
      "No fixed country zones • live destination pricing":"Без фиксированных зон • актуальная цена для страны назначения",
      "Delivery estimates":"Ориентировочные сроки доставки",
      "Delivery time depends on the destination, customs processing and the local delivery network.\n              Your tracking number will be emailed after dispatch.":"Срок доставки зависит от страны назначения, таможенного оформления и местной службы доставки.\n              После отправки номер отслеживания будет отправлен вам по электронной почте.",
      "Delivery estimates are not guarantees.":"Указанные сроки доставки являются ориентировочными.",
      "Customs & import taxes":"Таможенные и импортные сборы",
      "International orders may be subject to customs fees, VAT or import taxes.\n              These charges are the buyer’s responsibility.":"Международные заказы могут облагаться таможенными сборами, НДС или импортными налогами.\n              Эти расходы оплачивает покупатель.",
      "Need help with shipping?":"Нужна помощь с доставкой?",
      "Contact:":"Контакт:",
      "Shop":"Магазин","About":"О нас","Shipping":"Доставка","Returns":"Возврат","Reviews":"Отзывы",
      "Filters":"Фильтры","Cart":"Корзина","In stock":"В наличии","Selected":"Выбрано","Clear":"Очистить",
      "Diameter (Ø)":"Диаметр (Ø)","Shipping country":"Страна доставки","Subtotal":"Товары","Total":"Итого",
      "Checkout":"Оплатить картой","Clear cart":"Очистить корзину","PayPal is loading…":"PayPal загружается…",
      "Your cart is empty.":"Корзина пуста.","Add to cart":"Добавить в корзину","Pay by card":"Оплатить картой",
      "Quantity":"Количество","Loading…":"Загрузка…","No image":"Нет изображения","Product":"Товар","Notice":"Сообщение",
      "Sold out":"Нет в наличии","Buy":"Купить","All":"Все","Any size":"Любой размер","Exact":"Точно",
      "Privacy Policy":"Конфиденциальность","Impressum":"Реквизиты","Support":"Поддержка",
      "Choose a destination to calculate DHL tracked shipping.":"Выберите страну, чтобы рассчитать доставку DHL с отслеживанием.",
      "Loading DHL countries…":"Загрузка стран DHL…","Add an item to calculate shipping.":"Добавьте товар, чтобы рассчитать доставку.",
      "Please select a shipping country and wait for the DHL rate.":"Выберите страну доставки и дождитесь расчёта DHL.",
      "Legal":"Правовая информация",
      "How we collect, use, and protect your data":"Как мы собираем, используем и защищаем ваши данные",
      "Privacy Policy of Vitalijs Serguns / Mosaic Pins":"Политика конфиденциальности Vitalijs Serguns / Mosaic Pins",
      "This Privacy Policy explains how and when I collect, use, and share information when you purchase from me, contact me, or otherwise use my services through":"В этой Политике конфиденциальности объясняется, как и когда я собираю, использую и передаю информацию, когда вы покупаете у меня, связываетесь со мной или иным образом пользуетесь моими услугами через",
      "1. Information I Collect":"1. Какие данные я собираю",
      "To fulfill your order, I need certain information, including your name, email address, mailing address, payment details, and information about the product you ordered.":"Для выполнения вашего заказа мне необходимы определённые данные, включая имя, адрес электронной почты, почтовый адрес, платёжные данные и информацию о заказанном товаре.",
      "When you contact me directly, you may also provide additional personal information (for example, for custom orders).":"При прямом обращении ко мне вы также можете предоставить дополнительные персональные данные (например, для индивидуальных заказов).",
      "2. Why I Need Your Information and How I Use It":"2. Зачем мне нужны ваши данные и как я их использую",
      "I collect, use, and share your information based on several legal grounds, including:":"Я собираю, использую и передаю ваши данные на нескольких правовых основаниях, включая:",
      "When necessary to provide my services, such as fulfilling orders, resolving disputes, and offering customer support;":"Когда это необходимо для предоставления моих услуг, например для выполнения заказов, разрешения споров и поддержки клиентов;",
      "When required to comply with legal obligations, such as storing tax-related information about your purchases;":"Когда это требуется для выполнения юридических обязательств, например хранения налоговой информации о ваших покупках;",
      "To the extent necessary for my legitimate business interests, provided these interests do not override your rights and interests (for example, to provide and improve my services).":"В объёме, необходимом для моих законных деловых интересов, при условии, что они не имеют приоритета над вашими правами и интересами (например, для предоставления и улучшения моих услуг).",
      "I do not use your information for marketing or promotional emails.":"Я не использую ваши данные для маркетинговых или рекламных писем.",
      "3. Information Sharing and Disclosure":"3. Передача и раскрытие информации",
      "Your information is important to my business. I share your personal information only in the following circumstances:":"Ваши данные важны для моей работы. Я передаю персональную информацию только в следующих случаях:",
      "Service Providers:":"Поставщики услуг:",
      "I may use trusted third parties (such as shipping companies) to fulfill orders. These parties receive only the information necessary to perform their services;":"Для выполнения заказов я могу привлекать доверенные третьи стороны (например, службы доставки). Они получают только данные, необходимые для оказания своих услуг;",
      "Legal Compliance:":"Соблюдение закона:",
      "I may disclose your information if required by law, to prevent fraud, or to protect the rights and safety of my customers and others.":"Я могу раскрыть ваши данные, если этого требует закон, для предотвращения мошенничества или защиты прав и безопасности моих клиентов и других лиц.",
      "4. Data Retention":"4. Хранение данных",
      "I retain your personal data only as long as necessary to fulfill my obligations and comply with legal requirements. Typically, data is kept for up to":"Я храню ваши персональные данные только столько, сколько необходимо для выполнения моих обязательств и соблюдения требований закона. Обычно данные хранятся до",
      "4 years":"4 лет",
      "5. International Data Transfers":"5. Международная передача данных",
      "Your information may be stored and processed by third-party cloud services outside the EU. Where this occurs, I take reasonable steps to ensure such transfers comply with GDPR requirements.":"Ваши данные могут храниться и обрабатываться сторонними облачными сервисами за пределами ЕС. В таких случаях я принимаю разумные меры, чтобы такая передача соответствовала требованиям GDPR.",
      "6. Your Rights":"6. Ваши права",
      "If you reside in the EU, you have certain rights regarding your personal data, including:":"Если вы проживаете в ЕС, у вас есть определённые права в отношении персональных данных, включая:",
      "Access and obtaining a copy of your data;":"Доступ к данным и получение их копии;",
      "Correction, restriction, or deletion of your data;":"Исправление, ограничение обработки или удаление данных;",
      "Objecting to processing and marketing communications;":"Возражение против обработки данных и маркетинговых сообщений;",
      "Filing complaints with EU data protection authorities.":"Подачу жалоб в органы по защите данных ЕС.",
      "Contact Me":"Связаться со мной",
      "As the data controller under EU law, I am":"В соответствии с законодательством ЕС ответственным за обработку данных являюсь я,",
      "For any questions or concerns, please contact me at:":"По любым вопросам, пожалуйста, свяжитесь со мной по адресу:",
      "Legal notice (Germany)":"Правовая информация (Германия)",
      "Information according to § 5 TMG":"Информация согласно § 5 TMG",
      "Provider information and contact details.":"Информация о продавце и контактные данные.",
      "Name":"Имя",
      "Address":"Адрес",
      "Germany":"Германия",
      "Email":"Электронная почта",
      "VAT ID (USt-IdNr.)":"Номер НДС (USt-IdNr.)",
      "Disclaimer":"Отказ от ответственности",
      "Despite careful control, we assume no liability for the content of external links. The operators of the linked pages are solely responsible for their content.":"Несмотря на тщательную проверку, мы не несём ответственности за содержание внешних ссылок. За содержание связанных страниц отвечают исключительно их владельцы.",
      "Legal details":"Юридические данные",
      "Contact":"Контакты",
      "About us":"О нас",
      "Gallery":"Галерея",
      "Previous":"Назад",
      "Next":"Вперёд",
      "Close":"Закрыть",
      "Gallery large":"Увеличенное изображение галереи",
      "How it works":"Как это работает",
      "Leave a review and share your experience.":"Оставьте отзыв и поделитесь своим впечатлением.",
      "Rating: 1–5 stars.":"Оценка: 1–5 звёзд.",
      "Customer reviews":"Отзывы покупателей",
      "Average rating":"Средняя оценка",
      "Average stars":"Средняя оценка в звёздах",
      "Leave a review":"Оставить отзыв",
      "Will be published after approval":"Будет опубликован после одобрения",
      "Country (optional)":"Страна (необязательно)",
      "Rating":"Оценка",
      "Selected: 5/5":"Выбрано: 5/5",
      "Review text":"Текст отзыва",
      "Photos (optional, up to 4)":"Фотографии (необязательно, до 4)",
      "Add photos to your review":"Добавьте фотографии к отзыву",
      "JPG, PNG or WebP · up to 4 photos · max 8 MB each":"JPG, PNG или WebP · до 4 фотографий · максимум 8 МБ каждая",
      "Choose photos":"Выбрать фотографии",
      "Send review":"Отправить отзыв",
      "Thank you very much for your feedback! 😉":"Большое спасибо за ваш отзыв! 😉",
      "Reviews":"Отзывы",
      "Showing customer reviews.":"Отзывы покупателей.",
      "No reviews yet. Be the first 🙂":"Отзывов пока нет. Будьте первым 🙂",
      "Published ✅ Thank you for your review!":"Опубликовано ✅ Спасибо за ваш отзыв!",
      "Your name":"Ваше имя",
      "Germany, USA…":"Германия, США…",
      "Tell us what you liked…":"Расскажите, что вам понравилось…",
      "Choose rating":"Выберите оценку",
      "Back to shop":"Назад в магазин",
      "Photo large":"Увеличенное фото",
      "Footer links":"Ссылки в подвале",
      "Payment canceled":"Платёж отменён",
      "❌ Payment canceled":"❌ Платёж отменён",
      "No worries — you can try again.":"Ничего страшного — вы можете попробовать ещё раз.",
      "← Back to home":"← На главную",
      "Payment success":"Платёж успешен",
      "✅ Payment successful":"✅ Платёж успешно выполнен",
      "Updating your cart…":"Обновляем вашу корзину…",
      "High-quality handcrafted mosaic pins for knife handles":"Высококачественные мозаичные пины ручной работы для рукоятей ножей"
    },
    fr: {
      "Info":"Infos",
      "Returns & Refunds":"Retours & remboursements",
      "Support for issues, returns (if accepted) and refunds":"Assistance en cas de problème, retours (s'ils sont acceptés) et remboursements",
      "We want you to be happy with your purchase. If something is wrong, contact us and we’ll help.":"Nous souhaitons que vous soyez satisfait de votre achat. En cas de problème, contactez-nous et nous vous aiderons.",
      "Damaged / wrong item":"Article endommagé / incorrect",
      "If your order arrives damaged or you receive the wrong item, please contact us within":"Si votre commande arrive endommagée ou si vous recevez le mauvais article, veuillez nous contacter dans les",
      "7 days":"7 jours",
      "of delivery.":"suivant la livraison.",
      "Include your order details and photos.":"Joignez les détails de votre commande et des photos.",
      "We will arrange replacement or refund where applicable.":"Nous organiserons un remplacement ou un remboursement lorsque cela s'applique.",
      "Returns (if accepted)":"Retours (s'ils sont acceptés)",
      "Returns may be accepted in certain cases. Items must be unused and in original condition.":"Les retours peuvent être acceptés dans certains cas. Les articles doivent être inutilisés et dans leur état d'origine.",
      "Return shipping costs are paid by the buyer (unless we made a mistake).":"Les frais de retour sont à la charge de l'acheteur (sauf si l'erreur vient de nous).",
      "We recommend using a tracked service.":"Nous recommandons un envoi avec suivi.",
      "Refunds":"Remboursements",
      "Approved refunds are processed back to the original payment method.\n              Bank processing time can take a few business days.":"Les remboursements approuvés sont effectués sur le moyen de paiement d'origine.\n              Le traitement bancaire peut prendre quelques jours ouvrés.",
      "How to contact us":"Comment nous contacter",
      "Email:":"E-mail :",
      "Please include: order/session ID (if available) and a short description.":"Veuillez indiquer l'ID de commande/session (si disponible) et une courte description.",
      "Important":"Important",
      "We do not accept returns for custom or personalized items unless they arrive damaged or defective.":"Nous n'acceptons pas les retours d'articles personnalisés ou fabriqués sur mesure, sauf s'ils arrivent endommagés ou défectueux.",
      "Worldwide tracked shipping • Processing & delivery info":"Livraison suivie dans le monde entier • Traitement et informations de livraison",
      "← Back to Shop":"← Retour à la boutique",
      "We ship mosaic pins worldwide. Below is a simple overview of processing time, delivery and tracking.":"Nous expédions les Mosaic Pins dans le monde entier. Voici un aperçu simple du délai de traitement, de la livraison et du suivi.",
      "Processing time":"Délai de traitement",
      "Orders are typically processed within":"Les commandes sont généralement traitées sous",
      "1–3 business days":"1 à 3 jours ouvrés",
      ".\n              During peak periods it may take a little longer.":".\n              En période de forte activité, le traitement peut prendre un peu plus de temps.",
      "Handcrafted & carefully packed":"Fabriqué à la main & soigneusement emballé",
      "Shipping & tracking":"Expédition & suivi",
      "All shipments include a":"Tous les envois comprennent un",
      "tracking number":"numéro de suivi",
      ".\n              Packages are sent as tracked parcels (up to":".\n              Les colis sont expédiés avec suivi (jusqu’à",
      "2 kg":"2 kg",
      ").":").",
      "Tracking updates may appear with a delay.":"Les mises à jour du suivi peuvent apparaître avec un certain délai.",
      "Delivery time depends on destination and carrier.":"Le délai de livraison dépend de la destination et du transporteur.",
      "Live DHL shipping rates":"Tarifs DHL en temps réel",
      "Shipping is calculated automatically in your cart using the current DHL rate for your destination.\n              We use a":"Les frais de livraison sont calculés automatiquement dans votre panier selon le tarif DHL actuel pour votre destination.\n              Nous utilisons un",
      "tracked DHL Paket up to 2 kg":"DHL Paket suivi jusqu’à 2 kg",
      "whenever that service is available.":"lorsque ce service est disponible.",
      "Select your shipping country in the cart.":"Sélectionnez votre pays de livraison dans le panier.",
      "The current tracked DHL price appears before payment.":"Le tarif DHL suivi actuel s’affiche avant le paiement.",
      "The same destination and rate are verified again on the server during checkout.":"La destination et le tarif sont vérifiés à nouveau sur le serveur lors du paiement.",
      "No fixed country zones • live destination pricing":"Pas de zones fixes • tarif actuel selon la destination",
      "Delivery estimates":"Délais de livraison estimés",
      "Delivery time depends on the destination, customs processing and the local delivery network.\n              Your tracking number will be emailed after dispatch.":"Le délai de livraison dépend de la destination, du traitement douanier et du réseau de livraison local.\n              Votre numéro de suivi vous sera envoyé par e-mail après l’expédition.",
      "Delivery estimates are not guarantees.":"Les délais indiqués ne sont pas garantis.",
      "Customs & import taxes":"Douane & taxes d’importation",
      "International orders may be subject to customs fees, VAT or import taxes.\n              These charges are the buyer’s responsibility.":"Les commandes internationales peuvent être soumises à des frais de douane, à la TVA ou à des taxes d’importation.\n              Ces frais sont à la charge de l’acheteur.",
      "Need help with shipping?":"Besoin d’aide pour la livraison ?",
      "Contact:":"Contact :",
      "Shop":"Boutique","About":"À propos","Shipping":"Livraison","Returns":"Retours","Reviews":"Avis",
      "Filters":"Filtres","Cart":"Panier","In stock":"En stock","Selected":"Sélectionné","Clear":"Effacer",
      "Diameter (Ø)":"Diamètre (Ø)","Shipping country":"Pays de livraison","Subtotal":"Sous-total","Total":"Total",
      "Checkout":"Payer par carte","Clear cart":"Vider le panier","PayPal is loading…":"Chargement de PayPal…",
      "Your cart is empty.":"Votre panier est vide.","Add to cart":"Ajouter au panier","Pay by card":"Payer par carte",
      "Quantity":"Quantité","Loading…":"Chargement…","No image":"Aucune image","Product":"Produit","Notice":"Information",
      "Sold out":"Épuisé","Buy":"Acheter","All":"Tous","Any size":"Toutes tailles","Exact":"Exact",
      "Privacy Policy":"Confidentialité","Impressum":"Mentions légales","Support":"Support",
      "Choose a destination to calculate DHL tracked shipping.":"Choisissez un pays pour calculer la livraison DHL avec suivi.",
      "Loading DHL countries…":"Chargement des pays DHL…","Add an item to calculate shipping.":"Ajoutez un article pour calculer la livraison.",
      "Please select a shipping country and wait for the DHL rate.":"Choisissez un pays de livraison et attendez le tarif DHL.",
      "Legal":"Mentions légales",
      "How we collect, use, and protect your data":"Comment nous collectons, utilisons et protégeons vos données",
      "Privacy Policy of Vitalijs Serguns / Mosaic Pins":"Politique de confidentialité de Vitalijs Serguns / Mosaic Pins",
      "This Privacy Policy explains how and when I collect, use, and share information when you purchase from me, contact me, or otherwise use my services through":"Cette politique de confidentialité explique comment et quand je collecte, utilise et partage des informations lorsque vous achetez auprès de moi, me contactez ou utilisez autrement mes services via",
      "1. Information I Collect":"1. Informations que je collecte",
      "To fulfill your order, I need certain information, including your name, email address, mailing address, payment details, and information about the product you ordered.":"Pour traiter votre commande, j’ai besoin de certaines informations, notamment votre nom, votre adresse e-mail, votre adresse postale, vos informations de paiement et les informations concernant le produit commandé.",
      "When you contact me directly, you may also provide additional personal information (for example, for custom orders).":"Lorsque vous me contactez directement, vous pouvez également fournir des informations personnelles supplémentaires (par exemple pour une commande personnalisée).",
      "2. Why I Need Your Information and How I Use It":"2. Pourquoi j’ai besoin de vos informations et comment je les utilise",
      "I collect, use, and share your information based on several legal grounds, including:":"Je collecte, utilise et partage vos informations sur plusieurs bases juridiques, notamment :",
      "When necessary to provide my services, such as fulfilling orders, resolving disputes, and offering customer support;":"Lorsque cela est nécessaire pour fournir mes services, notamment traiter les commandes, résoudre les litiges et assurer le support client ;",
      "When required to comply with legal obligations, such as storing tax-related information about your purchases;":"Lorsque cela est nécessaire pour respecter des obligations légales, par exemple conserver des informations fiscales relatives à vos achats ;",
      "To the extent necessary for my legitimate business interests, provided these interests do not override your rights and interests (for example, to provide and improve my services).":"Dans la mesure nécessaire à mes intérêts commerciaux légitimes, à condition que ceux-ci ne prévalent pas sur vos droits et intérêts (par exemple pour fournir et améliorer mes services).",
      "I do not use your information for marketing or promotional emails.":"Je n’utilise pas vos informations pour des e-mails marketing ou promotionnels.",
      "3. Information Sharing and Disclosure":"3. Partage et divulgation des informations",
      "Your information is important to my business. I share your personal information only in the following circumstances:":"Vos informations sont importantes pour mon activité. Je ne partage vos données personnelles que dans les circonstances suivantes :",
      "Service Providers:":"Prestataires de services :",
      "I may use trusted third parties (such as shipping companies) to fulfill orders. These parties receive only the information necessary to perform their services;":"Je peux faire appel à des tiers de confiance (tels que des transporteurs) pour traiter les commandes. Ils ne reçoivent que les informations nécessaires à leurs services ;",
      "Legal Compliance:":"Respect des obligations légales :",
      "I may disclose your information if required by law, to prevent fraud, or to protect the rights and safety of my customers and others.":"Je peux divulguer vos informations si la loi l’exige, afin de prévenir la fraude ou de protéger les droits et la sécurité de mes clients et d’autres personnes.",
      "4. Data Retention":"4. Conservation des données",
      "I retain your personal data only as long as necessary to fulfill my obligations and comply with legal requirements. Typically, data is kept for up to":"Je conserve vos données personnelles uniquement pendant la durée nécessaire à l’exécution de mes obligations et au respect des exigences légales. En règle générale, les données sont conservées jusqu’à",
      "4 years":"4 ans",
      "5. International Data Transfers":"5. Transferts internationaux de données",
      "Your information may be stored and processed by third-party cloud services outside the EU. Where this occurs, I take reasonable steps to ensure such transfers comply with GDPR requirements.":"Vos informations peuvent être stockées et traitées par des services cloud tiers situés hors de l’UE. Dans ce cas, je prends des mesures raisonnables afin que ces transferts respectent les exigences du RGPD.",
      "6. Your Rights":"6. Vos droits",
      "If you reside in the EU, you have certain rights regarding your personal data, including:":"Si vous résidez dans l’UE, vous disposez de certains droits concernant vos données personnelles, notamment :",
      "Access and obtaining a copy of your data;":"Accéder à vos données et en obtenir une copie ;",
      "Correction, restriction, or deletion of your data;":"Rectifier, limiter ou supprimer vos données ;",
      "Objecting to processing and marketing communications;":"Vous opposer au traitement et aux communications marketing ;",
      "Filing complaints with EU data protection authorities.":"Déposer une plainte auprès des autorités de protection des données de l’UE.",
      "Contact Me":"Me contacter",
      "As the data controller under EU law, I am":"En tant que responsable du traitement au regard du droit de l’UE, je suis",
      "For any questions or concerns, please contact me at:":"Pour toute question ou préoccupation, veuillez me contacter à :",
      "Legal notice (Germany)":"Mentions légales (Allemagne)",
      "Information according to § 5 TMG":"Informations conformément au § 5 TMG",
      "Provider information and contact details.":"Informations sur le prestataire et coordonnées.",
      "Name":"Nom",
      "Address":"Adresse",
      "Germany":"Allemagne",
      "Email":"E-mail",
      "VAT ID (USt-IdNr.)":"N° de TVA (USt-IdNr.)",
      "Disclaimer":"Clause de non-responsabilité",
      "Despite careful control, we assume no liability for the content of external links. The operators of the linked pages are solely responsible for their content.":"Malgré un contrôle attentif, nous déclinons toute responsabilité quant au contenu des liens externes. Les exploitants des pages liées sont seuls responsables de leur contenu.",
      "Legal details":"Informations légales",
      "Contact":"Contact",
      "About us":"À propos de nous",
      "Gallery":"Galerie",
      "Previous":"Précédent",
      "Next":"Suivant",
      "Close":"Fermer",
      "Gallery large":"Grande image de la galerie",
      "How it works":"Comment ça marche",
      "Leave a review and share your experience.":"Laissez un avis et partagez votre expérience.",
      "Rating: 1–5 stars.":"Note : 1–5 étoiles.",
      "Customer reviews":"Avis clients",
      "Average rating":"Note moyenne",
      "Average stars":"Étoiles moyennes",
      "Leave a review":"Laisser un avis",
      "Will be published after approval":"Sera publié après validation",
      "Country (optional)":"Pays (facultatif)",
      "Rating":"Note",
      "Selected: 5/5":"Sélectionné : 5/5",
      "Review text":"Texte de l’avis",
      "Photos (optional, up to 4)":"Photos (facultatif, jusqu’à 4)",
      "Add photos to your review":"Ajoutez des photos à votre avis",
      "JPG, PNG or WebP · up to 4 photos · max 8 MB each":"JPG, PNG ou WebP · jusqu’à 4 photos · 8 Mo max. chacune",
      "Choose photos":"Choisir des photos",
      "Send review":"Envoyer l’avis",
      "Thank you very much for your feedback! 😉":"Merci beaucoup pour votre avis ! 😉",
      "Reviews":"Avis",
      "Showing customer reviews.":"Avis des clients.",
      "No reviews yet. Be the first 🙂":"Aucun avis pour le moment. Soyez le premier 🙂",
      "Published ✅ Thank you for your review!":"Publié ✅ Merci pour votre avis !",
      "Your name":"Votre nom",
      "Germany, USA…":"Allemagne, États-Unis…",
      "Tell us what you liked…":"Dites-nous ce que vous avez aimé…",
      "Choose rating":"Choisir une note",
      "Back to shop":"Retour à la boutique",
      "Photo large":"Photo agrandie",
      "Footer links":"Liens de pied de page",
      "Payment canceled":"Paiement annulé",
      "❌ Payment canceled":"❌ Paiement annulé",
      "No worries — you can try again.":"Pas de souci — vous pouvez réessayer.",
      "← Back to home":"← Retour à l’accueil",
      "Payment success":"Paiement réussi",
      "✅ Payment successful":"✅ Paiement réussi",
      "Updating your cart…":"Mise à jour de votre panier…",
      "High-quality handcrafted mosaic pins for knife handles":"Pins mosaïque artisanaux de haute qualité pour manches de couteaux"
    }
  };

  function getLang(){
    try {
      const saved = String(localStorage.getItem(LANG_KEY) || "").toLowerCase();
      if (SUPPORTED.includes(saved)) return saved;
    } catch (_) {}
    return "en";
  }

  const lang = getLang();
  document.documentElement.lang = lang;

  function injectStyles(){
    if (document.getElementById("mp-locale-style")) return;
    const style = document.createElement("style");
    style.id = "mp-locale-style";
    style.textContent = `
      .mp-locale-controls{
        display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;
        padding:3px;border:1px solid rgba(255,255,255,.10);border-radius:11px;
        background:rgba(8,13,19,.58);box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 7px 20px rgba(0,0,0,.12);
        backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)
      }
      .mp-locale-control,
      .mp-locale-controls .currency{
        box-sizing:border-box;height:36px;min-width:70px;margin:0!important;
        border:1px solid rgba(255,255,255,.07)!important;border-radius:8px!important;
        background-color:rgba(255,255,255,.045)!important;color:var(--text,#eef2f7)!important;
        background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23aeb8c5' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")!important;
        background-repeat:no-repeat!important;background-position:right 9px center!important;background-size:14px 14px!important;
        padding:0 30px 0 11px!important;font:800 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif!important;
        letter-spacing:.12px!important;outline:none!important;cursor:pointer!important;
        box-shadow:none!important;transition:border-color .15s ease,background-color .15s ease,box-shadow .15s ease!important;
        -webkit-appearance:none!important;appearance:none!important;color-scheme:dark
      }
      .mp-language-control{min-width:68px}
      .mp-locale-controls .currency{min-width:88px}
      .mp-locale-control:hover,.mp-locale-control:focus,
      .mp-locale-controls .currency:hover,.mp-locale-controls .currency:focus{
        border-color:rgba(34,197,94,.52)!important;background-color:rgba(34,197,94,.085)!important;
        box-shadow:0 0 0 2px rgba(34,197,94,.055)!important
      }
      .mp-top-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex:0 0 auto}
      .mp-top-actions>.btn,.mp-top-actions>.backBtn{margin:0}
      .mp-floating-language{position:fixed;right:14px;top:14px;z-index:9999;box-shadow:0 10px 30px rgba(0,0,0,.22)}

      /* About / Reviews / other cart pages: keep Cart + language + currency on one clean row. */
      @media(max-width:980px){
        .topbar{gap:10px}
        .top-right{
          width:100%!important;display:flex!important;align-items:center!important;
          grid-template-columns:none!important;gap:8px!important;flex-wrap:nowrap!important
        }
        .top-right>.cartBtn{
          width:auto!important;min-width:0!important;flex:1 1 auto!important;
          justify-content:center!important;min-height:42px!important;height:42px!important;
          padding:0 13px!important;border-radius:10px!important
        }
        .top-right>.mp-locale-controls{flex:0 0 auto!important}
        .mp-locale-controls{gap:5px;padding:3px;border-radius:10px}
        .mp-locale-control,.mp-locale-controls .currency{
          height:36px;min-width:66px;padding-left:10px!important;padding-right:27px!important;font-size:11px!important
        }
        .mp-locale-controls .currency{min-width:82px}
      }
      @media(max-width:520px){
        .top-right{grid-template-columns:none!important}
        .top-right>.cartBtn{font-size:14px!important}
        .mp-locale-control{min-width:62px}
        .mp-locale-controls .currency{min-width:78px}
      }


      /* Shop + Product only: polished compact mobile header controls. */
      @media(max-width:980px){
        body.mp-page-shop .topbar,
        body.mp-page-product .topbar{padding-bottom:10px!important}

        body.mp-page-shop .top-right{
          width:100%!important;display:grid!important;
          grid-template-columns:auto 1fr auto!important;
          align-items:center!important;gap:7px!important
        }
        body.mp-page-shop .top-right>.filtersBtn{
          grid-column:1!important;width:auto!important;min-width:44px!important;height:40px!important;
          padding:0 11px!important;border-radius:9px!important;white-space:nowrap!important
        }
        body.mp-page-shop .top-right>.cartBtn{
          grid-column:2!important;width:100%!important;height:40px!important;min-height:40px!important;
          padding:0 10px!important;border-radius:9px!important;white-space:nowrap!important
        }
        body.mp-page-shop .top-right>.toggle{
          grid-column:1 / 3!important;grid-row:2!important;width:100%!important;height:38px!important;
          min-height:38px!important;margin:0!important;padding:0 11px!important;border-radius:9px!important;
          display:flex!important;align-items:center!important;justify-content:center!important;white-space:nowrap!important
        }
        body.mp-page-shop .top-right>.mp-locale-controls{
          grid-column:3!important;grid-row:1 / 3!important;align-self:stretch!important;
          display:grid!important;grid-template-columns:1fr!important;gap:5px!important;padding:3px!important
        }
        body.mp-page-shop .top-right>.mp-locale-controls .mp-locale-control,
        body.mp-page-shop .top-right>.mp-locale-controls .currency{
          height:35px!important;min-width:78px!important
        }

        body.mp-page-product .topRight{
          width:100%!important;display:flex!important;align-items:center!important;gap:8px!important;flex-wrap:nowrap!important
        }
        body.mp-page-product .topRight>.cartBtn{
          flex:1 1 auto!important;width:auto!important;height:42px!important;min-height:42px!important;
          justify-content:center!important;padding:0 12px!important;border-radius:9px!important
        }
        body.mp-page-product .topRight>.mp-locale-controls{flex:0 0 auto!important}
        body.mp-page-product .topRight>.mp-locale-controls .mp-locale-control,
        body.mp-page-product .topRight>.mp-locale-controls .currency{height:36px!important}
      }
      @media(max-width:520px){
        body.mp-page-shop .top-right{gap:6px!important}
        body.mp-page-shop .top-right>.filtersBtn{font-size:0!important;width:42px!important;padding:0!important}
        body.mp-page-shop .top-right>.filtersBtn::before{content:"☰";font-size:16px!important}
        body.mp-page-shop .top-right>.filtersBtn .filtersBadge{font-size:10px!important;margin-left:3px!important}
        body.mp-page-shop .top-right>.mp-locale-controls .mp-locale-control,
        body.mp-page-shop .top-right>.mp-locale-controls .currency{min-width:76px!important;font-size:11px!important}
        body.mp-page-product .topRight>.mp-locale-controls .mp-locale-control{min-width:62px!important}
        body.mp-page-product .topRight>.mp-locale-controls .currency{min-width:78px!important}
      }

      /* Shop mobile: keep the exact approved layout; only hide the numeric filter badge. */
      #openFilters #filtersBadge{display:none!important}

      /* Desktop locale controls: custom dropdowns avoid the native Windows/Chrome popup look. */
      .mp-desktop-select{display:none;position:relative}
      .mp-desktop-select-btn{
        height:36px;min-width:70px;display:flex;align-items:center;justify-content:space-between;gap:10px;
        border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:0 10px 0 11px;
        background:rgba(255,255,255,.045);color:var(--text,#eef2f7);
        font:800 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.12px;
        cursor:pointer;outline:none;box-shadow:none;
        transition:border-color .15s ease,background .15s ease,box-shadow .15s ease,transform .15s ease
      }
      .mp-desktop-select-btn:hover,
      .mp-desktop-select.open .mp-desktop-select-btn{
        border-color:rgba(34,197,94,.52);background:rgba(34,197,94,.085);
        box-shadow:0 0 0 2px rgba(34,197,94,.055)
      }
      .mp-desktop-select-btn:active{transform:translateY(1px)}
      .mp-desktop-select-chevron{
        width:14px;height:14px;flex:0 0 14px;opacity:.78;transition:transform .16s ease
      }
      .mp-desktop-select.open .mp-desktop-select-chevron{transform:rotate(180deg)}
      .mp-desktop-select-menu{
        position:fixed;left:0;top:0;z-index:2147483000;min-width:70px;padding:5px;
        border:1px solid rgba(255,255,255,.11);border-radius:10px;
        background:rgba(12,18,25,.98);box-shadow:0 18px 50px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.035);
        backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
        opacity:0;visibility:hidden;pointer-events:none;transform:translateY(-4px) scale(.98);transform-origin:top right;
        transition:opacity .14s ease,visibility .14s ease,transform .14s ease
      }
      .mp-desktop-select-menu.open{
        opacity:1;visibility:visible;pointer-events:auto;transform:translateY(0) scale(1)
      }
      .mp-desktop-select-option{
        width:100%;height:34px;border:0;border-radius:7px;padding:0 10px;text-align:left;
        display:flex;align-items:center;justify-content:space-between;gap:12px;
        background:transparent;color:var(--text,#eef2f7);font:750 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
        cursor:pointer;white-space:nowrap;transition:background .12s ease,color .12s ease
      }
      .mp-desktop-select-option:hover{background:rgba(255,255,255,.065)}
      .mp-desktop-select-option.active{background:rgba(34,197,94,.12);color:#86efac}
      .mp-desktop-select-option.active::after{content:"✓";font-weight:900;color:#22c55e}
      @media(min-width:981px){
        .mp-locale-controls>select.mp-native-locale{display:none!important}
        .mp-desktop-select{display:block}
        .mp-desktop-select.mp-kind-lang .mp-desktop-select-btn{min-width:68px}
        .mp-desktop-select.mp-kind-currency .mp-desktop-select-btn{min-width:88px}
        .mp-locale-controls{
          padding:0!important;border:0!important;border-radius:0!important;
          background:transparent!important;box-shadow:none!important;
          backdrop-filter:none!important;-webkit-backdrop-filter:none!important;
        }
      }


      /* FINAL mobile Shop layout: preserve the approved positions exactly. */
      @media(max-width:980px){
        body.mp-page-shop .top-right{
          width:100%!important;
          display:grid!important;
          grid-template-columns:72px minmax(0,1fr) 138px!important;
          grid-template-rows:70px 70px!important;
          gap:8px!important;
          align-items:stretch!important;
        }
        body.mp-page-shop #openFilters{
          grid-column:1!important;grid-row:1!important;
          width:72px!important;height:70px!important;min-width:72px!important;
          margin:0!important;padding:0!important;
          display:flex!important;align-items:center!important;justify-content:center!important;
          font-size:0!important;border-radius:12px!important;
        }
        body.mp-page-shop #openFilters::before{
          content:"☰"!important;font-size:26px!important;line-height:1!important;
        }
        body.mp-page-shop #filtersBadge{display:none!important;}
        body.mp-page-shop #openCart{
          grid-column:2!important;grid-row:1!important;
          width:100%!important;height:70px!important;min-height:70px!important;
          margin:0!important;border-radius:12px!important;
          display:flex!important;align-items:center!important;justify-content:center!important;
        }
        body.mp-page-shop .top-right>.toggle{
          grid-column:1 / 3!important;grid-row:2!important;
          width:100%!important;height:70px!important;min-height:70px!important;
          margin:0!important;border-radius:12px!important;
          display:flex!important;align-items:center!important;justify-content:center!important;
        }
        body.mp-page-shop .top-right>.mp-locale-controls{
          grid-column:3!important;grid-row:1 / 3!important;
          display:grid!important;grid-template-columns:1fr!important;grid-template-rows:1fr 1fr!important;
          gap:8px!important;padding:0!important;border:0!important;background:transparent!important;
          box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;
          align-self:stretch!important;
        }
        body.mp-page-shop .top-right>.mp-locale-controls .mp-locale-control,
        body.mp-page-shop .top-right>.mp-locale-controls .currency{
          width:100%!important;min-width:0!important;height:70px!important;
          margin:0!important;border-radius:12px!important;font-size:16px!important;
          padding-left:18px!important;padding-right:36px!important;
        }
      }
      @media(max-width:520px){
        body.mp-page-shop .top-right{
          grid-template-columns:72px minmax(0,1fr) 138px!important;
          grid-template-rows:70px 70px!important;
        }
      }

      /* Legal/info pages: compact back button and language selector share one row. */
      @media(max-width:980px){
        .mp-top-actions{
          width:100%!important;display:flex!important;align-items:center!important;
          justify-content:space-between!important;gap:8px!important;flex-wrap:nowrap!important
        }
        .mp-top-actions>.backBtn,
        .mp-top-actions>.btn.backBtn{
          order:1!important;width:auto!important;flex:1 1 auto!important;
          min-height:42px!important;height:42px!important;padding:0 14px!important;
          border-radius:10px!important;box-shadow:0 8px 18px rgba(34,197,94,.14)!important
        }
        .mp-top-actions>.mp-locale-controls{order:2!important;flex:0 0 auto!important}
      }

      /* FINAL unified controls for every page EXCEPT Shop/index.
         Keep the page background/layout intact; only normalize action controls. */
      @media(max-width:980px){
        body:not(.mp-page-shop) .mp-locale-controls{
          gap:8px!important;padding:0!important;border:0!important;border-radius:0!important;
          background:transparent!important;box-shadow:none!important;backdrop-filter:none!important;
          -webkit-backdrop-filter:none!important
        }

        body:not(.mp-page-shop) .mp-locale-control,
        body:not(.mp-page-shop) .mp-locale-controls .currency{
          height:48px!important;min-height:48px!important;
          border:1px solid rgba(255,255,255,.10)!important;
          border-radius:12px!important;
          background-color:rgba(255,255,255,.045)!important;
          color:var(--text,#eef2f7)!important;
          padding-left:16px!important;padding-right:38px!important;
          font-size:14px!important;font-weight:850!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.025)!important
        }

        body:not(.mp-page-shop) .mp-locale-control:focus,
        body:not(.mp-page-shop) .mp-locale-controls .currency:focus{
          border-color:rgba(34,197,94,.48)!important;
          background-color:rgba(34,197,94,.07)!important;
          box-shadow:0 0 0 2px rgba(34,197,94,.055)!important
        }

        /* Product / About / Reviews: Cart + language + currency in one clean row. */
        body.mp-page-product .topRight,
        body.mp-page-about .top-right,
        body.mp-page-reviews .top-right{
          width:100%!important;display:flex!important;align-items:center!important;
          gap:8px!important;flex-wrap:nowrap!important;grid-template-columns:none!important
        }
        body.mp-page-product .topRight>.cartBtn,
        body.mp-page-about .top-right>.cartBtn,
        body.mp-page-reviews .top-right>.cartBtn{
          flex:0 1 auto!important;width:auto!important;min-width:0!important;
          height:48px!important;min-height:48px!important;
          padding:0 14px!important;border-radius:999px!important;
          display:inline-flex!important;align-items:center!important;justify-content:center!important;
          background:rgba(0,0,0,.28)!important;border:1px solid var(--line)!important;
          box-shadow:none!important;white-space:nowrap!important
        }
        body.mp-page-product .topRight>.mp-locale-controls,
        body.mp-page-about .top-right>.mp-locale-controls,
        body.mp-page-reviews .top-right>.mp-locale-controls{
          flex:0 0 auto!important;display:flex!important;align-items:center!important;gap:8px!important
        }
        body.mp-page-product .topRight>.mp-locale-controls .mp-language-control,
        body.mp-page-about .top-right>.mp-locale-controls .mp-language-control,
        body.mp-page-reviews .top-right>.mp-locale-controls .mp-language-control{
          width:110px!important;min-width:110px!important
        }
        body.mp-page-product .topRight>.mp-locale-controls .currency,
        body.mp-page-about .top-right>.mp-locale-controls .currency,
        body.mp-page-reviews .top-right>.mp-locale-controls .currency{
          width:128px!important;min-width:128px!important
        }

        /* Information/legal pages: compact dark Back button + language control. */
        body.mp-page-shipping .mp-top-actions,
        body.mp-page-returns .mp-top-actions,
        body.mp-page-privacy .mp-top-actions,
        body.mp-page-impressum .mp-top-actions{
          width:100%!important;display:flex!important;align-items:center!important;
          justify-content:flex-start!important;gap:8px!important;flex-wrap:nowrap!important
        }
        body.mp-page-shipping .mp-top-actions>.backBtn,
        body.mp-page-returns .mp-top-actions>.backBtn,
        body.mp-page-privacy .mp-top-actions>.backBtn,
        body.mp-page-impressum .mp-top-actions>.backBtn{
          flex:1 1 auto!important;width:auto!important;height:48px!important;min-height:48px!important;
          margin:0!important;padding:0 16px!important;border-radius:12px!important;
          display:flex!important;align-items:center!important;justify-content:center!important;
          background:rgba(0,0,0,.28)!important;border:1px solid var(--line)!important;
          color:var(--text,#eef2f7)!important;box-shadow:none!important;font-weight:900!important
        }
        body.mp-page-shipping .mp-top-actions>.mp-locale-controls,
        body.mp-page-returns .mp-top-actions>.mp-locale-controls,
        body.mp-page-privacy .mp-top-actions>.mp-locale-controls,
        body.mp-page-impressum .mp-top-actions>.mp-locale-controls{
          flex:0 0 auto!important
        }
        body.mp-page-shipping .mp-top-actions .mp-language-control,
        body.mp-page-returns .mp-top-actions .mp-language-control,
        body.mp-page-privacy .mp-top-actions .mp-language-control,
        body.mp-page-impressum .mp-top-actions .mp-language-control{
          width:110px!important;min-width:110px!important
        }
      }

      @media(max-width:520px){
        body.mp-page-product .topRight>.cartBtn,
        body.mp-page-about .top-right>.cartBtn,
        body.mp-page-reviews .top-right>.cartBtn{
          flex:1 1 auto!important;padding:0 10px!important
        }
        body.mp-page-product .topRight>.mp-locale-controls .mp-language-control,
        body.mp-page-about .top-right>.mp-locale-controls .mp-language-control,
        body.mp-page-reviews .top-right>.mp-locale-controls .mp-language-control{
          width:78px!important;min-width:78px!important
        }
        body.mp-page-product .topRight>.mp-locale-controls .currency,
        body.mp-page-about .top-right>.mp-locale-controls .currency,
        body.mp-page-reviews .top-right>.mp-locale-controls .currency{
          width:104px!important;min-width:104px!important
        }
        body.mp-page-shipping .mp-top-actions .mp-language-control,
        body.mp-page-returns .mp-top-actions .mp-language-control,
        body.mp-page-privacy .mp-top-actions .mp-language-control,
        body.mp-page-impressum .mp-top-actions .mp-language-control{
          width:84px!important;min-width:84px!important
        }
      }
    `;
    document.head.appendChild(style);
  }

  function buildLanguageControl(){
    const language = document.createElement("select");
    language.id = "language";
    language.className = "mp-locale-control mp-language-control";
    language.title = "Language";
    language.setAttribute("aria-label", "Language");
    language.setAttribute("translate", "no");
    language.innerHTML = `
      <option value="en">EN</option>
      <option value="de">DE</option>
      <option value="ru">RU</option>
      <option value="fr">FR</option>`;
    language.value = lang;
    language.addEventListener("change", () => {
      try { localStorage.setItem(LANG_KEY, language.value); } catch (_) {}
      location.reload();
    });
    return language;
  }

  function enhanceDesktopSelect(select, kind){
    if (!select || select.dataset.mpDesktopEnhanced === "1") return;
    select.dataset.mpDesktopEnhanced = "1";
    select.classList.add("mp-native-locale");

    const wrap = document.createElement("div");
    wrap.className = `mp-desktop-select mp-kind-${kind || "default"}`;
    wrap.setAttribute("translate", "no");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "mp-desktop-select-btn";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");

    const label = document.createElement("span");
    const chevron = document.createElement("span");
    chevron.className = "mp-desktop-select-chevron";
    chevron.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
    button.append(label, chevron);

    const menu = document.createElement("div");
    menu.className = "mp-desktop-select-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("translate", "no");

    const positionMenu = () => {
      if (!menu.classList.contains("open")) return;
      const rect = button.getBoundingClientRect();
      const gap = 7, edge = 8;
      const width = Math.max(rect.width, kind === "currency" ? 88 : 70);
      menu.style.width = `${Math.round(width)}px`;
      menu.style.minWidth = `${Math.round(width)}px`;
      const menuHeight = menu.offsetHeight || 44;
      let top = rect.bottom + gap;
      if (top + menuHeight > window.innerHeight - edge && rect.top - gap - menuHeight >= edge) {
        top = rect.top - gap - menuHeight;
        menu.style.transformOrigin = "bottom right";
      } else menu.style.transformOrigin = "top right";
      let left = rect.right - width;
      left = Math.max(edge, Math.min(left, window.innerWidth - width - edge));
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
    };

    const close = () => {
      wrap.classList.remove("open");
      menu.classList.remove("open");
      button.setAttribute("aria-expanded", "false");
    };

    const sync = () => {
      const selected = select.options[select.selectedIndex];
      label.textContent = selected ? selected.textContent.trim() : "";
      [...menu.querySelectorAll(".mp-desktop-select-option")].forEach(opt => {
        opt.classList.toggle("active", opt.dataset.value === select.value);
      });
    };

    [...select.options].forEach(option => {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "mp-desktop-select-option";
      opt.dataset.value = option.value;
      opt.textContent = option.textContent.trim();
      opt.setAttribute("role", "option");
      opt.addEventListener("click", (e) => {
        e.stopPropagation();
        if (select.value !== option.value) {
          select.value = option.value;
          select.dispatchEvent(new Event("change", { bubbles:true }));
        }
        sync();
        close();
      });
      menu.appendChild(opt);
    });

    button.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".mp-desktop-select.open").forEach(other => {
        if (other !== wrap && typeof other._mpClose === "function") other._mpClose();
      });
      const open = !wrap.classList.contains("open");
      if (open) {
        wrap.classList.add("open");
        menu.classList.add("open");
        button.setAttribute("aria-expanded", "true");
        positionMenu();
        requestAnimationFrame(positionMenu);
      } else close();
    });

    select.addEventListener("change", sync);
    select.insertAdjacentElement("afterend", wrap);
    wrap.append(button);
    document.body.appendChild(menu);
    wrap._mpMenu = menu;
    wrap._mpClose = close;
    wrap._mpPosition = positionMenu;
    sync();
  }

  let mpDesktopCloseWired = false;
  function wireDesktopSelectClose(){
    if (mpDesktopCloseWired) return;
    mpDesktopCloseWired = true;
    const closeAll = () => {
      document.querySelectorAll(".mp-desktop-select.open").forEach(wrap => {
        if (typeof wrap._mpClose === "function") wrap._mpClose();
      });
      document.querySelectorAll(".mp-desktop-select-menu.open").forEach(menu => menu.classList.remove("open"));
    };
    document.addEventListener("click", closeAll);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });
    const repositionOpen = () => {
      document.querySelectorAll(".mp-desktop-select.open").forEach(wrap => {
        if (typeof wrap._mpPosition === "function") wrap._mpPosition();
      });
    };
    window.addEventListener("resize", repositionOpen, { passive:true });
    window.addEventListener("scroll", repositionOpen, { passive:true, capture:true });
  }

  function setupControls(){
    injectStyles();
    if (document.getElementById("language")) return;

    const language = buildLanguageControl();
    const currency = document.getElementById("currency");
    const localeGroup = document.createElement("div");
    localeGroup.className = "mp-locale-controls";
    localeGroup.setAttribute("translate", "no");
    localeGroup.appendChild(language);
    enhanceDesktopSelect(language, "lang");
    wireDesktopSelectClose();

    if (currency && currency.parentNode) {
      currency.setAttribute("translate", "no");
      currency.setAttribute("aria-label", "Currency");
      currency.parentNode.insertBefore(localeGroup, currency);
      localeGroup.appendChild(currency);
      enhanceDesktopSelect(currency, "currency");
      return;
    }

    // Informational/legal pages have no currency. Keep the language control
    // inside the real top bar instead of floating over the page.
    const topbar = document.querySelector(".topbar");
    if (topbar) {
      const back = topbar.querySelector(".backBtn");
      if (back) {
        const actions = document.createElement("div");
        actions.className = "mp-top-actions";
        topbar.insertBefore(actions, back);
        actions.appendChild(localeGroup);
        actions.appendChild(back);
      } else {
        const right = topbar.querySelector(".top-right,.topRight");
        if (right) right.appendChild(localeGroup);
        else topbar.appendChild(localeGroup);
      }
      return;
    }

    localeGroup.classList.add("mp-floating-language");
    document.body.appendChild(localeGroup);
  }

  const dict = TEXT[lang] || {};

  function translatePlainText(text){
    if (lang === "en") return text;
    const trimmed = text.trim();
    if (!trimmed) return text;
    if (dict[trimmed]) return text.replace(trimmed, dict[trimmed]);

    // Static page copy is sometimes line-wrapped in HTML. Match the same text
    // after collapsing whitespace so translations are not broken by formatting.
    const compact = trimmed.replace(/\s+/g, " ");
    if (compact !== trimmed && dict[compact]) return text.replace(trimmed, dict[compact]);

    let m = trimmed.match(/^In stock:\s*(\d+)$/i);
    if (m) {
      const base = lang === "de" ? "Auf Lager" : lang === "ru" ? "В наличии" : "En stock";
      return text.replace(trimmed, `${base}: ${m[1]}`);
    }
    m = trimmed.match(/^(\d+)\s+items?$/i);
    if (m) {
      const word = lang === "de" ? "Artikel" : lang === "ru" ? "товаров" : "articles";
      return text.replace(trimmed, `${m[1]} ${word}`);
    }
    return text;
  }

  function translateElement(el){
    if (!(el instanceof Element)) return;
    if (el.closest("#language") || el.matches("script,style,option")) return;

    const attrs = ["title", "placeholder", "aria-label"];
    for (const attr of attrs) {
      const v = el.getAttribute(attr);
      if (v && dict[v]) el.setAttribute(attr, dict[v]);
    }

    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const next = translatePlainText(node.nodeValue || "");
        if (next !== node.nodeValue) node.nodeValue = next;
      }
    }
  }

  function translateTree(root=document.body){
    if (lang === "en" || !root) return;
    if (root instanceof Element) translateElement(root);
    root.querySelectorAll?.("*").forEach(translateElement);
  }

  function wireTranslations(){
    translateTree(document.body);
    if (lang === "en" || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          const node = mutation.target;
          const next = translatePlainText(node.nodeValue || "");
          if (next !== node.nodeValue) node.nodeValue = next;
        }
        for (const added of mutation.addedNodes || []) {
          if (added.nodeType === Node.TEXT_NODE) {
            const next = translatePlainText(added.nodeValue || "");
            if (next !== added.nodeValue) added.nodeValue = next;
          } else if (added.nodeType === Node.ELEMENT_NODE) {
            translateTree(added);
          }
        }
      }
    });
    observer.observe(document.body, {subtree:true, childList:true, characterData:true});
  }

  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  const order = [
    ["Shop", "/"], ["About", "/about"], ["Shipping", "/shipping"],
    ["Returns", "/returns"], ["Reviews", "/reviews"]
  ];
  const nav = document.querySelector(".sidebar .sb-nav, .sidebar .nav, .sidebar nav");
  if (nav) {
    const links = new Map([...nav.querySelectorAll("a.nav-item")].map(a => [a.textContent.trim(), a]));
    for (const [label, href] of order) {
      const a = links.get(label);
      if (a) { a.href = href; nav.appendChild(a); }
    }
    const path = location.pathname.replace(/\.html$/, "") || "/";
    for (const a of nav.querySelectorAll("a.nav-item")) {
      const target = new URL(a.href, location.origin).pathname.replace(/\.html$/, "") || "/";
      a.classList.toggle("active", target === path || (path.startsWith("/p/") && target === "/") || (path === "/product" && target === "/"));
    }
  }

  {
    const path = location.pathname.replace(/\.html$/, "") || "/";
    if (path === "/" || path === "/index") document.body.classList.add("mp-page-shop");
    else if (path === "/product" || path.startsWith("/p/")) document.body.classList.add("mp-page-product");
    else if (path === "/about") document.body.classList.add("mp-page-about");
    else if (path === "/reviews") document.body.classList.add("mp-page-reviews");
    else if (path === "/shipping") document.body.classList.add("mp-page-shipping");
    else if (path === "/returns") document.body.classList.add("mp-page-returns");
    else if (path === "/privacy") document.body.classList.add("mp-page-privacy");
    else if (path === "/impressum") document.body.classList.add("mp-page-impressum");
    else if (path === "/success") document.body.classList.add("mp-page-success");
    else if (path === "/cancel") document.body.classList.add("mp-page-cancel");
  }

  setupControls();
  wireTranslations();
})();
