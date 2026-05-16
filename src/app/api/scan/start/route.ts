import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  ScanOptions,
  ScanState,
  FileInfo,
  scanDirectory,
  scanStates,
} from "@/lib/scanner";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      paths,
      minDaysUnused = 90,
      minFileSize = 1048576, // 1MB default
      fileTypes = [],
      maxDepth = 10,
    } = body as ScanOptions;

    if (!paths || paths.length === 0) {
      return NextResponse.json(
        { error: "At least one path is required" },
        { status: 400 }
      );
    }

    const scanId = randomUUID();
    const scanState: ScanState = {
      id: scanId,
      status: "scanning",
      progress: 0,
      currentPath: "",
      totalScanned: 0,
      filesFound: [],
      startTime: Date.now(),
    };

    scanStates.set(scanId, scanState);

    // Run scan asynchronously
    const controller = new AbortController();
    const signal = controller.signal;

    // Start the scan in background
    (async () => {
      try {
        for (const scanPath of paths) {
          if (signal.aborted) break;
          await scanDirectory(
            scanPath,
            {
              paths,
              minDaysUnused,
              minFileSize,
              fileTypes,
              maxDepth,
            },
            scanState,
            0,
            signal
          );
        }

        // Sort by days since access (most unused first)
        scanState.filesFound.sort(
          (a: FileInfo, b: FileInfo) => b.daysSinceAccess - a.daysSinceAccess
        );

        scanState.status = "completed";
        scanState.progress = 100;
        scanState.endTime = Date.now();
      } catch (error) {
        scanState.status = "error";
        scanState.error =
          error instanceof Error ? error.message : "Unknown error";
        scanState.endTime = Date.now();
      }
    })();

    return NextResponse.json({
      scanId,
      message: "Scan started",
    });
  } catch (error) {
    console.error("Error starting scan:", error);
    return NextResponse.json(
      { error: "Failed to start scan" },
      { status: 500 }
    );
  }
}
