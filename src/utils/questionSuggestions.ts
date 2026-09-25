import { supabase } from '@/lib/supabase';
import { ensureTaxonomyFromSubmission } from '@/utils/moderation';
import { extractQuestionFromImage, extractQuestionsFromFile } from '@/utils/gemini';
import { fetchAndExtractText } from '@/utils/fileParser';
import { deleteSubmission } from '@/utils/submissions';

export type QuestionDifficulty = 'facil' | 'media' | 'dificil';

export interface QuestionSuggestionPayload {
  university_id: string;
  subject_id: string;
  chair_id: string;
  unit_name?: string | null;
  question_text: string;
  options: string[];
  correct_option: number;
  explanation?: string;
  difficulty?: QuestionDifficulty;
  author_name?: string;
  status?: 'pending';
  source_submission_id?: string | null;
  source_file_url?: string | null;
  source_storage_path?: string | null;
}

export interface QuestionSuggestionRecord {
  id: string;
  university_id: string;
  subject_id: string;
  chair_id: string;
  unit_name?: string | null;
  question_text: string;
  options: string[];
  correct_option: number;
  explanation?: string | null;
  difficulty?: QuestionDifficulty | null;
  author_name?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  source_submission_id?: string | null;
  source_file_url?: string | null;
  source_storage_path?: string | null;
  university_name?: string;
  subject_name?: string;
  chair_name?: string;
}

function normalizeApprovedQuestion(suggestion: QuestionSuggestionRecord) {
  const questionText = suggestion.question_text?.trim() ?? '';
  const options = Array.isArray(suggestion.options)
    ? suggestion.options.map((option) => (typeof option === 'string' ? option.trim() : '')).filter(Boolean)
    : [];
  const correctOption = Number(suggestion.correct_option);

  if (
    questionText.length < 10 ||
    options.length !== 4 ||
    !Number.isInteger(correctOption) ||
    correctOption < 0 ||
    correctOption > 3
  ) {
    throw new Error('La pregunta debe tener enunciado, exactamente 4 opciones y una respuesta válida.');
  }

  return {
    questionText,
    options,
    correctOption,
    explanation: suggestion.explanation?.trim() || 'Sin explicación disponible.',
    difficulty: suggestion.difficulty === 'facil' || suggestion.difficulty === 'dificil' ? suggestion.difficulty : 'media',
    authorName: (suggestion.author_name?.trim() || 'Anónimo').slice(0, 80),
  };
}

export async function submitQuestionSuggestion(payload: QuestionSuggestionPayload) {
  const safeQuestionText = payload.question_text.trim();
  const safeOptions = payload.options.map((option) => option.trim());
  const safeAuthorName = (payload.author_name?.trim() || 'Anónimo').slice(0, 80);

  if (!payload.university_id || !payload.subject_id || !payload.chair_id) {
    throw new Error('Seleccioná universidad, materia y cátedra antes de enviar.');
  }
  if (safeQuestionText.length < 10) {
    throw new Error('El enunciado debe tener al menos 10 caracteres.');
  }
  if (safeOptions.length !== 4 || safeOptions.some((option) => !option)) {
    throw new Error('La propuesta debe incluir exactamente 4 opciones completas.');
  }
  if (!Number.isInteger(payload.correct_option) || payload.correct_option < 0 || payload.correct_option > 3) {
    throw new Error('La respuesta correcta seleccionada no es válida.');
  }

  try {
    const { error } = await supabase.from('question_suggestions').insert([
      {
        university_id: payload.university_id,
        subject_id: payload.subject_id,
        chair_id: payload.chair_id,
        unit_name: payload.unit_name?.trim() || null,
        question_text: safeQuestionText,
        options: safeOptions,
        correct_option: payload.correct_option,
        explanation: payload.explanation?.trim() || null,
        difficulty: payload.difficulty ?? 'media',
        author_name: safeAuthorName,
        status: 'pending',
        source_submission_id: payload.source_submission_id ?? null,
        source_file_url: payload.source_file_url ?? null,
        source_storage_path: payload.source_storage_path ?? null,
      },
    ]);

    if (error) {
      if (error.code === '42501') {
        throw new Error('No tenés permisos para enviar propuestas. Revisá la política RLS de question_suggestions.');
      }
      if (error.code === '23503') {
        throw new Error('La universidad, materia o cátedra seleccionada ya no existe. Volvé a elegirlas.');
      }
      if (error.code === '23514') {
        throw new Error('La propuesta contiene un valor no permitido. Revisá dificultad y respuesta correcta.');
      }
      if (error.code === '42703' || error.code === 'PGRST204') {
        throw new Error('La base de datos no tiene actualizada la estructura de propuestas. Aplicá las migraciones pendientes.');
      }
      throw new Error(error.message || 'No se pudo enviar la propuesta de pregunta.');
    }
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('No se pudo enviar la propuesta de pregunta. Intentá nuevamente.');
  }
}

export async function processImageSubmission(input: {
  submissionId?: string;
  storagePath?: string | null;
  fileUrl: string;
  fileType: string;
  university: string;
  subject: string;
  chair: string;
}): Promise<void> {
  const question = await extractQuestionFromImage(input.fileUrl, input.fileType);
  const taxonomy = await ensureTaxonomyFromSubmission(input);

  await submitQuestionSuggestion({
    university_id: taxonomy.universityId,
    subject_id: taxonomy.subjectId,
    chair_id: taxonomy.chairId,
    question_text: question.pregunta,
    options: question.opciones,
    correct_option: question.correcta,
    explanation: question.explicacion,
    difficulty: 'media',
    author_name: 'IA - revisar por administrador',
    status: 'pending',
    source_submission_id: input.submissionId ?? null,
    source_file_url: input.fileUrl,
    source_storage_path: input.storagePath ?? null,
  });
}

export async function processTextSubmission(input: {
  submissionId?: string;
  text: string;
  university: string;
  subject: string;
  chair: string;
}): Promise<number> {
  const result = await extractQuestionsFromFile(input.text);
  if (result.error || result.questions.length === 0) {
    throw new Error(result.error || 'La IA no encontró preguntas en el texto.');
  }

  const taxonomy = await ensureTaxonomyFromSubmission(input);
  for (const question of result.questions) {
    await submitQuestionSuggestion({
      university_id: taxonomy.universityId,
      subject_id: taxonomy.subjectId,
      chair_id: taxonomy.chairId,
      question_text: question.pregunta,
      options: question.opciones,
      correct_option: question.correcta,
      explanation: question.explicacion,
      difficulty: 'media',
      author_name: 'IA - revisar por administrador',
      status: 'pending',
      source_submission_id: input.submissionId ?? null,
      source_file_url: null,
      source_storage_path: null,
    });
  }

  return result.questions.length;
}

export async function processFileSubmission(input: {
  submissionId?: string;
  storagePath?: string | null;
  fileUrl: string;
  fileType: string;
  university: string;
  subject: string;
  chair: string;
}): Promise<number> {
  const text = await fetchAndExtractText(input.fileUrl, input.fileType);
  if (text.trim().length < 20) throw new Error('El archivo no contiene suficiente texto legible.');
  const count = await processTextSubmission({ ...input, text });
  return count;
}

export async function loadPendingQuestionSuggestions(): Promise<QuestionSuggestionRecord[]> {
  const { data: rows, error } = await supabase
    .from('question_suggestions')
    .select('id, university_id, subject_id, chair_id, unit_name, question_text, options, correct_option, explanation, difficulty, author_name, status, created_at, source_submission_id, source_file_url, source_storage_path')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message || 'No se pudieron cargar las propuestas pendientes.');

  const [{ data: universities }, { data: subjects }, { data: chairs }] = await Promise.all([
    supabase.from('universities').select('id, name'),
    supabase.from('subjects').select('id, university_id, name'),
    supabase.from('chairs').select('id, subject_id, name'),
  ]);

  const universityMap = new Map((universities ?? []).map((u: { id: string; name: string }) => [u.id, u.name]));
  const subjectMap = new Map((subjects ?? []).map((s: { id: string; name: string }) => [s.id, s.name]));
  const chairMap = new Map((chairs ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));

  return (rows ?? []).map((row) => ({
    ...row,
    university_name: universityMap.get(row.university_id) ?? 'Universidad no encontrada',
    subject_name: subjectMap.get(row.subject_id) ?? 'Materia no encontrada',
    chair_name: chairMap.get(row.chair_id) ?? 'Cátedra no encontrada',
  })) as QuestionSuggestionRecord[];
}

export async function cleanupSuggestionSourceIfUnused(
  suggestion: QuestionSuggestionRecord,
  adminPassword: string,
): Promise<void> {
  if (!suggestion.source_submission_id) return;
  const { count, error } = await supabase
    .from('question_suggestions')
    .select('id', { count: 'exact', head: true })
    .eq('source_submission_id', suggestion.source_submission_id)
    .eq('status', 'pending');
  if (error || (count ?? 0) > 0) return;

  await deleteSubmission(
    suggestion.source_submission_id,
    suggestion.source_file_url ?? null,
    suggestion.source_storage_path,
    adminPassword,
  );
}

export async function approveQuestionSuggestion(suggestion: QuestionSuggestionRecord, adminPassword?: string) {
  const universityName = suggestion.university_name ?? 'Universidad';
  const subjectName = suggestion.subject_name ?? 'Materia';
  const chairName = suggestion.chair_name ?? 'Cátedra';

  const taxonomy = await ensureTaxonomyFromSubmission(
    {
      university: universityName,
      subject: subjectName,
      chair: chairName,
    },
    adminPassword,
  );

  const normalizedQuestion = normalizeApprovedQuestion(suggestion);

  const { error: insertError } = await supabase.from('questions').insert([
    {
      question: normalizedQuestion.questionText,
      options: normalizedQuestion.options,
      correct_option: normalizedQuestion.correctOption,
      explanation: normalizedQuestion.explanation,
      active: true,
      is_active: true,
      subject_id: taxonomy.subjectId,
      chair_id: taxonomy.chairId,
      university: universityName,
      subject: subjectName,
      chair: chairName,
      difficulty: normalizedQuestion.difficulty,
    },
  ]);

  if (insertError) {
    throw new Error(insertError.message || 'No se pudo publicar la pregunta propuesta.');
  }

  const { error: updateError } = await supabase
    .from('question_suggestions')
    .update({
      question_text: normalizedQuestion.questionText,
      options: normalizedQuestion.options,
      correct_option: normalizedQuestion.correctOption,
      explanation: normalizedQuestion.explanation,
      difficulty: normalizedQuestion.difficulty,
      author_name: normalizedQuestion.authorName,
      status: 'approved',
    })
    .eq('id', suggestion.id);

  if (updateError) {
    throw new Error(updateError.message || 'No se pudo marcar la propuesta como aprobada.');
  }

  await cleanupSuggestionSourceIfUnused(suggestion, adminPassword ?? '');
}

export async function rejectQuestionSuggestion(suggestionId: string) {
  const { error } = await supabase
    .from('question_suggestions')
    .update({ status: 'rejected' })
    .eq('id', suggestionId);

  if (error) {
    throw new Error(error.message || 'No se pudo rechazar la propuesta.');
  }
}