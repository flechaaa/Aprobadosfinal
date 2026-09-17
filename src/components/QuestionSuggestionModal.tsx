import { useMemo, useState } from 'react';
import { X, Send, CheckCircle2, AlertCircle } from 'lucide-react';
import { submitQuestionSuggestion } from '@/utils/questionSuggestions';
import type { Chair, Subject, University } from '@/types';

interface QuestionSuggestionModalProps {
  open: boolean;
  onClose: () => void;
  universities: University[];
  subjects: Subject[];
  chairs: Chair[];
}

export function QuestionSuggestionModal({ open, onClose, universities, subjects, chairs }: QuestionSuggestionModalProps) {
  const [universityId, setUniversityId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [chairId, setChairId] = useState('');
  const [hasUnit, setHasUnit] = useState(false);
  const [unitName, setUnitName] = useState('');
  const [questionText, setQuestionText] = useState('');
  const [options, setOptions] = useState<string[]>(['', '', '', '']);
  const [correctOption, setCorrectOption] = useState(0);
  const [authorName, setAuthorName] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const availableSubjects = useMemo(
    () => subjects.filter((subject) => subject.university_id === universityId),
    [subjects, universityId],
  );

  const availableChairs = useMemo(
    () => chairs.filter((chair) => chair.subject_id === subjectId),
    [chairs, subjectId],
  );

  const resetForm = () => {
    setUniversityId('');
    setSubjectId('');
    setChairId('');
    setHasUnit(false);
    setUnitName('');
    setQuestionText('');
    setOptions(['', '', '', '']);
    setCorrectOption(0);
    setAuthorName('');
    setError('');
    setSuccess(false);
    setSending(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!universityId || !subjectId || !chairId) {
      setError('Elegí universidad, materia y cátedra.');
      return;
    }

    if (!questionText.trim()) {
      setError('Escribí el enunciado de la pregunta.');
      return;
    }

    const cleanOptions = options.map((option) => option.trim());
    if (cleanOptions.some((option) => !option)) {
      setError('Completá las cuatro opciones de respuesta.');
      return;
    }

    if (!Number.isInteger(correctOption) || correctOption < 0 || correctOption > 3) {
      setError('Marcá cuál es la opción correcta.');
      return;
    }

    try {
      setSending(true);
      setError('');
      await submitQuestionSuggestion({
        university_id: universityId,
        subject_id: subjectId,
        chair_id: chairId,
        unit_name: hasUnit ? unitName.trim() || null : null,
        question_text: questionText.trim(),
        options: cleanOptions,
        correct_option: correctOption,
        author_name: authorName.trim() || 'Anónimo',
        status: 'pending',
      });

      setSuccess(true);
      setTimeout(() => {
        resetForm();
        onClose();
      }, 1200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo enviar la propuesta.';
      setError(message);
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-hide bg-white rounded-3xl shadow-2xl animate-pop-in">
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-white border-b border-gray-100 rounded-t-3xl">
          <div>
            <h2 className="text-lg font-extrabold text-gray-900">Proponer una nueva pregunta</h2>
            <p className="text-xs font-semibold text-gray-500">Tu aporte quedará pendiente de revisión.</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {success ? (
          <div className="px-6 py-10 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-teal-500 mb-4" />
            <p className="text-lg font-bold text-gray-900">¡Gracias!</p>
            <p className="mt-1 text-sm text-gray-500">Tu propuesta fue enviada con éxito.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1.5">Universidad</label>
                <select
                  value={universityId}
                  onChange={(event) => {
                    setUniversityId(event.target.value);
                    setSubjectId('');
                    setChairId('');
                  }}
                  className="w-full rounded-xl border-2 border-gray-200 px-3 py-3 text-sm text-gray-800 outline-none focus:border-teal-500"
                >
                  <option value="">Elegí universidad</option>
                  {universities.map((university) => (
                    <option key={university.id} value={university.id}>{university.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1.5">Materia</label>
                <select
                  value={subjectId}
                  disabled={!universityId}
                  onChange={(event) => {
                    setSubjectId(event.target.value);
                    setChairId('');
                  }}
                  className="w-full rounded-xl border-2 border-gray-200 px-3 py-3 text-sm text-gray-800 outline-none focus:border-teal-500 disabled:bg-gray-100 disabled:text-gray-400"
                >
                  <option value="">Elegí materia</option>
                  {availableSubjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>{subject.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1.5">Parcial</label>
                <select
                  value={chairId}
                  disabled={!subjectId}
                  onChange={(event) => setChairId(event.target.value)}
                  className="w-full rounded-xl border-2 border-gray-200 px-3 py-3 text-sm text-gray-800 outline-none focus:border-teal-500 disabled:bg-gray-100 disabled:text-gray-400"
                >
                  <option value="">Elegí parcial</option>
                  {availableChairs.map((chair) => (
                    <option key={chair.id} value={chair.id}>{chair.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <label className="flex items-center gap-3 text-sm font-bold text-gray-700">
                <input
                  type="checkbox"
                  checked={hasUnit}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setHasUnit(next);
                    if (!next) setUnitName('');
                  }}
                  className="h-4 w-4 accent-teal-600"
                />
                Agregar unidad (opcional)
              </label>
              {hasUnit && (
                <input
                  type="text"
                  value={unitName}
                  onChange={(event) => setUnitName(event.target.value)}
                  placeholder="Ej: Unidad 1, Microbiología"
                  className="mt-3 w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none focus:border-teal-500"
                />
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1.5">Tu nombre o alias</label>
                <input
                  type="text"
                  value={authorName}
                  onChange={(event) => setAuthorName(event.target.value)}
                  placeholder="Anónimo"
                  className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none focus:border-teal-500"
                />
                <p className="mt-1 text-[11px] font-semibold text-gray-400">Opcional · si lo dejas vacío se publicará “Anónimo”.</p>
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
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Opciones de respuesta</label>
              <div className="space-y-2">
                {options.map((option, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCorrectOption(idx)}
                      className={`h-7 w-7 rounded-full border-2 flex items-center justify-center ${correctOption === idx ? 'border-teal-600 bg-teal-600 text-white' : 'border-gray-300 text-transparent hover:border-teal-400'}`}
                      title={correctOption === idx ? 'Opción correcta' : 'Marcar como correcta'}
                    >
                      {correctOption === idx && <CheckCircle2 className="h-4 w-4" />}
                    </button>
                    <input
                      type="text"
                      value={option}
                      onChange={(event) => {
                        const nextOptions = [...options];
                        nextOptions[idx] = event.target.value;
                        setOptions(nextOptions);
                      }}
                      placeholder={`Opción ${String.fromCharCode(65 + idx)}`}
                      className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none focus:border-teal-500"
                    />
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button type="button" onClick={handleClose} className="rounded-xl px-4 py-2 text-sm font-bold text-gray-500 hover:text-gray-800">
                Cancelar
              </button>
              <button type="submit" disabled={sending} className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-sm font-black text-white shadow-lg hover:bg-teal-700 disabled:opacity-50">
                <Send className="h-4 w-4" />
                {sending ? 'Enviando...' : 'Enviar propuesta'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
