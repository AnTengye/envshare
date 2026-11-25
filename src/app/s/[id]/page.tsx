import React from "react";
import { UnsealView } from "@/components/UnsealView";

export const dynamic = "force-dynamic";

export default async function SecretUnsealPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  return <UnsealView initialId={id} />;
}
