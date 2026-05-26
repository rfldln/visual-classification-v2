export const DEFAULT_OLLAMA_MODEL = "huihui_ai/Qwen3.6-abliterated:27b";

export type OllamaCallOk = { ok: true; content: string; promptTokens?: number; completionTokens?: number };
export type OllamaCallErr = { ok: false; error: string; status: number };
export type OllamaCallResult = OllamaCallOk | OllamaCallErr;

interface OllamaResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

interface OpenAICompletion {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: string;
}

interface RunPodSyncResponse {
  id: string;
  status: "COMPLETED" | "FAILED" | "IN_QUEUE" | "IN_PROGRESS" | "CANCELLED";
  output?: OpenAICompletion | OpenAICompletion[];
  error?: string;
}

async function callOllamaServerless(opts: {
  endpointId: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userText: string;
  imageBase64s: string[];
}): Promise<OllamaCallResult> {
  const userContent: unknown[] = [{ type: "text", text: opts.userText }];
  for (const b64 of opts.imageBase64s) {
    userContent.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } });
  }

  const payload = {
    input: {
      openai_route: "/v1/chat/completions",
      openai_input: {
        model: opts.model,
        messages: [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: userContent },
        ],
        stream: false,
        temperature: 0.1,
      },
    },
  };

  const baseUrl = `https://api.runpod.ai/v2/${opts.endpointId}`;
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${opts.apiKey}`,
  };

  let submitRes: Response;
  try {
    submitRes = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Cannot reach RunPod endpoint: ${msg}`, status: 503 };
  }

  if (!submitRes.ok) {
    const text = await submitRes.text();
    return { ok: false, error: `RunPod HTTP ${submitRes.status}: ${text}`, status: submitRes.status };
  }

  const { id: jobId } = (await submitRes.json()) as { id: string; status: string };

  const deadline = Date.now() + 1_190_000;
  while (Date.now() < deadline) {
    await new Promise<void>(r => setTimeout(r, 3000));

    let pollRes: Response;
    try {
      pollRes = await fetch(`${baseUrl}/status/${jobId}`, { headers });
    } catch {
      continue;
    }
    if (!pollRes.ok) continue;

    const data = (await pollRes.json()) as RunPodSyncResponse;

    if (data.status === "FAILED") {
      return { ok: false, error: `RunPod job failed: ${data.error ?? "unknown"}`, status: 500 };
    }
    if (data.status === "CANCELLED") {
      return { ok: false, error: "RunPod job was cancelled", status: 500 };
    }
    if (data.status === "COMPLETED") {
      const raw = data.output;
      if (!raw) {
        return { ok: false, error: "RunPod returned COMPLETED but output is empty", status: 502 };
      }
      const completion = Array.isArray(raw) ? raw[0] : raw;
      if (completion.error) {
        return { ok: false, error: completion.error, status: 500 };
      }
      return {
        ok: true,
        content: completion.choices?.[0]?.message?.content ?? "",
        promptTokens: completion.usage?.prompt_tokens,
        completionTokens: completion.usage?.completion_tokens,
      };
    }
  }

  return {
    ok: false,
    error: "RunPod timed out after 1190 seconds — model may be cold-starting. Retry in ~30 seconds.",
    status: 504,
  };
}

export async function callOllama(opts: {
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userText: string;
  imageBase64s: string[];
}): Promise<OllamaCallResult> {
  // Use RunPod serverless if credentials are available
  const rpKey = process.env.RUNPOD_API_KEY?.trim();
  const rpEndpoint = process.env.RUNPOD_ENDPOINT_ID?.trim();
  if (rpKey && rpEndpoint) {
    return callOllamaServerless({ endpointId: rpEndpoint, apiKey: rpKey, ...opts });
  }

  const userMessage: Record<string, unknown> = {
    role: "user",
    content: opts.userText,
  };
  if (opts.imageBase64s.length > 0) {
    userMessage.images = opts.imageBase64s;
  }

  const body = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.systemPrompt },
      userMessage,
    ],
    stream: true,
    think: false,
    options: { temperature: 0.1 },
  };

  let res: Response;
  try {
    res = await fetch(`${opts.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Cannot reach Ollama at ${opts.baseUrl}: ${msg}`, status: 503 };
  }

  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { msg = (JSON.parse(text) as OllamaResponse).error ?? text; } catch { /* keep raw text */ }
    return { ok: false, error: msg, status: res.status };
  }

  if (!res.body) {
    return { ok: false, error: "No response body from Ollama", status: 502 };
  }

  let content = "";
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const chunk = JSON.parse(trimmed) as OllamaResponse & { done?: boolean };
        content += chunk.message?.content ?? "";
        if (chunk.done) {
          promptTokens = (chunk as Record<string, unknown>).prompt_eval_count as number | undefined;
          completionTokens = (chunk as Record<string, unknown>).eval_count as number | undefined;
        }
      } catch { /* skip malformed lines */ }
    }
  }

  return { ok: true, content, promptTokens, completionTokens };
}

export async function submitRunPodJob(opts: {
  endpointId: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userText: string;
  imageBase64s: string[];
}): Promise<{ ok: true; jobId: string } | OllamaCallErr> {
  const userContent: unknown[] = [{ type: "text", text: opts.userText }];
  for (const b64 of opts.imageBase64s) {
    userContent.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } });
  }
  const payload = {
    input: {
      openai_route: "/v1/chat/completions",
      openai_input: {
        model: opts.model,
        messages: [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: userContent },
        ],
        stream: false,
        temperature: 0.1,
      },
    },
  };

  let res: Response;
  try {
    res = await fetch(`https://api.runpod.ai/v2/${opts.endpointId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${opts.apiKey}` },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Cannot reach RunPod endpoint: ${msg}`, status: 503 };
  }
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `RunPod HTTP ${res.status}: ${text}`, status: res.status };
  }
  const { id: jobId } = (await res.json()) as { id: string };
  return { ok: true, jobId };
}

export type RunPodJobStatus =
  | { status: "pending" }
  | { status: "failed"; error: string }
  | { status: "completed"; content: string; promptTokens?: number; completionTokens?: number };

export async function checkRunPodJob(opts: {
  endpointId: string;
  apiKey: string;
  jobId: string;
}): Promise<RunPodJobStatus> {
  let res: Response;
  try {
    res = await fetch(`https://api.runpod.ai/v2/${opts.endpointId}/status/${opts.jobId}`, {
      headers: { "Authorization": `Bearer ${opts.apiKey}` },
    });
  } catch {
    return { status: "pending" };
  }
  if (!res.ok) return { status: "pending" };

  const data = (await res.json()) as RunPodSyncResponse;

  if (data.status === "FAILED") return { status: "failed", error: data.error ?? "RunPod job failed" };
  if (data.status === "CANCELLED") return { status: "failed", error: "RunPod job was cancelled" };

  if (data.status === "COMPLETED") {
    const raw = data.output;
    if (!raw) return { status: "failed", error: "RunPod returned COMPLETED but output is empty" };
    const completion = Array.isArray(raw) ? raw[0] : raw;
    if (completion.error) return { status: "failed", error: completion.error };
    return {
      status: "completed",
      content: completion.choices?.[0]?.message?.content ?? "",
      promptTokens: completion.usage?.prompt_tokens,
      completionTokens: completion.usage?.completion_tokens,
    };
  }

  return { status: "pending" };
}
