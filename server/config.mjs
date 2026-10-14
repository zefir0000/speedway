function integer(env, key, fallback, min, max) {
    const n = Number(env[key] ?? fallback);
    if (!Number.isInteger(n) || n < min || n > max) throw Error(`Invalid ${key}`);
    return n
}
export function loadConfig(env = process.env) {
    const publicOrigin = new URL(env.PUBLIC_ORIGIN || 'http://localhost:3000').origin;
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw Error('SESSION_SECRET must contain at least 32 characters');
    if (!env.MYSQL_USER || !env.MYSQL_DATABASE) throw Error('Set MYSQL_USER and MYSQL_DATABASE');
    const redisPrefix = env.REDIS_PREFIX || 'speedway:';
    if (!/^[a-zA-Z0-9:_-]{1,60}$/.test(redisPrefix)) throw Error('Invalid REDIS_PREFIX');
    return {
        host: env.HOST || '127.0.0.1',
        port: integer(env, 'PORT', 3000, 0, 65535),
        publicOrigin,
        sessionSecret: env.SESSION_SECRET,
        redisUrl: env.REDIS_URL || 'redis://127.0.0.1:6379',
        redisPrefix,
        queueWaitMs: 20000,
        disconnectGraceMs: 5000,
        snapshotHz: 20,
        checkpointMs: 1000,
        maxRooms: integer(env, 'MAX_ROOMS', 100, 1, 1000),
        maxConnections: integer(env, 'MAX_CONNECTIONS', 500, 4, 5000),
        mysql: {
            host: env.MYSQL_HOST || '127.0.0.1',
            port: integer(env, 'MYSQL_PORT', 3306, 1, 65535),
            user: env.MYSQL_USER,
            password: env.MYSQL_PASSWORD || '',
            database: env.MYSQL_DATABASE,
            connectionLimit: integer(env, 'MYSQL_POOL_SIZE', 5, 1, 20),
            connectTimeout: 3000,
            timezone: 'Z'
        }
    };
}