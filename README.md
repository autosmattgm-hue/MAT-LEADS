# MAT LEADS AI PRO X

Premium Google Maps lead-generation SaaS for agencies, freelancers, SEO teams, and AI automation businesses.

## Stack

- Frontend: HTML5, CSS3, vanilla JavaScript ES2025
- Backend: Node.js API server with secure first-party routes
- Database: Firebase Firestore
- Hosting: Vercel
- AI: NVIDIA API / NVIDIA NIM models only
- Payments: Stripe Payment Intents plus hosted PayPal plan links with server-side checkout sessions

## Quick Start

```bash
cp .env.example .env
node api/server.js
```

Open `http://localhost:3000`.

Do not use the VS Code JSON Server or Live Server extensions for this project. They only serve static files and cannot run the required `/api/*` routes, including every AI feature. In VS Code, open **Run and Debug**, select **Run MAT Leads AI API**, and press F5.

The local runtime does not require `node_modules`; it uses built-in Node APIs so the product launches cleanly on a fresh machine. Real mode is always active: the API does not return simulated Google Maps leads, billing sessions, or AI responses. Missing provider credentials return explicit setup errors.

## Owner Access

Owner access is configured privately via `OWNER_EMAIL` and `OWNER_PASSWORD` in `.env` and is never displayed in the app UI.

## Free Trial Limits

New free accounts start on the Free Trial plan. The API allows 2 lead searches total, with each trial search capped at 5 returned leads. After both trial searches are used, `/api/leads/search` returns `TRIAL_LIMIT_REACHED` until the user activates a paid plan.

## Production Setup

1. Create a Firebase project with Authentication and Firestore enabled.
2. Add Firebase Admin credentials and the Firebase Web API key to Vercel environment variables.
3. Optional: enable Google Places API (New) and restrict the server key to your backend if you want Google Places results instead of the no-key OpenStreetMap fallback.
4. Add the NVIDIA API key, base URL, and selected NVIDIA NIM model ID.
5. Add Stripe credentials and either PayPal API credentials or hosted PayPal plan links.
6. Configure each hosted PayPal link to redirect successful payments to `https://your-domain.com/billing-success.html`.
7. Deploy to Vercel and configure your custom domain, TLS, and monitoring.

Complete paid SaaS operation requires Firebase credentials, `NVIDIA_API_KEY`, Stripe credentials, and either PayPal API credentials or hosted PayPal payment links. `GOOGLE_PLACES_API_KEY` is optional because Google Maps links can seed real OpenStreetMap Overpass searches without a Google API key. The app will not fake provider responses.

## AI troubleshooting

The AI features use the server-side NVIDIA NIM chat endpoint. Configure a valid `NVIDIA_API_KEY` locally and in Vercel, then restart or redeploy. Defaults use `z-ai/glm-5.3-flash` with `z-ai/glm-5.3` and `moonshotai/kimi-k3` fallbacks (all verified live Oct 2026).

Important: NVIDIA keys are authorized per-model. A `403 Authorization failed` means the key exists but is not activated for that model. While signed in at https://build.nvidia.com, open the model page (e.g. https://build.nvidia.com/z-ai/glm-5.3-flash), click "Get API Key" / activate it, then replace `NVIDIA_API_KEY` in `.env` and Vercel and redeploy. `410` means the model retired; the app skips dead IDs automatically. Check `GET /api/ai/status` after an AI request. `NVIDIA_AUTH_FAILED` means the key itself is invalid — generate a fresh key. The app deliberately returns the real error instead of presenting a canned response as real AI output.

## Google Maps Link Search

The dashboard accepts a Google Maps URL such as:

`https://www.google.com/maps/@13.4053888,-16.6887424,11z`

The backend parses coordinates from both `@lat,lng,zoom` URLs and `/place/...!3dLAT!4dLNG` URLs. If `GOOGLE_PLACES_API_KEY` is configured, it uses Google Places Text Search with `locationBias.circle`. If no Google key is configured, it uses the Google Maps link only as a location seed and fetches real public business records from OpenStreetMap Overpass.

For broad links like `/place/Europe/...` or `/place/United+States/...`, selected countries control the scan. The app searches curated profitable market hubs inside the selected countries, with category-specific Overpass tags for restaurants, hotels, boutiques, car dealers, auto repair, salons, dentists, clinics, gyms, real estate, law, accounting, contractors, pharmacies, retail, and more.

## Security Notes

- API keys stay on the server.
- Browser requests use first-party endpoints only.
- Helmet, CSP, CORS, rate limiting, validation, JWT checks, and Firebase token verification are wired in.
- Website audits include SSRF protections before outbound requests.
- Payment endpoints support idempotency keys.

## API Highlights

- `POST /api/leads/search`
- `POST /api/leads/:id/save`
- `GET /api/leads/:id/report`
- `POST /api/ai/analyze`
- `POST /api/ai/outreach`
- `POST /api/ai/tycoon` (Pro/Admin: Business AI Tycoon, WhatsApp-ready scripts)
- `POST /api/ai/websites` (Pro/Admin: generate pro client site)
- `PATCH /api/ai/websites/:id` (Pro/Admin: chat-refine the site)
- `GET /api/ai/websites/:id` (load Studio site)
- `GET /api/s/:token` (public shared-site JSON) + `GET /s/:token` (public live HTML)
- `GET /api/crm/leads`
- `PATCH /api/crm/leads/:id/stage`
- `GET /api/dashboard/metrics`
- `POST /api/billing/stripe/payment-intent`
- `POST /api/billing/paypal/order`
- `POST /api/billing/paypal/confirm`

## Money-Making Upgrades

- Lead cards + saved leads now show `Use AI to create website` toggle. Create Website stays hidden until ticked, then redirects to `/website-studio.html?leadId=...`.
- Website Studio: NVIDIA `deepseek-ai/deepseek-v4-flash` -> `z-ai/glm-5.3-flash` builds full HTML, chat-refine, download HTML, copy/open live `/s/:token` link. Pro/Admin only, free users go to `/pricing.html?upgrade=pro`.
- Business AI Tycoon page (`/business-ai.html`): NVIDIA `deepseek-ai/deepseek-v4-flash` closer brain, Pro/Admin only, Copy + Share-to-WhatsApp buttons.
- New earn pages: `/earn.html` referrals + invoices + payouts, `/gigs.html` claimable paid gigs, `/learn.html` student/adult tracks, `/outreach.html` money scripts, `/proposals.html` priced proposals, `/pay.html` client pay links.
- Pricing pushes Professional as the money plan with Studio + Tycoon; plans config also advertises the features.
- You add `NVIDIA_API_KEY` yourself in `.env` / Vercel. Base URL + models are prewired in `.env.example`.
