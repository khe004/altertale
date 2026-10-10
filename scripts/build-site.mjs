import { readFile, readdir, mkdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const assets = {};
async function collect(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + '/' + entry.name;
    if (entry.isDirectory()) await collect(resolve(dir, entry.name), name);
    else {
      let body = await readFile(resolve(dir, entry.name), 'utf8');
      if (name === '/index.html') body = body.replace('<head>', '<head>\n<script>window.ALTERTALE_HOSTED = true;</script>');
      assets[name] = { body, type: extname(name) === '.html' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' };
    }
  }
}
await collect(resolve(root, 'web'));
const source = await readFile(resolve(root, 'worker/index.js'), 'utf8');
await rm(resolve(root, 'dist'), { recursive: true, force: true });
await mkdir(resolve(root, 'dist/server'), { recursive: true });
await mkdir(resolve(root, 'dist/.openai'), { recursive: true });
await writeFile(resolve(root, 'dist/server/index.js'), source.replace('/* ALTERTALE_ASSETS */ {}', JSON.stringify(assets)));
await copyFile(resolve(root, '.openai/hosting.json'), resolve(root, 'dist/.openai/hosting.json'));
const built = await readFile(resolve(root, 'dist/server/index.js'), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(built).toString('base64'));
if (typeof mod.default?.fetch !== 'function') throw new Error('Worker 缺少 fetch 导出');
for (const path of Object.keys(assets)) {
  const res = await mod.default.fetch(new Request('https://site.example' + path));
  if (!res.ok || !(await res.text()).length) throw new Error('资源未正确打包：' + path);
}
console.log(`Built and validated Worker with ${Object.keys(assets).length} assets`);
