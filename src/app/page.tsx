import React from "react";
import { getRuntimeConfig } from "@/lib/config";
import { ShareWorkbench } from "@/components/ShareWorkbench";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const config = getRuntimeConfig();
  return <ShareWorkbench config={config} />;
}
