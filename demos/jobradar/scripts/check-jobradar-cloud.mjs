// Live checks against the deployment account, without printing resolved configs or credentials.
import { readFileSync } from 'node:fs';
import { RocketRideClient, Question } from 'rocketride';
const client = new RocketRideClient({ uri: process.env.ROCKETRIDE_DEPLOY_URI, env: {}, persist: false });
try {
	await client.connect(process.env.ROCKETRIDE_DEPLOY_APIKEY);
	for (const name of ['profile', 'writer', 'assistant', 'jobradar-tools', 'email']) {
		const pipeline = JSON.parse(readFileSync(`apps/jobradar-ui/src/pipelines/${name}.pipe`, 'utf8'));
		if (name === 'email')
			pipeline.components.find((node) => node.provider === 'tool_gmail').config.userToken = JSON.stringify({
				access_token: 'schema-check-only',
				scope: 'https://www.googleapis.com/auth/gmail.readonly',
			});
		const result = await client.validate({ pipeline });
		console.log(name, 'validation', JSON.stringify({ errors: result.errors, warnings: result.warnings }));
		if (result.errors?.length || result.warnings?.length) throw Error(`${name} did not validate cleanly`);
	}
	const pipeline = JSON.parse(readFileSync('apps/jobradar-ui/src/pipelines/writer.pipe', 'utf8'));
	const { token } = await client.use({ pipeline, useExisting: true, ttl: 600 });
	const source = [
		'Jordan Lee',
		'jordan@example.com',
		'Education: BS Computer Science, May 2027',
		'Project: Built a React dashboard used by 200 students.',
		'Experience: Python data pipeline for lab sensor data.',
		'Skills: Python, React, SQL.',
	].join('\n');
	const q = new Question();
	q.addQuestion(
		JSON.stringify({
			task: 'resume',
			source_resume: source,
			job: {
				title: 'Software Engineer Intern',
				company: 'Example',
				description: 'Requires React, Python and SQL. Go is a plus.',
			},
		})
	);
	const result = await client.chat({ token, question: q });
	const answer = String(result.answers?.at(-1) ?? '');
	const value = JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1));
	if (
		!value.resume?.includes('Jordan') ||
		!value.resume.includes('200') ||
		!Array.isArray(value.changes) ||
		!Array.isArray(value.gaps)
	)
		throw Error('Tailored resume response failed checks');
	console.log('Cloud resume generation passed; changes:', value.changes.length, 'gaps:', value.gaps.length);
	const email = new Question();
	email.addQuestion(
		JSON.stringify({
			task: 'mail',
			email: {
				from: 'Recruiter at Example',
				subject: 'Interview for Software Engineer Intern',
				text: 'We would like to invite you to interview for the Software Engineer Intern role at Example.',
			},
			application: { title: 'Software Engineer Intern', company: 'Example', status: 'applied' },
		})
	);
	const mail = await client.chat({ token, question: email });
	const mailAnswer = String(mail.answers?.at(-1) ?? '');
	const classification = JSON.parse(mailAnswer.slice(mailAnswer.indexOf('{'), mailAnswer.lastIndexOf('}') + 1));
	if (classification.suggested_status !== 'interview') throw Error('Email classification failed');
	console.log('Cloud email classification passed: interview');
	const data = JSON.parse(await client.fsReadString('.jobradar/v1/user.json'));
	console.log('Cloud migrated user data:', Object.keys(data).length, 'records');
} finally {
	await client.disconnect();
}
process.exit();
