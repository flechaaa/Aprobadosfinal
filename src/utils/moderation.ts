import { supabase } from '@/lib/supabase';
import type { Question } from '@/types';

export interface Submission {
  id: string;
  created_at: string;
  university: string;
  subject: string;
  chair: string;
  source_notes: string | null;
  material_type: 'apunte' | 'preguntero_choice' | 'pregunta_respuesta' | 'texto';
  file_url: string | null;
  storage_path: string | null;
  file_type: string;
  processed: boolean;
  status: 'pending' | 'processed' | 'dismissed';
  processing_status: 'pendiente_procesamiento' | 'procesando' | 'procesado' | 'error' | 'error_tokens';
  processing_error: string | null;
  processing_attempts: number;
  processed_text: string | null;
  extracted_questions: Question[] | null;
}

export async function ensureTaxonomyFromSubmission(
  input: { university: string; subject: string; chair: string },
  adminPassword?: string
) {
  // 1. Buscar o crear Universidad
  let { data: uniData } = await supabase
    .from('universities')
    .select('id')
    .ilike('name', input.university.trim())
    .maybeSingle();

  if (!uniData) {
    const { data: newUni, error: uniError } = await supabase
      .from('universities')
      .insert([{ name: input.university.trim() }])
      .select('id')
      .single();
    if (uniError) throw new Error(`No se pudo crear la universidad: ${uniError.message}`);
    uniData = newUni;
  }

  // 2. Buscar o crear Materia (Subject)
  let { data: subData } = await supabase
    .from('subjects')
    .select('id')
    .eq('university_id', uniData.id)
    .ilike('name', input.subject.trim())
    .maybeSingle();

  if (!subData) {
    const { data: newSub, error: subError } = await supabase
      .from('subjects')
      .insert([{ university_id: uniData.id, name: input.subject.trim() }])
      .select('id')
      .single();
    if (subError) throw new Error(`No se pudo crear la materia: ${subError.message}`);
    subData = newSub;
  }

  // 3. Buscar o crear Cátedra (Chair)
  let { data: chairData } = await supabase
    .from('chairs')
    .select('id')
    .eq('subject_id', subData.id)
    .ilike('name', input.chair.trim())
    .maybeSingle();

  if (!chairData) {
    const { data: newChair, error: chairError } = await supabase
      .from('chairs')
      .insert([{ subject_id: subData.id, name: input.chair.trim() }])
      .select('id')
      .single();
    if (chairError) throw new Error(`No se pudo crear la cátedra: ${chairError.message}`);
    chairData = newChair;
  }

  return {
    universityId: uniData.id,
    subjectId: subData.id,
    chairId: chairData.id,
  };
}

export async function insertBatchQuestions(
  questions: Question[],
  submissionId: string,
  chairId: string,
  subjectId: string,
  metadata: { university?: string; subject?: string; chair?: string } = {},
) {
  if (!questions || questions.length === 0) return;

  const { error } = await supabase.from('questions').insert(questions.map((question) => ({
    submission_id: submissionId || null,
    chair_id: chairId || null,
    subject_id: subjectId || null,
    university: metadata.university || null,
    subject: metadata.subject || null,
    chair: metadata.chair || null,
    question: question.pregunta,
    options: question.opciones,
    correct_option: question.correcta,
    explanation: question.explicacion || '',
    difficulty: 'media',
    active: true,
    is_active: true,
  })));

  if (error) {
    throw new Error(error.message || 'No se pudieron insertar las preguntas en lote.');
  }
}

export async function insertQuestion(
  pregunta: string,
  opciones: string[],
  correcta: number,
  explicacion: string,
  submissionId: string,
  _adminPassword: string,
  chairId: string,
  subjectId: string,
  metadata: { university?: string; subject?: string; chair?: string } = {},
) {
  const { error } = await supabase.from('questions').insert([{
    submission_id: submissionId || null,
    chair_id: chairId || null,
    subject_id: subjectId || null,
    university: metadata.university || null,
    subject: metadata.subject || null,
    chair: metadata.chair || null,
    question: pregunta,
    options: opciones,
    correct_option: correcta,
    explanation: explicacion || '',
    difficulty: 'media',
    active: true,
    is_active: true,
  }]);

  if (error) {
    throw new Error(error.message || 'No se pudo insertar la pregunta.');
  }
}

export async function loadPendingSubmissions() {
  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar las solicitudes pendientes.');
  }

  return data ?? [];
}

export async function markSubmissionProcessed(submissionId: string, adminPassword?: string) {
  const { error } = await supabase.rpc('admin_mark_submission_processed', {
    p_submission_id: submissionId,
    p_admin_password: adminPassword ?? '',
  });

  if (error) {
    throw new Error(error.message || 'No se pudo actualizar el estado de la solicitud.');
  }
}

export async function retrySubmissionProcessing(submissionId: string, adminPassword: string) {
  const { error } = await supabase.rpc('admin_retry_submission_processing', {
    p_submission_id: submissionId,
    p_admin_password: adminPassword,
  });
  if (error) throw new Error(error.message || 'No se pudo reencolar el material.');
}

export async function storeSubmissionProcessingResult(input: {
  submissionId: string;
  extractedQuestions?: Question[];
  processedText?: string;
  processingStatus: 'procesado' | 'error' | 'error_tokens' | 'pendiente_procesamiento';
  processingError?: string;
  adminPassword: string;
}) {
  const { error } = await supabase.rpc('admin_store_submission_processing_result', {
    p_submission_id: input.submissionId,
    p_extracted_questions: input.extractedQuestions ?? null,
    p_processed_text: input.processedText ?? null,
    p_processing_status: input.processingStatus,
    p_processing_error: input.processingError ?? null,
    p_admin_password: input.adminPassword,
  });
  if (error) throw new Error(error.message || 'No se pudo guardar el estado del procesamiento.');
}