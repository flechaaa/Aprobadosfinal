import { useState, useEffect } from 'react';
import { Trophy, RefreshCw, Check, X, Swords, Home } from 'lucide-react';
import { getAllQuestions, encodeChallenge } from '@/utils/game';
import type { AnswerRecord, ChallengeData } from '@/types';
import { AdBanner } from './AdBanner';

interface ResultsScreenProps {
  answers: AnswerRecord[];
  questionIndices: number[];
  playerName: string;
  challengeData: ChallengeData | null;
  onRestart: () => void;
  onHome: () => void;
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
  playerName,
  challengeData,
  onRestart,
  onHome,
}: ResultsScreenProps) {
  const totalPoints = answers.reduce((sum, a) => sum + a.points, 0);
  const correctCount = answers.filter((a) => a.correct).length;
  const animatedScore = useCountUp(totalPoints, 1200);
  const [shareUrl, setShareUrl] = useState('');

  const allQuestions = getAllQuestions();

  useEffect(() => {
    const data: ChallengeData = { q: questionIndices, n: playerName, s: totalPoints };
    const encoded = encodeChallenge(data);
    const url = `${window.location.origin}${window.location.pathname}?c=${encoded}`;
    setShareUrl(url);
  }, [questionIndices, playerName, totalPoints]);

  const handleWhatsAppShare = () => {
    const message = `¡Te desafío a superar mis ${totalPoints} puntos en Aprobados! ¿Podrás ganarle a un estudiante de medicina? ${shareUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-teal-50">
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
                <p className="text-sm text-gray-500 font-medium">{playerName}</p>
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

        {/* Answer review */}
        <div className="bg-white rounded-3xl shadow-xl p-6 mb-6">
          <h3 className="font-bold text-gray-800 mb-4">Repaso de respuestas</h3>
          <div className="space-y-3">
            {answers.map((answer, i) => {
              const q = allQuestions[answer.questionIndex];
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
                      {q?.pregunta ?? 'Pregunta'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {answer.correct
                        ? `+${answer.points} pts`
                        : answer.selectedIndex === null
                        ? 'Sin respuesta'
                        : 'Sin puntos'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-3 mb-6">
          {/* 1. Desafiar por WhatsApp */}
          <button
            onClick={handleWhatsAppShare}
            className="w-full bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold py-4 rounded-xl transition-all shadow-md hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <WhatsAppIcon className="w-5 h-5" />
            Desafiar a un amigo por WhatsApp
          </button>

          {/* 2. Jugar de nuevo con la misma materia */}
          <button
            onClick={onRestart}
            className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-4 rounded-xl transition-all shadow-md hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-5 h-5" />
            Jugar de nuevo
          </button>

          {/* 3. Volver al menú principal */}
          <button
            onClick={onHome}
            className="w-full bg-white border-2 border-gray-200 hover:border-gray-400 text-gray-700 font-bold py-4 rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <Home className="w-5 h-5 text-gray-500" />
            Volver al menú principal
          </button>
        </div>

        {/* Ad banner */}
        <AdBanner />
      </div>
    </div>
  );
}