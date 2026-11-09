import { useEffect, useRef, useState } from 'react';

interface AutocompleteFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}

function normalizeValue(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

export function AutocompleteField({
  label,
  value,
  onChange,
  suggestions,
  placeholder,
  maxLength,
  disabled,
}: AutocompleteFieldProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const normalizedValue = normalizeValue(value);
  const filtered = Array.from(new Set(suggestions))
    .filter((suggestion) => normalizeValue(suggestion) !== normalizedValue)
    .filter((suggestion) => !normalizedValue || normalizeValue(suggestion).includes(normalizedValue))
    .sort((a, b) => a.localeCompare(b, 'es'));

  const showList = open && !disabled && filtered.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1.5">
        {label}
      </label>
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none focus:border-teal-500 disabled:bg-gray-100 disabled:text-gray-400"
      />
      {showList && (
        <ul className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          {filtered.slice(0, 8).map((option) => (
            <li key={option}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(option); setOpen(false); }}
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-teal-50 hover:text-teal-700"
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}