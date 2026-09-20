import { supabase } from '@/lib/supabase';

export const LOCAL_RANKING_KEY = 'aprobados-local-ranking';
const ANON_ID_KEY = 'aprobados_anon_id';

// Identidad estable por dispositivo, para la partida gratis sin registrarse.
// Evita que dos personas distintas con el mismo nombre se mezclen en el ranking.
function getOrCreateAnonId(): string {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return '';
  let id = localStorage.getItem(ANON_ID_KEY);
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(ANON_ID_KEY, id);
  }
  return id;
}

// Identidad para adjuntar a un puntaje: el user_id de Supabase Auth si ya se
// registró, o el anon_id del dispositivo si todavía no.
export async function getRankingIdentity(): Promise<{ userId: string | null; anonId: string | null }> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id ?? null;
  return userId ? { userId, anonId: null } : { userId: null, anonId: getOrCreateAnonId() };
}

export interface RankingEntry {
  id?: string;
  chair_id?: string;
  player_name: string;
  score: number;
  created_at?: string;
  chairName?: string;
  subjectName?: string;
  universityName?: string;
}

export interface GlobalRankingEntry extends RankingEntry {
  chairName: string;
  subjectName: string;
  universityName: string;
}

export type RankingScope = 'global' | 'university' | 'subject' | 'unit';

export interface AggregatedRankingEntry {
  rank: number;
  player_name: string;
  avatar_url?: string | null;
  total_score: number;
  correct_answers: number;
  questions_answered: number;
  games_played: number;
  best_score: number;
  university_name?: string | null;
  subject_name?: string | null;
  unit?: string | null;
}

interface RankingJoinRow {
  id?: string;
  chair_id?: string;
  player_name: string;
  score: number;
  created_at?: string;
  chairs?: {
    name?: string | null;
    subject_id?: string | null;
    subjects?: {
      name?: string | null;
      university_id?: string | null;
      universities?: {
        name?: string | null;
      } | null;
    } | null;
  } | null;
}

function mapJoinRow(row: RankingJoinRow): GlobalRankingEntry {
  const chairName = row.chairs?.name ?? 'Cátedra sin nombre';
  const subjectName = row.chairs?.subjects?.name ?? 'Materia sin nombre';
  const universityName = row.chairs?.subjects?.universities?.name ?? 'Universidad sin nombre';

  return {
    id: row.id,
    chair_id: row.chair_id,
    player_name: row.player_name,
    score: row.score,
    created_at: row.created_at,
    chairName,
    subjectName,
    universityName,
  } as GlobalRankingEntry;
}

export interface RankingSaveResult {
  position: number;
  total: number;
}

export async function saveRankingScore({
  chairId,
  playerName,
  score,
  universityId,
  subjectId,
  unit,
  correctAnswers = 0,
  questionsAnswered = 0,
  userId = null,
  anonId = null,
}: {
  chairId: string;
  playerName: string;
  score: number;
  universityId?: string;
  subjectId?: string;
  unit?: string | null;
  correctAnswers?: number;
  questionsAnswered?: number;
  userId?: string | null;
  anonId?: string | null;
}): Promise<RankingSaveResult> {
  const chairCheck = await supabase
    .from('chairs')
    .select('id, subject_id')
    .eq('id', chairId)
    .maybeSingle();

  if (chairCheck.error) {
    console.error('Error validando cátedra para rankings:', chairCheck.error);
    throw chairCheck.error;
  }

  if (!chairCheck.data) {
    throw new Error('La cátedra seleccionada aún no existe en el ranking.');
  }

  const payload = {
    chair_id: chairId,
    player_name: playerName.trim().slice(0, 50) || 'Anónimo',
    score,
    university_id: universityId ?? null,
    subject_id: subjectId ?? chairCheck.data.subject_id,
    unit: unit?.trim() || null,
    correct_answers: correctAnswers,
    questions_answered: questionsAnswered,
    created_at: new Date().toISOString(),
    user_id: userId,
    anon_id: userId ? null : anonId,
  };

  const { data, error } = await supabase.from('rankings').insert(payload).select('id').single();

  if (error) {
    console.error('Error guardando puntaje en rankings:', error);
    throw error;
  }

  const rows = await loadRankingEntries(chairId);
  const withNewRow = [...rows, { id: data?.id ?? '', chair_id: chairId, player_name: payload.player_name, score, created_at: payload.created_at }];
  const ordered = withNewRow.sort((a, b) => b.score - a.score);
  const position = ordered.findIndex((row) => row.id === data?.id) + 1;

  return {
    position,
    total: ordered.length,
  };
}

export async function loadRankingEntries(chairId: string): Promise<RankingEntry[]> {
  const { data, error } = await supabase
    .from('rankings')
    .select('id, chair_id, player_name, score, created_at')
    .eq('chair_id', chairId)
    .order('score', { ascending: false });

  if (error) {
    console.error('Error cargando ranking:', error);
    throw error;
  }

  return (data ?? []) as RankingEntry[];
}

export async function loadRankings(filters: {
  scope: RankingScope;
  universityId?: string | null;
  subjectId?: string | null;
  unit?: string | null;
}): Promise<AggregatedRankingEntry[]> {
  const { data, error } = await supabase.rpc('get_rankings', {
    p_scope: filters.scope,
    p_university_id: filters.universityId ?? null,
    p_subject_id: filters.subjectId ?? null,
    p_unit: filters.unit?.trim() || null,
  });

  if (error) {
    console.error('Error cargando ranking agregado:', error);
    throw new Error('No se pudo cargar el ranking. Verificá la migración get_rankings.');
  }

  const remoteEntries = ((data ?? []) as AggregatedRankingEntry[]).map((entry, index) => ({
    ...entry,
    rank: Number(entry.rank ?? index + 1),
    player_name: entry.player_name?.trim() || 'Anónimo',
    total_score: Number(entry.total_score ?? 0),
    correct_answers: Number(entry.correct_answers ?? 0),
    questions_answered: Number(entry.questions_answered ?? 0),
    games_played: Number(entry.games_played ?? 0),
    best_score: Number(entry.best_score ?? 0),
  }));

  if (filters.scope !== 'global') return remoteEntries;

  let localEntries: AggregatedRankingEntry[] = [];
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_RANKING_KEY) ?? '[]') as Array<{ id: string; player_name?: string; score?: number }>;
    localEntries = stored.map((entry) => ({
      rank: 0,
      player_name: entry.player_name?.trim() || 'Jugador anonimo',
      total_score: Number(entry.score ?? 0),
      correct_answers: 0,
      questions_answered: 0,
      games_played: 1,
      best_score: Number(entry.score ?? 0),
      university_name: 'Aprobados',
      subject_name: 'Partida rapida',
      unit: null,
    }));
  } catch {
    localEntries = [];
  }

  return [...remoteEntries, ...localEntries]
    .sort((left, right) => right.total_score - left.total_score || right.correct_answers - left.correct_answers)
    .slice(0, 50)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export async function loadRankingTopTen(chairId: string): Promise<GlobalRankingEntry[]> {
  const { data, error } = await supabase
    .from('rankings')
    .select(`id, chair_id, player_name, score, created_at, chairs(name, subject_id, subjects(name, university_id, universities(name)))`)
    .eq('chair_id', chairId)
    .order('score', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error cargando ranking:', error);
    throw error;
  }

  return ((data ?? []) as RankingJoinRow[]).map(mapJoinRow);
}

export async function loadGlobalRankingTopTen(): Promise<GlobalRankingEntry[]> {
  const { data, error } = await supabase
    .from('rankings')
    .select(`id, chair_id, player_name, score, created_at, chairs(name, subject_id, subjects(name, university_id, universities(name)))`)
    .order('score', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error cargando ranking global:', error);
    throw error;
  }

  const remoteEntries = ((data ?? []) as RankingJoinRow[]).map(mapJoinRow);
  let localEntries: GlobalRankingEntry[] = [];
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_RANKING_KEY) ?? '[]') as Array<{ id: string; player_name: string; score: number }>;
    localEntries = stored.map((entry) => ({
      id: entry.id,
      player_name: entry.player_name,
      score: entry.score,
      chairName: 'Partida rapida',
      subjectName: 'Ranking local',
      universityName: 'Aprobados',
    }));
  } catch {
    localEntries = [];
  }

  return [...remoteEntries, ...localEntries].sort((left, right) => right.score - left.score).slice(0, 50);
}
