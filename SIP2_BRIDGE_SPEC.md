# GigaFlair SIP2 Bridge — Architectural Source of Truth

This document governs the architecture, security, and protocol standards for the GigaFlair SIP2 Bridge.

## 1. Networking Reality
Legacy Library Management Systems (LMS) reside in isolated subnets behind strict enterprise firewalls.
- **Push vs. Pull:** The LMS does not support webhooks, DNS service discovery, or autodiscovery.
- **Connection Model:** All communication is strictly Request/Response over persistent TCP sockets using Node.js `net` or `tls` modules.
- **Configuration:** Static IP addresses and ports must be provided via environment variables.

## 2. Three-Layer Security Architecture
The bridge implements defense-in-depth to protect the library's internal network:
1. **Network Layer:** The Bridge is deployed on a static IP address that is explicitly whitelisted by the library's hardware firewall.
2. **Application Layer:** The Bridge's static IP must be authorized within the LMS SIP2 configuration (IP Whitelisting).
3. **Protocol Layer:** Before any patron data is transmitted, the Bridge must perform a successful **SIP2 Command 93 (Login)** handshake using a dedicated service account.

## 3. Protocol Nuances (SIP2 / 3M)
- **Framing:** SIP2 uses fixed-length headers followed by variable-length fields delimited by the pipe character (`|`).
- **Integrity:** Every outgoing message **must** terminate with a mathematically verified 4-character hex checksum.
- **Sequence:** Every request/response pair includes a sequence number to ensure frame alignment.

## 4. Zero-Data Liability
To maintain maximum security and minimize compliance risk:
- **PII Handling:** Personally Identifiable Information (PII) such as patron barcodes, passwords, and names must exist **in-memory only**.
- **Garbage Collection:** Data should be processed and immediately cleared or made eligible for GC.
- **Logging Policy:** Under no circumstances should PII (barcode, user ID, password) be written to application logs, standard out, or persistent databases.
- **Redaction:** Log sinks must be configured to redact sensitive SIP2 field tags (e.g., `AA`, `CN`, `CO`).

## 5. Resilience: The Circuit Breaker
Given the fragile nature of long-lived TCP connections to legacy hardware:
- **Fail Fast:** If an LMS connection drops or returns 3 consecutive checksum errors, the circuit MUST open.
- **HTTP 503:** While the circuit is open, the bridge returns `503 Service Unavailable` immediately to prevent upstream resource exhaustion.
- **Staggered Backoff:** Reconnection attempts follow an exponential backoff schedule (5s, 10s, 20s, 40s, 60s).
