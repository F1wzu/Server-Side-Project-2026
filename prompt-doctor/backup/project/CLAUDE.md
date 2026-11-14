# CLAUDE.md — วันนี้ไปไหนดี @ ลาดกระบัง

Course project (KMITL 06016418 Server-Side Web Development). A place guide for
Lat Krabang: members review places and submit new ones, an admin approves them.
Presentation online Thu 19 or Fri 20 Nov 2026. Read `docs/PLAN.md` (steps and
audit checks), `docs/DESIGN.md` (tables, API, rules) and `docs/ARCHITECTURE.md`
(layers, middleware order, security) before changing anything. The docs are in Thai.

## Where things stand (13 Nov 2026)

- Steps 1–6 are built. On GitHub: `tempmock` (1), `UIWeb/Account` (2–3),
  `Reviews` (4–5 plus fixes from a review of steps 1–4). Step 6 (admin) is on
  the local branch `step-6-admin` until the user commits and pushes it.
  Nothing is merged into `main` yet; each branch builds on the previous one.
- Step 6 added: `/admin` dashboard; submission queue with approve (optional
  pin move, recorded in history), return, reject; place management (add
  directly, edit, hours, pin, photo, publish / unpublish, featured order);
  review removal with a reason; reports list (resolve / dismiss); categories.
  Admin routes live in `src/routes/admin/*.js`, each exporting `{ web, api }`.
- Next: step 7 (Postman collection, GitHub Actions CI, register/other rate
  limits review, accessibility pass, `npm audit`), then step 8 (deploy; open
  decisions: Cloudinary, Render + Neon, Google sign-in — all undecided;
  `src/storage/cloud.js` is a stub).
- No admin account exists yet in the dev database (`npm run admin:create`).
- Only 3 of the 30 seeded places have opening hours and 17 have a pin; an
  admin can now add hours and pins at `/admin/places`.

## How we work

- One step = one branch = one pull request. The user commits and pushes
  themself; give them the commands. Don't commit unless asked.
- Stop after each step with a report: what was built, the PLAN.md audit checks
  and their results, what is not verified, and the commit commands.
- Write the user-facing reply in plain language; the user may follow from a phone.
- Large steps may use subagents (the user allowed it). Give each one exclusive
  files and its **own test database** (`CREATE DATABASE painaidee_test_x OWNER
  painaidee`, run Jest with `TEST_DATABASE_URL=.../painaidee_test_x`), review
  their work, then run the full suite once on the normal test database, and
  drop the extra databases afterwards.
- `C:\Users\USER\Documents\ChatGPT\skill learning\exports\lat-krabang-claude-handoff-2026-10-12`
  is an older reference app: read it for ideas and markup only; never copy it
  into this repo wholesale or edit it.

## Code conventions

- Node 24, CommonJS, Express 5, EJS (server-rendered), PostgreSQL 17, Prisma 7
  (`@prisma/adapter-pg`), Zod 4, Jest + supertest. MVC folders as in the course
  lab: routes → controllers → models (all Prisma access) → views.
- Every page handler and API handler call the same model function.
- All user-facing text is Thai; code comments explain *why* in plain English.
- Errors: throw `AppError(status, CODE, thaiMessage, details)`; codes are listed
  in DESIGN.md. Owners only: another member's record answers 404, not 403.
- Rules Prisma can't express go as hand-written SQL at the end of the
  migration (CHECK constraints, partial/expression indexes). Never change the
  schema outside a migration.
- Ids from URLs go through `src/utils/ids.js` `parseId`; free text through
  `src/validation/text.js`; NUL is stripped globally (`middleware/sanitize.js`).
- Photo forms: routes use `withPhoto = [photoUpload, stripNul, csrfAfterUpload]`
  and must be listed in `PHOTO_ROUTES` in `middleware/csrf.js`.
- Every new endpoint goes into DESIGN.md's API tables, with tests.

## Local setup on this PC

- PostgreSQL 17 Windows service `postgresql-x64-17`, port 5432; role
  `painaidee`; databases `painaidee_dev` (app) and `painaidee_test` (wiped by
  `npm test`). Passwords live only in `.env` — never print or commit it.
  `.env.demo` (git-ignored) holds a demo member login.
- `npm run dev` (port 3000), `npm test`, `npm run db:migrate`, `npm run db:seed`
  (only fills an empty database), `npm run db:studio`.
- After a schema change run `npx prisma generate` if tests report an unknown field.
- A teammate uses PostgreSQL 18; the project works on 17 or newer.
- In production `TRUST_PROXY=1` is required behind the host's proxy, or the
  secure login cookie is never set.
