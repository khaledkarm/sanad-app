import { getRefreshToken, getAccessToken } from './lib/google.js';
import process from 'node:process';

export default async function handler(req, res) {
  const rt = await getRefreshToken();
  let scopes = null;
  if (rt) {
    try {
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: rt,
          grant_type: 'refresh_token'
        })
      });
      const j = await r.json();
      scopes = j.scope || (j.error ? `error:${j.error}` : null);
    } catch { scopes = 'error:fetch'; }
  }
  return res.status(200).json({
    ok: true,
    gemini: !!process.env.GEMINI_API_KEY,
    googleLinked: !!rt,
    grantedScopes: scopes
  });
}
