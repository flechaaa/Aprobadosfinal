const fs = require('fs');
const path = require('path');

const sourcePath = path.resolve('src/data/Trivia_Infectologia.json');
const outPath = path.resolve('scripts/infectologia_questions_import.sql');

const data = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

if (!Array.isArray(data)) {
  throw new Error('El archivo local no entrega un arreglo de preguntas.');
}

const chairId = 'eda9a516-6a8f-4cd5-963d-2466a92e3d77';
const university = 'Fundación Barceló';
const subject = 'Infectología';
const chair = 'Colegiales';

const requiredKeys = ['pregunta', 'opciones', 'correcta', 'explicacion'];

for (const [idx, row] of data.entries()) {
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) {
      throw new Error(`Fila ${idx}: falta '${key}'.`);
    }
  }

  if (typeof row.pregunta !== 'string' || row.pregunta.trim().length < 5) {
    throw new Error(`Fila ${idx}: 'pregunta' inválida.`);
  }

  if (!Array.isArray(row.opciones) || row.opciones.length !== 4) {
    throw new Error(`Fila ${idx}: 'opciones' debe ser un array de 4 strings.`);
  }

  if (!row.opciones.every((opt) => typeof opt === 'string' && opt.trim().length > 0)) {
    throw new Error(`Fila ${idx}: todas las opciones deben ser texto no vacío.`);
  }

  if (!Number.isInteger(row.correcta) || row.correcta < 0 || row.correcta > 3) {
    throw new Error(`Fila ${idx}: 'correcta' debe ser un entero 0..3.`);
  }

  if (typeof row.explicacion !== 'string' || row.explicacion.trim().length < 5) {
    throw new Error(`Fila ${idx}: 'explicacion' inválida.`);
  }
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlTextArray(values) {
  return 'ARRAY[' + values.map((v) => sqlString(v)).join(',') + ']';
}

const rows = data.map((row) => {
  return `(${sqlString(row.pregunta)}, ${sqlTextArray(row.opciones)}, ${row.correcta}, ${sqlString(row.explicacion)}, ${sqlString(chairId)}, ${sqlString(subject)}, ${sqlString(chair)}, ${sqlString(university)})`;
});

const sql = [
  'BEGIN;',
  '',
  `DELETE FROM public.questions WHERE chair_id = ${sqlString(chairId)} AND subject = ${sqlString(subject)} AND university = ${sqlString(university)};`,
  '',
  'INSERT INTO public.questions (question, options, correct_option, explanation, chair_id, subject, chair, university)',
  'VALUES',
  rows.join(',\n'),
  ';',
  '',
  'COMMIT;'
].join('\n');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, sql);

console.log(`Validated ${data.length} questions from ${sourcePath}`);
console.log(`Wrote ${outPath}`);
