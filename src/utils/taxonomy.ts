import { supabase } from '@/lib/supabase';
import type { Chair, Subject, TaxonomySuggestion, University } from '@/types';

const UNIVERSITY_ALIAS_MAP: Record<string, string> = {
  'uba': 'Universidad de Buenos Aires',
  'u b a': 'Universidad de Buenos Aires',
  'u.b.a': 'Universidad de Buenos Aires',
  'u b a universidad de buenos aires': 'Universidad de Buenos Aires',
  'universidad de buenos aires': 'Universidad de Buenos Aires',
  'universidad nacional de buenos aires': 'Universidad de Buenos Aires',
  'universidad de buenos aires uba': 'Universidad de Buenos Aires',
};

const SUBJECT_ALIAS_MAP: Record<string, string> = {
  'infectologia': 'Infectología',
  'infectologia medica': 'Infectología',
  'infectologia medicina': 'Infectología',
};

const CHAIR_ALIAS_MAP: Record<string, string> = {
  'cat unica': 'Cátedra Única',
  'catedra unica': 'Cátedra Única',
};

export function normalizeTaxonomyText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\.\-,_]+/g, ' ')
    .trim();
}

export function canonicalizeTaxonomyName(level: 'university' | 'subject' | 'chair', value: string): string {
  const normalized = normalizeTaxonomyText(value);
  if (level === 'university') {
    const canonical = UNIVERSITY_ALIAS_MAP[normalized] ?? UNIVERSITY_ALIAS_MAP[normalized.replace(/\s+/g, ' ')] ?? null;
    if (canonical) return canonical;
    return value.trim().replace(/\s+/g, ' ');
  }

  if (level === 'subject') {
    const canonical = SUBJECT_ALIAS_MAP[normalized] ?? null;
    if (canonical) return canonical;
    return value.trim().replace(/\s+/g, ' ');
  }

  const canonical = CHAIR_ALIAS_MAP[normalized] ?? null;
  if (canonical) return canonical;
  return value.trim().replace(/\s+/g, ' ');
}

export function taxonomicKey(value: string): string {
  return normalizeTaxonomyText(value);
}

export async function loadTaxonomy(): Promise<{
  universities: University[];
  subjects: Subject[];
  chairs: Chair[];
}> {
  const [universitiesResult, subjectsResult, chairsResult] = await Promise.all([
    supabase.from('universities').select('id, name').order('name'),
    supabase.from('subjects').select('id, university_id, name').order('name'),
    supabase.from('chairs').select('id, subject_id, name').order('name'),
  ]);

  if (universitiesResult.error || subjectsResult.error || chairsResult.error) {
    throw new Error('No se pudo cargar la clasificación.');
  }

  return {
    universities: universitiesResult.data ?? [],
    subjects: subjectsResult.data ?? [],
    chairs: chairsResult.data ?? [],
  };
}

export async function submitSuggestion(input: {
  level: 'university' | 'subject' | 'chair';
  proposedName: string;
  universityId?: string;
  subjectId?: string;
}) {
  const cleaned = canonicalizeTaxonomyName(input.level, input.proposedName);
  const { error } = await supabase.from('taxonomy_suggestions').insert({
    level: input.level,
    proposed_name: cleaned,
    university_id: input.universityId ?? null,
    subject_id: input.subjectId ?? null,
  });

  if (error) throw new Error('No se pudo enviar la propuesta.');
}

export async function loadSuggestions(adminPassword: string): Promise<TaxonomySuggestion[]> {
  const { data, error } = await supabase.rpc('admin_list_taxonomy_suggestions', {
    p_admin_password: adminPassword,
  });

  if (error) throw new Error('No se pudieron cargar las propuestas.');
  return data ?? [];
}

export async function moderateSuggestion(
  id: string,
  action: 'approve' | 'reject',
  adminPassword: string,
  name?: string,
) {
  const { error } = await supabase.rpc('admin_moderate_taxonomy_suggestion', {
    p_suggestion: id,
    p_action: action,
    p_name: name?.trim() || null,
    p_admin_password: adminPassword,
  });

  if (error) throw new Error('No se pudo moderar la propuesta.');
}
