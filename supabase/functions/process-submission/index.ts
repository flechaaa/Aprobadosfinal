// supabase/functions/process-submission/index.ts
//
// Se dispara vía Database Webhook cuando se inserta una fila en `submissions`.
// Extrae preguntas con Groq (primario) / Gemini (fallback), asegura la
// taxonomía (universities/subjects/chairs) y guarda el resultado en
// `question_suggestions` para que el panel de admin las revise.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET')!;
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';

const GEMINI_MAX_RETRIES = 3;
const GEMINI_INITIAL_BACKOFF_MS = 2000;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface ExtractedQuestion {
  pregunta: string;
  opciones: string[];
  correcta: number;
  explicacion: string;
}

const CHUNK_MAX_CHARS = 6000;
const CHUNK_PAUSE_MS = 3000;

// ============================================================
// Prompts: uno para EXTRAER preguntas ya escritas (exámenes,
// pregunteros) y otro para GENERAR preguntas nuevas a partir de
// material de clase (apuntes, diapositivas, teoría).
// Los dos incluyen la regla anti-sesgo de longitud de opciones.
// ============================================================
const ANTI_BIAS_RULE = `
REGLA ANTI-SESGO (crítica): las 4 opciones de cada pregunta deben tener longitud y nivel de detalle SIMILAR entre sí. Nunca redactes la opción correcta como la más larga, la más desarrollada o la única con justificación agregada — eso le permite a cualquiera adivinar la respuesta por el largo del texto, sin saber el tema. Si hace falta, resumí la opción correcta o expandí los distractores para emparejar longitudes. Además, variá en qué posición (0, 1, 2 o 3) cae la respuesta correcta entre las distintas preguntas que generes — no la pongas siempre en el mismo índice.`;

function getExtractionPrompt(): string {
  return `
Sos un parser y docente médico especializado en estructurar exámenes choice.
Tu objetivo es extraer y normalizar TODAS las preguntas presentes en el fragmento de material provisto, sin omitir ninguna.

REGLAS CRÍTICAS:
1. Si el material contiene casos clínicos seriados (por ejemplo, una viñeta clínica común con varias preguntas derivadas 1, 2, 3...), generá una pregunta independiente para CADA sub-pregunta.
2. En cada una de esas preguntas, incluí en el enunciado un breve resumen o contexto del caso para que sea auto-explicativa al aparecer en el juego.
3. Extraé absolutamente todas las preguntas del fragmento (si hay 20 o 25, extraé todas).
4. 'correcta' debe ser el índice numérico de la opción correcta: 0 para la primera (A), 1 para la segunda (B), 2 para la tercera (C), 3 para la cuarta (D).
5. Proporcioná una breve justificación médica en 'explicacion'.
6. Si en el texto aparece una universidad, materia o cátedra escrita con tildes, acentos, mayúsculas, abreviaturas o espacios extra, normalizá la entidad de salida a la versión oficial canónica y limpia.
${ANTI_BIAS_RULE}

Devolvé estrictamente un JSON válido con este formato exacto:
{
  "preguntas": [
    {
      "pregunta": "[Caso Clínico / Contexto]: Enunciado exacto de la pregunta",
      "opciones": ["Opción A", "Opción B", "Opción C", "Opción D"],
      "correcta": 0,
      "explicacion": "Fundamentación concisa de la respuesta correcta."
    }
  ]
}
`;
}

function getGenerationPrompt(): string {
  return `
Sos un docente médico experto en crear exámenes de opción múltiple a partir de material de clase (apuntes, diapositivas, resúmenes teóricos).
El fragmento de material provisto NO contiene preguntas ya escritas — es contenido teórico. Tu trabajo es LEERLO, ENTENDERLO, e INVENTAR preguntas de opción múltiple originales que evalúen los conceptos médicos clave que aparecen en él.

REGLAS CRÍTICAS:
1. Generá entre 3 y 8 preguntas por este fragmento, según cuánto contenido relevante y evaluable tenga (no inventes preguntas triviales o de relleno si el fragmento es corto o poco sustancioso — en ese caso generá menos, o incluso ninguna si no hay nada evaluable).
2. Cada pregunta debe evaluar un concepto médico concreto que esté respaldado por el texto — no inventes datos, cifras ni afirmaciones que no estén en el material.
3. Los 3 distractores (opciones incorrectas) deben ser médicamente plausibles: errores conceptuales comunes de un estudiante, no opciones absurdas o evidentemente falsas.
4. 'correcta' es el índice numérico 0 (A), 1 (B), 2 (C) o 3 (D).
5. Escribí una explicación breve y concisa de por qué la respuesta correcta lo es, basada en el material.
6. Si en el texto aparece una universidad, materia o cátedra escrita con tildes, acentos, mayúsculas, abreviaturas o espacios extra, normalizá la entidad de salida a la versión oficial canónica y limpia.
${ANTI_BIAS_RULE}

Devolvé estrictamente un JSON válido con este formato exacto:
{
  "preguntas": [
    {
      "pregunta": "Enunciado claro y autosuficiente de la pregunta",
      "opciones": ["Opción A", "Opción B", "Opción C", "Opción D"],
      "correcta": 0,
      "explicacion": "Fundamentación concisa basada en el material."
    }
  ]
}
`;
}

// ============================================================
// Fraccionamiento: parte un texto largo en fragmentos manejables
// por párrafos, para no mandar una clase entera en un solo pedido
// (evita agotar tokens/contexto de golpe).
// ============================================================
function splitIntoChunks(text: string, maxChunkChars = CHUNK_MAX_CHARS): string[] {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChunkChars && current.length > 0) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current.trim().length > 0) chunks.push(current.trim());

  // Si un párrafo individual supera el límite (poco frecuente), se parte a la fuerza.
  return chunks.flatMap((chunk) => {
    if (chunk.length <= maxChunkChars) return [chunk];
    const pieces: string[] = [];
    for (let i = 0; i < chunk.length; i += maxChunkChars) {
      pieces.push(chunk.slice(i, i + maxChunkChars));
    }
    return pieces;
  });
}

// ============================================================
// Gemini: reintentos (igual que fetchGeminiWithRetry del frontend)
// ============================================================
function parseRetryDelayMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value.replace(/s$/i, '').trim());
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

async function getSuggestedRetryDelayMs(response: Response): Promise<number | null> {
  const retryAfter = parseRetryDelayMs(response.headers.get('retry-after'));
  if (retryAfter !== null) return retryAfter;
  try {
    const body = await response.clone().json();
    return parseRetryDelayMs(body?.error?.details?.find((d: { retryDelay?: string }) => d.retryDelay)?.retryDelay ?? null);
  } catch {
    return null;
  }
}

async function fetchGeminiWithRetry(url: string, body: unknown, operation: string): Promise<Response> {
  for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt += 1) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.status === 429) return response;

    const retryable = response.status === 503;
    if (!retryable || attempt === GEMINI_MAX_RETRIES) return response;

    const suggestedDelay = await getSuggestedRetryDelayMs(response);
    const exponentialDelay = GEMINI_INITIAL_BACKOFF_MS * 2 ** attempt;
    const jitter = Math.floor(Math.random() * 500);
    const delay = Math.max(suggestedDelay ?? 0, exponentialDelay + jitter);
    console.warn(`[AI] Gemini ${response.status} (${operation}). Reintentando en ${Math.ceil(delay / 1000)}s (${attempt + 1}/${GEMINI_MAX_RETRIES})...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw new Error(`Gemini no pudo procesar ${operation} después de los reintentos.`);
}

async function throwGeminiResponseError(response: Response, operation: string): Promise<never> {
  const errorText = await response.text();
  if (response.status === 429 || errorText.includes('RESOURCE_EXHAUSTED')) {
    throw new Error(`Cuota de Gemini agotada al ${operation}.`);
  }
  throw new Error(`Gemini HTTP ${response.status} al ${operation}: ${errorText}`);
}

// ============================================================
// Groq (idéntico a callGroq del frontend)
// ============================================================
async function callGroq(textContent: string, prompt: string): Promise<ExtractedQuestion[]> {
  if (!GROQ_API_KEY) throw new Error('Sin GROQ_API_KEY');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Texto completo del examen:\n\n${textContent}` },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  return Array.isArray(parsed.preguntas) ? parsed.preguntas : Array.isArray(parsed.questions) ? parsed.questions : [];
}

// ============================================================
// Gemini texto (idéntico a callGemini del frontend)
// ============================================================
async function callGemini(textContent: string, prompt: string): Promise<ExtractedQuestion[]> {
  if (!GEMINI_API_KEY) throw new Error('Sin GEMINI_API_KEY');

  const res = await fetchGeminiWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt }, { text: `Texto completo del examen:\n\n${textContent}` }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    },
    'la extracción de texto',
  );

  if (!res.ok) return throwGeminiResponseError(res, 'la extracción de texto');

  const data = await res.json();
  const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const parsed = JSON.parse(rawContent);
  return Array.isArray(parsed.preguntas) ? parsed.preguntas : Array.isArray(parsed.questions) ? parsed.questions : [];
}

// ============================================================
// Gemini visión (idéntico a extractQuestionFromImage del frontend)
// ============================================================
function parseJsonResponse(rawContent: string): Record<string, unknown> {
  const withoutMarkdown = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(withoutMarkdown);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('La IA devolvió un JSON inválido.');
  }
  return parsed as Record<string, unknown>;
}

function normalizeVisionQuestion(value: Record<string, unknown>): ExtractedQuestion {
  const pregunta = typeof value.pregunta === 'string' ? value.pregunta.trim() : '';
  const opciones = Array.isArray(value.opciones)
    ? value.opciones.filter((o): o is string => typeof o === 'string').map((o) => o.trim())
    : [];
  const rawCorrect = value.respuesta_correcta ?? value.correcta;
  const correcta = typeof rawCorrect === 'number'
    ? rawCorrect
    : opciones.findIndex((o) => o.toLocaleLowerCase() === String(rawCorrect ?? '').trim().toLocaleLowerCase());
  const explicacion = typeof value.explicacion === 'string' ? value.explicacion.trim() : '';

  if (!pregunta || opciones.length !== 4 || !Number.isInteger(correcta) || correcta < 0 || correcta > 3 || !explicacion) {
    throw new Error('La IA no devolvió una pregunta completa con 4 opciones y explicación.');
  }

  return { pregunta, opciones, correcta, explicacion };
}

async function extractQuestionFromImage(imageUrl: string): Promise<ExtractedQuestion> {
  if (!GEMINI_API_KEY) throw new Error('No hay GEMINI_API_KEY configurada.');

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) throw new Error(`No se pudo descargar la imagen (${imageResponse.status}).`);
  const buffer = await imageResponse.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const imageBase64 = btoa(binary);
  const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';

  const prompt = `Analizá esta diapositiva médica y generá una sola pregunta de opción múltiple basada únicamente en su contenido.
Devolvé estrictamente JSON válido con esta estructura exacta:
{
  "pregunta": "Enunciado claro y autosuficiente",
  "opciones": ["Opción A", "Opción B", "Opción C", "Opción D"],
  "respuesta_correcta": 0,
  "explicacion": "Explicación médica basada en la diapositiva"
}
respuesta_correcta debe ser el índice numérico 0, 1, 2 o 3. No inventes datos que no estén respaldados por la diapositiva.`;

  const response = await fetchGeminiWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    },
    'el análisis de imagen',
  );

  if (!response.ok) return throwGeminiResponseError(response, 'el análisis de imagen');

  const data = await response.json();
  const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof rawContent !== 'string' || !rawContent.trim()) throw new Error('La IA no devolvió contenido para la imagen.');
  return normalizeVisionQuestion(parseJsonResponse(rawContent));
}

// ============================================================
// Taxonomía (equivalente a ensureTaxonomyFromSubmission del frontend)
// ============================================================
function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

async function ensureTaxonomy(university: string, subject: string, chair: string) {
  const { data: universities } = await supabase.from('universities').select('id, name');
  let uni = (universities ?? []).find((u) => normalize(u.name) === normalize(university));
  if (!uni) {
    const { data: newUni, error } = await supabase.from('universities').insert({ name: university }).select('id, name').single();
    if (error) throw new Error('No se pudo crear la universidad: ' + error.message);
    uni = newUni;
  }

  const { data: subjects } = await supabase.from('subjects').select('id, name').eq('university_id', uni.id);
  let subj = (subjects ?? []).find((s) => normalize(s.name) === normalize(subject));
  if (!subj) {
    const { data: newSubj, error } = await supabase.from('subjects').insert({ name: subject, university_id: uni.id }).select('id, name').single();
    if (error) throw new Error('No se pudo crear la materia: ' + error.message);
    subj = newSubj;
  }

  const { data: chairs } = await supabase.from('chairs').select('id, name').eq('subject_id', subj.id);
  let ch = (chairs ?? []).find((c) => normalize(c.name) === normalize(chair));
  if (!ch) {
    const { data: newCh, error } = await supabase.from('chairs').insert({ name: chair, subject_id: subj.id }).select('id, name').single();
    if (error) throw new Error('No se pudo crear la cátedra: ' + error.message);
    ch = newCh;
  }

  return { universityId: uni.id, subjectId: subj.id, chairId: ch.id };
}

// ============================================================
// Handler principal
// ============================================================
Deno.serve(async (req) => {
  let submissionId: string | undefined;

  try {
    const secret = req.headers.get('x-webhook-secret');
    if (secret !== WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    const payload = await req.json();
    const submission = payload.record;
    submissionId = submission?.id;

    if (!submissionId) {
      return new Response('Payload inválido', { status: 400 });
    }

    await supabase.from('submissions').update({ processing_status: 'procesando' }).eq('id', submissionId);

    const isImage = (submission.file_type ?? '').startsWith('image/');
    let extracted: ExtractedQuestion[] = [];

    if (isImage) {
      extracted = [await extractQuestionFromImage(submission.file_url)];
    } else {
      const text: string | null = submission.processed_text;
      if (!text || text.trim().length < 20) {
        throw new Error('El material no tiene texto extraído (processed_text vacío). Revisá que el frontend lo esté enviando.');
      }

      const isGenerationMode = submission.material_type === 'apunte';
      const prompt = isGenerationMode ? getGenerationPrompt() : getExtractionPrompt();
      const chunks = splitIntoChunks(text);
      console.info(`[AI] Material dividido en ${chunks.length} fragmento(s). Modo: ${isGenerationMode ? 'generación' : 'extracción'}.`);

      let groqError = '';
      let geminiError = '';

      for (const [index, chunk] of chunks.entries()) {
        let chunkQuestions: ExtractedQuestion[] = [];

        if (GROQ_API_KEY) {
          try {
            chunkQuestions = await callGroq(chunk, prompt);
          } catch (err) {
            console.warn(`[AI] Falló Groq en fragmento ${index + 1}/${chunks.length}, derivando a Gemini:`, err);
            groqError = err instanceof Error ? err.message : String(err);
          }
        } else {
          groqError = 'GROQ_API_KEY no configurada.';
        }

        if (chunkQuestions.length === 0 && GEMINI_API_KEY) {
          try {
            chunkQuestions = await callGemini(chunk, prompt);
          } catch (err) {
            console.error(`[AI] Falló Gemini en fragmento ${index + 1}/${chunks.length}:`, err);
            geminiError = err instanceof Error ? err.message : String(err);
          }
        }

        extracted.push(...chunkQuestions);

        if (index < chunks.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, CHUNK_PAUSE_MS));
        }
      }

      if (extracted.length === 0) {
        throw new Error(`No se pudieron extraer preguntas. Groq: ${groqError || 'no intentado'}. Gemini: ${geminiError || 'no intentado'}.`);
      }
    }

    const taxonomy = await ensureTaxonomy(submission.university, submission.subject, submission.chair);

    const rows = extracted.map((q) => ({
      university_id: taxonomy.universityId,
      subject_id: taxonomy.subjectId,
      chair_id: taxonomy.chairId,
      unit_name: submission.unit ?? null,
      question_text: q.pregunta,
      options: q.opciones,
      correct_option: q.correcta,
      explanation: q.explicacion ?? '',
      difficulty: 'media',
      status: 'pending',
      source_submission_id: submissionId,
      source_file_url: submission.file_url,
      source_storage_path: submission.storage_path ?? null,
    }));

    const { error: insertError } = await supabase.from('question_suggestions').insert(rows);
    if (insertError) throw new Error('No se pudieron guardar las preguntas: ' + insertError.message);

    await supabase.from('submissions').update({
      processing_status: 'procesado',
      processed: true,
      processing_error: null,
    }).eq('id', submissionId);

    return new Response(JSON.stringify({ ok: true, count: rows.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error procesando submission:', error);
    if (submissionId) {
      await supabase.from('submissions').update({
        processing_status: 'error',
        processing_error: error instanceof Error ? error.message : String(error),
      }).eq('id', submissionId);
    }
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
