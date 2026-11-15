const SAFE_SEGMENT = /^[A-Za-z0-9._ -]+$/;

function normalizeArchivePath(value, label = "archive path") {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " must be a non-empty string.");
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.includes("\0")) {
    throw new Error(label + " must be relative to archive_input.");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || !SAFE_SEGMENT.test(part))) {
    throw new Error(label + " contains an unsafe or unsupported path segment.");
  }
  return parts.join("/");
}

function luaString(value) {
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n") + '"';
}

export function createOrbisRpfBuildPlan(files, archiveName = "Archive.rpf") {
  if (!Array.isArray(files) || files.length === 0) throw new Error("Select at least one file to add to the RPF archive.");
  if (typeof archiveName !== "string" || !/^[A-Za-z0-9._-]+\.rpf$/i.test(archiveName) || archiveName === ".rpf") {
    throw new Error("Archive name must be a simple .rpf filename.");
  }
  const seen = new Set();
  const entries = files.map((file, index) => {
    if (!file || typeof file !== "object") throw new Error("File " + (index + 1) + " is invalid.");
    const archivePath = normalizeArchivePath(file.path, "File " + (index + 1) + " path");
    if (seen.has(archivePath.toLowerCase())) throw new Error("Duplicate archive path: " + archivePath);
    seen.add(archivePath.toLowerCase());
    return { archivePath, folderName: archivePath.includes("/") ? archivePath.slice(0, archivePath.lastIndexOf("/")) : "", fileName: archivePath.slice(archivePath.lastIndexOf("/") + 1), size: Number.isSafeInteger(file.size) && file.size >= 0 ? file.size : null };
  });
  const lines = [
    'print("--- RPF Builder (Orbis) ---")',
    'set_platform("orbis")',
    "start_uncompressed_pack()",
    "local archive_file = " + luaString(archiveName),
    "",
    "local function add_file_to_archive(packfile, folderName, fileName)",
    '  local curr_file_path = "archive_input/" .. (folderName ~= "" and (folderName .. "/") or "") .. fileName',
    '  local pack_file_path = folderName ~= "" and (folderName .. "/" .. fileName) or fileName',
    "  add_to_pack(curr_file_path, pack_file_path)",
    "end",
    ""
  ];
  for (const entry of entries) lines.push("add_file_to_archive(archive_file, " + luaString(entry.folderName) + ", " + luaString(entry.fileName) + ")");
  lines.push("", "save_pack(archive_file)", "close_pack()", 'print("Orbis RPF archive build completed.")', "");
  const lua = lines.join("\n");
  const batch = [
    "@echo off", "setlocal", 'cd /d "%~dp0"',
    'if not exist "ragebuilder_x64_0378.exe" (',
    "  echo Missing ragebuilder_x64_0378.exe. Place your licensed builder executable beside this script.",
    "  exit /b 1", ")",
    '"ragebuilder_x64_0378.exe" archive_builder.lua',
    "if errorlevel 1 exit /b %errorlevel%",
    'if not exist "' + archiveName + '" exit /b 2',
    "echo Created " + archiveName, "endlocal", ""
  ].join("\r\n");
  return { schemaVersion: 1, builder: "Orbis RPF Builder script format", platform: "orbis", archiveName, compression: "uncompressed", entries, lua, batch, compatibility: { target: "PS4/Orbis archive layout", gameTitleId: null, gameUpdate: null, verifiedOnConsole: false, installable: false }, warnings: [
    "This generates a build recipe for the supplied Orbis RPF Builder; it does not itself encode or convert resource files.",
    "The builder executable and DLLs are not bundled. Supply a copy whose license permits your use.",
    "An Orbis-targeted RPF is not proof that its contents are compatible with GTA V CUSA00419 update 1.73."
  ] };
}
