import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import { createWorker } from 'tesseract.js';

// Configuración del worker de PDF.js vía CDN compatible con Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

// Extrae texto de PowerPoint (.pptx) leyendo el XML interno de cada diapositiva
export async function parsePptx(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles: string[] = [];

  zip.forEach((relativePath) => {
    if (relativePath.startsWith('ppt/slides/slide') && relativePath.endsWith('.xml')) {
      slideFiles.push(relativePath);
    }
  });

  slideFiles.sort((a, b) => {
    const numA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
    const numB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
    return numA - numB;
  });

  let fullText = '';
  for (const slidePath of slideFiles) {
    const xmlContent = await zip.file(slidePath)?.async('text');
    if (xmlContent) {
      const matches = xmlContent.match(/<a:t[^>]*>(.*?)<\/a:t>/g);
      if (matches) {
        const slideText = matches
          .map((tag) => tag.replace(/<[^>]+>/g, ''))
          .join(' ');
        fullText += `\n--- Diapositiva ---\n${slideText}`;
      }
    }
  }

  return fullText.trim();
}

const PDF_OCR_MIN_TEXT_LENGTH = 40;
const PDF_OCR_SCALE = 2;

async function recognizePdfPage(page: pdfjsLib.PDFPageProxy, worker: Awaited<ReturnType<typeof createWorker>>): Promise<string> {
  const viewport = page.getViewport({ scale: PDF_OCR_SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d');

  if (!context) throw new Error('No se pudo crear el canvas para OCR.');

  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const result = await worker.recognize(canvas);
  return result.data.text.trim();
}

export async function parseImage(image: Blob): Promise<string> {
  const worker = await createWorker('spa');
  try {
    const result = await worker.recognize(image);
    return result.data.text.trim();
  } finally {
    await worker.terminate();
  }
}

function pageHasImages(operatorList: { fnArray: number[] }): boolean {
  const imageOperators = new Set([
    pdfjsLib.OPS.paintImageMaskXObject,
    pdfjsLib.OPS.paintImageXObject,
    pdfjsLib.OPS.paintXObject,
  ]);
  return operatorList.fnArray.some((operator: number) => imageOperators.has(operator));
}

// Extrae texto de PDF y aplica OCR en páginas escaneadas o con imágenes.
export async function parsePdf(buffer: ArrayBuffer): Promise<string> {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  let fullText = '';
  const pagesForOcr: Array<{ page: pdfjsLib.PDFPageProxy; pageNum: number }> = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageString = textContent.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ');
    fullText += `\n--- Página ${pageNum} ---\n${pageString}`;

    const operatorList = await page.getOperatorList();
    if (pageString.trim().length < PDF_OCR_MIN_TEXT_LENGTH || pageHasImages(operatorList)) {
      pagesForOcr.push({ page, pageNum });
    }
  }

  if (pagesForOcr.length === 0) return fullText.trim();

  const worker = await createWorker('spa');
  try {
    for (const { page, pageNum } of pagesForOcr) {
      try {
        const ocrText = await recognizePdfPage(page, worker);
        if (ocrText) {
          fullText += `\n--- OCR página ${pageNum} ---\n${ocrText}`;
        }
      } catch (error) {
        console.warn(`No se pudo aplicar OCR a la página ${pageNum}:`, error);
      }
    }
  } finally {
    await worker.terminate();
  }

  return fullText.trim();
}

export async function parseDocx(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xmlContent = await zip.file('word/document.xml')?.async('text');
  if (!xmlContent) return '';
  return Array.from(xmlContent.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g))
    .map((match) => match[1])
    .join(' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

// Extrae texto directamente de un archivo local (File) seleccionado por el usuario
export async function extractTextFromFileObject(file: File): Promise<string> {
  const lowerName = file.name.toLowerCase();

  if (file.type.includes('text/plain') || lowerName.endsWith('.txt')) {
    return await file.text();
  }

  if (file.type.startsWith('image/') || /\.(png|jpe?g)$/i.test(lowerName)) {
    return await parseImage(file);
  }

  const arrayBuffer = await file.arrayBuffer();

  if (lowerName.endsWith('.pptx') || file.type.includes('presentation')) {
    return await parsePptx(arrayBuffer);
  }

  if (lowerName.endsWith('.docx') || file.type.includes('wordprocessingml')) {
    return await parseDocx(arrayBuffer);
  }

  if (lowerName.endsWith('.pdf') || file.type.includes('pdf')) {
    return await parsePdf(arrayBuffer);
  }

  return await file.text();
}

// Descarga un archivo por URL y extrae texto (usado en AdminPanel)
export async function fetchAndExtractText(fileUrl: string, fileType: string): Promise<string> {
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error('No se pudo descargar el archivo.');

  const lowerType = fileType.toLowerCase();
  const lowerUrl = fileUrl.toLowerCase();

  if (lowerType.includes('text/plain') || lowerUrl.endsWith('.txt')) {
    return await response.text();
  }

  const arrayBuffer = await response.arrayBuffer();

  if (lowerType.includes('presentation') || lowerUrl.endsWith('.pptx')) {
    return await parsePptx(arrayBuffer);
  }

  if (lowerType.includes('pdf') || lowerUrl.endsWith('.pdf')) {
    return await parsePdf(arrayBuffer);
  }

  if (lowerType.includes('wordprocessingml') || lowerUrl.endsWith('.docx')) {
    return await parseDocx(arrayBuffer);
  }

  return await response.text();
}