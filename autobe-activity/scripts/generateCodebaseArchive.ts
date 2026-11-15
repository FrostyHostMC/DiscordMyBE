/**
 * Build-time script to generate a codebase archive.
 * This script runs during the build process and creates a ZIP file
 * containing the entire project source code.
 *
 * The archive is included in the dist/ folder and served as a static asset.
 * Users download it from the settings screen and the password is used
 * to encrypt it client-side using @zip.js/zip.js with AES-256.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join, relative, sep } from 'path';
import { promises as fs } from 'fs';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// Files and directories to exclude from the archive
const EXCLUDE_PATTERNS = [
  'node_modules',
  'dist',
  '.git',
  '.gitignore',
  '.DS_Store',
  'Thumbs.db',
  '*.log',
  '.env',
  '.env.*',
  '*.zip',
  'eslint.config.js',
  'scripts'
];

// Files to include at the root level
const ROOT_FILES = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'vite.config.ts',
  'tailwind.config.ts',
  'index.html',
  'README.md'
];

// Directories to include recursively
const DIRECTORIES = [
  'src',
  'public',
  'functions'
];

/**
 * Check if a path should be excluded based on patterns
 */
function shouldExclude(filePath: string): boolean {
  const relativePath = relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');

  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      if (regex.test(relativePath) || regex.test(filePath.split(sep).pop() || '')) {
        return true;
      }
    } else if (relativePath.includes(pattern) || relativePath.startsWith(pattern + '/')) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively collect all files from a directory
 */
function collectFiles(dir: string, fileList: string[] = []): string[] {
  if (!existsSync(dir)) {
    console.warn(`Directory does not exist: ${dir}`);
    return fileList;
  }

  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (shouldExclude(fullPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      collectFiles(fullPath, fileList);
    } else if (entry.isFile()) {
      fileList.push(fullPath);
    }
  }

  return fileList;
}

/**
 * Generate the codebase archive
 */
async function generateArchive(): Promise<void> {
  console.log('📦 Generating codebase archive...');

  const allFiles: string[] = [];

  // Add root files
  for (const file of ROOT_FILES) {
    const filePath = join(PROJECT_ROOT, file);
    if (existsSync(filePath) && !shouldExclude(filePath)) {
      allFiles.push(filePath);
    }
  }

  // Add files from directories
  for (const dir of DIRECTORIES) {
    const dirPath = join(PROJECT_ROOT, dir);
    collectFiles(dirPath, allFiles);
  }

  console.log(`Found ${allFiles.length} files to include`);

  if (allFiles.length === 0) {
    throw new Error('No files found to include in archive');
  }

  // Create ZIP using JSZip
  const zip = new JSZip();

  // Add files to ZIP
  for (const filePath of allFiles) {
    const relativePath = relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');
    const content = readFileSync(filePath);

    try {
      zip.file(relativePath, content);
    } catch (error) {
      console.error(`Failed to add ${relativePath}:`, error);
      throw error;
    }
  }

  // Generate ZIP blob (NOT encrypted yet - encryption happens on client side)
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  // Write to public folder (so it's served as a static asset in both dev and production)
  const publicDir = join(PROJECT_ROOT, 'public');
  if (!existsSync(publicDir)) {
    await fs.mkdir(publicDir, { recursive: true });
  }

  const outputPath = join(publicDir, 'codebase-archive.zip');
  await fs.writeFile(outputPath, zipBuffer);

  // Also write to dist folder for reference (though public is the source of truth)
  const distDir = join(PROJECT_ROOT, 'dist');
  if (!existsSync(distDir)) {
    await fs.mkdir(distDir, { recursive: true });
  }
  await fs.writeFile(join(distDir, 'codebase-archive.zip'), zipBuffer);

  // Generate SHA-256 hash for integrity verification
  const hash = createHash('sha256').update(zipBuffer).digest('hex');

  // Write metadata file to public folder (for client-side verification)
  const packageJson = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));
  const metadata = {
    version: packageJson.version,
    generatedAt: new Date().toISOString(),
    fileCount: allFiles.length,
    fileSize: zipBuffer.length,
    sha256: hash,
    encrypted: false // Archive is not encrypted at build time; encryption happens on download
  };

  const metadataPath = join(publicDir, 'codebase-archive.json');
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

  // Also write metadata to dist folder
  await fs.writeFile(join(distDir, 'codebase-archive.json'), JSON.stringify(metadata, null, 2));

  console.log(`✅ Archive generated: ${outputPath}`);
  console.log(`   Files: ${metadata.fileCount}`);
  console.log(`   Size: ${(metadata.fileSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   SHA-256: ${hash}`);
}

// Run the script
generateArchive().catch(error => {
  console.error('❌ Failed to generate codebase archive:', error);
  process.exit(1);
});
