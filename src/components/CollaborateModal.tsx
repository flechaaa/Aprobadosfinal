import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, X, FileText, CheckCircle2, AlertCircle, Loader2, Bell, Send } from 'lucide-react';
import { submitTextSubmission, uploadSubmissions, validateFile, type MaterialType } from '@/utils/submissions';
import { extractTextFromFileObject } from '@/utils/fileParser';
import { submitQuestionSuggestion } from '@/utils/questionSuggestions';
import { notificationSupported, requestNotificationPermission, registerBrowserPushSubscription, getOrCreateSessionId } from '@/utils/notifications';
import { supabase } from '@/lib/supabase';
import { AutocompleteField } from '@/components/AutocompleteField';

interface CollaborateModalProps {
  open: boolean;
  onClose: () => void;
}

const MATERIAL_OPTIONS: { value: MaterialType; label: string; description: string }[] = [
  { value: 'apunte', label: 'Apunte / Resumen teórico', description: 'Resúmenes, teoría, esquemas' },
  { value: 'preguntero_choice', label: 'Preguntero / Choice ya armado', description: 'Preguntas múltiples choice' },
  { value: 'pregunta_respuesta', label: 'Preguntas con Respuesta modelo', description: 'Preguntas abiertas con respuesta' },
  { value: 'texto', label: 'Texto directo de WhatsApp', description: 'Pegá preguntas copiadas de un chat' },
];

export function CollaborateModal({ open, onClose }: CollaborateModalProps) {
  const [mode, setMode] = useState<'material' | 'question'>('material');
  const [university, setUniversity] = useState('');
  const [subject, setSubject] = useState('');
  const [chair, setChair] = useState('');
  const [hasUnit, setHasUnit] = useState(false);
  const [unit, setUnit] = useState('');
  const [sourceNotes, setSourceNotes] = useState('');
  const [materialType, setMaterialType] = useState<MaterialType>('apunte');
  const [textContent, setTextContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [notifyWhenApproved, setNotifyWhenApproved] = useState(false);
  const [notifyStatus, setNotifyStatus] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Estado propio del modo "Proponer una pregunta"
  const [questionAuthorName, setQuestionAuthorName] = useState('');
  const [questionText, setQuestionText] = useState('');
  const [questionOptions, setQuestionOptions] = useState<string[]>(['', '', '', '']);
  const [questionCorrectOption, setQuestionCorrectOption] = useState(0);
  const [questionSending, setQuestionSending] = useState(false);
  const [questionError, setQuestionError] = useState('');
  const [questionSuccess, setQuestionSuccess] = useState(false);

  const previewUrls = useMemo(
    () => files.map((file) => (file.type.startsWith('image/') ? URL.createObjectURL(file) : null)),
    [files],
  );

  useEffect(() => () => {
    previewUrls.forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }, [previewUrls]);

  const [previewModal, setPreviewModal] = useState<{
    fileName: string;
    kind: 'image' | 'pdf' | 'text';
    url?: string;
    text?: string;
    loading: boolean;
  } | null>(null);

  const isPdfFile = (file: File) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  const handleOpenPreview = useCallback(async (index: number) => {
    const file = files[index];
    if (!file) return;

    if (file.type.startsWith('image/')) {
      setPreviewModal({ fileName: file.name, kind: 'image', url: previewUrls[index] ?? URL.createObjectURL(file), loading: false });
      return;
    }

    if (isPdfFile(file)) {
      setPreviewModal({ fileName: file.name, kind: 'pdf', url: URL.createObjectURL(file), loading: false });
      return;
    }

    setPreviewModal({ fileName: file.name, kind: 'text', loading: true });
    try {
      const text = await extractTextFromFileObject(file);
      setPreviewModal({ fileName: file.name, kind: 'text', text: text.slice(0, 2000), loading: false });
    } catch {
      setPreviewModal({ fileName: file.name, kind: 'text', text: 'No se pudo generar una vista previa del contenido de este archivo.', loading: false });
    }
  }, [files, previewUrls]);

  const handleClosePreview = useCallback(() => {
    setPreviewModal((current) => {
      if (current?.kind === 'pdf' && current.url) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  // Estados de taxonomía inteligente
  const [universities, setUniversities] = useState<{ id: string; name: string }[]>([]);
  const [subjects, setSubjects] = useState<{ id: string; name: string; university_id: string }[]>([]);
  const [chairs, setChairs] = useState<{ id: string; name: string; subject_id: string }[]>([]);

  // Cargar taxonomía al abrir el modal
  useEffect(() => {
    if (!open) return;
    (async () => {
      const [{ data: uniData }, { data: subjData }, { data: chairData }] = await Promise.all([
        supabase.from('universities').select('id, name'),
        supabase.from('subjects').select('id, name, university_id'),
        supabase.from('chairs').select('id, name, subject_id'),
      ]);
      setUniversities(uniData ?? []);
      setSubjects(subjData ?? []);
      setChairs(chairData ?? []);
    })();
  }, [open]);

  // Cálculo de sugerencias encadenadas
  const normalize = (s: string) => s.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  const matchedUniversity = universities.find((u) => normalize(u.name) === normalize(university));
  const subjectCandidates = matchedUniversity
    ? subjects.filter((s) => s.university_id === matchedUniversity.id)
    : subjects;
  const subjectSuggestions = subjectCandidates
    .map((s) => s.name);
  const matchedSubject = subjectCandidates.find(
    (s) => normalize(s.name) === normalize(subject),
  );
  const chairCandidates = matchedSubject
    ? chairs.filter((c) => c.subject_id === matchedSubject.id)
    : matchedUniversity
      ? chairs.filter((c) => subjectCandidates.some((s) => s.id === c.subject_id))
      : chairs;
  const chairSuggestions = chairCandidates
    .map((c) => c.name);
  const matchedChair = chairCandidates.find((c) => normalize(c.name) === normalize(chair));

  const resetForm = useCallback(() => {
    setMode('material');
    setUniversity('');
    setSubject('');
    setChair('');
    setHasUnit(false);
    setUnit('');
    setSourceNotes('');
    setMaterialType('apunte');
    setTextContent('');
    setFiles([]);
    setProgress(0);
    setSuccess(false);
    setError('');
    setQuestionAuthorName('');
    setQuestionText('');
    setQuestionOptions(['', '', '', '']);
    setQuestionCorrectOption(0);
    setQuestionError('');
    setQuestionSuccess(false);
    setQuestionSending(false);
  }, []);

  const handleClose = useCallback(() => {
    if (uploading || questionSending) return;
    resetForm();
    onClose();
  }, [uploading, questionSending, resetForm, onClose]);

  const handleFiles = useCallback((selectedFiles: File[]) => {
    const invalidFile = selectedFiles.map((file) => ({ file, error: validateFile(file) })).find((item) => item.error);
    if (invalidFile?.error) {
      setError(`${invalidFile.file.name}: ${invalidFile.error}`);
      return;
    }
    setError('');
    setFiles((current) => {
      const merged = [...current, ...selectedFiles];
      return merged.filter((file, index, all) => all.findIndex((candidate) => candidate.name === file.name && candidate.size === file.size && candidate.lastModified === file.lastModified) === index);
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(Array.from(e.dataTransfer.files ?? []));
  }, [handleFiles]);

  const handleSubmit = async () => {
    const isTextSubmission = materialType === 'texto';
    if (!university.trim() || !subject.trim() || !chair.trim() || (isTextSubmission ? textContent.trim().length < 20 : files.length === 0)) {
      setError('Completá los campos obligatorios y adjuntá un archivo.');
      return;
    }

    setUploading(true);
    setError('');
    setProgress(10);

    const progressInterval = setInterval(() => {
      setProgress((p) => Math.min(p + 15, 85));
    }, 300);

    try {
      if (notifyWhenApproved && notificationSupported()) {
        const permission = await requestNotificationPermission();
        if (permission === 'granted') {
          try {
            await registerBrowserPushSubscription(getOrCreateSessionId());
            setNotifyStatus('Notificación autorizada.');
          } catch (registerErr) {
            console.warn('No se pudo registrar la subscripción push:', registerErr);
            setNotifyStatus('Se guardó el envío, pero la notificación no pudo registrarse.');
          }
        } else {
          setNotifyStatus('La notificación quedó deshabilitada en este navegador.');
        }
      }

      if (isTextSubmission) {
        await submitTextSubmission({
          university: university.trim(),
          subject: subject.trim(),
          chair: chair.trim(),
          unit: hasUnit ? unit.trim() || undefined : undefined,
          sourceNotes: sourceNotes.trim() || undefined,
          materialType,
          text: textContent,
        });
      } else {
        await uploadSubmissions({
        university: university.trim(),
        subject: subject.trim(),
        chair: chair.trim(),
        unit: hasUnit ? unit.trim() || undefined : undefined,
        sourceNotes: sourceNotes.trim() || undefined,
        materialType,
          files,
        });
      }
      clearInterval(progressInterval);
      setProgress(100);
      setSuccess(true);
      setTimeout(() => {
        resetForm();
        onClose();
      }, 2000);
    } catch (err) {
      clearInterval(progressInterval);
      const message = err instanceof Error ? err.message : 'No se pudo enviar el material.';
      setError(message);
      setProgress(0);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmitQuestion = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!matchedUniversity || !matchedSubject || !matchedChair) {
      setQuestionError('Elegí una universidad, materia y parcial que ya existan (para crear una clasificación nueva, subí un material en vez de proponer una pregunta puntual).');
      return;
    }

    if (!questionText.trim()) {
      setQuestionError('Escribí el enunciado de la pregunta.');
      return;
    }

    const cleanOptions = questionOptions.map((option) => option.trim());
    if (cleanOptions.some((option) => !option)) {
      setQuestionError('Completá las cuatro opciones de respuesta.');
      return;
    }

    try {
      setQuestionSending(true);
      setQuestionError('');
      await submitQuestionSuggestion({
        university_id: matchedUniversity.id,
        subject_id: matchedSubject.id,
        chair_id: matchedChair.id,
        unit_name: hasUnit ? unit.trim() || null : null,
        question_text: questionText.trim(),
        options: cleanOptions,
        correct_option: questionCorrectOption,
        author_name: questionAuthorName.trim() || 'Anónimo',
        status: 'pending',
      });

      setQuestionSuccess(true);
      setTimeout(() => {
        resetForm();
        onClose();
      }, 1200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo enviar la propuesta.';
      setQuestionError(message);
    } finally {
      setQuestionSending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-hide bg-white rounded-3xl shadow-2xl animate-pop-in">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-white border-b border-gray-100 rounded-t-3xl">
          <h2 className="text-lg font-extrabold text-gray-900">Colaborar / Enviar material</h2>
          <button
            onClick={handleClose}
            disabled={uploading || questionSending}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {(mode === 'material' ? success : questionSuccess) ? (
            <div className="flex flex-col items-center py-8 text-center animate-pop-in">
              <CheckCircle2 className="h-14 w-14 text-teal-500 mb-4" />
              <p className="text-lg font-bold text-gray-900">{mode === 'material' ? '¡Material enviado!' : '¡Gracias!'}</p>
              <p className="mt-1 text-sm text-gray-500">
                {mode === 'material' ? 'Gracias por colaborar. Tu aporte será revisado.' : 'Tu propuesta fue enviada con éxito.'}
              </p>
            </div>
          ) : (
            <>
              <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setMode('material')}
                  className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
                    mode === 'material' ? 'bg-white text-teal-700 shadow' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Subir material
                </button>
                <button
                  type="button"
                  onClick={() => setMode('question')}
                  className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
                    mode === 'question' ? 'bg-white text-teal-700 shadow' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Proponer una pregunta
                </button>
              </div>

              {/* Autocomplete fields for taxonomy */}
              <AutocompleteField
                label="Universidad *"
                value={university}
                onChange={setUniversity}
                suggestions={universities.map((u) => u.name)}
                placeholder="Ej: Universidad de Buenos Aires"
                maxLength={200}
              />

              <AutocompleteField
                label="Materia *"
                value={subject}
                onChange={setSubject}
                suggestions={subjectSuggestions}
                placeholder="Ej: Infectología"
                maxLength={200}
              />

              <AutocompleteField
                label="Parcial *"
                value={chair}
                onChange={setChair}
                suggestions={chairSuggestions}
                placeholder="Ej: Primer parcial - Dr. Pérez"
                maxLength={200}
              />

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <label className="flex items-center gap-3 text-sm font-bold text-gray-700">
                  <input
                    type="checkbox"
                    checked={hasUnit}
                    onChange={(event) => {
                      const next = event.target.checked;
                      setHasUnit(next);
                      if (!next) setUnit('');
                    }}
                    className="h-4 w-4 accent-teal-600"
                  />
                  Agregar unidad (opcional)
                </label>
                {hasUnit && (
                  <div className="mt-3">
                    <AutocompleteField
                      label="Unidad"
                      value={unit}
                      onChange={setUnit}
                      suggestions={[]}
                      placeholder="Ej: Unidad 1, Bacterias"
                      maxLength={200}
                    />
                  </div>
                )}
              </div>

              {mode === 'material' ? (
                <>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1.5">
                  Notas / Año de la fuente
                </label>
                <input
                  type="text"
                  value={sourceNotes}
                  onChange={(e) => setSourceNotes(e.target.value)}
                  placeholder="Ej: 2do año, 2025"
                  maxLength={200}
                  className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none focus:border-teal-500"
                />
              </div>

              {/* Material type */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
                  Tipo de material *
                </label>
                <div className="space-y-2">
                  {MATERIAL_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-3 rounded-xl border-2 p-3 cursor-pointer transition-all ${
                        materialType === opt.value
                          ? 'border-teal-500 bg-teal-50'
                          : 'border-gray-200 hover:border-teal-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="materialType"
                        value={opt.value}
                        checked={materialType === opt.value}
                        onChange={() => setMaterialType(opt.value)}
                        className="mt-1 accent-teal-600"
                      />
                      <div>
                        <p className="text-sm font-bold text-gray-800">{opt.label}</p>
                        <p className="text-xs text-gray-500">{opt.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border-2 border-teal-100 bg-teal-50/50 p-4">
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="flex items-center gap-2 text-sm font-black text-gray-800">
                    <Bell className="h-4 w-4 text-teal-600" />
                    Recibir notificación cuando se apruebe
                  </span>
                  <input
                    type="checkbox"
                    checked={notifyWhenApproved}
                    onChange={(e) => setNotifyWhenApproved(e.target.checked)}
                    className="accent-teal-600 h-4 w-4"
                  />
                </label>
                {notifyStatus && <p className="mt-2 text-xs font-semibold text-teal-700">{notifyStatus}</p>}
              </div>

              {/* Drag & Drop */}
              <div className={materialType === 'texto' ? 'hidden' : ''}>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
                   Archivos (PDF, PPTX, PNG, JPG, DOCX, TXT) *
                </label>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => inputRef.current?.click()}
                  className={`rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-all ${
                    dragOver
                      ? 'border-teal-500 bg-teal-50'
                      : files.length > 0
                      ? 'border-teal-400 bg-teal-50/50'
                      : 'border-gray-300 hover:border-teal-400 hover:bg-gray-50'
                  }`}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept=".pdf,.pptx,.docx,.png,.jpg,.jpeg,.txt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,text/plain"
                    onChange={(e) => {
                      handleFiles(Array.from(e.target.files ?? []));
                      e.currentTarget.value = '';
                    }}
                    className="hidden"
                  />
                  {files.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 text-left sm:grid-cols-3">
                      {files.map((selectedFile, index) => (
                        <div key={`${selectedFile.name}-${selectedFile.lastModified}-${index}`} className="relative overflow-hidden rounded-xl border border-teal-100 bg-white">
                          {previewUrls[index] ? (
                            <img src={previewUrls[index] ?? undefined} alt={selectedFile.name} className="h-24 w-full object-cover" />
                          ) : (
                            <div className="flex h-24 items-center justify-center bg-gray-50"><FileText className="h-8 w-8 text-teal-600" /></div>
                          )}
                          <p className="truncate px-2 pt-1 text-xs font-semibold text-gray-700">{selectedFile.name}</p>
                          <p className="px-2 pb-2 text-[10px] text-gray-400">{(selectedFile.size / 1024 / 1024).toFixed(1)} MB</p>
                          <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); void handleOpenPreview(index); }}
                            className="absolute bottom-8 left-1 rounded-full bg-white/90 px-2 py-1 text-[10px] font-bold text-teal-700 shadow hover:bg-teal-50"
                          >
                            Vista previa
                          </button>
                          <button type="button" onClick={(event) => { event.stopPropagation(); setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index)); }} className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-red-500 shadow" aria-label={`Quitar ${selectedFile.name}`}><X className="h-3.5 w-3.5" /></button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Upload className="h-8 w-8 text-gray-400" />
                      <p className="text-sm font-medium text-gray-500">Arrastrá tu archivo aquí o hacé clic</p>
                      <p className="text-xs text-gray-400">PDF, PPTX, DOCX o imágenes · Máx 150 MB</p>
                    </div>
                  )}
                </div>
                {files.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFiles([])}
                    className="mt-2 text-xs font-semibold text-red-500 hover:text-red-700"
                  >
                    Quitar todos los archivos
                  </button>
                )}
              </div>

              {materialType === 'texto' && (
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">
                    Texto de WhatsApp *
                  </label>
                  <textarea
                    value={textContent}
                    onChange={(event) => setTextContent(event.target.value)}
                    rows={9}
                    placeholder="Pegá aquí las preguntas o el apunte copiado desde WhatsApp..."
                    className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none focus:border-teal-500"
                  />
                  <p className="mt-1 text-xs text-gray-400">Mínimo 20 caracteres. Se procesará automáticamente con IA.</p>
                </div>
              )}

              {/* Progress bar */}
              {uploading && progress > 0 && (
                <div className="animate-fade-in">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-gray-500">Subiendo...</span>
                    <span className="text-xs font-bold text-teal-600">{progress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 animate-fade-in">
                  <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs font-semibold text-red-700">{error}</p>
                </div>
              )}

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={uploading || !university.trim() || !subject.trim() || !chair.trim() || (materialType === 'texto' ? textContent.trim().length < 20 : files.length === 0)}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 py-4 font-bold text-white transition-all hover:from-teal-700 hover:to-emerald-700 active:scale-[0.98] shadow-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Upload className="h-5 w-5" />
                    Enviar material
                  </>
                )}
              </button>
                </>
              ) : (
                <form onSubmit={handleSubmitQuestion} className="space-y-4">
                  {(!matchedUniversity || !matchedSubject || !matchedChair) && (university || subject || chair) && (
                    <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-700">
                      Para proponer una pregunta puntual, elegí una universidad, materia y parcial que ya existan en la lista de sugerencias.
                    </p>
                  )}

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1.5">Tu nombre o alias</label>
                    <input
                      type="text"
                      value={questionAuthorName}
                      onChange={(event) => setQuestionAuthorName(event.target.value)}
                      placeholder="Anónimo"
                      className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none focus:border-teal-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1.5">Pregunta</label>
                    <textarea
                      value={questionText}
                      onChange={(event) => setQuestionText(event.target.value)}
                      rows={3}
                      placeholder="Escribí el enunciado de la pregunta..."
                      className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none focus:border-teal-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Opciones de respuesta</label>
                    <div className="space-y-2">
                      {questionOptions.map((option, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setQuestionCorrectOption(idx)}
                            className={`h-7 w-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                              questionCorrectOption === idx
                                ? 'border-teal-600 bg-teal-600 text-white'
                                : 'border-gray-300 text-transparent hover:border-teal-400'
                            }`}
                            title={questionCorrectOption === idx ? 'Opción correcta' : 'Marcar como correcta'}
                          >
                            {questionCorrectOption === idx && <CheckCircle2 className="h-4 w-4" />}
                          </button>
                          <input
                            type="text"
                            value={option}
                            onChange={(event) => {
                              const nextOptions = [...questionOptions];
                              nextOptions[idx] = event.target.value;
                              setQuestionOptions(nextOptions);
                            }}
                            placeholder={`Opción ${String.fromCharCode(65 + idx)}`}
                            className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none focus:border-teal-500"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {questionError && (
                    <div className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">
                      <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                      {questionError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={questionSending}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 py-4 font-bold text-white transition-all hover:from-teal-700 hover:to-emerald-700 active:scale-[0.98] shadow-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                  >
                    {questionSending ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      <>
                        <Send className="h-5 w-5" />
                        Enviar propuesta
                      </>
                    )}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>

      {previewModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 px-4" onClick={handleClosePreview}>
          <div className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <p className="truncate text-sm font-bold text-gray-800">{previewModal.fileName}</p>
              <button type="button" onClick={handleClosePreview} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[calc(85vh-52px)] overflow-y-auto">
              {previewModal.kind === 'image' && previewModal.url && (
                <img src={previewModal.url} alt={previewModal.fileName} className="mx-auto max-h-[75vh] w-auto object-contain" />
              )}
              {previewModal.kind === 'pdf' && previewModal.url && (
                <iframe src={previewModal.url} title={previewModal.fileName} className="h-[75vh] w-full" />
              )}
              {previewModal.kind === 'text' && (
                previewModal.loading ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-sm font-semibold text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generando vista previa...
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap break-words p-4 text-xs text-gray-700">{previewModal.text}</pre>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
