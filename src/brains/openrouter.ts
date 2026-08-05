/**
 * OpenRouter fighter brain: calls a real model for each turn. Wired behind the same
 * `FighterBrain` interface as `local.ts` so nothing above this file — `LiveSource`,
 * the CLI driver, the server — can tell which brain it is talking to.
 *
 * No key exists on this machine (see `worker-live-mode.txt`), so this file is
 * wired but NOT behaviourally verified by this change. It is written to fail loudly
 * and immediately when the key is missing — never a stack trace, never a silent
 * fallback that pretends a real model answered.
 */

import type { BrainContext, FighterBrain } from './types';

const DEFAULT_MODEL = 'openrouter/auto';
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export interface OpenRouterBrainOptions {
  apiKey?: string;
  model?: string;
  /** Persona line injected into the system prompt, e.g. "You are CLAUDE, a nuance specialist." */
  persona?: string;
}

export function createOpenRouterBrain(options: OpenRouterBrainOptions = {}): FighterBrain {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  const model = options.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;

  return {
    kind: `openrouter:${model}`,

    async nextMessage(ctx: BrainContext): Promise<string> {
      if (!apiKey) {
        throw new Error(
          'OpenRouter brain selected but OPENROUTER_API_KEY is not set. Copy .env.example to ' +
            '.env and fill it in, or run with --brain local to fight with no key and no network.'
        );
      }

      let res: Response;
      try {
        res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/prompt-fighter',
            'X-Title': 'Prompt Fighter'
          },
          body: JSON.stringify({
            model,
            messages: buildMessages(ctx, options.persona),
            max_tokens: 220
          })
        });
      } catch (err) {
        throw new Error(
          `OpenRouter request failed before a response arrived: ${(err as Error).message}`
        );
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `OpenRouter request failed (${res.status} ${res.statusText}): ${body || 'no body'}`
        );
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = data.choices?.[0]?.message?.content;
      if (!text || typeof text !== 'string' || !text.trim()) {
        throw new Error('OpenRouter response had no usable message content.');
      }
      return text.trim();
    }
  };
}

function buildMessages(ctx: BrainContext, persona?: string) {
  const myName = ctx.names[ctx.speaker];
  const opponentName = ctx.names[ctx.opponent];
  const system =
    persona ??
    `You are ${myName}, debating ${opponentName} on: "${ctx.topic}". Argue your side in ` +
      '2-4 sentences. Be direct.';

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: system }
  ];
  if (ctx.lastOpponentText) {
    messages.push({ role: 'user', content: ctx.lastOpponentText });
  } else {
    messages.push({ role: 'user', content: `Open the debate on: "${ctx.topic}".` });
  }
  return messages;
}
