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
  if (!adminPassword) throw new Error('Se requiere autenticación administrativa.');
  const { data, error } = await supabase.rpc('admin_ensure_taxonomy', {
    p_university: input.university.trim(),
    p_subject: input.subject.trim(),
    p_chair: input.chair.trim(),
    p_admin_password: adminPassword,
  });
  if (error || !data) throw new Error(error?.message || 'No se pudo asegurar la taxonomía administrativa.');
  return { universityId: data.university_id, subjectId: data.subject_id, chairId: data.chair_id };
}

export async function insertBatchQuestions(
  questions: Question[],
  submissionId: string,
  chairId: string,
  subjectId: string,
  adminPassword: string,
  metadata: { university?: string; subject?: string; chair?: string } = {},
): Promise<{ approved: number; approvedIndexes: number[]; failures: string[] }> {
  if (!questions || questions.length === 0) return { approved: 0, approvedIndexes: [], failures: [] };
  let approved = 0;
  const approvedIndexes: number[] = [];
  const failures: string[] = [];
  for (const [index, question] of questions.entries()) {
    try {
      await insertQuestion(
        question.pregunta,
        question.opciones,
        question.correcta,
        question.explicacion,
        submissionId,
        adminPassword,
        chairId,
        subjectId,
        metadata,
      );
      approved += 1;
      approvedIndexes.push(index);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[admin] Falló la aprobación de la pregunta ${index + 1}:`, error);
      failures.push(`Pregunta ${index + 1}: ${message}`);
    }
  }
  return { approved, approvedIndexes, failures };
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
  if (!_adminPassword) throw new Error('Se requiere autenticación administrativa.');
  const { error } = await supabase.rpc('admin_insert_question', {
    p_pregunta: pregunta,
    p_opciones: opciones,
    p_correcta: correcta,
    p_explicacion: explicacion,
    p_submission_id: submissionId || null,
    p_subject_id: subjectId || null,
    p_chair_id: chairId || null,
    p_university: metadata.university ?? null,
    p_subject: metadata.subject ?? null,
    p_chair: metadata.chair ?? null,
    p_admin_password: _adminPassword,
  });

  if (error) {
    throw new Error(error.message || 'No se pudo insertar la pregunta.');
  }
}

export async function loadPendingSubmissions() {
  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .in('status', ['pending'])
    .in('processing_status', ['pendiente_procesamiento', 'procesando', 'error', 'error_tokens'])
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
