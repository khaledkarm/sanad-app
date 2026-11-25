import { getRefreshToken } from './lib/google.js';

export default async function handler(req, res) {
  const linked = !!(await getRefreshToken());
  return res.status(200).json({ ok: true, gemini: !!process.env.GEMINI_API_KEY, googleLinked: linked });
}
