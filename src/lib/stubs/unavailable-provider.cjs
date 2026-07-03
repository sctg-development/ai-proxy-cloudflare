// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
//
// Build-time stub for LLM vendor packages that the universal endpoint never
// uses (Bedrock/Vertex/SAP/CLI providers, OpenTelemetry Node tracing, …).
// They are Node-only and/or heavy; wrangler.jsonc aliases them here so the
// Worker bundle stays small. Any accidental use fails loudly at runtime.
//
// CommonJS on purpose: esbuild does not statically verify named imports from
// CJS modules, so a single Proxy can satisfy every import shape.
//
// Careful with interop traps: `default` must NOT return the proxy itself and
// `__esModule` must be falsy, otherwise bundler interop helpers recurse on
// `.default.default…` forever (stack overflow inside workerd).
module.exports = new Proxy(
	{},
	{
		get(_target, property) {
			if (property === '__esModule') return undefined;
			// Never look like a thenable, an iterator, or a primitive.
			if (typeof property === 'symbol' || property === 'then') return undefined;
			return function stubbedProviderExport() {
				throw new Error(
					`[ai-proxy] Provider module stubbed out of the Worker bundle (tried to use "${String(property)}")`,
				);
			};
		},
	},
);
