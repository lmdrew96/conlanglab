import { TranslatePage } from "@/components/translate/translate-page";
import type { Id } from "../../../../../convex/_generated/dataModel";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TranslatePage languageId={id as Id<"languages">} />;
}
