import { PhonologyPage } from "@/components/phonology/phonology-page";
import type { Id } from "../../../../../convex/_generated/dataModel";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PhonologyPage languageId={id as Id<"languages">} />;
}
