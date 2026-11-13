// =============================================================================
// MIT License
// Copyright (c) 2026 Aparavi Software AG
// =============================================================================

/** The app builder bundles .pipe files as pipeline JSON. */
declare module '*.pipe' {
	const value: import('rocketride').PipelineConfig;
	export default value;
}
