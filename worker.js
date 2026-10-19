// API de synchronisation de Chrono Todo (Cloudflare Worker + KV).
// Le serveur ne voit que des données chiffrées par l'app : l'identifiant et la clé de
// chiffrement sont dérivés du code de synchro, qui ne quitte jamais les appareils.
//
//   GET /api/sync/<id>?have=<rev>  → 200 (données, en-tête X-Rev) · 204 si inchangé · 404 si inconnu
//   PUT /api/sync/<id>             → 200 { rev } · 409 si l'en-tête X-Base-Rev n'est plus à jour
//
// Tout le reste (index.html, app.js…) est servi directement depuis ./public.

const MAX_BYTES = 20 * 1024 * 1024;
const ROUTE = /^\/api\/sync\/([0-9a-f]{64})$/;

const headers = (extra = {}) => ({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: headers({ 'content-type': 'application/json' }) });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(ROUTE);
    if (!m) return json({ error: 'introuvable' }, 404);
    if (!env.SYNC) return json({ error: 'stockage KV non configuré (binding SYNC)' }, 503);
    const key = m[1];

    if (request.method === 'GET') {
      const { value, metadata } = await env.SYNC.getWithMetadata(key, 'stream');
      if (value === null) return new Response(null, { status: 404, headers: headers() });
      const rev = metadata?.rev || '';
      if (url.searchParams.get('have') === rev) {
        value.cancel();
        return new Response(null, { status: 204, headers: headers({ 'x-rev': rev }) });
      }
      return new Response(value, { headers: headers({ 'content-type': 'application/octet-stream', 'x-rev': rev }) });
    }

    if (request.method === 'PUT') {
      if (Number(request.headers.get('content-length') || 0) > MAX_BYTES) return json({ error: 'trop volumineux' }, 413);
      const body = await request.arrayBuffer();
      if (!body.byteLength) return json({ error: 'vide' }, 400);
      if (body.byteLength > MAX_BYTES) return json({ error: 'trop volumineux' }, 413);

      // Contrôle de version : si un autre appareil a écrit entre-temps, l'app refusionne et réessaie.
      const current = await env.SYNC.getWithMetadata(key, 'stream');
      current.value?.cancel();
      const curRev = current.metadata?.rev || '';
      if (current.value !== null && curRev !== (request.headers.get('x-base-rev') || '')) {
        return json({ error: 'conflit', rev: curRev }, 409);
      }

      const rev = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
      try {
        await env.SYNC.put(key, body, { metadata: { rev, at: Date.now() } });
      } catch (e) {
        return json({ error: 'écriture impossible, réessaie plus tard' }, 503);
      }
      return json({ rev });
    }

    return json({ error: 'méthode non autorisée' }, 405);
  },
};
