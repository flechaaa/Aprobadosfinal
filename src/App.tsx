import { useState, useEffect, useCallback } from 'react';
import { StartScreen } from '@/components/StartScreen';
import { GameScreen } from '@/components/GameScreen';
import { ResultsScreen } from '@/components/ResultsScreen';
import { AdminPanel } from '@/components/AdminPanel';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { supabase } from '@/lib/supabase';
import { loadTaxonomy } from '@/utils/taxonomy';
import { selectRandomQuestions, decodeChallenge, loadQuestionsForGame, loadRandomQuestionsForGame } from '@/utils/game';
import type { AnswerRecord, Chair, ChallengeData, Question, Subject, University } from '@/types';
import type { TaxonomySelection } from '@/components/TaxonomyPicker';

type Screen = 'start' | 'game' | 'results' | 'admin';

function App() {
  const [screen, setScreen] = useState<Screen>('start');
  const [playerName, setPlayerName] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionIndices, setQuestionIndices] = useState<number[]>([]);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [challengeData, setChallengeData] = useState<ChallengeData | null>(null);
  const [currentSelection, setCurrentSelection] = useState<TaxonomySelection | null>(null);

  const [universities, setUniversities] = useState<University[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [chairs, setChairs] = useState<Chair[]>([]);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [taxonomyError, setTaxonomyError] = useState('');
  const [questionsLoadError, setQuestionsLoadError] = useState('');

  const fetchQuestionCount = useCallback(async () => {
    const { count, error } = await supabase
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('active', true);

    if (error) {
      console.error('No se pudo leer el total de preguntas:', error);
      setTotalQuestions(0);
      return;
    }

    setTotalQuestions(count ?? 0);
  }, []);

  const fetchTaxonomy = useCallback(() => {
    return loadTaxonomy()
      .then((taxonomy) => {
        setUniversities(taxonomy.universities);
        setSubjects(taxonomy.subjects);
        setChairs(taxonomy.chairs);
      })
      .catch(() =>
        setTaxonomyError('La clasificación todavía no está disponible. Podés proponer nombres nuevos.')
      );
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get('c');
    if (c) {
      const decoded = decodeChallenge(c);
      if (decoded) setChallengeData(decoded);
    }
    void fetchTaxonomy();
    void fetchQuestionCount();
  }, [fetchTaxonomy, fetchQuestionCount]);

  const handleStart = async (name: string, selection: TaxonomySelection) => {
    setPlayerName(name);
    setCurrentSelection(selection);
    setQuestionsLoadError('');

    if (challengeData) {
      setQuestionIndices(challengeData.q);
      setQuestions([]);
      setScreen('game');
      return;
    }

    // Cargar preguntas de Supabase según la materia y cátedra seleccionada.
    const loadedQuestions = await loadQuestionsForGame(selection);

    if (loadedQuestions.length === 0) {
      setQuestions([]);
      setQuestionIndices([]);
      setQuestionsLoadError('Próximamente preguntas para esta cátedra');
      setScreen('start');
      return;
    }

    setQuestions(loadedQuestions);
    setQuestionIndices(loadedQuestions.map((_, i) => i));
    setScreen('game');
  };

  const handleQuickGame = async (name: string) => {
    setPlayerName(name);
    setCurrentSelection(null);
    setQuestionsLoadError('');

    const loadedQuestions = await loadRandomQuestionsForGame();
    if (loadedQuestions.length === 0) {
      setQuestions([]);
      setQuestionIndices([]);
      setQuestionsLoadError('No hay preguntas disponibles en la base de datos.');
      setScreen('start');
      return;
    }

    setQuestions(loadedQuestions);
    setQuestionIndices(loadedQuestions.map((_, i) => i));
    setScreen('game');
  };

  const handleFinish = (gameAnswers: AnswerRecord[]) => {
    setAnswers(gameAnswers);
    setScreen('results');
  };

  const handlePlayAgain = async () => {
    setAnswers([]);
    setChallengeData(null);
    if (currentSelection) {
      const loadedQuestions = await loadQuestionsForGame(currentSelection);
      setQuestions(loadedQuestions);
      setQuestionIndices(loadedQuestions.map((_, i) => i));
    } else {
      setQuestionIndices(selectRandomQuestions(5));
      setQuestions([]);
    }
    setScreen('game');
  };

  const handleBackToHome = () => {
    setAnswers([]);
    setQuestionIndices([]);
    setQuestions([]);
    setQuestionsLoadError('');
    setChallengeData(null);
    setPlayerName('');
    window.history.replaceState({}, '', window.location.pathname);
    void fetchTaxonomy();
    setScreen('start');
  };

  return (
    <ErrorBoundary>
      {screen === 'start' && (
        <StartScreen
          onStart={handleStart}
          onQuickGame={handleQuickGame}
          challengeData={challengeData}
          universities={universities}
          subjects={subjects}
          chairs={chairs}
          taxonomyError={taxonomyError}
          totalQuestions={totalQuestions}
          onOpenAdmin={() => setScreen('admin')}
          questionsLoadError={questionsLoadError}
        />
      )}
      {screen === 'game' && (
        <GameScreen
          questions={questions.length > 0 ? questions : undefined}
          questionIndices={questionIndices}
          onFinish={handleFinish}
        />
      )}
      {screen === 'results' && (
        <ResultsScreen
          answers={answers}
          questionIndices={questionIndices}
          playerName={playerName}
          challengeData={challengeData}
          selection={currentSelection}
          universities={universities}
          subjects={subjects}
          chairs={chairs}
          onRestart={handlePlayAgain}
          onHome={handleBackToHome}
          onTaxonomyRefresh={fetchTaxonomy}
        />
      )}
      {screen === 'admin' && (
        <AdminPanel
          onBack={() => {
            void fetchTaxonomy();
            void fetchQuestionCount();
            setScreen('start');
          }}
        />
      )}
    </ErrorBoundary>
  );
}

export default App;