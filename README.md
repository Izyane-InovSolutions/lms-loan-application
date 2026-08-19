# LMS Loan Application Frontend

A modern React + Vite frontend for a loan application flow with personal and business loan journeys.

## Project Overview

This repository contains the frontend for a loan application experience built with:

- React 18
- Vite
- Tailwind CSS
- Material UI DatePicker
- React Router v6

The app includes:

- Landing page with loan type selection
- Multi-step personal loan application flow
- Multi-step business loan application flow
- Document upload step
- Loan amount and tenure review
- Terms acceptance modal
- Success confirmation modal

## Folder structure

```
frontend/
├── public/                  # Static assets
├── src/
│   ├── components/          # Shared UI components and modals
│   ├── pages/               # Route pages
│   ├── styles/              # Tailwind-compatible CSS Modules
│   ├── utils/               # API and auth utilities
│   ├── App.jsx              # App routes
│   └── main.jsx             # App entry point
├── index.html               # Vite HTML template
├── package.json             # npm scripts and dependencies
├── tailwind.config.js       # Tailwind configuration
└── postcss.config.js        # PostCSS configuration
```

## Core pages

- `src/pages/LandingPage.jsx` — loan type hero and start flow
- `src/pages/DashboardPage.tailwind.jsx` — personal/business loan application wizard
- `src/components/Header.jsx` — top navigation header
- `src/components/TermsModal.jsx` — terms & conditions modal
- `src/components/SuccessModal.jsx` — submission confirmation modal

## Getting started

### Prerequisites

- Node.js 16+ installed
- npm available

### Install dependencies

```bash
npm install
```

### Run development server

```bash
npm run dev
```

Open the app at `http://localhost:5173` or the URL shown in the terminal.

### Build for production

```bash
npm run build
```

### Preview production build

```bash
npm run preview
```

## Repository setup

If you have not already connected this repo to GitHub:

```bash
git init
git branch -M main
git remote add origin https://github.com/Simonsichi/lms-loan-frontend.git
git add .
git commit -m "chore: initial loan application frontend"
git push -u origin main
```

## Deploying to Vercel

Import settings (all auto-detected from the Vite preset):

- Framework Preset: `Vite`
- Root Directory: leave empty or use project root
- Build Command: `npm run build`
- Output Directory: `dist`

The SPA also ships a small backend under `api/` (draft save/resume, email OTP, document
uploads) that Vercel deploys as functions. It needs two stores and some env vars.

### 1. Add a Redis store

Vercel KV was retired in December 2024 and existing stores were moved to Upstash, so
"KV" here means a Marketplace Redis store: **Storage → Create → Upstash Redis**, then
link it to this project. The integration injects `KV_REST_API_URL` and
`KV_REST_API_TOKEN`, which is exactly what `api/_lib/kv.js` reads — no code change is
needed. A store created directly at Upstash instead exposes the same pair as
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, which is also accepted.

Without those variables a deployed function fails on first store access with a message
telling you to link the store — the on-disk dev fallback is never used on Vercel, where
each invocation has its own read-only filesystem and would silently lose every draft.

### 2. Add a Blob store

**Storage → Create → Blob**, linked to the project; it injects `BLOB_READ_WRITE_TOKEN`.
Uploaded documents live here, and the daily cron (`vercel.json`) deletes blobs whose
draft has already expired out of Redis.

### 3. Set the remaining environment variables

For **Production and Preview** (Vercel scopes variables per environment):

`VITE_API_URL`, `VITE_LMS_API_URL`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USE_TLS`,
`EMAIL_USE_SSL`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL`,
`CRON_SECRET` — see `.env.example`. `VITE_*` variables are read at build time, so
changing one needs a redeploy.

Keep `VITE_LMS_API_URL=/erp-api`: the `/erp-api` rewrite in `vercel.json` proxies it to
the LMS host, standing in for the dev proxy in `vite.config.js`, so the browser stays
same-origin. The rewrite must stay ahead of the SPA fallback rewrite.

### Limits worth knowing

- A function request body caps at 4.5 MB on Vercel, so document uploads are validated at
  4 MB client-side and in `api/draft/documents.js`. Raising it means uploading straight
  to Blob from the browser (`@vercel/blob/client`) instead of through the function.
- On the Hobby plan crons run once a day at an approximate time; the schedule in
  `vercel.json` is already daily.

## Loan application flows

### Personal loan steps

1. Personal information
2. Residence & employment
3. Document uploads
4. Loan terms review

### Business loan steps

1. Business information
2. Directors & applicant details
3. Document uploads
4. Loan terms review

## Validation rules

- NRC: `123456/78/9` or `123456/78/10`
- Phone: Zambian mobile formats with country code or leading zero
- Email: must end with `.com`

## Notes

- The app is currently a frontend-only UI and does not include a backend API.
- Use the loan type selection on the landing page to open the correct application flow immediately.
- The application stores form state locally in React component state.

## Useful commands

```bash
npm install
npm run dev
npm run build
npm run preview
```

## Troubleshooting

- If styles do not appear correctly, ensure `tailwind.config.js` and `src/index.css` are loaded.
- If the review or submit step fails, confirm the browser console for errors.
- If deploy fails on Vercel, verify the build output directory is set to `dist`.
.