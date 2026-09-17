import { supabase } from '@/lib/supabase';
import { extractTextFromFileObject } from '@/utils/fileParser';

export type MaterialType = 'apunte' | 'preguntero_choice' | 'pregunta_respuesta';

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

// Límite en el modal: permite seleccionar archivos de hasta 150 MB
const MAX_FILE_SIZE = 150 * 1024 * 1024;

// Umbral de Supabase (45 MB de seguridad para no chocar con los 50 MB)
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
  if (file.size > MAX_FILE_SIZE) {
    return 'El archivo supera el tamaño máximo permitido de 150 MB.';
  }

  const extension = '.' + file.name.split('.').pop()?.toLowerCase();
  const isValidType =
    ALLOWED_MIME_TYPES.includes(file.type) ||
    ALLOWED_EXTENSIONS.includes(extension);

  if (!isValidType) {
    return 'Formato no soportado. Subí un archivo PDF, PPTX, DOCX, TXT o imagen.';
  }

  return null;
}

export async function uploadSubmission(input: SubmissionInput): Promise<void> {
  let fileToUpload: File | Blob = input.file;
  let fileType = input.file.type;
  let fileExt = input.file.name.split('.').pop()?.toLowerCase() || 'dat';

  // Si el archivo supera los 45 MB, extraemos el texto en el cliente para no exceder Supabase
  if (input.file.size > SUPABASE_SIZE_LIMIT) {
    try {
      const extractedText = await extractTextFromFileObject(input.file);
      if (!extractedText || extractedText.trim().length < 20) {
        throw new Error('El archivo supera los 50 MB y no tiene texto legible (puede ser un escaneo de solo imágenes).');
      }

      // Convertimos el texto plano a un archivo .txt liviano
      fileToUpload = new Blob([extractedText], { type: 'text/plain;charset=utf-8' });
      fileType = 'text/plain';
      fileExt = 'txt';
    } catch (err: any) {
      throw new Error(err.message || 'Error al procesar el archivo pesado.');
    }
  }

  const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
  const filePath = `submissions/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('study-materials')
    .upload(filePath, fileToUpload, {
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError) {
    console.error('Detalle error Supabase Storage:', uploadError);
    throw new Error(`Error de subida: ${uploadError.message}`);
  }

  const { data: urlData } = supabase.storage.from('study-materials').getPublicUrl(filePath);
  const fileUrl = urlData.publicUrl;

  const { error: insertError } = await supabase.from('submissions').insert({
    university: input.university.trim(),
    subject: input.subject.trim(),
    chair: input.chair.trim(),
    unit: input.unit?.trim() || null,
    source_notes: input.sourceNotes?.trim() || null,
    material_type: input.materialType,
    file_url: fileUrl,
    file_type: fileType || `application/${fileExt}`,
    processed: false,
  });

  if (insertError) {
    console.error('Detalle error base de datos:', insertError);
    throw new Error('No se pudo registrar el envío en la base de datos.');
  }
}export async function deleteSubmission(submissionId: string, fileUrl: string): Promise<void> {
  // 1. Extraer el path relativo dentro del bucket para borrar el archivo físico
  try {
    const url = new URL(fileUrl);
    const pathParts = url.pathname.split('study-materials/');
    if (pathParts.length > 1) {
      const storagePath = decodeURIComponent(pathParts[1]);
      await supabase.storage.from('study-materials').remove([storagePath]);
    }
  } catch (storageErr) {
    console.warn('No se pudo borrar el archivo físico de Storage:', storageErr);
  }

  // 2. Borrar la fila de la tabla submissions
  const { error: dbError } = await supabase
    .from('submissions')
    .delete()
    .eq('id', submissionId);

  if (dbError) {
    console.error('Error al eliminar el registro:', dbError);
    throw new Error('No se pudo eliminar el envío de la base de datos.');
  }
}