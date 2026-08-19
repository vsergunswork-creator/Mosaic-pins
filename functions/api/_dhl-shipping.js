import { cacheGet, cacheSet } from "./_cache.js";
import { getEurUsdRate } from "./_fx.js";

const DHL_BASE = "https://api-eu.dhl.com/parcel/de/shipping/of/v1/public";
const CATALOG_FRESH_KEY = "dhl:private-shipping:catalog:current:v1";
const CATALOG_STALE_KEY = "dhl:private-shipping:catalog:stale:v1";

const FRESH_TTL = 23 * 60 * 60;
const STALE_TTL = 7 * 24 * 60 * 60;

const TARGET_WEIGHT_KG = 2;

const ISO3_TO_ISO2 = {
  "ABW":"AW","AFG":"AF","AGO":"AO","AIA":"AI","ALA":"AX","ALB":"AL",
  "AND":"AD","ARE":"AE","ARG":"AR","ARM":"AM","ASM":"AS","ATA":"AQ",
  "ATF":"TF","ATG":"AG","AUS":"AU","AUT":"AT","AZE":"AZ","BDI":"BI",
  "BEL":"BE","BEN":"BJ","BES":"BQ","BFA":"BF","BGD":"BD","BGR":"BG",
  "BHR":"BH","BHS":"BS","BIH":"BA","BLM":"BL","BLR":"BY","BLZ":"BZ",
  "BMU":"BM","BOL":"BO","BRA":"BR","BRB":"BB","BRN":"BN","BTN":"BT",
  "BVT":"BV","BWA":"BW","CAF":"CF","CAN":"CA","CCK":"CC","CHE":"CH",
  "CHL":"CL","CHN":"CN","CIV":"CI","CMR":"CM","COD":"CD","COG":"CG",
  "COK":"CK","COL":"CO","COM":"KM","CPV":"CV","CRI":"CR","CUB":"CU",
  "CUW":"CW","CXR":"CX","CYM":"KY","CYP":"CY","CZE":"CZ","DEU":"DE",
  "DJI":"DJ","DMA":"DM","DNK":"DK","DOM":"DO","DZA":"DZ","ECU":"EC",
  "EGY":"EG","ERI":"ER","ESH":"EH","ESP":"ES","EST":"EE","ETH":"ET",
  "FIN":"FI","FJI":"FJ","FLK":"FK","FRA":"FR","FRO":"FO","FSM":"FM",
  "GAB":"GA","GBR":"GB","GEO":"GE","GGY":"GG","GHA":"GH","GIB":"GI",
  "GIN":"GN","GLP":"GP","GMB":"GM","GNB":"GW","GNQ":"GQ","GRC":"GR",
  "GRD":"GD","GRL":"GL","GTM":"GT","GUF":"GF","GUM":"GU","GUY":"GY",
  "HKG":"HK","HMD":"HM","HND":"HN","HRV":"HR","HTI":"HT","HUN":"HU",
  "IDN":"ID","IMN":"IM","IND":"IN","IOT":"IO","IRL":"IE","IRN":"IR",
  "IRQ":"IQ","ISL":"IS","ISR":"IL","ITA":"IT","JAM":"JM","JEY":"JE",
  "JOR":"JO","JPN":"JP","KAZ":"KZ","KEN":"KE","KGZ":"KG","KHM":"KH",
  "KIR":"KI","KNA":"KN","KOR":"KR","KWT":"KW","LAO":"LA","LBN":"LB",
  "LBR":"LR","LBY":"LY","LCA":"LC","LIE":"LI","LKA":"LK","LSO":"LS",
  "LTU":"LT","LUX":"LU","LVA":"LV","MAC":"MO","MAF":"MF","MAR":"MA",
  "MCO":"MC","MDA":"MD","MDG":"MG","MDV":"MV","MEX":"MX","MHL":"MH",
  "MKD":"MK","MLI":"ML","MLT":"MT","MMR":"MM","MNE":"ME","MNG":"MN",
  "MNP":"MP","MOZ":"MZ","MRT":"MR","MSR":"MS","MTQ":"MQ","MUS":"MU",
  "MWI":"MW","MYS":"MY","MYT":"YT","NAM":"NA","NCL":"NC","NER":"NE",
  "NFK":"NF","NGA":"NG","NIC":"NI","NIU":"NU","NLD":"NL","NOR":"NO",
  "NPL":"NP","NRU":"NR","NZL":"NZ","OMN":"OM","PAK":"PK","PAN":"PA",
  "PCN":"PN","PER":"PE","PHL":"PH","PLW":"PW","PNG":"PG","POL":"PL",
  "PRI":"PR","PRK":"KP","PRT":"PT","PRY":"PY","PSE":"PS","PYF":"PF",
  "QAT":"QA","REU":"RE","ROU":"RO","RUS":"RU","RWA":"RW","SAU":"SA",
  "SDN":"SD","SEN":"SN","SGP":"SG","SGS":"GS","SHN":"SH","SJM":"SJ",
  "SLB":"SB","SLE":"SL","SLV":"SV","SMR":"SM","SOM":"SO","SPM":"PM",
  "SRB":"RS","SSD":"SS","STP":"ST","SUR":"SR","SVK":"SK","SVN":"SI",
  "SWE":"SE","SWZ":"SZ","SXM":"SX","SYC":"SC","SYR":"SY","TCA":"TC",
  "TCD":"TD","TGO":"TG","THA":"TH","TJK":"TJ","TKL":"TK","TKM":"TM",
  "TLS":"TL","TON":"TO","TTO":"TT","TUN":"TN","TUR":"TR","TUV":"TV",
  "TWN":"TW","TZA":"TZ","UGA":"UG","UKR":"UA","UMI":"UM","URY":"UY",
  "USA":"US","UZB":"UZ","VAT":"VA","VCT":"VC","VEN":"VE","VGB":"VG",
  "VIR":"VI","VNM":"VN","VUT":"VU","WLF":"WF","WSM":"WS","XKX":"XK",
  "YEM":"YE","ZAF":"ZA","ZMB":"ZM","ZWE":"ZW"
};

export async function getDhlShippingCountries(env) {
  const catalog = await getDhlCatalog(env);
  const codes = new Set();

  for (const [key, product] of Object.entries(catalog?.products || {})) {
    if (!isTrackedTwoKgParcelProduct(key, product)) continue;

    for (const region of Array.isArray(product?.regions) ? product.regions : []) {
      if (region?.unavailable === true) continue;

      const price = normalizePrice(region?.price?.amount);

      if (!Number.isFinite(price) || price <= 0) continue;

      for (const raw of Array.isArray(region?.countries) ? region.countries : []) {
        const iso2 = toIso2(raw);
        if (iso2) codes.add(iso2);
      }
    }
  }

  return [...codes].sort();
}

export async function getDhlTracked2kgQuote(
  env,
  countryIso2,
  currency = "EUR"
) {
  const country = String(countryIso2 || "")
    .trim()
    .toUpperCase();

  if (!/^[A-Z]{2}$/.test(country)) {
    throw new Error("A valid ISO-2 shipping country is required");
  }

  /*
   * IMPORTANT:
   *
   * DHL Private Shipping catalog can expose international DHL Paket
   * with a general maximum weight of 30 kg.
   *
   * The region price attached to that product can therefore represent
   * the large 30 kg tariff.
   *
   * Mosaic Pins packages are ALWAYS:
   *
   * - DHL Paket
   * - tracked
   * - <= 2 kg
   *
   * Therefore the DHL catalog is used to verify that tracked DHL Paket
   * service exists for the destination.
   *
   * The actual 2 kg online tariff is selected from DHL's official
   * destination zones below.
   */

  const catalog = await getDhlCatalog(env);
  const candidates = [];

  for (const [key, product] of Object.entries(catalog?.products || {})) {
    if (!isTrackedParcelProduct(key, product)) continue;

    const attrs = product?.attributes || {};

    const displayName = String(
      attrs?.displayName?.text || key || ""
    ).trim();

    for (const region of Array.isArray(product?.regions) ? product.regions : []) {
      if (region?.unavailable === true) continue;

      const regionCountries = (
        Array.isArray(region?.countries)
          ? region.countries
          : []
      )
        .map(toIso2)
        .filter(Boolean);

      if (!regionCountries.includes(country)) continue;

      candidates.push({
        key,
        productNumber: String(region?.productnumber || ""),
        service: displayName || "DHL Paket"
      });
    }
  }

  if (!candidates.length) {
    const err = new Error(
      `No DHL tracked Paket service is available to ${country}`
    );

    err.code = "DHL_NO_TRACKED_2KG";

    throw err;
  }

  const priceEUR = getTracked2kgOnlinePriceEUR(country);

  if (!Number.isFinite(priceEUR) || priceEUR <= 0) {
    const err = new Error(
      `No DHL Paket 2 kg online tariff is configured for ${country}`
    );

    err.code = "DHL_NO_TRACKED_2KG_PRICE";

    throw err;
  }

  candidates.sort((a, b) => {
    const a2 =
      /(?:^|\D)2\s*kg(?:\D|$)/i.test(
        `${a.key} ${a.service}`
      )
        ? 0
        : 1;

    const b2 =
      /(?:^|\D)2\s*kg(?:\D|$)/i.test(
        `${b.key} ${b.service}`
      )
        ? 0
        : 1;

    return a2 - b2;
  });

  const best = candidates[0];

  const cur =
    String(currency || "EUR").toUpperCase() === "USD"
      ? "USD"
      : "EUR";

  let price = priceEUR;
  let fx = 1;

  if (cur === "USD") {
    fx = await getEurUsdRate(env);

    price = roundMoney(
      priceEUR * fx
    );
  }

  return {
    country,
    carrier: "DHL",
    service: "DHL Paket 2 kg",
    productNumber: best.productNumber,
    tracking: true,
    maxWeightKg: TARGET_WEIGHT_KG,
    basePriceEUR: roundMoney(priceEUR),
    currency: cur,
    price: roundMoney(price),
    fxRate: cur === "USD" ? fx : undefined
  };
}

export async function getDhlCatalog(env) {
  const apiKey = String(
    env?.DHL_API_KEY || ""
  ).trim();

  if (!apiKey) {
    throw new Error(
      "DHL_API_KEY is not configured"
    );
  }

  const fresh = await cacheGet(
    env,
    CATALOG_FRESH_KEY
  );

  if (fresh) {
    try {
      return JSON.parse(fresh);
    } catch (_) {}
  }

  try {
    const r = await fetch(
      `${DHL_BASE}/catalog/current/products`,
      {
        headers: {
          "accept": "application/json",
          "dhl-api-key": apiKey
        },

        cf: {
          cacheTtl: 0,
          cacheEverything: false
        }
      }
    );

    const data = await r
      .json()
      .catch(() => ({}));

    if (!r.ok || !data?.products) {
      const details =
        data?.detail ||
        data?.message ||
        data?.title ||
        `HTTP ${r.status}`;

      throw new Error(
        `DHL Product Catalog failed: ${details}`
      );
    }

    const raw = JSON.stringify(data);

    await cacheSet(
      env,
      CATALOG_FRESH_KEY,
      raw,
      FRESH_TTL
    );

    await cacheSet(
      env,
      CATALOG_STALE_KEY,
      raw,
      STALE_TTL
    );

    return data;

  } catch (e) {

    const stale = await cacheGet(
      env,
      CATALOG_STALE_KEY
    );

    if (stale) {
      try {
        console.warn(
          "Using stale DHL catalog after refresh failure:",
          String(e?.message || e)
        );

        return JSON.parse(stale);

      } catch (_) {}
    }

    throw e;
  }
}

function isTrackedTwoKgParcelProduct(
  key,
  product
) {
  return isTrackedParcelProduct(
    key,
    product
  );
}

function isTrackedParcelProduct(
  key,
  product
) {
  const attrs = product?.attributes || {};

  if (attrs?.tracking !== true) {
    return false;
  }

  const displayName = String(
    attrs?.displayName?.text || key || ""
  ).trim();

  const lowerName =
    displayName.toLowerCase();

  if (
    /(express|päckchen|paeckchen|small\s*packet)/i.test(
      lowerName
    )
  ) {
    return false;
  }

  if (
    !/(paket|parcel)/i.test(
      lowerName
    )
  ) {
    return false;
  }

  const maxWeightKg =
    normalizeWeightKg(
      attrs?.maxWeight
    );

  return (
    Number.isFinite(maxWeightKg) &&
    maxWeightKg + 1e-9 >= TARGET_WEIGHT_KG
  );
}


/*
 * DHL PRIVATKUNDEN ONLINE PRICES
 *
 * DHL Paket <= 2 kg
 * Tracking included.
 *
 * Mosaic Pins shipping profile:
 * always tracked
 * always <= 2 kg
 */

const DHL_2KG_ZONE_PRICE_EUR =
  Object.freeze({
    DE: 6.19,

    Z1: 14.49,
    Z2: 19.49,
    Z3: 22.49,
    Z4: 27.49,
    Z5: 26.49,
    Z6: 22.49,
    Z7: 25.49,
    Z8: 27.49
  });


/*
 * ZONE 1
 * EU
 */

const DHL_ZONE_1 = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "MC",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE"
]);


/*
 * ZONE 2
 */

const DHL_ZONE_2 =
  new Set([
    "GB",
    "CH"
  ]);


/*
 * ZONE 3
 */

const DHL_ZONE_3 =
  new Set([
    "AX",
    "AD",
    "AL",
    "BY",
    "BA",
    "FO",
    "GI",
    "GG",
    "JE",
    "IS",
    "XK",
    "LI",
    "MD",
    "ME",
    "MK",
    "NO",
    "SM",
    "RS",
    "TR",
    "UA",
    "VA"
  ]);


/*
 * ZONE 4
 */

const DHL_ZONE_4 =
  new Set([
    "RU"
  ]);


/*
 * ZONE 5
 * Americas
 */

const DHL_ZONE_5 =
  new Set([
    "AI","AG","AR","AW","BS","BB",
    "BZ","BM","BO","BQ","BR","VG",
    "CL","CR","CW","DM","DO","EC",
    "SV","FK","GF","GD","GL","GP",
    "GT","GY","HT","HN","JM","KY",
    "CA","CO","CU","MQ","MX","MS",
    "NI","PA","PY","PE","PR","BL",
    "KN","LC","MF","PM","VC","GS",
    "SR","SX","TC","TT","UY","VE",
    "VI","US"
  ]);


/*
 * ZONE 6
 */

const DHL_ZONE_6 =
  new Set([
    "EG",
    "DZ",
    "IL",
    "JO",
    "LB",
    "LY",
    "MA",
    "PS",
    "SY",
    "TN"
  ]);


/*
 * ZONE 7
 */

const DHL_ZONE_7 =
  new Set([
    "AF","AO","GQ","AM","AZ","ET",
    "BH","BD","BJ","BT","BW","BN",
    "BF","BI","CN","DJ","CI","ER",
    "SZ","GA","GM","GE","GH","GN",
    "GW","HK","IN","ID","IQ","IR",
    "JP","YE","KH","CM","CV","KZ",
    "QA","KE","KG","KM","CD","CG",
    "KP","KR","KW","LA","LS","LR",
    "MO","MG","MW","MY","MV","ML",
    "MR","MU","YT","MN","MZ","MM",
    "NA","NP","NE","NG","OM","PK",
    "PH","RE","RW","ZM","ST","SA",
    "SN","SC","SL","ZW","SG","LK",
    "SH","ZA","SD","TJ","TW","TZ",
    "TH","TL","TG","TD","TM","UG",
    "UZ","AE","VN","CF"
  ]);


function getTracked2kgOnlinePriceEUR(
  country
) {
  if (country === "DE") {
    return DHL_2KG_ZONE_PRICE_EUR.DE;
  }

  if (DHL_ZONE_1.has(country)) {
    return DHL_2KG_ZONE_PRICE_EUR.Z1;
  }

  if (DHL_ZONE_2.has(country)) {
    return DHL_2KG_ZONE_PRICE_EUR.Z2;
  }

  if (DHL_ZONE_3.has(country)) {
    return DHL_2KG_ZONE_PRICE_EUR.Z3;
  }

  if (DHL_ZONE_4.has(country)) {
    return DHL_2KG_ZONE_PRICE_EUR.Z4;
  }

  if (DHL_ZONE_5.has(country)) {
    return DHL_2KG_ZONE_PRICE_EUR.Z5;
  }

  if (DHL_ZONE_6.has(country)) {
    return DHL_2KG_ZONE_PRICE_EUR.Z6;
  }

  if (DHL_ZONE_7.has(country)) {
    return DHL_2KG_ZONE_PRICE_EUR.Z7;
  }

  return DHL_2KG_ZONE_PRICE_EUR.Z8;
}


function toIso2(value) {
  const code = String(
    value || ""
  )
    .trim()
    .toUpperCase();

  if (/^[A-Z]{2}$/.test(code)) {
    return code;
  }

  if (/^[A-Z]{3}$/.test(code)) {
    return ISO3_TO_ISO2[code] || null;
  }

  return null;
}


function normalizeWeightKg(value) {
  const n = Number(value);

  if (
    !Number.isFinite(n) ||
    n <= 0
  ) {
    return NaN;
  }

  return n > 100
    ? n / 1000
    : n;
}


function normalizePrice(value) {
  const n = Number(value);

  if (
    !Number.isFinite(n) ||
    n <= 0
  ) {
    return NaN;
  }

  if (
    Number.isInteger(n) &&
    n >= 100
  ) {
    return n / 100;
  }

  return n;
}


function roundMoney(n) {
  return (
    Math.round(
      (Number(n) + Number.EPSILON) * 100
    ) / 100
  );
}


