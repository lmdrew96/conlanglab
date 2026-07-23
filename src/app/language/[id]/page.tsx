import { LanguageDetail } from "@/components/language-detail";

export default async function LanguagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LanguageDetail id={id} />;
}
