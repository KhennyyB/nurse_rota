# Nurses Rota — Iwosan Lagoon Hospitals

Nursing staffing and rota management system for Iwosan Lagoon Hospitals. Covers shift scheduling, leave management, multi-step approvals, ward oversight, and reporting — all in a single-page web application.

---

## Features

| Module | Description |
|---|---|
| **Dashboard** | Live overview of total staff, ward staffing levels, pending/approved leave |
| **Rota** | 28-day drag-and-drop shift grid with auto-scheduling; locks after publication |
| **Auto-Schedule** | One-click schedule generation using a 12-day nurse cycle and 4-day supervisor cycle |
| **Approvals** | Multi-step workflow: Draft → Submitted → Chief Matron → CNO → Published |
| **Staff** | Add, edit, and deactivate nursing staff; assign wards and roles |
| **Wards** | Configure wards with minimum staffing thresholds per shift type |
| **Leave** | Staff submit leave requests; managers approve or reject |
| **Reports** | Payroll-ready summaries and shift reports exportable to Excel |
| **Permissions** | Role-based access control; admins assign roles per user |
| **Audit Log** | Immutable trail of every approval action with actor and timestamp |

---

## Tech Stack

- **Framework:** React 19 + [TanStack Router](https://tanstack.com/router) (SPA mode)
- **Data fetching:** [TanStack Query](https://tanstack.com/query) v5
- **Backend / Auth / DB:** [Supabase](https://supabase.com) (PostgreSQL, Row-Level Security)
- **Styling:** Tailwind CSS v4 + shadcn/ui components
- **Excel export:** [xlsx](https://github.com/SheetJS/sheetjs)
- **PDF export:** Browser print (`window.print`) — no extra dependencies
- **Build tool:** Vite 7
- **Hosting:** Netlify (static SPA)

---

## Roles & Permissions

| Role | Key Capabilities |
|---|---|
| `admin` | Full access — all modules, role management, delete operations |
| `cno` | Approve (CNO step), publish rotas, approve leave |
| `chief_matron` | Approve (Chief Matron step), manage staff, approve leave |
| `head_nurse` | Submit rotas, manage staff, approve leave |
| `hr_admin` | Submit rotas, manage staff, approve leave |
| `nurse` | View rota, submit leave requests |

---

## Local Development

### Prerequisites

- Node.js 20+
- A Supabase project (free tier works)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy the environment template and fill in your Supabase credentials
cp .env.example .env
```

Edit `.env`:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-key
```

```bash
# 3. Start the dev server
npm run dev
```
---

## Building for Production

```bash
npm run build
```
---

## Database Schema (Supabase)

Key tables:

| Table | Purpose |
|---|---|
| `nurses` | Staff records (name, role, ward, target_hours) |
| `wards` | Ward configuration and minimum staffing thresholds |
| `shift_assignments` | Individual daily shift records (nurse, date, shift, status) |
| `leave_requests` | Leave applications and approval status |
| `user_roles` | Maps Supabase auth users to app roles |
| `profiles` | User display names |
| `audit_logs` | Immutable log of approval actions |

The `shift_assignments.status` column follows the enum: `draft | submitted | approved_chief | approved_cno | published`.

---

## Project Structure

```
src/
  routes/
    _app/
      index.tsx       # Dashboard
      rota.tsx         # Shift grid + auto-schedule
      approvals.tsx    # Approval workflow + downloads
      staff.tsx        # Staff management
      wards.tsx        # Ward configuration
      leave.tsx        # Leave requests
      reports.tsx      # Reports & exports
      permissions.tsx  # Role management
      audit.tsx        # Audit log
  lib/
    auto-schedule.ts   # Scheduling engine
    auth-context.tsx   # Auth + RBAC context
  integrations/
    supabase/          # Supabase client + generated types
  components/
    ui/                # shadcn/ui component library
```
