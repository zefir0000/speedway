import mysql from 'mysql2/promise';
import { readdir, readFile } from 'node:fs/promises';
export function createPool(config) { return mysql.createPool(config.mysql) }
export async function migrate(pool) {
    const conn = await pool.getConnection();
    try {
        const [lock] = await conn.query("SELECT GET_LOCK('speedway_schema_migrations',10) AS acquired");
        if (lock[0].acquired !== 1) throw Error('Migration lock unavailable');
        await conn.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(100) PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB');
        const dir = new URL('./mariadb/',
            import.meta.url);
        for (const file of(await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) {
            if ((await conn.query('SELECT name FROM schema_migrations WHERE name=?', [file])).length) continue;
            const sql = await readFile(new URL(file, dir), 'utf8');
            for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await conn.query(statement);
            await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
        }
    } finally { try { await conn.query("SELECT RELEASE_LOCK('speedway_schema_migrations')") } finally { conn.release() } }
}
export function repository(pool) {
    async function transaction(work) {
        const c = await pool.getConnection();
        try {
            await c.beginTransaction();
            const result = await work(c);
            await c.commit();
            return result
        } catch (error) { await c.rollback(); throw error } finally { c.release() }
    }
    return {
        async scores({ track, level, players }) {
            let sql = 'SELECT name,time_ms,level,players,track FROM race_scores WHERE rules=5 AND track=?',
                args = [track];
            if (level) {
                sql += ' AND level=?';
                args.push(level)
            }
            if (players) {
                sql += ' AND players=?';
                args.push(players)
            }
            return pool.query(sql + ' ORDER BY time_ms,created_at LIMIT 20', args)
        },
        async saveScores(owner, entries) { await transaction(async c => { for (const s of entries) await c.query('INSERT IGNORE INTO race_scores (id,owner_id,name,time_ms,level,players,track,rules) VALUES (?,?,?,?,?,?,?,5)', [s.id, owner, s.name, s.time_ms, s.level, s.players, s.track]) }) },
        async campaign(owner, id) { const rows = id ? await pool.query('SELECT state,revision FROM gp_campaigns WHERE owner_id=? AND id=?', [owner, id]) : await pool.query('SELECT state,revision FROM gp_campaigns WHERE owner_id=? ORDER BY updated_at DESC LIMIT 1', [owner]); return { campaign: rows.length ? JSON.parse(rows[0].state) : null, revision: rows[0]?.revision ?? 0 } },
        async saveCampaign(owner, state, revision) {
            const payload = JSON.stringify(state);
            console.log('[saveCampaign] Starting transaction for owner:', owner, 'id:', state.id, 'revision:', revision);
            return transaction(async c => {
                console.log('[saveCampaign] Querying campaign for id:', state.id);
                const rows = await c.query('SELECT owner_id,state,revision FROM gp_campaigns WHERE id=? FOR UPDATE', [state.id]);
                const row = rows[0];
                console.log('[saveCampaign] Row:', row ? 'found' : 'not found');
                if (row && row.owner_id !== owner) throw Object.assign(Error('Nie znaleziono Twojej kampanii.'), { status: 404 });
                if (row?.state === payload) return row.revision;
                if ((row?.revision ?? 0) !== revision) throw Object.assign(Error('Zapis kampanii został zmieniony. Wczytaj aktualny sezon.'), { status: 409 });
                const next = revision + 1;
                console.log('[saveCampaign] Saving with revision:', next);
                if (row) await c.query('UPDATE gp_campaigns SET state=?,revision=?,updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND owner_id=?', [payload, next, state.id, owner]);
                else await c.query('INSERT INTO gp_campaigns (id,owner_id,state,revision) VALUES (?,?,?,?)', [state.id, owner, payload, next]);
                console.log('[saveCampaign] Saved successfully');
                return next;
            })
        },
        async saveMatch(result) {
            return transaction(async c => {
                const inserted = await c.query('INSERT IGNORE INTO online_matches (id,track,started_at,completed_at,reason,result) VALUES (?,?,?,?,?,?)', [result.id, result.world.track, new Date(result.world.lightOffAt), new Date(result.completedAt), result.world.reason, JSON.stringify(result)]);
                if (!inserted.affectedRows) return;
                const ordered = [...result.world.racers].sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || (a.finish ?? Infinity) - (b.finish ?? Infinity) || b.progress - a.progress);
                for (const r of result.world.racers) await c.query('INSERT INTO online_match_riders (match_id,gate,owner_id,name,is_bot,eliminated,finish_ms,position) VALUES (?,?,?,?,?,?,?,?)', [result.id, r.gate, result.members.find(m => m.gate === r.gate)?.ownerId ?? null, r.name, r.isBot, r.eliminated, r.finish === null ? null : Math.round(r.finish * 1000), ordered.findIndex(p => p.gate === r.gate) + 1]);
            })
        },
        async health() { await pool.query('SELECT 1') }
    };
}