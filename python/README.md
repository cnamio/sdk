# cnamio

Server SDK for [Cnamio](https://cnamio.com): let the users of your app connect their own domain (`shop.customer.com` → your app). Cnamio finds where the domain's DNS is hosted, creates the records with the user's provider token (used once, never stored) or returns the exact records to copy, confirms them on the authoritative nameservers and sends your backend a signed webhook. Existing DNS records are never deleted or overwritten.

One module, standard library only, type hints throughout, Python 3.9+. Server only: it holds your application secret.

```bash
pip install cnamio
```

```python
import os
from cnamio import Cnamio, records_for_user, verify_webhook

cnamio = Cnamio()  # reads CNAMIO_APPLICATION_ID and CNAMIO_SECRET
# A CNAME to your hosting plus an ownership TXT unique to this user.
records = records_for_user(target="customers.yourapp.com", user_id=user.id, ownership_key=os.environ["CNAMIO_OWNERSHIP_KEY"])

session = cnamio.create_session(user_id=user.id, dns_records=records)  # -> the browser's connect window
job = cnamio.connect("shop.customer.com", records, user_id=user.id)    # or headless: exact records to show
status = cnamio.status(job["job_id"])["status"]                        # pending -> completed
ok = verify_webhook(raw_body, headers, os.environ.get("CNAMIO_WEBHOOK_SECRET"))  # domain.added = connected
```

In the browser, load `https://connect.cnamio.com/sdk/v1.js` and call `window.cnamio.connectDomain({ ...session, applicationName: 'Your App' })`.

## No account yet

- **Sandbox, no account:** `curl -s -X POST https://api.cnamio.com/v1/agent/sandbox` returns a 30-minute session of a test application (no real DNS). Use it as `Authorization: Bearer <auth_token>` with header `applicationId` on the REST routes.
- **Free account:** sign up at https://cnamio.com/#start, or let your coding agent call `POST https://api.cnamio.com/v1/agent/signup` (MCP tool `start_signup`) with your email. You get a test application (sandbox provider) and a live one on the free plan once you open the emailed link.

## For coding agents

Paste into Claude Code, Cursor, Codex or Copilot:

> Add custom domains for my users with Cnamio: read and follow https://cnamio.com/agent-onboarding/SKILL.md. If I don't have a Cnamio account yet, start in the sandbox right away and ask me before signing me up for a free account with my email.

- Skill: https://cnamio.com/agent-onboarding/SKILL.md · Everything in one file: https://cnamio.com/llms-full.txt
- Recipe: [Django](https://cnamio.com/recipes/django.md) (FastAPI and Flask: the same calls; read the raw body for the webhook)
- MCP server: `https://api.cnamio.com/mcp` (`claude mcp add --transport http cnamio https://api.cnamio.com/mcp`)

## API

`create_session`, `check_domain`, `connect`, `connect_automatic`, `status`, `recheck`, `last_webhook`; `manage.jobs()`, `.usage()`, `.application()`, `.set_webhook_url()`, `.webhook_secret()`, `.test_webhook()`, `.create_share_link()`, `.rotate_secret()`; helpers `records_for_user`, `ownership_value`, `verify_webhook`. Errors raise `CnamioError` with `status` (and `conflicts` on 409).

Docs: https://cnamio.com/docs · OpenAPI: https://cnamio.com/openapi.json · MIT license.
