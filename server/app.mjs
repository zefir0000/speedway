import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { sessions } from './session.mjs';
import { api } from './http-api.mjs';
import { createPool, migrate, repository } from './repository.mjs';
import { connectRedis, RedisStore } from './redis-store.mjs';
import { Realtime } from './realtime.mjs';
import { tracks } from './engine.mjs';
const files = new Set(['index.html', 'style.css', 'tracks.js', 'gp-engine.js', 'gp-ui.js', 'online-race.js', 'online-smoothing.js', 'online-ws-ui.js', 'game.js']);
const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value))
};
async function readBody(req, limit) {
    if (!(req.headers['content-type'] || '').toLowerCase().includes('application/json')) throw Object.assign(Error('Nieprawidłowy format.'), { status: 415 });
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) throw Object.assign(Error('Za dużo danych.'), { status: 413 });
        chunks.push(chunk)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString()) } catch { throw Object.assign(Error('Nieprawidłowe dane.'), { status: 400 }) }
}
export async function createApp({ config, pool, redis, store, repo, now, onFatal } = {}) {
    const ownPool = !pool,
        ownRedis = !redis;
    pool = pool?? createPool(config);
    repo = repo?? repository(pool);
    if (ownPool) await migrate(pool);
    redis = redis?? connectRedis(config);
    if (!redis.isOpen) await redis.connect();
    store = store?? new RedisStore(redis, config.redisPrefix);
    const session = sessions(config),
        assets = new Map();
    for (const file of files) assets.set(file, await readFile(new URL('../dist/client/' + file,
        import.meta.url)));
    const server = createServer(async(req, res) => {
        try {
            const url = new URL(req.url, config.publicOrigin);
            if (url.pathname === '/healthz') { json(res, 200, { up: true, transport: 'websocket', redisReady: redis.isReady, lease: Date.now() < store.leaseUntil }); return }
            if (url.pathname === '/readyz') {
                if (!redis.isReady || Date.now() > store.leaseUntil) throw Error('Redis unavailable');
                await repo.health();
                json(res, 200, { ready: true });
                return
            }
            const owner = session.get(req, res);
            if (url.pathname === '/api/config') { json(res, 200, { transport: 'websocket', path: '/ws' }); return }
            if (url.pathname.startsWith('/api/online/')) { json(res, 426, { error: 'Ta wersja gry korzysta z WebSocket. Otwórz stronę ponownie.' }); return }
            if (url.pathname.startsWith('/api/')) {
                if (req.method === 'POST' && req.headers.origin && req.headers.origin !== config.publicOrigin) { json(res, 403, { error: 'Niedozwolone źródło.' }); return }
                const body = req.method === 'POST' ? await readBody(req, url.pathname === '/api/campaign' ? 150000 : 5000) : null;
                json(res, 200, await api(req, owner, body, repo, tracks));
                return
            }
            const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
            if (!files.has(file)) { json(res, 404, { error: 'Nie znaleziono strony.' }); return }
            if (!['GET', 'HEAD'].includes(req.method)) { json(res, 405, { error: 'Niedozwolona metoda.' }); return }
            res.writeHead(200, { 'Content-Type': file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
            res.end(req.method === 'HEAD' ? undefined : assets.get(file));
        } catch (e) {
            console.error('[API Error]', e);
            json(res, e.status || 503, { error: e.status ? e.message : 'Zapis chwilowo niedostępny. Spróbuj ponownie.' })
        }
    });
    server.headersTimeout = 10000;
    server.requestTimeout = 15000;
    const realtime = new Realtime({ config, store, repo, session, ...(onFatal ? { onFatal } : {}), ...(now ? { now } : {}) });
    try { await realtime.start(server) } catch (e) { if (ownRedis) redis.destroy(); if (ownPool) await pool.end(); throw e }
    return {
        server,
        realtime,
        store,
        repo,
        pool,
        redis,
        async listen() {
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(config.port, config.host, resolve)
            });
            return server.address()
        },
        async close() {
            await realtime.close();
            await new Promise(resolve => server.close(resolve));
            await store.close();
            if (ownPool) await pool.end()
        }
    };
}