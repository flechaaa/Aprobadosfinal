import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';

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

// Extrae texto de PDF
export async function parsePdf(buffer: ArrayBuffer): Promise<string> {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  let fullText = '';

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageString = textContent.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ');
    fullText += `\n--- Página ${pageNum} ---\n${pageString}`;
  }

  return fullText.trim();
}

// Extrae texto directamente de un archivo local (File) seleccionado por el usuario
export async function extractTextFromFileObject(file: File): Promise<string> {
  const lowerName = file.name.toLowerCase();

  if (file.type.includes('text/plain') || lowerName.endsWith('.txt')) {
    return await file.text();
  }

  const arrayBuffer = await file.arrayBuffer();

  if (lowerName.endsWith('.pptx') || file.type.includes('presentation')) {
    return await parsePptx(arrayBuffer);
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

  return await response.text();
}