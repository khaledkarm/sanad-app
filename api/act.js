// Executes a user-confirmed action (email send, YouTube comment reply).
// Only runs after Khaled taps confirm in the app.

import { gfetch } from './lib/google.js';

function encodeSubject(s) {
  return /[^\x00-\x7F]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=` : s;
}

async function gmailSend({ to, subject, body }) {
  const raw = [
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    body
  ].join('\r\n');
  const r = await gfetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    body: { raw: Buffer.from(raw, 'utf8').toString('base64url') }
  });
  if (!r.ok) return { ok: false, error: r.data?.error === 'not_linked' ? 'not_linked' : `gmail ${r.status}` };
  return { ok: true, id: r.data?.id };
}

async function ytReply({ comment_id, text }) {
  const r = await gfetch('https://www.googleapis.com/youtube/v3/comments?part=snippet', {
    method: 'POST',
    body: { snippet: { parentId: comment_id, textOriginal: text } }
  });
  if (!r.ok) return { ok: false, error: r.data?.error === 'not_linked' ? 'not_linked' : `youtube ${r.status}` };
  return { ok: true, id: r.data?.id };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const { kind, args } = req.body || {};
  try {
    if (kind === 'gmail_send') {
      const r = await gmailSend(args || {});
      return res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true, message: 'اتبعت الإيميل ✅' } : { ok: false, message: `مشكلة في الإرسال: ${r.error}` });
    }
    if (kind === 'youtube_reply') {
      const r = await ytReply(args || {});
      return res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true, message: 'اتنشر الرد ✅' } : { ok: false, message: `مشكلة في النشر: ${r.error}` });
    }
    return res.status(400).json({ ok: false, message: 'نوع عملية غير معروف' });
  } catch (e) {
    return res.status(200).json({ ok: false, message: `حصلت مشكلة تقنية: ${e.message}` });
  }
}
