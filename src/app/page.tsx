"use client";

import React, { useState, useEffect } from "react";
import {
  HardDrive,
  Search,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  FileText,
  File,
  Folder,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Settings2,
  BarChart3,
  Shield,
  ShieldAlert,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";

// Types
interface DriveInfo {
  path: string;
  label: string;
  total: number;
  free: number;
  isSystemDrive?: boolean;
}

interface FileInfo {
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

interface ScanStatus {
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

// Utility functions
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function getDaysColor(days: number): string {
  if (days >= 365) return "text-red-500";
  if (days >= 180) return "text-orange-500";
  if (days >= 90) return "text-yellow-600";
  return "text-muted-foreground";
}

function getTypeBadgeVariant(
  type: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (type) {
    case "Temp Files":
      return "destructive";
    case "Logs":
      return "secondary";
    case "Cache":
      return "secondary";
    case "Build Artifacts":
      return "outline";
    default:
      return "default";
  }
}

export default function Home() {
  const { toast } = useToast();

  // State
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [selectedDrives, setSelectedDrives] = useState<string[]>([]);
  const [selectAllDrives, setSelectAllDrives] = useState(false);
  const [minDaysUnused, setMinDaysUnused] = useState(90);
  const [minFileSizeMB, setMinFileSizeMB] = useState(1);
  const [fileTypeFilter, setFileTypeFilter] = useState("all");
  const [maxDepth, setMaxDepth] = useState(10);

  const [scanId, setScanId] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<string>("daysSinceAccess");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const [showSettings, setShowSettings] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Load drives on mount
  useEffect(() => {
    loadDrives();
  }, []);

  const loadDrives = async () => {
    try {
      const res = await fetch("/api/scan/drives");
      const data = await res.json();
      setDrives(data.drives || []);
    } catch (error) {
      console.error("Error loading drives:", error);
      toast({
        title: "ไม่สามารถโหลดข้อมูล Drive ได้",
        description: "เกิดข้อผิดพลาดในการอ่านข้อมูล drive",
        variant: "destructive",
      });
    }
  };

  // Poll scan status
  useEffect(() => {
    if (!scanId || !isScanning) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/scan/status?scanId=${scanId}`);
        const data = await res.json();
        setScanStatus(data);

        if (data.status === "completed" || data.status === "error") {
          setIsScanning(false);
          clearInterval(interval);

          if (data.status === "completed") {
            const protectedCount = data.filesFound.filter(
              (f: FileInfo) => f.isProtected
            ).length;
            toast({
              title: "สแกนเสร็จสิ้น!",
              description: `พบไฟล์ ${data.filesFound.length} ไฟล์ จาก ${data.totalScanned} ไฟล์ที่สแกน${
                protectedCount > 0
                  ? ` (🛡️ ${protectedCount} ไฟล์ถูกป้องกัน)`
                  : ""
              }`,
            });
          } else {
            toast({
              title: "เกิดข้อผิดพลาดในการสแกน",
              description: data.error || "Unknown error",
              variant: "destructive",
            });
          }
        }
      } catch (error) {
        console.error("Error polling scan status:", error);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [scanId, isScanning, toast]);

  // Start scan
  const startScan = async () => {
    const pathsToScan =
      selectedDrives.length > 0
        ? selectedDrives
        : drives.map((d) => d.path);

    if (pathsToScan.length === 0) {
      toast({
        title: "กรุณาเลือก Drive",
        description: "เลือกอย่างน้อย 1 drive หรือกดสแกนทั้งหมด",
        variant: "destructive",
      });
      return;
    }

    const fileTypeList =
      fileTypeFilter === "all"
        ? []
        : getFileTypeExtensions(fileTypeFilter);

    setIsScanning(true);
    setSelectedFiles(new Set());

    try {
      const res = await fetch("/api/scan/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paths: pathsToScan,
          minDaysUnused,
          minFileSize: minFileSizeMB * 1024 * 1024,
          fileTypes: fileTypeList,
          maxDepth,
        }),
      });

      const data = await res.json();
      if (data.scanId) {
        setScanId(data.scanId);
      }
    } catch (error) {
      console.error("Error starting scan:", error);
      setIsScanning(false);
      toast({
        title: "ไม่สามารถเริ่มสแกนได้",
        description: "เกิดข้อผิดพลาด",
        variant: "destructive",
      });
    }
  };

  // Delete selected files (only non-protected)
  const deleteSelected = async () => {
    if (selectedFiles.size === 0) return;

    setIsDeleting(true);
    try {
      const res = await fetch("/api/scan/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: Array.from(selectedFiles),
          scanId,
        }),
      });

      const data = await res.json();

      if (data.blockedCount > 0) {
        toast({
          title: "ลบไฟล์เสร็จสิ้น (มีไฟล์ถูกป้องกัน)",
          description: `ลบสำเร็จ ${data.successCount} ไฟล์ | ถูกป้องกัน ${data.blockedCount} ไฟล์ | ปล่อยพื้นที่ ${formatBytes(data.totalFreed)}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "ลบไฟล์เสร็จสิ้น",
          description: `ลบสำเร็จ ${data.successCount} ไฟล์ | ปล่อยพื้นที่ ${formatBytes(data.totalFreed)}`,
        });
      }

      // Refresh scan status
      setSelectedFiles(new Set());
      if (scanId) {
        const statusRes = await fetch(`/api/scan/status?scanId=${scanId}`);
        const statusData = await statusRes.json();
        setScanStatus(statusData);
      }
    } catch (error) {
      console.error("Error deleting files:", error);
      toast({
        title: "เกิดข้อผิดพลาดในการลบ",
        description: "ไม่สามารถลบไฟล์ได้",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // Toggle drive selection
  const toggleDrive = (drivePath: string) => {
    setSelectedDrives((prev) =>
      prev.includes(drivePath)
        ? prev.filter((p) => p !== drivePath)
        : [...prev, drivePath]
    );
  };

  // Toggle select all drives
  const toggleSelectAll = () => {
    if (selectAllDrives) {
      setSelectedDrives([]);
    } else {
      setSelectedDrives(drives.map((d) => d.path));
    }
    setSelectAllDrives(!selectAllDrives);
  };

  // File selection — block protected files
  const toggleFile = (filePath: string, isProtected: boolean) => {
    if (isProtected) return; // Can't select protected files
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

  const toggleAllFiles = () => {
    const selectableFiles = filteredFiles.filter((f) => !f.isProtected);
    if (
      selectedFiles.size === selectableFiles.length &&
      selectableFiles.length > 0
    ) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(selectableFiles.map((f) => f.path)));
    }
  };

  // Sorting
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  // Get file type extensions for filter
  function getFileTypeExtensions(type: string): string[] {
    const extensions: Record<string, string[]> = {
      temp: [".tmp", ".temp", ".bak", ".old", ".swp", ".swo"],
      logs: [".log", ".err", ".out"],
      cache: [".cache", ".chunk", ".part"],
      build: [".o", ".obj", ".pyc", ".pyo", ".class", ".sourcemap"],
      archives: [".zip", ".tar", ".gz", ".rar", ".7z", ".bz2"],
    };
    return extensions[type] || [];
  }

  // Filtered and sorted files
  const filteredFiles = React.useMemo(() => {
    if (!scanStatus?.filesFound) return [];

    let files = [...scanStatus.filesFound];

    // Type filter
    if (typeFilter !== "all") {
      files = files.filter((f) => f.type === typeFilter);
    }

    // Sort
    files.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      switch (sortField) {
        case "name":
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case "size":
          aVal = a.size;
          bVal = b.size;
          break;
        case "daysSinceAccess":
          aVal = a.daysSinceAccess;
          bVal = b.daysSinceAccess;
          break;
        case "daysSinceModified":
          aVal = a.daysSinceModified;
          bVal = b.daysSinceModified;
          break;
        case "type":
          aVal = a.type;
          bVal = b.type;
          break;
        default:
          aVal = a.daysSinceAccess;
          bVal = b.daysSinceAccess;
      }

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDirection === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortDirection === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });

    return files;
  }, [scanStatus?.filesFound, typeFilter, sortField, sortDirection]);

  // Statistics
  const stats = React.useMemo(() => {
    if (!scanStatus?.filesFound) return null;

    const files =
      typeFilter === "all"
        ? scanStatus.filesFound
        : scanStatus.filesFound.filter((f) => f.type === typeFilter);

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const selectedSize = files
      .filter((f) => selectedFiles.has(f.path))
      .reduce((sum, f) => sum + f.size, 0);

    const protectedCount = files.filter((f) => f.isProtected).length;
    const protectedSize = files
      .filter((f) => f.isProtected)
      .reduce((sum, f) => sum + f.size, 0);

    const typeCounts: Record<string, number> = {};
    files.forEach((f) => {
      typeCounts[f.type] = (typeCounts[f.type] || 0) + 1;
    });

    return {
      totalFiles: files.length,
      totalSize,
      selectedSize,
      protectedCount,
      protectedSize,
      typeCounts,
    };
  }, [scanStatus?.filesFound, selectedFiles, typeFilter]);

  const uniqueTypes = React.useMemo(() => {
    if (!scanStatus?.filesFound) return [];
    const types = new Set(scanStatus.filesFound.map((f) => f.type));
    return Array.from(types).sort();
  }, [scanStatus?.filesFound]);

  const SortIcon = ({ field }: { field: string }) => (
    <span className="inline-flex ml-1">
      {sortField === field ? (
        sortDirection === "asc" ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )
      ) : (
        <ChevronDown className="h-4 w-4 opacity-30" />
      )}
    </span>
  );

  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-gray-50 to-zinc-100 dark:from-slate-950 dark:via-gray-950 dark:to-zinc-950">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b bg-white/80 dark:bg-slate-950/80 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20">
                  <HardDrive className="h-6 w-6" />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-tight">
                    File Scanner & Cleaner
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    ค้นหาและลบไฟล์ที่ไม่ได้ใช้เพื่อปล่อยพื้นที่
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowSettings(!showSettings)}
                    >
                      <Settings2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>ตั้งค่าขั้นสูง</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          {/* Protection Info Banner */}
          <Card className="border-0 shadow-md bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border-l-4 border-l-amber-400">
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-3">
                <ShieldAlert className="h-5 w-5 text-amber-500 flex-shrink-0" />
                <div className="text-sm">
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    ป้องกันระบบ:
                  </span>{" "}
                  <span className="text-amber-600 dark:text-amber-300">
                    โปรแกรมจะป้องกันไม่ให้ลบไฟล์ระบบ Windows และโฟลเดอร์สำคัญ เช่น Windows, Program Files, System32 ไฟล์เหล่านี้จะแสดงเครื่องหมาย 🛡️ และไม่สามารถเลือกลบได้
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Step 1: Drive Selection */}
          <Card className="border-0 shadow-md">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                  1
                </div>
                <div>
                  <CardTitle className="text-lg">
                    เลือก Drive / โฟลเดอร์
                  </CardTitle>
                  <CardDescription>
                    เลือกพื้นที่ที่ต้องการสแกนหรือกดสแกนทั้งหมด
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 pb-2">
                <Checkbox
                  id="selectAll"
                  checked={
                    selectAllDrives ||
                    selectedDrives.length === drives.length
                  }
                  onCheckedChange={toggleSelectAll}
                />
                <Label
                  htmlFor="selectAll"
                  className="font-medium cursor-pointer"
                >
                  เลือกทั้งหมด
                </Label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {drives.map((drive) => {
                  const isSelected =
                    selectedDrives.includes(drive.path) ||
                    (selectAllDrives &&
                      selectedDrives.length === drives.length);
                  return (
                    <button
                      key={drive.path}
                      onClick={() => toggleDrive(drive.path)}
                      className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all duration-200 text-left hover:shadow-md ${
                        isSelected
                          ? drive.isSystemDrive
                            ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20 shadow-sm"
                            : "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20 shadow-sm"
                          : "border-border bg-card hover:border-emerald-300"
                      }`}
                    >
                      <div
                        className={`p-2 rounded-lg ${
                          isSelected
                            ? drive.isSystemDrive
                              ? "bg-amber-500 text-white"
                              : "bg-emerald-500 text-white"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {drive.isSystemDrive ? (
                          <ShieldAlert className="h-5 w-5" />
                        ) : (
                          <HardDrive className="h-5 w-5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate flex items-center gap-1.5">
                          {drive.label}
                          {drive.isSystemDrive && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-600 dark:text-amber-400"
                            >
                              SYSTEM
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatBytes(drive.free)} ว่าง /{" "}
                          {formatBytes(drive.total)}
                        </div>
                        <Progress
                          value={
                            drive.total > 0
                              ? ((drive.total - drive.free) / drive.total) * 100
                              : 0
                          }
                          className="h-1.5 mt-1.5"
                        />
                      </div>
                    </button>
                  );
                })}
              </div>

              {drives.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Folder className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>กำลังโหลดข้อมูล drive...</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Scan Settings (collapsible) */}
          {showSettings && (
            <Card className="border-0 shadow-md border-l-4 border-l-amber-400">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Settings2 className="h-5 w-5 text-amber-500" />
                  <CardTitle className="text-lg">ตั้งค่าการสแกน</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">
                      ไม่ได้ใช้มากกว่า (วัน)
                    </Label>
                    <div className="flex items-center gap-3">
                      <Slider
                        value={[minDaysUnused]}
                        onValueChange={([v]) => setMinDaysUnused(v)}
                        min={1}
                        max={730}
                        step={1}
                        className="flex-1"
                      />
                      <span className="text-sm font-mono w-14 text-right">
                        {minDaysUnused} วัน
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {minDaysUnused < 30
                        ? "ไฟล์ที่ไม่ได้ใช้น้อยกว่า 1 เดือน"
                        : minDaysUnused < 90
                        ? "ไฟล์ที่ไม่ได้ใช้ 1-3 เดือน"
                        : minDaysUnused < 365
                        ? "ไฟล์ที่ไม่ได้ใช้ 3 เดือน - 1 ปี"
                        : "ไฟล์ที่ไม่ได้ใช้มากกว่า 1 ปี"}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-medium">
                      ขนาดไฟล์ขั้นต่ำ (MB)
                    </Label>
                    <div className="flex items-center gap-3">
                      <Slider
                        value={[minFileSizeMB]}
                        onValueChange={([v]) => setMinFileSizeMB(v)}
                        min={0}
                        max={1024}
                        step={1}
                        className="flex-1"
                      />
                      <span className="text-sm font-mono w-16 text-right">
                        {minFileSizeMB === 0
                          ? "0"
                          : formatBytes(minFileSizeMB * 1024 * 1024)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      กรองไฟล์ที่มีขนาดเล็กเกินไป
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-medium">ประเภทไฟล์</Label>
                    <Select
                      value={fileTypeFilter}
                      onValueChange={setFileTypeFilter}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">ทุกประเภท</SelectItem>
                        <SelectItem value="temp">Temp Files</SelectItem>
                        <SelectItem value="logs">Log Files</SelectItem>
                        <SelectItem value="cache">Cache Files</SelectItem>
                        <SelectItem value="build">Build Artifacts</SelectItem>
                        <SelectItem value="archives">Archives</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      กรองเฉพาะประเภทที่ต้องการ
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-medium">
                      ความลึกในการสแกน
                    </Label>
                    <div className="flex items-center gap-3">
                      <Slider
                        value={[maxDepth]}
                        onValueChange={([v]) => setMaxDepth(v)}
                        min={1}
                        max={20}
                        step={1}
                        className="flex-1"
                      />
                      <span className="text-sm font-mono w-8 text-right">
                        {maxDepth}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      จำนวนระดับโฟลเดอร์ที่จะสแกนเข้าไป
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Scan Button */}
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <Button
              size="lg"
              className="gap-2 px-8 text-base font-semibold shadow-lg shadow-emerald-500/20 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 transition-all"
              onClick={startScan}
              disabled={isScanning}
            >
              {isScanning ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  กำลังสแกน...
                </>
              ) : (
                <>
                  <Search className="h-5 w-5" />
                  เริ่มสแกน
                </>
              )}
            </Button>

            {selectedDrives.length > 0 && (
              <p className="text-sm text-muted-foreground">
                เลือกแล้ว {selectedDrives.length} drive
              </p>
            )}
          </div>

          {/* Scanning Progress */}
          {isScanning && scanStatus && (
            <Card className="border-0 shadow-md border-l-4 border-l-blue-400">
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                      <span className="font-medium">กำลังสแกน...</span>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {scanStatus.totalScanned} ไฟล์ที่สแกนแล้ว
                    </span>
                  </div>
                  <Progress value={scanStatus.progress} className="h-2" />
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Folder className="h-3 w-3" />
                    <span className="truncate max-w-2xl">
                      {scanStatus.currentPath || "กำลังเริ่มต้น..."}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Results */}
          {scanStatus?.status === "completed" &&
            scanStatus.filesFound.length > 0 && (
              <>
                {/* Statistics Cards */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <Card className="border-0 shadow-md">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                          <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">
                            {stats?.totalFiles || 0}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            ไฟล์ที่พบ
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-md">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                          <BarChart3 className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">
                            {formatBytes(stats?.totalSize || 0)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            พื้นที่รวม
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-md border-l-4 border-l-amber-400">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                          <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">
                            {stats?.protectedCount || 0}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            🛡️ ถูกป้องกัน
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-md">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">
                            {selectedFiles.size}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            เลือกแล้ว
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-md">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                          <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">
                            {formatBytes(stats?.selectedSize || 0)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            พื้นที่ที่จะลบ
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Type Filter & Actions */}
                <Card className="border-0 shadow-md">
                  <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                          2
                        </div>
                        <div>
                          <CardTitle className="text-lg">
                            ผลการสแกน
                          </CardTitle>
                          <CardDescription>
                            เลือกไฟล์ที่ต้องการลบแล้วกดปุ่มลบ — ไฟล์ที่มี
                            🛡️ ถูกป้องกันไม่ให้ลบ
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={typeFilter}
                          onValueChange={setTypeFilter}
                        >
                          <SelectTrigger className="w-[160px]">
                            <SelectValue placeholder="กรองประเภท" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">ทุกประเภท</SelectItem>
                            {uniqueTypes.map((type) => (
                              <SelectItem key={type} value={type}>
                                {type} ({stats?.typeCounts[type] || 0})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={selectedFiles.size === 0 || isDeleting}
                              className="gap-1"
                            >
                              {isDeleting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                              ลบ {selectedFiles.size} ไฟล์
                              {stats?.selectedSize
                                ? ` (${formatBytes(stats.selectedSize)})`
                                : ""}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle className="flex items-center gap-2">
                                <AlertTriangle className="h-5 w-5 text-destructive" />
                                ยืนยันการลบไฟล์
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                คุณกำลังจะลบ{" "}
                                <strong>{selectedFiles.size} ไฟล์</strong>{" "}
                                รวมพื้นที่{" "}
                                <strong>
                                  {formatBytes(stats?.selectedSize || 0)}
                                </strong>
                                <br />
                                การกระทำนี้
                                <strong>ไม่สามารถเรียกคืนได้</strong>
                                ไฟล์จะถูกลบถาวรจากระบบ
                                <br />
                                <span className="text-amber-600">
                                  (ไฟล์ระบบที่ถูกป้องกันจะไม่ถูกลบ)
                                </span>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={deleteSelected}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                ลบถาวร
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={startScan}
                          disabled={isScanning}
                          className="gap-1"
                        >
                          <RefreshCw className="h-4 w-4" />
                          สแกนใหม่
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {/* File Table */}
                    <div className="rounded-xl border overflow-hidden">
                      <div className="max-h-[500px] overflow-y-auto">
                        <Table>
                          <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur-sm z-10">
                            <TableRow>
                              <TableHead className="w-12">
                                <Checkbox
                                  checked={
                                    filteredFiles.filter((f) => !f.isProtected)
                                      .length > 0 &&
                                    selectedFiles.size ===
                                      filteredFiles.filter(
                                        (f) => !f.isProtected
                                      ).length
                                  }
                                  onCheckedChange={toggleAllFiles}
                                />
                              </TableHead>
                              <TableHead
                                className="cursor-pointer hover:bg-muted/80"
                                onClick={() => handleSort("name")}
                              >
                                <span className="flex items-center">
                                  ชื่อไฟล์ <SortIcon field="name" />
                                </span>
                              </TableHead>
                              <TableHead
                                className="cursor-pointer hover:bg-muted/80"
                                onClick={() => handleSort("size")}
                              >
                                <span className="flex items-center">
                                  ขนาด <SortIcon field="size" />
                                </span>
                              </TableHead>
                              <TableHead
                                className="cursor-pointer hover:bg-muted/80"
                                onClick={() => handleSort("type")}
                              >
                                <span className="flex items-center">
                                  ประเภท <SortIcon field="type" />
                                </span>
                              </TableHead>
                              <TableHead
                                className="cursor-pointer hover:bg-muted/80"
                                onClick={() => handleSort("daysSinceAccess")}
                              >
                                <span className="flex items-center">
                                  ไม่ได้ใช้ (วัน){" "}
                                  <SortIcon field="daysSinceAccess" />
                                </span>
                              </TableHead>
                              <TableHead
                                className="cursor-pointer hover:bg-muted/80 hidden md:table-cell"
                                onClick={() => handleSort("daysSinceModified")}
                              >
                                <span className="flex items-center">
                                  แก้ไขล่าสุด{" "}
                                  <SortIcon field="daysSinceModified" />
                                </span>
                              </TableHead>
                              <TableHead className="hidden lg:table-cell">
                                ตำแหน่ง
                              </TableHead>
                              <TableHead className="w-16 text-center">
                                สถานะ
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredFiles.map((file) => (
                              <TableRow
                                key={file.id}
                                className={`transition-colors ${
                                  file.isProtected
                                    ? "bg-amber-50/50 dark:bg-amber-950/10 cursor-not-allowed opacity-80"
                                    : selectedFiles.has(file.path)
                                    ? "bg-red-50/50 dark:bg-red-950/10 cursor-pointer hover:bg-muted/50"
                                    : "cursor-pointer hover:bg-muted/50"
                                }`}
                                onClick={() =>
                                  toggleFile(file.path, file.isProtected)
                                }
                              >
                                <TableCell
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Checkbox
                                    checked={selectedFiles.has(file.path)}
                                    onCheckedChange={() =>
                                      toggleFile(file.path, file.isProtected)
                                    }
                                    disabled={file.isProtected}
                                  />
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    <File className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                    <span className="font-medium text-sm truncate max-w-[200px]">
                                      {file.name}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {file.extension}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell className="font-mono text-sm">
                                  {formatBytes(file.size)}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={getTypeBadgeVariant(file.type)}
                                    className="text-xs"
                                  >
                                    {file.type}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <span
                                    className={`font-semibold text-sm ${getDaysColor(
                                      file.daysSinceAccess
                                    )}`}
                                  >
                                    {file.daysSinceAccess}
                                  </span>
                                  <span className="text-xs text-muted-foreground ml-1">
                                    วัน
                                  </span>
                                </TableCell>
                                <TableCell className="hidden md:table-cell">
                                  <span
                                    className={`text-sm ${getDaysColor(
                                      file.daysSinceModified
                                    )}`}
                                  >
                                    {file.daysSinceModified}
                                  </span>
                                  <span className="text-xs text-muted-foreground ml-1">
                                    วัน
                                  </span>
                                </TableCell>
                                <TableCell className="hidden lg:table-cell">
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <span className="text-xs text-muted-foreground truncate max-w-[200px] block">
                                        {file.path}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-sm break-all">
                                      {file.path}
                                    </TooltipContent>
                                  </Tooltip>
                                </TableCell>
                                <TableCell className="text-center">
                                  {file.isProtected ? (
                                    <Tooltip>
                                      <TooltipTrigger>
                                        <div className="flex items-center justify-center">
                                          <ShieldAlert className="h-4 w-4 text-amber-500" />
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-xs">
                                        <p className="font-semibold text-amber-500">
                                          🛡️ ไฟล์ถูกป้องกัน
                                        </p>
                                        <p className="text-xs mt-1">
                                          {file.protectionReason ||
                                            "ไฟล์ระบบ — ห้ามลบ"}
                                        </p>
                                      </TooltipContent>
                                    </Tooltip>
                                  ) : (
                                    <Tooltip>
                                      <TooltipTrigger>
                                        <div className="flex items-center justify-center">
                                          <Lock
                                            className="h-4 w-4 text-muted-foreground opacity-0"
                                          />
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        สามารถลบได้
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    {filteredFiles.length === 0 && (
                      <div className="text-center py-12 text-muted-foreground">
                        <File className="h-16 w-16 mx-auto mb-3 opacity-30" />
                        <p className="text-lg font-medium">ไม่พบไฟล์</p>
                        <p className="text-sm">
                          ลองปรับเงื่อนไขการค้นหาหรือสแกนใหม่
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}

          {/* No results state */}
          {scanStatus?.status === "completed" &&
            scanStatus.filesFound.length === 0 && (
              <Card className="border-0 shadow-md">
                <CardContent className="py-12">
                  <div className="text-center space-y-3">
                    <CheckCircle2 className="h-16 w-16 mx-auto text-emerald-500" />
                    <h3 className="text-xl font-semibold">
                      เครื่องของคุณสะอาดดี!
                    </h3>
                    <p className="text-muted-foreground max-w-md mx-auto">
                      ไม่พบไฟล์ที่ไม่ได้ใช้ตามเงื่อนไขที่ตั้งไว้
                      ลองปรับลดจำนวนวันหรือขนาดไฟล์ขั้นต่ำแล้วสแกนใหม่
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowSettings(true);
                      }}
                      className="gap-2"
                    >
                      <Settings2 className="h-4 w-4" />
                      ปรับตั้งค่า
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

          {/* Error state */}
          {scanStatus?.status === "error" && (
            <Card className="border-0 shadow-md border-l-4 border-l-red-400">
              <CardContent className="py-8">
                <div className="text-center space-y-3">
                  <XCircle className="h-16 w-16 mx-auto text-red-500" />
                  <h3 className="text-xl font-semibold">เกิดข้อผิดพลาด</h3>
                  <p className="text-muted-foreground">
                    {scanStatus.error || "Unknown error"}
                  </p>
                  <Button
                    variant="outline"
                    onClick={startScan}
                    className="gap-2"
                  >
                    <RefreshCw className="h-4 w-4" />
                    ลองอีกครั้ง
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Info card - shown initially */}
          {!scanStatus && (
            <Card className="border-0 shadow-md bg-gradient-to-br from-slate-50 to-zinc-50 dark:from-slate-900 dark:to-zinc-900">
              <CardContent className="py-8">
                <div className="text-center space-y-4 max-w-lg mx-auto">
                  <Shield className="h-12 w-12 mx-auto text-emerald-500" />
                  <h3 className="text-lg font-semibold">
                    วิธีใช้งาน File Scanner & Cleaner
                  </h3>
                  <div className="text-left space-y-3 text-sm text-muted-foreground">
                    <div className="flex items-start gap-3">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-bold text-xs flex-shrink-0 mt-0.5">
                        1
                      </div>
                      <p>
                        <strong>เลือก Drive</strong> — เลือก drive หรือโฟลเดอร์ที่ต้องการสแกน
                        หรือกดเลือกทั้งหมด
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-bold text-xs flex-shrink-0 mt-0.5">
                        2
                      </div>
                      <p>
                        <strong>ตั้งค่า</strong> — ปรับเงื่อนไขการสแกน เช่น จำนวนวันที่ไม่ได้ใช้
                        ขนาดไฟล์ขั้นต่ำ และประเภทไฟล์
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-bold text-xs flex-shrink-0 mt-0.5">
                        3
                      </div>
                      <p>
                        <strong>สแกน & ลบ</strong> — กดปุ่มสแกน ตรวจสอบผลลัพธ์
                        เลือกไฟล์ที่ต้องการลบแล้วยืนยัน
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 p-3 rounded-lg">
                    <ShieldAlert className="h-4 w-4 flex-shrink-0" />
                    <span>
                      ไฟล์ระบบ Windows และไฟล์สำคัญจะถูกป้องกันไม่ให้ลบ — ปลอดภัย 100%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </main>

        {/* Footer */}
        <footer className="mt-auto border-t bg-white/80 dark:bg-slate-950/80 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>Copyright &copy; 2026 Pendogy</span>
              <div className="flex items-center gap-1">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                <span>ป้องกันไฟล์ระบบ Windows อัตโนมัติ</span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}
