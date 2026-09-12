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
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { loadSuggestions, moderateSuggestion } from '@/utils/taxonomy';
import { loadPendingSubmissions, insertQuestion, markSubmissionProcessed, type Submission } from '@/utils/moderation';
import { extractQuestionsFromFile } from '@/utils/gemini';
import { fetchAndExtractText } from '@/utils/fileParser';
import { deleteSubmission } from '@/utils/submissions';
import type { Question, TaxonomySuggestion } from '@/types';

interface AdminPanelProps { onBack: () => void; }

interface EditableQuestion extends Question {
  approved: boolean;
}

const levelLabels = { university: 'Universidad', subject: 'Materia', chair: 'Cátedra' } as const;

const materialTypeLabels: Record<string, string> = {
  apunte: 'Apunte / Resumen teórico',
  preguntero_choice: 'Preguntero / Choice',
  pregunta_respuesta: 'Preguntas con Respuesta',
};

type Tab = 'taxonomy' | 'materials';

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
  const [extractError, setExtractError] = useState('');
  const [progressMsg, setProgressMsg] = useState('');
  const [approvingAll, setApprovingAll] = useState(false);

  const selected = submissions.find((s) => s.id === selectedId) ?? null;

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
      void refreshSubmissions();
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
    setSelectedId(null);
    setQuestions([]);
    setEditingId(null);
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
    if (unlocked && tab === 'materials') void refreshSubmissions();
  }, [unlocked, tab, refreshSubmissions]);

  const selectSubmission = (sub: Submission) => {
    setSelectedId(sub.id);
    setExtractError('');
    // Si ya tenía preguntas extraídas previamente en Supabase, las mostramos de inmediato
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

  const handleExtract = async () => {
    if (!selected) return;
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
        setProgressMsg(`Procesando bloque ${current} de ${total}...`);
      });

      if (result.error) {
        setExtractError(result.error);
      } else {
        const mapped = result.questions.map((q) => ({ ...q, approved: false }));
        setQuestions(mapped);

        // Guardar borrador en Supabase para tenerlo persistido
        await supabase
          .from('submissions')
          .update({ extracted_questions: result.questions })
          .eq('id', selected.id);

        // Actualizar el estado local de submissions
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

  const handleRejectSubmission = async () => {
    if (!selected) return;
    const confirmDelete = window.confirm(
      `¿Querés descartar y eliminar definitivamente este envío de "${selected.subject}"? Se borrará tanto de la base de datos como del almacenamiento.`
    );
    if (!confirmDelete) return;

    setBusy(true);
    setMessage('');
    try {
      await deleteSubmission(selected.id, selected.file_url);
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
      await insertQuestion(q.pregunta, q.opciones, q.correcta, q.explicacion, selected.id, adminPassword);
      setQuestions((current) =>
        current.map((item, i) => (i === index ? { ...item, approved: true } : item)),
      );
      setMessage('Pregunta incorporada al juego.');
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
      // 1. Insertar una por una las que no estén marcadas como aprobadas
      const pendingQuestions = questions.filter((q) => !q.approved);
      for (const q of pendingQuestions) {
        await insertQuestion(q.pregunta, q.opciones, q.correcta, q.explicacion, selected.id, adminPassword);
      }

      // 2. Marcar submission como completada
      await markSubmissionProcessed(selected.id, adminPassword);

      // 3. Actualizar la lista en pantalla
      const remaining = submissions.filter((s) => s.id !== selected.id);
      setSubmissions(remaining);
      if (remaining.length > 0) {
        selectSubmission(remaining[0]);
      } else {
        setSelectedId(null);
        setQuestions([]);
      }
      setMessage(`¡Lote aprobado con éxito! Se sumaron ${pendingQuestions.length} preguntas al juego.`);
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
                <p className="text-sm text-gray-500">Moderación de propuestas y materiales</p>
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

      {/* Materials tab */}
      {tab === 'materials' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Submission selector */}
          {submissions.length > 0 && (
            <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-2 overflow-x-auto scrollbar-hide">
              <span className="text-xs font-bold uppercase tracking-wide text-gray-400 flex-shrink-0">Pendientes:</span>
              {submissions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => selectSubmission(s)}
                  className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    s.id === selectedId ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {s.subject} — {s.chair}
                  {s.extracted_questions && s.extracted_questions.length > 0 && (
                    <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.2 text-[10px]">
                      {s.extracted_questions.length}
                    </span>
                  )}
                </button>
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
              {/* Left: Document viewer */}
              <div className="w-full lg:w-1/2 flex flex-col border-r border-gray-200 bg-gray-100">
                <div className="bg-white px-4 py-3 border-b border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-teal-600" />
                      <span className="text-sm font-bold text-gray-800">{selected.subject}</span>
                      <span className="text-xs text-gray-400">·</span>
                      <span className="text-xs text-gray-500">{materialTypeLabels[selected.material_type] ?? selected.material_type}</span>
                    </div>
                    
                    {/* Acciones del documento: Ver y Eliminar */}
                    <div className="flex items-center gap-3">
                      <a
                        href={selected.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs font-bold text-teal-600 hover:text-teal-700"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> Abrir en pestaña
                      </a>
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
                  {selected.file_type.startsWith('image/') ? (
                    <img src={selected.file_url} alt="Material" className="w-full h-full object-contain rounded-lg" />
                  ) : (
                    <iframe
                      src={selected.file_url}
                      title="Visor de documento"
                      className="w-full h-full rounded-lg border border-gray-200 bg-white"
                    />
                  )}
                </div>
              </div>

              {/* Right: Questions panel */}
              <div className="w-full lg:w-1/2 flex flex-col overflow-y-auto">
                <div className="p-4">
                  {/* Botón de Extracción */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void handleExtract()}
                      disabled={extracting}
                      className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 py-3.5 font-bold text-white transition-all hover:from-teal-700 hover:to-emerald-700 active:scale-[0.98] shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {extracting ? (
                        <><Loader2 className="h-5 w-5 animate-spin" /> {progressMsg || 'Extrayendo preguntas...'}</>
                      ) : (
                        <><Sparkles className="h-5 w-5" /> {questions.length > 0 ? 'Volver a extraer con IA' : 'Extraer Preguntas con IA'}</>
                      )}
                    </button>
                  </div>

                  {extractError && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 p-3">
                      <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs font-semibold text-red-700">{extractError}</p>
                    </div>
                  )}

                  {/* Banner de Aprobación Masiva */}
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

                  {/* Lista de Preguntas */}
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
    </div>
  );
}