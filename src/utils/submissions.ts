import { supabase } from '@/lib/supabase';
import { extractTextFromFileObject } from '@/utils/fileParser';

export type MaterialType = 'apunte' | 'preguntero_choice' | 'pregunta_respuesta' | 'texto';

export interface SubmissionInput {
  university: string;
  subject: string;
  chair: string;
  unit?: string;
  sourceNotes?: string;
  materialType: MaterialType;
  file: File;
  onProgress?: (percent: number) => void;
}

export interface SubmissionUploadResult {
  submissionId?: string;
  fileUrl: string;
  fileType: string;
  file: File;
}

const MAX_FILE_SIZE = 150 * 1024 * 1024;
const SUPABASE_SIZE_LIMIT = 45 * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'text/plain',
];
const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.png', '.jpg', '.jpeg', '.txt'];

export function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE) return 'El archivo supera el tamaño máximo permitido de 150 MB.';
  const extension = '.' + file.name.split('.').pop()?.toLowerCase();
  if (!ALLOWED_MIME_TYPES.includes(file.type) && !ALLOWED_EXTENSIONS.includes(extension)) {
    return 'Formato no soportado. Subí un archivo PDF, PPTX, DOCX, TXT o imagen.';
  }
  return null;
}

async function uploadSingleSubmission(input: SubmissionInput): Promise<SubmissionUploadResult> {
  let fileToUpload: File | Blob = input.file;
  let fileType = input.file.type;
  let fileExt = input.file.name.split('.').pop()?.toLowerCase() || 'dat';

  if (input.file.size > SUPABASE_SIZE_LIMIT) {
    try {
      const extractedText = await extractTextFromFileObject(input.file);
      if (!extractedText || extractedText.trim().length < 20) {
        throw new Error('El archivo supera los 50 MB y no tiene texto legible.');
      }
      fileToUpload = new Blob([extractedText], { type: 'text/plain;charset=utf-8' });
      fileType = 'text/plain';
      fileExt = 'txt';
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Error al procesar el archivo pesado.');
    }
  }

  const filePath = `submissions/${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
  const { error: uploadError } = await supabase.storage
    .from('study-materials')
    .upload(filePath, fileToUpload, { cacheControl: '3600', upsert: false });

  if (uploadError) {
    console.error('Detalle error Supabase Storage:', uploadError);
    throw new Error(`Error de subida: ${uploadError.message}`);
  }

  const { data: urlData } = supabase.storage.from('study-materials').getPublicUrl(filePath);
  const { data: sessionData } = await supabase.auth.getSession();
  const submissionPayload = {
    university: input.university.trim(),
    subject: input.subject.trim(),
    chair: input.chair.trim(),
    source_notes: input.sourceNotes?.trim() || null,
    material_type: input.materialType,
    file_url: urlData.publicUrl,
    file_type: fileType || `application/${fileExt}`,
    processed: false,
    processing_status: 'pendiente_procesamiento',
    storage_path: filePath,
    user_id: sessionData.session?.user.id ?? null,
    ...(input.unit?.trim() ? { unit: input.unit.trim() } : {}),
  };

  const { data: insertedSubmission, error: insertError } = await supabase
    .from('submissions')
    .insert(submissionPayload)
    .select('id')
    .single();
  if (!insertError) {
    return {
      submissionId: insertedSubmission?.id,
      fileUrl: urlData.publicUrl,
      fileType: fileType || `application/${fileExt}`,
      file: input.file,
    };
  }

  console.error('Detalle error base de datos:', {
    code: insertError.code,
    message: insertError.message,
    details: insertError.details,
    hint: insertError.hint,
    payload: { ...submissionPayload, file_url: '[omitida]' },
  });
  await supabase.storage.from('study-materials').remove([filePath]);

  if (insertError.code === '42501') {
    throw new Error('Supabase rechazó la inserción por RLS. Verificá submissions_insert_public para anon/authenticated.');
  }
  if (insertError.code === 'PGRST204' || insertError.code === '42703') {
    throw new Error('La tabla submissions no tiene una columna enviada. Aplicá todas las migraciones, incluida la de unit.');
  }
  if (insertError.code === '23514') {
    throw new Error(`La base de datos rechazó un campo del envío: ${insertError.message}`);
  }
  if (insertError.code === '23502') {
    throw new Error(`Falta un campo obligatorio en submissions: ${insertError.message}`);
  }
  throw new Error(`No se pudo registrar el envío en la base de datos: ${insertError.message}`);
}

export async function uploadSubmissions(input: Omit<SubmissionInput, 'file'> & { files: File[] }): Promise<SubmissionUploadResult[]> {
  const results: SubmissionUploadResult[] = [];
  for (const file of input.files) {
    results.push(await uploadSingleSubmission({ ...input, file }));
  }
  return results;
}

export async function uploadSubmission(input: SubmissionInput): Promise<void> {
  await uploadSingleSubmission(input);
}

export async function submitTextSubmission(input: Omit<SubmissionInput, 'file'> & { text: string }): Promise<void> {
  const text = input.text.trim();
  if (text.length < 20) throw new Error('Pegá al menos 20 caracteres de texto para enviar.');

  const { data: sessionData } = await supabase.auth.getSession();
  const { error } = await supabase.from('submissions').insert({
    university: input.university.trim(),
    subject: input.subject.trim(),
    chair: input.chair.trim(),
    unit: input.unit?.trim() || null,
    source_notes: input.sourceNotes?.trim() || null,
    material_type: 'texto',
    file_url: null,
    file_type: 'text/plain',
    processed: false,
    processing_status: 'pendiente_procesamiento',
    processed_text: text,
    storage_path: null,
    user_id: sessionData.session?.user.id ?? null,
  });

  if (error) throw new Error(`No se pudo registrar el texto: ${error.message}`);
}

export async function deleteSubmissionFile(fileUrl: string): Promise<void> {
  const url = new URL(fileUrl);
  const pathParts = url.pathname.split('study-materials/');
  if (pathParts.length > 1) {
    const { error } = await supabase.storage.from('study-materials').remove([decodeURIComponent(pathParts[1])]);
    if (error) throw new Error(`No se pudo eliminar el archivo original: ${error.message}`);
  }
}

export async function deleteSubmission(submissionId: string, fileUrl: string | null, storagePath?: string | null, adminPassword?: string): Promise<void> {
  if (adminPassword) {
    const resolvedPath = storagePath ?? resolveStoragePath(fileUrl);
    const { error } = await supabase.rpc('admin_delete_submission', {
      p_submission_id: submissionId,
      p_storage_path: resolvedPath,
      p_admin_password: adminPassword,
    });
    if (!error) return;
    console.warn('No se pudo eliminar mediante RPC administrativa; se intenta el flujo tolerante:', error);
  }

  try {
    const path = storagePath ?? resolveStoragePath(fileUrl);
    if (path) {
      const { error: storageError } = await supabase.storage.from('study-materials').remove([path]);
      if (storageError) console.warn('No se pudo borrar el archivo de Storage; se continúa con la fila:', storageError);
    }
  } catch (storageError) {
    console.warn('No se pudo borrar el archivo físico de Storage:', storageError);
  }

  const directDelete = await supabase.from('submissions').delete().eq('id', submissionId);
  let dbError = directDelete.error;
  if (dbError && adminPassword) {
    const rpcResult = await supabase.rpc('admin_delete_submission', {
      p_submission_id: submissionId,
      p_admin_password: adminPassword,
    });
    dbError = rpcResult.error;
  }
  if (dbError) {
    console.error('Error al eliminar el registro:', dbError);
    throw new Error(`No se pudo eliminar el envío de la base de datos: ${dbError.message}`);
  }
}

function resolveStoragePath(fileUrl: string | null): string {
  if (!fileUrl) return '';
  try {
    const pathParts = new URL(fileUrl).pathname.split('study-materials/');
    return pathParts.length > 1 ? decodeURIComponent(pathParts[1]) : '';
  } catch {
    return '';
  }
}
