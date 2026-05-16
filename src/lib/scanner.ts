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

function getDrives(): { path: string; label: string; total: number; free: number }[] {
  const drives: { path: string; label: string; total: number; free: number }[] = [];

  if (process.platform === "win32") {
    // Windows: check A-Z drives
    for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const drivePath = `${letter}:\\`;
      try {
        const stats = fs.statSync(drivePath);
        if (stats) {
          const diskInfo = getDiskInfo(drivePath);
          drives.push({
            path: drivePath,
            label: `Drive ${letter}:`,
            total: diskInfo.total,
            free: diskInfo.free,
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
      label: "Root (/)",
      total: rootInfo.total,
      free: rootInfo.free,
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
        // Skip hidden directories, node_modules, .git, etc.
        if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__pycache__") {
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
};
