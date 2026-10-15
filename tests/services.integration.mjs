import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import WebSocket from 'ws';
import { loadConfig } from '../server/config.mjs';
import { createPool, migrate, repository } from '../server/repository.mjs';
import { createApp } from '../server/app.mjs';
import { connectRedis, RedisStore } from '../server/redis-store.mjs';
const root = new URL('../',
        import.meta.url),
    read = file => fs.readFileSync(new URL(file, root), 'utf8');
const delay = ms => new Promise(r => setTimeout(r, ms)),
    settle = () => new Promise(r => setImmediate(r));

function element() {
    const classes = new Set(),
        children = new Map();
    return {
        children: [],
        dataset: {},
        style: { setProperty() {} },
        classList: {
            add(...xs) { xs.forEach(x => classes.add(x)) },
            remove(...xs) { xs.forEach(x => classes.delete(x)) },
            contains: x => classes.has(x),
            toggle(x, v) {
                if (v === undefined) v = !classes.has(x);
                v ? classes.add(x) : classes.delete(x);
                return v
            }
        },
        setAttribute() {},
        addEventListener() {},
        append(...xs) { this.children.push(...xs) },
        replaceChildren(...xs) { this.children = xs },
        querySelector: s => children.get(s) || (children.set(s, element()), children.get(s)),
        getBoundingClientRect: () => ({ width: 844, height: 390 }),
        getContext: () => new Proxy({}, { get: () => () => {} })
    }
}
async function peer(origin, cookie, ticket = crypto.randomUUID() + '-' + crypto.randomUUID()) {
    const socket = new WebSocket(origin.replace('http:', 'ws:') + '/ws', { headers: { origin, cookie } }),
        messages = [],
        pending = new Map();
    let seq = 0;
    socket.on('message', raw => {
        const m = JSON.parse(raw);
        messages.push(m);
        if (m.id && pending.has(m.id)) {
            const p = pending.get(m.id);
            pending.delete(m.id);
            clearTimeout(p.timer);
            m.type === 'error' ? p.reject(Object.assign(Error(m.error), { status: m.status })) : p.resolve(m.data)
        }
    });
    await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject)
    });
    socket.send(JSON.stringify({ type: 'hello', ticket }));
    const wait = async predicate => {
        for (let n = 0; n < 300; n++) {
            const found = messages.find(predicate);
            if (found) return found;
            await delay(5)
        }
        throw Error('WebSocket message timeout')
    };
    await wait(m => m.type === 'welcome');
    return {
        socket,
        ticket,
        messages,
        wait,
        request(route, body) {
            return new Promise((resolve, reject) => {
                const id = ++seq,
                    timer = setTimeout(() => reject(Error('RPC timeout')), 2000);
                pending.set(id, { resolve, reject, timer });
                socket.send(JSON.stringify({ type: 'request', id, route, body }))
            })
        }
    };
}

test('real Redis + MySQL + WebSocket + browser client races', { skip: process.env.INTEGRATION !== '1', timeout: 60000 }, async() => {
    const database = process.env.TEST_MYSQL_DATABASE || 'speedway_test';
    assert.ok(database.endsWith('_test'), 'Use a dedicated *_test database');
    const config = loadConfig({ PUBLIC_ORIGIN: 'http://127.0.0.1:3000', SESSION_SECRET: 'test-only-secret-'.repeat(3), MYSQL_HOST: process.env.TEST_MYSQL_HOST || '127.0.0.1', MYSQL_PORT: process.env.TEST_MYSQL_PORT || '3306', MYSQL_USER: process.env.TEST_MYSQL_USER || 'root', MYSQL_PASSWORD: process.env.TEST_MYSQL_PASSWORD || '', MYSQL_DATABASE: database, REDIS_URL: process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379', REDIS_PREFIX: 'speedway-test:' + randomUUID() + ':', PORT: '0' });
    let now = Date.now(),
        sqlUnavailable = false,
        app;
    const pool = createPool(config),
        base = repository(pool),
        repo = {...base, async saveMatch(result) { if (sqlUnavailable) throw Error('Injected MySQL outage'); return base.saveMatch(result) } };
    await migrate(pool);
    const redis = connectRedis(config);
    await redis.connect();
    const store = new RedisStore(redis, config.redisPrefix),
        clients = [];
    try {
        app = await createApp({ config, pool, redis, store, repo, now: () => now });
        const address = await app.listen();
        config.publicOrigin = `http://127.0.0.1:${address.port}`;
        const origin = config.publicOrigin;
        const getCookie = async() => {
            const response = await fetch(origin + '/');
            assert.ok((await response.text()).includes('online-ws-ui.js'));
            return response.headers.get('set-cookie').split(';')[0]
        };
        const cookies = await Promise.all(Array.from({ length: 4 }, getCookie));
        class Clock extends Date { static now() { return now } }
        for (let i = 0; i < 4; i++) {
            const nodes = {},
                controls = Array.from({ length: 4 }, element),
                cookie = cookies[i],
                storage = new Map(),
                connections = [];
            class BrowserSocket extends WebSocket {
                constructor(url) {
                    super(url, { headers: { origin, cookie } });
                    connections.push(this)
                }
            }
            const c = { Date: Clock, performance: { now: () => now }, URLSearchParams, crypto: crypto.webcrypto, console, AbortController, WebSocket: BrowserSocket, location: { protocol: 'http:', host: `127.0.0.1:${address.port}`, search: '' }, document: { body: element(), getElementById: id => nodes[id] || (nodes[id] = element()), querySelectorAll: s => s === '[data-rider]' ? controls : [], createElement: element, createElementNS: element, addEventListener() {} }, window: { devicePixelRatio: 2, addEventListener() {} }, navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }, ResizeObserver: class { observe() {} }, requestAnimationFrame() {}, setTimeout, clearTimeout, setInterval, clearInterval, fetch: (url, options = {}) => fetch(origin + url, {...options, headers: {...options.headers, cookie, origin } }) };
            vm.createContext(c);
            for (const file of['tracks.js', 'gp-engine.js', 'gp-ui.js', 'online-race.js', 'online-smoothing.js', 'online-ws-ui.js', 'game.js']) vm.runInContext(read('web/' + file), c);
            vm.runInContext(`playerNames[0]='Phone ${i}';GPUI.setMode('online');OnlineUI.launch()`, c);
            clients.push({ c, nodes, controls, storage, cookie, connections });
        }
        for (let i = 0; i < 100 && !clients.every(cl => app.realtime.clients.size === 4 && [...app.realtime.clients.values()].every(ws => ws.waiting)); i++) await delay(10);
        await app.realtime.matchmaking();
        await delay(20);
        assert.equal(app.realtime.rooms.size, 1);
        const room = [...app.realtime.rooms.values()][0],
            matchId = room.id;
        assert.equal(new Set(clients.map(cl => vm.runInContext('racers[0].gate', cl.c))).size, 4);
        assert.equal(new Set(clients.map(cl => vm.runInContext('trackId', cl.c))).size, 1);
        assert.ok(clients.every(cl => vm.runInContext('state', cl.c) === 'red'));
        assert.ok(room.world.racers.every(r => !r.isBot));
        // Choose the same racing line for all clients, using only their rendered bike.
        const controllers = clients.map(cl => vm.runInContext(`()=>{if(!['racing','finishing'].includes(state)||!racers.length)return;const r=racers[0];if(!r.started){pressRider(0,'launch');releaseInput('launch');return}if(r.finish!==null||r.eliminated)return;const radius=REFERENCE,phase=trackPhase(r.x,r.y,radius),aim=trackPoint(phase/TAU*trackLength(radius)+40,radius),error=norm(Math.atan2(aim.y-r.y,aim.x-r.x)-r.angle),turn=error<-.025;if(turn&&!r.held)pressRider(0,'turn');else if(!turn&&r.held)releaseInput('turn')}`, cl.c));
        now = room.world.lightOffAt + 50;
        let trailingControls = false;
        sqlUnavailable = true;
        for (let frame = 0; frame < 60 * 150 && !clients.every(cl => vm.runInContext('state', cl.c) === 'result'); frame++) {
            now += 1000 / 60;
            if (frame % 60 === 0)
                for (const cl of clients) { const ws = cl.connections.at(-1); if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', clientAt: now })) }
            app.realtime.tick();
            if (frame % 3 === 0) app.realtime.broadcast();
            await settle();
            await settle();
            clients.forEach((cl, i) => {
                vm.runInContext('OnlineUI.tick(1/60)', cl.c);
                controllers[i]();
                if (vm.runInContext("state==='finishing'&&racers[0].finish===null&&!racers[0].eliminated", cl.c) && !cl.controls[0].disabled) trailingControls = true
            });
        }
        assert.equal(room.world.phase, 'result', 'Four real human controllers must finish');
        assert.equal(room.world.reason, 'finished');
        assert.ok(room.world.racers.every(r => r.finish !== null && !r.eliminated));
        assert.ok(trailingControls);
        await delay(30);
        assert.ok(clients.every(cl => vm.runInContext('state', cl.c) === 'result'));
        assert.equal(new Set(clients.map(cl => cl.nodes['podium-name'].textContent)).size, 1);
        await app.realtime.checkpoint();
        await assert.rejects(() => app.realtime.writeResults());
        sqlUnavailable = false;
        await app.realtime.writeResults();
        const [saved] = await pool.query('SELECT id FROM online_matches WHERE id=?', [matchId]);
        assert.equal(saved.length, 1);
        assert.equal((await pool.query('SELECT gate FROM online_match_riders WHERE match_id=?', [matchId]))[0].length, 4);
        // Idempotent replay from an outbox entry after lost acknowledgement.
        const result = { id: matchId, world: room.world, members: room.members.map(({ ownerId, gate }) => ({ ownerId, gate })), completedAt: now };
        await base.saveMatch(result);
        assert.equal((await pool.query('SELECT gate FROM online_match_riders WHERE match_id=?', [matchId]))[0].length, 4);
        const request = async(path, body, cookie = cookies[0]) => { const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { cookie, origin, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json() } };
        const campaign = vm.runInContext(`GP.create(crypto.randomUUID(),'Kampania','easy',levels.easy.skill)`, clients[0].c);
        let response = await request('/api/campaign', { campaign, revision: 0 });
        assert.equal(response.status, 200);
        assert.equal(response.data.revision, 1);
        assert.equal((await request('/api/campaign', { campaign, revision: 0 })).data.revision, 1);
        assert.equal((await request('/api/campaign?id=' + campaign.id)).data.campaign.id, campaign.id);
        assert.equal((await request('/api/campaign?id=' + campaign.id, null, cookies[1])).data.campaign, null);
        assert.equal((await request('/api/campaign', { campaign, revision: 1 }, cookies[1])).status, 404);
        const score = { id: randomUUID(), name: 'Żółty', time_ms: 50000, level: 'easy', players: 1, track: 'classic' };
        await request('/api/scores', { scores: [score] });
        await request('/api/scores', { scores: [score] });
        assert.equal((await pool.query('SELECT id FROM race_scores WHERE id=?', [score.id]))[0].length, 1);
        const records = await request('/api/scores?track=classic');
        assert.equal(records.data.scores.find(s => s.name === score.name)?.time_ms, score.time_ms);
        assert.equal((await request('/api/online/match', {})).status, 426);
        const intruder = await peer(origin, await getCookie());
        await assert.rejects(() => intruder.request('match', { matchId }), e => e.status === 403);
        intruder.socket.close();
        // Independent solo matchmaking, exact twenty-second bot fill and false-start elimination.
        const solo = await peer(origin, await getCookie());
        await solo.request('queue', { action: 'join', name: 'Solo' });
        await app.realtime.matchmaking();
        assert.equal(app.realtime.rooms.size, 1);
        for (let second = 0; second < 21; second++) {
            now += 1000;
            solo.socket.send(JSON.stringify({ type: 'ping', clientAt: now }));
            await settle();
            await settle();
            await app.realtime.matchmaking();
            if (solo.messages.some(m => m.type === 'matched')) break
        }
        const matched = await solo.wait(m => m.type === 'matched');
        let state = await solo.request('match', { matchId: matched.matchId });
        assert.equal(state.world.racers.filter(r => r.isBot).length, 3);
        state = await solo.request('match', { matchId: matched.matchId, commands: [{ seq: 1, action: 'press' }] });
        assert.equal(state.world.racers[state.gate].eliminated, true);
        assert.equal(state.world.racers.filter(r => r.eliminated).length, 1);
        solo.socket.close();
        await delay(20);
        const returning = await peer(origin, cookies[0]);
        await returning.request('queue', { action: 'join', name: 'Rejoin' });
        for (let second = 0; second < 21; second++) {
            now += 1000;
            returning.socket.send(JSON.stringify({ type: 'ping', clientAt: now }));
            await settle();
            await settle();
            await app.realtime.matchmaking();
            if (returning.messages.some(m => m.type === 'matched')) break
        }
        const returnMatch = (await returning.wait(m => m.type === 'matched')).matchId;
        const returnState = await returning.request('match', { matchId: returnMatch });
        now += 5100;
        app.realtime.tick();
        assert.equal(app.realtime.rooms.get(returnMatch).world.racers[returnState.gate].disconnected, true, 'A silent open socket must yield to a bot after five seconds');
        returning.socket.send(JSON.stringify({ type: 'ping', clientAt: now }));
        await settle();
        await settle();
        app.realtime.tick();
        assert.equal(app.realtime.rooms.get(returnMatch).world.racers[returnState.gate].auto, false, 'Fresh contact must reclaim control');
        returning.socket.close();
        await delay(20);
        now += 5100;
        app.realtime.tick();
        assert.equal(app.realtime.rooms.get(returnMatch).world.racers[returnState.gate].disconnected, true);
        const resumed = await peer(origin, cookies[0], returning.ticket);
        const resumedState = await resumed.request('match', { matchId: returnMatch });
        assert.equal(resumedState.gate, returnState.gate);
        assert.equal(resumedState.world.racers[returnState.gate].auto, false);
        await assert.rejects(() => resumed.request('match', { matchId: returnMatch, commands: [{ seq: 2, action: 'press' }] }), e => e.status === 409);
        await resumed.request('match', { matchId: returnMatch, commands: [{ seq: 1, action: 'press' }] });
        assert.equal((await resumed.request('match', { matchId: returnMatch, commands: [{ seq: 1, action: 'press' }] })).ack, 1);
        resumed.socket.close();
        await delay(20);
        const competing = connectRedis(config);
        await competing.connect();
        await assert.rejects(() => new RedisStore(competing, config.redisPrefix).initialize(), /Another Speedway/);
        await competing.close();
        const eight = await Promise.all(Array.from({ length: 8 }, async(_, i) => ({ client: await peer(origin, await getCookie()), name: 'Group ' + i })));
        await Promise.all(eight.map(p => p.client.request('queue', { action: 'join', name: p.name })));
        await app.realtime.matchmaking();
        const groups = new Map();
        for (const p of eight) {
            const matched = await p.client.wait(m => m.type === 'matched'),
                state = await p.client.request('match', { matchId: matched.matchId });
            groups.set(matched.matchId, (groups.get(matched.matchId) || 0) + 1);
            assert.ok(state.world.racers.every(r => !r.isBot));
            p.client.socket.close()
        }
        assert.deepEqual([...groups.values()].sort(), [4, 4]);
        const cancelled = await peer(origin, await getCookie());
        await cancelled.request('queue', { action: 'join', name: 'Cancel' });
        assert.equal((await cancelled.request('queue', { action: 'cancel' })).state, 'cancelled');
        cancelled.socket.close();
        assert.equal(await redis.zCard(store.key('waiting')), 0);
        const before = app.realtime.metrics.ticks,
            blocker = await pool.getConnection(),
            blocked = blocker.query('SELECT SLEEP(0.3)');
        await delay(110);
        assert.ok(app.realtime.metrics.ticks - before >= 8, 'MySQL query must not block the physics loop');
        await blocked;
        blocker.release();
        const raceMetrics = {...app.realtime.metrics };
        await app.realtime.checkpoint();
        const persisted = await store.room(returnMatch);
        assert.equal(persisted.id, returnMatch);
        const prefix = config.redisPrefix;
        await app.close();
        app = null;
        const newRedis = connectRedis(config);
        await newRedis.connect();
        const newStore = new RedisStore(newRedis, prefix);
        let fatalCount = 0;
        app = await createApp({ config, pool, redis: newRedis, store: newStore, repo, now: () => now, onFatal: () => fatalCount++ });
        const newAddress = await app.listen();
        config.publicOrigin = `http://127.0.0.1:${newAddress.port}`;
        assert.ok(app.realtime.rooms.has(returnMatch));
        const restored = await peer(config.publicOrigin, cookies[0], returning.ticket);
        const restoredState = await restored.request('match', { matchId: returnMatch });
        assert.equal(restoredState.gate, returnState.gate);
        assert.equal(restoredState.ack, 1);
        restored.socket.close();
        newStore.leaseUntil = Date.now() - 1;
        app.realtime.tick();
        assert.equal(fatalCount, 1, 'Expired Redis ownership must trigger server restart');
        console.log('Four WS browser clients completed real laps, common podium, 20-second bot fill, false starts, MySQL ownership/idempotency, Redis outbox retry, single-owner fence and nonblocking SQL passed', raceMetrics);
    } finally {
        clients.forEach(cl => vm.runInContext('OnlineUI.back()', cl.c));
        if (app) await app.close();
        else redis.destroy();
        await pool.end()
    }
});