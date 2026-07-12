import { readFile } from 'node:fs/promises';

const COLORS = ['#2f6f8f', '#c54f7c', '#5f8f3d', '#b86a2f', '#6c5aa7', '#2f8c83', '#9a554f', '#4f6fb2'];

async function readEnvFile(path) {
  const values = {};
  const contents = await readFile(path, 'utf8');
  contents.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
    if (!match) return;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  });
  return values;
}

const env = await readEnvFile(new URL('../.env.local', import.meta.url));
const supabaseUrl = env.VITE_SUPABASE_URL?.trim();
const supabaseKey = env.VITE_SUPABASE_KEY?.trim();

if (!supabaseUrl || !supabaseKey) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_KEY must be configured in .env.local.');
}

const headers = {
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
  'Content-Type': 'application/json',
};

const response = await fetch(`${supabaseUrl}/rest/v1/projects?select=*&order=created_at.asc`, { headers });
if (!response.ok) throw new Error(`Could not load projects: ${response.status} ${await response.text()}`);

const rows = await response.json();
let taskIndex = 0;
let updatedTaskCount = 0;
const changedProjects = [];

for (const row of rows) {
  const project = structuredClone(row.data || row);
  let changed = false;
  for (const phase of project.phases || []) {
    for (const task of phase.steps || []) {
      if (!task.color) {
        task.color = COLORS[taskIndex % COLORS.length];
        updatedTaskCount += 1;
        changed = true;
      }
      taskIndex += 1;
    }
  }
  if (changed) changedProjects.push({ id: project.id, data: project });
}

if (changedProjects.length) {
  const saveResponse = await fetch(`${supabaseUrl}/rest/v1/projects`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(changedProjects),
  });
  if (!saveResponse.ok) throw new Error(`Could not save project colors: ${saveResponse.status} ${await saveResponse.text()}`);
}

console.log(`Assigned colors to ${updatedTaskCount} task(s) across ${changedProjects.length} project(s).`);
