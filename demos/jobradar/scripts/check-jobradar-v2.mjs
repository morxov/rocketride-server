// Smoke tests for JobRadar v2 pipelines. Run from the workspace root:
//   node --env-file=.env scripts/check-jobradar-v2.mjs profile [resume.pdf]
//   node --env-file=.env scripts/check-jobradar-v2.mjs writer
//   node --env-file=.env scripts/check-jobradar-v2.mjs assistant "question"
// Each restarts its pipeline so .pipe edits take effect.
import { readFileSync } from 'node:fs';
// `rocketride` is the workspace's vendored client, installed by `rocketride init` (see ../README.md).
// eslint-disable-next-line n/no-missing-import
import { RocketRideClient, Question } from 'rocketride';
const [which = 'profile', arg] = process.argv.slice(2);
const pipeline = JSON.parse(readFileSync(`apps/jobradar-ui/src/pipelines/${which}.pipe`, 'utf8'));
const client = new RocketRideClient();
await client.connect();
const restart = process.env.RESTART !== '0';
const old = await client.use({ pipeline, useExisting: true });
if (restart) await client.terminate(old.token);
const { token } = restart ? await client.use({ pipeline }) : old;
const t = Date.now();
let res;
if (which === 'profile') {
	const file = arg ?? 'scripts/fixtures/sample-resume.pdf';
	res = await client.send(token, new Uint8Array(readFileSync(file)), { name: 'resume.pdf' }, 'application/pdf');
} else {
	const q = new Question();
	const fitTask = {
		task: 'fit',
		profile: {
			skills: ['Python', 'React', 'SQL'],
			evidence: ['Built a React dashboard used by 200 students', 'Python data pipeline for lab sensor data'],
		},
		job: {
			title: 'Software Engineer Intern',
			company: 'Ramp',
			description:
				'Requirements: Python or TypeScript, experience building web apps, SQL, curiosity. ' +
				'Nice to have: Go, distributed systems.',
		},
	};
	q.addQuestion(which === 'writer' ? JSON.stringify(fitTask) : (arg ?? 'What are my best new matches today?'));
	res = await client.chat({ token, question: q });
}
console.log(`${((Date.now() - t) / 1000).toFixed(1)}s`, Object.keys(res ?? {}));
for (const k of ['answers', 'text']) {
	if (!res?.[k]) continue;
	const text = Array.isArray(res[k]) ? res[k].join('\n') : String(res[k]);
	console.log(`--- ${k}:`, text.slice(0, 1500));
}
await client.disconnect(); process.exit(0);
