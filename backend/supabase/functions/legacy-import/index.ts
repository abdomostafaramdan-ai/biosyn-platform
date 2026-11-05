// The one-off import from the old WordPress site (users, feedback screenshots, news/events images)
// is finished; this endpoint is disabled. The importer used a one-time code and the service role.
Deno.serve(() => new Response(JSON.stringify({ error: 'gone' }), { status: 410, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }));
