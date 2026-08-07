# Prayer Times — standalone version (free, no login required)

This is a self-hosted version of the Prayer Times app. No one needs a
Claude account (or any account) to use it, it costs nothing to run, and it
can live at your own URL for as long as you like.

It uses **Google's Gemini API**, which — unlike Anthropic's API — has a
genuinely ongoing free tier: no credit card, no expiration, just a daily
request limit that's generous enough for a community app like this.

Your API key stays on the server (`api/extract.js`), never in the browser,
so it can't be copied by anyone inspecting the page.

## Deploying

1. Get a free key at aistudio.google.com/apikey
2. Import this repo into Vercel (vercel.com)
3. In the project's Environment Variables, add `GEMINI_API_KEY` with your key
4. Deploy — you'll get a live URL you can share

## About the free tier limits

The app uses `gemini-2.5-flash` by default (~250 free requests/day). For
higher traffic, open `api/extract.js` and change `GEMINI_MODEL` to
`'gemini-2.5-flash-lite'` for a higher free daily cap.
