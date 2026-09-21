import { useState } from 'react';
import { GraduationCap, Clock, Users, Trophy, Play, Swords, Upload, Zap } from 'lucide-react';
import { CollaborateModal } from '@/components/CollaborateModal';
import { RankingModal } from '@/components/RankingModal';
import { PlaySelectionModal } from '@/components/PlaySelectionModal';
import type { TaxonomySelection } from '@/components/TaxonomyPicker';
import type { Chair, ChallengeData, Subject, University } from '@/types';

interface StartScreenProps {
  onStart: (name: string, selection: TaxonomySelection) => void;
  onQuickGame: (name: string) => void;
  challengeData: ChallengeData | null;
  universities: University[];
  subjects: Subject[];
  chairs: Chair[];
  taxonomyError: string;
  totalQuestions: number;
  onOpenAdmin: () => void;
  questionsLoadError?: string;
}

export function StartScreen({ onStart, onQuickGame, challengeData, universities, subjects, chairs, taxonomyError, totalQuestions, onOpenAdmin, questionsLoadError }: StartScreenProps) {
  const [name, setName] = useState('');
  const [playOpen, setPlayOpen] = useState(false);
  const [collaborateOpen, setCollaborateOpen] = useState(false);
  const [rankingOpen, setRankingOpen] = useState(false);

  const handleOpenPlay = () => {
    setPlayOpen(true);
  };

  const handleStartWithSelection = (playerName: string, selection: TaxonomySelection) => {
    setPlayOpen(false);
    onStart(playerName, selection);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-600 via-emerald-600 to-teal-700 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-0 -left-20 w-72 h-72 bg-teal-400/20 rounded-full blur-3xl" />
      <div className="absolute bottom-0 -right-20 w-96 h-96 bg-emerald-400/20 rounded-full blur-3xl" />

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-white/10 backdrop-blur-sm rounded-3xl mb-4 border border-white/20 animate-float shadow-xl">
            <GraduationCap className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-extrabold text-white tracking-tight">Aprobados</h1>
          <p className="mt-3 text-base font-medium text-teal-50/90 tracking-wide">
            Desafía a tus amigos a ver quién sabe más.
          </p>
        </div>

        {challengeData && (
          <div className="bg-amber-400/20 backdrop-blur-sm border border-amber-300/40 rounded-2xl p-4 mb-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-amber-400 rounded-xl flex items-center justify-center flex-shrink-0">
                <Swords className="w-5 h-5 text-amber-900" />
              </div>
              <div>
                <p className="text-white font-semibold">{challengeData.n} te desafía</p>
                <p className="text-amber-100 text-sm">
                  Puntaje a superar: <span className="font-bold text-white">{challengeData.s}</span> puntos
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-3xl shadow-2xl p-6 animate-slide-up">
          <div className="mb-5">
            <button
              type="button"
              onClick={handleOpenPlay}
              className="w-full rounded-2xl bg-gradient-to-r from-teal-600 via-emerald-600 to-teal-700 px-4 py-4 text-base font-black uppercase tracking-wide text-white shadow-lg hover:scale-[1.01] hover:shadow-xl transition-all"
            >
              <span className="inline-flex items-center justify-center gap-2">
                <Play className="h-5 w-5" fill="currentColor" />
                Jugar
              </span>
            </button>
            {taxonomyError && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">{taxonomyError}</p>}
            {questionsLoadError && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700 border border-rose-200">{questionsLoadError}</p>}
          </div>

          <div className="space-y-3 border-t border-gray-100 pt-5">
            <button
              type="button"
              onClick={() => onQuickGame(name.trim() || 'Anónimo')}
              className="w-full rounded-xl border-2 border-fuchsia-200 bg-gradient-to-r from-fuchsia-50 to-rose-50 py-3 text-sm font-bold text-fuchsia-700 transition hover:bg-fuchsia-100 active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <Zap className="h-4 w-4" />
              Partida rápida
            </button>

            <button
              type="button"
              onClick={() => setRankingOpen(true)}
              className="w-full rounded-xl border-2 border-teal-200 bg-teal-50 py-3 text-sm font-bold text-teal-700 transition hover:bg-teal-100 active:scale-[0.98]"
            >
              Ver ranking
            </button>

            <button
              type="button"
              onClick={() => setCollaborateOpen(true)}
              className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-teal-200 bg-teal-50 py-3 text-sm font-bold text-teal-700 transition hover:bg-teal-100 active:scale-[0.98]"
            >
              <Upload className="h-4 w-4" />
              Enviar material
            </button>
          </div>

          <button type="button" onClick={onOpenAdmin} className="mt-4 w-full text-xs font-bold text-gray-400 transition hover:text-teal-700">
            Panel de administración
          </button>

          <div className="flex items-center justify-center gap-3 mt-6 text-sm text-gray-500">
            <div className="flex items-center gap-1.5">
              <Trophy className="w-4 h-4 text-teal-600" />
              <span>5 preguntas</span>
            </div>
            <div className="w-1 h-1 bg-gray-300 rounded-full" />
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-teal-600" />
              <span>120s c/u</span>
            </div>
            <div className="w-1 h-1 bg-gray-300 rounded-full" />
            <div className="flex items-center gap-1.5">
              <Users className="w-4 h-4 text-teal-600" />
              <span>Desafía</span>
            </div>
          </div>
        </div>

        <p className="text-center text-teal-200/70 text-xs mt-6">
          {totalQuestions} preguntas disponibles
        </p>
      </div>

      <PlaySelectionModal
        open={playOpen}
        initialName={name}
        universities={universities}
        subjects={subjects}
        chairs={chairs}
        onClose={() => setPlayOpen(false)}
        onStart={handleStartWithSelection}
      />

      <RankingModal open={rankingOpen} chairId={null} chairs={chairs} universities={universities} subjects={subjects} onClose={() => setRankingOpen(false)} />
      <CollaborateModal
        open={collaborateOpen}
        onClose={() => setCollaborateOpen(false)}
      />
    </div>
  );
}
