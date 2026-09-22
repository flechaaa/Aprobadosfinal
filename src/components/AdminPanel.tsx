import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  LogIn,
  LogOut,
  Pencil,
  ShieldCheck,
  Sparkles,
  X,
  AlertCircle,
  Trash2,
  CheckCheck,
  Flag,
  Save,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { loadSuggestions, moderateSuggestion } from '@/utils/taxonomy';
import {
  loadPendingSubmissions,
  insertQuestion,
  insertBatchQuestions,
  markSubmissionProcessed,
  ensureTaxonomyFromSubmission,
  type Submission,
} from '@/utils/moderation';
import { extractQuestionFromImage, extractQuestionsFromFile } from '@/utils/gemini';
import { fetchAndExtractText } from '@/utils/fileParser';
import { deleteSubmission } from '@/utils/submissions';
import { sendApprovedSubmissionPushNotification } from '@/utils/notifications';
import { cleanupSuggestionSourceIfUnused, loadPendingQuestionSuggestions, approveQuestionSuggestion, rejectQuestionSuggestion } from '@/utils/questionSuggestions';
import type { Question, TaxonomySuggestion } from '@/types';

interface AdminPanelProps {
  onBack: () => void;
}

interface EditableQuestion extends Question {
  approved: boolean;
}

interface QuestionReport {
  id: string;
  question_id: string;
  question_text: string | null;
  reason: string;
  details: string | null;
  created_at: string;
  raw_data?: Question;
  suggested_fix?: Question | null;
}

interface QuestionSuggestionRecord {
  id: string;
  university_id: string;
  subject_id: string;
  chair_id: string;
  question_text: string;
  options: string[];
  correct_option: number;
  explanation?: string | null;
  difficulty?: 'facil' | 'media' | 'dificil' | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  university_name?: string;
  subject_name?: string;
  chair_name?: string;
}

const levelLabels = { university: 'Universidad', subject: 'Materia', chair: 'Cátedra' } as const;

const materialTypeLabels: Record<string, string> = {
  apunte: 'Apunte / Resumen teórico',
  preguntero_choice: 'Preguntero / Choice',
  pregunta_respuesta: 'Preguntas con Respuesta',
};

type Tab = 'taxonomy' | 'materials' | 'reports' | 'questions';

export function AdminPanel({ onBack }: AdminPanelProps) {
  const [passwordInput, setPasswordInput] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState<Tab>('taxonomy');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // Taxonomy state
  const [suggestions, setSuggestions] = useState<TaxonomySuggestion[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Materials state
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<EditableQuestion[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [progressMsg, setProgressMsg] = useState('');
  const [approvingAll, setApprovingAll] = useState(false);
  const [autoProcessingIds, setAutoProcessingIds] = useState<string[]>([]);

  // Reports state
  const [reports, setReports] = useState<QuestionReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [editingReportId, setEditingReportId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<Question | null>(null);

  // Question suggestions state
  const [questionSuggestions, setQuestionSuggestions] = useState<QuestionSuggestionRecord[]>([]);
  const [loadingQuestionSuggestions, setLoadingQuestionSuggestions] = useState(false);

  const selected = submissions.find((s) => s.id === selectedId) ?? null;

  const fetchQuestionSuggestions = useCallback(async () => {
    setLoadingQuestionSuggestions(true);
    try {
      const rows = await loadPendingQuestionSuggestions();
      setQuestionSuggestions(rows);
    } catch {
      setMessage('No se pudieron cargar las propuestas de preguntas.');
    } finally {
      setLoadingQuestionSuggestions(false);
    }
  }, []);

  const fetchReports = useCallback(async () => {
    setLoadingReports(true);
    try {
      const { data, error } = await supabase
        .from('question_reports')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        setReports(data);
      }
    } catch {
      setMessage('No se pudieron cargar los reportes.');
    } finally {
      setLoadingReports(false);
    }
  }, []);

  const unlock = async () => {
    if (!passwordInput) return;
    setBusy(true);
    setMessage('');
    try {
      const pending = await loadSuggestions(passwordInput);
      setAdminPassword(passwordInput);
      setPasswordInput('');
      setSuggestions(pending);
      setUnlocked(true);
      void fetchReports();
      void fetchQuestionSuggestions();
    } catch {
      setMessage('Contraseña incorrecta o panel no disponible.');
    }
    setBusy(false);
  };

  const lock = () => {
    setAdminPassword('');
    setUnlocked(false);
    setSuggestions([]);
    setSubmissions([]);
    setReports([]);
    setQuestionSuggestions([]);
    setSelectedId(null);
    setQuestions([]);
    setEditingId(null);
    setEditingReportId(null);
  };

  const refreshSubmissions = useCallback(async () => {
    try {
      const pending = await loadPendingSubmissions();
      setSubmissions(pending);
      if (pending.length > 0 && !selectedId) {
        selectSubmission(pending[0]);
      }
      if (pending.length === 0) {
        setSelectedId(null);
        setQuestions([]);
      }
    } catch {
      setMessage('No se pudieron cargar los envíos.');
    }
  }, [selectedId]);

  useEffect(() => {
    if (unlocked) {
      if (tab === 'materials') void refreshSubmissions();
      if (tab === 'reports') void fetchReports();
      if (tab === 'questions') void fetchQuestionSuggestions();
    }
  }, [unlocked, tab, refreshSubmissions, fetchReports, fetchQuestionSuggestions]);

  const selectSubmission = (sub: Submission) => {
    setSelectedId(sub.id);
    setExtractError('');
    if (sub.extracted_questions && sub.extracted_questions.length > 0) {
      setQuestions(sub.extracted_questions.map((q) => ({ ...q, approved: false })));
    } else {
      setQuestions([]);
    }
  };

  const review = async (suggestion: TaxonomySuggestion, action: 'approve' | 'reject') => {
    setBusy(true);
    setMessage('');
    try {
      await moderateSuggestion(
        suggestion.id,
        action,
        adminPassword,
        action === 'approve' ? (editingName || suggestion.proposed_name) : undefined,
      );
      setSuggestions((current) => current.filter((item) => item.id !== suggestion.id));
      setEditingId(null);
    } catch {
      setMessage('No pudimos actualizar la propuesta.');
    }
    setBusy(false);
  };

  const handleApproveSuggestedFix = async (report: QuestionReport) => {
    if (!report.suggested_fix) return;
    setBusy(true);
    setMessage('');

    try {
      const fix = report.suggested_fix;

      const { error } = await supabase
        .from('questions')
        .update({
          question: fix.pregunta,
          options: fix.opciones,
          correct_option: fix.correcta,
          explanation: fix.explicacion,
        })
        .eq('id', report.question_id);

      if (error) {
        await supabase.from('questions').insert([
          {
            question: fix.pregunta,
            options: fix.opciones,
            correct_option: fix.correcta,
            explanation: fix.explicacion,
            active: true,
            is_active: true,
          },
        ]);
      }

      await supabase.from('question_reports').delete().eq('id', report.id);
      setReports((prev) => prev.filter((r) => r.id !== report.id));
      setMessage('¡Corrección del usuario aprobada y aplicada con éxito!');
    } catch (err: any) {
      setMessage(err.message || 'Error al aplicar la corrección.');
    } finally {
      setBusy(false);
    }
  };

  const handleDismissReport = async (reportId: string) => {
    setBusy(true);
    const { error } = await supabase.from('question_reports').delete().eq('id', reportId);
    if (!error) {
      setReports((prev) => prev.filter((r) => r.id !== reportId));
      if (editingReportId === reportId) setEditingReportId(null);
      setMessage('Reporte resuelto.');
    } else {
      setMessage('Error al descartar el reporte.');
    }
    setBusy(false);
  };

  const handleApproveQuestionSuggestion = async (suggestion: QuestionSuggestionRecord) => {
    setBusy(true);
    setMessage('');
    try {
      await approveQuestionSuggestion(suggestion, adminPassword);
      await cleanupSuggestionSourceIfUnused(suggestion, adminPassword);
      setQuestionSuggestions((current) => current.filter((item) => item.id !== suggestion.id));
      setMessage('Pregunta propuesta aprobada y publicada.');
    } catch (err: any) {
      setMessage(err?.message || 'No se pudo aprobar la propuesta.');
    } finally {
      setBusy(false);
    }
  };

  const handleRejectQuestionSuggestion = async (suggestion: QuestionSuggestionRecord) => {
    setBusy(true);
    setMessage('');
    try {
      await rejectQuestionSuggestion(suggestion.id);
      await cleanupSuggestionSourceIfUnused(suggestion, adminPassword);
      setQuestionSuggestions((current) => current.filter((item) => item.id !== suggestion.id));
      setMessage('Propuesta de pregunta rechazada.');
    } catch (err: any) {
      setMessage(err?.message || 'No se pudo rechazar la propuesta.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteReportedQuestion = async (report: QuestionReport) => {
    const confirm = window.confirm('¿Seguro que querés dar de baja esta pregunta y eliminar el reporte?');
    if (!confirm) return;

    setBusy(true);
    try {
      await supabase.from('questions').delete().eq('id', report.question_id);
      await supabase.from('question_reports').delete().eq('id', report.id);
      setReports((prev) => prev.filter((r) => r.id !== report.id));
      if (editingReportId === report.id) setEditingReportId(null);
      setMessage('Pregunta eliminada.');
    } catch {
      setMessage('No se pudo eliminar la pregunta.');
    } finally {
      setBusy(false);
    }
  };

  const handleStartEditReport = (report: QuestionReport) => {
    if (editingReportId === report.id) {
      setEditingReportId(null);
      setEditingDraft(null);
      return;
    }
    setEditingReportId(report.id);

    const baseOpciones =
      report.raw_data?.opciones ||
      report.suggested_fix?.opciones ||
      ['', '', '', ''];

    setEditingDraft({
      pregunta:
        report.raw_data?.pregunta ||
        report.suggested_fix?.pregunta ||
        report.question_text ||
        '',
      opciones:
        Array.isArray(baseOpciones) && baseOpciones.length > 0
          ? baseOpciones
          : ['', '', '', ''],
      correcta: report.raw_data?.correcta ?? report.suggested_fix?.correcta ?? 0,
      explicacion:
        report.raw_data?.explicacion ||
        report.suggested_fix?.explicacion ||
        '',
    });
  };

  const handleSaveReportFix = async (report: QuestionReport) => {
    if (!editingDraft) return;
    setBusy(true);
    setMessage('');

    try {
      const { error: updateError } = await supabase
        .from('questions')
        .update({
          question: editingDraft.pregunta,
          options: editingDraft.opciones,
          correct_option: editingDraft.correcta,
          explanation: editingDraft.explicacion,
        })
        .eq('id', report.question_id);

      if (updateError) {
        await supabase.from('questions').insert([
          {
            question: editingDraft.pregunta,
            options: editingDraft.opciones,
            correct_option: editingDraft.correcta,
            explanation: editingDraft.explicacion,
            active: true,
            is_active: true,
          },
        ]);
      }

      await supabase.from('question_reports').delete().eq('id', report.id);
      setReports((prev) => prev.filter((r) => r.id !== report.id));
      setEditingReportId(null);
      setEditingDraft(null);
      setMessage('¡Pregunta corregida y guardada exitosamente!');
    } catch (err: any) {
      setMessage(err.message || 'Error al guardar la corrección.');
    } finally {
      setBusy(false);
    }
  };

  const handleExtract = async () => {
    if (!selected || !selected.file_url) return;
    setExtracting(true);
    setExtractError('');
    setProgressMsg('Leyendo archivo y extrayendo texto...');
    setQuestions([]);
    try {
      const rawText = await fetchAndExtractText(selected.file_url, selected.file_type);

      if (!rawText || rawText.trim().length < 20) {
        throw new Error('El archivo no contiene texto legible (puede ser un escaneo o imágenes sin OCR).');
      }

      setProgressMsg('Analizando preguntas con IA...');

      const result = await extractQuestionsFromFile(rawText, (current, total) => {
        setProgressMsg(`Procesando fragmento ${current} de ${total}...`);
      }, selected.material_type);

      if (result.questions.length === 0) {
        setExtractError(result.error || 'No se pudieron extraer preguntas.');
      } else {
        if (result.error) {
          setExtractError(result.error);
        }
        const mapped = result.questions.map((q) => ({ ...q, approved: false }));
        setQuestions(mapped);

        await supabase
          .from('submissions')
          .update({ extracted_questions: result.questions })
          .eq('id', selected.id);

        setSubmissions((prev) =>
          prev.map((s) => (s.id === selected.id ? { ...s, extracted_questions: result.questions } : s))
        );
      }
    } catch (err: any) {
      setExtractError(err.message || 'No se pudo procesar el material.');
    } finally {
      setExtracting(false);
      setProgressMsg('');
    }
  };

  const handleProcessImage = async () => {
    if (!selected || !selected.file_url || !selected.file_type.startsWith('image/')) return;

    setProcessingImage(true);
    setExtractError('');
    setProgressMsg('Analizando la diapositiva con IA...');
    try {
      const question = await extractQuestionFromImage(selected.file_url, selected.file_type);
      const nextQuestion = { ...question, approved: false };
      setQuestions([nextQuestion]);
      setMessage('Pregunta autocompletada. Revisala antes de aprobarla.');
    } catch (error) {
      setExtractError(error instanceof Error ? error.message : 'No se pudo procesar la imagen con IA.');
    } finally {
      setProcessingImage(false);
      setProgressMsg('');
    }
  };

  const handleRejectSubmission = async () => {
    if (!selected) return;
    const confirmDelete = window.confirm(
      `¿Querés descartar y eliminar definitivamente este envío de "${selected.subject}"? Se borrará tanto de la base de datos como del almacenamiento.`
    );
    if (!confirmDelete) return;

    setBusy(true);
    setMessage('');
    try {
      await deleteSubmission(selected.id, selected.file_url, selected.storage_path, adminPassword);
      const remaining = submissions.filter((s) => s.id !== selected.id);
      setSubmissions(remaining);
      if (remaining.length > 0) {
        selectSubmission(remaining[0]);
      } else {
        setSelectedId(null);
        setQuestions([]);
      }
      setMessage('Material descartado y eliminado con éxito.');
    } catch (err: any) {
      setMessage(err.message || 'No se pudo eliminar el material.');
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async (submission: Submission) => {
    const confirmed = window.confirm(`¿Querés desestimar y eliminar el envío de "${submission.subject}"?`);
    if (!confirmed) return;

    const previousSubmissions = submissions;
    const remaining = submissions.filter((item) => item.id !== submission.id);
    setSubmissions(remaining);
    if (selectedId === submission.id) {
      const next = remaining[0];
      if (next) selectSubmission(next);
      else {
        setSelectedId(null);
        setQuestions([]);
      }
    }

    setBusy(true);
    setMessage('');
    try {
      if (submission.file_url || submission.storage_path) await deleteSubmission(submission.id, submission.file_url, submission.storage_path, adminPassword);
      const remaining = submissions.filter((item) => item.id !== submission.id);
      setSubmissions(remaining);
      if (selectedId === submission.id) {
        if (remaining.length > 0) {
          selectSubmission(remaining[0]);
        } else {
          setSelectedId(null);
          setQuestions([]);
        }
      }
      setMessage('Material desestimado y eliminado correctamente.');
    } catch (error) {
      setSubmissions(previousSubmissions);
      if (selectedId === submission.id) selectSubmission(submission);
      setMessage(error instanceof Error ? error.message : 'No se pudo desestimar el material.');
    } finally {
      setBusy(false);
    }
  };

  const updateQuestion = (index: number, field: keyof Question, value: string | number) => {
    setQuestions((current) =>
      current.map((q, i) => (i === index ? { ...q, [field]: value } : q)),
    );
  };

  const updateOption = (qIndex: number, optIndex: number, value: string) => {
    setQuestions((current) =>
      current.map((q, i) => {
        if (i !== qIndex) return q;
        const opciones = [...q.opciones];
        opciones[optIndex] = value;
        return { ...q, opciones };
      }),
    );
  };

  const handleApprove = async (index: number) => {
    if (!selected || !adminPassword) return;
    const q = questions[index];
    setBusy(true);
    setMessage('');
    try {
      const taxonomy = await ensureTaxonomyFromSubmission(selected, adminPassword);
      await insertQuestion(
        q.pregunta,
        q.opciones,
        q.correcta,
        q.explicacion,
        selected.id,
        adminPassword,
        taxonomy.chairId,
        taxonomy.subjectId, // <-- CORREGIDO: Pasamos subjectId aquí
        {
          university: selected.university,
          subject: selected.subject,
          chair: selected.chair,
        }
      );
      setQuestions((current) =>
        current.map((item, i) => (i === index ? { ...item, approved: true } : item)),
      );
      setMessage('Pregunta incorporada al juego y taxonomía sincronizada.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo guardar la pregunta.';
      setMessage(msg);
    }
    setBusy(false);
  };

  const handleApproveAll = async () => {
    if (!selected || !adminPassword || questions.length === 0) return;
    setApprovingAll(true);
    setMessage('');

    try {
      const taxonomy = await ensureTaxonomyFromSubmission(selected, adminPassword);
      const pendingQuestions = questions.filter((q) => !q.approved);

      // Inserción atómica en bloque de todas las preguntas juntas con subjectId
      await insertBatchQuestions(
        pendingQuestions,
        selected.id,
        taxonomy.chairId,
        taxonomy.subjectId, // <-- CORREGIDO: Pasamos subjectId aquí
        {
          university: selected.university,
          subject: selected.subject,
          chair: selected.chair,
        }
      );

      await sendApprovedSubmissionPushNotification({
        subject: selected.subject,
        chair: selected.chair,
        sessionId: null,
      });

      await markSubmissionProcessed(selected.id, adminPassword);

      const remaining = submissions.filter((s) => s.id !== selected.id);
      setSubmissions(remaining);
      if (remaining.length > 0) {
        selectSubmission(remaining[0]);
      } else {
        setSelectedId(null);
        setQuestions([]);
      }
      setMessage(`¡Lote aprobado con éxito! Se sumaron ${pendingQuestions.length} preguntas listas para jugar.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al aprobar el lote.';
      setMessage(msg);
    } finally {
      setApprovingAll(false);
    }
  };

  const handleComplete = async () => {
    if (!selected || !adminPassword) return;
    setBusy(true);
    setMessage('');
    try {
      await markSubmissionProcessed(selected.id, adminPassword);
      const remaining = submissions.filter((s) => s.id !== selected.id);
      setSubmissions(remaining);
      if (remaining.length > 0) {
        selectSubmission(remaining[0]);
      } else {
        setSelectedId(null);
        setQuestions([]);
      }
      setMessage('Envío marcado como completado.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo actualizar el envío.';
      setMessage(msg);
    }
    setBusy(false);
  };

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-teal-50 px-4 py-8">
        <div className="mx-auto max-w-md">
          <button onClick={onBack} className="mb-6 flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-teal-700">
            <ArrowLeft className="h-4 w-4" /> Volver
          </button>
          <div className="rounded-3xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-2xl bg-teal-100 p-3">
                <ShieldCheck className="h-6 w-6 text-teal-700" />
              </div>
              <div>
                <h1 className="text-xl font-extrabold text-gray-900">Panel de administración</h1>
                <p className="text-sm text-gray-500">Moderación de propuestas, materiales y reportes</p>
              </div>
            </div>
            <p className="mb-5 text-sm leading-relaxed text-gray-600">Ingresá la contraseña de administrador para acceder.</p>
            <input
              type="password"
              value={passwordInput}
              onChange={(event) => setPasswordInput(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void unlock()}
              placeholder="Contraseña de administrador"
              autoComplete="current-password"
              className="mb-3 w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm outline-none focus:border-teal-500"
            />
            <button
              onClick={() => void unlock()}
              disabled={busy || !passwordInput}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-3.5 font-bold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <LogIn className="h-4 w-4" /> Ingresar al panel
            </button>
            {message && <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700">{message}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-teal-700">
            <ArrowLeft className="h-4 w-4" /> Volver
          </button>
          <div className="h-5 w-px bg-gray-200" />
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-teal-600" />
            <span className="text-sm font-bold text-gray-800">Panel de administración</span>
          </div>
        </div>
        <button onClick={lock} className="flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-red-600">
          <LogOut className="h-4 w-4" /> Bloquear
        </button>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-4 flex gap-1">
        <button
          onClick={() => setTab('taxonomy')}
          className={`px-4 py-3 text-sm font-bold transition border-b-2 ${
            tab === 'taxonomy'
              ? 'border-teal-500 text-teal-700'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          Propuestas
        </button>
        <button
          onClick={() => setTab('materials')}
          className={`px-4 py-3 text-sm font-bold transition border-b-2 ${
            tab === 'materials'
              ? 'border-teal-500 text-teal-700'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          Materiales Colaborativos
        </button>
        <button
          onClick={() => setTab('questions')}
          className={`px-4 py-3 text-sm font-bold transition border-b-2 flex items-center gap-2 ${
            tab === 'questions'
              ? 'border-emerald-500 text-emerald-700'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          <Sparkles className="h-4 w-4" />
          Preguntas
          {questionSuggestions.length > 0 && (
            <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-xs font-bold">
              {questionSuggestions.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('reports')}
          className={`px-4 py-3 text-sm font-bold transition border-b-2 flex items-center gap-2 ${
            tab === 'reports'
              ? 'border-red-500 text-red-700'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          <Flag className="h-4 w-4" />
          Reportes
          {reports.length > 0 && (
            <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-bold">
              {reports.length}
            </span>
          )}
        </button>
      </div>

      {message && (
        <div className="bg-teal-50 border-b border-teal-200 px-4 py-2 text-xs font-semibold text-teal-700 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          {message}
          <button onClick={() => setMessage('')} className="ml-auto text-teal-400 hover:text-teal-600">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Taxonomy tab */}
      {tab === 'taxonomy' && (
        <div className="flex-1 px-4 py-8 overflow-y-auto">
          <div className="mx-auto max-w-2xl">
            <div className="mb-6">
              <p className="text-sm font-bold uppercase tracking-widest text-teal-600">Aprobados</p>
              <h1 className="mt-1 text-2xl font-extrabold text-gray-900">Propuestas pendientes</h1>
              <p className="mt-2 text-gray-500">Corregí nombres antes de publicarlos en los selectores.</p>
            </div>
            <div className="space-y-3">
              {suggestions.length === 0 && (
                <div className="rounded-3xl bg-white p-8 text-center shadow-lg">
                  <Check className="mx-auto mb-3 h-8 w-8 text-teal-600" />
                  <p className="font-bold text-gray-800">Todo al día</p>
                  <p className="mt-1 text-sm text-gray-500">No hay propuestas pendientes.</p>
                </div>
              )}
              {suggestions.map((suggestion) => (
                <div key={suggestion.id} className="rounded-2xl bg-white p-4 shadow-lg">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wide text-teal-600">{levelLabels[suggestion.level]}</span>
                      <p className="mt-1 font-bold text-gray-900">{suggestion.proposed_name}</p>
                    </div>
                    <button
                      onClick={() => { setEditingId(suggestion.id); setEditingName(suggestion.proposed_name); }}
                      className="rounded-lg p-2 text-gray-400 hover:bg-teal-50 hover:text-teal-700"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                  {editingId === suggestion.id && (
                    <input
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      className="mb-3 w-full rounded-xl border-2 border-teal-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                    />
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => void review(suggestion, 'approve')}
                      disabled={busy}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-teal-600 py-2.5 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" /> Aprobar
                    </button>
                    <button
                      onClick={() => void review(suggestion, 'reject')}
                      disabled={busy}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-50 py-2.5 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      <X className="h-4 w-4" /> Rechazar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Question suggestions tab */}
      {tab === 'questions' && (
        <div className="flex-1 px-4 py-8 overflow-y-auto">
          <div className="mx-auto max-w-4xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold uppercase tracking-widest text-emerald-600">Propuestas</p>
                <h1 className="mt-1 text-2xl font-extrabold text-gray-900">Preguntas propuestas</h1>
              </div>
              <button
                onClick={() => void fetchQuestionSuggestions()}
                disabled={loadingQuestionSuggestions}
                className="rounded-xl border border-emerald-200 px-4 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              >
                {loadingQuestionSuggestions ? 'Cargando...' : 'Recargar'}
              </button>
            </div>

            {questionSuggestions.length === 0 ? (
              <div className="rounded-3xl bg-white p-8 text-center shadow-lg">
                <Sparkles className="mx-auto mb-3 h-8 w-8 text-emerald-600" />
                <p className="font-bold text-gray-800">Sin propuestas pendientes</p>
                <p className="mt-1 text-sm text-gray-500">No hay preguntas esperando revisión.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {questionSuggestions.map((suggestion) => (
                  <div key={suggestion.id} className="rounded-2xl bg-white p-5 shadow-lg">
                    <div className="flex justify-between items-start gap-4">
                      <div className="space-y-2 w-full">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700">{suggestion.university_name}</span>
                          <span className="rounded-full bg-cyan-50 px-2 py-1 text-[11px] font-black text-cyan-700">{suggestion.subject_name}</span>
                          <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-700">{suggestion.chair_name}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700 border border-amber-200">Se creará la taxonomía si falta</span>
                        </div>

                        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-3">
                          <label className="block text-[11px] font-black uppercase text-gray-500 mb-1">Pregunta</label>
                          <textarea
                            value={suggestion.question_text}
                            onChange={(event) => {
                              const next = [...questionSuggestions];
                              const idx = next.findIndex((item) => item.id === suggestion.id);
                              if (idx >= 0) next[idx] = { ...next[idx], question_text: event.target.value };
                              setQuestionSuggestions(next);
                            }}
                            rows={3}
                            className="w-full rounded-xl border-2 border-emerald-200 px-3 py-2 text-xs text-gray-800 outline-none focus:border-emerald-500"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {suggestion.options.map((opt, idx) => (
                            <div key={idx} className={`rounded-xl border px-3 py-2 ${idx === suggestion.correct_option ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 bg-gray-50'}`}>
                              <div className="flex items-center gap-2">
                                <input
                                  type="radio"
                                  name={`correct-option-${suggestion.id}`}
                                  checked={idx === suggestion.correct_option}
                                  onChange={() => {
                                    const next = [...questionSuggestions];
                                    const rowIndex = next.findIndex((item) => item.id === suggestion.id);
                                    if (rowIndex >= 0) next[rowIndex] = { ...next[rowIndex], correct_option: idx };
                                    setQuestionSuggestions(next);
                                  }}
                                  className="h-4 w-4 accent-emerald-600"
                                />
                                <span className="text-[11px] font-black text-gray-500">{String.fromCharCode(65 + idx)}</span>
                                <input
                                  value={opt}
                                  onChange={(event) => {
                                    const next = [...questionSuggestions];
                                    const rowIndex = next.findIndex((item) => item.id === suggestion.id);
                                    if (rowIndex >= 0) {
                                      const changed = [...next[rowIndex].options];
                                      changed[idx] = event.target.value;
                                      next[rowIndex] = { ...next[rowIndex], options: changed };
                                    }
                                    setQuestionSuggestions(next);
                                  }}
                                  className="w-full rounded-lg border border-gray-200 px-2 py-1 text-xs font-bold text-gray-800 outline-none focus:border-emerald-500"
                                />
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                          <div>
                            <label className="block text-[11px] font-black uppercase text-gray-500 mb-1">Explicación</label>
                            <textarea
                              value={suggestion.explanation ?? ''}
                              onChange={(event) => {
                                const next = [...questionSuggestions];
                                const idx = next.findIndex((item) => item.id === suggestion.id);
                                if (idx >= 0) next[idx] = { ...next[idx], explanation: event.target.value };
                                setQuestionSuggestions(next);
                              }}
                              rows={2}
                              className="w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-xs text-gray-800 outline-none focus:border-emerald-500"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-black uppercase text-gray-500 mb-1">Dificultad</label>
                            <select
                              value={suggestion.difficulty ?? 'media'}
                              onChange={(event) => {
                                const next = [...questionSuggestions];
                                const idx = next.findIndex((item) => item.id === suggestion.id);
                                if (idx >= 0) next[idx] = { ...next[idx], difficulty: event.target.value as 'facil' | 'media' | 'dificil' };
                                setQuestionSuggestions(next);
                              }}
                              className="w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-xs text-gray-800 outline-none focus:border-emerald-500"
                            >
                              <option value="facil">Fácil</option>
                              <option value="media">Media</option>
                              <option value="dificil">Difícil</option>
                            </select>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleApproveQuestionSuggestion(suggestion)}
                          disabled={busy}
                          className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRejectQuestionSuggestion(suggestion)}
                          disabled={busy}
                          className="rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100 disabled:opacity-50"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Materials tab */}
      {tab === 'materials' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {autoProcessingIds.length > 0 && (
            <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700">
              <Loader2 className="h-4 w-4 animate-spin" />
              Procesando nuevos aportes con IA...
            </div>
          )}
          {submissions.length > 0 && (
            <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-2 overflow-x-auto scrollbar-hide">
              <span className="text-xs font-bold uppercase tracking-wide text-gray-400 flex-shrink-0">Pendientes:</span>
              {submissions.map((s) => (
                <div key={s.id} className="flex flex-shrink-0 items-center gap-1 rounded-lg bg-gray-100 pl-3 text-xs font-semibold text-gray-600">
                  <button
                    type="button"
                    onClick={() => selectSubmission(s)}
                    className={`rounded-lg py-1.5 pr-1 text-left transition ${s.id === selectedId ? 'text-teal-700' : 'hover:text-teal-700'}`}
                  >
                    {s.subject} — {s.chair}
                    {autoProcessingIds.includes(s.id) && (
                      <span className="ml-1.5 text-[10px] font-bold text-emerald-600">Procesando IA...</span>
                    )}
                    {s.extracted_questions && s.extracted_questions.length > 0 && (
                      <span className="ml-1.5 rounded-full bg-white px-1.5 py-0.2 text-[10px]">{s.extracted_questions.length}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDismiss(s)}
                    disabled={busy}
                    aria-label={`Desestimar ${s.subject}`}
                    title="Desestimar y eliminar"
                    className="rounded-md p-1.5 text-red-500 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {submissions.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center">
                <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-teal-500" />
                <p className="text-lg font-bold text-gray-800">Todo al día</p>
                <p className="mt-1 text-sm text-gray-500">No hay envíos pendientes para moderar.</p>
              </div>
            </div>
          ) : selected ? (
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
              <div className="w-full lg:w-1/2 flex flex-col border-r border-gray-200 bg-gray-100">
                <div className="bg-white px-4 py-3 border-b border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-teal-600" />
                      <span className="text-sm font-bold text-gray-800">{selected.subject}</span>
                      <span className="text-xs text-gray-400">Â·</span>
                      <span className="text-xs text-gray-500">{materialTypeLabels[selected.material_type] ?? selected.material_type}</span>
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                        {selected.processing_status ?? (selected.processed ? 'procesado' : 'pendiente_procesamiento')}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      {selected.file_url && <a
                        href={selected.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs font-bold text-teal-600 hover:text-teal-700"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> Abrir en pestaña
                      </a>}
                      <button
                        onClick={() => void handleRejectSubmission()}
                        disabled={busy}
                        className="flex items-center gap-1 text-xs font-bold text-red-600 hover:text-red-800 disabled:opacity-50"
                        title="Descartar y borrar de Storage"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Descartar
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div><span className="font-semibold text-gray-400">Universidad:</span> <span className="text-gray-700">{selected.university}</span></div>
                    <div><span className="font-semibold text-gray-400">Cátedra:</span> <span className="text-gray-700">{selected.chair}</span></div>
                    {selected.source_notes && <div className="col-span-2"><span className="font-semibold text-gray-400">Notas:</span> <span className="text-gray-700">{selected.source_notes}</span></div>}
                  </div>
                </div>
                <div className="flex-1 overflow-hidden p-2">
                  {selected.material_type === 'texto' ? (
                    <div className="h-full overflow-y-auto rounded-lg bg-white p-4 text-sm whitespace-pre-wrap text-gray-700">{selected.processed_text}</div>
                  ) : selected.file_url && selected.file_type.startsWith('image/') ? (
                    <img src={selected.file_url} alt="Material" className="w-full h-full object-contain rounded-lg" />
                  ) : selected.file_url ? (
                    <iframe
                      src={selected.file_url}
                      title="Visor de documento"
                      className="w-full h-full rounded-lg border border-gray-200 bg-white"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-lg bg-white p-6 text-center text-sm text-gray-500">Este envío no tiene archivo asociado.</div>
                  )}
                </div>
              </div>

              <div className="w-full lg:w-1/2 flex flex-col overflow-y-auto">
                <div className="p-4">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void handleExtract()}
                      disabled={extracting || processingImage}
                      className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 py-3.5 font-bold text-white transition-all hover:from-teal-700 hover:to-emerald-700 active:scale-[0.98] shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {extracting ? (
                        <><Loader2 className="h-5 w-5 animate-spin" /> {progressMsg || 'Extrayendo preguntas...'}</>
                      ) : (
                        <><Sparkles className="h-5 w-5" /> {questions.length > 0 ? 'Volver a extraer con IA' : 'Extraer Preguntas con IA'}</>
                      )}
                    </button>
                    {selected.file_type.startsWith('image/') && (
                      <button
                        type="button"
                        onClick={() => void handleProcessImage()}
                        disabled={extracting || processingImage}
                        className="flex items-center justify-center gap-2 rounded-xl border-2 border-emerald-200 bg-white px-4 py-3.5 font-bold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {processingImage ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                        {processingImage ? 'Procesando...' : 'Procesar con IA'}
                      </button>
                    )}
                  </div>

                  {extractError && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 p-3">
                      <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs font-semibold text-red-700">{extractError}</p>
                    </div>
                  )}

                  {questions.length > 0 && (
                    <div className="mt-4 flex items-center justify-between rounded-2xl border border-teal-200 bg-teal-50 p-4 shadow-sm">
                      <div>
                        <p className="text-sm font-extrabold text-teal-950">
                          {questions.length} preguntas disponibles
                        </p>
                        <p className="text-xs text-teal-700">
                          Podés editar opciones o aprobar el lote completo al juego.
                        </p>
                      </div>
                      <button
                        onClick={() => void handleApproveAll()}
                        disabled={approvingAll || busy}
                        className="flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2.5 text-xs font-bold text-white shadow-md transition hover:bg-teal-700 active:scale-95 disabled:opacity-50"
                      >
                        {approvingAll ? (
                          <><Loader2 className="h-4 w-4 animate-spin" /> Guardando...</>
                        ) : (
                          <><CheckCheck className="h-4 w-4" /> Aprobar todas</>
                        )}
                      </button>
                    </div>
                  )}

                  {questions.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {questions.map((q, qIndex) => (
                        <div key={qIndex} className={`rounded-2xl border-2 p-4 transition ${q.approved ? 'border-teal-300 bg-teal-50/50' : 'border-gray-200 bg-white'}`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold uppercase tracking-wide text-teal-600">Pregunta {qIndex + 1}</span>
                            {q.approved && (
                              <span className="flex items-center gap-1 text-xs font-bold text-teal-600">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Aprobada
                              </span>
                            )}
                          </div>

                          <textarea
                            value={q.pregunta}
                            onChange={(e) => updateQuestion(qIndex, 'pregunta', e.target.value)}
                            rows={2}
                            placeholder="Enunciado de la pregunta"
                            className="w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-teal-500 resize-none"
                          />

                          <div className="mt-2 space-y-1.5">
                            {q.opciones.map((opt, optIndex) => (
                              <div key={optIndex} className="flex items-center gap-2">
                                <button
                                  onClick={() => updateQuestion(qIndex, 'correcta', optIndex)}
                                  className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition ${
                                    q.correcta === optIndex ? 'border-teal-500 bg-teal-500' : 'border-gray-300 hover:border-teal-400'
                                  }`}
                                >
                                  {q.correcta === optIndex && <Check className="h-3.5 w-3.5 text-white" />}
                                </button>
                                <input
                                  type="text"
                                  value={opt}
                                  onChange={(e) => updateOption(qIndex, optIndex, e.target.value)}
                                  placeholder={`Opción ${String.fromCharCode(65 + optIndex)}`}
                                  className={`flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none transition ${
                                    q.correcta === optIndex ? 'border-teal-300 bg-teal-50/50 focus:border-teal-500' : 'border-gray-200 focus:border-teal-400'
                                  }`}
                                />
                              </div>
                            ))}
                          </div>

                          <textarea
                            value={q.explicacion}
                            onChange={(e) => updateQuestion(qIndex, 'explicacion', e.target.value)}
                            rows={2}
                            placeholder="Explicación / justificación"
                            className="mt-2 w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-teal-500 resize-none"
                          />

                          {!q.approved && (
                            <button
                              onClick={() => void handleApprove(qIndex)}
                              disabled={busy}
                              className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-xl bg-teal-600 py-2.5 text-sm font-bold text-white transition hover:bg-teal-700 disabled:opacity-50"
                            >
                              <Check className="h-4 w-4" /> Aprobar individual
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {questions.length > 0 && (
                    <button
                      onClick={() => void handleComplete()}
                      disabled={busy}
                      className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl border-2 border-teal-300 bg-teal-50 py-3 text-sm font-bold text-teal-700 transition hover:bg-teal-100 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Marcar envío como completado
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Reports tab */}
      {tab === 'reports' && (
        <div className="flex-1 px-4 py-8 overflow-y-auto">
          <div className="mx-auto max-w-3xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold uppercase tracking-widest text-red-600">Moderación</p>
                <h1 className="mt-1 text-2xl font-extrabold text-gray-900">Reportes de preguntas</h1>
                <p className="mt-2 text-gray-500">Revisá y corregí reclamos enviados por los usuarios durante las partidas.</p>
              </div>
              <button
                onClick={() => void fetchReports()}
                disabled={loadingReports}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50 shadow-sm disabled:opacity-50"
              >
                {loadingReports ? 'Actualizando...' : 'Recargar'}
              </button>
            </div>

            {loadingReports && reports.length === 0 ? (
              <div className="rounded-3xl bg-white p-8 text-center shadow-lg">
                <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-teal-600" />
                <p className="text-sm font-semibold text-gray-500">Cargando reportes...</p>
              </div>
            ) : reports.length === 0 ? (
              <div className="rounded-3xl bg-white p-8 text-center shadow-lg">
                <Check className="mx-auto mb-3 h-8 w-8 text-teal-600" />
                <p className="font-bold text-gray-800">No hay reportes pendientes</p>
                <p className="mt-1 text-sm text-gray-500">Todas las preguntas reportadas fueron resueltas.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {reports.map((report) => (
                  <div
                    key={report.id}
                    className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700">
                        <Flag className="h-3 w-3" />
                        {report.reason}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(report.created_at).toLocaleString('es-AR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    <div className="mt-3 space-y-2">
                      {report.question_text && (
                        <div className="rounded-xl bg-gray-50 p-3 text-sm font-medium text-gray-800 border border-gray-100">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Pregunta:</p>
                          "{report.question_text}"
                        </div>
                      )}

                      {report.details && (
                        <div className="rounded-xl bg-amber-50/50 p-3 text-sm text-amber-900 border border-amber-100">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700 mb-1">Detalle del usuario:</p>
                          {report.details}
                        </div>
                      )}

                      <p className="text-[11px] text-gray-400">
                        Identificador / Índice: <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-600">{report.question_id}</code>
                      </p>
                    </div>

                    {report.suggested_fix && (
                      <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-3.5 space-y-2 mt-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-extrabold uppercase tracking-wide text-teal-800 flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5 text-teal-600" />
                            Corrección propuesta por el usuario:
                          </span>
                          <button
                            onClick={() => void handleApproveSuggestedFix(report)}
                            disabled={busy}
                            className="flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-teal-700 transition disabled:opacity-50"
                          >
                            <CheckCheck className="h-3.5 w-3.5" />
                            Aprobar y aplicar cambio
                          </button>
                        </div>

                        <p className="text-xs font-medium text-gray-800">
                          <strong className="text-teal-900">Enunciado:</strong> "{report.suggested_fix.pregunta}"
                        </p>

                        <div className="space-y-1">
                          {Array.isArray(report.suggested_fix?.opciones) &&
                            report.suggested_fix.opciones.map((opt, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <span
                                  className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                                    report.suggested_fix?.correcta === i
                                      ? 'bg-teal-600 text-white'
                                      : 'bg-gray-200 text-gray-600'
                                  }`}
                                >
                                  {String.fromCharCode(65 + i)}
                                </span>
                                <span
                                  className={
                                    report.suggested_fix?.correcta === i
                                      ? 'font-bold text-teal-900'
                                      : 'text-gray-600'
                                  }
                                >
                                  {opt}
                                </span>
                              </div>
                            ))}
                        </div>

                        {report.suggested_fix.explicacion && (
                          <p className="text-xs text-gray-600 pt-1 border-t border-teal-100">
                            <strong className="text-teal-900">Explicación:</strong> {report.suggested_fix.explicacion}
                          </p>
                        )}
                      </div>
                    )}

                    {editingReportId === report.id && editingDraft && (
                      <div className="mt-4 rounded-xl border-2 border-teal-500/30 bg-teal-50/40 p-4 space-y-3">
                        <p className="text-xs font-bold uppercase text-teal-800">Editar y Corregir:</p>

                        <textarea
                          value={editingDraft.pregunta}
                          onChange={(e) => setEditingDraft({ ...editingDraft, pregunta: e.target.value })}
                          rows={2}
                          className="w-full rounded-xl border border-teal-300 bg-white p-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500"
                          placeholder="Enunciado de la pregunta"
                        />

                        <div className="space-y-1.5">
                          {Array.isArray(editingDraft?.opciones) &&
                            editingDraft.opciones.map((opt, idx) => (
                              <div key={idx} className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingDraft({ ...editingDraft, correcta: idx })}
                                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition ${
                                    editingDraft.correcta === idx
                                      ? 'border-teal-600 bg-teal-600 text-white'
                                      : 'border-gray-300 bg-white hover:border-teal-400'
                                  }`}
                                  title="Marcar como correcta"
                                >
                                  {editingDraft.correcta === idx && <Check className="w-3.5 h-3.5" />}
                                </button>
                                <input
                                  type="text"
                                  value={opt}
                                  onChange={(e) => {
                                    const nuevas = [...(editingDraft.opciones || [])];
                                    nuevas[idx] = e.target.value;
                                    setEditingDraft({ ...editingDraft, opciones: nuevas });
                                  }}
                                  placeholder={`Opción ${String.fromCharCode(65 + idx)}`}
                                  className={`flex-1 rounded-lg border bg-white px-3 py-1.5 text-sm outline-none ${
                                    editingDraft.correcta === idx ? 'border-teal-400 font-medium' : 'border-gray-200'
                                  }`}
                                />
                              </div>
                            ))}
                        </div>

                        <textarea
                          value={editingDraft.explicacion}
                          onChange={(e) => setEditingDraft({ ...editingDraft, explicacion: e.target.value })}
                          rows={2}
                          className="w-full rounded-xl border border-gray-200 bg-white p-2.5 text-sm outline-none focus:border-teal-500"
                          placeholder="Explicación / justificación"
                        />

                        <div className="flex justify-end gap-2 pt-2">
                          <button
                            onClick={() => { setEditingReportId(null); setEditingDraft(null); }}
                            className="rounded-xl px-3 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700"
                          >
                            Cancelar edición
                          </button>
                          <button
                            onClick={() => void handleSaveReportFix(report)}
                            disabled={busy}
                            className="flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-teal-700 transition disabled:opacity-50"
                          >
                            <Save className="h-3.5 w-3.5" />
                            Guardar cambios y resolver reporte
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
                      <button
                        onClick={() => handleStartEditReport(report)}
                        disabled={busy}
                        className="flex items-center gap-1 rounded-xl bg-teal-50 border border-teal-200 px-3.5 py-2 text-xs font-bold text-teal-700 transition hover:bg-teal-100 disabled:opacity-50"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {editingReportId === report.id ? 'Cerrar edición' : 'Corregir pregunta'}
                      </button>
                      <button
                        onClick={() => void handleDismissReport(report.id)}
                        disabled={busy}
                        className="rounded-xl bg-gray-100 px-3.5 py-2 text-xs font-bold text-gray-600 transition hover:bg-gray-200 disabled:opacity-50"
                      >
                        Descartar reporte
                      </button>
                      <button
                        onClick={() => void handleDeleteReportedQuestion(report)}
                        disabled={busy}
                        className="flex items-center gap-1 rounded-xl bg-red-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Eliminar pregunta
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
