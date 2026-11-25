// Google auth helpers. The refresh token lives in a PRIVATE GitHub repo
// (written once by /api/oauth-callback after Khaled consents); nothing secret
// is in the app repo. Access goes through a repo-scoped PAT in env vars.

const GH_TOKEN = process.env.GH_STORE_TOKEN;
const GH_REPO = process.env.GH_STORE_REPO; // e.g. khaledkarm/sanad-store

export async function getRefreshToken() {
  if (!GH_TOKEN || !GH_REPO) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/refresh_token.txt`, {
      headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' }
    });
    if (!r.ok) return null;
    const j = await r.json();
    const v = Buffer.from((j.content || '').replace(/\n/g, ''), 'base64').toString('utf8').trim();
    return v.length > 10 ? v : null;
  } catch {
    return null;
  }
}

let cached = { token: null, exp: 0 };

export async function getAccessToken() {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const rt = await getRefreshToken();
  if (!rt) return null;
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
  if (!j.access_token) return null;
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

// Authenticated call to a Google API. Returns {ok, status, data} and never throws.
export async function gfetch(url, { method = 'GET', body } = {}) {
  const at = await getAccessToken();
  if (!at) return { ok: false, status: 401, data: { error: 'not_linked' } };
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${at}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await r.json(); } catch { data = null; }
  return { ok: r.ok, status: r.status, data };
}
