// Types for https://cnamio.com/sdk/cnamio.mjs (save next to it as cnamio.d.mts) (Cnamio server SDK 1.1.1).

export declare const VERSION: string;

export type RecordType = 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'CAA';

/** host is relative to the domain's zone; placeholders {DOMAIN}, {SUBDOMAIN}, {SLD}, {TLD}; @ is the zone apex. */
export interface DnsRecord {
  type: RecordType;
  host: string;
  value: string;
  ttl?: number;
  priority?: number;
  optional?: boolean;
}

export interface CnamioOptions {
  /** Defaults to process.env.CNAMIO_APPLICATION_ID. */
  applicationId?: string;
  /** Defaults to process.env.CNAMIO_SECRET. Server only. */
  secret?: string;
  /** Defaults to https://api.cnamio.com */
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface BrowserSession {
  token: string;
  applicationId: string;
  dnsRecords?: DnsRecord[];
  /** Milliseconds since epoch. */
  expiresAt: number;
}

/** One entry of `recordConflicts` from checkDomain: the requested record, why it is blocked and what is already published at that name. */
export interface RecordConflict { type: string; host: string; value: string; reason: string; existing: Array<{ type: string; value: string }>;
  /** Only on `spf_merge_required` (callers that did not send acceptMerges): the policy to publish instead, and the one it replaces. */
  merge?: { value: string; replaces: string } }
/**
 * One SPF merge from checkDomain: `value` is the full policy the domain will publish (every existing term kept, the
 * requested mechanisms added before `all`), `replaces` the policy published now, `requested` the record asked for.
 */
export interface RecordMerge { type: 'TXT'; host: string; value: string; replaces: string; requested: string }
/** @deprecated Use RecordConflict. `CnamioError.conflicts` is a list of reason codes (strings), not of these. */
export type Conflict = RecordConflict;

/** Step-by-step for the user's DNS provider panel (Portuguese guides today; sent with locale pt or pt-BR). */
export interface Instructions {
  language: string;
  provider: string;
  providerName: string;
  title: string;
  steps: string[];
  verification: string;
  record: { type: string; host: string; value: string };
}

export interface CheckDomainResult {
  domain: string;
  zone: string;
  provider: string;
  setupType: 'Automatic' | 'Manual';
  authoritativeDnsProvider: string;
  nameservers: string[];
  connectMethods: Array<'domain_connect' | 'api_token'>;
  domainConnect?: { provider: string; providerName: string };
  recordConflicts?: RecordConflict[] | null;
  /**
   * With checkConflicts: SPF policies that will be merged into the one already published (never a second policy).
   * Without acceptMerges each one is also a `spf_merge_required` entry of recordConflicts.
   */
  recordMerges?: RecordMerge[];
  /** Every record that would be created, with its full name. */
  records: PlannedRecord[];
  recordState?: 'missing' | 'configured' | 'different_cname' | 'name_occupied' | 'inconclusive';
  instructions?: Instructions;
}

export interface PlannedRecord { type: RecordType; host: string; value: string; ttl: number; optional: boolean;
  /** Manual `connect` only, on an SPF asked for where a policy already is: edit that policy to `value` (it replaces `replaces`); never add a second one. */
  merge?: { value: string; replaces: string } }

export type JobStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ConnectResult {
  job_id: string;
  status: JobStatus;
  domain: string;
  zone: string;
  provider: string;
  setup_type: 'manual';
  records: PlannedRecord[];
  /** SPF policies to edit (never add a second one): the merged value and the policy it replaces. */
  recordMerges?: RecordMerge[];
  instructions?: Instructions;
}

export interface ConnectAutomaticResult {
  job_id: string;
  status: JobStatus;
  domain: string;
  provider: string;
  setup_type: 'automatic';
  written: boolean;
  failed_optional_records: unknown[];
  /** Present when the records were written but the zone changed during the write. */
  warning?: 'zone_changed';
}

export interface ConnectionStatus {
  job_id: string;
  connected: boolean;
  status: JobStatus;
  domain: string;
  propagation_status: string;
  setup_type: 'manual' | 'automatic';
  /** Continuous monitoring: null until the domain is connected and monitored. */
  health: Health | null;
  monitored: boolean;
  health_changed_at: string | null;
  health_checked_at: string | null;
  /** Records published at connection and not found by the last monitoring check (empty while healthy). */
  missing_records: { type: string; host: string; value: string; optional: boolean }[];
  /** The shareable link this connection was started from; null otherwise. */
  share_link_id: string | null;
}
/** healthy: every record is where it was. degraded: an optional record is gone, or the zone could not be read. broken: a required record is gone. */
export type Health = 'healthy' | 'degraded' | 'broken';

export interface LastWebhook {
  event_id: string;
  type: string;
  payload: unknown;
  attempts: number;
  delivered: boolean;
  last_status: number | null;
  created_at: string;
}

export interface Job {
  job_id: string;
  domain: string;
  user_id: string | null;
  provider: string;
  setup_type: 'manual' | 'automatic';
  status: JobStatus;
  propagation_status: string;
  created_at: string;
  completed_at: string | null;
  /** Continuous monitoring: null until the domain is connected and monitored. */
  health: Health | null;
  monitored: boolean;
  health_changed_at: string | null;
  health_checked_at: string | null;
  missing_records: { type: string; host: string; value: string; optional: boolean }[];
  /** The shareable link this connection was started from; null otherwise. */
  share_link_id: string | null;
}

/** active, or why it hands out nothing more: expired, revoked, or used (every domain spent its uses). */
export type ShareLinkStatus = 'active' | 'expired' | 'revoked' | 'used';
export interface ShareLink {
  share_link_id: string;
  status: ShareLinkStatus;
  domains: Array<{ domain: string; uses: number; uses_left: number }>;
  dns_records: DnsRecord[];
  user_id: string | null;
  /** Your own note; never shown on the link page. */
  label: string | null;
  max_uses: number;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
}
/** Only in the answer of createShareLink: the page to send (`url`) and its token. Neither is available again. */
export interface CreatedShareLink extends ShareLink { url: string; token: string }

export declare class CnamioError extends Error {
  readonly status: number;
  readonly body: unknown;
  /**
   * Set on the 409 of connectAutomatic: reason codes such as `name_occupied`, `different_cname` or `zone_changed`
   * (nothing was written). For what is published at each name, call checkDomain and read `recordConflicts`.
   * A 503 means "not now" (DNS too slow or the service busy): repeat the same call after a few seconds.
   */
  readonly conflicts: string[] | null;
}

export declare class Cnamio {
  constructor(options?: CnamioOptions);
  readonly applicationId: string;
  readonly baseUrl: string;
  readonly manage: CnamioManage;
  /** For the connect window: bind dnsRecords (and optionally domain), then send the result to your page as is. */
  createSession(options?: { userId?: string | number; dnsRecords?: DnsRecord[]; domain?: string }): Promise<BrowserSession>;
  checkDomain(domain: string, dnsRecords: DnsRecord[], options?: { checkConflicts?: boolean; acceptMerges?: boolean; locale?: string }): Promise<CheckDomainResult>;
  connect(domain: string, dnsRecords: DnsRecord[], options?: { userId?: string | number; locale?: string }): Promise<ConnectResult>;
  connectAutomatic(domain: string, dnsRecords: DnsRecord[], providerToken: string, options?: { userId?: string | number }): Promise<ConnectAutomaticResult>;
  status(jobId: string): Promise<ConnectionStatus>;
  /** Only while the connection is in progress: a finished one throws CnamioError 409 (without `conflicts`); 429 inside 5 minutes. */
  recheck(jobId: string): Promise<{ queued: true }>;
  lastWebhook(jobId: string): Promise<LastWebhook>;
}

export interface CnamioManage {
  application(): Promise<{ application_id: string; name: string; webhook_url: string | null; compat: string | null; live_providers: string[]; domain_connect_service: string | null; strict_names: boolean; allowed_names: string[]; monitoring: boolean; monitor_limit: number; monitored_domains: number }>;
  /** Continuous monitoring of connected domains (read-only DNS checks). Turning it on also covers domains already connected. */
  setMonitoring(enabled: boolean): Promise<{ monitoring: boolean; monitor_limit: number; monitored_domains: number }>;
  setWebhookUrl(url: string | null): Promise<{ webhook_url: string | null }>;
  /** Strict record names; `allowedNames` are relative to the zone (`@`, `_dmarc`). A field left out keeps its value. */
  setRecordNames(change: { strict?: boolean; allowedNames?: string[] }): Promise<{ strict_names: boolean; allowed_names: string[] }>;
  webhookSecret(): Promise<{ webhook_secret: string }>;
  testWebhook(): Promise<{ delivered: boolean; status: number | null }>;
  jobs(options?: { limit?: number; before?: string | Date; status?: JobStatus; domain?: string; health?: Health; shareLinkId?: string }): Promise<{ jobs: Job[]; next_before: string | null }>;
  /** A link for whoever manages the DNS: they open `url` and connect these domains with these records, without your secret. maxUses per domain (default 1); expiresInDays default 7, at most 30. */
  createShareLink(options: { domains: string[]; dnsRecords: DnsRecord[]; maxUses?: number; expiresInDays?: number; userId?: string | number; label?: string }): Promise<CreatedShareLink>;
  shareLinks(options?: { limit?: number; before?: string | Date }): Promise<{ share_links: ShareLink[]; next_before: string | null }>;
  shareLink(shareLinkId: string): Promise<ShareLink>;
  /** Ends the link now; connections already started go on. */
  revokeShareLink(shareLinkId: string): Promise<ShareLink>;
  usage(month?: string): Promise<{ month: string; started: { automatic: number; manual: number }; connected: number; billable_domains: number; timed_out: number; complete: boolean }>;
  rotateSecret(graceHours?: number): Promise<{ application_id: string; secret: string; previous_valid_until: string }>;
}

/** CNAME to your target plus a per-user ownership TXT (stops one user from claiming another user's domain). */
export declare function recordsForUser(options: { target: string; userId: string | number; ownershipKey: string; prefix?: string; ttl?: number }): DnsRecord[];
export declare function ownershipValue(userId: string | number, ownershipKey: string): string;

/** True when the webhook signature and timestamp are valid. Pass the raw body exactly as received. */
export declare function verifyWebhook(
  rawBody: string | Uint8Array,
  headers: Headers | Record<string, string | string[] | undefined>,
  secret: string | undefined | null,
  options?: { toleranceSeconds?: number; now?: number },
): boolean;

export default Cnamio;
