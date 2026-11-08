// Temporary audit probe, disabled after the 2026-11-08 security audit.
Deno.serve(() => new Response('gone', { status: 410 }));
