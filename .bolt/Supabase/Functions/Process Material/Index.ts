import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Question {
  pregunta: string;
  opciones: string[];
  correcta: number;
  explicacion: string;
}

function detectIsPreguntero(text: string): boolean {
  const matchOptions = (text.match(/(?:^[a-dA-D][\)\.-]|\([a-dA-D]\))/gm) || []).length;
  const matchQuestions = (text.match(/(?:\d+[\)\.-]|\¿)/gm) || []).length;
  return matchOptions >= 4 && matchQuestions >= 2;
}

function splitTextIntoChunks(text: string, chunkSize = 7000): string[] {
  const chunks: string[] = [];
  let currentPos = 0;
  while (currentPos < text.length) {
    let endPos = currentPos + chunkSize;
    if (endPos < text.length) {
      const lastNewline = text.lastIndexOf("\n", endPos);
      if (lastNewline > currentPos + chunkSize * 0.7) {
        endPos = lastNewline;
      }
    }
    chunks.push(text.slice(currentPos, endPos));
    currentPos = endPos;
  }
  return chunks;
}

function getSystemPrompt(isPreguntero: boolean): string {
  if (isPreguntero) {
    return `Sos un parser médico. Extraé textualmente las preguntas choice del texto y normalizalas.
Devolvé entre 4 y 8 preguntas si las hay. 'correcta' debe ser el índice numérico (0=A, 1=B, 2=C, 3=D).
Devolvé estrictamente un JSON válido:
{
  "preguntas": [
    {
      "pregunta": "Texto",
      "opciones": ["Opción A", "Opción B", "Opción C", "Opción D"],
      "correcta": 0,
      "explicacion": "Fundamentación breve."
    }
  ]
}`;
  }
  return `Sos un docente médico. Generá entre 3 y 5 preguntas choice relevantes a partir del texto provisto.
Alterná de forma balanceada la posición de 'correcta' entre 0, 1, 2 y 3.
Devolvé estrictamente un JSON válido:
{
  "preguntas": [
    {
      "pregunta": "¿...?",
      "opciones": ["Opción A", "Opción B", "Opción C", "Opción D"],
      "correcta": 0,
      "explicacion": "Justificación clínica."
    }
  ]
}`;
}

async function callGroq(chunk: string, prompt: string, groqKey: string): Promise<Question[]> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `Texto médico:\n\n${chunk}` },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  return Array.isArray(parsed.preguntas) ? parsed.preguntas : [];
}

async function callGemini(chunk: string, prompt: string, geminiKey: string): Promise<Question[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          { parts: [{ text: prompt }, { text: `Texto médico:\n\n${chunk}` }] },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
    }
  );

  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  const parsed = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
  return Array.isArray(parsed.preguntas) ? parsed.preguntas : [];
}

async function processSubmissionJob(submissionId: string, fileUrl: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const groqKey = Deno.env.get("GROQ_API_KEY") || "";
  const geminiKey = Deno.env.get("GEMINI_API_KEY") || "";

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    await supabase
      .from("submissions")
      .update({ status: "processing" })
      .eq("id", submissionId);

    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) throw new Error("No se pudo descargar el archivo de Storage.");
    const textContent = await fileRes.text();

    if (!textContent || textContent.trim().length < 20) {
      throw new Error("El archivo no contiene texto legible suficiente.");
    }

    const isPreguntero = detectIsPreguntero(textContent);
    const prompt = getSystemPrompt(isPreguntero);
    const chunks = splitTextIntoChunks(textContent, 7000).slice(0, 3);
    const allQuestions: Question[] = [];

    for (const chunk of chunks) {
      let questions: Question[] = [];
      try {
        if (groqKey) questions = await callGroq(chunk, prompt, groqKey);
      } catch {
        if (geminiKey) questions = await callGemini(chunk, prompt, geminiKey);
      }

      if (questions.length > 0) allQuestions.push(...questions);
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (allQuestions.length === 0) {
      throw new Error("La IA no pudo estructurar preguntas.");
    }

    await supabase
      .from("submissions")
      .update({
        extracted_questions: allQuestions,
        status: "ready_for_review",
        processing_error: null,
      })
      .eq("id", submissionId);

  } catch (err: any) {
    await supabase
      .from("submissions")
      .update({
        status: "failed",
        processing_error: err.message || "Error desconocido",
      })
      .eq("id", submissionId);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { record } = await req.json();

    if (!record?.id || !record?.file_url) {
      return new Response(JSON.stringify({ error: "Datos de envío inválidos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // @ts-ignore
    EdgeRuntime.waitUntil(processSubmissionJob(record.id, record.file_url));

    return new Response(
      JSON.stringify({ message: "Procesamiento en segundo plano iniciado" }),
      {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});