# cnamio

Server SDK for [Cnamio](https://cnamio.com): let the users of your app connect their own domain (`shop.customer.com` → your app). Cnamio finds where the domain's DNS is hosted, creates the records with the user's provider token (used once, never stored) or returns the exact records to copy, confirms them on the authoritative nameservers and sends your backend a signed webhook. Existing DNS records are never deleted or overwritten.

One file, no dependencies, typed, Node.js 18+ (also Bun and Deno). Server only: it holds your application secret.

```bash
npm install cnamio
```

```js
import { Cnamio, recordsForUser, verifyWebhook } from 'cnamio';

const cnamio = new Cnamio(); // reads CNAMIO_APPLICATION_ID and CNAMIO_SECRET
// A CNAME to your hosting plus an ownership TXT unique to this user.
const records = recordsForUser({ target: 'customers.yourapp.com', userId: user.id, ownershipKey: process.env.CNAMIO_OWNERSHIP_KEY });

const session = await cnamio.createSession({ userId: user.id, dnsRecords: records }); // → the browser's connect window
const job = await cnamio.connect('shop.customer.com', records, { userId: user.id });   // or headless: exact records to show
const { status } = await cnamio.status(job.job_id);                                     // pending → completed
const ok = verifyWebhook(rawBody, headers, process.env.CNAMIO_WEBHOOK_SECRET);          // domain.added = connected
```

In the browser, load `https://connect.cnamio.com/sdk/v1.js` and call `window.cnamio.connectDomain({ ...session, applicationName: 'Your App' })`.

## No account yet

- **Sandbox, no account:** `curl -s -X POST https://api.cnamio.com/v1/agent/sandbox` returns a 30-minute session of a test application (no real DNS). Use it as `Authorization: Bearer <auth_token>` with header `applicationId` on the REST routes.
- **Free account:** sign up at https://cnamio.com/#start, or let your coding agent call `POST https://api.cnamio.com/v1/agent/signup` (MCP tool `start_signup`) with your email. You get a test application (sandbox provider) and a live one on the free plan once you open the emailed link.

## For coding agents

Paste into Claude Code, Cursor, Codex or Copilot:

> Add custom domains for my users with Cnamio: read and follow https://cnamio.com/agent-onboarding/SKILL.md. If I don't have a Cnamio account yet, start in the sandbox right away and ask me before signing me up for a free account with my email.

- Skill: https://cnamio.com/agent-onboarding/SKILL.md · Everything in one file: https://cnamio.com/llms-full.txt
- Recipes: [Next.js](https://cnamio.com/recipes/nextjs.md), [Express](https://cnamio.com/recipes/express.md)
- MCP server: `https://api.cnamio.com/mcp` (`claude mcp add --transport http cnamio https://api.cnamio.com/mcp`)

## API

`createSession`, `checkDomain`, `connect`, `connectAutomatic`, `status`, `recheck`, `lastWebhook`; `manage.jobs()`, `.usage()`, `.application()`, `.setWebhookUrl()`, `.webhookSecret()`, `.testWebhook()`, `.createShareLink()`, `.rotateSecret()`; helpers `recordsForUser`, `ownershipValue`, `verifyWebhook`. Errors are `CnamioError` with `status` (and `conflicts` on 409). Types ship in `cnamio.d.mts`.

Docs: https://cnamio.com/docs · OpenAPI: https://cnamio.com/openapi.json · MIT license.
