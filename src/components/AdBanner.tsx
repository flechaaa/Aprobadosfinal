const SHOW_BANNER = false;

const STORE_URL = 'https://rockndoc.mitiendanube.com/productos/estuche-funda-para-estetoscopio-littmann-rigido-premium/'; // tu link de siempre

export function AdBanner() {
  if (!SHOW_BANNER) {
    return null;
  }

  return (
    <a
      href={STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="relative block overflow-hidden rounded-3xl bg-gradient-to-br from-slate-800 via-slate-900 to-slate-800 shadow-2xl transition-transform hover:-translate-y-0.5"
    >
      {/* Decorative accent */}
      <div className="absolute top-0 right-0 w-40 h-40 bg-teal-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl" />

      <div className="relative p-6 sm:p-8 flex items-center justify-between gap-4">
        <div>
          <span className="inline-block px-3 py-1 text-xs font-semibold uppercase tracking-wider text-teal-400 bg-teal-950/60 border border-teal-800/50 rounded-full mb-3">
            Equipamiento Médico
          </span>
          <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Estuches de Estetoscopio Rígidos
          </h3>
          <p className="mt-1 text-sm text-slate-400 max-w-md">
            Protección de alto impacto para tu instrumental.
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-sm font-semibold text-teal-400">
          Ver tienda &rarr;
        </div>
      </div>
    </a>
  );
}