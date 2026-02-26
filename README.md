# GigaFlair SIP2 Bridge

[![CI](https://github.com/GigaFlair-LLC/gigaflair-sip2-json/actions/workflows/ci.yml/badge.svg)](https://github.com/GigaFlair-LLC/gigaflair-sip2-json/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.x-brightgreen)](https://nodejs.org)

Standalone enterprise bridge that translates modern JSON/REST requests into legacy SIP2 (Standard Interchange Protocol v2) commands for library automation systems.

## Key Features
- **High Performance**: Built on Fastify for low-latency request handling.
- **Enterprise Security**: Secured via API Key (`x-api-key`) validation.
- **Circuit Breaker**: Robust connection management with automatic backoff and zombie socket prevention.
- **Legacy Compatibility**: Enforces ASCII encoding and unidecode normalization for legacy LMS hardware.
- **Zero-Data Liability**: Redacts PII from logs and processes data only in memory.

## Quick Start

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   Copy `.env.example` to `.env` and fill in your LMS details.
   ```bash
   cp .env.example .env
   ```

3. **Run in Development**:
   ```bash
   npm run dev
   ```

4. **Build and Start**:
   ```bash
   npm run build
   npm start
   ```

## Documentation
For a deep dive into the architecture, concepts, and deployment of the GigaFlair SIP2 Bridge, please consult the following guides:
- [Installation & Usage Guide](docs/INSTALLATION_GUIDE.md): Complete guide for installing, configuring, and operating the bridge.
- [Concept Guide](docs/CONCEPT_GUIDE.md): A plain-English explanation of how the bridge works.
- [Project Overview](PROJECT_OVERVIEW.md): High-level architectural overview and feature summary.
- [SIP2 Bridge Specification](SIP2_BRIDGE_SPEC.md): The architectural source of truth, detailing security, protocol, and resiliency standards.

## API Documentation

### Patron Status
**POST** `/api/v1/patron/status`

**Headers**:
- `x-api-key`: Your configured `BRIDGE_API_KEY`

**Body**:
```json
{
  "branchId": "main",
  "patronBarcode": "12345678"
}
```

## Environment Variables
- `LMS_HOST`: IP/Hostname of the SIP2 Server.
- `LMS_PORT`: Port of the SIP2 Server.
- `SIP2_USER`: Login credentials for the LMS.
- `SIP2_PASS`: Password for the LMS.
- `SIP2_LOCATION`: Location code for the login handshake.
- `BRIDGE_API_KEY`: Static key for securing the REST API.
- `PORT`: REST API listening port (default: 3100).

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to get started, coding standards, and the pull request process.

To report a security vulnerability, follow the [Security Policy](SECURITY.md) — do not open a public issue.

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPLv3) — see the [LICENSE](LICENSE) file for details.
