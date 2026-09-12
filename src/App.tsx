import { useState, useEffect } from 'react';
import { StartScreen } from '@/components/StartScreen';
import { GameScreen } from '@/components/GameScreen';
import { ResultsScreen } from '@/components/ResultsScreen';
import { AdminPanel } from '@/components/AdminPanel';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { loadTaxonomy } from '@/utils/taxonomy';
import { selectRandomQuestions, decodeChallenge } from '@/utils/game';
import type { AnswerRecord, Chair, ChallengeData, Subject, University } from '@/types';
import type { TaxonomySelection } from '@/components/TaxonomyPicker';

type Screen = 'start' | 'game' | 'results' | 'admin';

function App() {
  const [screen, setScreen] = useState<Screen>('start');
  const [playerName, setPlayerName] = useState('');
  const [questionIndices, setQuestionIndices] = useState<number[]>([]);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [challengeData, setChallengeData] = useState<ChallengeData | null>(null);
  const [universities, setUniversities] = useState<University[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [chairs, setChairs] = useState<Chair[]>([]);
  const [taxonomyError, setTaxonomyError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get('c');
    if (c) {
      const decoded = decodeChallenge(c);
      if (decoded) setChallengeData(decoded);
    }
    void loadTaxonomy()
      .then((taxonomy) => {
        setUniversities(taxonomy.universities);
        setSubjects(taxonomy.subjects);
        setChairs(taxonomy.chairs);
      })
      .catch(() =>
        setTaxonomyError(
          'La clasificación todavía no está disponible. Podés proponer nombres nuevos.'
        )
      );
  }, []);

  const handleStart = (name: string, selection: TaxonomySelection) => {
    void selection;
    setPlayerName(name);
    if (challengeData) {
      setQuestionIndices(challengeData.q);
    } else {
      setQuestionIndices(selectRandomQuestions(5));
    }
    setScreen('game');
  };

  const handleFinish = (gameAnswers: AnswerRecord[]) => {
    setAnswers(gameAnswers);
    setScreen('results');
  };

  // 1. JUGAR DE NUEVO AUTOMÁTICO (partida nueva directa sin pasar por el inicio)
  const handlePlayAgain = () => {
    setAnswers([]);
    setQuestionIndices(selectRandomQuestions(5));
    setChallengeData(null);
    setScreen('game');
  };

  // 2. VOLVER AL MENÚ PRINCIPAL (limpia todo y vuelve a la pantalla inicial)
  const handleBackToHome = () => {
    setAnswers([]);
    setQuestionIndices([]);
    setChallengeData(null);
    setPlayerName('');
    window.history.replaceState({}, '', window.location.pathname);
    setScreen('start');
  };

  return (
    <ErrorBoundary>
      {screen === 'start' && (
        <StartScreen
          onStart={handleStart}
          challengeData={challengeData}
          universities={universities}
          subjects={subjects}
          chairs={chairs}
          taxonomyError={taxonomyError}
          onOpenAdmin={() => setScreen('admin')}
        />
      )}
      {screen === 'game' && (
        <GameScreen questionIndices={questionIndices} onFinish={handleFinish} />
      )}
      {screen === 'results' && (
        <ResultsScreen
          answers={answers}
          questionIndices={questionIndices}
          playerName={playerName}
          challengeData={challengeData}
          onRestart={handlePlayAgain}
          onHome={handleBackToHome}
        />
      )}
      {screen === 'admin' && <AdminPanel onBack={() => setScreen('start')} />}
    </ErrorBoundary>
  );
}

export default App;