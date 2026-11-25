export interface TailoredResume {
	text: string;
	changes: string[];
	gaps: string[];
	sourceHash: string;
	updatedAt: number;
}

/** Detect a changed source resume before restoring a saved version. */
export function sourceHash(text: string): string {
	let hash = 2166136261;
	for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
	return `${text.length}:${hash >>> 0}`;
}

export function jsonAnswer(text: string): Record<string, unknown> {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) throw new Error('The writer returned an incomplete answer. Please try again.');
	return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

export function readTailoredResume(answer: string, source: string): TailoredResume {
	const parsed = jsonAnswer(answer);
	if (typeof parsed.resume !== 'string' || parsed.resume.trim().length < 80 || parsed.resume.length > 46000) throw new Error('The writer did not return a complete resume. Please try again.');
	const list = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 20) : []);
	return { text: parsed.resume.trim(), changes: list(parsed.changes), gaps: list(parsed.gaps), sourceHash: sourceHash(source), updatedAt: Date.now() };
}

export function downloadText(text: string, name: string) {
	const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = `${name.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 100)}.txt`;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function printResume(text: string, title: string) {
	const popup = window.open('', '_blank', 'width=850,height=1000');
	if (!popup) throw new Error('Allow popups to open the resume print view.');
	popup.opener = null;
	popup.document.title = title;
	const style = popup.document.createElement('style');
	style.textContent = '@page{size:letter;margin:0.65in}body{max-width:7.2in;margin:32px auto;color:#111;background:white}pre{font:11pt/1.4 Arial,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:0}}';
	popup.document.head.append(style);
	const content = popup.document.createElement('pre');
	content.textContent = text;
	popup.document.body.append(content);
	popup.focus();
	popup.print();
}
