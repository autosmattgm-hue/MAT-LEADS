import { env } from "../config/env.js";
import { isFirebaseConfigured } from "../config/firebase.js";

export function health(_req, res) {
  res.json({
    status: "ok",
    service: "mat-leads-ai-pro-x",
    environment: env.nodeEnv,
    integrations: {
      firebase: isFirebaseConfigured(),
      googlePlaces: Boolean(env.google.placesApiKey),
      nvidia: Boolean(env.nvidia.apiKey),
      stripe: Boolean(env.stripe.secretKey),
      paypal: Boolean(env.paypal.clientId && env.paypal.clientSecret)
    }
  });
}
