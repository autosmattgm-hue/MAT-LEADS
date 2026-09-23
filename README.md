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
npm run dev
```

Open `http://localhost:3000`.

The local runtime does not require `node_modules`; it uses built-in Node APIs so the product launches cleanly on a fresh machine. Real mode is always active: the API does not return simulated Google Maps leads, billing sessions, or AI responses. Missing provider credentials return explicit setup errors.

## Owner Access

Use this local owner account for full, free enterprise access:

- Email: `owner@matleads.local`
- Password: `admin2026`

Admin users receive unlimited enterprise access across lead search, CRM, reports, analytics, admin, billing, settings, and AI workflows. Billing is not required for admin accounts. Set `OWNER_EMAIL` and `OWNER_PASSWORD` in `.env` before deploying a public instance.

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

### Required Vercel Environment Variables

Vercel does not read the local `.env` file. Set these in Vercel > Project > Settings > Environment Variables (Production + Preview), then redeploy.

| Variable | Why it is required |
| --- | --- |
| `NODE_ENV=production` | Enables production guards and keeps provider errors explicit |
| `APP_URL=https://your-domain.com` | Used for URL parsing and same-origin CORS |
| `CORS_ORIGINS=https://your-domain.com,https://your-app.vercel.app` | Allows browser calls from your deployed origin |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Session tokens; use two different 64-character random strings |
| `NODE_ENV`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Firestore storage for accounts, leads, CRM and reports. Without these, writes return `503 STORAGE_NOT_CONFIGURED` because serverless filesystems are ephemeral |
| `FIREBASE_WEB_API_KEY` | Firebase Authentication for register/login. Without it, register/login return `503 FIREBASE_AUTH_NOT_CONFIGURED` |
| `NVIDIA_API_KEY`, `NVIDIA_BASE_URL`, `NVIDIA_MODEL`, `NVIDIA_MODEL_FALLBACKS` | AI analysis and outreach. Use models that are still live for your account |
| `GOOGLE_PLACES_API_KEY` (optional) | Google Places search. Leave empty to use the OpenStreetMap Overpass fallback |
| `STRIPE_SECRET_KEY` (optional) | Stripe checkout; without it the endpoint returns `503 STRIPE_NOT_CONFIGURED` |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` or the four `PAYPAL_*_PAYMENT_LINK` values | PayPal checkout |
| `OWNER_EMAIL`, `OWNER_PASSWORD` | Admin account with free enterprise access; change before going public |

Notes:

- Accounts registered on a local machine live in `data/local-store.json`, which is not deployed. Register again on the deployed site once `FIREBASE_WEB_API_KEY` is set so the account exists in Firebase Authentication.
- `https://your-domain.com/api/health` lists the integrations that are active and the variables that are still missing.
- The built-in owner account works even before the other variables are set, because it is resolved from `OWNER_EMAIL`/`OWNER_PASSWORD` (defaults: `owner@matleads.local` / `admin2026`).

Complete paid SaaS operation requires Firebase credentials, `NVIDIA_API_KEY`, Stripe credentials, and either PayPal API credentials or hosted PayPal payment links. `GOOGLE_PLACES_API_KEY` is optional because Google Maps links can seed real OpenStreetMap Overpass searches without a Google API key. The app will not fake provider responses.

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
- `GET /api/crm/leads`
- `PATCH /api/crm/leads/:id/stage`
- `GET /api/dashboard/metrics`
- `POST /api/billing/stripe/payment-intent`
- `POST /api/billing/paypal/order`
- `POST /api/billing/paypal/confirm`
