# Internal API Portal

Self-hosted internal API documentation and controlled invocation portal for OpenAPI / Swagger documented services running inside Kubernetes or other private networks.

The browser never talks directly to internal service DNS names or upstream OpenAPI endpoints. All spec retrieval and API invocation flows are mediated by the Go backend.

## What This Product Is

This application is an internal API portal for platform teams, backend teams, and internal consumers who need to:

- browse an internal API catalog
- read OpenAPI / Swagger documentation
- authenticate with local users or LDAP
- authorize access through app-layer RBAC
- invoke internal APIs safely through a backend proxy
- audit who logged in, viewed specs, refreshed specs, and invoked APIs

This is not a Kubernetes resource dashboard. It does not manage pods, deployments, namespaces, or cluster resources for end users.

## Core Capabilities

- Single Docker image containing frontend and backend
- Go backend serving the React frontend
- SQLite persistence with startup migrations
- Local authentication with Argon2id password hashing
- LDAP bind authentication with admin-managed LDAP settings
- App-layer RBAC with users, groups, roles, permissions
- Per-API authorization with global and resource-scoped permissions
- Backend-only OpenAPI fetch and cache
- Backend-only try-it-out proxy with SSRF protections
- Admin UI for users, groups, roles, LDAP, API definitions, audit logs, and branding
- Audit retention with configurable purge window
- `/healthz` for readiness and liveness probes

## Architecture

```text
Browser
  -> same-origin requests
Portal Frontend (React + TypeScript)
  -> same-origin API calls
Portal Backend (Go + chi)
  -> SQLite
  -> LDAP
  -> internal OpenAPI endpoints
  -> internal upstream APIs
```

### Security Boundary

The portal backend is the security boundary.

- The browser does not fetch internal OpenAPI docs directly.
- The browser does not call internal APIs directly.
- The backend validates identity, permissions, API registration, methods, paths, headers, body size, response size, and timeout before proxying.
- The portal is not a generic proxy.

## Project Layout

```text
backend/
  cmd/server
  internal/api
  internal/auth
  internal/audit
  internal/config
  internal/db
  internal/models
  internal/openapi
  internal/proxy
  internal/rbac
  internal/store

frontend/
  src/components
  src/pages
  src/services

deploy/
docker/
```

## Technology Stack

### Backend

- Go
- chi router
- SQLite
- JWT
- go-ldap

### Frontend

- React
- TypeScript
- Vite
- Material UI
- `swagger-ui-react` for read-only documentation rendering

## Data Model

Primary tables:

- `users`
- `groups`
- `roles`
- `permissions`
- `user_groups`
- `group_roles`
- `ldap_config`
- `session_settings`
- `api_definitions`
- `api_spec_cache`
- `audit_logs`
- `app_secrets`
- `system_settings`

## RBAC Model

Authorization is app-layer only.

Relationship model:

```text
User -> Group -> Role -> Permission
```

Supported permission patterns include:

- `user.manage`
- `group.manage`
- `role.manage`
- `ldap.manage`
- `audit.view`
- `api.manage`
- `api.view`
- `api.invoke`
- `api:<api_id>:view`
- `api:<api_id>:invoke`
- `api:<api_id>:manage`

Recommended operational model:

- use global admin permissions for platform administrators
- use API-scoped permissions for application teams
- attach permissions to roles
- attach roles to groups
- attach users to groups

## Authentication

### Local Users

- Passwords are hashed with Argon2id.
- Local users can be forced to change password on first login.
- Local users can use the Change Password flow.

### LDAP Users

- LDAP users are imported into the local catalog.
- Authentication uses LDAP bind on login.
- LDAP users do not use the local password change screen.
- The Change Password navigation item is hidden for LDAP users.

## Default Bootstrap

On first startup the portal seeds a default admin user:

- username: `admin`
- password: `admin`

The seeded admin is forced to change the password on first login.

Change it immediately.

## Environment Variables

| Variable | Default | Description |
|---|---:|---|
| `PORT` | `8080` | HTTP listen port |
| `DATA_PATH` | `/data/app.db` | SQLite database file path |
| `STATIC_DIR` | `/app/public` | Frontend build directory served by backend |
| `TIMEZONE` | `UTC` | Time zone for audit formatting and time display |
| `LOG_RETENTION_DAYS` | `30` | Audit retention window |
| `SESSION_MINUTES` | `60` | Seed/default session duration |
| `PROXY_TIMEOUT_SECONDS` | `30` | Upstream request timeout |
| `MAX_REQUEST_BYTES` | `1048576` | Max proxied request body size |
| `MAX_RESPONSE_BYTES` | `5242880` | Max proxied response body size |

## Local Development

### Frontend

```bash
cd (Project Root)/frontend
npm install
npm run dev
```

### Backend

```bash
cd (Project Root)/backend
go run ./cmd/server
```

### Production-style local run with Docker

```bash
cd (Project Root)
docker build -t internal-api-portal:local .
docker run --rm -p 8080:8080 \
  -e DATA_PATH=/data/app.db \
  -e STATIC_DIR=/app/public \
  -v internal-api-portal-data:/data \
  internal-api-portal:local
```

Open:

- [http://localhost:8080](http://localhost:8080)

## Ready Image

If you want to use the prebuilt image directly, use:

```text
ghcr.io/vurulkan/internal-api-portal:latest
```

### Run the ready image locally

```bash
docker run --rm -p 8080:8080 \
  -e DATA_PATH=/data/app.db \
  -e STATIC_DIR=/app/public \
  -v internal-api-portal-data:/data \
  ghcr.io/vurulkan/internal-api-portal:latest
```

## Docker Build Pattern

The Dockerfile uses a multi-stage build:

1. build frontend assets with Node
2. build the Go backend binary
3. copy both into a lightweight runtime image
4. serve the frontend from the backend

Runtime notes:

- SQLite data should live on a mounted volume
- the entrypoint prepares the data directory for the non-root runtime user

## Kubernetes Deployment

Example manifests are provided under [deploy]((Project Root)/deploy).

The default deployment manifest is already configured to use the ready image:

```text
ghcr.io/vurulkan/internal-api-portal:latest
```

If you want to deploy the ready image directly, apply the manifests as-is:

Apply:

```bash
kubectl apply -f (Project Root)/deploy/namespace.yaml
kubectl apply -f (Project Root)/deploy/pvc.yaml
kubectl apply -f (Project Root)/deploy/deployment.yaml
kubectl apply -f (Project Root)/deploy/service.yaml
```

Deployment expectations:

- a persistent volume is mounted at `/data`
- probes call `/healthz`
- the same container serves both frontend and backend

If you prefer to build and publish your own image, replace the image reference in [deploy/deployment.yaml]((Project Root)/deploy/deployment.yaml).

## Health Check

Endpoint:

```text
GET /healthz
```

Expected response:

```json
{"status":"ok"}
```

## API Definition Management

Each API definition includes:

- `name`
- `slug`
- `description`
- `internalOpenapiUrl`
- `internalBaseUrl`
- `isActive`
- `tryItEnabled`
- `allowedMethods`
- `allowedPathPrefixes`
- `ownerTeam`
- `tags`

### Important: `internalBaseUrl` vs `allowedPathPrefixes`

These are not the same thing.

`internalBaseUrl` is the upstream base address used by the backend proxy.

Example:

```text
https://order.vurulkan.com/order-invoice
```

`allowedPathPrefixes` applies to the documented operation path that comes from the OpenAPI / Swagger `paths` section.

Example:

If the spec contains:

```text
/v1/orders/{id}
/v1/invoices/{id}
```

Then valid allowed path prefixes would be:

- `/v1`
- `/v1/orders`
- `/v1/invoices`

Not:

- `/order-invoice`

because `/order-invoice` belongs in `internalBaseUrl`, not in the operation path allowlist.

### Safe Setup Recommendation

For first registration:

- set `internalBaseUrl`
- set `internalOpenapiUrl`
- leave `allowedPathPrefixes` empty
- optionally set `allowedMethods`

After validation:

- inspect the documented operation paths
- then tighten `allowedPathPrefixes`

## Example API Registration

Example:

- Name: `Order Operations`
- Slug: `order-operations`
- Internal OpenAPI URL: `http://order-operations:8080/api/v3/api-docs`
- Internal Base URL: `http://order-operations:8080/api`
- Allowed Methods: `GET,POST`
- Allowed Path Prefixes: leave empty first, then narrow based on actual spec paths

## OpenAPI / Swagger Support

Supported formats:

- Swagger 2.0 JSON
- Swagger 2.0 YAML
- OpenAPI 3.0 JSON
- OpenAPI 3.0 YAML
- many OpenAPI 3.1 documents will also work in practice, but 3.0.x is the safer target

The portal:

- fetches specs in the backend
- caches them in SQLite
- keeps the last successful spec if a later refresh fails
- renders docs in the frontend
- uses the docs to drive the try-it-out form

## Try It Out Behavior

Try-it-out is spec-driven.

The UI now:

- reads available operations from the imported spec
- lets the user choose a documented operation
- locks method and path to the selected operation
- auto-builds:
  - path parameters
  - query parameters
  - header parameters
  - request body editor
  - `Accept` selector
  - `Content-Type` selector

### Prefill Behavior

The portal attempts to prefill request values from:

- parameter `example`
- parameter `default`
- schema `example`
- schema `default`
- referenced examples via local `$ref`
- request body media type `example`
- request body media type `examples`
- schema-generated fallback examples for objects, arrays, strings, booleans, and numbers

If your spec already defines example values, the form should now prefill them much more reliably, including common `$ref`-based structures.

### Invocation Path

All requests still go through:

```text
/api/apis/:id/invoke
```

The browser never calls the upstream service directly.

## LDAP Setup

Admin flow:

1. Open `Admin -> LDAP Settings`
2. Configure host, port, bind DN, bind password, search bases, filter, and attribute mappings
3. Test the connection
4. Save
5. Search LDAP users
6. Import selected users into the local catalog

### Common Active Directory Starting Values

- `usernameAttribute = sAMAccountName`
- `displayNameAttribute = displayName`
- `emailAttribute = mail`
- `userFilter = (objectClass=user)`

Or:

- `userFilter = (&(objectClass=user)(objectCategory=person))`

### Example Active Directory Configuration

Example values for a typical internal AD setup:

- `host = ad.internal.example`
- `port = 636`
- `useSsl = true`
- `startTls = false`
- `sslSkipVerify = true`
- `bindDn = CN=svc-api-portal,OU=Service Accounts,OU=Directory,DC=corp,DC=example,DC=internal`
- `userBaseDn = OU=Applications,DC=corp,DC=example,DC=internal`
- `usernameAttribute = sAMAccountName`
- `userFilter = (sAMAccountName=%s*)`

Notes:

- `sslSkipVerify = true` is common in internal environments with private or incomplete trust chains, but it is less secure than proper CA trust.
- the `bindDn` account should be read-only and limited to directory lookup needs
- `userBaseDn` should point to the OU tree where end users actually live
- if search returns no users, first verify `userBaseDn`, then `userFilter`, then attribute mappings

LDAP search results depend heavily on:

- `userBaseDn` / `userBaseDns`
- `userFilter`
- `usernameAttribute`
- `displayNameAttribute`
- `emailAttribute`

## Audit Logging

The portal logs:

- login success
- login failure
- password changes
- API detail views
- API spec views
- API spec refreshes
- API invocation attempts
- API invocation failures
- admin changes
- LDAP update and LDAP test actions
- user, group, role, and permission changes

For API invocation logs, the system records:

- timestamp
- user
- source IP
- API ID and API name
- status code
- duration
- request size
- response size
- masked request headers
- blocked or allowed status
- error message when present

Audit exports are available from the admin UI as CSV.

### Audit Log Pagination

The Audit Logs screen supports server-side pagination.

- default page size: `25`
- selectable page sizes: `25`, `50`, `100`
- filters apply to the full audit dataset first
- pagination is applied after filtering

This means user/action searches are not limited to only the currently visible page.

## Branding

System Settings support:

- brand title
- logo upload

Branding behavior:

- updating `Brand Title` also updates the browser tab title
- logo upload updates the application chrome and login screen branding

Supported logo upload types:

- PNG
- JPEG
- SVG
- WEBP

Logo size limit:

- 256 KB

## Security Notes

This application is intentionally not a general-purpose HTTP client.

Key protections:

- no arbitrary target URL from browser input
- proxy only targets registered APIs
- method allowlist enforcement
- path allowlist enforcement
- normalized request path validation
- max request size limit
- max response size limit
- request timeout
- sensitive request headers are stripped or masked
- hop-by-hop headers are removed
- cookies are not blindly forwarded
- audit trail for login, spec usage, and invocation

### Sensitive Header Handling

The proxy strips or masks sensitive values such as:

- `Authorization`
- `Cookie`
- `Set-Cookie`

### Why the Browser Does Not Need CORS

The browser only calls the portal origin.

The portal backend is the component that talks to:

- internal OpenAPI doc endpoints
- internal upstream service endpoints

So the product does not rely on CORS as the solution.

## Operational Notes

- SQLite is appropriate for initial internal deployments and smaller teams
- move to a managed database only when you outgrow SQLite operationally
- if specs are large, frontend bundle size is affected mostly by the documentation renderer, not the proxy
- if you want stricter proxy policy, tighten `allowedMethods` and `allowedPathPrefixes`

## Troubleshooting

### Login succeeds but admin calls are blocked

The seeded local admin requires a password change on first login.

Use:

- `Change Password`

After that, admin endpoints are available.

### LDAP search succeeds poorly or returns no users

Check:

- `userBaseDn`
- `userBaseDns`
- `userFilter`
- `usernameAttribute`
- `displayNameAttribute`
- `emailAttribute`

### API invocation returns `path not allowed`

Most common reason:

- `allowedPathPrefixes` was set to the base URL path instead of the spec operation path

Fix:

- keep the upstream root in `internalBaseUrl`
- use documented operation path prefixes in `allowedPathPrefixes`
- or leave `allowedPathPrefixes` empty until the API is validated

### Try-it-out does not prefill examples

The portal now resolves many local `$ref` examples and schema examples, but some vendor-specific extensions may still require direct inline examples in the spec.

## Current Scope

This is a maintainable v1 internal product with:

- backend-mediated internal API access
- app-layer auth and RBAC
- same-origin frontend/backend delivery
- LDAP support
- audit logging
- OpenAPI-driven docs and invocation

## License / Internal Use

This repository is intended for internal deployment and adaptation.
