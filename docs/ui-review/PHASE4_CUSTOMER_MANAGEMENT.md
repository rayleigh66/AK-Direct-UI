# Formal slice — administrator customer management

This slice is stacked on PR #16 (`feat/factoryos3-uat-round2`, head
`2d15d99`) and uses the existing Real React + API + PostgreSQL stack only. No
Mock project, new Compose project, volume, database or business-rule change is
introduced.

## What administrators can do

- Search the existing customer-company list by code, name or internal nickname.
- Create a company with an ISO alpha-3 country, optional internal nickname,
  salesperson and brand grants, and receive the one-time primary credential.
- Open a company and see its accounts, brand grants, sales assignment and status.
- Add a customer account and receive its one-time credential.
- Suspend/reactivate an individual account (sessions are revoked on suspend).
- Grant/revoke brand access; a revoke that would cancel pending orders opens the
  existing destructive-impact dialog and requires the issued impact token.
- Suspend/reactivate the company; a suspend that would cancel pending orders uses
  the same impact dialog.
- Change the assigned salesperson.
- Switch the internal language between English and Chinese. Customer-facing
  pages remain English-only.

The tab is shown only with `companies.manage`. Account actions require
`accounts.manage`; brand actions require `brands.manage` plus `catalog.read` (or
`catalog.manage`). Read endpoints are also permission-gated, so a salesperson
receives `403` even if they call the API directly.

## API surface (existing permissions, no new grants)

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/admin/companies` | `companies.manage` |
| GET | `/api/admin/companies/:id` | `companies.manage` |
| POST | `/api/admin/companies` | `companies.manage` |
| GET | `/api/admin/companies/:id/accounts` | `accounts.manage` (new read) |
| POST | `/api/admin/companies/:id/accounts` | `accounts.manage` |
| PATCH | `/api/admin/customers/:id/status` | `accounts.manage` |
| GET | `/api/admin/companies/:id/brands` | `brands.manage` (new read) |
| PUT | `/api/admin/companies/:id/brands/:brandId` | `brands.manage` |
| PATCH | `/api/admin/companies/:id/status` | `companies.manage` |
| PATCH | `/api/admin/companies/:id/sales-assignment` | `companies.manage` |
| GET | `/api/admin/sales-users` | `companies.manage` |
| GET | `/api/admin/orders/impact` | existing sales/admin read |

The two new read endpoints return no password hashes, session IDs or other
credential material. They add no permission, migration or default data.

## Tests

- API integration: account/brand projections, exact field allowlist, no hash
  leakage, unknown-company `404`, and `403` for sales and customer sessions.
- Real E2E: admin account creation/suspension, brand grant round-trip, sales
  assignment persistence across reload, company suspend/reactivate, UI company
  creation, sales tab/API denial, and a 390 px mobile pass with no horizontal
  overflow.
- Unit, Mock E2E, API lint and frontend lint/build are run with the full suite.

## Operational notes

- One-time credentials are displayed once in the UI. They are never logged,
  stored in the browser or written to test output.
- The UI writes only through the API. There is no optimistic "fake save"; every
  mutation awaits the server response and then reloads the company projection.
- The UAT sample-catalogue script and existing UAT database are reused. No new
  Docker Compose project or test database is created.
