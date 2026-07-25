import { OrthographyPage } from "@/components/orthography/orthography-page";
import type { Id } from "../../../../../convex/_generated/dataModel";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrthographyPage languageId={id as Id<"languages">} />;
}
