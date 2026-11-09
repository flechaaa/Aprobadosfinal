# Aprobados - contexto tecnico para Claude

Fecha de referencia: 2026-09-30.

Este documento resume la arquitectura actual del proyecto. Las rutas y bloques indicados apuntan al codigo fuente real. El flujo activo usa React/Vite en `src/`, Supabase en `supabase/` y migraciones SQL ordenadas por timestamp.

## 1. Mapa de arquitectura

```text
src/App.tsx
  -> StartScreen.tsx
      -> CollaborateModal.tsx / envio de materiales
      -> AdminPanel.tsx / moderacion
  -> GameScreen.tsx
  -> ResultsScreen.tsx

src/utils/submissions.ts
  -> extractTextFromFileObject() en src/utils/fileParser.ts
  -> Storage bucket study-materials
  -> tabla public.submissions
  -> webhook de Supabase

supabase/functions/process-submission/index.ts
  -> lee processed_text
  -> divide texto en chunks
  -> Groq primero, Gemini como fallback
  -> crea public.question_suggestions
  -> actualiza processing_status

src/components/AdminPanel.tsx
  -> carga submissions pendientes/error
  -> procesa/reintenta material
  -> edita preguntas
  -> RPCs admin para asegurar taxonomia, insertar preguntas y cambiar estados
```

## 2. Tablas y esquema de Supabase

### 2.1 Taxonomia

Origen principal: `supabase/migrations/20260910022149_create_taxonomy_and_moderation.sql` y normalizacion posterior.

```sql
CREATE TABLE public.universities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid NOT NULL REFERENCES public.universities(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.chairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.taxonomy_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level text NOT NULL CHECK (level IN ('university', 'subject', 'chair')),
  proposed_name text NOT NULL,
  university_id uuid REFERENCES public.universities(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
```

Las migraciones `20260914000000_normalize_taxonomy_names.sql` y `20260914000001_cleanup_existing_taxonomy_variants.sql` agregan `unaccent`, `normalize_taxonomy_key()` e indices unicos normalizados.

### 2.2 Submissions / materiales

Origen: `supabase/migrations/20260911014624_create_submissions_and_storage.sql`, `20260918000000_add_submission_processing_status.sql`, `20260918000002_complete_submissions_schema.sql`, `20260930000002_harden_submission_processing.sql`.

```sql
CREATE TABLE public.submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  university text NOT NULL,
  subject text NOT NULL,
  chair text NOT NULL,
  source_notes text,
  material_type text NOT NULL,
  file_url text,
  file_type text,
  processed boolean NOT NULL DEFAULT false,

  -- Estado de moderacion del material.
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processed', 'dismissed')),

  -- Estado del procesamiento IA.
  processing_status text NOT NULL DEFAULT 'pendiente_procesamiento'
    CHECK (processing_status IN (
      'pendiente_procesamiento',
      'procesando',
      'procesado',
      'error',
      'error_tokens'
    )),

  processing_error text,
  processing_attempts integer NOT NULL DEFAULT 0,
  processing_started_at timestamptz,
  processed_at timestamptz,
  processed_text text,
  extracted_questions jsonb,
  processed_question jsonb,
  storage_path text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  unit text
);
```

Estados esperados:

```text
status:
  pending    -> material aun en cola/revision
  processed  -> material cerrado por administracion
  dismissed  -> material eliminado/desestimado

processing_status:
  pendiente_procesamiento -> nunca procesado o reencolado
  procesando              -> intento en curso
  procesado               -> IA genero resultado
  error                   -> error general
  error_tokens            -> cuota, rate limit, tokens o contexto excedido
```

Regla importante: un error IA no elimina `submissions`, `storage_path`, `file_url` ni `processed_text`. El administrador puede reintentar.

### 2.3 Storage

Bucket publico `study-materials`, creado en `20260911014624_create_submissions_and_storage.sql`.

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('study-materials', 'study-materials', true)
ON CONFLICT (id) DO NOTHING;

-- Se permite lectura publica y upload publico.
-- La eliminacion administrativa pasa por admin_delete_submission().
```

### 2.4 Questions

La tabla conserva columnas legacy y columnas API actuales. Migraciones relevantes: `20260911022702_create_questions_table_and_admin_functions.sql` y `20260915000003_normalize_questions_compatibility.sql`.

```text
Legacy: pregunta, opciones, correcta, explicacion
Actual: question, options, correct_option, explanation
Relaciones: submission_id, subject_id, chair_id
Metadata: university, subject, chair, difficulty, active, is_active
```

RLS permite lectura publica; las inserciones administrativas deben pasar por RPC `SECURITY DEFINER`.

### 2.5 Question suggestions

Origen: `supabase/migrations/20260915000000_create_question_suggestions.sql` y `20260918000007_link_question_suggestions_sources.sql`.

```sql
CREATE TABLE public.question_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid NOT NULL REFERENCES public.universities(id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  chair_id uuid NOT NULL REFERENCES public.chairs(id) ON DELETE RESTRICT,
  unit_name text,
  question_text text NOT NULL,
  options text[] NOT NULL,
  correct_option integer NOT NULL CHECK (correct_option >= 0),
  explanation text,
  difficulty text NOT NULL DEFAULT 'media'
    CHECK (difficulty IN ('facil', 'media', 'dificil')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  author_name text,
  source_submission_id uuid REFERENCES public.submissions(id) ON DELETE SET NULL,
  source_file_url text,
  source_storage_path text
);
```

### 2.6 User subscriptions

Origen: `supabase/migrations/20260912000000_create_user_subscriptions_and_session_id.sql`.

```sql
CREATE TABLE public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text,
  endpoint text UNIQUE NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

`src/utils/notifications.ts` registra suscripciones Web Push y `supabase/functions/notify-approved-submission/index.ts` las usa para notificar materiales aprobados.

### 2.7 Rankings

Origen: `20260913000000_create_rankings_public_table.sql` y `20260918000005_add_rankings_dimensions_and_query.sql`.

```text
rankings:
  id, chair_id, player_name, score, created_at
  user_id, university_id, subject_id, unit
  correct_answers, questions_answered, avatar_url
```

La funcion SQL `get_rankings(scope, university_id, subject_id, unit)` agrega rankings globales, por universidad, materia o unidad.

### 2.8 Profiles y permisos

`profiles` contiene `id` y `role` (`member` o `admin`) para la taxonomia moderna. El flujo legacy del panel usa una contraseña administrativa validada dentro de RPCs `SECURITY DEFINER`. No confiar en updates directos desde el navegador para mutaciones admin.

## 3. Carga y extraccion universal de archivos

Archivo: `src/utils/submissions.ts`.

Formatos aceptados:

```ts
const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.png', '.jpg', '.jpeg', '.txt'];
```

Flujo resumido:

```ts
async function uploadSingleSubmission(input: SubmissionInput) {
  const processedText = await extractTextFromFileObject(input.file);
  const filePath = `submissions/${Date.now()}_${random}.${extension}`;

  await supabase.storage.from('study-materials').upload(filePath, input.file);

  await supabase.from('submissions').insert({
    university: input.university.trim(),
    subject: input.subject.trim(),
    chair: input.chair.trim(),
    material_type: input.materialType,
    file_url: publicStorageUrl,
    file_type: input.file.type,
    storage_path: filePath,
    processed: false,
    status: 'pending',
    processing_status: 'pendiente_procesamiento',
    processed_text: processedText,
    user_id: currentUserIdOrNull,
  });
}
```

El archivo original siempre se conserva en Storage. Para archivos muy grandes, el proyecto extrae texto antes y puede subir una copia TXT debido al limite de Storage.

Archivo: `src/utils/fileParser.ts`.

```ts
import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import { createWorker } from 'tesseract.js';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export async function parsePptx(buffer: ArrayBuffer): Promise<string>;
export async function parseDocx(buffer: ArrayBuffer): Promise<string>;
export async function parseImage(image: Blob): Promise<string>;
export async function parsePdf(buffer: ArrayBuffer): Promise<string>;
```

Comportamiento de `parsePdf`:

```text
1. PDF.js extrae texto nativo de cada pagina.
2. Si una pagina tiene menos de 40 caracteres o contiene operadores de imagen,
   se agrega a pagesForOcr.
3. PDF.js renderiza la pagina a canvas a escala 2.
4. Tesseract.js crea worker spa y reconoce el canvas.
5. Se concatena:
   --- Pagina N --- texto nativo
   --- OCR pagina N --- texto reconocido
```

`extractTextFromFileObject()` usa:

```text
TXT  -> file.text()
PNG/JPG -> parseImage() con Tesseract spa
PDF -> parsePdf() con PDF.js + OCR fallback
DOCX -> JSZip + word/document.xml
PPTX -> JSZip + ppt/slides/*.xml
```

## 4. App y navegacion frontend

Archivo: `src/App.tsx`.

```ts
type Screen = 'start' | 'game' | 'results' | 'admin';
```

No hay router externo. `StartScreen` ejecuta `onOpenAdmin={() => setScreen('admin')}` y App renderiza:

```tsx
{screen === 'admin' && (
  <AdminPanel
    onBack={() => {
      void fetchTaxonomy();
      void fetchQuestionCount();
      setScreen('start');
    }}
  />
)}
```

El juego carga taxonomia desde `src/utils/taxonomy.ts` y preguntas desde `src/utils/game.ts`.

## 5. Panel de administracion

Archivo principal: `src/components/AdminPanel.tsx`.

Tabs:

```ts
type Tab = 'taxonomy' | 'materials' | 'reports' | 'questions';
```

El panel:

```text
1. Pide password administrativa.
2. Carga propuestas de taxonomia.
3. En materials carga submissions pending con processing_status:
   pendiente_procesamiento, procesando, error o error_tokens.
4. Permite seleccionar material y ver texto/OCR o preview.
5. Procesar ahora / Reintentar procesamiento:
   - obtiene processed_text o vuelve a extraer file_url
   - llama extractQuestionsFromFile()
   - persiste preguntas y estado mediante RPC
6. Edita preguntas generadas.
7. Aprobar individual usa admin_insert_question_v2().
8. Aprobar todas itera pregunta por pregunta con try/catch individual.
9. Solo marca la submission como processed cuando todas las preguntas fueron aprobadas.
```

Estados visibles:

```ts
const processingStatusLabels = {
  pendiente_procesamiento: 'Pendiente',
  procesando: 'Procesando',
  procesado: 'Procesado',
  error: 'Error',
  error_tokens: 'Error de tokens',
};
```

La cola se carga desde `src/utils/moderation.ts`:

```ts
const { data, error } = await supabase
  .from('submissions')
  .select('*')
  .in('status', ['pending'])
  .in('processing_status', [
    'pendiente_procesamiento',
    'procesando',
    'error',
    'error_tokens',
  ])
  .order('created_at', { ascending: false });
```

## 6. Extraccion de preguntas con IA

Archivo: `src/utils/gemini.ts`.

```text
extractQuestionsFromFile(textContent, onProgress, materialType)
  -> selecciona prompt extraction o generation
  -> divide texto en chunks
  -> intenta Groq por chunk
  -> si falla o devuelve vacio, intenta Gemini
  -> concatena preguntas
  -> devuelve error parcial si algun chunk fallo
```

El backend repite el mismo patron en `supabase/functions/process-submission/index.ts`, que es el procesador automatico principal.

## 7. Edge Function principal: process-submission

Archivo: `supabase/functions/process-submission/index.ts`.

Responsabilidad: recibe el webhook de INSERT de `submissions`, procesa texto y genera `question_suggestions`.

Flujo simplificado:

```ts
Deno.serve(async (req) => {
  validar header x-webhook-secret;
  const submission = (await req.json()).record;

  await supabase.from('submissions').update({
    status: 'pending',
    processed: false,
    processing_status: 'procesando',
    processing_error: null,
    processing_attempts: (submission.processing_attempts ?? 0) + 1,
    processing_started_at: new Date().toISOString(),
  }).eq('id', submission.id);

  const text = submission.processed_text;
  const chunks = splitIntoChunks(text);
  const extracted = [];

  for (const chunk of chunks) {
    try Groq;
    if vacio try Gemini;
    si error de cuota/token marcar tokenLimitError;
    extracted.push(...chunkQuestions);
  }

  if (tokenLimitError) throw new Error('Procesamiento pendiente por limites IA');
  if (extracted.length === 0) throw new Error('No se pudieron extraer preguntas');

  ensureTaxonomy(university, subject, chair);
  insertar question_suggestions con source_submission_id y source_file_url;

  await supabase.from('submissions').update({
    processing_status: 'procesado',
    processed: true,
    processed_at: new Date().toISOString(),
    processing_error: null,
  }).eq('id', submission.id);
});
```

Manejo de error:

```ts
catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await supabase.from('submissions').update({
    status: 'pending',
    processed: false,
    processing_status: isTokenOrQuotaError(message) ? 'error_tokens' : 'error',
    processing_error: message,
  }).eq('id', submissionId);
}
```

La funcion usa:

```text
GROQ_API_KEY
GEMINI_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
WEBHOOK_SECRET
```

## 8. Edge Function notify-approved-submission

Archivo: `supabase/functions/notify-approved-submission/index.ts`.

Es una copia compatible del procesador de material que conserva el mismo contrato de estados y genera sugerencias. En el flujo de notificaciones tambien se usa para enviar mensajes Push mediante la tabla `user_subscriptions`.

Puntos importantes:

```text
- Validar x-webhook-secret.
- No usar estados legacy failed, processing o ready_for_review.
- En error mantener status pending.
- Usar processing_status error/error_tokens.
- No eliminar submissions ni Storage por errores de IA.
```

## 9. RPCs administrativas de procesamiento

Origen principal: `supabase/migrations/20260930000002_harden_submission_processing.sql`.

### admin_retry_submission_processing

```sql
CREATE OR REPLACE FUNCTION public.admin_retry_submission_processing(
  p_submission_id uuid,
  p_admin_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  password_hash constant text := '$2a$06$TR.OpHcmQ4L/Zr1Z3172VesiHIh349LZeOSIcxdmLrdyc05YASRj2';
BEGIN
  IF p_admin_password IS NULL
     OR length(p_admin_password) > 128
     OR extensions.crypt(p_admin_password, password_hash) <> password_hash THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.submissions
  SET status = 'pending',
      processed = false,
      processing_status = 'pendiente_procesamiento',
      processing_error = NULL,
      processing_started_at = NULL
  WHERE id = p_submission_id;
END;
$$;
```

### admin_store_submission_processing_result

```sql
CREATE OR REPLACE FUNCTION public.admin_store_submission_processing_result(
  p_submission_id uuid,
  p_extracted_questions jsonb,
  p_processed_text text,
  p_processing_status text,
  p_processing_error text,
  p_admin_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  password_hash constant text := '$2a$06$TR.OpHcmQ4L/Zr1Z3172VesiHIh349LZeOSIcxdmLrdyc05YASRj2';
BEGIN
  IF p_admin_password IS NULL
     OR length(p_admin_password) > 128
     OR extensions.crypt(p_admin_password, password_hash) <> password_hash THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_processing_status NOT IN (
    'procesado', 'error', 'error_tokens', 'pendiente_procesamiento'
  ) THEN
    RAISE EXCEPTION 'Invalid processing status';
  END IF;

  UPDATE public.submissions
  SET extracted_questions = COALESCE(p_extracted_questions, extracted_questions),
      processed_text = COALESCE(NULLIF(p_processed_text, ''), processed_text),
      processing_status = p_processing_status,
      processing_error = NULLIF(p_processing_error, ''),
      processed = p_processing_status = 'procesado',
      processed_at = CASE
        WHEN p_processing_status = 'procesado' THEN now()
        ELSE processed_at
      END
  WHERE id = p_submission_id;
END;
$$;
```

### RPCs administrativas adicionales

Archivo: `supabase/migrations/20260930000003_admin_moderation_mutations.sql`.

```text
admin_ensure_taxonomy()
  Crea o recupera university, subject y chair validando password.

admin_insert_question_v2()
  Inserta una pregunta en columnas legacy y actuales validando password.

admin_approve_question_suggestion()
  Inserta question y cambia question_suggestions.status a approved.

admin_reject_question_suggestion()
  Cambia question_suggestions.status a rejected.

admin_mark_submission_processed()
  Cambia status a processed, processed=true y processing_status=procesado.

admin_delete_submission()
  Borra Storage y submission, solo mediante password administrativa.
```

Todas son `SECURITY DEFINER` y se conceden a `anon, authenticated`; la autorizacion real ocurre comparando la password dentro de la funcion. El frontend no debe insertar/actualizar directamente tablas protegidas.

## 10. Funciones frontend de RPC

Archivo: `src/utils/moderation.ts`.

```ts
export async function retrySubmissionProcessing(
  submissionId: string,
  adminPassword: string,
) {
  const { error } = await supabase.rpc('admin_retry_submission_processing', {
    p_submission_id: submissionId,
    p_admin_password: adminPassword,
  });
  if (error) throw new Error(error.message);
}

export async function storeSubmissionProcessingResult(input: {
  submissionId: string;
  extractedQuestions?: Question[];
  processedText?: string;
  processingStatus: 'procesado' | 'error' | 'error_tokens' | 'pendiente_procesamiento';
  processingError?: string;
  adminPassword: string;
}) {
  const { error } = await supabase.rpc('admin_store_submission_processing_result', {
    p_submission_id: input.submissionId,
    p_extracted_questions: input.extractedQuestions ?? null,
    p_processed_text: input.processedText ?? null,
    p_processing_status: input.processingStatus,
    p_processing_error: input.processingError ?? null,
    p_admin_password: input.adminPassword,
  });
  if (error) throw new Error(error.message);
}
```

Aprobacion masiva:

```text
- Filtra questions no aprobadas.
- Ejecuta insertQuestion() por pregunta.
- Cada iteracion tiene try/catch.
- console.error('[admin] Fallo ...') para cada error.
- Solo marca submission procesado si no quedaron fallos.
- Una falla de push notification no bloquea aprobaciones ya insertadas.
```

## 11. Seguridad y errores conocidos

- No poner service role key en el frontend.
- No hacer DML directo sobre `questions` o `question_suggestions` desde el navegador.
- Aplicar las migraciones `20260930000002_harden_submission_processing.sql` y `20260930000003_admin_moderation_mutations.sql` antes de probar el panel.
- Desplegar las Edge Functions despues de aplicar migraciones.
- `src/index.ts` contiene una implementacion legacy de Edge Function con imports `npm:` y `Deno` que el typecheck de Vite intenta leer; no es el entrypoint React principal.
- `.bolt/Supabase/Functions/Process Material/Index.ts` es otra implementacion legacy. Fue alineada para no escribir estados invalidos, pero la funcion activa recomendada es `supabase/functions/process-submission/index.ts`.
- `Tesseract.js` necesita descargar el worker y el idioma `spa` la primera vez.
- `fileParser.ts` usa PDF.js y canvas; el OCR se ejecuta en el cliente al cargar o reprocesar PDF/imagen.

## 12. Archivos clave para abrir primero

```text
src/App.tsx
src/components/AdminPanel.tsx
src/components/CollaborateModal.tsx
src/utils/submissions.ts
src/utils/fileParser.ts
src/utils/moderation.ts
src/utils/questionSuggestions.ts
src/utils/gemini.ts
src/utils/taxonomy.ts
src/utils/notifications.ts
src/types.ts
supabase/functions/process-submission/index.ts
supabase/functions/notify-approved-submission/index.ts
supabase/migrations/20260930000002_harden_submission_processing.sql
supabase/migrations/20260930000003_admin_moderation_mutations.sql
```
