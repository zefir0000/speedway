import { loadConfig } from '../server/config.mjs';
import { createPool, migrate } from '../server/repository.mjs';
const pool = createPool(loadConfig());
try { await migrate(pool);
    console.log('MySQL schema ready') } finally { await pool.end() }