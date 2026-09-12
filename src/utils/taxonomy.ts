import { supabase } from '@/lib/supabase';
import type { Chair, Subject, TaxonomySuggestion, University } from '@/types';

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
  const { error } = await supabase.from('taxonomy_suggestions').insert({
    level: input.level,
    proposed_name: input.proposedName.trim(),
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
