export interface Question {
  pregunta: string;
  opciones: string[];
  correcta: number;
  explicacion: string;
}

export interface ChallengeData {
  q: number[];
  n: string;
  s: number;
}

export interface AnswerRecord {
  questionIndex: number;
  selectedIndex: number | null;
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
