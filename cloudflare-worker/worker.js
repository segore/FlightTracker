/**
 * FlightTracker – Cloudflare Worker Proxy für OpenSky Network API
 *
 * Deployment (einmalig, ~5 Minuten):
 *  1. https://dash.cloudflare.com aufrufen (kostenloser Account genügt)
 *  2. Workers & Pages → Create → Create Worker
 *  3. Diesen Code einfügen und "Deploy" klicken
 *  4. Die generierte *.workers.dev URL in der App unter 🔑 eintragen
 *
 * Optional: Eigene Domain statt *.workers.dev
 *
 * CORS: Der Worker fügt Access-Control-Allow-Origin: * hinzu,
 *       damit die GitHub-Pages-App darauf zugreifen kann.
 *
 * Auth: Wer sich mit OpenSky-Zugangsdaten authentifizieren möchte,
 *       übergibt client_id + client_secret als Query-Parameter.
 *       Der Worker holt selbst ein Bearer-Token und leitet die
 *       Anfrage weiter. Das Token wird 25 Minuten gecacht.
 *
 * Rate limiting: Cloudflare Workers Free = 100.000 Requests/Tag,
 *               mehr als genug für diesen Use-Case.
 */

const OPENSKY_BASE = 'https://opensky-network.org/api';
const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

// Simple in-memory token cache (lives for the duration of the Worker instance)
let cachedToken = null;
let tokenExpiresAt = 0;

async function getToken(clientId, clientSecret) {
  // Return cached token if still valid (with 60s margin)
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Token request failed: ${resp.status}`);
  }

  const data = await resp.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in ?? 1800) * 1000;
  return cachedToken;
}

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);

    // Extract optional OAuth2 credentials passed as query params
    const clientId = url.searchParams.get('_client_id');
    const clientSecret = url.searchParams.get('_client_secret');
    url.searchParams.delete('_client_id');
    url.searchParams.delete('_client_secret');

    // Build target OpenSky URL: /proxy/states/all?... → /api/states/all?...
    const pathMatch = url.pathname.match(/^\/proxy(\/.+)$/);
    if (!pathMatch) {
      return new Response('Not Found. Use /proxy/states/all?...', { status: 404 });
    }

    const targetUrl = `${OPENSKY_BASE}${pathMatch[1]}${url.search}`;

    const headers = {};
    if (clientId && clientSecret) {
      try {
        const token = await getToken(clientId, clientSecret);
        headers['Authorization'] = `Bearer ${token}`;
      } catch (e) {
        return new Response(`Auth error: ${e.message}`, { status: 502 });
      }
    }

    const upstreamResp = await fetch(targetUrl, { headers });

    // Forward rate-limit headers so the app can react
    const responseHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': upstreamResp.headers.get('Content-Type') ?? 'application/json',
    };

    const rateLimitRemaining = upstreamResp.headers.get('X-Rate-Limit-Remaining');
    const retryAfter = upstreamResp.headers.get('X-Rate-Limit-Retry-After-Seconds');
    if (rateLimitRemaining) responseHeaders['X-Rate-Limit-Remaining'] = rateLimitRemaining;
    if (retryAfter) responseHeaders['X-Rate-Limit-Retry-After-Seconds'] = retryAfter;

    const body = upstreamResp.status === 204 ? null : await upstreamResp.text();

    return new Response(body, {
      status: upstreamResp.status,
      headers: responseHeaders,
    });
  },
};
