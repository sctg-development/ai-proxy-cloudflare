// Forward requests to Cloudflare AI Gateway

import type { AiConfig, AiProvider } from './ai-enc';
import { resolveProviderEndpoint, resolveModelId, pickKey } from './ai-enc';

export interface GatewayForwardRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
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
  const compatPathSuffix = requestPath.endsWith('/chat/completions')
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

  // Non-streaming: buffer the entire response
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers({
      'Content-Type': 'application/json',
    }),
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

  return null;
}
