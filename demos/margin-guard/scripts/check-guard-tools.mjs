// Smoke test: runs guard-tools.pipe on the dev engine and exercises every
// Redis tool plus the audit-log database. Run from the workspace root:
//   node --env-file=.env scripts/check-guard-tools.mjs
import { readFileSync } from 'node:fs';
import { RocketRideClient } from 'rocketride';

const pipeline = JSON.parse(readFileSync('apps/margin-guard/src/pipelines/guard-tools.pipe', 'utf8'));
const client = new RocketRideClient();
await client.connect();
const { token } = await client.use({ pipeline, useExisting: true });
const redis = (tool, input) => client.tool({ token, tool: `redis_${tool}`, nodeId: 'redis_1', input });
const show = (label, v) => console.log(label.padEnd(22), JSON.stringify(v));

const k = `selftest:${Date.now()}`;
show('set NX ttl=60', await redis('set', { key: k, value: 'hello', ttl_seconds: 60, condition: 'NX' }));
show('set NX again', await redis('set', { key: k, value: 'again', ttl_seconds: 60, condition: 'NX' }));
show('get', await redis('get', { key: k }));
show('ttl', await redis('ttl', { key: k }));
show('expire 30', await redis('expire', { key: k, ttl_seconds: 30 }));
show('incr +2500', await redis('incr', { key: `${k}:n`, amount: '2500' }));
show('incr +1', await redis('incr', { key: `${k}:n` }));
show('scan', await redis('scan', { cursor: '0', count: 100 }));
show('delete', await redis('delete', { keys: [k, `${k}:n`] }));

const q = (sql, params) => client.database.query({ token, nodeId: 'db_postgres_1', sql, params });
show('db select 1', await q('SELECT 1 AS ok'));
await client.disconnect();
process.exit(0);
