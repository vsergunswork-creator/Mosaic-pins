// Compatibility endpoint.
// Old Stripe dashboard configurations may still point here; route them through the single canonical webhook.
export { onRequestPost } from "./stripe-webhook.js";
