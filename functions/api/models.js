/**
 * GET /api/models
 * Proxies NVIDIA NIM model list — keeps API key server-side.
 */
export async function onRequestGet(context) {
  const apiKey = context.env.NVIDIA_NIM_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'NVIDIA_NIM_API_KEY environment variable is not set.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const upstream = await fetch('https://integrate.api.nvidia.com/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    const body = await upstream.text();

    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300', // cache 5 min
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch models', detail: err.message }),
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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
