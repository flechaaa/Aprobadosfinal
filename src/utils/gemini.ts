import type { Question } from '@/types';

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || '';
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const GEMINI_MAX_RETRIES = 3;
const GEMINI_INITIAL_BACKOFF_MS = 2000;
const CHUNK_MAX_CHARS = 6000;
const CHUNK_PAUSE_MS = 3000;

function parseRetryDelayMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value.replace(/s$/i, '').trim());
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

async function getSuggestedRetryDelayMs(response: Response): Promise<number | null> {
  const retryAfter = parseRetryDelayMs(response.headers.get('retry-after'));
  if (retryAfter !== null) return retryAfter;

  try {
    const body = await response.clone().json() as { error?: { details?: Array<{ retryDelay?: string }> } };
    return parseRetryDelayMs(body.error?.details?.find((detail) => detail.retryDelay)?.retryDelay ?? null);
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

    // 429 = cuota agotada: reintentar no ayuda, falla rápido y deja que la cola espere con el enfriamiento.
    if (response.status === 429) {
      return response;
    }

    const retryable = response.status === 503;
    if (!retryable || attempt === GEMINI_MAX_RETRIES) {
      return response;
    }

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
    throw new Error(`Cuota de Gemini agotada al ${operation}. Se reintentó automáticamente; dejá el aporte en estado pendiente y probá más tarde.`);
  }
  throw new Error(`Gemini HTTP ${response.status} al ${operation}: ${errorText}`);
}

// ============================================================
// Prompts: uno para EXTRAER preguntas ya escritas (exámenes,
// pregunteros) y otro para GENERAR preguntas nuevas a partir de
// material de clase (apuntes, diapositivas, teoría). Idénticos a
// los de la Edge Function (supabase/functions/process-submission).
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
// por párrafos, para no mandar una clase entera en un solo pedido.
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

  return chunks.flatMap((chunk) => {
    if (chunk.length <= maxChunkChars) return [chunk];
    const pieces: string[] = [];
    for (let i = 0; i < chunk.length; i += maxChunkChars) {
      pieces.push(chunk.slice(i, i + maxChunkChars));
    }
    return pieces;
  });
}

// Llamada a Groq (rápido y sin saturación)
async function callGroq(textContent: string, prompt: string): Promise<Question[]> {
  if (!GROQ_API_KEY) throw new Error('Sin GROQ_API_KEY');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
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

// Llamada a Gemini usando el modelo correcto y estable
async function callGemini(textContent: string, prompt: string): Promise<Question[]> {
  if (!GEMINI_API_KEY) throw new Error('Sin GEMINI_API_KEY');

  const res = await fetchGeminiWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
        contents: [
          {
            parts: [
              { text: prompt },
              { text: `Texto completo del examen:\n\n${textContent}` },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
    },
    'la extracción de texto',
  );

  if (!res.ok) {
    return throwGeminiResponseError(res, 'la extracción de texto');
  }

  const data = await res.json();
  const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const parsed = JSON.parse(rawContent);

  return Array.isArray(parsed.preguntas) ? parsed.preguntas : Array.isArray(parsed.questions) ? parsed.questions : [];
}

function parseJsonResponse(rawContent: string): Record<string, unknown> {
  const withoutMarkdown = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed: unknown = JSON.parse(withoutMarkdown);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('La IA devolvió un JSON inválido.');
  }
  return parsed as Record<string, unknown>;
}

function normalizeVisionQuestion(value: Record<string, unknown>): Question {
  const pregunta = typeof value.pregunta === 'string' ? value.pregunta.trim() : '';
  const opciones = Array.isArray(value.opciones)
    ? value.opciones.filter((option): option is string => typeof option === 'string').map((option) => option.trim())
    : [];
  const rawCorrect = value.respuesta_correcta ?? value.correcta;
  const correcta = typeof rawCorrect === 'number'
    ? rawCorrect
    : opciones.findIndex((option) => option.toLocaleLowerCase() === String(rawCorrect ?? '').trim().toLocaleLowerCase());
  const explicacion = typeof value.explicacion === 'string' ? value.explicacion.trim() : '';

  if (!pregunta || opciones.length !== 4 || !Number.isInteger(correcta) || correcta < 0 || correcta > 3 || !explicacion) {
    throw new Error('La IA no devolvió una pregunta completa con 4 opciones y explicación.');
  }

  return { pregunta, opciones, correcta, explicacion };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export async function extractQuestionFromImage(imageUrl: string, mimeType = 'image/jpeg'): Promise<Question> {
  if (!GEMINI_API_KEY) throw new Error('No hay VITE_GEMINI_API_KEY configurada para procesar imágenes.');

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) throw new Error(`No se pudo descargar la imagen (${imageResponse.status}).`);
  const imageBlob = await imageResponse.blob();
  const imageBase64 = await blobToBase64(imageBlob);
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
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: imageBlob.type || mimeType, data: imageBase64 } }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    },
    'el análisis de imagen',
  );

  if (!response.ok) {
    return throwGeminiResponseError(response, 'el análisis de imagen');
  }

  const data = await response.json();
  const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof rawContent !== 'string' || !rawContent.trim()) throw new Error('La IA no devolvió contenido para la imagen.');
  return normalizeVisionQuestion(parseJsonResponse(rawContent));
}

export async function extractQuestionsFromFile(
  textContent: string,
  onProgress?: (current: number, total: number) => void,
  materialType?: string,
): Promise<{ questions: Question[]; error?: string }> {
  try {
    const isGenerationMode = materialType === 'apunte';
    const prompt = isGenerationMode ? getGenerationPrompt() : getExtractionPrompt();
    const chunks = splitIntoChunks(textContent);
    console.log(`[AI] Material dividido en ${chunks.length} fragmento(s). Modo: ${isGenerationMode ? 'generación' : 'extracción'}.`);

    let questions: Question[] = [];
    let groqError = '';
    let geminiError = '';

    for (const [index, chunk] of chunks.entries()) {
      onProgress?.(index + 1, chunks.length);
      let chunkQuestions: Question[] = [];

      if (GROQ_API_KEY) {
        try {
          console.log(`[AI] Procesando fragmento ${index + 1}/${chunks.length} con Groq...`);
          chunkQuestions = await callGroq(chunk, prompt);
        } catch (err: any) {
          console.warn(`[AI] Falló Groq en fragmento ${index + 1}, derivando a Gemini:`, err.message);
          groqError = err.message;
        }
      }

      if (chunkQuestions.length === 0 && GEMINI_API_KEY) {
        try {
          console.log(`[AI] Procesando fragmento ${index + 1}/${chunks.length} con Gemini...`);
          chunkQuestions = await callGemini(chunk, prompt);
        } catch (err: any) {
          console.error(`[AI] Falló Gemini en fragmento ${index + 1}:`, err.message);
          geminiError = err.message;
        }
      }

      questions.push(...chunkQuestions);

      if (index < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, CHUNK_PAUSE_MS));
      }
    }

    if (questions.length === 0) {
      return {
        questions: [],
        error: `No se pudieron extraer preguntas. Groq: ${groqError || 'no intentado'}. Gemini: ${geminiError || 'no intentado'}.`,
      };
    }

    return { questions };
  } catch (err: any) {
    return { questions: [], error: err.message || 'Error inesperado al procesar el archivo.' };
  }
}
