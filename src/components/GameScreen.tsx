import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Check, X, Clock, ChevronRight } from 'lucide-react';
import { getAllQuestions, calculatePoints, TIME_PER_QUESTION } from '@/utils/game';
import type { AnswerRecord, Question } from '@/types';

interface GameScreenProps {
  questionIndices: number[];
  onFinish: (answers: AnswerRecord[]) => void;
}

const LETTERS = ['A', 'B', 'C', 'D'];

// Baraja las opciones de la pregunta y actualiza el índice de la respuesta correcta
function shuffleQuestionOptions(q: Question): Question {
  const originalOptions = [...q.opciones];
  const correctText = originalOptions[q.correcta];

  // Algoritmo Fisher-Yates
  const shuffled = [...originalOptions];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return {
    ...q,
    opciones: shuffled,
    correcta: shuffled.indexOf(correctText),
  };
}

export function GameScreen({ questionIndices, onFinish }: GameScreenProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TIME_PER_QUESTION);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const answeredRef = useRef(false);

  const allQuestions = getAllQuestions();
  const rawQuestion = allQuestions[questionIndices[currentIdx]];

  // Cada vez que cambia de pregunta (currentIdx), baraja las opciones al azar
  const question = useMemo(() => {
    if (!rawQuestion) return rawQuestion;
    return shuffleQuestionOptions(rawQuestion);
  }, [currentIdx, rawQuestion]);

  const totalQuestions = questionIndices.length;
  const currentScore = answers.reduce((sum, a) => sum + a.points, 0);

  // Reset for new question
  useEffect(() => {
    answeredRef.current = false;
    setTimeLeft(TIME_PER_QUESTION);
    setSelectedAnswer(null);
    setShowFeedback(false);
  }, [currentIdx]);

  const recordAnswer = useCallback((idx: number | null) => {
    if (answeredRef.current || !question) return;
    answeredRef.current = true;
    const correct = idx !== null && idx === question.correcta;
    const points = correct ? calculatePoints(timeLeft) : 0;
    setSelectedAnswer(idx);
    setShowFeedback(true);
    setAnswers((prev) => [
      ...prev,
      {
        questionIndex: questionIndices[currentIdx],
        selectedIndex: idx,
        correct,
        timeLeft,
        points,
      },
    ]);
  }, [currentIdx, question, questionIndices, timeLeft]);

  // Timer
  useEffect(() => {
    if (showFeedback || answeredRef.current) return;
    if (timeLeft <= 0) {
      recordAnswer(null);
      return;
    }
    const id = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [timeLeft, showFeedback, recordAnswer]);

  const handleNext = () => {
    if (currentIdx < totalQuestions - 1) {
      setCurrentIdx((i) => i + 1);
    } else {
      onFinish(answers);
    }
  };

  if (!question) return null;

  const timerPercent = (timeLeft / TIME_PER_QUESTION) * 100;
  const timerColor =
    timeLeft > 12 ? 'bg-teal-500' : timeLeft > 6 ? 'bg-amber-500' : 'bg-red-500';
  const timerPulse = timeLeft <= 5 && !showFeedback;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-teal-50 flex flex-col">
      {/* Header */}
      <div className="px-4 pt-6 pb-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-center gap-2 mb-3">
            {Array.from({ length: totalQuestions }).map((_, i) => (
              <div
                key={i}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === currentIdx
                    ? 'w-8 bg-teal-600'
                    : i < currentIdx
                    ? 'w-2 bg-teal-400'
                    : 'w-2 bg-gray-300'
                }`}
              />
            ))}
          </div>
          <div className="flex items-center justify-between px-1">
            <p className="text-sm font-medium text-gray-500">
              Pregunta {currentIdx + 1} de {totalQuestions}
            </p>
            <p className="text-sm font-bold text-teal-600">{currentScore} pts</p>
          </div>
        </div>
      </div>

      {/* Question card */}
      <div className="flex-1 px-4 pb-6">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
            {/* Timer bar */}
            <div className="h-1.5 bg-gray-100 relative">
              <div
                className={`h-full transition-all duration-1000 ease-linear ${timerColor} ${timerPulse ? 'animate-timer-pulse' : ''}`}
                style={{ width: `${timerPercent}%` }}
              />
            </div>

            <div className="p-6 md:p-8">
              {/* Timer display */}
              <div className="flex items-center justify-between mb-6">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500">
                  <Clock className={`w-4 h-4 ${timeLeft <= 5 ? 'text-red-500' : 'text-teal-600'}`} />
                  {timeLeft}s
                </span>
              </div>

              {/* Question */}
              <h2
                className="text-xl md:text-2xl font-bold text-gray-800 leading-snug mb-6 animate-fade-in"
                key={currentIdx}
              >
                {question.pregunta}
              </h2>

              {/* Options */}
              <div className="space-y-3">
                {question.opciones.map((opcion, idx) => {
                  const isCorrect = idx === question.correcta;
                  const isSelected = idx === selectedAnswer;
                  let style = 'border-gray-200 hover:border-teal-400 hover:bg-teal-50';
                  let badgeStyle = 'bg-gray-100 text-gray-600';

                  if (showFeedback) {
                    if (isCorrect) {
                      style = 'border-green-500 bg-green-50';
                      badgeStyle = 'bg-green-500 text-white';
                    } else if (isSelected) {
                      style = 'border-red-500 bg-red-50';
                      badgeStyle = 'bg-red-500 text-white';
                    } else {
                      style = 'border-gray-200 opacity-50';
                    }
                  }

                  return (
                    <button
                      key={idx}
                      onClick={() => recordAnswer(idx)}
                      disabled={showFeedback}
                      className={`w-full text-left px-4 py-4 rounded-2xl border-2 transition-all duration-200 flex items-center gap-3 ${style} ${!showFeedback ? 'active:scale-[0.99] cursor-pointer' : 'cursor-default'} ${isSelected && !isCorrect ? 'animate-shake' : ''}`}
                    >
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0 ${badgeStyle}`}>
                        {showFeedback && isCorrect ? (
                          <Check className="w-4 h-4" />
                        ) : showFeedback && isSelected ? (
                          <X className="w-4 h-4" />
                        ) : (
                          LETTERS[idx]
                        )}
                      </span>
                      <span className="text-gray-800 font-medium text-sm md:text-base">
                        {opcion}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Feedback */}
              {showFeedback && (
                <div className="mt-6 animate-slide-up">
                  <div
                    className={`rounded-2xl p-4 ${
                      selectedAnswer === question.correcta
                        ? 'bg-green-50 border border-green-200'
                        : 'bg-red-50 border border-red-200'
                    }`}
                  >
                    <p
                      className={`font-bold mb-1 ${
                        selectedAnswer === question.correcta
                          ? 'text-green-700'
                          : 'text-red-700'
                      }`}
                    >
                      {selectedAnswer === question.correcta
                        ? '¡Correcto!'
                        : selectedAnswer === null
                        ? '¡Se acabó el tiempo!'
                        : 'Incorrecto'}
                    </p>
                    <p className="text-sm text-gray-700 leading-relaxed">
                      {question.explicacion}
                    </p>
                  </div>
                  <button
                    onClick={handleNext}
                    className="w-full mt-4 bg-teal-600 hover:bg-teal-700 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg hover:shadow-xl active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    {currentIdx < totalQuestions - 1 ? 'Siguiente' : 'Ver resultados'}
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}