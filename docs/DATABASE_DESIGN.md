# Database Design

Migrations: `supabase/migrations/20261101000000_foundation.sql`, `20261101000100_private_helpers.sql`. Applied to Supabase project `zeroeprznkwhanhzwmfv`.

## Tables (20)
| Domain | Tables |
|---|---|
| Identity | `organisations`, `profiles` (1:1 with `auth.users`, role enum `founder/admin/member/viewer`) |
| Structure | `departments`, `business_units` |
| Agents | `agents` (tier `ceo/coo/executive/manager/worker`, instructions, manager, status, monthly cost limit), `agent_permissions`, `agent_memories`, `agent_executions` |
| Work | `projects`, `tasks`, `task_dependencies` |
| Governance | `opportunities`, `approvals`, `audit_logs` |
| Business | `clients`, `employees`, `budgets`, `financial_records`, `notifications`, `scheduled_jobs` |

## Integrity rules
- **Tenant-safe composite foreign keys.** Every child reference is `(organisation_id, x_id) → parent(organisation_id, id)`, so a row can never point at another organisation's data, even with a guessed UUID. `ON DELETE SET NULL (col)` (PG15+) nulls only the reference column.
- Exactly one CEO and one COO per organisation (partial unique indexes).
- No self-management (`manager_id <> id`). Task dependencies are acyclic (recursive-CTE trigger).
- Approvals: `(status = 'pending') = (decided_at is null)`, and a trigger makes decisions final.
- Executions: `attempts <= max_attempts`, `max_attempts` between 1 and 10, non-negative tokens and cost.
- Money is stored as integer cents (`bigint`) with an ISO currency code (default INR).
- Length and format checks on all text inputs (names, permission keys `domain.verb`, cron shape).
- `updated_at` triggers on mutable tables. Indexes cover every RLS predicate and list/sort path (`organisation_id, status`, `created_at desc`, FK columns).

## Founder bootstrap
`after insert on auth.users` → `private.bootstrap_founder()` creates an organisation, a founder profile, four departments, the CEO (Atlas), COO (Orion), CGO (Nova) and CFO (Ledger) with role instructions, and their permissions. Verified live: 4 agents and 20 permissions.

## Audit
`private.audit_row_change()` (SECURITY DEFINER) records insert/update/delete on 12 business tables with a changed-fields diff. Rows removed by an organisation-wide cascade are skipped. `audit_logs` allows inserts only. UPDATE, DELETE and TRUNCATE are revoked.

## Testing
`npm run test:db` spins up a throwaway Postgres, stubs `auth`, applies all migrations and asserts: bootstrap, isolation, cycle rejection, final approvals, no role self-escalation, audit immutability, cross-tenant FK rejection, viewer read-only and clean cascade.

## Migration 20261101000200 — Virtual Executive Office
- New tables: `kras` (governance write) and `kpis` (operational write; `target > 0`, `current_value >= 0`, period enum). Both have RLS, audit and `updated_at` triggers.
- New tenant-safe FK columns: `business_units.manager_agent_id`, `agents.business_unit_id`, `projects.kra_id`, `tasks.kra_id`, `clients.business_unit_id`, `financial_records.business_unit_id`.
- `private.seed_executive_office(org)` is idempotent. It runs for existing organisations and, through the `on_auth_user_created_seed` trigger, for every new founder.
