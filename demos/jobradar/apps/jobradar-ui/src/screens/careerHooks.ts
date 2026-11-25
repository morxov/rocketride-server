import { changeCareer } from '../lib/store';
import type { CareerData } from '../lib/career';
import { useApp } from '../state';
export function useCareer() {
	const app = useApp();
	return {
		...app,
		async updateCareer(update: (current: CareerData) => CareerData) {
			if (!app.client) throw new Error('Connect to RocketRide first.');
			const career = await changeCareer(app.client, update);
			app.patchUser((current) => ({ ...current, career }));
		},
	};
}
