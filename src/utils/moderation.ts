import { supabase } from '@/lib/supabase';

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

export async function insertBatchQuestions(questions: any[], adminPassword?: string) {
  if (!questions || questions.length === 0) return;

  const { error } = await supabase.from('questions').insert(questions);

  if (error) {
    throw new Error(error.message || 'No se pudieron insertar las preguntas en lote.');
  }
}

export async function insertQuestion(questionData: any, adminPassword?: string) {
  const { error } = await supabase.from('questions').insert([questionData]);

  if (error) {
    throw new Error(error.message || 'No se pudo insertar la pregunta.');
  }
}

export async function loadPendingSubmissions(adminPassword?: string) {
  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar las solicitudes pendientes.');
  }

  return data ?? [];
}

export async function markSubmissionProcessed(submissionId: string, adminPassword?: string) {
  const { error } = await supabase
    .from('submissions')
    .update({ status: 'processed' })
    .eq('id', submissionId);

  if (error) {
    throw new Error(error.message || 'No se pudo actualizar el estado de la solicitud.');
  }
}