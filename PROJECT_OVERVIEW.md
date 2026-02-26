# GigaFlair SIP2 Bridge: Project Overview

The **GigaFlair SIP2 Bridge** is an enterprise-grade middleware appliance designed to modernize interactions with legacy Library Management Systems (LMS). It provides a high-security, high-reliability translation layer between modern web applications and the Standard Interchange Protocol (SIP2).

## What it Does
The bridge acts as a bidirectional translator:
- **Inbound**: Accepts modern HTTP JSON requests from web services.
- **Outbound**: Translates these requests into the legacy SIP2 (3M Standard Interchange Protocol v2) TCP protocol with precise checksum calculation and sequence management.
- **Relay**: Communicates with the LMS, parses the response, and returns a clean JSON payload to the caller.

## Why it Exists
1.  **Protocol Modernization**: SIP2 is a fixed-format, positionally-encoded legacy TCP protocol that is difficult to implement directly in modern web stacks (React, Vue, Node.js).
2.  **Security Hardening**: Legacy SIP2 often transmits credentials in plain text or using weak hashing. The bridge adds a modern security layer with AES-256-GCM encryption and Argon2 password hashing.
3.  **Stability & Reliability**: Many LMS vendors have unstable SIP2 sockets. The bridge provides a robust connection manager with automated circuit breakers and exponential backoff to handle connection drops gracefully.
4.  **Developer Experience**: Replaces complex SIP2 string parsing with a standard RESTful API.

## How it Works (Architecture)

### 1. Web API Layer (Fastify)
The entry point of the application. It manages HTTP routes, API key verification, and provides the Administrative Dashboard. It is built for performance and uses Zod for strict input validation.

### 2. Configuration Service (`ConfigService`)
The source of truth for the appliance. It handles:
- **Two-Tier Security**: Sensitive data like LMS passwords are encrypted at rest using a Master Key.
- **Multi-Admin Management**: Supports multiple administrative accounts with role-based access.

### 3. SIP Connection Manager (`SipConnectionManager`)
The "brain" of the translation engine. It manages a pool of TCP connections and implements the **Circuit Breaker** pattern:
- **Closed**: Everything is healthy; traffic flows.
- **Open**: LMS is down; the bridge rejects requests locally to prevent timeout flooding.
- **Half-Open**: Probing the LMS to see if it has recovered.

### 4. SIP Client (`SipClient`)
The low-level driver that handles raw TCP sockets, ASCII normalization, and checksum verification for every message.

## Key Features

### 🚀 Setup Wizard
A zero-config bootstrap experience for new deployments. It guides the user through creating the first administrator, generating a Security Master Key, and verifying LMS connectivity.

### 🖥️ Admin Dashboard
A high-end "Virtual Appliance" interface for real-time management:
- **Connection Health**: Visual indicator of the Circuit Breaker state.
- **Live Logs**: Real-time push of translation activity via Server-Sent Events (SSE).
- **User Management**: Add/Remove administrators and view-only accounts.
- **API Key Management**: Generate and rotate keys for web apps.

### 🛡️ Security Policy: Zero-Data Liability
The bridge is designed to avoid storing PII (Personally Identifiable Information). Patron barcodes are redacted from persistent logs and processed only in-memory to ensure compliance with library privacy standards.
