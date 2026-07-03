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
// OpenAI-compatible ⇄ Cline gateway adapters for the universal endpoint.
// Inbound: OpenAI chat/completions JSON → GatewayStreamRequest fields.
// Outbound: AgentModelEvent stream → OpenAI SSE chunks / completion object.

import type {
	AgentMessage,
	AgentMessagePart,
	AgentModelEvent,
	AgentToolDefinition,
} from '@sctg/cline-llms';

// ─── OpenAI wire types (minimal subset) ───────────────────────────────────────

export interface OpenAiContentPart {
	type: string;
	text?: string;
	image_url?: { url: string };
}

export interface OpenAiToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

export interface OpenAiChatMessage {
	role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
	content: string | OpenAiContentPart[] | null;
	tool_calls?: OpenAiToolCall[];
	tool_call_id?: string;
	name?: string;
}

export interface OpenAiTool {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

export interface OpenAiChatRequest {
	model: string;
	messages: OpenAiChatMessage[];
	tools?: OpenAiTool[];
	temperature?: number;
	max_tokens?: number;
	max_completion_tokens?: number;
	stream?: boolean;
	stream_options?: { include_usage?: boolean };
}

export interface UniversalGatewayInput {
	modelId: string;
	systemPrompt?: string;
	messages: AgentMessage[];
	tools?: AgentToolDefinition[];
	temperature?: number;
	maxTokens?: number;
}

// ─── Inbound: OpenAI → gateway ────────────────────────────────────────────────

function textOfContent(content: OpenAiChatMessage['content']): string {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.filter((p) => p.type === 'text' && typeof p.text === 'string')
			.map((p) => p.text)
			.join('');
	}
	return '';
}

function userParts(content: OpenAiChatMessage['content']): AgentMessagePart[] {
	if (typeof content === 'string') {
		return [{ type: 'text', text: content }];
	}
	const parts: AgentMessagePart[] = [];
	for (const p of content ?? []) {
		if (p.type === 'text' && typeof p.text === 'string') {
			parts.push({ type: 'text', text: p.text });
		} else if (p.type === 'image_url' && p.image_url?.url) {
			parts.push({ type: 'image', image: p.image_url.url });
		}
	}
	return parts.length > 0 ? parts : [{ type: 'text', text: '' }];
}

/**
 * Translate an OpenAI chat/completions payload into the Cline gateway shape.
 * The `model` field carries the keypoollive composite ID (`provider/modelId`).
 */
export function openAiToGatewayInput(payload: OpenAiChatRequest): UniversalGatewayInput {
	const systemChunks: string[] = [];
	const messages: AgentMessage[] = [];
	// OpenAI `tool` role messages reference a tool_call_id; the tool name lives
	// on the originating assistant message, so track it while iterating.
	const toolNamesById = new Map<string, string>();
	const now = Date.now();
	let index = 0;

	for (const message of payload.messages ?? []) {
		const id = `msg-${index++}`;
		switch (message.role) {
			case 'system':
			case 'developer':
				systemChunks.push(textOfContent(message.content));
				break;
			case 'user':
				messages.push({ id, role: 'user', content: userParts(message.content), createdAt: now });
				break;
			case 'assistant': {
				const parts: AgentMessagePart[] = [];
				const text = textOfContent(message.content);
				if (text) parts.push({ type: 'text', text });
				for (const call of message.tool_calls ?? []) {
					toolNamesById.set(call.id, call.function.name);
					let input: unknown = call.function.arguments;
					try {
						input = JSON.parse(call.function.arguments || '{}');
					} catch {
						// keep raw string when arguments are not valid JSON
					}
					parts.push({
						type: 'tool-call',
						toolCallId: call.id,
						toolName: call.function.name,
						input,
					});
				}
				if (parts.length > 0) {
					messages.push({ id, role: 'assistant', content: parts, createdAt: now });
				}
				break;
			}
			case 'tool': {
				const toolCallId = message.tool_call_id ?? '';
				messages.push({
					id,
					role: 'tool',
					content: [
						{
							type: 'tool-result',
							toolCallId,
							toolName: message.name ?? toolNamesById.get(toolCallId) ?? 'unknown',
							output: textOfContent(message.content),
						},
					],
					createdAt: now,
				});
				break;
			}
		}
	}

	const tools: AgentToolDefinition[] | undefined = payload.tools?.map((tool) => ({
		name: tool.function.name,
		description: tool.function.description ?? '',
		inputSchema: tool.function.parameters ?? { type: 'object', properties: {} },
	}));

	return {
		modelId: payload.model,
		systemPrompt: systemChunks.filter(Boolean).join('\n\n') || undefined,
		messages,
		tools: tools?.length ? tools : undefined,
		temperature: payload.temperature,
		maxTokens: payload.max_completion_tokens ?? payload.max_tokens,
	};
}

// ─── Outbound: gateway events → OpenAI ────────────────────────────────────────

type OpenAiFinishReason = 'stop' | 'length' | 'tool_calls' | null;

function mapFinishReason(reason: string): OpenAiFinishReason {
	switch (reason) {
		case 'tool-calls':
			return 'tool_calls';
		case 'max-tokens':
			return 'length';
		default:
			return 'stop';
	}
}

interface AccumulatedToolCall {
	id: string;
	name: string;
	arguments: string;
}

interface AccumulatedCompletion {
	content: string;
	reasoning: string;
	toolCalls: AccumulatedToolCall[];
	finishReason: OpenAiFinishReason;
	usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

function newUsage() {
	return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

/**
 * Consume the full gateway stream and build a non-streaming OpenAI
 * chat.completion response body.
 */
export async function collectOpenAiCompletion(
	events: AsyncIterable<AgentModelEvent>,
	model: string,
	completionId: string,
): Promise<Record<string, unknown>> {
	const acc: AccumulatedCompletion = {
		content: '',
		reasoning: '',
		toolCalls: [],
		finishReason: null,
		usage: newUsage(),
	};
	const callsById = new Map<string, AccumulatedToolCall>();

	for await (const event of events) {
		switch (event.type) {
			case 'text-delta':
				acc.content += event.text;
				break;
			case 'reasoning-delta':
				acc.reasoning += event.text;
				break;
			case 'tool-call-delta': {
				const callId = event.toolCallId ?? `call_${callsById.size}`;
				let call = callsById.get(callId);
				if (!call) {
					call = { id: callId, name: event.toolName ?? '', arguments: '' };
					callsById.set(callId, call);
					acc.toolCalls.push(call);
				}
				if (event.toolName) call.name = event.toolName;
				if (typeof event.inputText === 'string') {
					call.arguments += event.inputText;
				} else if (event.input !== undefined) {
					call.arguments = JSON.stringify(event.input);
				}
				break;
			}
			case 'usage':
				acc.usage.prompt_tokens += event.usage.inputTokens ?? 0;
				acc.usage.completion_tokens += event.usage.outputTokens ?? 0;
				break;
			case 'finish':
				if (event.reason === 'error') {
					throw new Error(event.error || 'Stream finished with error');
				}
				acc.finishReason = mapFinishReason(event.reason);
				break;
		}
	}

	acc.usage.total_tokens = acc.usage.prompt_tokens + acc.usage.completion_tokens;

	const message: Record<string, unknown> = {
		role: 'assistant',
		content: acc.content || (acc.toolCalls.length > 0 ? null : ''),
	};
	if (acc.reasoning) {
		message.reasoning_content = acc.reasoning;
	}
	if (acc.toolCalls.length > 0) {
		message.tool_calls = acc.toolCalls.map((call) => ({
			id: call.id,
			type: 'function',
			function: { name: call.name, arguments: call.arguments },
		}));
		if (!acc.finishReason) acc.finishReason = 'tool_calls';
	}

	return {
		id: completionId,
		object: 'chat.completion',
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [
			{
				index: 0,
				message,
				finish_reason: acc.finishReason ?? 'stop',
			},
		],
		usage: acc.usage,
	};
}

/**
 * Convert the gateway stream into an OpenAI-compatible SSE body.
 * Emits `chat.completion.chunk` objects, an optional usage chunk, and the
 * terminal `[DONE]` sentinel. Provider errors surface as an SSE `error` object
 * (after which the stream terminates) so clients do not hang.
 */
export function openAiSseStream(
	events: AsyncIterable<AgentModelEvent>,
	model: string,
	completionId: string,
	includeUsage: boolean,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const created = Math.floor(Date.now() / 1000);
	const usage = newUsage();
	const toolCallIndexes = new Map<string, number>();
	let firstChunk = true;
	let finishReason: OpenAiFinishReason = null;
	let sawToolCall = false;

	function chunk(delta: Record<string, unknown>, finish: OpenAiFinishReason = null): string {
		const body = {
			id: completionId,
			object: 'chat.completion.chunk',
			created,
			model,
			choices: [{ index: 0, delta, finish_reason: finish }],
		};
		return `data: ${JSON.stringify(body)}\n\n`;
	}

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (text: string) => controller.enqueue(encoder.encode(text));
			try {
				for await (const event of events) {
					const withRole = (delta: Record<string, unknown>) => {
						if (firstChunk) {
							firstChunk = false;
							return { role: 'assistant', ...delta };
						}
						return delta;
					};
					switch (event.type) {
						case 'text-delta':
							if (event.text) send(chunk(withRole({ content: event.text })));
							break;
						case 'reasoning-delta':
							if (event.text) send(chunk(withRole({ reasoning_content: event.text })));
							break;
						case 'tool-call-delta': {
							sawToolCall = true;
							const callId = event.toolCallId ?? `call_${toolCallIndexes.size}`;
							let index = toolCallIndexes.get(callId);
							const isNew = index === undefined;
							if (index === undefined) {
								index = toolCallIndexes.size;
								toolCallIndexes.set(callId, index);
							}
							const fn: Record<string, unknown> = {};
							if (isNew && event.toolName) fn.name = event.toolName;
							if (typeof event.inputText === 'string') {
								fn.arguments = event.inputText;
							} else if (event.input !== undefined) {
								fn.arguments = JSON.stringify(event.input);
							}
							send(
								chunk(
									withRole({
										tool_calls: [
											{
												index,
												...(isNew ? { id: callId, type: 'function' } : {}),
												function: fn,
											},
										],
									}),
								),
							);
							break;
						}
						case 'usage':
							usage.prompt_tokens += event.usage.inputTokens ?? 0;
							usage.completion_tokens += event.usage.outputTokens ?? 0;
							break;
						case 'finish':
							if (event.reason === 'error') {
								throw new Error(event.error || 'Stream finished with error');
							}
							finishReason = mapFinishReason(event.reason);
							break;
					}
				}

				// Terminal chunk with the finish reason
				send(chunk({}, finishReason ?? (sawToolCall ? 'tool_calls' : 'stop')));

				if (includeUsage) {
					usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
					send(
						`data: ${JSON.stringify({
							id: completionId,
							object: 'chat.completion.chunk',
							created,
							model,
							choices: [],
							usage,
						})}\n\n`,
					);
				}
				send('data: [DONE]\n\n');
				controller.close();
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				try {
					send(
						`data: ${JSON.stringify({
							error: { message, type: 'upstream_error', code: null },
						})}\n\n`,
					);
					send('data: [DONE]\n\n');
					controller.close();
				} catch {
					controller.error(err);
				}
			}
		},
	});
}
