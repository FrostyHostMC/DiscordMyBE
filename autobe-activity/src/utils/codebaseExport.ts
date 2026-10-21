// Codebase export: packages the entire app source code into an encrypted ZIP archive.
import JSZip from 'jszip';

export const CODEBASE_PASSWORD = '836472'; // Change this in production

export interface CodebaseExportResult {
  blob: Blob;
  fileName: string;
  fileCount: number;
  encrypted: boolean;
}

/**
 * Recursively fetches a file from the public URL and adds it to the ZIP.
 * Used to package real source files during the codebase export.
 */
async function addFileToZip(
  zip: JSZip,
  path: string,
  url: string,
  warnings: string[]
): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      warnings.push(`Failed to fetch ${path}: ${response.status}`);
      return;
    }
    const content = await response.arrayBuffer();
    zip.file(path, content);
  } catch (e) {
    warnings.push(`Error fetching ${path}: ${e}`);
  }
}

/**
 * Builds a ZIP archive containing the entire app codebase (src/, functions/, public/, configs).
 * The archive is AES-256 encrypted with the CODEBASE_PASSWORD.
 */
export async function buildCodebaseArchive(
  appVersion = 'v2.3.0'
): Promise<CodebaseExportResult> {
  const zip = new JSZip();
  const warnings: string[] = [];
  let fileCount = 0;

  // Core configuration files (assumed to be accessible via relative paths)
  const configFiles = [
    'package.json',
    'tsconfig.json',
    'tsconfig.app.json',
    'tsconfig.node.json',
    'vite.config.ts',
    'tailwind.config.ts',
    'eslint.config.js',
    'index.html'
  ];

  for (const file of configFiles) {
    try {
      const response = await fetch(`/${file}`);
      if (response.ok) {
        const content = await response.text();
        zip.file(file, content);
        fileCount++;
      } else {
        warnings.push(`Could not fetch ${file}`);
      }
    } catch (e) {
      warnings.push(`Error fetching ${file}: ${e}`);
    }
  }

  // Add src/ directory structure
  const srcFiles = [
    'src/main.tsx',
    'src/App.tsx',
    'src/index.css',
    'src/vite-env.d.ts',
    'src/tailwind.config.aippy.json'
  ];

  for (const file of srcFiles) {
    try {
      const response = await fetch(`/${file}`);
      if (response.ok) {
        const content = await response.text();
        zip.file(file, content);
        fileCount++;
      } else {
        warnings.push(`Could not fetch ${file}`);
      }
    } catch (e) {
      warnings.push(`Error fetching ${file}: ${e}`);
    }
  }

  // Add components
  const componentFiles = [
    'src/components/AboutScreen.tsx',
    'src/components/ActivationScreen.tsx',
    'src/components/AddPacksScreen.tsx',
    'src/components/AppHeader.tsx',
    'src/components/BottomNav.tsx',
    'src/components/CompatibilityScreen.tsx',
    'src/components/ConflictScreen.tsx',
    'src/components/HomeScreen.tsx',
    'src/components/LegalScreen.tsx',
    'src/components/LibraryScreen.tsx',
    'src/components/ListMaker.tsx',
    'src/components/MergeCompleteScreen.tsx',
    'src/components/MergingScreen.tsx',
    'src/components/ModpackDetailsScreen.tsx',
    'src/components/MyPacksScreen.tsx',
    'src/components/PackExtractTool.tsx',
    'src/components/ScriptCheckScreen.tsx',
    'src/components/SettingsScreen.tsx',
    'src/components/SplashScreen.tsx',
    'src/components/SubpackScreen.tsx',
    'src/components/CodebasePasswordModal.tsx',
    'src/components/DashboardShell.tsx',
    'src/components/DependenciesScreen.tsx',
    'src/components/ConflictDiffViewer.tsx',
    'src/components/PackCustomizeModal.tsx',
    'src/components/PackInspectorModal.tsx',
    'src/components/MergeWorkspace.tsx'
  ];

  for (const file of componentFiles) {
    try {
      const response = await fetch(`/${file}`);
      if (response.ok) {
        const content = await response.text();
        zip.file(file, content);
        fileCount++;
      } else {
        warnings.push(`Could not fetch ${file}`);
      }
    } catch (e) {
      warnings.push(`Error fetching ${file}: ${e}`);
    }
  }

  // Add utils
  const utilFiles = [
    'src/utils/addonParser.ts',
    'src/utils/behaviorEntityMerge.ts',
    'src/utils/conflictDiff.ts',
    'src/utils/crossGroupUnify.ts',
    'src/utils/definitionMerger.ts',
    'src/utils/demoData.ts',
    'src/utils/download.ts',
    'src/utils/drawHelpers.ts',
    'src/utils/errorLog.ts',
    'src/utils/identifierManager.ts',
    'src/utils/identifierResolution.ts',
    'src/utils/mergeEngine.ts',
    'src/utils/packCustomization.ts',
    'src/utils/playerEntityFix.ts',
    'src/utils/projectExport.ts',
    'src/utils/scriptApiVersion.ts',
    'src/utils/scriptConflictScan.ts',
    'src/utils/scriptNamespacing.ts',
    'src/utils/smartJsonMerge.ts',
    'src/utils/stableUuid.ts',
    'src/utils/storage.ts',
    'src/utils/subpackHudMerge.ts',
    'src/utils/subpackProcessor.ts',
    'src/utils/universalJsonMerger.ts',
    'src/utils/codebaseExport.ts'
  ];

  for (const file of utilFiles) {
    try {
      const response = await fetch(`/${file}`);
      if (response.ok) {
        const content = await response.text();
        zip.file(file, content);
        fileCount++;
      } else {
        warnings.push(`Could not fetch ${file}`);
      }
    } catch (e) {
      warnings.push(`Error fetching ${file}: ${e}`);
    }
  }

  // Add hooks
  const hookFiles = [
    'src/hooks/useCanvasDPI.ts',
    'src/hooks/useGameImages.ts',
    'src/hooks/useGameLoop.ts',
    'src/hooks/useModpackAudio.ts',
    'src/hooks/useRefState.ts',
    'src/hooks/useSFX.ts'
  ];

  for (const file of hookFiles) {
    try {
      const response = await fetch(`/${file}`);
      if (response.ok) {
        const content = await response.text();
        zip.file(file, content);
        fileCount++;
      } else {
        warnings.push(`Could not fetch ${file}`);
      }
    } catch (e) {
      warnings.push(`Error fetching ${file}: ${e}`);
    }
  }

  // Add config
  const configJsonFiles = [
    'src/config/assets.json',
    'src/config/assets.ts',
    'src/config/tweaksConfig.json'
  ];

  for (const file of configJsonFiles) {
    try {
      const response = await fetch(`/${file}`);
      if (response.ok) {
        const content = await response.text();
        zip.file(file, content);
        fileCount++;
      } else {
        warnings.push(`Could not fetch ${file}`);
      }
    } catch (e) {
      warnings.push(`Error fetching ${file}: ${e}`);
    }
  }

  // Add types
  const typeFiles = [
    'src/types/modpack.ts'
  ];

  for (const file of typeFiles) {
    try {
      const response = await fetch(`/${file}`);
      if (response.ok) {
        const content = await response.text();
        zip.file(file, content);
        fileCount++;
      } else {
        warnings.push(`Could not fetch ${file}`);
      }
    } catch (e) {
      warnings.push(`Error fetching ${file}: ${e}`);
    }
  }

  // Add public files
  const publicFiles = [
    'public/manifest.webmanifest',
    'public/robots.txt',
    'public/sw.js'
  ];

  for (const file of publicFiles) {
    try {
      const response = await fetch(`/${file}`);
      if (response.ok) {
        const content = await response.text();
        zip.file(file, content);
        fileCount++;
      } else {
        warnings.push(`Could not fetch ${file}`);
      }
    } catch (e) {
      warnings.push(`Error fetching ${file}: ${e}`);
    }
  }

  // Add functions
  const functionFiles = [
    'functions/api/access.ts',
    'functions/api/token.ts'
  ];

  for (const file of functionFiles) {
    try {
      const response = await fetch(`/${file}`);
      if (response.ok) {
        const content = await response.text();
        zip.file(file, content);
        fileCount++;
      } else {
        warnings.push(`Could not fetch ${file}`);
      }
    } catch (e) {
      warnings.push(`Error fetching ${file}: ${e}`);
    }
  }

  // Add README
  zip.file('README.md', [
    '# AutoBE Studio - Codebase Export',
    '',
    `Exported: ${new Date().toISOString()}`,
    `Version: ${appVersion}`,
    '',
    'This archive contains the complete source code for the AutoBE Studio web application.',
    '',
    '## Contents',
    '- src/: React components, hooks, utilities, and types',
    '- public/: Static assets and service worker',
    '- functions/: Cloudflare/PWA API endpoints',
    '- Configuration files (package.json, tsconfig, vite.config, etc.)',
    '',
    '## Usage',
    '1. Extract this archive',
    '2. Run `pnpm install` to install dependencies',
    '3. Run `pnpm dev` to start the development server',
    '4. Run `pnpm build` to build for production',
    '',
    '## Security',
    'This archive is AES-256 encrypted. Use the codebase password to decrypt.'
  ].join('\n'));
  fileCount++;

  // Generate encrypted ZIP
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    password: CODEBASE_PASSWORD,
    encryption: 'AES'
  });

  if (!blob || blob.size === 0) {
    throw new Error('Archive generation produced an empty file.');
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    blob,
    fileName: `autobe_codebase_${stamp}.zip`,
    fileCount,
    encrypted: true
  };
}
