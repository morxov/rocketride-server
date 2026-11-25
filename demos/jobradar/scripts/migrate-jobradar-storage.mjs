// One-time, non-destructive migration. Run from demos/jobradar with --env-file=.env.
// Copies original Redis data to the local file store, and optionally to cloud.
import { readFileSync } from 'node:fs';
import { RocketRideClient } from 'rocketride';
const local = new RocketRideClient();
const cloud = process.argv.includes('--cloud')
	? new RocketRideClient({ uri: process.env.ROCKETRIDE_DEPLOY_URI, env: {}, persist: false })
	: null;
try {
	await local.connect();
	if (cloud) await cloud.connect(process.env.ROCKETRIDE_DEPLOY_APIKEY);
	const pipeline = JSON.parse(readFileSync('scripts/fixtures/original-redis.pipe', 'utf8'));
	const { token } = await local.use({ pipeline, useExisting: true, ttl: 600 });
	for (const namespace of ['jobs', 'user', 'seen']) {
		const snapshot = {};
		let cursor = '0';
		do {
			const result = await local.tool({
				token,
				nodeId: `redis_${namespace}`,
				tool: 'redis_scan',
				input: { cursor, count: 500 },
			});
			if (!result.success) throw new Error(result.error || 'Redis scan failed');
			for (let i = 0; i < result.keys.length; i += 4)
				await Promise.all(
					result.keys.slice(i, i + 4).map(async (key) => {
						const row = await local.tool({
							token,
							nodeId: `redis_${namespace}`,
							tool: 'redis_get',
							input: { key },
						});
						if (!row.success) throw new Error(row.error || 'Redis read failed');
						if (row.found)
							snapshot[key] = {
								value: row.value,
								expires: row.ttl_seconds > 0 ? Date.now() + row.ttl_seconds * 1000 : 0,
							};
					})
				);
			cursor = result.done ? '0' : result.cursor;
		} while (cursor !== '0');
		const path = `.jobradar/v1/${namespace}.json`;
		for (const target of [local, cloud].filter(Boolean)) {
			let existing = {};
			try {
				existing = JSON.parse(await target.fsReadString(path));
			} catch (e) {
				if (!/file not found|does not exist|ENOENT/i.test(String(e))) throw e;
			}
			const merged = { ...snapshot, ...existing };
			await target.fsWriteString(path, JSON.stringify(merged));
			const verify = JSON.parse(await target.fsReadString(path));
			if (JSON.stringify(verify) !== JSON.stringify(merged)) throw new Error(`Verification failed: ${namespace}`);
			console.log(
				namespace,
				target === local ? 'local' : 'cloud',
				`${Object.keys(merged).length} keys verified; destination values preserved`
			);
		}
	}
} finally {
	await local.disconnect();
	if (cloud) await cloud.disconnect();
}
process.exit();
