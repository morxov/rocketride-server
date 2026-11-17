import { RocketRideClient } from 'rocketride';
const client = new RocketRideClient();
const created = await client.deploy.createApp('margin-guard', {
	template: 'Dashboard',
	displayName: 'AI Margin Guard',
	sidebar: true,
	statusFooter: true,
	onProgress: (l) => console.log(l),
});
console.log(JSON.stringify(created, null, 1));
process.exit(0);
