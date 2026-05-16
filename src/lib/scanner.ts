import fs from "fs";
import path from "path";
import os from "os";

export interface FileInfo {
  id: string;
  name: string;
  path: string;
  size: number;
  lastAccessed: string;
  lastModified: string;
  daysSinceAccess: number;
  daysSinceModified: number;
  extension: string;
  type: string;
  isProtected: boolean;
  protectionReason?: string;
}

export interface ScanState {
  id: string;
  status: "idle" | "scanning" | "completed" | "error";
  progress: number;
  currentPath: string;
  totalScanned: number;
  filesFound: FileInfo[];
  startTime: number;
  endTime?: number;
  error?: string;
}

export interface ScanOptions {
  paths: string[];
  minDaysUnused: number;
  minFileSize: number; // in bytes
  fileTypes: string[]; // extensions, empty = all
  maxDepth: number;
}

// In-memory scan state store
const scanStates = new Map<string, ScanState>();
let activeScan: AbortController | null = null;

// ============================================================
// PROTECTED PATHS — ไฟล์/โฟลเดอร์ที่ห้ามลบเด็ดขาด
// ============================================================

// Windows system directories (case-insensitive match on C: drive)
const WINDOWS_PROTECTED_DIRS = [
  "Windows",
  "Program Files",
  "Program Files (x86)",
  "ProgramData",
  "System Volume Information",
  "$Recycle.Bin",
  "$WINDOWS.~BT",
  "$WINDOWS.~WS",
  "Recovery",
  "Boot",
  "EFI",
  "Microsoft",
  "PerfLogs",
];

// Linux/macOS system directories
const LINUX_PROTECTED_DIRS = [
  "/bin",
  "/sbin",
  "/usr",
  "/etc",
  "/var",
  "/sys",
  "/proc",
  "/dev",
  "/boot",
  "/lib",
  "/lib64",
  "/run",
  "/snap",
  "/srv",
];

// Critical Windows file names that should NEVER be deleted
const WINDOWS_CRITICAL_FILES = [
  "ntldr",
  "NTDETECT.COM",
  "bootmgr",
  "BOOTSECT.BAK",
  "hiberfil.sys",
  "pagefile.sys",
  "swapfile.sys",
  "config.sys",
  "autoexec.bat",
  "io.sys",
  "msdos.sys",
  "ntoskrnl.exe",
  "hal.dll",
  "winload.exe",
  "winresume.exe",
  "boot.ini",
  "BCD",
];

// Critical file extensions that are system-related
const SYSTEM_CRITICAL_EXTENSIONS = [
  ".sys",
  ".drv",
  ".dll",
  ".efi",
  ".mui",
];

/**
 * Check if a file/directory path is protected and should not be deleted
 */
function isPathProtected(fullPath: string): { protected: boolean; reason?: string } {
  const normalized = path.normalize(fullPath);
  const lower = normalized.toLowerCase();

  // --- Windows checks ---
  if (process.platform === "win32") {
    // Check if on C: drive (system drive)
    const isCDrive = /^[cC]:/.test(normalized);
    if (isCDrive) {
      // Check protected Windows directories
      for (const dir of WINDOWS_PROTECTED_DIRS) {
        const protectedPath = `C:\\${dir.toLowerCase()}\\`;
        if (lower.startsWith(protectedPath) || lower.includes(`\\${dir.toLowerCase()}\\`)) {
          return {
            protected: true,
            reason: `📁 อยู่ในโฟลเดอร์ระบบ Windows: ${dir}`,
          };
        }
      }

      // Check critical files at root of C:
      const fileName = path.basename(normalized).toLowerCase();
      for (const criticalFile of WINDOWS_CRITICAL_FILES) {
        if (fileName === criticalFile.toLowerCase()) {
          return {
            protected: true,
            reason: `⚠️ ไฟล์ระบบสำคัญ: ${path.basename(normalized)}`,
          };
        }
      }

      // Check system critical extensions anywhere on C:
      const ext = path.extname(lower);
      if (SYSTEM_CRITICAL_EXTENSIONS.includes(ext)) {
        return {
          protected: true,
          reason: `🔒 นามสกุลไฟล์ระบบ: ${ext}`,
        };
      }

      // Check Users directory — protect user profile root
      const usersMatch = lower.match(/^c:\\users\\[^\\]+$/);
      if (usersMatch) {
        return {
          protected: true,
          reason: "👤 โฟลเดอร์โปรไฟล์ผู้ใช้",
        };
      }

      // Protect AppData system folders
      if (lower.includes("\\appdata\\local\\microsoft\\windows")) {
        return {
          protected: true,
          reason: "📁 อยู่ในโฟลเดอร์ AppData ระบบ Windows",
        };
      }
    }
  }

  // --- Linux/macOS checks ---
  if (process.platform !== "win32") {
    for (const dir of LINUX_PROTECTED_DIRS) {
      if (lower.startsWith(dir.toLowerCase() + "/") || lower === dir.toLowerCase()) {
        return {
          protected: true,
          reason: `📁 อยู่ในโฟลเดอร์ระบบ: ${dir}`,
        };
      }
    }

    // Protect kernel and system files
    const fileName = path.basename(normalized);
    if (fileName.startsWith("vmlinuz") || fileName.startsWith("initrd") || fileName.startsWith("System.map")) {
      return {
        protected: true,
        reason: "⚠️ ไฟล์เคอร์เนล/ระบบ",
      };
    }
  }

  return { protected: false };
}

function getFileCategory(ext: string): string {
  const categories: Record<string, string[]> = {
    "Temp Files": [".tmp", ".temp", ".bak", ".old", ".swp", ".swo", ".cache"],
    "Logs": [".log", ".err", ".out"],
    "Cache": [".cache", ".chunk", ".part"],
    "Build Artifacts": [".o", ".obj", ".pyc", ".pyo", ".class", ".sourcemap"],
    "Archives": [".zip", ".tar", ".gz", ".rar", ".7z", ".bz2"],
    "Documents": [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"],
    "Images": [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp", ".ico"],
    "Videos": [".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv"],
    "Audio": [".mp3", ".wav", ".flac", ".aac", ".ogg", ".wma"],
    "Code": [".js", ".ts", ".py", ".java", ".cpp", ".c", ".h", ".css", ".html"],
    "Data": [".json", ".xml", ".csv", ".sql", ".db", ".sqlite"],
    "Executables": [".exe", ".msi", ".dmg", ".deb", ".rpm", ".app"],
    "Other": [],
  };

  const lowerExt = ext.toLowerCase();
  for (const [category, exts] of Object.entries(categories)) {
    if (exts.includes(lowerExt)) return category;
  }
  return "Other";
}

function getDrives(): { path: string; label: string; total: number; free: number; isSystemDrive: boolean }[] {
  const drives: { path: string; label: string; total: number; free: number; isSystemDrive: boolean }[] = [];

  if (process.platform === "win32") {
    // Windows: check A-Z drives
    for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const drivePath = `${letter}:\\`;
      try {
        const stats = fs.statSync(drivePath);
        if (stats) {
          const diskInfo = getDiskInfo(drivePath);
          const isSystemDrive = letter === "C";
          drives.push({
            path: drivePath,
            label: isSystemDrive ? `Drive ${letter}: (System)` : `Drive ${letter}:`,
            total: diskInfo.total,
            free: diskInfo.free,
            isSystemDrive,
          });
        }
      } catch {
        // Drive doesn't exist
      }
    }
  } else {
    // Linux/Mac: root and common mount points
    const rootInfo = getDiskInfo("/");
    drives.push({
      path: "/",
      label: "Root (/) [System]",
      total: rootInfo.total,
      free: rootInfo.free,
      isSystemDrive: true,
    });

    // Check common mount points
    const mountPoints = ["/home", "/tmp", "/var", "/opt", "/mnt", "/media"];
    for (const mp of mountPoints) {
      try {
        fs.accessSync(mp, fs.constants.R_OK);
        const stat = fs.statSync(mp);
        if (stat.isDirectory()) {
          const info = getDiskInfo(mp);
          // Only add if it's a different filesystem
          if (info.total !== rootInfo.total) {
            drives.push({
              path: mp,
              label: mp,
              total: info.total,
              free: info.free,
              isSystemDrive: false,
            });
          }
        }
      } catch {
        // Not accessible
      }
    }

    // Also add home directory
    const homeDir = os.homedir();
    if (homeDir && homeDir !== "/") {
      const homeInfo = getDiskInfo(homeDir);
      if (homeInfo.total !== rootInfo.total) {
        drives.push({
          path: homeDir,
          label: `Home (${homeDir})`,
          total: homeInfo.total,
          free: homeInfo.free,
          isSystemDrive: false,
        });
      }
    }
  }

  return drives;
}

function getDiskInfo(dirPath: string): { total: number; free: number } {
  try {
    const stats = fs.statfsSync(dirPath);
    return {
      total: stats.blocks * stats.bsize,
      free: stats.bavail * stats.bsize,
    };
  } catch {
    return { total: 0, free: 0 };
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Directories to skip entirely during scan (system-critical, no useful files to clean)
const SKIP_DIRECTORIES = new Set([
  // Windows
  "Windows",
  "$Recycle.Bin",
  "$WINDOWS.~BT",
  "$WINDOWS.~WS",
  "System Volume Information",
  "Recovery",
  "Boot",
  "EFI",
  "Microsoft",
  "PerfLogs",
  // Cross-platform
  "node_modules",
  "__pycache__",
  ".git",
]);

async function scanDirectory(
  dirPath: string,
  options: ScanOptions,
  scanState: ScanState,
  depth: number = 0,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) return;
  if (depth > options.maxDepth) return;

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    // Permission denied or other error, skip
    return;
  }

  const now = Date.now();

  for (const entry of entries) {
    if (signal.aborted) return;

    const fullPath = path.join(dirPath, entry.name);

    try {
      if (entry.isDirectory()) {
        // Skip hidden directories and system-critical directories
        if (entry.name.startsWith(".") || SKIP_DIRECTORIES.has(entry.name)) {
          continue;
        }
        await scanDirectory(fullPath, options, scanState, depth + 1, signal);
      } else if (entry.isFile()) {
        scanState.totalScanned++;
        scanState.currentPath = fullPath;

        const ext = path.extname(entry.name).toLowerCase();

        // Filter by file type
        if (options.fileTypes.length > 0 && !options.fileTypes.includes(ext)) {
          continue;
        }

        let stat: fs.Stats;
        try {
          stat = await fs.promises.stat(fullPath);
        } catch {
          continue;
        }

        // Filter by size
        if (stat.size < options.minFileSize) {
          continue;
        }

        const daysSinceAccess = Math.floor(
          (now - stat.atimeMs) / (1000 * 60 * 60 * 24)
        );
        const daysSinceModified = Math.floor(
          (now - stat.mtimeMs) / (1000 * 60 * 60 * 24)
        );

        // Filter by days unused
        if (daysSinceAccess < options.minDaysUnused && daysSinceModified < options.minDaysUnused) {
          continue;
        }

        // Check if file is protected
        const protection = isPathProtected(fullPath);

        const fileInfo: FileInfo = {
          id: Buffer.from(fullPath).toString("base64url"),
          name: entry.name,
          path: fullPath,
          size: stat.size,
          lastAccessed: stat.atime.toISOString(),
          lastModified: stat.mtime.toISOString(),
          daysSinceAccess,
          daysSinceModified,
          extension: ext || "(no ext)",
          type: getFileCategory(ext),
          isProtected: protection.protected,
          protectionReason: protection.reason,
        };

        scanState.filesFound.push(fileInfo);
      }
    } catch {
      // Skip files we can't access
    }
  }
}

export {
  getDrives,
  formatBytes,
  scanDirectory,
  scanStates,
  activeScan,
  getFileCategory,
  getDiskInfo,
  isPathProtected,
  WINDOWS_PROTECTED_DIRS,
  LINUX_PROTECTED_DIRS,
  WINDOWS_CRITICAL_FILES,
  SYSTEM_CRITICAL_EXTENSIONS,
};
