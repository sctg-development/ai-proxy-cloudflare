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
// Forward requests to Cloudflare AI Gateway

import type { AiConfig, AiModel, AiProvider } from '../types/ai-config';
import { resolveProviderEndpoint, resolveModelId, pickKey } from './ai-enc';

export interface GatewayForwardRequest {
  model: string;
  messages?: Array<{ role: string; content: string }>;
  input?: string;
  [key: string]: any;
}

interface ForwardResult {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | string;
  headers: Record<string, string>;
}

/**
 * Forward a chat completion request to Cloudflare AI Gateway.
 * Handles model ID prefixing, authentication, and streaming.
 */
export async function forwardToCfAiGateway(
  request: Request,
  payload: GatewayForwardRequest,
  provider: AiProvider,
  config: {
    accountId: string;
    aigToken: string;
    providerKey?: string;
    modelUsage?: AiModel['usage'];
    debug?: boolean;
  },
): Promise<Response> {
  const { endpoint, useGateway } = resolveProviderEndpoint(provider, config.aigToken);

  if (!useGateway) {
    throw new Error(
      'Gateway endpoint not configured for this provider. ' +
      'Check ai.json configuration.',
    );
  }

  // Build gateway URL
  const gatewayUrl = new URL(endpoint);
  const requestPath = new URL(request.url).pathname;
  const compatPathSuffix = config.modelUsage === 'tts'
    ? '/audio/speech'
    : requestPath.endsWith('/audio/speech')
      ? '/audio/speech'
      : requestPath.endsWith('/chat/completions')
        ? '/chat/completions'
        : config.modelUsage === 'chat' || config.modelUsage === undefined
          ? '/chat/completions'
          : null;

  if (!compatPathSuffix) {
    throw new Error(`Unsupported compatibility route: ${requestPath}`);
  }

  const basePath = gatewayUrl.pathname.replace('{account}', config.accountId).replace(/\/$/, '');
  gatewayUrl.pathname = basePath.endsWith(compatPathSuffix)
    ? basePath
    : `${basePath}${compatPathSuffix}`;

  // Resolve and prefix model ID
  const modelId = resolveModelId(payload.model, provider, true);

  // Pick an API key from the provider
  const keyObj = pickKey(provider);

  // Prepare request headers
  const headers = new Headers({
    'Content-Type': 'application/json',
    'cf-aig-authorization': `Bearer ${config.aigToken}`,
    'Authorization': `Bearer ${keyObj.key}`,
  });

  // Preserve streaming preference
  const isStream = payload.stream === true;

  // Build the forwarded payload
  const forwardPayload = {
    ...payload,
    model: modelId,
    stream: isStream,
  };

  if (config.debug) {
    console.log('[ai-proxy] gateway-forward', JSON.stringify({
      requestPath,
      provider: config.providerKey ?? 'unknown',
      gatewayUrl: gatewayUrl.toString(),
        useGateway,
        model: modelId,
        modelUsage: config.modelUsage ?? 'chat',
        stream: isStream,
      }));
  }

  // Forward the request
  const response = await fetch(gatewayUrl.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(forwardPayload),
  });

  if (config.debug) {
    console.log('[ai-proxy] gateway-response', JSON.stringify({
      requestPath,
      provider: config.providerKey ?? 'unknown',
      gatewayUrl: gatewayUrl.toString(),
      status: response.status,
      ok: response.ok,
    }));
  }

  // If streaming, return the response as-is
  if (isStream && response.ok) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }),
    });
  }

  // Non-streaming: preserve the upstream body and content type.
  // Some providers (for example Groq TTS) return raw audio bytes directly.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
}

/**
 * Detect provider from request path or X-Host-Final header.
 */
export function detectProvider(
  pathname: string,
  xHostFinal: string | null,
  config: AiConfig,
): { key: string; provider: AiProvider } | null {
  // Try X-Host-Final header first (legacy compatibility)
  if (xHostFinal) {
    const hostMap: Record<string, string> = {
      'api.groq.com': 'groq',
      'api.sambanova.ai': 'sambanova',
      'api.anthropic.com': 'anthropic',
      'api.openai.com': 'openai',
      'generativelanguage.googleapis.com': 'gemini',
      'api.mistral.ai': 'mistral',
      'openrouter.ai': 'openrouter',
      'api.morphllm.com': 'morph',
    };

    for (const [host, providerKey] of Object.entries(hostMap)) {
      if (xHostFinal.includes(host)) {
        const provider = config.providers[providerKey];
        if (provider) {
          return { key: providerKey, provider };
        }
      }
    }
  }

  // Try path-based detection
  if (pathname.includes('/groq/')) {
    const provider = config.providers['groq'];
    if (provider) return { key: 'groq', provider };
  }

  if (pathname.includes('/sambanova/') || pathname.includes('/sambanova-ai/')) {
    const provider = config.providers['sambanova'];
    if (provider) return { key: 'sambanova', provider };
  }

  if (pathname.includes('/anthropic/')) {
    const provider = config.providers['anthropic'];
    if (provider) return { key: 'anthropic', provider };
  }

  if (pathname.includes('/openai/')) {
    const provider = config.providers['openai'];
    if (provider) return { key: 'openai', provider };
  }

  if (pathname.includes('/gemini/')) {
    const provider = config.providers['gemini'];
    if (provider) return { key: 'gemini', provider };
  }

  if (pathname.includes('/mistral/')) {
    const provider = config.providers['mistral'];
    if (provider) return { key: 'mistral', provider };
  }

  if (pathname.includes('/openrouter/')) {
    const provider = config.providers['openrouter'];
    if (provider) return { key: 'openrouter', provider };
  }

  if (pathname.includes('/morph/')) {
    const provider = config.providers['morph'];
    if (provider) return { key: 'morph', provider };
  }

  return null;
}
