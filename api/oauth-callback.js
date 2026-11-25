// Handles the Google OAuth redirect after Khaled consents:
// exchanges the code and stores the refresh token in the private GitHub repo
// (runtime-readable, no redeploy needed).

function page(title, body, ok) {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:sans-serif;background:#0f1720;color:#e8edf2;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#1a2530;border-radius:16px;padding:32px;max-width:420px;text-align:center}
h1{font-size:22px;margin:0 0 12px}p{color:#9fb0bd;line-height:1.7}</style></head>
<body><div class="card"><h1>${ok ? '✅' : '⚠️'} ${title}</h1><p>${body}</p></div></body></html>`;
}

export default async function handler(req, res) {
  const { code, error } = req.query || {};
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (error || !code) {
    return res.status(400).send(page('الربط ما تمش', 'جوجل رجعت بدون موافقة. جرب اللينك تاني.', false));
  }
  try {
    const base = process.env.APP_BASE_URL;
    const tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${base}/api/oauth-callback`,
        grant_type: 'authorization_code'
      })
    });
    const tj = await tr.json();
    if (!tj.refresh_token) {
      return res.status(502).send(page('حصلت مشكلة', 'مقدرناش ناخد صلاحية دائمة من جوجل. جرب اللينك تاني من الأول.', false));
    }
    const repo = process.env.GH_STORE_REPO;
    const headers = {
      Authorization: `Bearer ${process.env.GH_STORE_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    };
    let sha;
    const cur = await fetch(`https://api.github.com/repos/${repo}/contents/refresh_token.txt`, { headers });
    if (cur.ok) sha = (await cur.json()).sha;
    const wr = await fetch(`https://api.github.com/repos/${repo}/contents/refresh_token.txt`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: 'store google refresh token',
        content: Buffer.from(tj.refresh_token, 'utf8').toString('base64'),
        ...(sha ? { sha } : {})
      })
    });
    if (!wr.ok) throw new Error(`github store ${wr.status}`);
    return res.status(200).send(page('تم الربط', 'حساب جوجل اتربط بسند. ارجع للتطبيق وابدأ تستخدمه.', true));
  } catch (e) {
    return res.status(502).send(page('حصلت مشكلة تقنية', `التفاصيل: ${e.message}`, false));
  }
}
