const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvFile(file = '.env') {
  const env = {};
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx >= 0) env[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return env;
}

(async function main() {
  const env = loadEnvFile(path.resolve('.env'));
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

  const uniRes = await supabase
    .from('universities')
    .select('id,name')
    .ilike('name', '%Instituto Universitario Fundación Barceló%')
    .limit(10);

  if (uniRes.error) {
    console.log('uniError', uniRes.error);
    return;
  }

  const university = (uniRes.data ?? []).find((u) => u.name === 'Instituto Universitario Fundación Barceló') ?? (uniRes.data ?? [])[0];
  if (!university) {
    console.log('No encontré la universidad Instituto Universitario Fundación Barceló en universities.');
    return;
  }

  const subjectRes = await supabase
    .from('subjects')
    .select('id,name,university_id')
    .eq('name', 'Infectología')
    .eq('university_id', university.id)
    .limit(10);

  if (subjectRes.error) {
    console.log('subjectError', subjectRes.error);
    return;
  }

  const subject = (subjectRes.data ?? [])[0];
  if (!subject) {
    console.log('No encontré la subject Infectología bajo el university_id correcto.');
    return;
  }

  const chairRes = await supabase
    .from('chairs')
    .select('id,name,subject_id')
    .eq('name', 'Colegiales')
    .eq('subject_id', subject.id)
    .limit(10);

  if (chairRes.error) {
    console.log('chairLookupError', chairRes.error);
    return;
  }

  let chair = (chairRes.data ?? [])[0];
  if (!chair) {
    const insertRes = await supabase
      .from('chairs')
      .insert({ name: 'Colegiales', subject_id: subject.id })
      .select('id,name,subject_id');

    if (insertRes.error) {
      console.log('chairInsertError', insertRes.error);
      return;
    }

    chair = insertRes.data?.[0];
  }

  console.log('chairId', chair.id);

  const updateQuestions = await supabase
    .from('questions')
    .update({
      chair_id: chair.id,
      chair: 'Colegiales',
      university: 'Fundación Barceló',
      subject: 'Infectología',
    })
    .eq('subject', 'Infectología');

  if (updateQuestions.error) {
    console.log('questionsUpdateError', updateQuestions.error);
    return;
  }

  console.log('questionRowsUpdatedBySubject', updateQuestions.data);

  const fsOut = path.resolve('scripts/infectologia_questions_import.sql');
  const sql = fs.readFileSync(fsOut, 'utf8').replace(
    'eda9a516-6a8f-4cd5-963d-2466a92e3d77',
    chair.id
  );

  fs.writeFileSync(fsOut, sql);
  console.log('updatedSQL', fsOut);
})();
