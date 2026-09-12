import { supabase } from '@/lib/supabase';

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
}

export async function loadPendingSubmissions(): Promise<Submission[]> {
  const { data, error } = await supabase
    .from('submissions')
    .select('id, created_at, university, subject, chair, source_notes, material_type, file_url, file_type, processed')
    .or('processed.is.null,processed.eq.false')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error al cargar submissions:', error);
    throw new Error('No se pudieron cargar los envíos pendientes.');
  }
  return data ?? [];
}

export async function insertQuestion(
  pregunta: string,
  opciones: string[],
  correcta: number,
  explicacion: string,
  submissionId: string,
  adminPassword: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('admin_insert_question', {
    p_pregunta: pregunta,
    p_opciones: opciones,
    p_correcta: correcta,
    p_explicacion: explicacion,
    p_submission_id: submissionId,
    p_admin_password: adminPassword,
  });

  if (error) throw new Error('No se pudo guardar la pregunta.');
  return data as string;
}

export async function markSubmissionProcessed(
  submissionId: string,
  adminPassword: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_mark_submission_processed', {
    p_submission_id: submissionId,
    p_admin_password: adminPassword,
  });

  if (error) throw new Error('No se pudo marcar el envío como completado.');
}
export async function approveBatchQuestions(
  questions: Array<{
    pregunta: string;
    opciones: string[];
    correcta: number;
    explicacion: string;
  }>,
  submissionId: string,
  adminPassword: string
): Promise<number> {
  let count = 0;
  for (const q of questions) {
    await insertQuestion(
      q.pregunta,
      q.opciones,
      q.correcta,
      q.explicacion,
      submissionId,
      adminPassword
    );
    count++;
  }

  // Marcar el material como procesado al terminar
  await markSubmissionProcessed(submissionId, adminPassword);
  return count;
}