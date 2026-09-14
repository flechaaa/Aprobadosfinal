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
 * Si no hay datos en Supabase para ese filtro, devolvemos [] en lugar de mezclar con
 * un JSON local de infectología.
 */
export async function loadQuestionsForGame(selection: {
  universityId: string;
  subjectId: string;
  chairId: string;
}): Promise<Question[]> {
  try {
    console.log('[loadQuestionsForGame] filtros de entrada:', {
      chair_id: selection.chairId || null,
      subject_id: selection.subjectId || null,
      university_id: selection.universityId || null,
    });

    let questionsData: any[] = [];
    const fieldsToSelect = 'id, question, options, correct_option, explanation, chair_id, subject, university, chair';

    // 1) Si el árbol ya trae una cátedra exacta, consultamos sólo por ese chair_id.
    if (selection.chairId && selection.chairId !== 'all') {
      const { data, error } = await supabase
        .from('questions')
        .select(fieldsToSelect)
        .eq('chair_id', selection.chairId);

      if (error) {
        console.error('[loadQuestionsForGame] Error al consultar Supabase por chair_id:', selection.chairId, error);
      } else if (data && data.length > 0) {
        questionsData = data;
        console.log('[loadQuestionsForGame] coincidencias exactas por chair_id:', selection.chairId, data.length);
      } else {
        console.warn('[loadQuestionsForGame] sin coincidencias exactas por chair_id=', selection.chairId);
      }
    }

    // 2) Si no apareció el chair_id directo, resolve el subject_id a su nombre
    //    y hacemos un filtro de materia estricto, con una rama exclusiva para Infectología.
    if (questionsData.length === 0 && selection.subjectId) {
      const { data: subjectData, error: subjectError } = await supabase
        .from('subjects')
        .select('name')
        .eq('id', selection.subjectId)
        .maybeSingle();

      if (subjectError) {
        console.error('[loadQuestionsForGame] Error al resolver subject_id:', selection.subjectId, subjectError);
      }

      if (subjectData?.name) {
        const subjectName = subjectData.name.trim();
        const isInfectologia = subjectName.toLowerCase().includes('infecto');

        console.log('[loadQuestionsForGame] filtro de subject:', subjectName, 'isInfectologia=', isInfectologia);

        let subjectQuery = supabase
          .from('questions')
          .select(fieldsToSelect);

        if (isInfectologia) {
          subjectQuery = subjectQuery.ilike('subject', '%Infecto%');
        } else {
          subjectQuery = subjectQuery.eq('subject', subjectName);
        }

        const { data: subjectQuestions, error: subjectErrorRows } = await subjectQuery;

        if (subjectErrorRows) {
          console.error('[loadQuestionsForGame] Error al consultar Supabase por subject:', subjectName, subjectErrorRows);
        } else if (subjectQuestions && subjectQuestions.length > 0) {
          questionsData = subjectQuestions;
          console.log('[loadQuestionsForGame] coincidencias de subject:', subjectName, subjectQuestions.length);
        } else {
          console.warn('[loadQuestionsForGame] sin coincidencias de subject=', subjectName);
        }
      }
    }

    console.log(`Preguntas recuperadas de Supabase (${questionsData.length}):`, questionsData);

    if (questionsData.length > 0) {
      const shuffled = [...questionsData].sort(() => Math.random() - 0.5);
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

  const selectionSummary = {
    universityId: selection.universityId,
    subjectId: selection.subjectId,
    chairId: selection.chairId,
  };
  console.error('[loadQuestionsForGame] No había preguntas en Supabase para este filtro. No se usó el fallback local de infectología.', selectionSummary);

  return [];
}

export async function loadRandomQuestionsForGame(count: number = QUESTIONS_PER_GAME): Promise<Question[]> {
  try {
    const fieldsToSelect = 'id, question, options, correct_option, explanation, chair_id, subject';
    const { data, error } = await supabase
      .from('questions')
      .select(fieldsToSelect);

    if (error) {
      console.error('[loadRandomQuestionsForGame] Error al consultar Supabase:', error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    const mapped = data.map((q: any) => ({
      pregunta: q.question,
      opciones: Array.isArray(q.options)
        ? q.options
        : typeof q.options === 'string'
        ? JSON.parse(q.options)
        : [],
      correcta: Number(q.correct_option),
      explicacion: q.explanation || '',
    }));

    const shuffled = [...mapped].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, mapped.length));
  } catch (err) {
    console.error('Error al cargar preguntas aleatorias de Supabase:', err);
    return [];
  }
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