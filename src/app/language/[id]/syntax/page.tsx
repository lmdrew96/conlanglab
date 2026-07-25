import { SyntaxPage } from "@/components/syntax/syntax-page";
import type { Id } from "../../../../../convex/_generated/dataModel";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SyntaxPage languageId={id as Id<"languages">} />;
}
