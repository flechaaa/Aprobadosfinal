export interface Question {
  pregunta: string;
  opciones: string[];
  correcta: number;
  explicacion: string;
  source_type?: 'official' | 'suggestion';
  author_name?: string | null;
}

export interface ChallengeSelectionPayload {
  universityId: string;
  subjectId: string;
  partialId: string;
  chairId?: string;
  unitId?: string | null;
}

export interface ChallengeData {
  q: Question[]; // antes: number[] (índices) — ahora lleva el contenido real de las preguntas jugadas
  n: string;
  s: number;
  c?: number; // respuestas correctas del desafiante (para mostrar sus estrellas)
  selection?: ChallengeSelectionPayload;
}

export interface AnswerRecord {
  questionIndex: number;
  questionText: string;
  questionOptions: string[];
  selectedIndex: number | null;
  selectedOption: string | null;
  correct: boolean;
  timeLeft: number;
  points: number;
}

export interface University {
  id: string;
  name: string;
}

export interface Subject {
  id: string;
  university_id: string;
  name: string;
}

export interface Chair {
  id: string;
  subject_id: string;
  name: string;
}

export interface TaxonomySuggestion {
  id: string;
  level: 'university' | 'subject' | 'chair';
  proposed_name: string;
  university_id: string | null;
  subject_id: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface Submission {
  id: string;
  created_at: string;
  university: string;
  subject: string;
  chair: string;
  source_notes?: string;
  material_type: 'apunte' | 'preguntero_choice' | 'pregunta_respuesta' | 'texto';
  file_url: string | null;
  storage_path?: string | null;
  file_type: string;
  processed: boolean;
  status?: 'pending' | 'processed' | 'dismissed';
  processing_status?: 'pendiente_procesamiento' | 'procesando' | 'procesado' | 'error' | 'error_tokens';
  processing_error?: string | null;
  processing_attempts?: number;
  processing_started_at?: string | null;
  processed_at?: string | null;
  processed_text?: string | null;
  extracted_questions?: Question[];
}
