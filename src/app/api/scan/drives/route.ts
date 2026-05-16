import { NextResponse } from "next/server";
import { getDrives } from "@/lib/scanner";

export async function GET() {
  try {
    const drives = getDrives();
    return NextResponse.json({ drives });
  } catch (error) {
    console.error("Error getting drives:", error);
    return NextResponse.json(
      { error: "Failed to get drives" },
      { status: 500 }
    );
  }
}
