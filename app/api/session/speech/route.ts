import { z } from "zod";
import { requireStudent } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";
import { OpenAITutorSpeech, resolveTutorSpeechVoice } from "@/lib/tutor/speech";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tutorSpeechRequestSchema = z.object({
  sessionId: z.string().uuid(),
  messageId: z.string().trim().min(1).max(100),
});

export async function POST(request: Request) {
  try {
    const identity = await requireStudent();
    const input = tutorSpeechRequestSchema.parse(await request.json());
    const bundle = await getRepository().getSession(input.sessionId);
    if (!bundle) return Response.json({ error: "Session not found." }, { status: 404 });
    if (bundle.session.studentId !== identity.id) {
      return Response.json({ error: "This session belongs to another learner." }, { status: 403 });
    }

    const tutorMessage = bundle.session.messages.find((message) => message.id === input.messageId && message.sender === "ai");
    if (!tutorMessage) return Response.json({ error: "Tutor message not found." }, { status: 404 });

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return Response.json({ error: "Server tutor voice is not configured." }, { status: 503 });
    }

    try {
      const speech = new OpenAITutorSpeech(
        apiKey,
        process.env.OPENAI_TTS_MODEL?.trim() || undefined,
        resolveTutorSpeechVoice(process.env.OPENAI_TTS_VOICE),
      );
      const audio = await speech.synthesize(tutorMessage.content);
      return new Response(audio, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "private, no-store, max-age=0",
          "Content-Length": String(audio.byteLength),
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      const providerError = error as { _request_id?: string; request_id?: string; name?: string };
      console.error("Tutor speech generation failed", {
        provider: "openai",
        requestId: providerError._request_id ?? providerError.request_id ?? "unavailable",
        errorType: providerError.name ?? "Error",
      });
      return Response.json({ error: "Tutor voice is temporarily unavailable." }, { status: 503 });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
