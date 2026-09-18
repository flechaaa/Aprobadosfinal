import type { Question, ChallengeData } from '@/types';
import defaultQuestions from '@/data/Trivia_Infectologia.json';
import { supabase } from '@/lib/supabase';

const TIME_PER_QUESTION = 120;
export const QUESTIONS_PER_GAME = 5;

type SupabaseQuestionRow = Record<string, unknown>;

const QUESTION_FIELDS = 'question, options, correct_option, explanation, chair_id, subject_id, is_active';

type QuestionFilter = {
  column: 'chair_id' | 'subject_id';
  operator: 'eq' | 'in';
  value: string | string[];
};

function parseQuestionOptions(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((option): option is string => typeof option === 'string').map((option) => option.trim()).filter(Boolean);
  }

  if (typeof value !== 'string' || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((option): option is string => typeof option === 'string').map((option) => option.trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function serializeQuestion(row: SupabaseQuestionRow): Question | null {
  if (row.is_active === false) return null;

  const pregunta = typeof row.question === 'string' ? row.question.trim() : '';
  const opciones = parseQuestionOptions(row.options);
  const correcta = typeof row.correct_option === 'number' ? row.correct_option : Number(row.correct_option);

  if (!pregunta || opciones.length !== 4 || !Number.isInteger(correcta) || correcta < 0 || correcta >= 4) {
    return null;
  }

  return {
    pregunta,
    opciones,
    correcta,
    explicacion: typeof row.explanation === 'string' ? row.explanation : '',
  };
}

async function queryQuestionRows(filter?: QuestionFilter): Promise<SupabaseQuestionRow[]> {
  let query = supabase.from('questions').select(QUESTION_FIELDS).eq('is_active', true);
  if (filter) {
    query = filter.operator === 'in'
      ? query.in(filter.column, filter.value as string[])
      : query.eq(filter.column, filter.value as string);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('[queryQuestionRows] No se pudo consultar el esquema moderno de preguntas:', error);
    return [];
  }

  return Array.isArray(data) ? (data as unknown as SupabaseQuestionRow[]) : [];
}

async function queryChairIdsForSelection(selection: {
  universityId: string;
  subjectId: string;
}): Promise<string[]> {
  let subjectQuery = supabase.from('subjects').select('id').eq('university_id', selection.universityId);
  if (selection.subjectId !== 'all') {
    subjectQuery = subjectQuery.eq('id', selection.subjectId);
  }

  const { data: subjects, error: subjectsError } = await subjectQuery;
  if (subjectsError || !subjects?.length) return [];

  const subjectIds = subjects.map((subject) => subject.id);
  const { data: chairs, error: chairsError } = await supabase
    .from('chairs')
    .select('id')
    .in('subject_id', subjectIds);

  if (chairsError) return [];
  return (chairs ?? []).map((chair) => chair.id);
}

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
  chairId?: string;
}): Promise<Question[]> {
  try {
    const chairId = selection.chairId || 'all';
    console.log('[loadQuestionsForGame] filtros de entrada:', {
      chair_id: chairId,
      subject_id: selection.subjectId || null,
      university_id: selection.universityId || null,
    });

    let questionsData: SupabaseQuestionRow[] = [];
    // 1) Si el árbol ya trae una cátedra exacta, consultamos sólo por ese chair_id.
    if (chairId !== 'all') {
      const data = await queryQuestionRows({ column: 'chair_id', operator: 'eq', value: chairId });

      if (data.length > 0) {
        questionsData = data;
        console.log('[loadQuestionsForGame] coincidencias exactas por chair_id:', chairId, data.length);
      } else {
        console.warn('[loadQuestionsForGame] sin coincidencias exactas por chair_id=', chairId);
      }
    }

    // 2) Si no apareció el chair_id directo, resolve el subject_id a su nombre
    //    y hacemos un filtro de materia estricto, con una rama exclusiva para Infectología.
    if (questionsData.length === 0 && chairId === 'all' && selection.universityId && selection.subjectId) {
      const chairIds = await queryChairIdsForSelection(selection);
      if (chairIds.length > 0) {
        questionsData = await queryQuestionRows({ column: 'chair_id', operator: 'in', value: chairIds });
      }
    }

    console.log(`Preguntas recuperadas de Supabase (${questionsData.length}):`, questionsData);

    if (questionsData.length > 0) {
      const shuffled = [...questionsData].sort(() => Math.random() - 0.5);
      return shuffled.flatMap((row) => {
        const question = serializeQuestion(row);
        return question ? [question] : [];
      }).slice(0, QUESTIONS_PER_GAME);
    }
  } catch (err) {
    console.error('Error al cargar preguntas de Supabase:', err);
  }

  const selectionSummary = {
    universityId: selection.universityId,
    subjectId: selection.subjectId,
    chairId: selection.chairId || 'all',
  };
  console.error('[loadQuestionsForGame] No había preguntas en Supabase para este filtro. No se usó el fallback local de infectología.', selectionSummary);

  return [];
}

export async function loadRandomQuestionsForGame(count: number = QUESTIONS_PER_GAME): Promise<Question[]> {
  try {
    const data = await queryQuestionRows();
    if (data.length === 0) {
      return [];
    }

    const mapped = data.flatMap((row) => {
      const question = serializeQuestion(row);
      return question ? [question] : [];
    });

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