import { NextRequest, NextResponse } from "next/server";
import { scanStates } from "@/lib/scanner";

export async function GET(request: NextRequest) {
  const scanId = request.nextUrl.searchParams.get("scanId");

  if (!scanId) {
    return NextResponse.json(
      { error: "scanId is required" },
      { status: 400 }
    );
  }

  const state = scanStates.get(scanId);
  if (!state) {
    return NextResponse.json(
      { error: "Scan not found" },
      { status: 404 }
    );
  }

  // Calculate progress estimate based on time
  let progress = state.progress;
  if (state.status === "scanning") {
    const elapsed = Date.now() - state.startTime;
    // Rough estimate: assume 30 seconds max scan time
    progress = Math.min(95, Math.floor((elapsed / 30000) * 95));
    state.progress = progress;
  }

  return NextResponse.json({
    ...state,
    progress,
  });
}
