// Cnamio server SDK for Node.js 18+ (also Bun and Deno): one file, no dependencies.
// Latest: https://cnamio.com/sdk/cnamio.mjs · Types: https://cnamio.com/sdk/cnamio.d.mts · Docs: https://cnamio.com/docs
// Use it on your server only: it holds the application secret.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const VERSION = '1.1.1';
const DEFAULT_BASE_URL = 'https://api.cnamio.com';
/** Session tokens live 60 minutes; the client renews its own after 50. */
const SESSION_REUSE_MS = 50 * 60_000;

/**
 * A non-2xx answer from Cnamio. `status` is the HTTP status; `conflicts` is set on the 409 of connectAutomatic
 * (reason codes as strings, e.g. `name_occupied`). 503 means "not now": repeat the same call after a few seconds.
 */
export class CnamioError extends Error {
  constructor(status, message, body) {
    super(message || `Cnamio answered ${status}`);
    this.name = 'CnamioError';
    this.status = status;
    this.body = body ?? null;
    this.conflicts = body && Array.isArray(body.conflicts) ? body.conflicts : null;
  }
}

export class Cnamio {
  /**
   * @param {{ applicationId?: string, secret?: string, baseUrl?: string, fetch?: typeof fetch, timeoutMs?: number }} [options]
   * Defaults read CNAMIO_APPLICATION_ID and CNAMIO_SECRET from the environment.
   */
  constructor(options = {}) {
    const env = typeof process !== 'undefined' && process.env ? process.env : {};
    this.applicationId = options.applicationId ?? env.CNAMIO_APPLICATION_ID ?? '';
    this.secret = options.secret ?? env.CNAMIO_SECRET ?? '';
    if (!this.applicationId || !this.secret) throw new Error('Cnamio: applicationId and secret are required (or set CNAMIO_APPLICATION_ID and CNAMIO_SECRET).');
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this._fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this._session = null;
    this.manage = new CnamioManage(this);
  }

  async _request(method, path, { body, headers = {} } = {}) {
    const response = await this._fetch(this.baseUrl + path, {
      method,
      headers: { 'User-Agent': `cnamio-node/${VERSION}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) throw new CnamioError(response.status, data && typeof data.message === 'string' ? data.message : '', data);
    return data;
  }

  /**
   * A session token for the connect window in the browser. Bind `dnsRecords` (and optionally `domain`) so the page cannot change them,
   * and send the returned object to your page as is: `cnamio.connectDomain({ ...session, applicationName, locale })`.
   * @returns {Promise<{ token: string, applicationId: string, dnsRecords?: object[], expiresAt: number }>}
   */
  async createSession({ userId, dnsRecords, domain } = {}) {
    const body = { applicationId: this.applicationId, secret: this.secret };
    if (userId !== undefined && userId !== null) body.userId = String(userId);
    if (dnsRecords !== undefined) body.dnsRecords = dnsRecords;
    if (domain !== undefined) body.domain = domain;
    const data = await this._request('POST', '/token', { body });
    return { token: data.auth_token, applicationId: this.applicationId, ...(dnsRecords !== undefined ? { dnsRecords } : {}), expiresAt: Date.now() + 60 * 60_000 };
  }

  /** The client's own unbound session for server-side calls, reused while fresh. */
  async _token(force = false) {
    if (!force && this._session && this._session.renewAt > Date.now()) return this._session.token;
    const { token } = await this.createSession();
    this._session = { token, renewAt: Date.now() + SESSION_REUSE_MS };
    return token;
  }

  async _sessionCall(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const token = await this._token(attempt > 0);
      try {
        return await this._request(method, path, { body, headers: { Authorization: `Bearer ${token}`, applicationId: this.applicationId } });
      } catch (error) {
        // An expired or rotated session is renewed once; anything else is the caller's to handle.
        if (attempt === 0 && error instanceof CnamioError && error.status === 401) { this._session = null; continue; }
        throw error;
      }
    }
  }

  /** Where the domain's DNS is, whether it can be automatic, conflicts and the current record state. */
  checkDomain(domain, dnsRecords, { checkConflicts = true, acceptMerges = false, locale } = {}) {
    return this._sessionCall('POST', '/checkdomain', { domain, dnsRecords, checkConflicts, ...(acceptMerges ? { acceptMerges: true } : {}), ...(locale ? { locale } : {}) });
  }

  /** Manual setup: returns the exact records to show the user and starts watching propagation. */
  connect(domain, dnsRecords, { userId, locale } = {}) {
    return this._sessionCall('POST', '/connect', { domain, dnsRecords, ...(userId != null ? { userId: String(userId) } : {}), ...(locale ? { locale } : {}) });
  }

  /** Creates the records with the user's provider API token (used once, never stored). Throws CnamioError 409 with `conflicts`, or 422. */
  connectAutomatic(domain, dnsRecords, providerToken, { userId } = {}) {
    return this._sessionCall('POST', '/connect/automatic', { domain, dnsRecords, providerToken, ...(userId != null ? { userId: String(userId) } : {}) });
  }

  /** `{ job_id, connected, status, domain, propagation_status, setup_type }` */
  status(jobId) { return this._sessionCall('GET', `/connect/${encodeURIComponent(jobId)}/status`); }

  /** Checks propagation again now (at most once every 5 minutes per connection). A finished connection throws CnamioError 409. */
  recheck(jobId) { return this._sessionCall('POST', `/connect/propagation/recheck/${encodeURIComponent(jobId)}`, {}); }

  /** The last webhook of a connection and its delivery state. */
  lastWebhook(jobId) { return this._sessionCall('GET', `/connect/webhooks/last/${encodeURIComponent(jobId)}`); }
}

/** Management API (HTTP Basic with the application credentials). Reach it as `client.manage`. */
class CnamioManage {
  constructor(client) { this._client = client; }
  _call(method, path, body) {
    const basic = Buffer.from(`${this._client.applicationId}:${this._client.secret}`).toString('base64');
    return this._client._request(method, path, { body, headers: { Authorization: `Basic ${basic}` } });
  }
  application() { return this._call('GET', '/v1/manage/application'); }
  /** HTTPS URL, or null to stop deliveries. Does not change the webhook secret. */
  setWebhookUrl(url) { return this._call('PUT', '/v1/manage/webhook', { url }); }
  /** Strict record names: `{ strict?: boolean, allowedNames?: string[] }` (names relative to the zone: `@`, `_dmarc`). */
  setRecordNames(change) { return this._call('PUT', '/v1/manage/record-names', change); }
  /** Continuous monitoring of connected domains (read-only DNS checks): on or off. */
  setMonitoring(enabled) { return this._call('PUT', '/v1/manage/monitoring', { enabled }); }
  /** The secret that signs your webhooks: `(await client.manage.webhookSecret()).webhook_secret`. */
  webhookSecret() { return this._call('GET', '/v1/manage/webhook-secret'); }
  testWebhook() { return this._call('POST', '/v1/manage/webhook-test', {}); }
  /** Recent connections, newest first. */
  jobs({ limit, before, status, domain, health, shareLinkId } = {}) {
    const query = new URLSearchParams();
    if (limit !== undefined) query.set('limit', String(limit));
    if (before !== undefined) query.set('before', before instanceof Date ? before.toISOString() : String(before));
    if (status) query.set('status', status);
    if (domain) query.set('domain', domain);
    if (health) query.set('health', health);
    if (shareLinkId) query.set('share_link_id', shareLinkId);
    const qs = query.toString();
    return this._call('GET', `/v1/manage/jobs${qs ? `?${qs}` : ''}`);
  }
  /**
   * A link for whoever manages the DNS (an agency, the IT team): they open `url` and connect these domains with these
   * records, without your secret. `maxUses` per domain (default 1), `expiresInDays` (default 7, at most 30).
   * `url` and `token` are returned only here: send the url to that person, do not log it.
   */
  createShareLink({ domains, dnsRecords, maxUses, expiresInDays, userId, label }) {
    return this._call('POST', '/v1/manage/share-links', { domains, dnsRecords, ...(maxUses !== undefined ? { maxUses } : {}),
      ...(expiresInDays !== undefined ? { expiresInDays } : {}), ...(userId != null ? { userId: String(userId) } : {}), ...(label ? { label } : {}) });
  }
  /** Links of the application, newest first (never their tokens). */
  shareLinks({ limit, before } = {}) {
    const query = new URLSearchParams();
    if (limit !== undefined) query.set('limit', String(limit));
    if (before !== undefined) query.set('before', before instanceof Date ? before.toISOString() : String(before));
    const qs = query.toString();
    return this._call('GET', `/v1/manage/share-links${qs ? `?${qs}` : ''}`);
  }
  shareLink(shareLinkId) { return this._call('GET', `/v1/manage/share-links/${encodeURIComponent(shareLinkId)}`); }
  /** Ends the link now; connections already started go on. */
  revokeShareLink(shareLinkId) { return this._call('POST', `/v1/manage/share-links/${encodeURIComponent(shareLinkId)}/revoke`, {}); }
  /** `month` as YYYY-MM (UTC); defaults to the current month. */
  usage(month) { return this._call('GET', `/v1/manage/usage${month ? `?month=${encodeURIComponent(month)}` : ''}`); }
  /** New secret, shown once; the old one keeps working for `graceHours` (default 24). */
  rotateSecret(graceHours) { return this._call('POST', '/v1/manage/rotate-secret', graceHours === undefined ? {} : { graceHours }); }
}

/**
 * The records most apps need: a CNAME to your target plus a TXT whose value is unique to the user, so a user cannot
 * claim a domain another user already pointed at you. `ownershipKey` is a long random secret of yours (CNAMIO_OWNERSHIP_KEY).
 */
export function recordsForUser({ target, userId, ownershipKey, prefix = 'cnamio-verify', ttl = 300 }) {
  if (!target || userId === undefined || userId === null || !ownershipKey) throw new Error('recordsForUser: target, userId and ownershipKey are required.');
  if (!/^[a-z0-9-]{1,40}$/.test(prefix)) throw new Error('recordsForUser: prefix must be lowercase letters, digits or dashes.');
  return [
    { type: 'CNAME', host: '{SUBDOMAIN}', value: target, ttl },
    { type: 'TXT', host: `_${prefix}.{SUBDOMAIN}`, value: `${prefix}=${ownershipValue(userId, ownershipKey)}`, ttl },
  ];
}

/** Stable per-user value: HMAC-SHA256(ownershipKey, userId), first 32 hex characters. */
export function ownershipValue(userId, ownershipKey) {
  return createHmac('sha256', String(ownershipKey)).update(String(userId)).digest('hex').slice(0, 32);
}

/**
 * Checks a webhook: `Cnamio-Signature: sha256=<hex>` over `"{Cnamio-Timestamp}.{raw body}"`, timestamp within 5 minutes.
 * Pass the raw body exactly as received (string or Buffer) and the request headers (any casing, Headers or plain object).
 */
export function verifyWebhook(rawBody, headers, secret, { toleranceSeconds = 300, now = Date.now() } = {}) {
  const get = name => {
    if (!headers) return '';
    if (typeof headers.get === 'function') return String(headers.get(name) ?? '');
    const key = Object.keys(headers).find(k => k.toLowerCase() === name);
    const value = key === undefined ? '' : headers[key];
    return String(Array.isArray(value) ? value[0] : value ?? '');
  };
  if (typeof rawBody !== 'string' && !(rawBody instanceof Uint8Array)) {
    // A parsed object cannot be checked: its bytes are gone. In Express, use express.raw() on this route.
    throw new TypeError('verifyWebhook: pass the raw request body (string or Buffer), not parsed JSON.');
  }
  const tsHeader = get('cnamio-timestamp');
  if (!secret || !/^\d{1,12}$/.test(tsHeader) || Math.abs(now / 1000 - Number(tsHeader)) > toleranceSeconds) return false;
  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : Buffer.from(rawBody);
  const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${tsHeader}.`), body])).digest('hex'));
  const given = Buffer.from(get('cnamio-signature'));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export default Cnamio;
