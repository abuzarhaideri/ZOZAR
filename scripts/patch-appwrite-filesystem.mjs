import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const files = [
  'node_modules/react-native-appwrite/dist/cjs/sdk.js',
  'node_modules/react-native-appwrite/dist/esm/sdk.js',
].map((path) => resolve(process.cwd(), path));

for (const file of files) {
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch {
    continue;
  }
  const patched = source
    .replaceAll("require('expo-file-system')", "require('expo-file-system/legacy')")
    .replaceAll("from 'expo-file-system';", "from 'expo-file-system/legacy';")
    .replaceAll('from "expo-file-system";', 'from "expo-file-system/legacy";');
  if (patched !== source) await writeFile(file, patched);
}
