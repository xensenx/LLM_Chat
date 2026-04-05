/**
 * POST /api/chat
 * Proxies chat completion requests to NVIDIA NIM.
 * Supports both streaming (SSE) and non-streaming responses.
 * Keeps NVIDIA_NIM_API_KEY entirely server-side.
 */
export async function onRequestPost(context) {
  const apiKey = context.env.NVIDIA_NIM_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'NVIDIA_NIM_API_KEY environment variable is not set.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ── Parse request body ─────────────────────────────────
  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON in request body.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { model, messages, temperature, max_tokens, stream } = body;

  // ── Validate required fields ───────────────────────────
  if (!model || typeof model !== 'string') {
    return new Response(
      JSON.stringify({ error: '`model` field is required and must be a string.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(
      JSON.stringify({ error: '`messages` field is required and must be a non-empty array.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ── Build upstream payload ─────────────────────────────
  const payload = {
    model,
    messages,
    temperature: typeof temperature === 'number' ? temperature : 0.7,
    max_tokens:  typeof max_tokens  === 'number' ? max_tokens  : 1024,
    stream:      stream !== false, // default to streaming
  };

  // ── Forward to NVIDIA NIM ──────────────────────────────
  try {
    const upstream = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: payload.stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return new Response(errText, {
        status: upstream.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // ── Stream passthrough ─────────────────────────────
    if (payload.stream && upstream.body) {
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no', // disable nginx buffering if present
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // ── Non-stream passthrough ─────────────────────────
    const responseBody = await upstream.text();
    return new Response(responseBody, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Upstream request failed', detail: err.message }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/** Handle CORS preflight */
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
