import { readFileSync } from 'node:fs';

function fail() {
  throw new Error('Invalid backup deletion response.');
}

try {
  const [responsePath] = process.argv.slice(2);
  if (!responsePath) fail();

  const responseText = readFileSync(responsePath, 'utf8').trim();
  if (!responseText) {
    process.stdout.write('0');
  } else {
    const response = JSON.parse(responseText);
    if (!response || typeof response !== 'object' || Array.isArray(response)) fail();
    if (response.Errors !== undefined && !Array.isArray(response.Errors)) fail();
    process.stdout.write(String(response.Errors?.length || 0));
  }
} catch {
  console.error('Backup deletion response validation failed. Provider details were suppressed.');
  process.exitCode = 1;
}
