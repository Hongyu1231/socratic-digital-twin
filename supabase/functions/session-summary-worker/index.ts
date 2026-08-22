import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";
import {
  buildOpenAiResponsesBody,
  extractOpenAiResponseText,
  fetchJson,
  OPENAI_RESPONSES_URL,
  parseJson,
  parseSummaryProvider,
  reconcileGeneratedSummary,
  SUMMARY_INSTRUCTIONS,
  validateSummary,
  type SummaryProvider,
  type Summary,
} from "./summary-worker-core.ts";

type SummaryJob = {
  id: string;
  session_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  attempt_count: number;
  claim_token: string;
};

type SessionPayload = {
  session: {
    id: string;
    status: string;
    case_id: string;
    context: Record<string, unknown> | null;
  };
  state: Record<string, unknown> | null;
  facts: string[];
  unresolvedQuestions: string[];
  evaluations: Array<{
    score: number | null;
    criteria: Record<string, unknown> | null;
    feedback: string | null;
  }>;
};

function env(name: string): string | null {
  const value = Deno.env.get(name)?.trim();
  return value ? value : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}


async function generateOpenAiSummary(
  payload: SessionPayload,
  apiKey: string,
  model: string,
  timeoutMs: number,
): Promise<Summary> {
  const response = await fetchJson(
    OPENAI_RESPONSES_URL,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildOpenAiResponsesBody(payload, model)),
    },
    timeoutMs,
  );
  return validateSummary(parseJson(extractOpenAiResponseText(response)));
}

async function generateClaudeSummary(
  payload: SessionPayload,
  apiKey: string,
  model: string,
  timeoutMs: number,
): Promise<Summary> {
  const response = (await fetchJson(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 850,
        system: SUMMARY_INSTRUCTIONS,
        messages: [{ role: "user", content: JSON.stringify(payload) }],
      }),
    },
    timeoutMs,
  )) as { content?: Array<{ type?: string; text?: string }> };
  const content = response.content?.find((item) => item.type === "text")?.text;
  if (!content) throw new Error("Claude returned an empty summary");
  return validateSummary(parseJson(content));
}

async function loadSessionPayload(
  client: SupabaseClient,
  sessionId: string,
): Promise<SessionPayload> {
  const [sessionResult, stateResult, evaluationsResult] = await Promise.all([
    client
      .from("sessions")
      .select("id,status,case_id,context")
      .eq("id", sessionId)
      .maybeSingle(),
    client
      .from("session_state")
      .select("state,facts,unresolved_questions")
      .eq("session_id", sessionId)
      .maybeSingle(),
    client
      .from("evaluations")
      .select("score,criteria,feedback")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true }),
  ]);

  if (sessionResult.error) throw new Error(`Load summary session: ${sessionResult.error.message}`);
  if (!sessionResult.data) throw new Error("Summary session no longer exists");
  if (stateResult.error) throw new Error(`Load summary state: ${stateResult.error.message}`);
  if (evaluationsResult.error) throw new Error(`Load summary evaluations: ${evaluationsResult.error.message}`);
  if (sessionResult.data.status !== "completed") throw new Error("Summary session is not completed");

  return {
    session: sessionResult.data as SessionPayload["session"],
    state: (stateResult.data?.state as Record<string, unknown> | null) ?? null,
    facts: stateResult.data?.facts ?? [],
    unresolvedQuestions: stateResult.data?.unresolved_questions ?? [],
    evaluations: (evaluationsResult.data ?? []) as SessionPayload["evaluations"],
  };
}

async function generateSummary(
  payload: SessionPayload,
  provider: SummaryProvider,
  timeoutMs: number,
): Promise<{ summary: Summary; provider: string; model: string }> {
  if (provider === "deterministic") {
    return {
      summary: validateSummary(payload.session.context?.summary),
      provider,
      model: "deterministic-v2",
    };
  }

  if (provider === "openai") {
    const apiKey = env("OPENAI_API_KEY");
    const model = env("OPENAI_MODEL");
    if (!apiKey || !model) throw new Error("TUTOR_PROVIDER=openai requires OPENAI_API_KEY and OPENAI_MODEL");
    return {
      summary: await generateOpenAiSummary(payload, apiKey, model, timeoutMs),
      provider,
      model,
    };
  }

  const apiKey = env("ANTHROPIC_API_KEY");
  const model = env("CLAUDE_MODEL");
  if (!apiKey || !model) throw new Error("TUTOR_PROVIDER=claude requires ANTHROPIC_API_KEY and CLAUDE_MODEL");
  return {
    summary: await generateClaudeSummary(payload, apiKey, model, timeoutMs),
    provider,
    model,
  };
}

async function processJob(
  client: SupabaseClient,
  job: SummaryJob,
  timeoutMs: number,
): Promise<{ id: string; ok: boolean; error?: string }> {
  try {
    const source = await loadSessionPayload(client, job.session_id);
    const payload: SessionPayload = {
      ...source,
      session: {
        ...source.session,
        // The deterministic summary remains in context as the safe reference
        // and is also sent to the provider as part of the payload.
      },
    };
    const generated = await generateSummary(payload, parseSummaryProvider(env("TUTOR_PROVIDER")), timeoutMs);
    const deterministic = source.session.context?.summary;
    let summary = generated.summary;
    if (deterministic && typeof deterministic === "object") {
      try {
        const fallback = validateSummary(deterministic);
        // The model may improve wording, but it must not change the
        // deterministic score or claim that an incomplete session is complete.
        summary = reconcileGeneratedSummary(summary, fallback);
      } catch {
        // A legacy/malformed fallback is left untouched; the database still
        // validates the generated summary before applying it.
      }
    }
    const { error } = await client.rpc("apply_session_summary_job", {
      p_job_id: job.id,
      p_claim_token: job.claim_token,
      p_summary: summary,
      p_provider: generated.provider,
      p_model: generated.model,
    });
    if (error) throw new Error(`Apply summary: ${error.message}`);
    return { id: job.id, ok: true };
  } catch (error) {
    const message = errorMessage(error);
    const { error: failError } = await client.rpc("fail_session_summary_job", {
      p_job_id: job.id,
      p_claim_token: job.claim_token,
      p_error: message,
    });
    if (failError) return { id: job.id, ok: false, error: `${message}; fail job: ${failError.message}` };
    return { id: job.id, ok: false, error: message };
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "POST required" }, 405);

  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = env("SUPABASE_URL");
  const cronSecret = env("SUMMARY_WORKER_CRON_SECRET");
  if (!serviceRoleKey || !supabaseUrl || !cronSecret) {
    return jsonResponse({ error: "Worker secrets are not configured" }, 500);
  }

  // Supabase Cron uses a dedicated shared secret. Never expose the database
  // service-role key to the scheduler request or accept a browser/session JWT.
  if (request.headers.get("x-summary-worker-secret") !== cronSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: { limit?: number } = {};
  try {
    body = (await request.json()) as { limit?: number };
  } catch {
    // An empty cron POST is valid.
  }

  const configuredLimit = Number(body.limit ?? env("SUMMARY_WORKER_BATCH_SIZE") ?? 5);
  const limit = Number.isFinite(configuredLimit)
    ? Math.max(1, Math.min(20, Math.floor(configuredLimit)))
    : 5;
  const configuredTimeout = Number(env("SUMMARY_WORKER_TIMEOUT_MS") ?? 25_000);
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.max(5_000, Math.min(45_000, Math.floor(configuredTimeout)))
    : 25_000;
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const workerId = `session-summary-worker:${crypto.randomUUID()}`;
  const { data: jobs, error: claimError } = await client.rpc("claim_session_summary_jobs", {
    p_worker_id: workerId,
    p_limit: limit,
  });
  if (claimError) return jsonResponse({ error: `Claim jobs: ${claimError.message}` }, 500);

  const results = await Promise.all(
    ((jobs ?? []) as SummaryJob[]).map((job) => processJob(client, job, timeoutMs)),
  );
  return jsonResponse({
    workerId,
    claimed: results.length,
    succeeded: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  });
});
