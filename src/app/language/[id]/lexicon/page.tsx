import { LexiconPage } from "@/components/lexicon/lexicon-page";
import type { Id } from "../../../../../convex/_generated/dataModel";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LexiconPage languageId={id as Id<"languages">} />;
}
