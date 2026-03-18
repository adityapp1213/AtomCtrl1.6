import { NextRequest, NextResponse } from "next/server";

const DEEPGRAM_TTS_MODEL = process.env.DEEPGRAM_TTS_MODEL || "aura-asteria-en";

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "DEEPGRAM_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const { text } = (await req.json()) as { text?: string };
    const trimmed = (text || "").trim();
    if (!trimmed) {
      return NextResponse.json(
        { error: "Missing text for TTS" },
        { status: 400 }
      );
    }

    const speakUrl = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(
      DEEPGRAM_TTS_MODEL
    )}`;

    const startTime = Date.now();

    const upstream = await fetch(speakUrl, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: trimmed }),
    });

    if (!upstream.ok || !upstream.body) {
      console.error("Deepgram TTS upstream error", upstream.status, upstream.statusText);
      return NextResponse.json(
        { error: "Deepgram TTS error" },
        { status: 500 }
      );
    }

    const transformer = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (Date.now() - startTime < 1000) {
          console.log("Deepgram TTS Time to First Byte (ms):", Date.now() - startTime);
        }
        controller.enqueue(chunk);
      },
    });

    const body = upstream.body.pipeThrough(transformer);

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("TTS route error", err);
    return NextResponse.json(
      { error: "Unexpected error during TTS" },
      { status: 500 }
    );
  }
}
