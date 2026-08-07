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

Use these settings when importing the repository into Vercel:

- Framework Preset: `Vite`
- Root Directory: leave empty or use project root
- Build Command: `npm run build`
- Output Directory: `dist`

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
