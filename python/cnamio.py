"""Cnamio server SDK for Python 3.9+: one file, standard library only.

Latest: https://cnamio.com/sdk/cnamio.py  ·  Docs: https://cnamio.com/docs
Use it on your server only: it holds the application secret.

    from cnamio import Cnamio, records_for_user, verify_webhook
    client = Cnamio()  # reads CNAMIO_APPLICATION_ID and CNAMIO_SECRET
    records = records_for_user(target="customers.yourapp.com", user_id=user.id, ownership_key=os.environ["CNAMIO_OWNERSHIP_KEY"])
    session = client.create_session(user_id=user.id, dns_records=records)  # send to the browser as is
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Mapping, Optional, Sequence

__all__ = ["Cnamio", "CnamioError", "records_for_user", "ownership_value", "verify_webhook", "VERSION"]
VERSION = "1.1.0"
DEFAULT_BASE_URL = "https://api.cnamio.com"
_SESSION_REUSE_SECONDS = 50 * 60  # session tokens live 60 minutes


class CnamioError(Exception):
    """A non-2xx answer from Cnamio. ``status`` is the HTTP status; ``conflicts`` is set on the 409 of
    connect_automatic (reason codes as strings, e.g. ``name_occupied``). 503 means "not now": repeat the same call
    after a few seconds."""

    def __init__(self, status: int, message: str = "", body: Any = None):
        super().__init__(message or f"Cnamio answered {status}")
        self.status = status
        self.body = body
        self.conflicts = body.get("conflicts") if isinstance(body, dict) and isinstance(body.get("conflicts"), list) else None


class Cnamio:
    def __init__(self, application_id: Optional[str] = None, secret: Optional[str] = None,
                 base_url: str = DEFAULT_BASE_URL, timeout: float = 30.0):
        self.application_id = application_id or os.environ.get("CNAMIO_APPLICATION_ID", "")
        self.secret = secret or os.environ.get("CNAMIO_SECRET", "")
        if not self.application_id or not self.secret:
            raise ValueError("Cnamio: application_id and secret are required (or set CNAMIO_APPLICATION_ID and CNAMIO_SECRET).")
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._session: Optional[tuple[str, float]] = None
        self.manage = _Manage(self)

    def _request(self, method: str, path: str, body: Any = None, headers: Optional[Mapping[str, str]] = None) -> Any:
        data = None if body is None else json.dumps(body).encode("utf-8")
        all_headers = {"User-Agent": f"cnamio-python/{VERSION}", "Accept": "application/json"}
        if data is not None:
            all_headers["Content-Type"] = "application/json"
        all_headers.update(headers or {})
        request = urllib.request.Request(self.base_url + path, data=data, headers=all_headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                payload = json.loads(raw) if raw else None
            except ValueError:
                payload = None
            message = payload.get("message", "") if isinstance(payload, dict) else ""
            raise CnamioError(error.code, message, payload) from None
        return json.loads(raw) if raw else None

    def create_session(self, user_id: Any = None, dns_records: Optional[Sequence[Mapping[str, Any]]] = None,
                       domain: Optional[str] = None) -> dict:
        """A session token for the connect window. Bind ``dns_records`` (and optionally ``domain``) and send the result
        to your page as is: ``cnamio.connectDomain({...session, applicationName, locale})``."""
        body: dict = {"applicationId": self.application_id, "secret": self.secret}
        if user_id is not None:
            body["userId"] = str(user_id)
        if dns_records is not None:
            body["dnsRecords"] = list(dns_records)
        if domain is not None:
            body["domain"] = domain
        data = self._request("POST", "/token", body)
        session = {"token": data["auth_token"], "applicationId": self.application_id, "expiresAt": int((time.time() + 3600) * 1000)}
        if dns_records is not None:
            session["dnsRecords"] = list(dns_records)
        return session

    def _token(self, force: bool = False) -> str:
        if not force and self._session and self._session[1] > time.time():
            return self._session[0]
        token = self.create_session()["token"]
        self._session = (token, time.time() + _SESSION_REUSE_SECONDS)
        return token

    def _session_call(self, method: str, path: str, body: Any = None) -> Any:
        for attempt in (0, 1):
            token = self._token(force=attempt > 0)
            try:
                return self._request(method, path, body, {"Authorization": f"Bearer {token}", "applicationId": self.application_id})
            except CnamioError as error:
                # An expired or rotated session is renewed once.
                if attempt == 0 and error.status == 401:
                    self._session = None
                    continue
                raise
        raise AssertionError("unreachable")

    def check_domain(self, domain: str, dns_records: Sequence[Mapping[str, Any]], check_conflicts: bool = True,
                     locale: Optional[str] = None, accept_merges: bool = False) -> dict:
        """Where the domain's DNS is, whether it can be automatic, conflicts and the current record state.

        With accept_merges, an SPF policy to merge into the existing one comes only in recordMerges; without it, it is
        also listed in recordConflicts as spf_merge_required (with the merged value in its "merge" field).
        """
        body = {"domain": domain, "dnsRecords": list(dns_records), "checkConflicts": check_conflicts}
        if accept_merges:
            body["acceptMerges"] = True
        if locale:
            body["locale"] = locale
        return self._session_call("POST", "/checkdomain", body)

    def connect(self, domain: str, dns_records: Sequence[Mapping[str, Any]], user_id: Any = None, locale: Optional[str] = None) -> dict:
        """Manual setup: returns the exact records to show the user and starts watching propagation."""
        body: dict = {"domain": domain, "dnsRecords": list(dns_records)}
        if user_id is not None:
            body["userId"] = str(user_id)
        if locale:
            body["locale"] = locale
        return self._session_call("POST", "/connect", body)

    def connect_automatic(self, domain: str, dns_records: Sequence[Mapping[str, Any]], provider_token: str, user_id: Any = None) -> dict:
        """Creates the records with the user's provider API token (used once, never stored). Raises CnamioError 409 or 422."""
        body: dict = {"domain": domain, "dnsRecords": list(dns_records), "providerToken": provider_token}
        if user_id is not None:
            body["userId"] = str(user_id)
        return self._session_call("POST", "/connect/automatic", body)

    def status(self, job_id: str) -> dict:
        return self._session_call("GET", f"/connect/{urllib.parse.quote(job_id, safe='')}/status")

    def recheck(self, job_id: str) -> dict:
        """Checks propagation again now (at most once every 5 minutes per connection). A finished connection raises CnamioError 409."""
        return self._session_call("POST", f"/connect/propagation/recheck/{urllib.parse.quote(job_id, safe='')}", {})

    def last_webhook(self, job_id: str) -> dict:
        return self._session_call("GET", f"/connect/webhooks/last/{urllib.parse.quote(job_id, safe='')}")


class _Manage:
    """Management API (HTTP Basic with the application credentials). Reach it as ``client.manage``."""

    def __init__(self, client: Cnamio):
        self._client = client

    def _call(self, method: str, path: str, body: Any = None) -> Any:
        basic = base64.b64encode(f"{self._client.application_id}:{self._client.secret}".encode()).decode()
        return self._client._request(method, path, body, {"Authorization": f"Basic {basic}"})

    def application(self) -> dict:
        return self._call("GET", "/v1/manage/application")

    def set_webhook_url(self, url: Optional[str]) -> dict:
        """HTTPS URL, or None to stop deliveries. Does not change the webhook secret."""
        return self._call("PUT", "/v1/manage/webhook", {"url": url})

    def set_record_names(self, strict: Optional[bool] = None, allowed_names: Optional[list] = None) -> dict:
        """Strict record names; allowed_names are relative to the zone ("@", "_dmarc"). None keeps the current value."""
        body: dict = {}
        if strict is not None:
            body["strict"] = strict
        if allowed_names is not None:
            body["allowedNames"] = allowed_names
        return self._call("PUT", "/v1/manage/record-names", body)

    def set_monitoring(self, enabled: bool) -> dict:
        """Continuous monitoring of connected domains (read-only DNS checks): on or off."""
        return self._call("PUT", "/v1/manage/monitoring", {"enabled": enabled})

    def webhook_secret(self) -> dict:
        return self._call("GET", "/v1/manage/webhook-secret")

    def test_webhook(self) -> dict:
        return self._call("POST", "/v1/manage/webhook-test", {})

    def jobs(self, limit: Optional[int] = None, before: Optional[str] = None, status: Optional[str] = None,
             domain: Optional[str] = None, health: Optional[str] = None, share_link_id: Optional[str] = None) -> dict:
        query = {k: v for k, v in {"limit": limit, "before": before, "status": status, "domain": domain, "health": health,
                                   "share_link_id": share_link_id}.items() if v is not None}
        return self._call("GET", "/v1/manage/jobs" + (f"?{urllib.parse.urlencode(query)}" if query else ""))

    def create_share_link(self, domains: list, dns_records: list, max_uses: Optional[int] = None, expires_in_days: Optional[float] = None,
                          user_id: Any = None, label: Optional[str] = None) -> dict:
        """A link for whoever manages the DNS (an agency, the IT team): they open `url` and connect these domains with these
        records, without your secret. max_uses per domain (default 1), expires_in_days (default 7, at most 30).
        `url` and `token` are returned only here: send the url to that person, do not log it."""
        body: dict = {"domains": domains, "dnsRecords": dns_records}
        if max_uses is not None:
            body["maxUses"] = max_uses
        if expires_in_days is not None:
            body["expiresInDays"] = expires_in_days
        if user_id is not None:
            body["userId"] = str(user_id)
        if label:
            body["label"] = label
        return self._call("POST", "/v1/manage/share-links", body)

    def share_links(self, limit: Optional[int] = None, before: Optional[str] = None) -> dict:
        """Links of the application, newest first (never their tokens)."""
        query = {k: v for k, v in {"limit": limit, "before": before}.items() if v is not None}
        return self._call("GET", "/v1/manage/share-links" + (f"?{urllib.parse.urlencode(query)}" if query else ""))

    def share_link(self, share_link_id: str) -> dict:
        return self._call("GET", f"/v1/manage/share-links/{urllib.parse.quote(share_link_id, safe='')}")

    def revoke_share_link(self, share_link_id: str) -> dict:
        """Ends the link now; connections already started go on."""
        return self._call("POST", f"/v1/manage/share-links/{urllib.parse.quote(share_link_id, safe='')}/revoke", {})

    def usage(self, month: Optional[str] = None) -> dict:
        return self._call("GET", "/v1/manage/usage" + (f"?month={urllib.parse.quote(month)}" if month else ""))

    def rotate_secret(self, grace_hours: Optional[float] = None) -> dict:
        return self._call("POST", "/v1/manage/rotate-secret", {} if grace_hours is None else {"graceHours": grace_hours})


def ownership_value(user_id: Any, ownership_key: str) -> str:
    """Stable per-user value: HMAC-SHA256(ownership_key, user_id), first 32 hex characters."""
    return hmac.new(str(ownership_key).encode(), str(user_id).encode(), hashlib.sha256).hexdigest()[:32]


def records_for_user(target: str, user_id: Any, ownership_key: str, prefix: str = "cnamio-verify", ttl: int = 300) -> list:
    """A CNAME to your target plus a TXT unique to the user, so a user cannot claim a domain another user already pointed at you."""
    if not target or user_id is None or not ownership_key:
        raise ValueError("records_for_user: target, user_id and ownership_key are required.")
    if not re.fullmatch(r"[a-z0-9-]{1,40}", prefix):
        raise ValueError("records_for_user: prefix must be lowercase letters, digits or dashes.")
    return [
        {"type": "CNAME", "host": "{SUBDOMAIN}", "value": target, "ttl": ttl},
        {"type": "TXT", "host": f"_{prefix}.{{SUBDOMAIN}}", "value": f"{prefix}={ownership_value(user_id, ownership_key)}", "ttl": ttl},
    ]


def verify_webhook(raw_body: bytes | str, headers: Mapping[str, Any], secret: Optional[str], tolerance_seconds: int = 300,
                   now: Optional[float] = None) -> bool:
    """True when ``Cnamio-Signature`` (``sha256=<hex>`` over ``"{Cnamio-Timestamp}.{raw body}"``) and the timestamp are valid.
    Pass the raw body exactly as received (FastAPI: ``await request.body()``; Flask: ``request.get_data()``)."""
    def get(name: str) -> str:
        for key in headers.keys():
            if str(key).lower() == name:
                value = headers[key]
                return str(value[0] if isinstance(value, (list, tuple)) else value)
        return ""

    ts = get("cnamio-timestamp")
    current = time.time() if now is None else now
    if not secret or not re.fullmatch(r"\d{1,12}", ts) or abs(current - int(ts)) > tolerance_seconds:
        return False
    if not isinstance(raw_body, (bytes, bytearray, memoryview, str)):
        # A parsed dict cannot be checked: its bytes are gone. Read the raw body instead.
        raise TypeError("verify_webhook: pass the raw request body (bytes or str), not parsed JSON.")
    body = raw_body.encode("utf-8") if isinstance(raw_body, str) else bytes(raw_body)
    expected = "sha256=" + hmac.new(secret.encode(), ts.encode() + b"." + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected.encode(), get("cnamio-signature").encode())
