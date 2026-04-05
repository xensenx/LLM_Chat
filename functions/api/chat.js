/**
 * POST /api/chat
 * Proxies chat completions to NVIDIA NIM — keeps API key server-side.
 * Supports SSE streaming passthrough and structured error responses.
 */
export async function onRequestPost(context) {
  const apiKey = context.env.NVIDIA_NIM_API_KEY;

  if (!apiKey) {
    return jsonError(500, 'NVIDIA_NIM_API_KEY is not configured on the server.');
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonError(400, 'Invalid JSON in request body.');
  }

  const { model, messages, temperature, max_tokens, stream } = body;

  if (!model || typeof model !== 'string') {
    return jsonError(400, '`model` is required and must be a string.');
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError(400, '`messages` must be a non-empty array.');
  }

  const payload = {
    model,
    messages,
    temperature: typeof temperature === 'number' ? temperature : 0.7,
    max_tokens:  typeof max_tokens  === 'number' ? max_tokens  : 1024,
    stream:      stream !== false,
  };

  let upstream;
  try {
    upstream = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept:         payload.stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return jsonError(502, `Could not reach NVIDIA NIM: ${err.message}`);
  }

  // ── Pass error responses through with their body intact ──
  if (!upstream.ok) {
    const errBody = await upstream.text();
    // Try to normalise to JSON so the client can parse it
    let parsed;
    try { parsed = JSON.parse(errBody); } catch { parsed = { error: { message: errBody } }; }
    return new Response(JSON.stringify(parsed), {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // ── Stream passthrough ────────────────────────────────────
  if (payload.stream && upstream.body) {
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type':      'text/event-stream',
        'Cache-Control':     'no-cache',
        'Connection':        'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // ── Non-stream ────────────────────────────────────────────
  const responseBody = await upstream.text();
  return new Response(responseBody, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
