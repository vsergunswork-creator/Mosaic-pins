import {
  listOrderRecords,
  escapeFormulaString,
} from "../_airtable-orders.js";
import {
  ensureInvoiceForOrder,
  assertInvoiceEligible,
} from "../_invoice.js";

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) return json({ ok: false, error: "DB binding is not configured" }, 500);

    const user = await getAuthenticatedUser(request, env);
    if (!user) return json({ ok: false, authenticated: false, error: "Sign in required" }, 401);
    if (!user.email_verified_at) return json({ ok: false, error: "Email is not verified" }, 403);

    const url = new URL(request.url);
    const requestedOrder = String(url.searchParams.get("order") || "").trim();
    if (!requestedOrder) return json({ ok: false, error: "Missing order" }, 400);

    const record = await findOwnedOrder(env, user.email, requestedOrder);
    if (!record) return json({ ok: false, error: "Order not found" }, 404);

    try {
      assertInvoiceEligible(record, env);
    } catch (error) {
      if (error?.code === "INVOICE_REFUNDED") {
        return json({ ok: false, error: "This order was refunded. Please contact support for a credit note." }, 409);
      }
      return json({ ok: false, error: "Invoice is available after payment" }, 409);
    }

    // This also backfills Airtable if the automatic post-payment upload was ever
    // interrupted, so the shop owner always gets the same immutable invoice copy.
    const result = await ensureInvoiceForOrder(env, record);
    const filename = `${safeFilename(result.invoice?.invoiceNumber || "Invoice")}.pdf`;
    const download = url.searchParams.get("download") === "1";

    return new Response(result.pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("account/invoice:", error);
    return json({ ok: false, error: "Unable to create this invoice right now." }, 500);
  }
}

export async function onRequestPost() {
  return json({ ok: false, error: "Method not allowed" }, 405);
}

async function findOwnedOrder(env, email, requestedOrder) {
  const emailField = String(env.AIRTABLE_CUSTOMER_EMAIL_FIELD || "Customer Email").trim();
  const codeField = String(env.AIRTABLE_ORDER_CODE_FIELD || env.AIRTABLE_ORDER_ID_FIELDI || "OrderCode").trim();
  const idField = String(env.AIRTABLE_ORDER_ID_FIELD || "Order ID").trim();
  const stripeField = String(env.AIRTABLE_STRIPE_SESSION_FIELD || "Stripe Session ID").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const wanted = escapeFormulaString(requestedOrder);

  const filterByFormula =
    `AND(LOWER({${emailField}})='${escapeFormulaString(normalizedEmail)}',` +
    `OR({${codeField}}='${wanted}',{${idField}}='${wanted}',{${stripeField}}='${wanted}'))`;

  const out = await listOrderRecords(env, { filterByFormula, maxRecords: 1, pageSize: 20 });
  return out.records?.[0] || null;
}

async function getAuthenticatedUser(request, env) {
  const token = getCookie(request.headers.get("Cookie") || "", "mp_session");
  if (!token) return null;

  const now = Math.floor(Date.now() / 1000);
  const tokenHash = await sha256(token);

  return env.DB.prepare(
    `SELECT u.email AS email, u.email_verified_at AS email_verified_at
     FROM account_sessions AS s
     JOIN account_users AS u ON u.id = s.user_id
     WHERE s.token_hash = ?1 AND s.expires_at >= ?2
     LIMIT 1`
  ).bind(tokenHash, now).first();
}

function getCookie(cookieHeader, name) {
  const prefix = `${name}=`;
  for (const part of String(cookieHeader || "").split(";")) {
    const item = part.trim();
    if (item.startsWith(prefix)) return item.slice(prefix.length);
  }
  return "";
}

async function sha256(value) {
  const data = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeFilename(value) {
  return String(value || "Invoice").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "Invoice";
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
