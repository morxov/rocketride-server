// =============================================================================
// MIT License
// Copyright (c) 2026 Aparavi Software AG
// =============================================================================

/** RocketRide pipeline files — JSON with a .pipe extension (see the .pipe
 * rule in rsbuild.config.mts). Import one and pass it to
 * client.use({ pipeline }) — browser bundles cannot use filepath loading. */
declare module '*.pipe' {
	const value: Record<string, unknown>;
	export default value;
}

/** A PDF imported from src/assets resolves to its served URL (see the .pdf rule in rsbuild.config.mts). */
declare module '*.pdf' {
	const url: string;
	export default url;
}
