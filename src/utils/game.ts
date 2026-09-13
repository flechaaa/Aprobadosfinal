import type { Question, ChallengeData } from '@/types';
import defaultQuestions from '@/data/Trivia_Infectologia.json';
import { supabase } from '@/lib/supabase';

const TIME_PER_QUESTION = 25;
export const QUESTIONS_PER_GAME = 5;

export function getAllQuestions(): Question[] {
  return defaultQuestions as Question[];
}

/**
 * Carga preguntas dinámicamente desde Supabase según la materia o cátedra seleccionada.
 */
export async function loadQuestionsForGame(selection: {
  universityId: string;
  subjectId: string;
  chairId: string;
}): Promise<Question[]> {
  try {
    console.log('Iniciando carga de preguntas para:', selection);

    let questionsData: any[] = [];
    const fieldsToSelect = 'id, question, options, correct_option, explanation, chair_id, subject';

    // 1. Si eligió una cátedra específica, buscar por chair_id
    if (selection.chairId && selection.chairId !== 'all') {
      const { data, error } = await supabase
        .from('questions')
        .select(fieldsToSelect)
        .eq('chair_id', selection.chairId)
        .eq('active', true);

      if (!error && data && data.length > 0) {
        questionsData = data;
      }
    }

    // 2. Si no hay preguntas por cátedra exacta (o eligió "Todas"), buscar por cátedras de esa materia
    if (questionsData.length === 0 && selection.subjectId) {
      const { data: chairsData } = await supabase
        .from('chairs')
        .select('id')
        .eq('subject_id', selection.subjectId);

      const chairIds = (chairsData || []).map((c) => c.id);

      if (chairIds.length > 0) {
        const { data: matQuestions, error: matErr } = await supabase
          .from('questions')
          .select(fieldsToSelect)
          .in('chair_id', chairIds)
          .eq('active', true);

        if (!matErr && matQuestions && matQuestions.length > 0) {
          questionsData = matQuestions;
        }
      }
    }

    // 3. Respaldo por texto: buscar directamente por el nombre de la materia en la tabla questions
    if (questionsData.length === 0 && selection.subjectId) {
      const { data: subObj } = await supabase
        .from('subjects')
        .select('name')
        .eq('id', selection.subjectId)
        .single();

      if (subObj?.name) {
        const { data: textQuestions, error: textErr } = await supabase
          .from('questions')
          .select(fieldsToSelect)
          .ilike('subject', `%${subObj.name.trim()}%`)
          .eq('active', true);

        if (!textErr && textQuestions && textQuestions.length > 0) {
          questionsData = textQuestions;
        }
      }
    }

    console.log(`Preguntas recuperadas de Supabase (${questionsData.length}):`, questionsData);

    if (questionsData.length > 0) {
      const shuffled = [...questionsData].sort(() => Math.random() - 0.5);
      // Tomamos exactamente QUESTIONS_PER_GAME (5)
      return shuffled.slice(0, QUESTIONS_PER_GAME).map((q) => ({
        pregunta: q.question,
        opciones: Array.isArray(q.options)
          ? q.options
          : typeof q.options === 'string'
          ? JSON.parse(q.options)
          : [],
        correcta: Number(q.correct_option),
        explicacion: q.explanation || '',
      }));
    }
  } catch (err) {
    console.error('Error al cargar preguntas de Supabase:', err);
  }

  console.warn('No se encontraron preguntas en Supabase para este filtro. Se usará el banco de respaldo (Infectología).');
  const fallback = [...(defaultQuestions as Question[])].sort(() => Math.random() - 0.5);
  return fallback.slice(0, QUESTIONS_PER_GAME);
}

export function selectRandomQuestions(count: number = QUESTIONS_PER_GAME): number[] {
  const total = (defaultQuestions as Question[]).length;
  const indices = Array.from({ length: total }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, Math.min(count, total));
}

export function encodeChallenge(data: ChallengeData): string {
  return btoa(encodeURIComponent(JSON.stringify(data)));
}

export function decodeChallenge(encoded: string): ChallengeData | null {
  try {
    return JSON.parse(decodeURIComponent(atob(encoded)));
  } catch {
    return null;
  }
}

export function calculatePoints(timeLeft: number): number {
  const basePoints = 100;
  const timeBonus = Math.round((timeLeft / TIME_PER_QUESTION) * 100);
  return basePoints + timeBonus;
}

export { TIME_PER_QUESTION };