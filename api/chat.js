// سند - personal assistant chat endpoint for Khaled.
// Gemini function calling over: websites, Gmail, YouTube.
// Mutating actions never run here; they return a pending preview and the
// frontend asks Khaled to confirm, then calls /api/act.

import { gfetch, getRefreshToken } from './lib/google.js';

const MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest'
];

const MAX_TEXT = 20000;
const FETCH_TIMEOUT_MS = 15000;

const SYSTEM = `أنت «سند»، المساعد الشخصي لخالد كرم على موبايله. بتتكلم بالعامية المصرية، باختصار ومن غير حشو ومن غير مقدمات.
عندك أدوات حقيقية: قراءة المواقع والإجابة عنها، البحث في إيميلات جيميل وقراءتها، تجهيز إيميلات للإرسال، إحصائيات قناة اليوتيوب وآخر الفيديوهات والتعليقات، وتجهيز ردود على التعليقات.
قناة خالد على يوتيوب اسمها «نقطة تحول».
قواعد مهمة:
- إرسال الإيميلات والرد على التعليقات بيتعمل بمعاينة وتأكيد من خالد: استخدم الأداة المناسبة، وبعدها قوله إن المعاينة جاهزة ويضغط زرار التأكيد. متقولش إنك بعتت قبل ما يأكد.
- متخترعش أرقام أو بيانات. لو محتاج معلومة من موقع أو إيميل أو يوتيوب استخدم الأداة، ولو الأداة رجعت خطأ قوله بصراحة.
- لو الأداة قالت not_linked يبقى الربط بحساب جوجل مش متعمل لسه: قوله يعمل ربط من لينك الإعداد اللي هيجيله.
- الوقت عندك بتوقيت القاهرة.`;

const TOOLS = [{
  function_declarations: [
    {
      name: 'website_qa',
      description: 'يفتح موقع عام على الإنترنت ويقرأ محتواه للإجابة عن سؤال أو تلخيصه',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'رابط الموقع الكامل' },
          question: { type: 'string', description: 'السؤال عن محتوى الموقع' }
        },
        required: ['url', 'question']
      }
    },
    {
      name: 'gmail_search',
      description: 'يبحث في إيميلات جيميل ويرجع قائمة مختصرة بالنتائج',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'كلمات البحث، مثال: from:ahmed أو subject:فاتورة' },
          max_results: { type: 'number', description: 'أقصى عدد نتائج، افتراضي 5' }
        },
        required: ['query']
      }
    },
    {
      name: 'gmail_read',
      description: 'يقرأ نص إيميل معين بالكامل باستخدام رقمه من نتائج البحث',
      parameters: {
        type: 'object',
        properties: { message_id: { type: 'string' } },
        required: ['message_id']
      }
    },
    {
      name: 'gmail_compose',
      description: 'يجهز معاينة إيميل جديد لإرساله بعد تأكيد خالد. لا ترسل فعليا',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string' },
          subject: { type: 'string' },
          body: { type: 'string' }
        },
        required: ['to', 'subject', 'body']
      }
    },
    {
      name: 'youtube_channel_stats',
      description: 'إحصائيات قناة اليوتيوب: المشتركين والمشاهدات وعدد الفيديوهات',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'youtube_list_videos',
      description: 'أحدث فيديوهات القناة مع مشاهدات كل فيديو',
      parameters: {
        type: 'object',
        properties: { max_results: { type: 'number', description: 'افتراضي 5' } }
      }
    },
    {
      name: 'youtube_list_comments',
      description: 'أحدث التعليقات على فيديوهات القناة',
      parameters: {
        type: 'object',
        properties: {
          max_results: { type: 'number', description: 'افتراضي 10' },
          video_id: { type: 'string', description: 'اختياري: تعليقات فيديو معين فقط' }
        }
      }
    },
    {
      name: 'youtube_reply_comment',
      description: 'يجهز رد على تعليق في يوتيوب ليتأكد منه خالد قبل النشر. لا ينشر فعليا',
      parameters: {
        type: 'object',
        properties: {
          comment_id: { type: 'string', description: 'رقم التعليق من قائمة التعليقات' },
          text: { type: 'string', description: 'نص الرد' }
        },
        required: ['comment_id', 'text']
      }
    }
  ]
}];

function htmlToText(html) {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  t = t
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  return t.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

async function fetchWithTimeout(url, opts = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: c.signal, redirect: 'follow' });
  } finally {
    clearTimeout(t);
  }
}

function b64urlDecode(s) {
  try { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
  catch { return ''; }
}

function extractBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return b64urlDecode(payload.body.data);
  for (const p of payload.parts || []) {
    const t = extractBody(p);
    if (t) return t;
  }
  if (payload.body?.data) return b64urlDecode(payload.body.data);
  return '';
}

async function toolWebsiteQa({ url, question }) {
  let u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const r = await fetchWithTimeout(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36' } });
  if (!r.ok) return { error: `الموقع رجع حالة ${r.status}` };
  const html = await r.text();
  const text = htmlToText(html);
  if (!text) return { error: 'مقدرتش أقرا محتوى من الصفحة دي' };
  return { page_text: text, question };
}

async function toolGmailSearch({ query, max_results }) {
  const max = Math.min(Number(max_results) || 5, 10);
  const r = await gfetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${max}`);
  if (!r.ok) return { error: r.data?.error === 'not_linked' ? 'not_linked' : `gmail error ${r.status}` };
  const ids = (r.data?.messages || []).map(m => m.id);
  const out = [];
  for (const id of ids) {
    const m = await gfetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    if (!m.ok) continue;
    const h = Object.fromEntries((m.data.payload?.headers || []).map(x => [x.name, x.value]));
    out.push({ id, from: h.From || '', subject: h.Subject || '', date: h.Date || '', snippet: m.data.snippet || '' });
  }
  return { results: out };
}

async function toolGmailRead({ message_id }) {
  const r = await gfetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message_id)}?format=full`);
  if (!r.ok) return { error: r.data?.error === 'not_linked' ? 'not_linked' : `gmail error ${r.status}` };
  const h = Object.fromEntries((r.data.payload?.headers || []).map(x => [x.name, x.value]));
  const body = (extractBody(r.data.payload) || r.data.snippet || '').slice(0, 8000);
  return { from: h.From || '', to: h.To || '', subject: h.Subject || '', date: h.Date || '', body };
}

async function ytChannelId() {
  const r = await gfetch('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true');
  if (!r.ok) return null;
  return r.data?.items?.[0]?.id || null;
}

async function toolYtStats() {
  const r = await gfetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true');
  if (!r.ok) return { error: r.data?.error === 'not_linked' ? 'not_linked' : `youtube error ${r.status}` };
  const c = r.data?.items?.[0];
  if (!c) return { error: 'مفيش قناة متربطة بالحساب ده' };
  return {
    title: c.snippet?.title,
    subscribers: c.statistics?.subscriberCount,
    total_views: c.statistics?.viewCount,
    videos: c.statistics?.videoCount
  };
}

async function toolYtVideos({ max_results }) {
  const max = Math.min(Number(max_results) || 5, 10);
  const s = await gfetch(`https://www.googleapis.com/youtube/v3/search?part=id&forMine=true&type=video&order=date&maxResults=${max}`);
  if (!s.ok) return { error: s.data?.error === 'not_linked' ? 'not_linked' : `youtube error ${s.status}` };
  const ids = (s.data?.items || []).map(i => i.id?.videoId).filter(Boolean);
  if (!ids.length) return { videos: [] };
  const v = await gfetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids.join(',')}`);
  if (!v.ok) return { error: `youtube error ${v.status}` };
  return {
    videos: (v.data?.items || []).map(i => ({
      id: i.id,
      title: i.snippet?.title,
      published: i.snippet?.publishedAt,
      views: i.statistics?.viewCount,
      likes: i.statistics?.likeCount,
      comments: i.statistics?.commentCount
    }))
  };
}

async function toolYtComments({ max_results, video_id }) {
  const max = Math.min(Number(max_results) || 10, 20);
  let url;
  if (video_id) {
    url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${encodeURIComponent(video_id)}&order=time&maxResults=${max}`;
  } else {
    const ch = await ytChannelId();
    if (!ch) return { error: 'not_linked' };
    url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&allThreadsRelatedToChannelId=${ch}&order=time&maxResults=${max}`;
  }
  const r = await gfetch(url);
  if (!r.ok) return { error: r.data?.error === 'not_linked' ? 'not_linked' : `youtube error ${r.status}` };
  return {
    comments: (r.data?.items || []).map(i => {
      const c = i.snippet?.topLevelComment;
      return {
        comment_id: c?.id,
        video_id: i.snippet?.videoId,
        author: c?.snippet?.authorDisplayName,
        text: (c?.snippet?.textDisplay || '').slice(0, 500),
        published: c?.snippet?.publishedAt
      };
    })
  };
}

async function execTool(name, args) {
  switch (name) {
    case 'website_qa': return { result: await toolWebsiteQa(args) };
    case 'gmail_search': return { result: await toolGmailSearch(args) };
    case 'gmail_read': return { result: await toolGmailRead(args) };
    case 'gmail_compose': {
      if (!(await getRefreshToken())) return { result: { error: 'not_linked' } };
      return {
        result: { status: 'pending_confirmation' },
        pending: { kind: 'gmail_send', label: `إرسال إيميل إلى ${args.to}\nالموضوع: ${args.subject}\n\n${args.body}`, args: { to: args.to, subject: args.subject, body: args.body } }
      };
    }
    case 'youtube_channel_stats': return { result: await toolYtStats() };
    case 'youtube_list_videos': return { result: await toolYtVideos(args) };
    case 'youtube_list_comments': return { result: await toolYtComments(args) };
    case 'youtube_reply_comment': {
      if (!(await getRefreshToken())) return { result: { error: 'not_linked' } };
      return {
        result: { status: 'pending_confirmation' },
        pending: { kind: 'youtube_reply', label: `الرد على التعليق:\n${args.text}`, args: { comment_id: args.comment_id, text: args.text } }
      };
    }
    default: return { result: { error: 'unknown tool' } };
  }
}

async function callGemini(contents) {
  let lastErr = null;
  for (const model of MODELS) {
    try {
      const r = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM }] },
            contents,
            tools: TOOLS,
            generationConfig: { temperature: 0.4, maxOutputTokens: 2048 }
          })
        }
      );
      const j = await r.json().catch(() => null);
      if (r.ok && j) return j;
      lastErr = `${model}: ${r.status}`;
      if (r.status !== 429 && r.status < 500) break;
    } catch (e) {
      lastErr = `${model}: ${e.message}`;
    }
  }
  throw new Error(`gemini failed (${lastErr})`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    const { message, history = [] } = req.body || {};
    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });

    const contents = [];
    for (const h of history.slice(-12)) {
      if (!h || typeof h.text !== 'string') continue;
      contents.push({ role: h.role === 'model' ? 'model' : 'user', parts: [{ text: h.text.slice(0, 4000) }] });
    }
    contents.push({ role: 'user', parts: [{ text: message }] });

    const pendings = [];
    let reply = '';
    for (let round = 0; round < 6; round++) {
      const j = await callGemini(contents);
      const parts = j.candidates?.[0]?.content?.parts || [];
      const calls = parts.filter(p => p.functionCall);
      const texts = parts.filter(p => p.text).map(p => p.text);
      if (texts.length) reply = texts.join('\n');
      contents.push({ role: 'model', parts: parts.map(p => p.functionCall ? { functionCall: p.functionCall } : { text: p.text }) });
      if (!calls.length) break;
      const responses = [];
      for (const c of calls) {
        const { result, pending } = await execTool(c.functionCall.name, c.functionCall.args || {});
        if (pending) pendings.push(pending);
        responses.push({ functionResponse: { name: c.functionCall.name, response: { result: result || {} } } });
      }
      contents.push({ role: 'user', parts: responses });
    }

    if (!reply) reply = 'مقدرتش أوصل لرد، جرب تاني.';
    return res.status(200).json({ reply, pending: pendings[0] || null });
  } catch (e) {
    return res.status(200).json({ reply: `حصلت مشكلة تقنية: ${e.message}. جرب تاني بعد شوية.`, pending: null });
  }
}
