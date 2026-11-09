import type { TaxonomySelection } from '@/components/TaxonomyPicker';
import type { Question } from '@/types';
import { loadQuestionsForGame, QUESTIONS_PER_GAME } from '@/utils/game';

/**
 * Selección para jugar. Igual que TaxonomySelection, pero puede traer varios
 * parciales: `chairId` es el primero (referencia para ranking e historial) y
 * `chairIds` la lista completa cuando se eligieron dos o más.
 */
export type PlaySelection = TaxonomySelection & { chairIds?: string[] };

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Carga las preguntas de una partida. Con un solo parcial (o "todos") funciona
 * igual que antes. Con varios, pide preguntas a cada parcial y las intercala
 * una a una, para que todos los parciales elegidos queden representados.
 */
export async function loadQuestionsForPlaySelection(selection: PlaySelection): Promise<Question[]> {
  const chairIds = Array.from(new Set((selection.chairIds ?? []).filter(Boolean)));
  if (chairIds.length <= 1) return loadQuestionsForGame(selection);

  const results = await Promise.allSettled(
    chairIds.map((id) => loadQuestionsForGame({ ...selection, chairId: id, partialId: id })),
  );

  const batches = results
    .filter((result): result is PromiseFulfilledResult<Question[]> => result.status === 'fulfilled')
    .map((result) => shuffle(result.value));

  if (batches.length === 0) {
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    throw failed?.reason instanceof Error ? failed.reason : new Error('No se pudieron cargar las preguntas.');
  }

  const merged: Question[] = [];
  const seen = new Set<string>();
  const cursors = batches.map(() => 0);

  // Una pregunta de cada parcial por vuelta, sin repetir enunciados.
  while (merged.length < QUESTIONS_PER_GAME) {
    let tookAny = false;
    for (let b = 0; b < batches.length && merged.length < QUESTIONS_PER_GAME; b += 1) {
      while (cursors[b] < batches[b].length) {
        const question = batches[b][cursors[b]];
        cursors[b] += 1;
        const key = question.pregunta.trim().toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(question);
          tookAny = true;
          break;
        }
      }
    }
    if (!tookAny) break;
  }

  return shuffle(merged);
}
