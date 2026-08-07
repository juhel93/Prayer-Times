// Vercel serverless function (Node.js runtime)
// This runs on Vercel's servers, NEVER in the browser — so the API key stays secret.
// The frontend calls POST /api/extract instead of calling Google directly.
//
// Uses Google's Gemini API, which has a genuinely ongoing free tier (no
// credit card required, does not expire) — unlike Anthropic's one-time
// trial credit. Get a free key at https://aistudio.google.com/apikey

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // allow reasonably large photo/PDF uploads
    },
  },
};

// Very basic in-memory rate limiting per server instance.
// Good enough to stop accidental hammering; not a substitute for a real
// rate-limit service if this gets heavy traffic. Resets whenever the
// serverless function cold-starts.
const requestLog = new Map();
const MAX_REQUESTS_PER_WINDOW = 10;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function isRateLimited(ip) {
  const now = Date.now();
  const entry = requestLog.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  requestLog.set(ip, entry);
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

// Gemini model choice: "gemini-2.5-flash" has good accuracy for reading
// tables and a free-tier limit of roughly 250 requests/day. If you expect
// heavier traffic, switch to "gemini-2.5-flash-lite" for a higher free
// daily cap (~1000/day) at a slight accuracy tradeoff.
const GEMINI_MODEL = 'gemini-3.1-flash-lite';


export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is not configured (missing API key).' });
  }

  const { base64, mediaType, prompt } = req.body || {};
  if (!base64 || !mediaType || !prompt) {
    return res.status(400).json({ error: 'Missing base64, mediaType, or prompt in request body.' });
  }

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: mediaType, data: base64 } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            maxOutputTokens: mediaType === 'application/pdf' ? 8000 : 4000,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', errText);
      return res.status(502).json({ error: 'The extraction service failed. Please try again.' });
    }

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return res.status(502).json({ error: 'No readable response from the extraction service.' });
    }

    return res.status(200).json({ text });
  } catch (err) {
    console.error('Extraction error:', err);
    return res.status(500).json({ error: 'Something went wrong reading that file.' });
  }
}
