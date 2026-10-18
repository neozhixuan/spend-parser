// Your Google OAuth Web client ID (from Google Cloud → APIs & Services → Credentials).
// It is not a secret — it identifies the app, and Google only accepts it from the origins you authorise.
// Set it here, or as VITE_GOOGLE_CLIENT_ID in .env.local / your Vercel project settings.
// Leave both empty to type it into the page instead (stored in that browser only).
const CLIENT_ID: string = '';
export const GOOGLE_CLIENT_ID: string = CLIENT_ID || import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
