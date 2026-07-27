# Security operations

Production requires explicit CORS origins, secure cookies, `CSRF_ENFORCED=true`, a
strong JWT secret, and `TRUSTED_PROXY_IPS` containing only platform proxy addresses.
Forwarded IP/host/proto headers from other addresses are ignored.

Investigate spikes in failed logins, 429 responses, access denials, XLSX validation
failures, and session revocations. Search logs by `X-Request-ID`; never log passwords,
tokens, uploaded workbook contents, or personal fields. Rotate a compromised JWT
secret and revoke all sessions. For a suspicious import, retain only its checksum and
audit metadata, not workbook data in logs.
