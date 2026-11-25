// Live cloud checks with fictional career data. Run from demos/jobradar.
import { readFileSync } from 'node:fs';
import { RocketRideClient, Question } from 'rocketride';
const client = new RocketRideClient({
	uri: process.env.ROCKETRIDE_DEPLOY_URI,
	env: {},
	persist: false,
});
try {
	await client.connect(process.env.ROCKETRIDE_DEPLOY_APIKEY);
	const pipeline = JSON.parse(readFileSync('apps/jobradar-ui/src/pipelines/writer.pipe', 'utf8'));
	const validation = await client.validate({ pipeline });
	console.log(
		'Writer validation',
		JSON.stringify({ errors: validation.errors, warnings: validation.warnings })
	);
	if (validation.errors?.length || validation.warnings?.length)
		throw Error('Writer did not validate cleanly');
	const { token } = await client.use({ pipeline, useExisting: true, ttl: 600 });
	const source = [
		'Jordan Lee. BS Computer Science, May 2027.',
		'Built a React dashboard used by 200 students.',
		'Created a Python data pipeline for lab sensor data.',
		'Skills: Python, React, SQL. No other experience provided.',
	].join('\n');
	const job = {
		title: 'Software Engineer Intern',
		company: 'Example',
		description: 'React, Python and SQL. Help build dashboards and collaborate on debugging.',
	};
	async function ask(task, extra) {
		const question = new Question();
		question.addQuestion(JSON.stringify({ task, source_resume: source, job, ...extra }));
		const result = await client.chat({ token, question });
		return String(result.answers?.at(-1) ?? '');
	}
	const answer = await ask('interview_prep', {});
	const prep = JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1));
	if (!prep.questions?.length || !prep.askEmployer?.length)
		throw Error('Interview preparation is incomplete');
	const supported = prep.stories.filter((story) =>
		source.toLowerCase().includes(String(story.evidence).toLowerCase())
	);
	if (!supported.length) throw Error('No source-supported interview story returned');
	console.log(
		'Interview preparation passed:',
		prep.questions.length,
		'questions;',
		supported.length,
		'supported stories'
	);
	const feedback = await ask('practice_feedback', {
		question: prep.questions[0].question,
		answer: 'I built a React dashboard used by 200 students. ' +
			'I implemented the dashboard and tested its features with students.',
	});
	if (!/STAR|situation|task|action|result/i.test(feedback) || feedback.length < 100)
		throw Error('Practice feedback is incomplete');
	console.log('Practice feedback passed');
	const outreach = await ask('outreach', {
		contact: {
			name: 'Alex',
			company: 'Example',
			role: 'Engineer',
			connection_notes: 'We have not met.',
		},
	});
	if (!outreach.includes('Alex') || outreach.length < 50)
		throw Error('Outreach draft missing context');
	console.log('Outreach draft passed; words:', outreach.trim().split(/\s+/).length);
	const application = await ask('application_answer', {
		question: 'Describe a project you are proud of.',
		max_words: 100,
		user_notes: 'Use the dashboard project.',
	});
	if (!/dashboard|React/.test(application) || application.trim().split(/\s+/).length > 110)
		throw Error('Application answer failed context or length check');
	console.log('Application answer passed; words:', application.trim().split(/\s+/).length);
} finally {
	await client.disconnect();
}
process.exit();
