import { supabase } from '@/lib/supabase';
import type { Chair, Subject, TaxonomySuggestion, University } from '@/types';

export function normalizeString(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\-_. ,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripInstitutionSuffix(value: string): string {
  return value.replace(/\s*[-–—]\s*[^-–—]+$/i, '').trim();
}

function cleanUniversityNameForKey(value: string): string {
  const trimmed = stripInstitutionSuffix(value);
  return normalizeString(trimmed.replace(/\b(instituto|institut|institucion|facultad|facultades|universidad|universitario|la|las|el|los|de|del|y|e)\b/gi, ''));
}

function cleanSubjectNameForKey(value: string): string {
  return normalizeString(stripInstitutionSuffix(value));
}

const UNIVERSITY_ALIAS_MAP: Record<string, string> = {
  'uba': 'Universidad de Buenos Aires',
  'u b a': 'Universidad de Buenos Aires',
  'u.b.a': 'Universidad de Buenos Aires',
  'u b a universidad de buenos aires': 'Universidad de Buenos Aires',
  'universidad de buenos aires': 'Universidad de Buenos Aires',
  'universidad nacional de buenos aires': 'Universidad de Buenos Aires',
  'universidad de buenos aires uba': 'Universidad de Buenos Aires',
  'instituto fundacion barcelo': 'Fundación Barceló',
  'instituto universitario fundacion barcelo': 'Fundación Barceló',
  'instituto universitario fundacion barcelo universidad': 'Fundación Barceló',
  'fundacion barcelo': 'Fundación Barceló',
  'barcelo': 'Fundación Barceló',
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
  return normalizeString(value).replace(/[\.\-,_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function canonicalizeUniversityName(value: string): string {
  const stripped = stripInstitutionSuffix(value);
  const normalized = normalizeTaxonomyText(stripped);

  if (normalized.includes('barcelo')) {
    return 'Fundación Barceló';
  }

  const canonical = UNIVERSITY_ALIAS_MAP[normalized]
    ?? UNIVERSITY_ALIAS_MAP[normalized.replace(/\s+/g, ' ')]
    ?? null;

  if (canonical) return canonical;

  return stripped.trim().replace(/\s+/g, ' ');
}

export function canonicalizeTaxonomyName(level: 'university' | 'subject' | 'chair', value: string): string {
  const normalized = normalizeTaxonomyText(value);

  if (level === 'university') {
    const canonical = UNIVERSITY_ALIAS_MAP[normalized]
      ?? UNIVERSITY_ALIAS_MAP[normalized.replace(/\s+/g, ' ')]
      ?? (normalized.includes('barcelo') ? 'Fundación Barceló' : null);

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

  const universitiesRaw = universitiesResult.data ?? [];
  const subjectsRaw = subjectsResult.data ?? [];
  const chairsRaw = chairsResult.data ?? [];

  const universityMap = new Map<string, University>();
  const universityIdToCanonicalId = new Map<string, string>();

  for (const row of universitiesRaw) {
    const canonicalName = canonicalizeUniversityName(row.name);
    const normalizedKey = normalizeString(canonicalName);
    const existing = universityMap.get(normalizedKey);

    if (!existing) {
      universityMap.set(normalizedKey, {
        id: row.id,
        name: canonicalName,
      });
      universityIdToCanonicalId.set(row.id, row.id);
      continue;
    }

    universityIdToCanonicalId.set(row.id, existing.id);
  }

  const universities = Array.from(universityMap.values());

  const subjectMap = new Map<string, Subject>();
  const subjectIdToCanonicalId = new Map<string, string>();

  for (const row of subjectsRaw) {
    const canonicalUniversityId = universityIdToCanonicalId.get(row.university_id) ?? row.university_id;
    const canonicalName = canonicalizeTaxonomyName('subject', row.name);
    const normalizedKey = `${normalizeString(canonicalUniversityId)}|${normalizeString(canonicalName)}`;
    const existing = subjectMap.get(normalizedKey);

    if (!existing) {
      subjectMap.set(normalizedKey, {
        id: row.id,
        university_id: canonicalUniversityId,
        name: canonicalName,
      });
      subjectIdToCanonicalId.set(row.id, row.id);
      continue;
    }

    subjectIdToCanonicalId.set(row.id, existing.id);
  }

  const subjects = Array.from(subjectMap.values());

  const chairMap = new Map<string, Chair>();
  for (const row of chairsRaw) {
    const canonicalSubjectId = subjectIdToCanonicalId.get(row.subject_id) ?? row.subject_id;
    const canonicalName = canonicalizeTaxonomyName('chair', row.name);
    const normalizedKey = `${normalizeString(canonicalSubjectId)}|${normalizeString(canonicalName)}`;
    if (!chairMap.has(normalizedKey)) {
      chairMap.set(normalizedKey, {
        id: row.id,
        subject_id: canonicalSubjectId,
        name: canonicalName,
      });
    }
  }

  const chairs = Array.from(chairMap.values());

  return {
    universities,
    subjects,
    chairs,
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
