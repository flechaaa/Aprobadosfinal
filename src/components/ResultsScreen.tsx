import { useState, useEffect, useRef, useCallback } from 'react';
import { Trophy, RefreshCw, Check, X, Swords, Home, Medal, GraduationCap, Download, Camera } from 'lucide-react';
import { toBlob } from 'html-to-image';
import { createChallenge } from '@/utils/game';
import { saveRankingScore } from '@/utils/rankings';
import { ensureTaxonomyFromSubmission } from '@/utils/moderation';
import type { AnswerRecord, ChallengeData, Chair, Question, Subject, University } from '@/types';
import type { TaxonomySelection } from '@/components/TaxonomyPicker';
import { AdBanner } from './AdBanner';
import { RankingModal } from '@/components/RankingModal';

const RANKING_PLAYER_NAME_KEY = 'aprobados-ranking-player-name';
const LOCAL_RANKING_KEY = 'aprobados-local-ranking';

function isAnonymousPlayerName(name: string): boolean {
  return !name.trim() || ['anonimo', 'anónimo'].includes(name.trim().toLocaleLowerCase());
}

interface ResultsScreenProps {
  answers: AnswerRecord[];
  questionIndices: number[];
  questions: Question[];
  playerName: string;
  challengeData: ChallengeData | null;
  selection: TaxonomySelection | null;
  universities: University[];
  subjects: Subject[];
  chairs: Chair[];
  onRestart: () => void;
  onHome: () => void;
  onTaxonomyRefresh?: () => Promise<void> | void;
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function useCountUp(target: number, duration: number) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(target * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return count;
}

export function ResultsScreen({
  answers,
  questionIndices,
  questions,
  playerName,
  challengeData,
  selection,
  universities,
  subjects,
  chairs,
  onRestart,
  onHome,
  onTaxonomyRefresh,
}: ResultsScreenProps) {
  const totalPoints = answers.reduce((sum, a) => sum + a.points, 0);
  const correctCount = answers.filter((a) => a.correct).length;
  const accuracyPercentage = answers.length ? Math.round((correctCount / answers.length) * 100) : 0;
  const approved = accuracyPercentage >= 60;
  const challengeLost = challengeData !== null && totalPoints < challengeData.s;
  const animatedScore = useCountUp(totalPoints, 1200);
  const [showWhatsAppMenu, setShowWhatsAppMenu] = useState(false);
  const playerAlias = playerName.trim() || 'Anónimo';
  const [savingScore, setSavingScore] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [rankingPlayerName, setRankingPlayerName] = useState(() => {
    const savedName = localStorage.getItem(RANKING_PLAYER_NAME_KEY)?.trim();
    return savedName || '';
  });
  const [namePromptOpen, setNamePromptOpen] = useState(() => {
    const savedName = localStorage.getItem(RANKING_PLAYER_NAME_KEY)?.trim();
    return !savedName || isAnonymousPlayerName(playerName);
  });
  const [rankingOpen, setRankingOpen] = useState(false);
  const [rankingPosition, setRankingPosition] = useState<number | null>(null);
  const [downloadFallbackMessage, setDownloadFallbackMessage] = useState('');
  const [showFailureStamp, setShowFailureStamp] = useState(false);
  const storyCardRef = useRef<HTMLDivElement | null>(null);
  const failStampTimerRef = useRef<number | undefined>(undefined);

  const selectedUniversity = universities.find((u) => u.id === selection?.universityId)?.name ?? 'Universidad';
  const selectedSubject = subjects.find((s) => s.id === selection?.subjectId)?.name ?? 'Materia';
  const shareMateria = selection ? selectedSubject : 'Partida rapida';
  const sharePreguntero = selection ? (chairs.find((c) => c.id === selection?.chairId)?.name ?? 'Preguntero') : 'Preguntero general';
  const selectedChair = chairs.find((c) => c.id === selection?.chairId)?.name ?? 'Cátedra';

  const handleDownloadStory = async () => {
    if (!storyCardRef.current) return;

    try {
      const blob = await toBlob(storyCardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        skipFonts: false,
        type: 'image/png',
      });

      if (!blob) {
        throw new Error('No se pudo convertir la tarjeta a imagen.');
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `mi-puntaje-trivia.png`;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error generando imagen del story:', err);
      setSaveError('No se pudo generar la imagen del Story.');
    }
  };

  const handleShareStoryToInstagram = async () => {
    if (!storyCardRef.current) {
      return;
    }

    try {
      const blob = await toBlob(storyCardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        skipFonts: false,
        type: 'image/png',
      });

      if (!blob) {
        throw new Error('No se pudo crear la imagen del Story.');
      }

      const file = new File([blob], 'mi-puntaje-trivia.png', { type: 'image/png' });
      if (typeof navigator !== 'undefined' && 'canShare' in navigator && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Mi puntaje en la Trivia',
          text: '¡Mirá cómo me fue en la trivia de estudiantes!',
        });
      } else {
        await handleDownloadStory();
        setDownloadFallbackMessage('Tu navegador no soporta compartir archivos. La imagen se descargó para subirla manualmente a Instagram Historias.');
      }
    } catch (err) {
      console.error('Error compartiendo la tarjeta de story:', err);
      await handleDownloadStory();
      setDownloadFallbackMessage('No se pudo abrir el menú de Instagram desde aquí. La imagen se descargó para subirla manualmente.');
    }
  };

  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeCreating, setChallengeCreating] = useState(false);
  const challengeCreatedRef = useRef(false);

  useEffect(() => {
    if (challengeCreatedRef.current) return;
    challengeCreatedRef.current = true;
    setChallengeCreating(true);

    const challengePayload = {
      q: questions,
      n: displayName,
      s: totalPoints,
      selection: selection
        ? {
            universityId: selection.universityId,
            subjectId: selection.subjectId,
            partialId: selection.partialId || selection.chairId || '',
            chairId: selection.chairId || selection.partialId || '',
            unitId: selection.unitId ?? null,
          }
        : undefined,
    };

    createChallenge(challengePayload)
      .then((id) => setChallengeId(id))
      .finally(() => setChallengeCreating(false));
    // Se crea una sola vez por partida jugada (challengeCreatedRef lo garantiza),
    // así no se inserta una fila nueva en challenges en cada re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildChallengeUrl = (): string | null => {
    if (!challengeId) return null;

    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('mode', 'challenge');
    url.searchParams.set('id', challengeId);
    url.searchParams.set('materia', shareMateria);
    url.searchParams.set('preguntero', sharePreguntero);
    url.searchParams.set('puntaje', String(totalPoints));
    url.searchParams.set('jugador', displayName);
    return url.toString();
  };

  const buildWhatsAppCombinedMessage = (): string | null => {
    const challengeUrl = buildChallengeUrl();
    if (!challengeUrl) return null;
    return `Mi resultado en Aprobados: ${shareMateria} - ${totalPoints} puntos. Desafia a un amigo: ${challengeUrl}`;
  };

  const handleWhatsAppDirect = () => {
    const message = buildWhatsAppCombinedMessage();
    if (!message) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  };

  useEffect(() => {
    const url = buildChallengeUrl();
    if (!url) return;

    const previewTitle = `${displayName} obtuvo ${totalPoints} puntos en Aprobados`;
    const previewDescription = `${shareMateria} | ${sharePreguntero} | Puntaje: ${totalPoints}`;
    const previewImage = `https://dummyimage.com/1200x630/0f766e/ffffff.png&text=${encodeURIComponent(
      `Aprobados | ${shareMateria} | ${sharePreguntero} | ${totalPoints} puntos`,
    )}`;

    document.title = previewTitle;
    const metadata = [
      ['og:title', previewTitle],
      ['og:description', previewDescription],
      ['og:url', url],
      ['og:image', previewImage],
      ['og:image:alt', previewDescription],
      ['twitter:title', previewTitle],
      ['twitter:description', previewDescription],
      ['twitter:image', previewImage],
    ];

    metadata.forEach(([property, content]) => {
      const attribute = property.startsWith('twitter:') ? 'name' : 'property';
      let tag = document.head.querySelector(`meta[${attribute}="${property}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute(attribute, property);
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', content);
    });
  }, [challengeId, displayName, questions, shareMateria, sharePreguntero, totalPoints]);

  const playAudio = (url: string) => {
    try {
      const audio = new Audio(url);
      audio.volume = 0.8;
      void audio.play().catch(() => {
        console.info('La reproducción automática fue bloqueada por el navegador.');
      });
    } catch (error) {
      console.info('No se pudo inicializar el audio de feedback.', error);
    }
  };

  const launchVictoryEffects = () => {
    playAudio('https://www.myinstants.com/media/sounds/tada.mp3');
  };

  const launchDefeatEffects = () => {

    setShowFailureStamp(true);
    if (failStampTimerRef.current) {
      clearTimeout(failStampTimerRef.current);
    }

    failStampTimerRef.current = window.setTimeout(() => {
      setShowFailureStamp(false);
    }, 2600);
  };

  useEffect(() => {
    if (approved && !challengeLost) {
      launchVictoryEffects();
    } else {
      launchDefeatEffects();
    }

    return () => {
      if (failStampTimerRef.current) {
        clearTimeout(failStampTimerRef.current);
      }
    };
  }, [approved, challengeLost]);

  const clearFailureEffects = () => {
    if (failStampTimerRef.current) {
      clearTimeout(failStampTimerRef.current);
    }
    setShowFailureStamp(false);
  };

  const handleRestart = () => {
    clearFailureEffects();
    onRestart();
  };

  const handleHome = () => {
    clearFailureEffects();
    onHome();
  };

  const isChallenge = challengeData !== null;
  const wonChallenge = isChallenge && totalPoints > challengeData!.s;
  const tiedChallenge = isChallenge && totalPoints === challengeData!.s;

  const getRating = () => {
    if (correctCount === 5)
      return { label: '¡Excelente!', color: 'text-teal-600', stars: 5 };
    if (correctCount >= 3)
      return { label: '¡Muy bien!', color: 'text-teal-600', stars: 4 };
    if (correctCount >= 2)
      return { label: 'Nada mal', color: 'text-amber-600', stars: 3 };
    if (correctCount >= 1)
      return { label: 'Hay que repasar', color: 'text-amber-600', stars: 2 };
    return { label: 'A estudiar...', color: 'text-red-500', stars: 1 };
  };

  const rating = getRating();

  const hasRankingChair = Boolean(selection?.chairId && selection.chairId !== 'all');
  const effectiveRankingName = rankingPlayerName.trim();
  const displayName = effectiveRankingName || playerAlias;

  const handleRankingNameSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get('ranking-name') ?? '').trim().slice(0, 50);
    if (!name || isAnonymousPlayerName(name)) return;

    localStorage.setItem(RANKING_PLAYER_NAME_KEY, name);
    setRankingPlayerName(name);
    setNamePromptOpen(false);
  };

  const handleSaveScore = useCallback(async () => {
    if (!effectiveRankingName || saveSuccess) {
      return;
    }

    if (!hasRankingChair) {
      let storedEntries: Array<{ id: string; player_name: string; score: number }> = [];
      try {
        storedEntries = JSON.parse(localStorage.getItem(LOCAL_RANKING_KEY) ?? '[]') as Array<{ id: string; player_name: string; score: number }>;
      } catch {
        storedEntries = [];
      }
      const newEntry = { id: `${Date.now()}-${Math.random()}`, player_name: effectiveRankingName, score: totalPoints };
      const entries = [...storedEntries, newEntry].sort((left, right) => right.score - left.score);
      localStorage.setItem(LOCAL_RANKING_KEY, JSON.stringify(entries));
      setRankingPosition(entries.findIndex((entry) => entry.id === newEntry.id) + 1);
      setSaveSuccess(true);
      return;
    }

    setSaveError('');
    setSaveSuccess(false);
    setSavingScore(true);

    try {
      const taxonomy = await ensureTaxonomyFromSubmission({
        university: selectedUniversity,
        subject: selectedSubject,
        chair: selectedChair,
      });

      const result = await saveRankingScore({
        chairId: taxonomy.chairId,
        playerName: effectiveRankingName,
        score: totalPoints,
        universityId: taxonomy.universityId,
        subjectId: taxonomy.subjectId,
        unit: selection?.unitId ?? null,
        correctAnswers: correctCount,
        questionsAnswered: answers.length,
      });

      setRankingPosition(result.position);
      setSaveSuccess(true);

      if (onTaxonomyRefresh) {
        await Promise.resolve(onTaxonomyRefresh());
      }
    } catch (err) {
      console.error('Error guardando puntaje o asegurando taxonomía:', err);
      setSaveError('No pudimos guardar el puntaje. Intentá nuevamente.');
    } finally {
      setSavingScore(false);
    }
  }, [effectiveRankingName, hasRankingChair, onTaxonomyRefresh, saveSuccess, selectedChair, selectedSubject, selectedUniversity, selection, totalPoints]);

  useEffect(() => {
    void handleSaveScore();
  }, [handleSaveScore]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-teal-50">
      {(!approved || challengeLost) && showFailureStamp && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 animate-[toast-in_350ms_ease-out]">
          <p className="rounded-full bg-teal-900/90 px-5 py-2 text-center text-sm font-bold text-white shadow-lg backdrop-blur-sm">
            &iexcl;Intentalo de vuelta! &iexcl;Esta vez sale!
          </p>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Score card */}
        <div className="bg-white rounded-3xl shadow-xl p-8 text-center animate-pop-in mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-teal-100 rounded-2xl mb-4">
            <Trophy className="w-8 h-8 text-teal-600" />
          </div>
          <p className="text-gray-500 font-medium mb-1">Tu puntaje</p>
          <p className="text-5xl font-extrabold text-gray-900 mb-2">{animatedScore}</p>
          <p className={`text-lg font-bold ${rating.color}`}>{rating.label}</p>

          {/* Stars */}
          <div className="flex items-center justify-center gap-1 mt-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <span
                key={i}
                className={`text-2xl ${i < rating.stars ? 'text-amber-400' : 'text-gray-200'}`}
              >
                ★
              </span>
            ))}
          </div>

          <div className="flex items-center justify-center gap-6 mt-6 pt-6 border-t border-gray-100">
            <div>
              <p className="text-2xl font-bold text-gray-900">{correctCount}/5</p>
              <p className="text-sm text-gray-500">Correctas</p>
            </div>
            <div className="w-px h-10 bg-gray-200" />
            <div>
              <p className="text-2xl font-bold text-gray-900">{totalPoints}</p>
              <p className="text-sm text-gray-500">Puntos</p>
            </div>
          </div>

          {rankingPosition && (
            <div className="mt-4 rounded-2xl bg-teal-50 border border-teal-200 px-4 py-3">
              <p className="text-sm font-black uppercase tracking-wide text-teal-700">Ranking</p>
              <p className="text-lg font-extrabold text-gray-900">¡Quedaste en el Puesto #{rankingPosition} del ranking!</p>
            </div>
          )}
        </div>

        {/* Challenge comparison */}
        {isChallenge && (
          <div
            className={`rounded-3xl p-6 mb-6 animate-slide-up ${
              wonChallenge
                ? 'bg-green-50 border-2 border-green-200'
                : tiedChallenge
                ? 'bg-amber-50 border-2 border-amber-200'
                : 'bg-red-50 border-2 border-red-200'
            }`}
          >
            <div className="flex items-center justify-center gap-2 mb-4">
              <Swords className="w-5 h-5 text-gray-400" />
              <span className="text-sm font-bold text-gray-500 uppercase tracking-wide">
                Resultado del desafío
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-center flex-1">
                <p className="text-sm text-gray-500 font-medium">{challengeData!.n}</p>
                <p className="text-3xl font-bold text-gray-800">{challengeData!.s}</p>
                <p className="text-xs text-gray-400">puntos</p>
              </div>
              <div className="text-xl font-bold text-gray-300 px-4">VS</div>
              <div className="text-center flex-1">
                <p className="text-sm text-gray-500 font-medium">{displayName}</p>
                <p className="text-3xl font-bold text-gray-800">{totalPoints}</p>
                <p className="text-xs text-gray-400">puntos</p>
              </div>
            </div>
            <p
              className={`text-center font-bold mt-4 ${
                wonChallenge
                  ? 'text-green-600'
                  : tiedChallenge
                  ? 'text-amber-600'
                  : 'text-red-500'
              }`}
            >
              {wonChallenge
                ? `¡Le ganaste a ${challengeData!.n}!`
                : tiedChallenge
                ? '¡Empate!'
                : `${challengeData!.n} te superó por ahora`}
            </p>
          </div>
        )}

        {/* Story card preview */}
        <>
          <div className="bg-white rounded-3xl shadow-xl p-4 mb-6">
            <div
              ref={storyCardRef}
              className="relative overflow-hidden rounded-3xl border-4 border-teal-700 bg-gradient-to-br from-teal-950 via-teal-900 to-emerald-700 p-8 text-white shadow-xl"
              style={{ minHeight: 280 }}
            >
              <div className="absolute inset-0 opacity-20">
                <div className="absolute -left-12 top-0 h-40 w-40 rounded-full bg-white blur-3xl" />
                <div className="absolute right-0 bottom-0 h-48 w-48 rounded-full bg-emerald-200 blur-3xl" />
              </div>

              <div className="relative z-10 flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center ring-2 ring-white/60">
                    <GraduationCap className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-teal-100">Aprobados</p>
                    <h3 className="text-2xl font-black leading-tight">{selectedUniversity || 'Aprobados'}</h3>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[11px] font-black uppercase tracking-[0.2em] text-teal-100">Ranking</span>
                  <span className="block text-2xl font-black">#{rankingPosition ?? 'â€”'}</span>
                </div>
              </div>

              <div className="relative z-10 mt-7">
                <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-xs font-black uppercase tracking-wide">
                  <Trophy className="w-4 h-4" />
                  {shareMateria}
                </div>
                <div className="mt-2">
                  <p className="text-xs font-black uppercase tracking-wide text-teal-100">Cátedra</p>
                  <p className="text-lg font-black">{sharePreguntero}</p>
                </div>
              </div>

              <div className="relative z-10 mt-8 flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-teal-100">Puntaje final</p>
                  <p className="text-5xl font-black leading-none">{totalPoints}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-teal-100">Mi puesto</p>
                  <p className="text-3xl font-black">#{rankingPosition ?? 'â€”'}</p>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleShareStoryToInstagram}
                className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white font-bold px-4 py-3 rounded-2xl hover:opacity-90 transition shadow-md"
              >
                <Camera className="w-4 h-4" />
                Compartir Historia de Instagram
              </button>

              <button
                type="button"
                onClick={handleWhatsAppDirect}
                disabled={challengeCreating || !challengeId}
                className="inline-flex items-center justify-center gap-2 bg-[#25D366] text-white font-bold px-4 py-3 rounded-2xl hover:bg-[#20bd5a] transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <WhatsAppIcon className="w-4 h-4" />
                {challengeCreating ? 'Preparando desafío...' : 'Desafia por wsp'}
              </button>
            </div>

            {downloadFallbackMessage && (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                {downloadFallbackMessage}
              </div>
            )}
          </div>
        </>

        {/* Ranking status */}
        <div className="bg-white rounded-3xl shadow-xl p-6 mb-6">
          <div className="bg-white rounded-3xl shadow-xl p-6 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Ranking</p>
                <p className="text-sm font-semibold text-gray-700">
                  {!hasRankingChair
                    ? saveSuccess
                      ? 'Puntaje guardado en el ranking local de partidas rápidas.'
                      : 'Guardá tu nombre para registrar este puntaje.'
                    : savingScore
                    ? 'Guardando tu puntaje...'
                    : saveSuccess
                    ? 'Puntaje guardado automáticamente.'
                    : 'El puntaje se guarda automáticamente.'}
                </p>
                {saveError && <p className="mt-1 text-sm font-bold text-red-600">{saveError}</p>}
              </div>
              <div className="flex gap-2 items-center">
                <button
                  type="button"
                  onClick={() => setRankingOpen(true)}
                  className="inline-flex items-center justify-center gap-2 bg-white border-2 border-teal-200 text-teal-700 font-bold px-5 py-3 rounded-2xl hover:bg-teal-50 transition"
                >
                  <Medal className="w-4 h-4" />
                  Top 10
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Answer review */}
        <div className="bg-white rounded-3xl shadow-xl p-6 mb-6">
          <h3 className="font-bold text-gray-800 mb-4">Repaso de respuestas</h3>
          <div className="space-y-3">
            {answers.map((answer, i) => {
              const selectedText = answer.selectedIndex === null
                ? 'Sin respuesta'
                : answer.selectedOption ?? answer.questionOptions[answer.selectedIndex] ?? 'Opción no disponible';

              return (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      answer.correct ? 'bg-green-100' : 'bg-red-100'
                    }`}
                  >
                    {answer.correct ? (
                      <Check className="w-4 h-4 text-green-600" />
                    ) : (
                      <X className="w-4 h-4 text-red-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 line-clamp-2">
                      {answer.questionText ?? 'Pregunta'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {answer.correct
                        ? `Correcta â€¢ +${answer.points} pts`
                        : `Incorrecta â€¢ ${selectedText}`}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Opción elegida: {selectedText}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-3 mb-6">
          <button
            onClick={handleRestart}
            className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-4 rounded-xl transition-all shadow-md hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-5 h-5" />
            Jugar de nuevo
          </button>

          <button
            onClick={handleHome}
            className="w-full bg-white border-2 border-gray-200 hover:border-gray-400 text-gray-700 font-bold py-4 rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <Home className="w-5 h-5 text-gray-500" />
            Volver al menú principal
          </button>
        </div>

        {namePromptOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
            <form onSubmit={handleRankingNameSubmit} className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
              <h2 className="text-xl font-extrabold text-gray-900">Guardá tu lugar en el ranking</h2>
              <p className="mt-2 text-sm text-gray-600">Ingresá un nombre o apodo para registrar tu puntaje.</p>
              <input
                name="ranking-name"
                type="text"
                defaultValue={!isAnonymousPlayerName(playerName) ? playerName : ''}
                autoFocus
                maxLength={50}
                required
                placeholder="Tu nombre o apodo"
                className="mt-4 w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none focus:border-teal-500"
              />
              <button type="submit" className="mt-4 w-full rounded-xl bg-teal-600 px-4 py-3 font-bold text-white hover:bg-teal-700">
                Guardar puntaje
              </button>
            </form>
          </div>
        )}

        <RankingModal open={rankingOpen} chairId={hasRankingChair ? selection?.chairId ?? null : null} chairs={chairs} universities={universities} subjects={subjects} onClose={() => setRankingOpen(false)} />

        {/* Ad banner */}
        <AdBanner />
      </div>
    </div>
  );
}
