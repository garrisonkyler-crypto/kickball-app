# Raider Kickball Classic — full system

Registration, Stripe payment, and roster management for the Andrews High School
kickball fundraiser.

Everything runs on Netlify: static pages, four serverless functions, and Netlify
Blobs for storage. No database to run, no server to keep alive.

```
public/          the website
  index.html       event page + registration form
  paid.html        "Payment received" page Stripe redirects to
  admin.html       password-protected roster dashboard  (/admin.html)
  flyer.html       printable poster + handouts
netlify/functions/
  register.mjs       POST /api/register    creates a registration
  stats.mjs          GET  /api/stats       public spot count (no personal data)
  stripe-webhook.mjs POST /api/stripe-webhook  marks people paid, automatically
  admin.mjs          GET/POST /api/admin   the dashboard's backend
```

---

## Setup — do these in order

### 1. Put this folder in a Git repo

Netlify needs to run a build so the functions get their dependency
(`@netlify/blobs`) installed. A drag-and-drop deploy skips the build step, so
this system will NOT work as a manual zip deploy.

Create a repo (GitHub is easiest), commit this whole folder, and push.

### 2. Point the existing Netlify project at the repo

In the **raiderkickball** project: **Project configuration → Build & deploy →
Link repository**. Linking the project you already have keeps
`kickball.centennialprintz.com` attached.

Build settings come from `netlify.toml` — publish directory `public`, functions
directory `netlify/functions`. Leave the build command empty.

### 3. Set two environment variables

**Project configuration → Environment variables:**

| Name | Value |
| --- | --- |
| `ADMIN_PASSWORD` | Any password you choose. It's what opens `/admin.html`. |
| `STRIPE_WEBHOOK_SECRET` | From Stripe in step 5 — `whsec_...` |

Redeploy after adding them; functions only read env vars at runtime on a fresh
deploy.

### 4. Create the Stripe Payment Link

Stripe Dashboard → **Payment Links** → new link:

- Product **Raider Kickball Classic — Player Entry**, **$10.00 USD**
- Turn on **Cash App Pay** under payment methods so students can pay that way
- **After payment → Redirect customers to**
  `https://kickball.centennialprintz.com/paid.html`

Copy the `https://buy.stripe.com/...` URL and paste it into `public/index.html`,
into the `PAY_LINK` line near the top of the script, then change:

```js
var PAY_LINK  = 'https://buy.stripe.com/your-link-here';
var PAY_WORDS = 'card or Cash App';
var PAY_LABEL = 'Pay $10 online';
```

Commit and push — Netlify redeploys on its own.

### 5. Create the Stripe webhook

Stripe Dashboard → **Developers → Webhooks → Add endpoint**:

- URL: `https://kickball.centennialprintz.com/api/stripe-webhook`
- Event: **`checkout.session.completed`** (that one only)

Copy the **signing secret** (`whsec_...`) into the `STRIPE_WEBHOOK_SECRET`
environment variable from step 3, then redeploy.

Use Stripe's **Send test webhook** button to confirm it returns 200.

---

## How payment tracking actually works

1. Someone registers → `register.mjs` stores them and returns an **id**
2. The pay button is built as
   `...buy.stripe.com/xxx?client_reference_id=<id>&prefilled_email=<their email>`
3. They pay → Stripe redirects them to `paid.html`
4. Stripe sends the webhook → `stripe-webhook.mjs` verifies the signature,
   reads `client_reference_id`, and flips that exact person to **paid**

No name matching, no guessing, no manual step.

If someone pays without going through the button (a parent using a direct link),
the webhook falls back to matching on email, then name. If it still can't match,
the payment is stored as an **unmatched payment** and shown at the top of the
admin dashboard so it's never lost.

## Things worth knowing

- **The cap is enforced on the server.** A cached page can't sneak an extra
  player in past 100 — `register.mjs` re-checks the count and moves them to the
  waitlist instead.
- **The site flips itself to waitlist-only** when the cap fills. `index.html`
  asks `/api/stats` on load. There is no switch to remember to flip.
- **A waitlister who pays becomes a player** automatically — paying is what
  claims a spot.
- **Webhook retries are safe.** Stripe retries failed deliveries; a repeat for
  someone already marked paid is ignored rather than double-counted.
- **The admin password is a single shared secret**, checked in constant time and
  sent as a header. It's appropriate for a school fundraiser roster; it is not
  bank-grade auth. Don't reuse a password you use elsewhere.
- **Signature verification is hand-rolled** with Node's `crypto` rather than the
  Stripe SDK, so the only dependency is `@netlify/blobs`.

## Local development

```bash
npm install
npx netlify dev
```

`netlify dev` runs the functions and Blobs locally at `http://localhost:8888`.
