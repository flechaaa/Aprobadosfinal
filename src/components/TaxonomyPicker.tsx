import { useMemo, useState } from 'react';
import { ChevronDown, Plus, Send, CheckCircle2 } from 'lucide-react';
import { submitSuggestion } from '@/utils/taxonomy';
import type { Chair, Subject, University } from '@/types';

export interface TaxonomySelection {
  universityId: string;
  subjectId: string;
  chairId: string;
}

interface TaxonomyPickerProps {
  universities: University[];
  subjects: Subject[];
  chairs: Chair[];
  value: TaxonomySelection;
  onChange: (value: TaxonomySelection) => void;
}

type ProposalLevel = 'university' | 'subject' | 'chair';

export function TaxonomyPicker({ universities, subjects, chairs, value, onChange }: TaxonomyPickerProps) {
  const [proposalLevel, setProposalLevel] = useState<ProposalLevel | null>(null);
  const [proposalName, setProposalName] = useState('');
  const [proposalSent, setProposalSent] = useState(false);
  const [proposalError, setProposalError] = useState('');

  const availableSubjects = useMemo(
    () => subjects.filter((subject) => subject.university_id === value.universityId),
    [subjects, value.universityId],
  );
  const availableChairs = useMemo(
    () => chairs.filter((chair) => chair.subject_id === value.subjectId),
    [chairs, value.subjectId],
  );

  const openProposal = (level: ProposalLevel) => {
    setProposalLevel(level);
    setProposalName('');
    setProposalSent(false);
    setProposalError('');
  };

  const sendProposal = async () => {
    if (!proposalLevel || proposalName.trim().length < 2) return;
    setProposalError('');
    try {
      await submitSuggestion({
        level: proposalLevel,
        proposedName: proposalName,
        universityId: proposalLevel === 'subject' ? value.universityId : undefined,
        subjectId: proposalLevel === 'chair' ? value.subjectId : undefined,
      });
      setProposalSent(true);
      setProposalName('');
    } catch {
      setProposalError('No pudimos enviar la propuesta. Intentá nuevamente.');
    }
  };

  const renderProposal = (level: ProposalLevel) => {
    if (proposalLevel !== level) {
      return (
        <button type="button" onClick={() => openProposal(level)} className="mt-2 flex items-center gap-1.5 text-xs font-bold text-teal-700 hover:text-teal-900">
          <Plus className="h-3.5 w-3.5" /> Proponer nueva
        </button>
      );
    }

    return (
      <div className="mt-2 rounded-xl bg-teal-50 p-3">
        <div className="flex gap-2">
          <input
            value={proposalName}
            onChange={(event) => setProposalName(event.target.value)}
            placeholder="Escribí el nombre"
            maxLength={120}
            className="min-w-0 flex-1 rounded-lg border border-teal-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-teal-500"
          />
          <button type="button" onClick={sendProposal} disabled={proposalName.trim().length < 2} className="rounded-lg bg-teal-600 px-3 text-white disabled:cursor-not-allowed disabled:opacity-40">
            <Send className="h-4 w-4" />
          </button>
        </div>
        {proposalSent && <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-teal-700"><CheckCircle2 className="h-3.5 w-3.5" /> Propuesta enviada para revisión.</p>}
        {proposalError && <p className="mt-2 text-xs font-semibold text-red-600">{proposalError}</p>}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">Universidad</label>
        <div className="relative">
          <select
            value={value.universityId}
            onChange={(event) => onChange({ universityId: event.target.value, subjectId: '', chairId: '' })}
            className="w-full appearance-none rounded-xl border-2 border-gray-200 bg-white px-4 py-3 pr-10 text-sm font-medium text-gray-800 outline-none transition-colors focus:border-teal-500"
          >
            <option value="">Elegí tu universidad</option>
            {universities.map((university) => <option key={university.id} value={university.id}>{university.name}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-gray-400" />
        </div>
        {renderProposal('university')}
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">Materia</label>
        <div className="relative">
          <select
            value={value.subjectId}
            disabled={!value.universityId}
            onChange={(event) => onChange({ ...value, subjectId: event.target.value, chairId: '' })}
            className="w-full appearance-none rounded-xl border-2 border-gray-200 bg-white px-4 py-3 pr-10 text-sm font-medium text-gray-800 outline-none transition-colors focus:border-teal-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          >
            <option value="">Elegí una materia</option>
            {availableSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-gray-400" />
        </div>
        {renderProposal('subject')}
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">Cátedra</label>
        <div className="relative">
          <select
            value={value.chairId}
            disabled={!value.subjectId}
            onChange={(event) => onChange({ ...value, chairId: event.target.value })}
            className="w-full appearance-none rounded-xl border-2 border-gray-200 bg-white px-4 py-3 pr-10 text-sm font-medium text-gray-800 outline-none transition-colors focus:border-teal-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          >
            <option value="">Elegí una cátedra</option>
            <option value="all">Todas</option>
            {availableChairs.map((chair) => <option key={chair.id} value={chair.id}>{chair.name}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-gray-400" />
        </div>
        {renderProposal('chair')}
      </div>
    </div>
  );
}
