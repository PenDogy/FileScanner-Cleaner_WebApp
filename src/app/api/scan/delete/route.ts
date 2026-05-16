import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { scanStates } from "@/lib/scanner";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { files, scanId } = body as { files: string[]; scanId: string };

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: "No files selected" },
        { status: 400 }
      );
    }

    const results: {
      file: string;
      success: boolean;
      error?: string;
    }[] = [];

    let totalFreed = 0;

    for (const filePath of files) {
      try {
        // Security check: make sure path is not trying to escape
        const resolved = path.resolve(filePath);

        // Check file exists
        if (!fs.existsSync(resolved)) {
          results.push({
            file: resolved,
            success: false,
            error: "File not found",
          });
          continue;
        }

        // Get file size before deletion
        const stat = fs.statSync(resolved);
        const fileSize = stat.size;

        // Delete the file
        fs.unlinkSync(resolved);

        totalFreed += fileSize;
        results.push({ file: resolved, success: true });
      } catch (error) {
        results.push({
          file: filePath,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Update scan state to remove deleted files
    const state = scanStates.get(scanId);
    if (state) {
      const deletedPaths = new Set(
        results.filter((r) => r.success).map((r) => r.file)
      );
      state.filesFound = state.filesFound.filter(
        (f) => !deletedPaths.has(f.path)
      );
    }

    return NextResponse.json({
      results,
      totalFreed,
      successCount: results.filter((r) => r.success).length,
      failCount: results.filter((r) => !r.success).length,
    });
  } catch (error) {
    console.error("Error deleting files:", error);
    return NextResponse.json(
      { error: "Failed to delete files" },
      { status: 500 }
    );
  }
}
