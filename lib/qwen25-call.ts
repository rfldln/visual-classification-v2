export const DEFAULT_QWEN25_MODEL = "huihui-ai/Huihui-Qwen3-VL-30B-A3B-Instruct-abliterated";

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAIChoice { message?: { content?: string; reasoning?: string } }
interface OpenAIError { error?: { message?: string } }

export type Qwen25CallOk = { ok: true; content: string; usage?: TokenUsage };
export type Qwen25CallErr = { ok: false; error: string; status: number };
export type Qwen25CallResult = Qwen25CallOk | Qwen25CallErr;

export async function callQwen25Pod(opts: {
  podUrl: string;
  apiKey?: string;
  model: string;
  systemPrompt: string;
  userText: string;
  imageDataUrls: string[];
  maxTokens?: number;
  temperature?: number;
}): Promise<Qwen25CallResult> {
  const userContent: Array<Record<string, unknown>> = [{ type: "text", text: opts.userText }];
  for (const url of opts.imageDataUrls) {
    userContent.push({ type: "image_url", image_url: { url } });
  }

  const body = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: userContent },
    ],
    // Qwen3.6 (and other Qwen3 thinking models) otherwise burn the whole token
    // budget inside a <think> trace and never emit the JSON answer. We want
    // perception + structured tags, not deliberation — disable thinking so the
    // answer goes straight to `content`. Ignored by templates without the kwarg.
    chat_template_kwargs: { enable_thinking: false },
    temperature: opts.temperature ?? 0.1,
    // Thinking models (e.g. Qwen3.6) spend tokens inside a <think> trace BEFORE
    // emitting the JSON answer; a low cap truncates mid-thought and yields no
    // parseable output. 2048 leaves room to think and still answer. It's only a
    // cap — non-thinking models stop at the JSON (~150 tokens) regardless.
    max_tokens: opts.maxTokens ?? 2048,
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;

  let res: Response;
  try {
    res = await fetch(`${opts.podUrl}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Cannot reach Qwen 2.5 pod: ${msg}`, status: 503 };
  }

  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { const j = JSON.parse(text) as OpenAIError; msg = j.error?.message ?? text; } catch {}
    return { ok: false, error: msg, status: res.status };
  }

  let parsed: { choices?: OpenAIChoice[]; usage?: TokenUsage };
  try { parsed = JSON.parse(text); }
  catch { return { ok: false, error: "Invalid JSON from Qwen 2.5 pod", status: 502 }; }

  // Thinking models split the final answer into `content` and the
  // chain-of-thought into `reasoning`. Prefer content; fall back to reasoning so
  // a thinking-only / truncated response is still visible in the raw output.
  const msg = parsed.choices?.[0]?.message;
  const content = msg?.content || msg?.reasoning || "";
  return { ok: true, content, usage: parsed.usage };
}
