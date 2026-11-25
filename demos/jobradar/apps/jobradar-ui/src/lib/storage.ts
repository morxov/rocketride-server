/** Account-scoped RocketRide file storage. No database node is required.
 * One active app page per account: saves are serialized here, not across devices.
 */
import type { RocketRideClient } from 'rocketride';

export type Namespace = 'jobs' | 'user' | 'seen';
export interface StoredValue {
	value: string;
	expires: number;
}
type Snapshot = Record<string, StoredValue>;
const sessions = new WeakMap<RocketRideClient, Map<Namespace, ReturnType<typeof openStore>>>();
export const storagePath = (namespace: Namespace) => `.jobradar/v1/${namespace}.json`;

function openStore(client: RocketRideClient, namespace: Namespace) {
	let data: Snapshot;
	const ready = client.fsReadString(storagePath(namespace)).then(
		(text) => {
			data = JSON.parse(text) as Snapshot;
		},
		(error: unknown) => {
			if (!/file not found|does not exist|ENOENT/i.test(String(error))) throw error;
			data = {};
		}
	);
	let tail: Promise<unknown> = ready;
	const current = (key: string) => {
		const row = data[key];
		return row && (!row.expires || row.expires > Date.now()) ? row : undefined;
	};
	const change = <T>(mutate: () => T): Promise<T> => {
		const next = tail.then(async () => {
			await ready;
			const previous = data;
			data = { ...data };
			for (const key of Object.keys(data)) if (!current(key)) delete data[key];
			try {
				const result = mutate();
				// Streaming calls work on the current cloud engine, which predates fs_put_json.
				await client.fsWriteString(storagePath(namespace), JSON.stringify(data));
				return result;
			} catch (error) {
				data = previous;
				throw error;
			}
		});
		tail = next.catch(() => undefined);
		return next;
	};
	const r = {
		async get(key: string) {
			await tail;
			await ready;
			const row = current(key);
			return { key, found: !!row, value: row?.value ?? null, ttl_seconds: row ? (row.expires ? Math.max(1, Math.ceil((row.expires - Date.now()) / 1000)) : -1) : -2 };
		},
		set: (key: string, value: string, ttl: number, condition?: 'NX' | 'XX') =>
			change(() => {
				const found = !!current(key);
				const stored = !((condition === 'NX' && found) || (condition === 'XX' && !found));
				if (stored) data[key] = { value, expires: ttl > 0 ? Date.now() + ttl * 1000 : 0 };
				return { key, stored };
			}),
		expire: (key: string, ttl: number) =>
			change(() => {
				const row = current(key);
				if (row) data[key] = { ...row, expires: Date.now() + ttl * 1000 };
				return { updated: !!row };
			}),
		async ttl(key: string) {
			const row = await r.get(key);
			return { exists: row.found, ttl_seconds: row.ttl_seconds };
		},
		incr: (key: string, amount: number | string = 1) =>
			change(() => {
				const row = current(key);
				const value = (BigInt(row?.value ?? '0') + BigInt(amount)).toString();
				data[key] = { value, expires: row?.expires ?? 0 };
				return { value_decimal: value };
			}),
		delete: (keys: string[]) =>
			change(() => {
				let deleted_count = 0;
				for (const key of keys) {
					if (current(key)) deleted_count++;
					delete data[key];
				}
				return { deleted_count };
			}),
		async scanAll() {
			await tail;
			await ready;
			return Object.keys(data).filter((key) => !!current(key));
		},
		async getJson<T>(key: string): Promise<T | null> {
			const row = await r.get(key);
			return row.value ? (JSON.parse(row.value) as T) : null;
		},
		setJson: (key: string, value: unknown, ttl: number, condition?: 'NX' | 'XX') => r.set(key, JSON.stringify(value), ttl, condition),
		async deleteMany(keys: string[]) {
			return (await r.delete(keys)).deleted_count;
		},
	};
	return r;
}

export function dataStore(client: RocketRideClient, namespace: Namespace) {
	let stores = sessions.get(client);
	if (!stores) {
		stores = new Map();
		sessions.set(client, stores);
	}
	let store = stores.get(namespace);
	if (!store) {
		store = openStore(client, namespace);
		stores.set(namespace, store);
	}
	return store;
}
