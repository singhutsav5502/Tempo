// Assistant backend that calls the Anthropic API directly (needs an API key).
const Anthropic = require('@anthropic-ai/sdk');
const store = require('./store');
const { SYSTEM, TOOLS, runTool, nowLine, toolLabel } = require('./tools');

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_TOOL_ROUNDS = 8;
const HISTORY_LIMIT = 60;

let messages = [];
let busy = false;

const reset = () => { messages = []; };

function trim() {
  if (messages.length <= HISTORY_LIMIT) return;
  // Cut only at a plain user message so tool_use / tool_result pairs stay intact.
  const cut = messages.findIndex((m, i) => i >= messages.length - HISTORY_LIMIT / 2 && m.role === 'user' && typeof m.content === 'string');
  if (cut > 0) messages = messages.slice(cut);
}

/** Runs one user turn. `emit({type:'text'|'tool'|'end', ...})` streams progress to the UI. */
async function chat(text, emit) {
  if (busy) throw new Error('Still working on the previous message.');
  const apiKey = store.getSecret('anthropicKey');
  if (!apiKey) throw new Error('Add your Anthropic API key in Settings first.');
  busy = true;
  const client = new Anthropic({ apiKey });
  const model = store.get().settings.model;
  const adaptive = !/haiku/i.test(model);
  let useFallbacks = /^claude-(opus-5|fable|mythos)/.test(model);

  messages.push({ role: 'user', content: `${nowLine()}\n\n${text}` });
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const params = {
        model,
        max_tokens: 16000,
        system: SYSTEM,
        tools: TOOLS,
        messages,
        ...(adaptive ? { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } } : {}),
      };
      const stream = useFallbacks
        ? client.beta.messages.stream({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' })
        : client.messages.stream(params);
      stream.on('text', (delta) => emit({ type: 'text', delta }));

      let message;
      try {
        message = await stream.finalMessage();
      } catch (err) {
        if (useFallbacks && err instanceof Anthropic.BadRequestError && /fallback|beta/i.test(err.message)) {
          useFallbacks = false; // this model/account doesn't take the fallback beta; run without it
          round--;
          continue;
        }
        throw err;
      }

      if (message.stop_reason === 'refusal') { emit({ type: 'text', delta: "I can't help with that one." }); break; }
      messages.push({ role: 'assistant', content: message.content });
      const uses = message.content.filter((b) => b.type === 'tool_use');
      if (message.stop_reason !== 'tool_use' || !uses.length) {
        if (message.stop_reason === 'max_tokens') emit({ type: 'text', delta: '\n(Reply was cut off.)' });
        break;
      }

      const results = [];
      for (const use of uses) {
        try {
          const out = runTool(use.name, use.input || {});
          emit({ type: 'tool', label: toolLabel(use.name, use.input || {}), ok: true });
          results.push({ type: 'tool_result', tool_use_id: use.id, content: out });
        } catch (err) {
          emit({ type: 'tool', label: `${toolLabel(use.name, use.input || {})} failed`, ok: false });
          results.push({ type: 'tool_result', tool_use_id: use.id, content: err.message, is_error: true });
        }
      }
      messages.push({ role: 'user', content: results });
    }
  } catch (err) {
    // Roll back a dangling user turn so the next message starts from a valid history.
    while (messages.length && !(messages[messages.length - 1].role === 'assistant' && !messages[messages.length - 1].content.some?.((b) => b.type === 'tool_use'))) {
      messages.pop();
    }
    if (err instanceof Anthropic.AuthenticationError) throw new Error('Anthropic rejected the API key. Check it in Settings.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('Rate limited by Anthropic. Try again in a moment.');
    throw err;
  } finally {
    busy = false;
    trim();
    emit({ type: 'end' });
  }
}

module.exports = { chat, reset };
