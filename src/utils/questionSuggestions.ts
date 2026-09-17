import { supabase } from '@/lib/supabase';
import { ensureTaxonomyFromSubmission } from '@/utils/moderation';

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
  const safeAuthorName = (payload.author_name?.trim() || 'Anónimo').slice(0, 80);

  const { error } = await supabase.from('question_suggestions').insert([
    {
      university_id: payload.university_id,
      subject_id: payload.subject_id,
      chair_id: payload.chair_id,
      unit_name: payload.unit_name?.trim() || null,
      question_text: payload.question_text.trim(),
      options: payload.options.map((option) => option.trim()),
      correct_option: payload.correct_option,
      explanation: payload.explanation?.trim() ?? null,
      difficulty: payload.difficulty ?? 'media',
      author_name: safeAuthorName,
      status: 'pending',
    },
  ]);

  if (error) {
    throw new Error(error.message || 'No se pudo enviar la propuesta de pregunta.');
  }
}

export async function loadPendingQuestionSuggestions(): Promise<QuestionSuggestionRecord[]> {
  const { data: rows, error } = await supabase
    .from('question_suggestions')
    .select('id, university_id, subject_id, chair_id, unit_name, question_text, options, correct_option, explanation, difficulty, author_name, status, created_at')
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
      subject_id: taxonomy.subjectId,
      chair_id: taxonomy.chairId,
      unit: suggestion.unit_name?.trim() || null,
      university: universityName,
      subject: subjectName,
      chair: chairName,
      difficulty: normalizedQuestion.difficulty,
      author_name: normalizedQuestion.authorName,
      source_type: 'suggestion',
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
