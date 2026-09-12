import type { Question, ChallengeData } from '@/types';
import questions from '@/data/Trivia_Infectologia.json';

const TIME_PER_QUESTION = 25;

export function getAllQuestions(): Question[] {
  return questions as Question[];
}

export function selectRandomQuestions(count: number): number[] {
  const total = (questions as Question[]).length;
  const indices = Array.from({ length: total }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, Math.min(count, total));
}

export function encodeChallenge(data: ChallengeData): string {
  return btoa(encodeURIComponent(JSON.stringify(data)));
}

export function decodeChallenge(encoded: string): ChallengeData | null {
  try {
    return JSON.parse(decodeURIComponent(atob(encoded)));
  } catch {
    return null;
  }
}

export function calculatePoints(timeLeft: number): number {
  const basePoints = 100;
  const timeBonus = Math.round((timeLeft / TIME_PER_QUESTION) * 100);
  return basePoints + timeBonus;
}

export { TIME_PER_QUESTION };
