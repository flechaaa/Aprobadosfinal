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

// Estos mapas quedan como "atajos" para casos puntuales que querramos forzar
// (por ejemplo, una sigla ambigua). Ya NO son la única defensa contra duplicados:
// la deduplicación genérica por diacríticos en loadTaxonomy() cubre el resto.
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

// ---------------------------------------------------------------------------
// NUEVO: deduplicación genérica por diacríticos.
//
// Cuando dos filas de la base colisionan en la misma clave normalizada (mismo
// texto sin tildes/mayúsculas/espacios) — típicamente por un typo de tilde
// cargado a mano o por una importación duplicada — en vez de quedarnos con
// "la primera que aparezca" de forma no determinística, elegimos como nombre
// canónico la variante con MÁS diacríticos (en español, la forma acentuada
// casi siempre es la ortografía correcta: "Ginecología" > "Ginecologia").
// Esto reemplaza la necesidad de mantener un alias manual por cada materia.
// ---------------------------------------------------------------------------
function countDiacritics(value: string): number {
  const marks = value.normalize('NFD').match(/[\u0300-\u036f]/g);
  return marks ? marks.length : 0;
}

function pickCanonicalVariant(names: string[]): string {
  return [...names].sort((a, b) => {
    const diacriticDiff = countDiacritics(b) - countDiacritics(a);
    if (diacriticDiff !== 0) return diacriticDiff;
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b, 'es');
  })[0];
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

  // --- Universidades: dos pasadas (agrupar por clave, elegir mejor variante) ---
  type UniRow = { id: string; name: string };
  const universityBuckets = new Map<string, UniRow[]>();

  for (const row of universitiesRaw) {
    const canonicalName = canonicalizeUniversityName(row.name);
    const key = normalizeString(canonicalName);
    const bucket = universityBuckets.get(key) ?? [];
    bucket.push({ id: row.id, name: canonicalName });
    universityBuckets.set(key, bucket);
  }

  const universityMap = new Map<string, University>();
  const universityIdToCanonicalId = new Map<string, string>();

  for (const bucket of universityBuckets.values()) {
    const bestName = pickCanonicalVariant(bucket.map((r) => r.name));
    const canonicalRow = bucket.find((r) => r.name === bestName) ?? bucket[0];

    universityMap.set(normalizeString(bestName), { id: canonicalRow.id, name: bestName });

    for (const row of bucket) {
      universityIdToCanonicalId.set(row.id, canonicalRow.id);
    }
  }

  const universities = Array.from(universityMap.values());

  // --- Materias: dos pasadas ---
  type SubjRow = { id: string; university_id: string; name: string };
  const subjectBuckets = new Map<string, SubjRow[]>();

  for (const row of subjectsRaw) {
    const canonicalUniversityId = universityIdToCanonicalId.get(row.university_id) ?? row.university_id;
    const canonicalName = canonicalizeTaxonomyName('subject', row.name);
    const key = `${normalizeString(canonicalUniversityId)}|${normalizeString(canonicalName)}`;
    const bucket = subjectBuckets.get(key) ?? [];
    bucket.push({ id: row.id, university_id: canonicalUniversityId, name: canonicalName });
    subjectBuckets.set(key, bucket);
  }

  const subjectMap = new Map<string, Subject>();
  const subjectIdToCanonicalId = new Map<string, string>();

  for (const bucket of subjectBuckets.values()) {
    const bestName = pickCanonicalVariant(bucket.map((r) => r.name));
    const canonicalRow = bucket.find((r) => r.name === bestName) ?? bucket[0];

    subjectMap.set(`${normalizeString(canonicalRow.university_id)}|${normalizeString(bestName)}`, {
      id: canonicalRow.id,
      university_id: canonicalRow.university_id,
      name: bestName,
    });

    for (const row of bucket) {
      subjectIdToCanonicalId.set(row.id, canonicalRow.id);
    }
  }

  const subjects = Array.from(subjectMap.values());

  // --- Cátedras: dos pasadas ---
  type ChairRow = { id: string; subject_id: string; name: string };
  const chairBuckets = new Map<string, ChairRow[]>();

  for (const row of chairsRaw) {
    const canonicalSubjectId = subjectIdToCanonicalId.get(row.subject_id) ?? row.subject_id;
    const canonicalName = canonicalizeTaxonomyName('chair', row.name);
    const key = `${normalizeString(canonicalSubjectId)}|${normalizeString(canonicalName)}`;
    const bucket = chairBuckets.get(key) ?? [];
    bucket.push({ id: row.id, subject_id: canonicalSubjectId, name: canonicalName });
    chairBuckets.set(key, bucket);
  }

  const chairMap = new Map<string, Chair>();

  for (const bucket of chairBuckets.values()) {
    const bestName = pickCanonicalVariant(bucket.map((r) => r.name));
    const canonicalRow = bucket.find((r) => r.name === bestName) ?? bucket[0];

    chairMap.set(`${normalizeString(canonicalRow.subject_id)}|${normalizeString(bestName)}`, {
      id: canonicalRow.id,
      subject_id: canonicalRow.subject_id,
      name: bestName,
    });
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
