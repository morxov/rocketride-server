// Lets Node import the app's TypeScript directly for headless checks:
// resolves extensionless relative imports to .ts/.tsx and loads .pipe
// files as JSON default exports (what the rsbuild config does for the app).
import { readFileSync } from 'node:fs';
// registerHooks needs Node 22.15+ (README lists that); only the check scripts use it.
// eslint-disable-next-line n/no-unsupported-features/node-builtins
import { registerHooks } from 'node:module';

registerHooks({
	resolve(specifier, context, next) {
		if (specifier.startsWith('.') && context.parentURL?.match(/\.tsx?$/) && !/\.[a-z]+$/.test(specifier)) {
			for (const ext of ['.ts', '.tsx']) {
				try {
					return next(specifier + ext, context);
				} catch {
					// try the next extension
				}
			}
		}
		return next(specifier, context);
	},
	load(url, context, next) {
		if (url.endsWith('.pipe')) {
			const json = readFileSync(new URL(url), 'utf8');
			return { format: 'module', source: `export default ${json};`, shortCircuit: true };
		}
		return next(url, context);
	},
});
