# MCAT Study Tracker

Next.js + Supabase personal study dashboard.

## Vercel environment variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## Local development
```bash
npm install
npm run dev
```

The app seeds the study schedule into Supabase on the first successful sign-in if `study_days` is empty for that user.
