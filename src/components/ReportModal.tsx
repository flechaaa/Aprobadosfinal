import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Check, Edit3 } from 'lucide-react';
import type { Question } from '../types';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  questionId: string;
  question?: Question | null;
}

export function ReportModal({
  isOpen,
  onClose,
  questionId,
  question,
}: ReportModalProps) {
  const [reason, setReason] = useState('Respuesta incorrecta');
  const [details, setDetails] = useState('');
  const [wantToFix, setWantToFix] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Inicialización ultra segura de draft
  const [draft, setDraft] = useState<Question>({
    pregunta: '',
    opciones: ['', '', '', ''],
    correcta: 0,
    explicacion: '',
  });

  // Cada vez que se abre el modal o cambia la pregunta, actualizamos el borrador
  useEffect(() => {
    if (question && isOpen) {
      setDraft({
        pregunta: question.pregunta || '',
        opciones: Array.isArray(question.opciones) && question.opciones.length > 0
          ? [...question.opciones]
          : ['', '', '', ''],
        correcta: typeof question.correcta === 'number' ? question.correcta : 0,
        explicacion: question.explicacion || '',
      });
    }
  }, [question, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);

    const questionText = question?.pregunta || draft.pregunta || 'Pregunta sin texto';

    const { error } = await supabase.from('question_reports').insert([
      {
        question_id: questionId,
        question_text: questionText,
        reason,
        details: details.trim() || null,
        raw_data: question ?? null,
        suggested_fix: wantToFix ? draft : null,
      },
    ]);

    setSending(false);
    if (!error) {
      setSent(true);
      setTimeout(() => {
        setSent(false);
        setDetails('');
        setWantToFix(false);
        onClose();
      }, 1500);
    } else {
      alert('Error al enviar el reporte. Intenta de nuevo.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl bg-gray-900 p-6 border border-gray-800 text-white shadow-2xl my-8 max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <h3 className="text-lg font-bold flex items-center gap-2 text-red-400">
            🚩 Reportar / Corregir Pregunta
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl font-bold"
          >
            ✕
          </button>
        </div>

        {sent ? (
          <div className="p-4 bg-emerald-950/40 border border-emerald-800 text-emerald-300 rounded-xl text-center">
            ✓ ¡Gracias! Tu corrección fue enviada para validación del administrador.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto pr-1">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
                Motivo del reporte
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-xl bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500"
              >
                <option value="Respuesta incorrecta">Respuesta incorrecta</option>
                <option value="Pregunta mal clasificada">Pregunta mal clasificada</option>
                <option value="Pregunta ambigua o confusa">Pregunta ambigua o confusa</option>
                <option value="Contenido duplicado / Inadecuado">Contenido duplicado / Inadecuado</option>
                <option value="Otro">Otro</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
                Comentario o bibliografía (opcional)
              </label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Ej: Según bibliografía oficial, la opción correcta es la C..."
                rows={2}
                className="w-full rounded-xl bg-gray-800 border border-gray-700 p-2.5 text-sm text-white focus:outline-none focus:border-red-500"
              />
            </div>

            {/* Toggle para proponer corrección */}
            <div className="pt-2 border-t border-gray-800">
              <button
                type="button"
                onClick={() => setWantToFix(!wantToFix)}
                className={`w-full flex items-center justify-between p-3 rounded-xl border transition ${
                  wantToFix
                    ? 'border-teal-500/50 bg-teal-950/30 text-teal-300'
                    : 'border-gray-700 bg-gray-800/40 text-gray-400 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2 text-xs font-bold">
                  <Edit3 className="w-4 h-4" />
                  ¿Querés dejar la pregunta corregida vos mismo?
                </span>
                <span className="text-xs underline">{wantToFix ? 'Ocultar' : 'Corregir'}</span>
              </button>
            </div>

            {/* Formulario de corrección propuesto por el usuario */}
            {wantToFix && (
              <div className="p-3.5 bg-gray-800/60 rounded-xl border border-gray-700 space-y-3 animate-fade-in">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-gray-400 mb-1">
                    Enunciado corregido:
                  </label>
                  <textarea
                    value={draft.pregunta}
                    onChange={(e) => setDraft({ ...draft, pregunta: e.target.value })}
                    rows={2}
                    className="w-full rounded-lg bg-gray-900 border border-gray-700 p-2 text-xs text-white focus:outline-none focus:border-teal-400"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-gray-400 mb-1">
                    Opciones (tocá el círculo para marcar la correcta):
                  </label>
                  <div className="space-y-1.5">
                    {Array.isArray(draft?.opciones) &&
                      draft.opciones.map((opt, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setDraft({ ...draft, correcta: idx })}
                            className={`w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0 transition ${
                              draft.correcta === idx
                                ? 'bg-teal-500 border-teal-400 text-white'
                                : 'border-gray-600 bg-gray-900 text-transparent hover:border-teal-400'
                            }`}
                          >
                            {draft.correcta === idx && <Check className="w-3.5 h-3.5 text-white" />}
                          </button>
                          <input
                            type="text"
                            value={opt}
                            onChange={(e) => {
                              const newOpts = [...(draft.opciones || [])];
                              newOpts[idx] = e.target.value;
                              setDraft({ ...draft, opciones: newOpts });
                            }}
                            className={`flex-1 rounded-lg bg-gray-900 border px-2.5 py-1.5 text-xs text-white focus:outline-none ${
                              draft.correcta === idx ? 'border-teal-500' : 'border-gray-700'
                            }`}
                          />
                        </div>
                      ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-gray-400 mb-1">
                    Explicación / Justificación corregida:
                  </label>
                  <textarea
                    value={draft.explicacion}
                    onChange={(e) => setDraft({ ...draft, explicacion: e.target.value })}
                    rows={2}
                    className="w-full rounded-lg bg-gray-900 border border-gray-700 p-2 text-xs text-white focus:outline-none focus:border-teal-400"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-800 flex-shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs text-gray-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={sending}
                className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-bold transition disabled:opacity-50"
              >
                {sending ? 'Enviando...' : wantToFix ? 'Enviar reporte con corrección' : 'Enviar reporte'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default ReportModal;