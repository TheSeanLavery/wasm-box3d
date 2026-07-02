import { mkdir, copyFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const [srcDir = 'src', outDir = 'dist'] = process.argv.slice(2);
const keep = new Set(['wasm']);

async function copyRecursive(src, dest) {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyRecursive(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

await mkdir(outDir, { recursive: true });
for (const entry of await readdir(outDir, { withFileTypes: true })) {
  if (!keep.has(entry.name)) {
    await rm(join(outDir, entry.name), { recursive: true, force: true });
  }
}
await copyRecursive(srcDir, outDir);

