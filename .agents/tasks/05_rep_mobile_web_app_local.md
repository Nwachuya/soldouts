# Task 05: Phone-First Rep Web Application (Local Build & Validation)

- **Status**: `done`
- **Target Paths**: `web/` (Next.js App Router, TypeScript, Tailwind CSS v4, `lucide-react`, `coss` UI), `web/src/app/globals.css`, `web/src/app/layout.tsx`, `web/src/app/page.tsx`, `web/src/app/merchant/[id]/page.tsx`, `web/src/app/api/**`, `web/src/lib/valuation.ts`

## Objective
Build and locally validate a responsive, phone-first Next.js web application for UK Local reps showing today's sold-outs (`/soldouts/today`), clear action directives (`call`, `don't bother`, or specific operational action such as deal edit / pause schedule) with plain-English why, code-calculated net **£ EV**, substring-verified **evidence quotes**, and live merchant marking (`PUT` / `DELETE /merchants/{id}/mark`).

## Evaluation Criteria
1. **Functional Completeness**:
   - Loads live `GET /soldouts/today`, `GET /marks`, and read-only `GET /routing/switch` via server-side route handlers using `.env` (`BASE_URL`, `KEY` — never `NEXT_PUBLIC_`), falling back cleanly to bundled local data when offline.
   - **Never** calls `PUT /routing/switch` from code, tests, or UI without Greg's explicit written OK.
   - Displays rep filter (defaulting to Renee Walsh `R10` / All Reps), action tabs, net £ value + transparent math breakdown (`GP lift - rep time - refund risk`), and verbatim quote with source & date.
   - Supports setting and removing merchant marks (`PUT /merchants/{id}/mark` with `mark`, `reason`, `marked_by`, and `DELETE /merchants/{id}/mark`) with immediate UI state update.
2. **Global Design & CSS Standards Compliance (`AGENTS.md` + `design.md`)**:
   - Built with Tailwind CSS v4, `lucide-react`, and `coss` UI components/patterns.
   - Fixed top navbar, page container, and footer all set to `99vw` width; header and footer logos both link to `/` on desktop and mobile; custom favicon present.
   - All font sizes, text case rules, and headings set globally in `globals.css` (never ad-hoc per component), scaling smaller on mobile.
   - All button-like elements enforce `15px` top/bottom and `20px` left/right padding; zero container overflow; smooth `200ms ease-in-out` transitions.
   - Uses **Breadcrumbs** (`Home / Today's Queue / [Merchant]`) on drilldown views—zero "Go back" buttons anywhere.
3. **Local Testing & Browser Verification**:
   - `npm test` (verifying TypeScript valuation parity with `valuation_vectors.json`) and `npm run build` succeed cleanly.
   - Verified in local harness browser (with user consent) on mobile (`390x844`) and desktop viewports, plus live mark `PUT` + cleanup `DELETE` verified against Sandbox API.

## Validation
- `cd web && npm test`: **1/1 TypeScript test passed** (`0.67ms`) — `evaluateSoldout` in `web/src/lib/valuation.ts` matches all 6 shared Python vectors in `tests/fixtures/valuation_vectors.json`.
- `cd web && npm run build`: **Next.js 15.5.29 production build passed** (TypeScript + lint + static/dynamic routes: `/`, `/merchant/[id]`, `/api/soldouts/today`, `/api/merchants/[id]`, `/api/merchants/[id]/mark`, `/icon.svg`).
- Live Sandbox API check: `GET /me` (`200`, `llm_spent_usd: 0.0036` of `20`), `GET /soldouts/today` (`200`, `total=18`), `GET /routing/switch` (`200`, `suppress_soldout_tasks: False`, untouched), and `PUT` + `DELETE /merchants/M10921/mark` (`200`, round-trip verified & cleaned up).
- Global CSS & layout rules verified in `globals.css` / `layout.tsx` / `merchant/[id]/page.tsx`: `99vw` fixed header/page/footer, logos link to `/`, global font/heading scales with mobile step-down, `15px 20px` button padding, `200ms ease-in-out` transitions, favicon, and Breadcrumbs instead of "Go back" buttons. *(Visual check in local harness browser available on your approval.)*
