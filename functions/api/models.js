/**
 * GET /api/models
 * Proxies NVIDIA NIM model list — keeps API key server-side.
 * Optionally protected by APP_PASSWORD env variable (checked via X-App-Password header).
 */
export async function onRequestGet(context) {
  const apiKey = context.env.NVIDIA_NIM_API_KEY;
  const appPassword = context.env.APP_PASSWORD;

  if (!apiKey) {
    return jsonError(500, 'NVIDIA_NIM_API_KEY is not configured on the server.');
  }

  // ── App-level password gate ──────────────────────────────
  if (appPassword) {
    const provided = context.request.headers.get('X-App-Password') || '';
    if (provided !== appPassword) {
      return jsonError(401, 'Unauthorized: invalid app password.');
    }
  }

  let upstream;
  try {
    upstream = await fetch('https://integrate.api.nvidia.com/v1/models', {
      method: 'GET',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    return jsonError(502, `Could not reach NVIDIA NIM: ${err.message}`);
  }

  if (!upstream.ok) {
    const errBody = await upstream.text();
    let parsed;
    try { parsed = JSON.parse(errBody); } catch { parsed = { error: { message: errBody } }; }
    return new Response(JSON.stringify(parsed), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const body = await upstream.text();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type':  'application/json',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-App-Password',
    },
  });
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
