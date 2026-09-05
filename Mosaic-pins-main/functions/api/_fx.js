import { cacheGet, cacheSet } from "./_cache.js";

const EUR_USD_CACHE_KEY = "fx:eurusd:daily:v1";
const EUR_USD_CACHE_TTL = 12 * 60 * 60;
const EUR_USD_FALLBACK = 1.10;

export async function getEurUsdRate(env) {
  const cached = await cacheGet(env, EUR_USD_CACHE_KEY);

  if (cached) {
    const n = Number(cached);
    if (Number.isFinite(n) && n > 0) return n;
  }

  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD", {
      headers: { accept: "application/json" },
    });

    const d = await r.json().catch(() => ({}));
    const rate = Number(d?.rates?.USD);

    if (!r.ok || !Number.isFinite(rate) || rate <= 0) {
      throw new Error("EUR/USD rate unavailable");
    }

    await cacheSet(env, EUR_USD_CACHE_KEY, String(rate), EUR_USD_CACHE_TTL);
    return rate;
  } catch (e) {
    console.warn(
      `FX feed unavailable; using fallback EUR/USD ${EUR_USD_FALLBACK.toFixed(2)}`,
      String(e?.message || e)
    );
    return EUR_USD_FALLBACK;
  }
}

export function eurToUsd(amountEur, rate) {
  const amount = Number(amountEur);
  const fx = Number(rate);
  if (!Number.isFinite(amount) || !Number.isFinite(fx) || amount <= 0 || fx <= 0) {
    return null;
  }
  return roundMoney(amount * fx);
}

export function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
