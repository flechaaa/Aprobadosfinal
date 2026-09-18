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
  q: number[];
  n: string;
  s: number;
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
  processing_status?: 'pendiente_procesamiento' | 'procesando' | 'procesado' | 'error';
  processed_text?: string | null;
  extracted_questions?: Question[];
}