import { MorphologyPage } from "@/components/morphology/morphology-page";
import type { Id } from "../../../../../convex/_generated/dataModel";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MorphologyPage languageId={id as Id<"languages">} />;
}
