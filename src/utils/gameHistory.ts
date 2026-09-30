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

export interface UserStats {
  gamesPlayed: number;
  totalScore: number;
  totalCorrect: number;
  totalQuestions: number;
  averageStars: number;
}

function starsForGame(correct: number, total: number): number {
  if (total <= 0) return 0;
  const ratio = correct / total;
  if (ratio >= 1) return 5;
  if (ratio >= 0.6) return 4;
  if (ratio >= 0.4) return 3;
  if (ratio > 0) return 2;
  return 1;
}

export async function loadUserStats(): Promise<UserStats | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session?.user?.id) return null;

  const { data, error } = await supabase
    .from('game_history')
    .select('score, correct_answers, total_questions');

  if (error) {
    console.error('No se pudieron cargar las estadísticas del usuario:', error);
    return null;
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return { gamesPlayed: 0, totalScore: 0, totalCorrect: 0, totalQuestions: 0, averageStars: 0 };
  }

  const totalScore = rows.reduce((sum, row) => sum + (row.score ?? 0), 0);
  const totalCorrect = rows.reduce((sum, row) => sum + (row.correct_answers ?? 0), 0);
  const totalQuestions = rows.reduce((sum, row) => sum + (row.total_questions ?? 0), 0);
  const averageStars = rows.reduce((sum, row) => sum + starsForGame(row.correct_answers ?? 0, row.total_questions ?? 0), 0) / rows.length;

  return {
    gamesPlayed: rows.length,
    totalScore,
    totalCorrect,
    totalQuestions,
    averageStars,
  };
}
