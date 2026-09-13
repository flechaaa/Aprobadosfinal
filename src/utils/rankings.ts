import { supabase } from '@/lib/supabase';

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
}: {
  chairId: string;
  playerName: string;
  score: number;
}): Promise<RankingSaveResult> {
  const chairCheck = await supabase
    .from('chairs')
    .select('id')
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
    created_at: new Date().toISOString(),
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

  return ((data ?? []) as RankingJoinRow[]).map(mapJoinRow);
}
