import JSZip from 'jszip';

/**
 * Codebase export.
 *
 * The whole application source is inlined at build time via `import.meta.glob`
 * with the `?raw` query. That keeps the export working offline (no fetch, no
 * server round trip) and guarantees the ZIP always matches the running build.
 */

// Every source file in src/ is imported as a raw string at build time.
const SOURCE_FILES = import.meta.glob('../**/*.{ts,tsx,css,json}', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;

// Root-level project files that are also worth shipping with the export.
const PROJECT_FILES: Record<string, string> = {
  'package.json': (() => {
    try {
      return JSON.stringify(
        {
          name: 'autobe-mobile-modpack-tool',
          private: true,
          version: '1.0.0',
          type: 'module',
          scripts: {
            dev: 'vite',
            build: 'vite build',
            lint: 'eslint .',
            preview: 'vite preview'
          },
          dependencies: {
            jszip: '^3.10.1',
            react: '^19.2.8',
            'react-dom': '^19.2.8',
            tone: '^15.1.22'
          },
          devDependencies: {
            '@tailwindcss/vite': '^4.3.3',
            '@types/react': '^19.2.18',
            '@types/react-dom': '^19.2.5',
            '@vitejs/plugin-react-swc': '^4.3.3',
            tailwindcss: '^4.3.3',
            typescript: '^5.9.3',
            vite: '^8.2.2'
          }
        },
        null,
        2
      );
    } catch {
      return '{}';
    }
  })()
};

/** Files that must never end up inside an exported archive. */
const EXCLUDE = [/\/node_modules\//, /\.autope\//, /\.DS_Store$/, /\.local$/];

function shouldSkip(path: string): boolean {
  return EXCLUDE.some((rx) => rx.test(path));
}

function stripSrcPrefix(path: string): string {
  // '../components/Foo.tsx' -> 'src/components/Foo.tsx'
  return `src/${path.replace(/^\.\.\//, '')}`;
}

export interface CodebaseZipResult {
  blob: Blob;
  fileName: string;
  fileCount: number;
}

/**
 * Builds a ZIP of the full application source.
 * Throws when Vite did not inline any file (e.g. plain `tsc` run) so the UI can
 * surface a readable error instead of silently producing an empty archive.
 */
export async function buildCodebaseZip(): Promise<CodebaseZipResult> {
  const zip = new JSZip();

  let fileCount = 0;

  for (const [rawPath, contents] of Object.entries(SOURCE_FILES)) {
    if (shouldSkip(rawPath)) continue;
    zip.file(stripSrcPrefix(rawPath), contents ?? '');
    fileCount++;
  }

  for (const [name, contents] of Object.entries(PROJECT_FILES)) {
    zip.file(name, contents);
    fileCount++;
  }

  if (fileCount === 0) {
    throw new Error('No source files were bundled into this build.');
  }

  zip.file(
    'README.txt',
    [
      'AutoBE - Mobile Modpack Tool',
      'Codebase Export by StoneByte',
      `Exported: ${new Date().toISOString()}`,
      `Files: ${fileCount}`,
      '',
      'This archive contains the full application source for backup',
      'or local development. Run "npm install" then "npm run dev".'
    ].join('\n')
  );
  fileCount++;

  const blob = await zip.generateAsync({ type: 'blob' });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  return {
    blob,
    fileName: `AutoBE_Codebase_${stamp}.zip`,
    fileCount
  };
}

/**
 * Triggers a browser download for a blob.
 *
 * `a.click()` alone is unreliable on iOS Safari, so the anchor is also appended
 * to the document, and we wait a tick before revoking the object URL.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.position = 'fixed';
  a.style.left = '-9999px';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoking immediately can cancel the download in some WebViews.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Saves a blob through the File System Access API when the browser supports it,
 * falling back to a normal download. Returns true when the picker was used.
 */
export async function saveBlobToDisk(
  blob: Blob,
  fileName: string,
  mimeType = 'application/octet-stream'
): Promise<'picker' | 'download'> {
  const picker = (window as any).showSaveFilePicker;
  if (typeof picker === 'function') {
    try {
      const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
      const handle = await picker({
        suggestedName: fileName,
        types: [{ description: 'AutoBE output', accept: { [mimeType]: [ext || '.bin'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'picker';
    } catch (err: any) {
      // User cancelled the picker -> do not fall through to a surprise download.
      if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return 'picker';
      // Any other failure (unsupported mime, insecure context) -> download.
    }
  }
  downloadBlob(blob, fileName);
  return 'download';
}