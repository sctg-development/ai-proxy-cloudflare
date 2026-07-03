// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Same vendor stubbing as wrangler.jsonc "alias" — the test bundler does not
// read the wrangler alias map, so heavy Node-only providers are aliased here too.
const providerStub = fileURLToPath(
	new URL('./src/lib/stubs/unavailable-provider.cjs', import.meta.url),
);
const stubbedModules = [
	'@ai-sdk/amazon-bedrock',
	'@aws-sdk/credential-providers',
	'@ai-sdk/google-vertex/anthropic',
	'@ai-sdk/google-vertex',
	'@jerome-benoit/sap-ai-provider',
	'@langfuse/otel',
	'@opentelemetry/sdk-trace-node',
	'ai-sdk-provider-claude-code',
	'ai-sdk-provider-codex-cli',
	'ai-sdk-provider-opencode-sdk',
	'dify-ai-provider',
];

export default defineConfig({
	resolve: {
		alias: stubbedModules.map((find) => ({ find, replacement: providerStub })),
	},
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.jsonc' },
			miniflare: {
				bindings: {
					// Real secret can be injected with `AI_JSON_CRYPTOKEN=… npm test`;
					// group tests only need a deterministic value.
					AI_JSON_CRYPTOKEN: process.env.AI_JSON_CRYPTOKEN ?? 'test-master-token',
					// Opt-in for the universal-endpoint tests that drive the real SDK
					// gateway: they pass, but a companion workerd process segfaults
					// after completion (tooling issue, not app logic), failing the
					// suite. Run with `RUN_SDK_TESTS=1 npm test` to include them.
					RUN_SDK_TESTS: process.env.RUN_SDK_TESTS ?? '',
				},
			},
		}),
	],
	test: {
		include: ['test/**/*.test.ts'],
	},
});
