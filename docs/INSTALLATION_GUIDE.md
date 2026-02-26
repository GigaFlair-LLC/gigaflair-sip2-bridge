# GigaFlair SIP2 Bridge — Installation & Usage Guide

A complete guide for installing, configuring, and operating the GigaFlair SIP2 Bridge.

---

## Table of Contents

1. [System Requirements](#1-system-requirements)
2. [Installation](#2-installation)
3. [Configuration](#3-configuration)
4. [Starting the Bridge](#4-starting-the-bridge)
5. [Setup Wizard](#5-setup-wizard)
6. [API Reference](#6-api-reference)
7. [Docker Deployment](#7-docker-deployment)
8. [ILS-Specific Notes](#8-ils-specific-notes)
9. [Security Hardening](#9-security-hardening)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **Node.js** | 20.x | 22.x LTS |
| **OS** | Linux, macOS, Windows (WSL2) | Debian/Ubuntu or Alpine Linux |
| **RAM** | 256 MB | 512 MB |
| **Disk** | 100 MB | 500 MB (for logs) |
| **Network** | TCP access to ILS SIP2 port | Static IP recommended |

The bridge requires network connectivity to your ILS server's SIP2 port (typically 6001). Your ILS administrator may need to whitelist the bridge server's IP address.

---

## 2. Installation

### From Source

```bash
# Clone the repository
git clone https://github.com/GigaFlair-LLC/gigaflair-sip2-bridge.git
cd gigaflair-sip2-bridge

# Install dependencies
npm install

# Build the TypeScript project
npm run build
```

### Verify Installation

```bash
# Run the test suite
npm test

# Type-check without emitting
npm run typecheck
```

---

## 3. Configuration

The bridge can be configured via **environment variables**, a **`.env` file**, or through the **web-based Setup Wizard**.

### Environment Variables

Copy the example file and fill in your ILS details:

```bash
cp .env.example .env
```

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `LMS_HOST` | IP address or hostname of your ILS SIP2 server | `127.0.0.1` | Yes |
| `LMS_PORT` | SIP2 TCP port on the ILS server | `6001` | Yes |
| `SIP2_USER` | SIP2 login username (Command 93) | _(empty)_ | Recommended |
| `SIP2_PASS` | SIP2 login password | _(empty)_ | Recommended |
| `SIP2_LOCATION` | Location/branch code for the SIP2 session | _(empty)_ | Optional |
| `BRIDGE_API_KEY` | Static API key for authenticating REST clients | _(none)_ | Yes |
| `PORT` | HTTP port for the bridge REST API | `3100` | No |
| `HOST` | Bind address for the HTTP server | `0.0.0.0` | No |
| `NODE_ENV` | Runtime environment (`development` or `production`) | `development` | No |
| `CONFIG_PATH` | Path to a custom `config.json` file | `./data/config.json` | No |
| `SESSION_SECRET` | Secret used to sign HTTP session cookies | _(derived from master key)_ | No |

### Configuration Priority

The bridge resolves configuration in this order (highest priority first):

1. **Environment variables** (`.env` file or system env)
2. **`data/config.json`** (persisted by the Setup Wizard)

Environment variables always override values in `config.json`.

### Master Key

On first startup, the bridge generates a **master encryption key** at `data/.master_key`. This key encrypts sensitive fields (SIP2 password, API key) at rest in `config.json` using AES-256-GCM.

> **Important:** Back up the `data/.master_key` file. Without it, encrypted configuration values cannot be recovered. The Setup Wizard provides a "Download Recovery Key" option during initial setup.

---

## 4. Starting the Bridge

### Development Mode (with hot-reload)

```bash
npm run dev
```

### Production Mode

```bash
# Build first
npm run build

# Start the compiled server
npm start
```

### Direct Execution (without build)

```bash
npx tsx bin/start.ts
```

### Running Multiple Instances

To run multiple bridge instances (e.g., one per ILS), use separate config files and ports:

```bash
# Instance 1: Koha on port 3100
PORT=3100 npx tsx bin/start.ts

# Instance 2: Evergreen on port 3200
CONFIG_PATH=./data-evergreen/config.json PORT=3200 npx tsx bin/start.ts
```

Create a separate `data-<name>/config.json` for each instance.

---

## 5. Setup Wizard

On first launch (when no admin account exists), the bridge serves a **web-based Setup Wizard** at `http://localhost:3100/setup.html`.

The wizard walks you through:

1. **LMS Connection Setup** — Select your ILS software (Koha, Evergreen, Alma, Sierra, etc.), enter the SIP2 host/port, and configure credentials.
2. **Summary & Verification** — Review your configuration, download the recovery key, and test the SIP2 connection.

After completing the wizard, the bridge generates an API key and redirects you to the **admin dashboard**.

### Admin Dashboard

Once configured, the dashboard is available at `http://localhost:3100/` and provides:

- Real-time health status (LMS connectivity, memory, uptime)
- Live SIP2 transaction log (SSE stream)
- Configuration management (reconnect, update settings)
- Version update notifications

### Admin Login

```
POST /api/admin/login
Content-Type: application/json

{
    "username": "admin",
    "password": "your-admin-password"
}
```

The admin account is created during the Setup Wizard's onboarding flow.

---

## 6. API Reference

All translation endpoints require the `x-api-key` header.

### Authentication

Every request to `/api/v1/*` endpoints must include:

```
x-api-key: your-bridge-api-key
```

### Health Check

```
GET /health
```

Returns `{"status": "ok"}`. No authentication required.

---

### Patron Operations

#### Patron Status (23/24)

```bash
curl -X POST http://localhost:3100/api/v1/patron/status \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"patronBarcode": "12345678"}'
```

#### Patron Information (63/64)

```bash
curl -X POST http://localhost:3100/api/v1/patron/info \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "patronBarcode": "12345678",
    "summary": {"holdItems": true},
    "startItem": 1,
    "endItem": 10
  }'
```

#### Fee Paid (37/38)

```bash
curl -X POST http://localhost:3100/api/v1/patron/fee-paid \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "patronBarcode": "12345678",
    "feeId": "FEE001",
    "amount": "5.00"
  }'
```

#### End Patron Session (35/36)

```bash
curl -X POST http://localhost:3100/api/v1/patron/end-session \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"patronBarcode": "12345678"}'
```

#### Block Patron (01/24)

```bash
curl -X POST http://localhost:3100/api/v1/patron/block \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "patronBarcode": "12345678",
    "blockedCardMessage": "Lost card"
  }'
```

#### Patron Enable (25/26)

```bash
curl -X POST http://localhost:3100/api/v1/patron/enable \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"patronBarcode": "12345678"}'
```

---

### Circulation Operations

#### Checkout (11/12)

```bash
curl -X POST http://localhost:3100/api/v1/checkout \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "patronBarcode": "12345678",
    "itemBarcode": "ITEM001"
  }'
```

#### Checkin (09/10)

```bash
curl -X POST http://localhost:3100/api/v1/checkin \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"itemBarcode": "ITEM001"}'
```

#### Renew (29/30)

```bash
curl -X POST http://localhost:3100/api/v1/renew \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "patronBarcode": "12345678",
    "itemBarcode": "ITEM001"
  }'
```

#### Renew All (65/66)

```bash
curl -X POST http://localhost:3100/api/v1/renew-all \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"patronBarcode": "12345678"}'
```

#### Hold (15/16)

```bash
curl -X POST http://localhost:3100/api/v1/hold \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "patronBarcode": "12345678",
    "itemBarcode": "ITEM001",
    "holdMode": "+"
  }'
```

Hold modes: `+` (add), `-` (remove), `*` (change).

---

### Item Operations

#### Item Information (17/18)

```bash
curl -X POST http://localhost:3100/api/v1/item/info \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"itemBarcode": "ITEM001"}'
```

#### Item Status Update (19/20)

```bash
curl -X POST http://localhost:3100/api/v1/item/status-update \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"itemBarcode": "ITEM001"}'
```

> **Note:** Not all ILS systems support Item Status Update (Command 19). Koha, for example, drops the SIP2 connection when it receives this command.

---

### System Operations

#### ACS Status (99/98)

```bash
curl -X POST http://localhost:3100/api/v1/acs-status \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Returns the ILS server's capabilities (checkout OK, checkin OK, renewal policy, supported messages, etc.).

---

### Common Request Fields

| Field | Type | Description |
|-------|------|-------------|
| `branchId` | string | Branch identifier for multi-branch setups (default: `"main"`) |
| `patronBarcode` | string | Patron's library card barcode |
| `itemBarcode` | string | Item's barcode |
| `patronPin` | string | Optional patron PIN (for ILS systems that require it) |

### Error Responses

| HTTP Status | Meaning |
|-------------|---------|
| `400` | Invalid request body (Zod validation failure) |
| `401` | Missing or invalid `x-api-key` |
| `502` | SIP2 communication failure (LMS unreachable or protocol error) |
| `503` | Circuit breaker is open (LMS temporarily unavailable) |

---

## 7. Docker Deployment

### Build the Image

```bash
docker build -t gigaflair/sip2-bridge .
```

### Run the Container

```bash
docker run -d \
  --name sip2-bridge \
  -p 3100:3100 \
  -e LMS_HOST=10.0.0.5 \
  -e LMS_PORT=6001 \
  -e SIP2_USER=bridge_user \
  -e SIP2_PASS=bridge_password \
  -e BRIDGE_API_KEY=your-secure-api-key \
  -e NODE_ENV=production \
  -v sip2-data:/app/data \
  gigaflair/sip2-bridge
```

The `-v sip2-data:/app/data` volume preserves configuration and logs between container restarts.

### Docker Compose

```yaml
services:
  sip2-bridge:
    build: .
    ports:
      - "3100:3100"
    environment:
      - LMS_HOST=10.0.0.5
      - LMS_PORT=6001
      - SIP2_USER=bridge_user
      - SIP2_PASS=bridge_password
      - BRIDGE_API_KEY=your-secure-api-key
      - NODE_ENV=production
    volumes:
      - sip2-data:/app/data
    restart: unless-stopped

volumes:
  sip2-data:
```

---

## 8. ILS-Specific Notes

The bridge includes **Vendor Profiles** that automatically apply compatibility settings for known ILS platforms.

| ILS | Profile Name | Notes |
|-----|-------------|-------|
| **Koha** | `Koha` | Standard SIP2. Does not support Command 19 (Item Status Update). |
| **Evergreen** | `Evergreen` | Standard SIP2. Requires dedicated SIP2 account created in Evergreen. |
| **Ex Libris Alma** | `Ex Libris Alma` | Requires SC Status (Command 99) immediately after login (`postLoginSCStatus: true`). |
| **SirsiDynix Symphony** | `SirsiDynix Symphony` | Standard SIP2. |
| **SirsiDynix Horizon** | `SirsiDynix Horizon` | Some legacy installs omit checksums (`checksumRequired: false`). |
| **Innovative Sierra** | `Innovative Sierra` | Standard SIP2. |
| **Innovative Polaris** | `Innovative Polaris` | Standard SIP2. |
| **Follett Destiny** | `Follett Destiny` | Standard SIP2. |
| **OCLC WorldShare** | `OCLC WorldShare` | Standard SIP2. |

### Setting a Vendor Profile via Environment

Vendor profiles are configured through the Setup Wizard or `config.json`:

```json
{
  "vendorProfile": {
    "name": "Koha",
    "postLoginSCStatus": false,
    "checksumRequired": true
  }
}
```

---

## 9. Security Hardening

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use a strong, unique `BRIDGE_API_KEY` (minimum 20 characters)
- [ ] Run the bridge behind a reverse proxy (nginx/Caddy) with TLS termination
- [ ] Restrict network access to the bridge port (firewall rules)
- [ ] Back up the `.master_key` file securely
- [ ] Enable log rotation (configured via `logRetentionHours`, default: 168 hours / 7 days)
- [ ] Use a dedicated SIP2 service account on the ILS (not a personal staff account)
- [ ] Ensure the ILS whitelists only the bridge server's IP for SIP2 connections

### Security Features

| Feature | Description |
|---------|-------------|
| **API Key Authentication** | All `/api/v1/*` endpoints require a valid `x-api-key` header |
| **Argon2 Password Hashing** | Admin passwords are hashed with Argon2id |
| **AES-256-GCM Encryption** | SIP2 passwords and API keys are encrypted at rest |
| **CSRF Protection** | Admin endpoints are protected against cross-site request forgery |
| **Helmet Headers** | Security headers (CSP, X-Frame-Options, etc.) are applied automatically |
| **Rate Limiting** | Built-in rate limiting prevents brute-force attacks |
| **SSRF Protection** | Setup endpoints validate hostnames to prevent server-side request forgery |
| **PII Masking** | Patron data is masked in all log output and SSE streams |
| **SIP2 Injection Guard** | All input is sanitized to prevent SIP2 delimiter injection |
| **Circuit Breaker** | Automatic connection management with exponential backoff |

### Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name sip2-bridge.example.com;

    ssl_certificate     /etc/ssl/certs/bridge.crt;
    ssl_certificate_key /etc/ssl/private/bridge.key;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support for live logs
        proxy_buffering off;
        proxy_cache off;
    }
}
```

---

## 10. Troubleshooting

### Bridge Won't Start

| Symptom | Cause | Solution |
|---------|-------|----------|
| `EADDRINUSE` | Port already in use | Change `PORT` or stop the conflicting process |
| `ECONNREFUSED` on startup | ILS SIP2 port unreachable | Verify `LMS_HOST` and `LMS_PORT`; check firewalls |
| `Master key not found` | Missing `.master_key` file | The bridge generates one on first run. If restoring from backup, copy your saved `.master_key` file to the project root. |

### SIP2 Connection Issues

| Symptom | Cause | Solution |
|---------|-------|----------|
| `502 Bad Gateway` | SIP2 connection dropped | Check ILS SIP2 logs; some ILS systems drop connections on unsupported commands |
| `503 Service Unavailable` | Circuit breaker is open | Wait for automatic recovery, or use the dashboard "Manual Reconnect" button |
| Login failures | Wrong SIP2 credentials | Verify `SIP2_USER` and `SIP2_PASS` match the ILS SIP2 configuration |
| Checksum errors | ILS expects/omits checksums | Toggle `checksumRequired` in the vendor profile |

### Testing Connectivity

```bash
# Test TCP connectivity to the ILS SIP2 port
nc -zv YOUR_ILS_HOST 6001

# Test the bridge health endpoint
curl http://localhost:3100/health

# Test a patron lookup
curl -X POST http://localhost:3100/api/v1/patron/status \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"patronBarcode": "TESTBARCODE"}'
```

### Log Files

Logs are written to `data/logs/bridge.log` with automatic rotation based on `logRetentionHours` (default: 7 days). PII is automatically masked in all log output.
