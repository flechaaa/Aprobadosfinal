ALTER TABLE IF EXISTS public.submissions
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'pendiente_procesamiento'
  CHECK (processing_status IN ('pendiente_procesamiento', 'procesando', 'procesado', 'error'));

UPDATE public.submissions
SET processing_status = CASE
  WHEN processed = true THEN 'procesado'
  ELSE 'pendiente_procesamiento'
END
WHERE processing_status IS NULL OR processing_status = 'pendiente_procesamiento';

CREATE INDEX IF NOT EXISTS submissions_processing_status_idx
  ON public.submissions(processing_status);
