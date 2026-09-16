import { supabase } from '@/lib/supabase';
import { canonicalizeTaxonomyName, normalizeString, normalizeTaxonomyText } from '@/utils/taxonomy';

const COMMON_WORDS = new Set([
  'instituto',
  'institut',
  'institucion',
  'facultad',
  'facultades',
  'universidad',
  'universitario',
  'la',
  'las',
  'el',
  'los',
  'de',
  'del',
  'y',
  'e',
]);

function normalizeInstitutionForComparison(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(instituto|institut|institucion|facultad|facultades|universidad|universitario|la|las|el|los|de|del|y|e)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatInstitutionName(value: string): string {
  const accentless = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return accentless
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      if (word === 'de' || word === 'del' || word === 'la' || word === 'las' || word === 'el' || word === 'los') {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function similarityScore(a: string, b: string): number {
  const left = normalizeInstitutionForComparison(a);
  const right = normalizeInstitutionForComparison(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = new Set(left.split(' '));
  const rightTokens = new Set(right.split(' '));
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const base = union ? shared / union : 0;
  if (left.includes(right) || right.includes(left)) return 0.92;
  return Math.min(1, Math.max(0, base));
}

function findNearMatch<T extends { id: string; name: string }>(rows: T[], target: string): T | null {
  const targetKey = normalizeInstitutionForComparison(target);
  if (!targetKey) return null;

  const scored = rows
    .map((row) => {
      const rowKey = normalizeInstitutionForComparison(row.name);
      const score = similarityScore(rowKey, targetKey);
      return { row, score };
    })
    .filter((entry) => entry.score >= 0.72 || entry.row.name.toLowerCase().includes(targetKey) || targetKey.includes(entry.row.name.toLowerCase()));

  scored.sort((a, b) => b.score - a.score);
  return scored.length > 0 ? scored[0].row : null;
}

export interface Submission {
  id: string;
  created_at: string;
  university: string;
  subject: string;
  chair: string;
  source_notes: string | null;
  material_type: string;
  file_url: string;
  file_type: string;
  processed: boolean;
  extracted_questions?: any[];
}

export async function loadPendingSubmissions(): Promise<Submission[]> {
  const { data, error } = await supabase
    .from('submissions')
    .select('id, created_at, university, subject, chair, source_notes, material_type, file_url, file_type, processed, extracted_questions')
    .or('processed.is.null,processed.eq.false')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error al cargar submissions:', error);
    throw new Error('No se pudieron cargar los envíos pendientes.');
  }
  return data ?? [];
}

function findByNormalizedName<T extends { id: string; name: string }>(rows: T[], target: string) {
  const targetKey = normalizeString(target);
  return rows.find((row) => normalizeString(row.name) === targetKey) ?? null;
}

/**
 * Asegura la existencia de Universidad, Materia y Cátedra devolviendo sus UUIDs.
 */
export async function ensureTaxonomyFromSubmission(
  submission: {
    university: string;
    subject: string;
    chair: string;
  },
  adminPassword?: string
): Promise<{ universityId: string; subjectId: string; chairId: string }> {
  const uniName = canonicalizeTaxonomyName('university', submission.university);
  const subjName = canonicalizeTaxonomyName('subject', submission.subject);
  const chairName = canonicalizeTaxonomyName('chair', submission.chair);

  if (adminPassword) {
    try {
      const { data, error } = await supabase.rpc('admin_ensure_taxonomy', {
        p_university: uniName,
        p_subject: subjName,
        p_chair: chairName,
        p_admin_password: adminPassword,
      });

      if (!error && data) {
        return {
          universityId: data.university_id || data.universityId,
          subjectId: data.subject_id || data.subjectId,
          chairId: data.chair_id || data.chairId,
        };
      }
    } catch {
      // Fallback nativo
    }
  }

  const { data: universities } = await supabase.from('universities').select('id, name');
  const { data: subjects } = await supabase.from('subjects').select('id, university_id, name');
  const { data: chairs } = await supabase.from('chairs').select('id, subject_id, name');

  const universityRows = universities ?? [];
  const subjectRows = subjects ?? [];
  const chairRows = chairs ?? [];

  let uni = findNearMatch(universityRows, uniName) ?? findByNormalizedName(universityRows, uniName);
  if (!uni) {
    const polishedUni = formatInstitutionName(canonicalizeTaxonomyName('university', uniName));
    const { data: newUni, error: errUni } = await supabase
      .from('universities')
      .insert({ name: polishedUni })
      .select('id, name')
      .single();
    if (errUni) throw new Error('No se pudo registrar la universidad: ' + errUni.message);
    uni = newUni;
  }

  let subj = (subjectRows ?? []).find((row) => row.university_id === uni!.id && normalizeString(row.name) === normalizeString(subjName))
    ?? findNearMatch((subjectRows ?? []).filter((row) => row.university_id === uni!.id && row.name), subjName)
    ?? null;

  if (!subj) {
    const polishedSubject = formatInstitutionName(canonicalizeTaxonomyName('subject', subjName));
    const { data: newSubj, error: errSubj } = await supabase
      .from('subjects')
      .insert({ university_id: uni!.id, name: polishedSubject })
      .select('id, university_id, name')
      .single();
    if (errSubj) throw new Error('No se pudo registrar la materia: ' + errSubj.message);
    subj = newSubj;
  }

  let ch = (chairRows ?? []).find((row) => row.subject_id === subj!.id && normalizeString(row.name) === normalizeString(chairName))
    ?? findNearMatch((chairRows ?? []).filter((row) => row.subject_id === subj!.id && row.name), chairName)
    ?? null;

  if (!ch) {
    const polishedChair = formatInstitutionName(canonicalizeTaxonomyName('chair', chairName));
    const { data: newCh, error: errCh } = await supabase
      .from('chairs')
      .insert({ subject_id: subj!.id, name: polishedChair })
      .select('id, subject_id, name')
      .single();
    if (errCh) throw new Error('No se pudo registrar la cátedra: ' + errCh.message);
    ch = newCh;
  }

  return {
    universityId: uni!.id,
    subjectId: subj!.id,
    chairId: ch!.id,
  };
}

/**
 * Inserta una pregunta individual aprobada en la tabla questions.
 */
export async function insertQuestion(
  pregunta: string,
  opciones: string[],
  correcta: number,
  explicacion: string,
  submissionId: string,
  adminPassword?: string,
  chairId?: string,
  subjectId?: string, // <-- Agregado
  metadata?: { university?: string; subject?: string; chair?: string }
): Promise<string> {
  void adminPassword;

  const { data, error } = await supabase
    .from('questions')
    .insert({
      question: pregunta,
      options: Array.isArray(opciones) ? opciones : [],
      correct_option: Number.isInteger(Number(correcta)) ? Number(correcta) : 0,
      explanation: explicacion || '',
      submission_id: submissionId || null,
      chair_id: chairId || null,
      subject_id: subjectId || null, // <-- Agregado
      university: metadata?.university || null,
      subject: metadata?.subject || null,
      chair: metadata?.chair || null,
      difficulty: 'media',
      active: true,
      is_active: true, // <-- Agregado y corregido
    })
    .select('id')
    .single();

  if (error) {
    console.error('Error insertando pregunta en questions:', error);
    throw new Error('No se pudo guardar la pregunta: ' + error.message);
  }

  return data.id;
}

/**
 * Marca el material colaborativo como procesado.
 */
export async function markSubmissionProcessed(
  submissionId: string,
  adminPassword?: string
): Promise<void> {
  const { error: updErr } = await supabase
    .from('submissions')
    .update({ processed: true })
    .eq('id', submissionId);

  if (updErr && adminPassword) {
    const { error: rpcErr } = await supabase.rpc('admin_mark_submission_processed', {
      p_submission_id: submissionId,
      p_admin_password: adminPassword,
    });
    if (rpcErr) throw new Error('No se pudo marcar el envío como completado.');
  }
}

/**
 * Inserta todas las preguntas de un lote en una única operación atómica (Bulk Insert).
 */
export async function insertBatchQuestions(
  questions: Array<{
    pregunta: string;
    opciones: string[];
    correcta: number;
    explicacion: string;
  }>,
  submissionId: string,
  chairId: string,
  subjectId: string, // <-- Agregado
  metadata?: { university?: string; subject?: string; chair?: string }
): Promise<void> {
  const rows = questions.map((q) => {
    const opts = Array.isArray(q.opciones) ? q.opciones : [];
    const corr = Number.isInteger(Number(q.correcta)) ? Number(q.correcta) : 0;

    return {
      submission_id: submissionId || null,
      chair_id: chairId || null,
      subject_id: subjectId || null, // <-- Agregado
      university: metadata?.university || null,
      subject: metadata?.subject || null,
      chair: metadata?.chair || null,
      question: q.pregunta || '',
      options: opts,
      correct_option: corr,
      explanation: q.explicacion || '',
      difficulty: 'media',
      active: true,
      is_active: true, // <-- Agregado y corregido
    };
  });

  const { error } = await supabase.from('questions').insert(rows);

  if (error) {
    console.error('Error en bulk insert de questions:', error);
    alert('Error al guardar el lote en Supabase: ' + error.message);
    throw new Error('Error al guardar el lote de preguntas: ' + error.message);
  }
}

export async function approveBatchQuestions(
  questions: Array<{
    pregunta: string;
    opciones: string[];
    correcta: number;
    explicacion: string;
  }>,
  submissionId: string,
  adminPassword: string,
  chairId?: string,
  subjectId?: string,
  metadata?: { university?: string; subject?: string; chair?: string }
): Promise<number> {
  await insertBatchQuestions(questions, submissionId, chairId || '', subjectId || '', metadata);
  await markSubmissionProcessed(submissionId, adminPassword);
  return questions.length;
}