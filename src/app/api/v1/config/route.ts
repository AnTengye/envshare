import { NextResponse } from "next/server";
import { getRuntimeConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getRuntimeConfig();
  return NextResponse.json(config);
}
