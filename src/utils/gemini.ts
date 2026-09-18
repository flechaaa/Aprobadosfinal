import type { Question } from '@/types';

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || '';
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const GEMINI_MAX_RETRIES = 3;
const GEMINI_INITIAL_BACKOFF_MS = 2000;

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

    const retryable = response.status === 429 || response.status === 503;
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

function getSystemPrompt(): string {
  return `
Sos un parser y docente médico especializado en estructurar exámenes choice.
Tu objetivo es extraer y normalizar TODAS las preguntas presentes en el material provisto, sin omitir ninguna.

REGLAS CRÍTICAS:
1. Si el material contiene casos clínicos seriados (por ejemplo, una viñeta clínica común con varias preguntas derivadas 1, 2, 3...), generá una pregunta independiente para CADA sub-pregunta.
2. En cada una de esas preguntas, incluí en el enunciado un breve resumen o contexto del caso para que sea auto-explicativa al aparecer en el juego.
3. Extraé absolutamente todas las preguntas (si hay 20 o 25, extraé todas).
4. 'correcta' debe ser el índice numérico de la opción correcta: 0 para la primera (A), 1 para la segunda (B), 2 para la tercera (C), 3 para la cuarta (D).
5. Proporcioná una breve justificación médica en 'explicacion'.
6. Si en el texto aparece una universidad, materia o cátedra escrita con tildes, acentos, mayúsculas, abreviaturas o espacios extra, normalizá la entidad de salida a la versión oficial canónica y limpia (por ejemplo: 'uba', 'u.b.a' o 'Universidad de Buenos Aires' -> 'Universidad de Buenos Aires'; 'Médicina' -> 'Medicina'; 'Fundación' -> 'Fundacion' si la forma canónica del material usa esa salida, o la versión con acentos eliminados según la base esperada).

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

// Llamada a Gemini con reintento ante error 503
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
  _onProgress?: (current: number, total: number) => void
): Promise<{ questions: Question[]; error?: string }> {
  try {
    const prompt = getSystemPrompt();
    let questions: Question[] = [];
    let lastError = '';

    // 1. Intentar primero con Groq (alta disponibilidad)
    if (GROQ_API_KEY) {
      try {
        console.log('[AI] Procesando examen con Groq...');
        questions = await callGroq(textContent, prompt);
      } catch (err: any) {
        console.warn('[AI] Falló Groq, derivando a Gemini:', err.message);
        lastError = err.message;
      }
    }

    // 2. Si Groq no está o falló, usar Gemini
    if (questions.length === 0 && GEMINI_API_KEY) {
      try {
        console.log('[AI] Procesando examen con Gemini...');
        questions = await callGemini(textContent, prompt);
      } catch (err: any) {
        console.error('[AI] Falló Gemini:', err.message);
        lastError = err.message;
      }
    }

    if (questions.length === 0) {
      return {
        questions: [],
        error: `No se pudieron extraer preguntas. Detalle: ${lastError}`,
      };
    }

    return { questions };
  } catch (err: any) {
    return { questions: [], error: err.message || 'Error inesperado al procesar el archivo.' };
  }
}