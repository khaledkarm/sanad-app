// Returns the Google consent URL that links Khaled's Google account to the app.

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube.upload'
];

export default async function handler(req, res) {
  const base = process.env.APP_BASE_URL;
  const cid = process.env.GOOGLE_CLIENT_ID;
  if (!base || !cid) return res.status(500).json({ error: 'not configured' });
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: cid,
    redirect_uri: `${base}/api/oauth-callback`,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent'
  });
  return res.status(200).json({ url });
}
