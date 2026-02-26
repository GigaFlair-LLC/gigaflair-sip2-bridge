# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅ Yes     |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

If you discover a security vulnerability in the GigaFlair SIP2 Bridge, please disclose it responsibly:

1. **Email**: Send a detailed report to the maintainer via GitHub's [private vulnerability reporting](https://github.com/GigaFlair-LLC/gigaflair-sip2-bridge/security/advisories/new).
2. **Include**: A description of the vulnerability, steps to reproduce, potential impact, and (if available) a suggested fix.
3. **Response time**: You will receive an acknowledgement within **48 hours** and a resolution timeline within **7 days**.
4. **Coordination**: Please allow time to patch and release a fix before public disclosure.

We take all security reports seriously and will credit reporters (unless they prefer to remain anonymous) in the security advisory.

---

## Security Design Principles

The SIP2 Bridge is designed with library patron privacy as a first-class concern:

- **Zero-Data Liability**: Patron PII (barcodes, names, passwords) is processed in-memory only and never persisted to logs or disk.
- **PII Masking**: All log output and SSE streams automatically redact sensitive SIP2 fields (`AA`, `AE`, `AB`, `CN`, `CO`).
- **Encryption at Rest**: SIP2 credentials are encrypted with AES-256-GCM using a locally-generated master key.
- **Argon2 Password Hashing**: Admin passwords use Argon2id with tuned parameters.
- **API Key Auth**: All translation endpoints require a timing-safe `x-api-key` comparison.
- **SSRF Protection**: The setup connection-tester validates hostnames against private IP ranges.
- **Circuit Breaker**: Automatic fail-fast prevents cascading failures to the ILS.
- **SIP2 Injection Guard**: All input is sanitized to strip SIP2 field delimiters (`|`) before protocol encoding.

---

## Security Checklist for Deployments

Before going to production, ensure:

- [ ] `NODE_ENV=production`
- [ ] `BRIDGE_API_KEY` is a strong, randomly-generated string (20+ characters)
- [ ] `SESSION_SECRET` is set to a strong random value
- [ ] The `data/.master_key` file is backed up securely and not accessible from the web
- [ ] The bridge runs behind a TLS-terminating reverse proxy (nginx/Caddy)
- [ ] Network firewall restricts access to the bridge port from authorized clients only
- [ ] ILS SIP2 configuration whitelists only the bridge server's IP
- [ ] A dedicated, minimal-privilege SIP2 service account is used on the ILS (not a staff account)
- [ ] Log rotation is configured (`logRetentionHours`, default 7 days)

---

## Scope

This policy applies to the GigaFlair SIP2 Bridge codebase itself. Vulnerabilities in upstream dependencies should be reported to their respective projects. For dependency auditing, run:

```bash
npm audit
```
