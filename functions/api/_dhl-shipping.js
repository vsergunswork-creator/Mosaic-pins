import { cacheGet, cacheSet } from "./_cache.js";

const DHL_BASE = "https://api-eu.dhl.com/parcel/de/shipping/of/v1/public";
const CATALOG_FRESH_KEY = "dhl:private-shipping:catalog:current:v1";
const CATALOG_STALE_KEY = "dhl:private-shipping:catalog:stale:v1";
const FRESH_TTL = 23 * 60 * 60;
const STALE_TTL = 7 * 24 * 60 * 60;
const TARGET_WEIGHT_KG = 2;

const ISO3_TO_ISO2 = {"ABW": "AW", "AFG": "AF", "AGO": "AO", "AIA": "AI", "ALA": "AX", "ALB": "AL", "AND": "AD", "ARE": "AE", "ARG": "AR", "ARM": "AM", "ASM": "AS", "ATA": "AQ", "ATF": "TF", "ATG": "AG", "AUS": "AU", "AUT": "AT", "AZE": "AZ", "BDI": "BI", "BEL": "BE", "BEN": "BJ", "BES": "BQ", "BFA": "BF", "BGD": "BD", "BGR": "BG", "BHR": "BH", "BHS": "BS", "BIH": "BA", "BLM": "BL", "BLR": "BY", "BLZ": "BZ", "BMU": "BM", "BOL": "BO", "BRA": "BR", "BRB": "BB", "BRN": "BN", "BTN": "BT", "BVT": "BV", "BWA": "BW", "CAF": "CF", "CAN": "CA", "CCK": "CC", "CHE": "CH", "CHL": "CL", "CHN": "CN", "CIV": "CI", "CMR": "CM", "COD": "CD", "COG": "CG", "COK": "CK", "COL": "CO", "COM": "KM", "CPV": "CV", "CRI": "CR", "CUB": "CU", "CUW": "CW", "CXR": "CX", "CYM": "KY", "CYP": "CY", "CZE": "CZ", "DEU": "DE", "DJI": "DJ", "DMA": "DM", "DNK": "DK", "DOM": "DO", "DZA": "DZ", "ECU": "EC", "EGY": "EG", "ERI": "ER", "ESH": "EH", "ESP": "ES", "EST": "EE", "ETH": "ET", "FIN": "FI", "FJI": "FJ", "FLK": "FK", "FRA": "FR", "FRO": "FO", "FSM": "FM", "GAB": "GA", "GBR": "GB", "GEO": "GE", "GGY": "GG", "GHA": "GH", "GIB": "GI", "GIN": "GN", "GLP": "GP", "GMB": "GM", "GNB": "GW", "GNQ": "GQ", "GRC": "GR", "GRD": "GD", "GRL": "GL", "GTM": "GT", "GUF": "GF", "GUM": "GU", "GUY": "GY", "HKG": "HK", "HMD": "HM", "HND": "HN", "HRV": "HR", "HTI": "HT", "HUN": "HU", "IDN": "ID", "IMN": "IM", "IND": "IN", "IOT": "IO", "IRL": "IE", "IRN": "IR", "IRQ": "IQ", "ISL": "IS", "ISR": "IL", "ITA": "IT", "JAM": "JM", "JEY": "JE", "JOR": "JO", "JPN": "JP", "KAZ": "KZ", "KEN": "KE", "KGZ": "KG", "KHM": "KH", "KIR": "KI", "KNA": "KN", "KOR": "KR", "KWT": "KW", "LAO": "LA", "LBN": "LB", "LBR": "LR", "LBY": "LY", "LCA": "LC", "LIE": "LI", "LKA": "LK", "LSO": "LS", "LTU": "LT", "LUX": "LU", "LVA": "LV", "MAC": "MO", "MAF": "MF", "MAR": "MA", "MCO": "MC", "MDA": "MD", "MDG": "MG", "MDV": "MV", "MEX": "MX", "MHL": "MH", "MKD": "MK", "MLI": "ML", "MLT": "MT", "MMR": "MM", "MNE": "ME", "MNG": "MN", "MNP": "MP", "MOZ": "MZ", "MRT": "MR", "MSR": "MS", "MTQ": "MQ", "MUS": "MU", "MWI": "MW", "MYS": "MY", "MYT": "YT", "NAM": "NA", "NCL": "NC", "NER": "NE", "NFK": "NF", "NGA": "NG", "NIC": "NI", "NIU": "NU", "NLD": "NL", "NOR": "NO", "NPL": "NP", "NRU": "NR", "NZL": "NZ", "OMN": "OM", "PAK": "PK", "PAN": "PA", "PCN": "PN", "PER": "PE", "PHL": "PH", "PLW": "PW", "PNG": "PG", "POL": "PL", "PRI": "PR", "PRK": "KP", "PRT": "PT", "PRY": "PY", "PSE": "PS", "PYF": "PF", "QAT": "QA", "REU": "RE", "ROU": "RO", "RUS": "RU", "RWA": "RW", "SAU": "SA", "SDN": "SD", "SEN": "SN", "SGP": "SG", "SGS": "GS", "SHN": "SH", "SJM": "SJ", "SLB": "SB", "SLE": "SL", "SLV": "SV", "SMR": "SM", "SOM": "SO", "SPM": "PM", "SRB": "RS", "SSD": "SS", "STP": "ST", "SUR": "SR", "SVK": "SK", "SVN": "SI", "SWE": "SE", "SWZ": "SZ", "SXM": "SX", "SYC": "SC", "SYR": "SY", "TCA": "TC", "TCD": "TD", "TGO": "TG", "THA": "TH", "TJK": "TJ", "TKL": "TK", "TKM": "TM", "TLS": "TL", "TON": "TO", "TTO": "TT", "TUN": "TN", "TUR": "TR", "TUV": "TV", "TWN": "TW", "TZA": "TZ", "UGA": "UG", "UKR": "UA", "UMI": "UM", "URY": "UY", "USA": "US", "UZB": "UZ", "VAT": "VA", "VCT": "VC", "VEN": "VE", "VGB": "VG", "VIR": "VI", "VNM": "VN", "VUT": "VU", "WLF": "WF", "WSM": "WS", "XKX": "XK", "YEM": "YE", "ZAF": "ZA", "ZMB": "ZM", "ZWE": "ZW"};

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

export async function getDhlTracked2kgQuote(env, countryIso2, currency = "EUR") {
  const country = String(countryIso2 || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new Error("A valid ISO-2 shipping country is required");
  }

  const catalog = await getDhlCatalog(env);
  const candidates = [];

  for (const [key, product] of Object.entries(catalog?.products || {})) {
    if (!isTrackedTwoKgParcelProduct(key, product)) continue;
    const attrs = product?.attributes || {};
    const displayName = String(attrs?.displayName?.text || key || "").trim();
    const maxWeightKg = normalizeWeightKg(attrs?.maxWeight);

    for (const region of Array.isArray(product?.regions) ? product.regions : []) {
      if (region?.unavailable === true) continue;
      const regionCountries = (Array.isArray(region?.countries) ? region.countries : [])
        .map(toIso2)
        .filter(Boolean);
      if (!regionCountries.includes(country)) continue;

      const eur = normalizePrice(region?.price?.amount);
      if (!Number.isFinite(eur) || eur <= 0) continue;

      candidates.push({
        key,
        productNumber: String(region?.productnumber || ""),
        service: displayName || "DHL Paket",
        tracking: true,
        maxWeightKg,
        priceEUR: eur,
      });
    }
  }

  if (!candidates.length) {
    const err = new Error(`No DHL tracked Paket up to 2 kg is available to ${country}`);
    err.code = "DHL_NO_TRACKED_2KG";
    throw err;
  }

  // Prefer the smallest weight class that can carry 2 kg, then the lowest price.
  candidates.sort((a, b) => (a.maxWeightKg - b.maxWeightKg) || (a.priceEUR - b.priceEUR));
  const bestWeight = candidates[0].maxWeightKg;
  const sameClass = candidates.filter(x => Math.abs(x.maxWeightKg - bestWeight) < 1e-9);
  sameClass.sort((a,b) => a.priceEUR - b.priceEUR);
  const best = sameClass[0];

  const cur = String(currency || "EUR").toUpperCase() === "USD" ? "USD" : "EUR";
  let price = best.priceEUR;
  let fx = 1;

  if (cur === "USD") {
    fx = await getEurUsdRate(env);
    price = roundMoney(best.priceEUR * fx);
  }

  return {
    country,
    carrier: "DHL",
    service: best.service,
    productNumber: best.productNumber,
    tracking: true,
    maxWeightKg: best.maxWeightKg,
    basePriceEUR: roundMoney(best.priceEUR),
    currency: cur,
    price: roundMoney(price),
    fxRate: cur === "USD" ? fx : undefined,
  };
}

export async function getDhlCatalog(env) {
  const apiKey = String(env?.DHL_API_KEY || "").trim();
  if (!apiKey) throw new Error("DHL_API_KEY is not configured");

  const fresh = await cacheGet(env, CATALOG_FRESH_KEY);
  if (fresh) {
    try { return JSON.parse(fresh); } catch (_) {}
  }

  try {
    const r = await fetch(`${DHL_BASE}/catalog/current/products`, {
      headers: {
        "accept": "application/json",
        "dhl-api-key": apiKey,
      },
      cf: { cacheTtl: 0, cacheEverything: false },
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data?.products) {
      const details = data?.detail || data?.message || data?.title || `HTTP ${r.status}`;
      throw new Error(`DHL Product Catalog failed: ${details}`);
    }

    const raw = JSON.stringify(data);
    await cacheSet(env, CATALOG_FRESH_KEY, raw, FRESH_TTL);
    await cacheSet(env, CATALOG_STALE_KEY, raw, STALE_TTL);
    return data;
  } catch (e) {
    const stale = await cacheGet(env, CATALOG_STALE_KEY);
    if (stale) {
      try {
        console.warn("Using stale DHL catalog after refresh failure:", String(e?.message || e));
        return JSON.parse(stale);
      } catch (_) {}
    }
    throw e;
  }
}

function isTrackedTwoKgParcelProduct(key, product) {
  const attrs = product?.attributes || {};
  if (attrs?.tracking !== true) return false;
  const displayName = String(attrs?.displayName?.text || key || "").trim();
  const lowerName = displayName.toLowerCase();
  if (/(express|päckchen|paeckchen|small\s*packet)/i.test(lowerName)) return false;
  if (!/(paket|parcel)/i.test(lowerName)) return false;
  const maxWeightKg = normalizeWeightKg(attrs?.maxWeight);
  return Number.isFinite(maxWeightKg) && maxWeightKg + 1e-9 >= TARGET_WEIGHT_KG;
}

function toIso2(value) {
  const code = String(value || "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(code)) return code;
  if (/^[A-Z]{3}$/.test(code)) return ISO3_TO_ISO2[code] || null;
  return null;
}

function normalizeWeightKg(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  // DHL schemas can express weight in kg; tolerate gram-style catalogs too.
  return n > 100 ? n / 1000 : n;
}

function normalizePrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  // Production catalog normally returns decimal EUR values. Tolerate cent integers too.
  if (Number.isInteger(n) && n >= 100) return n / 100;
  return n;
}

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

async function getEurUsdRate(env) {
  const key = "fx:eurusd:daily:v1";
  const cached = await cacheGet(env, key);
  if (cached) {
    const n = Number(cached);
    if (Number.isFinite(n) && n > 0) return n;
  }

  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD", {
      headers: { "accept": "application/json" },
    });
    const d = await r.json().catch(() => ({}));
    const rate = Number(d?.rates?.USD);
    if (!r.ok || !Number.isFinite(rate) || rate <= 0) throw new Error("EUR/USD rate unavailable");
    await cacheSet(env, key, String(rate), 12 * 60 * 60);
    return rate;
  } catch (e) {
    // Conservative fallback only if the public FX feed is temporarily unavailable.
    console.warn("FX feed unavailable; using fallback EUR/USD 1.10", String(e?.message || e));
    return 1.10;
  }
}
