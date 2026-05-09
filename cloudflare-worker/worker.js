/**
 * FlightTracker – Cloudflare Worker Proxy für OpenSky Network API
 *
 * Deployment (einmalig, ~5 Minuten):
 *  1. https://dash.cloudflare.com aufrufen (kostenloser Account genügt)
 *  2. Workers & Pages → Create → Create Worker
 *  3. Diesen Code einfügen und "Deploy" klicken
 *  4. Worker → Settings → Variables and Secrets → Add secret:
 *       - OPENSKY_CLIENT_ID
 *       - OPENSKY_CLIENT_SECRET
 *  5. Die generierte *.workers.dev URL in der App unter 🔑 eintragen
 *
 * Optional: Eigene Domain statt *.workers.dev
 *
 * CORS: Der Worker fügt Access-Control-Allow-Origin: * hinzu,
 *       damit die GitHub-Pages-App darauf zugreifen kann.
 *
 * Auth: Der Worker nutzt OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET
 *       aus Cloudflare Secrets. Keine Secrets im Frontend.
 *       Das Bearer-Token wird 25 Minuten gecacht.
 *
 * Rate limiting: Cloudflare Workers Free = 100.000 Requests/Tag,
 *               mehr als genug für diesen Use-Case.
 */

const OPENSKY_BASE = 'https://opensky-network.org/api';
const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

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
        headers: CORS_HEADERS,
      });
    }

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // Build target OpenSky URL: /proxy/states/all?... → /api/states/all?...
    const pathMatch = url.pathname.match(/^\/proxy(\/.+)$/);
    if (!pathMatch) {
      return new Response('Not Found. Use /proxy/states/all?...', {
        status: 404,
        headers: CORS_HEADERS,
      });
    }

    const targetUrl = `${OPENSKY_BASE}${pathMatch[1]}${url.search}`;

    /** @type {Record<string, string>} */
    const headers = {};
    let authWarning = null;
    const clientId = env.OPENSKY_CLIENT_ID;
    const clientSecret = env.OPENSKY_CLIENT_SECRET;
    const authRequired = String(env.OPENSKY_AUTH_REQUIRED ?? 'false').toLowerCase() === 'true';

    if ((clientId && !clientSecret) || (!clientId && clientSecret)) {
      return new Response(
        'Worker misconfigured: set both OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET',
        {
          status: 500,
          headers: CORS_HEADERS,
        },
      );
    }

    if (clientId && clientSecret) {
      try {
        const token = await getToken(clientId, clientSecret);
        headers['Authorization'] = `Bearer ${token}`;
      } catch (e) {
        if (authRequired) {
          return new Response(`Auth error: ${e.message}`, { status: 502, headers: CORS_HEADERS });
        }
        authWarning = `OpenSky token unavailable (${e.message}), continuing unauthenticated`;
      }
    }

    let upstreamResp;
    try {
      upstreamResp = await fetch(targetUrl, { headers });
    } catch (e) {
      return new Response(`Upstream fetch error: ${e.message}`, {
        status: 502,
        headers: CORS_HEADERS,
      });
    }

    // Forward rate-limit headers so the app can react
    const responseHeaders = {
      ...CORS_HEADERS,
      'Content-Type': upstreamResp.headers.get('Content-Type') ?? 'application/json',
    };

    const rateLimitRemaining = upstreamResp.headers.get('X-Rate-Limit-Remaining');
    const retryAfter = upstreamResp.headers.get('X-Rate-Limit-Retry-After-Seconds');
    if (rateLimitRemaining) responseHeaders['X-Rate-Limit-Remaining'] = rateLimitRemaining;
    if (retryAfter) responseHeaders['X-Rate-Limit-Retry-After-Seconds'] = retryAfter;
    if (authWarning) responseHeaders['X-Auth-Warning'] = authWarning;

    const body = upstreamResp.status === 204 ? null : await upstreamResp.text();

    return new Response(body, {
      status: upstreamResp.status,
      headers: responseHeaders,
    });
  },
};
