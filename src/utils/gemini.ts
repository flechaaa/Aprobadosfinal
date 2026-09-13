import type { Question } from '@/types';

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || '';
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

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
async function callGemini(textContent: string, prompt: string, attempt = 1): Promise<Question[]> {
  if (!GEMINI_API_KEY) throw new Error('Sin GEMINI_API_KEY');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
      }),
    }
  );

  // Si Gemini está saturado (503), espera 3 segundos y reintenta una vez
  if (res.status === 503 && attempt <= 2) {
    console.warn(`[AI] Gemini 503 (servidores llenos). Reintentando en 3s (intento ${attempt})...`);
    await new Promise((r) => setTimeout(r, 3000));
    return callGemini(textContent, prompt, attempt + 1);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const parsed = JSON.parse(rawContent);

  return Array.isArray(parsed.preguntas) ? parsed.preguntas : Array.isArray(parsed.questions) ? parsed.questions : [];
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