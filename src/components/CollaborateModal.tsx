import { useCallback, useRef, useState } from 'react';
import { Upload, X, FileText, CheckCircle2, AlertCircle, Loader2, Bell } from 'lucide-react';
import { uploadSubmission, validateFile, type MaterialType } from '@/utils/submissions';
import { notificationSupported, requestNotificationPermission, registerBrowserPushSubscription, getOrCreateSessionId } from '@/utils/notifications';

interface CollaborateModalProps {
  open: boolean;
  onClose: () => void;
}

const MATERIAL_OPTIONS: { value: MaterialType; label: string; description: string }[] = [
  { value: 'apunte', label: 'Apunte / Resumen teórico', description: 'Resúmenes, teoría, esquemas' },
  { value: 'preguntero_choice', label: 'Preguntero / Choice ya armado', description: 'Preguntas múltiples choice' },
  { value: 'pregunta_respuesta', label: 'Preguntas con Respuesta modelo', description: 'Preguntas abiertas con respuesta' },
];

export function CollaborateModal({ open, onClose }: CollaborateModalProps) {
  const [university, setUniversity] = useState('');
  const [subject, setSubject] = useState('');
  const [chair, setChair] = useState('');
  const [sourceNotes, setSourceNotes] = useState('');
  const [materialType, setMaterialType] = useState<MaterialType>('apunte');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [notifyWhenApproved, setNotifyWhenApproved] = useState(false);
  const [notifyStatus, setNotifyStatus] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const resetForm = useCallback(() => {
    setUniversity('');
    setSubject('');
    setChair('');
    setSourceNotes('');
    setMaterialType('apunte');
    setFile(null);
    setProgress(0);
    setSuccess(false);
    setError('');
  }, []);

  const handleClose = useCallback(() => {
    if (uploading) return;
    resetForm();
    onClose();
  }, [uploading, resetForm, onClose]);

  const handleFile = useCallback((f: File) => {
    const validationError = validateFile(f);
    if (validationError) {
      setError(validationError);
      setFile(null);
      return;
    }
    setError('');
    setFile(f);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleSubmit = async () => {
    if (!university.trim() || !subject.trim() || !chair.trim() || !file) {
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

      await uploadSubmission({
        university: university.trim(),
        subject: subject.trim(),
        chair: chair.trim(),
        sourceNotes: sourceNotes.trim() || undefined,
        materialType,
        file,
      });
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
            disabled={uploading}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {success ? (
            <div className="flex flex-col items-center py-8 text-center animate-pop-in">
              <CheckCircle2 className="h-14 w-14 text-teal-500 mb-4" />
              <p className="text-lg font-bold text-gray-900">¡Material enviado!</p>
              <p className="mt-1 text-sm text-gray-500">Gracias por colaborar. Tu aporte será revisado.</p>
            </div>
          ) : (
            <>
              {/* Required fields */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1.5">
                  Universidad *
                </label>
                <input
                  type="text"
                  value={university}
                  onChange={(e) => setUniversity(e.target.value)}
                  placeholder="Ej: Universidad de Buenos Aires"
                  maxLength={200}
                  className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1.5">
                  Materia *
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Ej: Infectología"
                  maxLength={200}
                  className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1.5">
                  Cátedra / Docente *
                </label>
                <input
                  type="text"
                  value={chair}
                  onChange={(e) => setChair(e.target.value)}
                  placeholder="Ej: Cátedra 1 - Dr. Pérez"
                  maxLength={200}
                  className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none focus:border-teal-500"
                />
              </div>

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
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
                  Archivo (PDF, PPTX, PNG, JPG, DOCX, TXT) *
                </label>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => inputRef.current?.click()}
                  className={`rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-all ${
                    dragOver
                      ? 'border-teal-500 bg-teal-50'
                      : file
                      ? 'border-teal-400 bg-teal-50/50'
                      : 'border-gray-300 hover:border-teal-400 hover:bg-gray-50'
                  }`}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".pdf,.pptx,.docx,.png,.jpg,.jpeg,.txt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,text/plain"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                    className="hidden"
                  />
                  {file ? (
                    <div className="flex items-center justify-center gap-2">
                      <FileText className="h-5 w-5 text-teal-600" />
                      <span className="text-sm font-medium text-gray-700">{file.name}</span>
                      <span className="text-xs text-gray-400">({(file.size / 1024 / 1024).toFixed(1)} MB)</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Upload className="h-8 w-8 text-gray-400" />
                      <p className="text-sm font-medium text-gray-500">Arrastrá tu archivo aquí o hacé clic</p>
                      <p className="text-xs text-gray-400">PDF, PPTX, DOCX o imágenes · Máx 150 MB</p>
                    </div>
                  )}
                </div>
                {file && (
                  <button
                    onClick={() => setFile(null)}
                    className="mt-2 text-xs font-semibold text-red-500 hover:text-red-700"
                  >
                    Quitar archivo
                  </button>
                )}
              </div>

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
                disabled={uploading || !university.trim() || !subject.trim() || !chair.trim() || !file}
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
          )}
        </div>
      </div>
    </div>
  );
}