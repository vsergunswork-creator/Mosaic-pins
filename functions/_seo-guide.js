// STEP 44 — server-rendered thematic SEO guides for Mosaic Pins Space.
// English is the default crawler-facing language. EN/DE/RU/FR are rendered
// server-side from the existing mp_language cookie so users keep their chosen UI language.
import { getProductsCatalog } from "./api/_airtable-products.js";

const SITE_ORIGIN = "https://mosaicpins.space";
const SUPPORTED = new Set(["en","de","ru","fr"]);
const GUIDES = {
  "mosaic-pins-for-knives": {
    "key": "mosaic",
    "en": {
      "title": "Mosaic Pins for Knives | Handmade Knife Handle Pins | Mosaic Pins Space",
      "meta": "Handmade mosaic pins for custom knife handles. Browse small-batch designs in steel, brass, copper, carbon and epoxy resin with worldwide tracked shipping from Germany.",
      "h1": "Mosaic Pins for Knives",
      "kicker": "Handmade details for custom knife handles",
      "intro": "Mosaic pins are decorative pin stock used by knifemakers to add a precise visual detail to a finished handle. Mosaic Pins Space makes small-batch designs for custom knives, with each product page showing the exact pin, diameter, materials, current stock and real product photos.",
      "lead": "If you are choosing a mosaic pin for a new build, start with the handle proportions, the diameter you can drill accurately, and the contrast you want against the scale material. A subtle pin can support the handle design; a brighter or more complex pattern can become a focal point.",
      "section1Title": "Choosing a mosaic pin for a knife handle",
      "section1": [
        "Match the pin diameter to your planned hole before glue-up. The current catalog includes several diameters, and availability changes as small batches sell out.",
        "Consider contrast. Brass, copper, steel, carbon, colored epoxy and glow elements can look very different against wood, micarta, G10, carbon fiber or other handle materials.",
        "Use the individual product page for the exact PIN code, photos and current stock. This makes it easier to repeat a design later or discuss a specific pin with a customer."
      ],
      "section2Title": "Small-batch handmade pin stock",
      "section2": "The catalog is built around finished, photographed pieces rather than generic stock images. Each design is made in small quantities, so the selection can change over time. For knifemakers this means the pin can become part of the identity of a build instead of looking like a mass-market fitting.",
      "productsTitle": "Mosaic pins currently in the shop",
      "productsIntro": "These are live products from the Mosaic Pins Space catalog. Open any card for the exact product page, current availability and full photos.",
      "diametersTitle": "Current diameters",
      "faqTitle": "Common questions",
      "faq": [
        [
          "Are these pins made for knife handles?",
          "Yes. The product range is designed for custom knife handles and related knifemaking projects."
        ],
        [
          "Do all designs stay permanently in stock?",
          "No. Many designs are made in small batches, so stock and available patterns change over time."
        ],
        [
          "Can I order from the United States?",
          "Yes. Mosaic Pins Space ships internationally from Germany with tracked shipping. The cart calculates the current shipping rate for the selected destination."
        ],
        [
          "Where can I see the exact materials and diameter?",
          "Open the individual product page. It shows the PIN code, diameter, materials, photos, price and current stock for that exact design."
        ]
      ],
      "relatedTitle": "More guides for knifemakers"
    },
    "de": {
      "title": "Mosaikpins für Messer | Handgefertigte Griffpins | Mosaic Pins Space",
      "meta": "Handgefertigte Mosaikpins für individuelle Messergriffe. Kleinserien aus Stahl, Messing, Kupfer, Carbon und Epoxidharz mit weltweitem Tracking-Versand aus Deutschland.",
      "h1": "Mosaikpins für Messer",
      "kicker": "Handgefertigte Details für individuelle Messergriffe",
      "intro": "Mosaikpins sind dekoratives Pin-Material, mit dem Messermacher einem fertigen Griff ein präzises visuelles Detail geben. Mosaic Pins Space fertigt Designs in Kleinserien für Custom-Messer. Auf jeder Produktseite findest du den genauen Pin, Durchmesser, Materialien, aktuellen Bestand und echte Produktfotos.",
      "lead": "Wenn du einen Mosaikpin für einen neuen Aufbau auswählst, achte zuerst auf die Proportionen des Griffs, den Durchmesser, den du sauber bohren kannst, und den gewünschten Kontrast zum Griffmaterial. Ein dezenter Pin kann das Design unterstützen; ein helleres oder komplexeres Muster kann zum Blickfang werden.",
      "section1Title": "Den passenden Mosaikpin für einen Messergriff wählen",
      "section1": [
        "Stimme den Pin-Durchmesser vor dem Verkleben auf deine geplante Bohrung ab. Im aktuellen Katalog gibt es mehrere Durchmesser; die Verfügbarkeit ändert sich, wenn Kleinserien ausverkauft sind.",
        "Achte auf den Kontrast. Messing, Kupfer, Stahl, Carbon, farbiges Epoxidharz und Glow-Elemente wirken auf Holz, Micarta, G10, Carbonfaser oder anderen Griffmaterialien sehr unterschiedlich.",
        "Nutze die jeweilige Produktseite für den exakten PIN-Code, Fotos und aktuellen Bestand. So lässt sich ein Design später leichter wiederfinden oder mit einem Kunden eindeutig besprechen."
      ],
      "section2Title": "Handgefertigtes Pin-Material in Kleinserien",
      "section2": "Der Katalog basiert auf real fotografierten Produkten statt auf generischen Stockbildern. Viele Designs entstehen in kleinen Stückzahlen, deshalb kann sich die Auswahl im Laufe der Zeit ändern. Für Messermacher kann der Pin dadurch Teil der eigenen Handschrift eines Builds werden statt wie ein Massenbauteil zu wirken.",
      "productsTitle": "Aktuell verfügbare Mosaikpins",
      "productsIntro": "Diese Produkte kommen live aus dem Mosaic Pins Space Katalog. Öffne eine Karte für die genaue Produktseite, den aktuellen Bestand und alle Fotos.",
      "diametersTitle": "Aktuelle Durchmesser",
      "faqTitle": "Häufige Fragen",
      "faq": [
        [
          "Sind diese Pins für Messergriffe gedacht?",
          "Ja. Das Sortiment ist für individuelle Messergriffe und verwandte Messermacher-Projekte ausgelegt."
        ],
        [
          "Bleiben alle Designs dauerhaft auf Lager?",
          "Nein. Viele Designs werden in Kleinserien gefertigt, daher ändern sich Bestand und verfügbare Muster mit der Zeit."
        ],
        [
          "Kann ich in die USA bestellen?",
          "Ja. Mosaic Pins Space versendet international aus Deutschland mit Sendungsverfolgung. Der Warenkorb berechnet den aktuellen Versandtarif für das gewählte Zielland."
        ],
        [
          "Wo sehe ich Materialien und Durchmesser genau?",
          "Auf der jeweiligen Produktseite findest du PIN-Code, Durchmesser, Materialien, Fotos, Preis und aktuellen Bestand des exakten Designs."
        ]
      ],
      "relatedTitle": "Weitere Guides für Messermacher"
    },
    "ru": {
      "title": "Мозаичные пины для ножей | Пины для рукоятей | Mosaic Pins Space",
      "meta": "Мозаичные пины ручной работы для рукоятей кастомных ножей. Малые серии из стали, латуни, меди, карбона и эпоксидной смолы с отслеживаемой доставкой из Германии.",
      "h1": "Мозаичные пины для ножей",
      "kicker": "Ручная работа для кастомных рукоятей ножей",
      "intro": "Мозаичные пины — декоративный материал, который ножеделы используют как точный визуальный акцент в готовой рукояти. Mosaic Pins Space делает небольшие серии для кастомных ножей, а на странице каждого товара указаны конкретный PIN-код, диаметр, материалы, актуальный остаток и реальные фотографии.",
      "lead": "При выборе пина для нового проекта сначала учитывай пропорции рукояти, диаметр отверстия, который сможешь точно просверлить, и нужный контраст с материалом накладок. Спокойный рисунок может поддержать дизайн, а яркий или сложный — стать главным акцентом.",
      "section1Title": "Как выбрать мозаичный пин для рукояти ножа",
      "section1": [
        "Подбирай диаметр пина под запланированное отверстие до склейки. В текущем каталоге есть несколько диаметров, а наличие меняется по мере продажи небольших партий.",
        "Учитывай контраст. Латунь, медь, сталь, карбон, цветная эпоксидная смола и светящиеся элементы по-разному выглядят на дереве, Micarta, G10, карбоне и других материалах рукоятей.",
        "Для точного PIN-кода, фотографий и текущего остатка открывай страницу конкретного товара. Так легче повторить дизайн позже или точно обсудить выбранный пин с заказчиком."
      ],
      "section2Title": "Пины ручной работы небольшими сериями",
      "section2": "Каталог построен на реальных фотографиях готовых пинов, а не на стандартных картинках. Многие дизайны делаются небольшими партиями, поэтому ассортимент со временем меняется. Для ножедела это позволяет сделать пин частью характера конкретного ножа, а не обычной массовой фурнитурой.",
      "productsTitle": "Мозаичные пины сейчас в магазине",
      "productsIntro": "Это актуальные товары из каталога Mosaic Pins Space. Открой карточку, чтобы увидеть конкретную страницу товара, текущее наличие и все фотографии.",
      "diametersTitle": "Актуальные диаметры",
      "faqTitle": "Частые вопросы",
      "faq": [
        [
          "Эти пины предназначены именно для рукоятей ножей?",
          "Да. Ассортимент рассчитан на кастомные рукояти ножей и связанные с ножеделием проекты."
        ],
        [
          "Все дизайны постоянно есть в наличии?",
          "Нет. Многие дизайны выпускаются небольшими сериями, поэтому остатки и доступные рисунки со временем меняются."
        ],
        [
          "Можно заказать в США?",
          "Да. Mosaic Pins Space отправляет заказы из Германии по всему миру с отслеживанием. Корзина рассчитывает актуальную стоимость доставки для выбранной страны."
        ],
        [
          "Где посмотреть точный диаметр и материалы?",
          "Открой страницу конкретного товара: там указаны PIN-код, диаметр, материалы, фотографии, цена и актуальный остаток."
        ]
      ],
      "relatedTitle": "Другие материалы для ножеделов"
    },
    "fr": {
      "title": "Pins mosaïque pour couteaux | Pins de manche artisanaux | Mosaic Pins Space",
      "meta": "Pins mosaïque artisanaux pour manches de couteaux custom. Petites séries en acier, laiton, cuivre, carbone et résine époxy avec livraison suivie depuis l’Allemagne.",
      "h1": "Pins mosaïque pour couteaux",
      "kicker": "Détails artisanaux pour manches de couteaux sur mesure",
      "intro": "Les pins mosaïque sont des éléments décoratifs utilisés par les couteliers pour ajouter un détail visuel précis à un manche fini. Mosaic Pins Space fabrique de petites séries pour couteaux custom. Chaque page produit indique le pin exact, son diamètre, ses matériaux, le stock actuel et de vraies photos.",
      "lead": "Pour choisir un pin mosaïque pour un nouveau projet, commencez par les proportions du manche, le diamètre que vous pouvez percer avec précision et le contraste recherché avec les plaquettes. Un motif discret peut soutenir le design ; un motif plus lumineux ou complexe peut devenir un point focal.",
      "section1Title": "Choisir un pin mosaïque pour un manche de couteau",
      "section1": [
        "Adaptez le diamètre du pin au trou prévu avant le collage. Le catalogue actuel propose plusieurs diamètres et la disponibilité évolue à mesure que les petites séries sont vendues.",
        "Pensez au contraste. Laiton, cuivre, acier, carbone, résine époxy colorée et éléments phosphorescents donnent des résultats très différents sur bois, Micarta, G10, fibre de carbone ou autres matériaux de manche.",
        "Consultez la page produit pour le code PIN exact, les photos et le stock actuel. Cela facilite la reproduction d’un design ou la discussion d’un pin précis avec un client."
      ],
      "section2Title": "Pins artisanaux en petites séries",
      "section2": "Le catalogue repose sur des produits réellement photographiés plutôt que sur des images génériques. De nombreux designs sont fabriqués en petites quantités ; la sélection peut donc évoluer. Pour un coutelier, le pin peut ainsi faire partie de l’identité du couteau au lieu de ressembler à une pièce standard de grande série.",
      "productsTitle": "Pins mosaïque actuellement disponibles",
      "productsIntro": "Ces produits proviennent en direct du catalogue Mosaic Pins Space. Ouvrez une carte pour voir la page produit exacte, le stock actuel et toutes les photos.",
      "diametersTitle": "Diamètres actuels",
      "faqTitle": "Questions fréquentes",
      "faq": [
        [
          "Ces pins sont-ils conçus pour les manches de couteaux ?",
          "Oui. La gamme est destinée aux manches de couteaux sur mesure et aux projets liés à la coutellerie."
        ],
        [
          "Tous les designs restent-ils toujours en stock ?",
          "Non. Beaucoup de designs sont réalisés en petites séries ; les stocks et motifs disponibles évoluent donc avec le temps."
        ],
        [
          "Puis-je commander depuis les États-Unis ?",
          "Oui. Mosaic Pins Space expédie à l’international depuis l’Allemagne avec suivi. Le panier calcule le tarif de livraison actuel pour la destination choisie."
        ],
        [
          "Où voir le diamètre et les matériaux exacts ?",
          "Ouvrez la page du produit concerné : elle indique le code PIN, le diamètre, les matériaux, les photos, le prix et le stock actuel."
        ]
      ],
      "relatedTitle": "Autres guides pour couteliers"
    }
  },
  "knife-handle-mosaic-pins": {
    "key": "knife",
    "en": {
      "title": "Knife Handle Mosaic Pins | Custom Knifemaking Pins | Mosaic Pins Space",
      "meta": "Knife handle mosaic pins for custom knifemaking. Compare handmade patterns, diameters and materials, then open the exact product page for live stock and photos.",
      "h1": "Knife Handle Mosaic Pins",
      "kicker": "Decorative pins built around custom knifemaking",
      "intro": "A knife handle mosaic pin has two jobs: it can contribute to the mechanical layout of the handle while also becoming part of the visual composition. The best result usually comes from planning the pin together with the scale material, handle shape and other hardware instead of treating it as an afterthought.",
      "lead": "Mosaic Pins Space focuses on handcrafted decorative pins for knifemakers. The catalog includes different patterns, materials and diameters, with live stock tied to each exact PIN code.",
      "section1Title": "Plan the pin with the handle",
      "section1": [
        "Choose the diameter before drilling. A clean, accurate fit matters more than forcing a larger pin into a design that was planned around smaller hardware.",
        "Think about visual rhythm. One pin can act as a focal point, while a pair of matching pins can create symmetry along the handle.",
        "Check the end-face photo. The visible pattern is what will remain after the pin is cut, fitted and finished flush with the handle."
      ],
      "section2Title": "Materials, color and finish",
      "section2": "Metal tubes, wires, carbon elements and epoxy create different levels of contrast after finishing. The product cards below link to the exact item pages so you can compare the real pattern rather than relying on a generic category image.",
      "productsTitle": "Pins suited to knife handles",
      "productsIntro": "Live catalog selection, prioritizing in-stock mosaic and glow designs for handle work.",
      "diametersTitle": "Diameters in the current catalog",
      "faqTitle": "Knife handle pin FAQ",
      "faq": [
        [
          "Should I choose the pin before drilling the handle?",
          "Yes. Choose the exact diameter first, then drill and fit around that size for a cleaner result."
        ],
        [
          "Can mosaic pins be used as a visual accent?",
          "Yes. Many knifemakers use the end pattern as a design element that complements the scales, liners and other hardware."
        ],
        [
          "Are the product photos of the actual pin design?",
          "The catalog uses real product photography so you can evaluate the visible end pattern and overall appearance of the listed design."
        ],
        [
          "How do I find the same design again?",
          "Use the PIN code shown on the product page. It identifies the exact catalog item and is useful when discussing or repeating a build."
        ]
      ],
      "relatedTitle": "Related knifemaking guides"
    },
    "de": {
      "title": "Mosaikpins für Messergriffe | Pins für Messermacher | Mosaic Pins Space",
      "meta": "Mosaikpins für individuelle Messergriffe. Vergleiche handgefertigte Muster, Durchmesser und Materialien und öffne die exakte Produktseite für Live-Bestand und Fotos.",
      "h1": "Mosaikpins für Messergriffe",
      "kicker": "Dekorative Pins für den individuellen Messerbau",
      "intro": "Ein Mosaikpin im Messergriff erfüllt zwei Aufgaben: Er kann Teil des konstruktiven Aufbaus sein und gleichzeitig die Optik des Griffs prägen. Das beste Ergebnis entsteht meist, wenn Pin, Griffmaterial, Form und weitere Hardware gemeinsam geplant werden – nicht erst am Ende.",
      "lead": "Mosaic Pins Space konzentriert sich auf handgefertigte dekorative Pins für Messermacher. Der Katalog enthält unterschiedliche Muster, Materialien und Durchmesser; der Live-Bestand ist jeweils mit einem eindeutigen PIN-Code verknüpft.",
      "section1Title": "Den Pin zusammen mit dem Griff planen",
      "section1": [
        "Wähle den Durchmesser vor dem Bohren. Eine saubere, genaue Passung ist wichtiger, als einen zu großen Pin in ein Design zu zwingen, das für kleinere Hardware geplant war.",
        "Achte auf den visuellen Rhythmus. Ein einzelner Pin kann als Blickfang dienen, zwei gleiche Pins können Symmetrie entlang des Griffs schaffen.",
        "Prüfe das Foto der Stirnseite. Genau dieses Muster bleibt sichtbar, nachdem der Pin zugeschnitten, eingesetzt und bündig mit dem Griff verschliffen wurde."
      ],
      "section2Title": "Materialien, Farbe und Finish",
      "section2": "Metallrohre, Drähte, Carbon-Elemente und Epoxidharz erzeugen nach dem Finish unterschiedliche Kontraste. Die Produktkarten unten führen direkt zum exakten Artikel, damit du das reale Muster vergleichen kannst statt nur ein allgemeines Kategoriebild zu sehen.",
      "productsTitle": "Pins für Messergriffe",
      "productsIntro": "Live-Auswahl aus dem Katalog mit Fokus auf verfügbare Mosaik- und Glow-Designs für Griffarbeiten.",
      "diametersTitle": "Durchmesser im aktuellen Katalog",
      "faqTitle": "FAQ zu Messergriff-Pins",
      "faq": [
        [
          "Sollte ich den Pin vor dem Bohren auswählen?",
          "Ja. Lege zuerst den exakten Durchmesser fest und passe Bohrung und Einbau an diese Größe an."
        ],
        [
          "Kann ein Mosaikpin als optischer Akzent dienen?",
          "Ja. Viele Messermacher nutzen das Stirnmuster als Designelement, das mit Schalen, Linern und anderer Hardware harmoniert."
        ],
        [
          "Zeigen die Produktfotos das echte Pin-Design?",
          "Der Katalog verwendet reale Produktfotografie, damit du das sichtbare Stirnmuster und die Gesamtwirkung des angebotenen Designs beurteilen kannst."
        ],
        [
          "Wie finde ich dasselbe Design später wieder?",
          "Nutze den PIN-Code auf der Produktseite. Er identifiziert den genauen Katalogartikel und hilft beim Besprechen oder Wiederholen eines Builds."
        ]
      ],
      "relatedTitle": "Passende Guides für Messermacher"
    },
    "ru": {
      "title": "Мозаичные пины для рукоятей ножей | Knife Handle Pins | Mosaic Pins Space",
      "meta": "Мозаичные пины для кастомных рукоятей ножей. Сравнивай рисунки ручной работы, диаметры и материалы, а затем открывай конкретный товар с актуальным остатком и фото.",
      "h1": "Мозаичные пины для рукоятей ножей",
      "kicker": "Декоративные пины для кастомного ножеделия",
      "intro": "Мозаичный пин в рукояти решает сразу две задачи: он может участвовать в конструктивной схеме рукояти и одновременно быть частью её визуальной композиции. Лучший результат обычно получается, когда пин выбирают вместе с материалом накладок, формой рукояти и другой фурнитурой, а не добавляют в самом конце.",
      "lead": "Mosaic Pins Space специализируется на декоративных пинах ручной работы для ножеделов. В каталоге есть разные рисунки, материалы и диаметры, а актуальный остаток привязан к конкретному PIN-коду каждого товара.",
      "section1Title": "Планируй пин вместе с рукоятью",
      "section1": [
        "Выбери диаметр до сверления. Чистая и точная посадка важнее, чем попытка встроить крупный пин в дизайн, который изначально рассчитан на меньшую фурнитуру.",
        "Учитывай визуальный ритм. Один пин может стать акцентом, а пара одинаковых пинов — создать симметрию по длине рукояти.",
        "Смотри фотографию торца. Именно этот рисунок останется виден после того, как пин будет отрезан, установлен и обработан заподлицо с рукоятью."
      ],
      "section2Title": "Материалы, цвет и финиш",
      "section2": "Металлические трубки, проволока, карбоновые элементы и эпоксидная смола после финишной обработки дают разный контраст. Карточки ниже ведут на конкретные товары, поэтому можно сравнивать реальный рисунок, а не условную картинку категории.",
      "productsTitle": "Пины для рукоятей ножей",
      "productsIntro": "Актуальная выборка из каталога с приоритетом доступных мозаичных и светящихся дизайнов для рукоятей.",
      "diametersTitle": "Диаметры в текущем каталоге",
      "faqTitle": "Вопросы о пинах для рукоятей",
      "faq": [
        [
          "Лучше выбрать пин до сверления рукояти?",
          "Да. Сначала выбери точный диаметр, а затем делай отверстие и подгонку под этот размер."
        ],
        [
          "Можно использовать мозаичный пин как визуальный акцент?",
          "Да. Многие ножеделы используют рисунок торца как часть дизайна вместе с накладками, лайнерами и другой фурнитурой."
        ],
        [
          "На фото показан реальный дизайн пина?",
          "В каталоге используются реальные фотографии товаров, поэтому можно оценить видимый рисунок торца и общий внешний вид конкретного дизайна."
        ],
        [
          "Как потом найти тот же дизайн?",
          "Используй PIN-код со страницы товара. Он однозначно определяет позицию каталога и удобен при повторении проекта."
        ]
      ],
      "relatedTitle": "Связанные материалы для ножеделов"
    },
    "fr": {
      "title": "Pins mosaïque pour manches de couteaux | Coutellerie custom | Mosaic Pins Space",
      "meta": "Pins mosaïque pour manches de couteaux sur mesure. Comparez motifs artisanaux, diamètres et matériaux puis ouvrez la fiche exacte pour le stock et les photos.",
      "h1": "Pins mosaïque pour manches de couteaux",
      "kicker": "Pins décoratifs pensés pour la coutellerie sur mesure",
      "intro": "Un pin mosaïque de manche remplit deux rôles : il peut participer à la construction du manche tout en faisant partie de sa composition visuelle. Le meilleur résultat vient généralement d’un choix effectué avec les plaquettes, la forme du manche et les autres éléments de quincaillerie, plutôt qu’en toute fin de projet.",
      "lead": "Mosaic Pins Space se concentre sur des pins décoratifs artisanaux pour couteliers. Le catalogue propose différents motifs, matériaux et diamètres, avec un stock en direct associé à chaque code PIN précis.",
      "section1Title": "Planifier le pin avec le manche",
      "section1": [
        "Choisissez le diamètre avant de percer. Un ajustement propre et précis vaut mieux que de forcer un gros pin dans un design prévu pour une quincaillerie plus petite.",
        "Pensez au rythme visuel. Un seul pin peut servir de point focal ; deux pins identiques peuvent créer une symétrie le long du manche.",
        "Regardez la photo de l’extrémité. C’est ce motif qui restera visible après découpe, pose et mise à niveau avec le manche."
      ],
      "section2Title": "Matériaux, couleur et finition",
      "section2": "Tubes métalliques, fils, éléments en carbone et résine époxy créent des contrastes différents après finition. Les cartes ci-dessous renvoient vers l’article exact afin de comparer le motif réel plutôt qu’une image générique de catégorie.",
      "productsTitle": "Pins adaptés aux manches de couteaux",
      "productsIntro": "Sélection en direct du catalogue, avec priorité aux designs mosaïque et glow disponibles pour les manches.",
      "diametersTitle": "Diamètres du catalogue actuel",
      "faqTitle": "FAQ des pins de manche",
      "faq": [
        [
          "Faut-il choisir le pin avant de percer le manche ?",
          "Oui. Choisissez d’abord le diamètre exact, puis percez et ajustez le montage autour de cette dimension."
        ],
        [
          "Un pin mosaïque peut-il servir d’accent visuel ?",
          "Oui. De nombreux couteliers utilisent le motif d’extrémité comme élément de design avec les plaquettes, liners et autres pièces."
        ],
        [
          "Les photos montrent-elles le vrai design du pin ?",
          "Le catalogue utilise de vraies photos produit afin de montrer le motif visible et l’aspect global du design proposé."
        ],
        [
          "Comment retrouver le même design plus tard ?",
          "Utilisez le code PIN affiché sur la fiche produit. Il identifie l’article exact et facilite la répétition d’un projet."
        ]
      ],
      "relatedTitle": "Guides associés pour couteliers"
    }
  },
  "lanyard-pins-for-knives": {
    "key": "lanyard",
    "en": {
      "title": "Lanyard Pins for Knives | Handmade Lanyard Tubes | Mosaic Pins Space",
      "meta": "Handmade lanyard pins and decorative lanyard tubes for custom knife handles. Browse live stock, real photos, diameters and materials from Mosaic Pins Space.",
      "h1": "Lanyard Pins for Knives",
      "kicker": "Decorative lanyard hardware for custom knife handles",
      "intro": "Lanyard pins and decorative lanyard tubes give a knife handle a finished opening for cord while adding another design detail at the butt of the handle. They can be understated and functional or deliberately decorative, depending on the pattern and surrounding handle material.",
      "lead": "The Mosaic Pins Space lanyard range is made for knifemakers who want the lanyard opening to look intentional rather than like a plain drilled tube. Each live product page shows the exact pattern, diameter, materials and current stock.",
      "section1Title": "Choosing a lanyard pin",
      "section1": [
        "Plan the lanyard opening early enough to leave suitable material around the hole. The exact position depends on the handle shape, tang construction and intended cord size.",
        "Match the visible end pattern to the rest of the hardware. A lanyard pin can echo the main mosaic pin, or act as a quieter secondary detail.",
        "Use the exact diameter shown on the product page when planning the hole. Do not rely on the category name alone because the live catalog can contain several sizes."
      ],
      "section2Title": "A functional detail that can still be decorative",
      "section2": "A lanyard tube is often viewed as purely functional, but on a custom knife its visible end can contribute to the finish just like a mosaic pin, fastener or liner. Real product photos make it easier to judge whether a design will look balanced on the planned handle.",
      "productsTitle": "Lanyard pins in the live catalog",
      "productsIntro": "Current lanyard-focused products from the Mosaic Pins Space catalog. In-stock items are shown first.",
      "diametersTitle": "Current lanyard diameters",
      "faqTitle": "Lanyard pin FAQ",
      "faq": [
        [
          "What is a lanyard pin used for?",
          "It creates a finished lanyard opening in the handle while providing a visible decorative end around that opening."
        ],
        [
          "Is a lanyard pin the same as a solid mosaic pin?",
          "Not necessarily. Lanyard hardware is designed around an opening for cord, while a solid mosaic pin is primarily a decorative pin through the handle."
        ],
        [
          "Can I match a lanyard pin with another mosaic pin?",
          "Yes. Matching or complementary metal and color choices can help the hardware feel like one intentional set."
        ],
        [
          "Does the shop show live stock?",
          "Yes. Each product page shows the current stock tied to that exact PIN code."
        ]
      ],
      "relatedTitle": "More guides for knife handle hardware"
    },
    "de": {
      "title": "Lanyard Pins für Messer | Handgefertigte Lanyard-Rohre | Mosaic Pins Space",
      "meta": "Handgefertigte Lanyard Pins und dekorative Lanyard-Rohre für individuelle Messergriffe. Live-Bestand, echte Fotos, Durchmesser und Materialien.",
      "h1": "Lanyard Pins für Messer",
      "kicker": "Dekorative Lanyard-Hardware für individuelle Messergriffe",
      "intro": "Lanyard Pins und dekorative Lanyard-Rohre schaffen eine sauber ausgeführte Öffnung für eine Kordel und setzen gleichzeitig ein weiteres Designdetail am Griffende. Je nach Muster und Griffmaterial können sie dezent-funktional oder bewusst dekorativ wirken.",
      "lead": "Die Lanyard-Auswahl von Mosaic Pins Space richtet sich an Messermacher, bei denen die Öffnung bewusst gestaltet aussehen soll statt wie ein einfaches Rohr. Jede Live-Produktseite zeigt das genaue Muster, den Durchmesser, die Materialien und den aktuellen Bestand.",
      "section1Title": "Einen Lanyard Pin auswählen",
      "section1": [
        "Plane die Lanyard-Öffnung früh genug, damit ausreichend Material um die Bohrung bleibt. Die genaue Position hängt von Griffform, Erlkonstruktion und gewünschter Kordelstärke ab.",
        "Stimme das sichtbare Stirnmuster auf die restliche Hardware ab. Der Lanyard Pin kann den Haupt-Mosaikpin aufgreifen oder als ruhigeres zweites Detail dienen.",
        "Nutze für die Bohrungsplanung den exakten Durchmesser auf der Produktseite. Verlasse dich nicht nur auf den Kategorienamen, da der Live-Katalog mehrere Größen enthalten kann."
      ],
      "section2Title": "Funktional und trotzdem dekorativ",
      "section2": "Ein Lanyard-Rohr wird oft nur als Funktionsteil gesehen. Bei einem Custom-Messer kann die sichtbare Stirnseite jedoch genauso zum Finish beitragen wie Mosaikpin, Befestigung oder Liner. Reale Produktfotos helfen dabei, die Wirkung auf dem geplanten Griff einzuschätzen.",
      "productsTitle": "Lanyard Pins im aktuellen Katalog",
      "productsIntro": "Aktuelle Lanyard-Produkte aus dem Mosaic Pins Space Katalog. Verfügbare Artikel werden zuerst gezeigt.",
      "diametersTitle": "Aktuelle Lanyard-Durchmesser",
      "faqTitle": "FAQ zu Lanyard Pins",
      "faq": [
        [
          "Wofür wird ein Lanyard Pin verwendet?",
          "Er bildet eine sauber ausgeführte Öffnung für eine Kordel und gleichzeitig einen sichtbaren dekorativen Abschluss um diese Öffnung."
        ],
        [
          "Ist ein Lanyard Pin dasselbe wie ein massiver Mosaikpin?",
          "Nicht unbedingt. Lanyard-Hardware ist um eine Öffnung für eine Kordel aufgebaut, während ein massiver Mosaikpin hauptsächlich dekorativ durch den Griff läuft."
        ],
        [
          "Kann ich einen Lanyard Pin mit einem anderen Mosaikpin kombinieren?",
          "Ja. Passende oder ergänzende Metall- und Farbtöne lassen die Hardware wie ein bewusst zusammengestelltes Set wirken."
        ],
        [
          "Zeigt der Shop den aktuellen Bestand?",
          "Ja. Jede Produktseite zeigt den aktuellen Bestand für genau diesen PIN-Code."
        ]
      ],
      "relatedTitle": "Weitere Guides zu Messergriff-Hardware"
    },
    "ru": {
      "title": "Lanyard pins для ножей | Декоративные трубки для темляка | Mosaic Pins Space",
      "meta": "Lanyard pins и декоративные трубки для темляка ручной работы для кастомных рукоятей ножей. Актуальный остаток, реальные фото, диаметры и материалы.",
      "h1": "Lanyard pins для ножей",
      "kicker": "Декоративная фурнитура для темляка в кастомных рукоятях",
      "intro": "Lanyard pin или декоративная трубка для темляка формирует аккуратное отверстие под шнур и одновременно добавляет ещё одну деталь дизайна в задней части рукояти. Она может быть почти незаметной и функциональной либо специально выделяться рисунком и материалами.",
      "lead": "Линейка Mosaic Pins Space рассчитана на ножеделов, которые хотят, чтобы отверстие под темляк выглядело частью общего дизайна, а не обычной просверленной трубкой. На странице каждого товара указаны точный рисунок, диаметр, материалы и актуальный остаток.",
      "section1Title": "Как выбрать lanyard pin",
      "section1": [
        "Планируй отверстие под темляк заранее, чтобы вокруг него осталось достаточно материала. Точное положение зависит от формы рукояти, конструкции хвостовика и нужного размера шнура.",
        "Сочетай видимый рисунок торца с остальной фурнитурой. Lanyard pin может повторять основной мозаичный пин или быть более спокойным вторичным акцентом.",
        "При подготовке отверстия ориентируйся на точный диаметр со страницы конкретного товара. В одной категории могут одновременно быть разные размеры."
      ],
      "section2Title": "Функциональная деталь, которая может быть декоративной",
      "section2": "Трубку для темляка часто воспринимают только как функциональный элемент, но на кастомном ноже её видимый торец влияет на общий финиш так же, как мозаичный пин, крепёж или лайнер. Реальные фотографии позволяют заранее оценить баланс деталей на рукояти.",
      "productsTitle": "Lanyard pins в актуальном каталоге",
      "productsIntro": "Текущие товары для темляка из каталога Mosaic Pins Space. Позиции в наличии показываются первыми.",
      "diametersTitle": "Актуальные диаметры lanyard pins",
      "faqTitle": "Вопросы о lanyard pins",
      "faq": [
        [
          "Для чего нужен lanyard pin?",
          "Он создаёт аккуратное отверстие для темляка и одновременно формирует декоративный видимый торец вокруг этого отверстия."
        ],
        [
          "Lanyard pin — это то же самое, что сплошной мозаичный пин?",
          "Не обязательно. Lanyard-фурнитура имеет отверстие под шнур, а сплошной мозаичный пин в первую очередь служит декоративным элементом через рукоять."
        ],
        [
          "Можно сочетать lanyard pin с другим мозаичным пином?",
          "Да. Совпадающие или дополняющие друг друга металлы и цвета помогают собрать фурнитуру в единый комплект."
        ],
        [
          "В магазине показывается реальный остаток?",
          "Да. На странице каждого товара указан актуальный остаток для конкретного PIN-кода."
        ]
      ],
      "relatedTitle": "Другие материалы по фурнитуре рукоятей"
    },
    "fr": {
      "title": "Lanyard pins pour couteaux | Tubes de dragonne artisanaux | Mosaic Pins Space",
      "meta": "Lanyard pins et tubes décoratifs artisanaux pour manches de couteaux custom. Stock en direct, vraies photos, diamètres et matériaux chez Mosaic Pins Space.",
      "h1": "Lanyard pins pour couteaux",
      "kicker": "Quincaillerie décorative pour dragonne de manche custom",
      "intro": "Les lanyard pins et tubes décoratifs créent une ouverture propre pour le cordon tout en ajoutant un détail de design à l’arrière du manche. Selon le motif et le matériau environnant, ils peuvent rester discrets et fonctionnels ou devenir volontairement décoratifs.",
      "lead": "La gamme lanyard de Mosaic Pins Space s’adresse aux couteliers qui veulent une ouverture de dragonne intégrée au design plutôt qu’un simple tube percé. Chaque fiche en direct indique le motif exact, le diamètre, les matériaux et le stock actuel.",
      "section1Title": "Choisir un lanyard pin",
      "section1": [
        "Planifiez l’ouverture assez tôt pour conserver suffisamment de matière autour du trou. La position dépend de la forme du manche, de la construction de la soie et du diamètre de cordon souhaité.",
        "Accordez le motif visible avec le reste de la quincaillerie. Le lanyard pin peut rappeler le pin mosaïque principal ou servir de détail secondaire plus discret.",
        "Utilisez le diamètre exact indiqué sur la fiche produit pour préparer le trou. Une même catégorie peut contenir plusieurs dimensions dans le catalogue en direct."
      ],
      "section2Title": "Un détail fonctionnel qui peut rester décoratif",
      "section2": "Un tube de dragonne est souvent considéré comme purement fonctionnel. Sur un couteau custom, son extrémité visible peut pourtant contribuer à la finition comme un pin mosaïque, une fixation ou un liner. Les vraies photos facilitent l’évaluation de l’équilibre du design.",
      "productsTitle": "Lanyard pins du catalogue actuel",
      "productsIntro": "Produits lanyard actuels du catalogue Mosaic Pins Space. Les articles en stock sont affichés en premier.",
      "diametersTitle": "Diamètres lanyard actuels",
      "faqTitle": "FAQ lanyard pins",
      "faq": [
        [
          "À quoi sert un lanyard pin ?",
          "Il crée une ouverture finie pour une dragonne tout en offrant une extrémité décorative visible autour de cette ouverture."
        ],
        [
          "Un lanyard pin est-il identique à un pin mosaïque plein ?",
          "Pas nécessairement. La quincaillerie lanyard est construite autour d’une ouverture pour le cordon, tandis qu’un pin mosaïque plein est surtout un élément décoratif traversant le manche."
        ],
        [
          "Puis-je assortir un lanyard pin à un autre pin mosaïque ?",
          "Oui. Des métaux et couleurs assortis ou complémentaires peuvent donner l’impression d’un ensemble volontairement coordonné."
        ],
        [
          "Le stock affiché est-il actuel ?",
          "Oui. Chaque fiche produit affiche le stock actuel associé à ce code PIN exact."
        ]
      ],
      "relatedTitle": "Autres guides sur la quincaillerie de manche"
    }
  },
  "glow-mosaic-pins": {
    "key": "glow",
    "en": {
      "title": "Glow Mosaic Pins for Knives | Moonglow Knife Handle Pins | Mosaic Pins Space",
      "meta": "Glow mosaic pins for custom knife handles. Browse handmade Moonglow-style designs with real photos, live stock, diameters and worldwide tracked shipping from Germany.",
      "h1": "Glow Mosaic Pins for Knives",
      "kicker": "Light-reactive details for custom knife handles",
      "intro": "Glow mosaic pins add a second visual state to a custom knife handle: one appearance in normal light and another after the glow material has been charged. The effect works best when the pin is treated as part of the handle design rather than simply added for novelty.",
      "lead": "Mosaic Pins Space makes small-batch glow designs for knifemakers. Product pages use real photos and exact PIN codes so you can compare the pattern, diameter, materials and current stock of the specific item you are considering.",
      "section1Title": "Designing with glow pins",
      "section1": [
        "In daylight, consider the base colors and metal pattern just as you would with a standard mosaic pin. The glow effect is an additional layer, not the only part of the design.",
        "Placement matters. A glow pin can act as a focal point, pair with another pin, or sit near a lanyard detail depending on the proportions of the handle.",
        "Glow intensity and duration depend on charging conditions, ambient light and the specific glow material. Real-world appearance can therefore vary from one environment to another."
      ],
      "section2Title": "From normal light to low light",
      "section2": "A good glow pin should still look intentional when it is not glowing. The catalog therefore emphasizes the complete pattern and material combination, with the luminous element integrated into the mosaic rather than presented as a separate gadget.",
      "productsTitle": "Glow pins currently available",
      "productsIntro": "Live glow-focused selection from the Mosaic Pins Space catalog. In-stock designs are shown first.",
      "diametersTitle": "Current glow pin diameters",
      "faqTitle": "Glow mosaic pin FAQ",
      "faq": [
        [
          "Do glow pins need to be charged with light?",
          "Yes. Photoluminescent material absorbs light and then releases it gradually. Bright light generally produces a stronger initial glow."
        ],
        [
          "Will the pin look normal in daylight?",
          "Yes. The pin still has its metal, epoxy and color pattern in normal light; the glow effect becomes more visible in lower light after charging."
        ],
        [
          "Is glow duration always the same?",
          "No. It varies with the material, charging intensity, charging time and viewing conditions."
        ],
        [
          "Can glow pins be shipped internationally?",
          "Yes. The store offers tracked international shipping from Germany, with the current rate calculated for the selected destination in the cart."
        ]
      ],
      "relatedTitle": "Related guides for custom knife pins"
    },
    "de": {
      "title": "Glow Mosaikpins für Messer | Leuchtende Messergriff-Pins | Mosaic Pins Space",
      "meta": "Glow-Mosaikpins für individuelle Messergriffe. Handgefertigte Moonglow-Designs mit echten Fotos, Live-Bestand, Durchmessern und weltweitem Tracking-Versand aus Deutschland.",
      "h1": "Glow Mosaikpins für Messer",
      "kicker": "Lichtreaktive Details für individuelle Messergriffe",
      "intro": "Glow-Mosaikpins geben einem Custom-Messergriff zwei optische Zustände: ein Erscheinungsbild bei normalem Licht und ein zweites, nachdem das Leuchtmaterial aufgeladen wurde. Am besten wirkt der Effekt, wenn der Pin als Teil des Griffdesigns geplant wird und nicht nur als Gimmick hinzukommt.",
      "lead": "Mosaic Pins Space fertigt Glow-Designs in Kleinserien für Messermacher. Die Produktseiten verwenden reale Fotos und eindeutige PIN-Codes, sodass du Muster, Durchmesser, Materialien und aktuellen Bestand des konkreten Artikels vergleichen kannst.",
      "section1Title": "Mit Glow-Pins gestalten",
      "section1": [
        "Bei Tageslicht zählen Grundfarben und Metallmuster genauso wie bei einem normalen Mosaikpin. Der Leuchteffekt ist eine zusätzliche Ebene und nicht das einzige Designelement.",
        "Die Position ist wichtig. Ein Glow-Pin kann Blickfang sein, mit einem zweiten Pin kombiniert werden oder je nach Griffproportion in der Nähe eines Lanyard-Details sitzen.",
        "Leuchtstärke und Leuchtdauer hängen von Aufladung, Umgebungslicht und dem jeweiligen Leuchtmaterial ab. Die reale Wirkung kann deshalb je nach Umgebung variieren."
      ],
      "section2Title": "Von normalem Licht zu wenig Licht",
      "section2": "Ein guter Glow-Pin sollte auch ohne Leuchteffekt bewusst gestaltet aussehen. Deshalb zeigt der Katalog das vollständige Muster und die Materialkombination; das Leuchtelement ist in das Mosaik integriert statt wie ein separates Gadget zu wirken.",
      "productsTitle": "Aktuell verfügbare Glow-Pins",
      "productsIntro": "Live-Auswahl der Glow-Produkte aus dem Mosaic Pins Space Katalog. Verfügbare Designs werden zuerst gezeigt.",
      "diametersTitle": "Aktuelle Glow-Pin-Durchmesser",
      "faqTitle": "FAQ zu Glow-Mosaikpins",
      "faq": [
        [
          "Müssen Glow-Pins mit Licht aufgeladen werden?",
          "Ja. Photolumineszentes Material nimmt Licht auf und gibt es anschließend nach und nach wieder ab. Helles Licht erzeugt in der Regel einen stärkeren Anfangseffekt."
        ],
        [
          "Sieht der Pin bei Tageslicht normal aus?",
          "Ja. Metall, Epoxid und Farbmuster bleiben bei normalem Licht sichtbar; der Glow-Effekt wird nach dem Aufladen bei geringerem Umgebungslicht deutlicher."
        ],
        [
          "Ist die Leuchtdauer immer gleich?",
          "Nein. Sie hängt von Material, Intensität und Dauer der Aufladung sowie den Betrachtungsbedingungen ab."
        ],
        [
          "Können Glow-Pins international versendet werden?",
          "Ja. Der Shop bietet internationalen Versand mit Sendungsverfolgung aus Deutschland; der aktuelle Tarif wird im Warenkorb für das gewählte Zielland berechnet."
        ]
      ],
      "relatedTitle": "Passende Guides zu Custom-Messerpins"
    },
    "ru": {
      "title": "Светящиеся мозаичные пины для ножей | Glow Pins | Mosaic Pins Space",
      "meta": "Светящиеся мозаичные пины для кастомных рукоятей ножей. Дизайны Moonglow ручной работы с реальными фото, актуальным остатком и отслеживаемой доставкой из Германии.",
      "h1": "Светящиеся мозаичные пины для ножей",
      "kicker": "Светонакопительные детали для кастомных рукоятей",
      "intro": "Светящийся мозаичный пин даёт рукояти два визуальных состояния: одно при обычном освещении и другое после того, как светонакопительный материал зарядился. Лучше всего эффект работает, когда пин изначально является частью дизайна рукояти, а не добавляется только ради необычного свечения.",
      "lead": "Mosaic Pins Space делает небольшие серии glow-дизайнов для ножеделов. На страницах товаров используются реальные фотографии и точные PIN-коды, поэтому можно сравнить рисунок, диаметр, материалы и текущий остаток конкретной позиции.",
      "section1Title": "Как использовать glow-пины в дизайне",
      "section1": [
        "При дневном свете оценивай базовые цвета и металлический рисунок так же, как у обычного мозаичного пина. Свечение — дополнительный слой, а не единственная часть дизайна.",
        "Положение имеет значение. Glow-пин может стать главным акцентом, работать в паре с другим пином или находиться рядом с lanyard-элементом — в зависимости от пропорций рукояти.",
        "Яркость и продолжительность свечения зависят от условий зарядки, окружающего света и конкретного светонакопительного материала. Поэтому реальный эффект меняется в разных условиях."
      ],
      "section2Title": "От обычного света к темноте",
      "section2": "Хороший glow-пин должен выглядеть продуманно и тогда, когда он не светится. Поэтому в каталоге важен полный рисунок и сочетание материалов, а светящийся элемент встроен в мозаику и не выглядит отдельным трюком.",
      "productsTitle": "Светящиеся пины сейчас в наличии",
      "productsIntro": "Актуальная выборка glow-товаров из каталога Mosaic Pins Space. Доступные позиции показываются первыми.",
      "diametersTitle": "Актуальные диаметры glow-пинов",
      "faqTitle": "Вопросы о светящихся мозаичных пинах",
      "faq": [
        [
          "Glow-пины нужно заряжать светом?",
          "Да. Фотолюминесцентный материал поглощает свет, а затем постепенно его отдаёт. Яркий источник обычно даёт более сильное начальное свечение."
        ],
        [
          "Днём пин выглядит как обычный?",
          "Да. При обычном свете видны металл, эпоксидная смола и цветной рисунок; после зарядки в более тёмных условиях становится заметнее glow-эффект."
        ],
        [
          "Продолжительность свечения всегда одинаковая?",
          "Нет. Она зависит от материала, интенсивности и времени зарядки, а также условий наблюдения."
        ],
        [
          "Можно заказать glow-пины за границу?",
          "Да. Магазин отправляет заказы из Германии по миру с отслеживанием, а актуальная стоимость рассчитывается в корзине для выбранной страны."
        ]
      ],
      "relatedTitle": "Связанные материалы о пинах для кастомных ножей"
    },
    "fr": {
      "title": "Pins mosaïque phosphorescents pour couteaux | Glow Pins | Mosaic Pins Space",
      "meta": "Pins mosaïque phosphorescents pour manches de couteaux custom. Designs Moonglow artisanaux avec vraies photos, stock en direct et livraison suivie depuis l’Allemagne.",
      "h1": "Pins mosaïque phosphorescents pour couteaux",
      "kicker": "Détails photoluminescents pour manches de couteaux custom",
      "intro": "Un pin mosaïque glow donne deux états visuels à un manche : un aspect en lumière normale et un autre après recharge du matériau photoluminescent. L’effet fonctionne mieux lorsque le pin fait partie du design dès le départ plutôt que d’être ajouté uniquement comme gadget lumineux.",
      "lead": "Mosaic Pins Space fabrique de petites séries de designs glow pour couteliers. Les fiches produit utilisent de vraies photos et des codes PIN précis pour comparer le motif, le diamètre, les matériaux et le stock de l’article exact.",
      "section1Title": "Concevoir avec des pins glow",
      "section1": [
        "En plein jour, considérez les couleurs de base et le motif métallique comme pour un pin mosaïque classique. La luminescence est une couche supplémentaire, pas l’unique élément du design.",
        "Le placement compte. Un pin glow peut devenir un point focal, fonctionner par paire ou se placer près d’un détail lanyard selon les proportions du manche.",
        "L’intensité et la durée de luminescence dépendent des conditions de recharge, de la lumière ambiante et du matériau utilisé. Le rendu réel peut donc varier selon l’environnement."
      ],
      "section2Title": "De la lumière normale à la faible luminosité",
      "section2": "Un bon pin glow doit rester cohérent même lorsqu’il ne brille pas. Le catalogue met donc en avant le motif complet et la combinaison de matériaux, avec l’élément lumineux intégré à la mosaïque plutôt que présenté comme un accessoire séparé.",
      "productsTitle": "Pins glow actuellement disponibles",
      "productsIntro": "Sélection glow en direct du catalogue Mosaic Pins Space. Les designs en stock sont affichés en premier.",
      "diametersTitle": "Diamètres glow actuels",
      "faqTitle": "FAQ des pins mosaïque glow",
      "faq": [
        [
          "Les pins glow doivent-ils être chargés à la lumière ?",
          "Oui. Le matériau photoluminescent absorbe la lumière puis la restitue progressivement. Une lumière vive donne généralement une lueur initiale plus forte."
        ],
        [
          "Le pin reste-t-il esthétique en plein jour ?",
          "Oui. Le métal, l’époxy et le motif coloré restent visibles en lumière normale ; l’effet glow devient plus évident en faible luminosité après recharge."
        ],
        [
          "La durée de luminescence est-elle toujours la même ?",
          "Non. Elle varie selon le matériau, l’intensité et la durée de recharge ainsi que les conditions d’observation."
        ],
        [
          "Peut-on commander des pins glow à l’international ?",
          "Oui. La boutique expédie depuis l’Allemagne avec suivi international ; le tarif actuel est calculé dans le panier pour la destination choisie."
        ]
      ],
      "relatedTitle": "Guides associés sur les pins de couteaux custom"
    }
  }
};
const COMMON = {
  "en": {
    "shop": "Shop",
    "about": "About",
    "shipping": "Shipping",
    "returns": "Returns",
    "reviews": "Reviews",
    "account": "Account",
    "back": "← Back to Shop",
    "available": "In stock",
    "sold": "Sold out",
    "view": "View product",
    "materials": "Materials",
    "diameter": "Diameter",
    "pin": "PIN",
    "guides": "Guides",
    "current": "Live catalog",
    "empty": "No matching products are available right now. Browse the full shop to see the current collection.",
    "allShop": "Browse all pins"
  },
  "de": {
    "shop": "Shop",
    "about": "Über uns",
    "shipping": "Versand",
    "returns": "Rückgabe",
    "reviews": "Bewertungen",
    "account": "Konto",
    "back": "← Zurück zum Shop",
    "available": "Auf Lager",
    "sold": "Ausverkauft",
    "view": "Produkt ansehen",
    "materials": "Materialien",
    "diameter": "Durchmesser",
    "pin": "PIN",
    "guides": "Guides",
    "current": "Live-Katalog",
    "empty": "Aktuell sind keine passenden Produkte verfügbar. Im Shop findest du die derzeitige Kollektion.",
    "allShop": "Alle Pins ansehen"
  },
  "ru": {
    "shop": "Магазин",
    "about": "О нас",
    "shipping": "Доставка",
    "returns": "Возврат",
    "reviews": "Отзывы",
    "account": "Аккаунт",
    "back": "← Назад в магазин",
    "available": "В наличии",
    "sold": "Нет в наличии",
    "view": "Открыть товар",
    "materials": "Материалы",
    "diameter": "Диаметр",
    "pin": "PIN",
    "guides": "Материалы",
    "current": "Актуальный каталог",
    "empty": "Сейчас подходящих товаров нет в наличии. Открой магазин, чтобы посмотреть текущую коллекцию.",
    "allShop": "Смотреть все пины"
  },
  "fr": {
    "shop": "Boutique",
    "about": "À propos",
    "shipping": "Livraison",
    "returns": "Retours",
    "reviews": "Avis",
    "account": "Compte",
    "back": "← Retour à la boutique",
    "available": "En stock",
    "sold": "Rupture",
    "view": "Voir le produit",
    "materials": "Matériaux",
    "diameter": "Diamètre",
    "pin": "PIN",
    "guides": "Guides",
    "current": "Catalogue en direct",
    "empty": "Aucun produit correspondant n’est disponible pour le moment. Consultez la boutique pour voir la collection actuelle.",
    "allShop": "Voir tous les pins"
  }
};
const RELATED_LABELS = {
  "en": {
    "mosaic-pins-for-knives": "Mosaic pins for knives",
    "knife-handle-mosaic-pins": "Knife handle mosaic pins",
    "lanyard-pins-for-knives": "Lanyard pins for knives",
    "glow-mosaic-pins": "Glow mosaic pins"
  },
  "de": {
    "mosaic-pins-for-knives": "Mosaikpins für Messer",
    "knife-handle-mosaic-pins": "Mosaikpins für Messergriffe",
    "lanyard-pins-for-knives": "Lanyard Pins für Messer",
    "glow-mosaic-pins": "Glow Mosaikpins"
  },
  "ru": {
    "mosaic-pins-for-knives": "Мозаичные пины для ножей",
    "knife-handle-mosaic-pins": "Пины для рукоятей ножей",
    "lanyard-pins-for-knives": "Lanyard pins для ножей",
    "glow-mosaic-pins": "Светящиеся мозаичные пины"
  },
  "fr": {
    "mosaic-pins-for-knives": "Pins mosaïque pour couteaux",
    "knife-handle-mosaic-pins": "Pins mosaïque pour manches",
    "lanyard-pins-for-knives": "Lanyard pins pour couteaux",
    "glow-mosaic-pins": "Pins mosaïque glow"
  }
};

export async function renderSeoGuide({ request, env }, slug) {
  const guide = GUIDES[slug];
  if (!guide) return new Response("Not found", { status: 404 });

  const lang = readLanguage(request);
  const copy = guide[lang] || guide.en;
  const common = COMMON[lang] || COMMON.en;
  const canonical = `${SITE_ORIGIN}/${slug}`;

  let products = [];
  try {
    const catalog = await getProductsCatalog(env);
    products = selectProducts(catalog?.products || [], guide.key);
  } catch (e) {
    console.warn("SEO guide catalog unavailable", String(e?.message || e));
  }

  const diameters = uniqueDiameters(products);
  const html = buildHtml({ slug, lang, copy, common, canonical, products, diameters });
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "Vary": "Cookie"
    }
  });
}

function readLanguage(request) {
  const cookie = String(request?.headers?.get("cookie") || "");
  const m = cookie.match(/(?:^|;\s*)mp_language=([^;]+)/i);
  const value = m ? decodeURIComponent(m[1]).toLowerCase() : "en";
  return SUPPORTED.has(value) ? value : "en";
}

function selectProducts(raw, key) {
  const all = (Array.isArray(raw) ? raw : [])
    .filter(p => p && p.active)
    .map(p => ({ ...p, _score: scoreProduct(p, key) }));

  let matched = all.filter(p => p._score > 0);
  if (key === "mosaic" && matched.length < 6) matched = all;
  if (key === "knife" && matched.length < 6) matched = all.filter(p => !isLanyard(p));
  if ((key === "lanyard" || key === "glow") && matched.length === 0) matched = [];

  matched.sort((a,b) =>
    (Number(b.stock > 0) - Number(a.stock > 0)) ||
    (b._score - a._score) ||
    String(a.pin || "").localeCompare(String(b.pin || ""))
  );
  return matched.slice(0, 12);
}

function scoreProduct(p, key) {
  const title = String(p?.title || "");
  const type = String(p?.type || "");
  const pin = String(p?.pin || "");
  const description = String(p?.description || "");
  const hay = `${title} ${type} ${pin} ${description}`.toLowerCase();
  const lanyard = /lanyard|lanyard pin|lanyard tube/.test(hay) || /^l(?=\d)/i.test(pin);
  const glow = /glow|moonglow|luminous|lumines|phosphor/.test(hay) || /^mg/i.test(pin);
  const mosaic = /mosaic/.test(hay) || (!lanyard && !glow);

  if (key === "lanyard") return lanyard ? 20 : 0;
  if (key === "glow") return glow ? 20 : 0;
  if (key === "knife") return lanyard ? 0 : (glow ? 14 : mosaic ? 12 : 4);
  if (key === "mosaic") return lanyard ? 5 : (glow ? 12 : mosaic ? 14 : 6);
  return 1;
}

function isLanyard(p) { return scoreProduct(p, "lanyard") > 0; }

function uniqueDiameters(products) {
  const values = new Map();
  for (const p of products) {
    const raw = p?.diameterRaw ?? p?.diameter;
    if (raw == null || raw === "") continue;
    const display = cleanDiameter(raw);
    if (!display) continue;
    const numeric = Number(String(display).replace(",", ".").match(/[0-9]+(?:\.[0-9]+)?/)?.[0]);
    values.set(display, Number.isFinite(numeric) ? numeric : 9999);
  }
  return [...values.entries()].sort((a,b)=>a[1]-b[1]).map(([label])=>label);
}

function cleanDiameter(v) {
  const s = String(v ?? "").trim().replace(/^Ø\s*/i, "").replace(/\s*mm$/i, "");
  if (!s) return "";
  return s.replace(".", ",");
}

function productMaterials(p, lang) {
  if (lang === "de" && Array.isArray(p?.materialsDE)) return p.materialsDE;
  if (lang === "ru" && Array.isArray(p?.materialsRU)) return p.materialsRU;
  if (lang === "fr" && Array.isArray(p?.materialsFR)) return p.materialsFR;
  return Array.isArray(p?.materials) ? p.materials : [];
}

function buildHtml({ slug, lang, copy, common, canonical, products, diameters }) {
  const related = Object.keys(GUIDES).filter(x => x !== slug)
    .map(x => `<a class="relatedLink" href="/${escapeAttr(x)}">${escapeHtml(RELATED_LABELS[lang]?.[x] || RELATED_LABELS.en[x])}</a>`)
    .join("");

  const productCards = products.length
    ? products.map((p,i) => renderProductCard(p, lang, common, i)).join("")
    : `<div class="emptyState"><p>${escapeHtml(common.empty)}</p><a class="btn" href="/">${escapeHtml(common.allShop)}</a></div>`;

  const diameterChips = diameters.length
    ? diameters.map(d => `<span class="diameterChip">Ø${escapeHtml(d)} mm</span>`).join("")
    : `<span class="diameterChip">—</span>`;

  const bulletItems = copy.section1.map(x => `<li>${escapeHtml(x)}</li>`).join("");
  const faqHtml = copy.faq.map(([q,a]) => `<details class="faqItem"><summary>${escapeHtml(q)}</summary><p>${escapeHtml(a)}</p></details>`).join("");
  const faqSchema = {
    "@context":"https://schema.org",
    "@type":"FAQPage",
    mainEntity: copy.faq.map(([q,a]) => ({
      "@type":"Question", name:q,
      acceptedAnswer: { "@type":"Answer", text:a }
    }))
  };
  const itemListSchema = {
    "@context":"https://schema.org",
    "@type":"CollectionPage",
    name: copy.h1,
    url: canonical,
    description: copy.meta,
    isPartOf: { "@type":"WebSite", name:"Mosaic Pins Space", url:SITE_ORIGIN },
    mainEntity: {
      "@type":"ItemList",
      itemListElement: products.map((p,idx) => ({
        "@type":"ListItem", position:idx+1,
        url:`${SITE_ORIGIN}/p/${encodeURIComponent(String(p.pin || "")).replace(/%2C/gi, ",")}`,
        name:String(p.title || p.pin || "Mosaic Pin")
      }))
    }
  };
  const breadcrumbSchema = {
    "@context":"https://schema.org",
    "@type":"BreadcrumbList",
    itemListElement:[
      {"@type":"ListItem","position":1,"name":"Mosaic Pins Space","item":SITE_ORIGIN},
      {"@type":"ListItem","position":2,"name":copy.h1,"item":canonical}
    ]
  };

  return `<!doctype html>
<html lang="${escapeAttr(lang)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(copy.title)}</title>
  <meta name="description" content="${escapeAttr(copy.meta)}" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <link rel="canonical" href="${escapeAttr(canonical)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Mosaic Pins Space" />
  <meta property="og:title" content="${escapeAttr(copy.h1)}" />
  <meta property="og:description" content="${escapeAttr(copy.meta)}" />
  <meta property="og:url" content="${escapeAttr(canonical)}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${escapeAttr(copy.h1)}" />
  <meta name="twitter:description" content="${escapeAttr(copy.meta)}" />
  <link rel="icon" href="/favicon.ico?v=20260823-step24f" sizes="any" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=20260823-step24f" />
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=20260823-step24f" />
  <link rel="manifest" href="/site.webmanifest?v=20260823-step24f" />
  <script src="/assets/js/i18n-prepaint.js?v=20260823-flow15"></script>
  <script src="/assets/js/google-consent.js?v=20260831-step51d"></script>
  <link rel="stylesheet" href="/assets/css/seo-guides.css?v=20260824-step44" />
  <link rel="stylesheet" href="/assets/css/ui-unify.css?v=20260823-step24e-brand" />
  <script type="application/ld+json">${jsonForHtml(itemListSchema)}</script>
  <script type="application/ld+json">${jsonForHtml(breadcrumbSchema)}</script>
  <script type="application/ld+json">${jsonForHtml(faqSchema)}</script>
</head>
<body class="mp-page-guide">
  <div class="app">
    <aside class="sidebar">
      <div class="sb-top"><div class="brand"><span class="dot"></span> Mosaic Pins Space</div><div class="pill">${escapeHtml(common.guides)}</div></div>
      <nav class="sb-nav">
        <a class="nav-item" href="/">Shop</a>
        <a class="nav-item" href="/about">About</a>
        <a class="nav-item" href="/shipping">Shipping</a>
        <a class="nav-item" href="/returns">Returns</a>
        <a class="nav-item" href="/reviews">Reviews</a>
        <a class="nav-item" href="/account">Account</a>
      </nav>
      <div class="guideSideCard">
        <div class="guideSideLabel">${escapeHtml(common.current)}</div>
        <strong>${products.length}</strong>
        <span>${escapeHtml(copy.productsTitle)}</span>
      </div>
    </aside>

    <main class="main">
      <div class="topbar">
        <div><h1 class="h-title">${escapeHtml(copy.h1)}</h1><div class="sub">${escapeHtml(copy.kicker)}</div></div>
        <a class="btn backBtn" href="/">← Back to Shop</a>
      </div>

      <article class="content guideContent">
        <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Mosaic Pins Space</a><span>›</span><span>${escapeHtml(copy.h1)}</span></nav>

        <section class="guideHero">
          <div class="eyebrow">${escapeHtml(common.guides)} • Mosaic Pins Space</div>
          <h2>${escapeHtml(copy.h1)}</h2>
          <p class="guideLead">${escapeHtml(copy.intro)}</p>
          <p>${escapeHtml(copy.lead)}</p>
          <div class="heroActions"><a class="btn" href="#live-products">${escapeHtml(copy.productsTitle)}</a><a class="ghostBtn" href="/">${escapeHtml(common.allShop)}</a></div>
        </section>

        <section class="guideGrid">
          <div class="guidePanel">
            <h2>${escapeHtml(copy.section1Title)}</h2>
            <ul class="featureList">${bulletItems}</ul>
          </div>
          <div class="guidePanel">
            <h2>${escapeHtml(copy.section2Title)}</h2>
            <p>${escapeHtml(copy.section2)}</p>
            <h3>${escapeHtml(copy.diametersTitle)}</h3>
            <div class="diameterChips">${diameterChips}</div>
          </div>
        </section>

        <section class="productsSection" id="live-products">
          <div class="sectionHead"><div><span class="eyebrow">${escapeHtml(common.current)}</span><h2>${escapeHtml(copy.productsTitle)}</h2><p>${escapeHtml(copy.productsIntro)}</p></div><a class="ghostBtn" href="/">${escapeHtml(common.allShop)}</a></div>
          <div class="guideProducts">${productCards}</div>
        </section>

        <section class="faqSection">
          <span class="eyebrow">FAQ</span>
          <h2>${escapeHtml(copy.faqTitle)}</h2>
          <div class="faqList">${faqHtml}</div>
        </section>

        <section class="relatedSection">
          <h2>${escapeHtml(copy.relatedTitle)}</h2>
          <div class="relatedLinks">${related}</div>
        </section>
      </article>

      <footer class="footer">
        <div class="footerRow">
          <div class="footerBrand"><span class="dot" aria-hidden="true"></span><span>© ${new Date().getUTCFullYear()} Mosaic Pins Space</span></div>
          <div class="footerLinks">
            <a href="/">Shop</a><a href="/about">About</a><a href="/shipping">Shipping</a><a href="/returns">Returns</a><a href="/reviews">Reviews</a><a href="/privacy">Privacy Policy</a><a href="/impressum">Impressum</a><a href="mailto:support@mosaicpins.space">Support</a>
          </div>
        </div>
      </footer>
    </main>
  </div>

  <script src="/assets/js/seo-guides.js?v=20260824-step44"></script>
  <script src="/assets/js/site-common.js?v=20260824-step44-guides"></script>
</body>
</html>`;
}

function renderProductCard(p, lang, common, index) {
  const pin = String(p?.pin || "");
  const title = String(p?.title || pin || "Mosaic Pin");
  const url = `/p/${encodeURIComponent(pin).replace(/%2C/gi, ",")}`;
  const image = Array.isArray(p?.images) && p.images[0] ? String(p.images[0]) : "";
  const diameter = cleanDiameter(p?.diameterRaw ?? p?.diameter);
  const materials = productMaterials(p, lang).filter(Boolean).slice(0,4).join(" · ");
  const stock = Math.max(0, Number(p?.stock || 0));
  const stockText = stock > 0 ? `${common.available}: ${stock}` : common.sold;
  const imageHtml = image
    ? `<img src="${escapeAttr(image)}" alt="${escapeAttr(`${title} ${pin} for custom knife handle`)}" ${index > 1 ? 'loading="lazy"' : ''} decoding="async" />`
    : `<div class="productNoImage">Mosaic Pins Space</div>`;

  return `<article class="guideProductCard">
    <a class="productImage" href="${url}">${imageHtml}<span class="stockBadge ${stock > 0 ? "" : "sold"}">${escapeHtml(stockText)}</span></a>
    <div class="productCopy">
      <div class="productKicker">${escapeHtml(common.pin)} ${escapeHtml(pin)}</div>
      <h3><a href="${url}">${escapeHtml(title)}</a></h3>
      <div class="productMeta">${diameter ? `${escapeHtml(common.diameter)} Ø${escapeHtml(diameter)} mm` : ""}${diameter && materials ? " · " : ""}${escapeHtml(materials)}</div>
      <a class="productLink" href="${url}">${escapeHtml(common.view)} →</a>
    </div>
  </article>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function escapeAttr(value) { return escapeHtml(value); }
function jsonForHtml(value) { return JSON.stringify(value).replace(/</g, "\u003c"); }
