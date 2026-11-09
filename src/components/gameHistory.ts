import { supabase } from '@/lib/supabase';

export interface GameHistoryQuestion {
  pregunta: string;
  opciones: string[];
  correcta: number;
  explicacion: string;
  selectedIndex: number | null;
  correct: boolean;
  points: number;
}

export interface GameHistoryEntry {
  id: string;
  university_name: string | null;
  subject_name: string | null;
  chair_name: string | null;
  unit: string | null;
  score: number;
  correct_answers: number;
  total_questions: number;
  questions: GameHistoryQuestion[];
  created_at: string;
}

export async function saveGameHistory(entry: {
  universityName?: string | null;
  subjectName?: string | null;
  chairName?: string | null;
  unit?: string | null;
  score: number;
  correctAnswers: number;
  totalQuestions: number;
  questions: GameHistoryQuestion[];
}): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return; // Solo se guarda para usuarios registrados

  const { error } = await supabase.from('game_history').insert({
    user_id: userId,
    university_name: entry.universityName ?? null,
    subject_name: entry.subjectName ?? null,
    chair_name: entry.chairName ?? null,
    unit: entry.unit ?? null,
    score: entry.score,
    correct_answers: entry.correctAnswers,
    total_questions: entry.totalQuestions,
    questions: entry.questions,
  });

  if (error) {
    console.error('No se pudo guardar el historial de la partida:', error);
  }
}

export async function loadGameHistory(): Promise<GameHistoryEntry[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session?.user?.id) return [];

  const { data, error } = await supabase
    .from('game_history')
    .select('id, university_name, subject_name, chair_name, unit, score, correct_answers, total_questions, questions, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('No se pudo cargar el historial de partidas:', error);
    return [];
  }

  return (data ?? []) as GameHistoryEntry[];
}
