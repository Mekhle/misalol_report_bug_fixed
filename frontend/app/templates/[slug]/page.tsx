import { TemplateDetailView } from "@/components/more/TemplateDetailView";

export default async function TemplateSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TemplateDetailView slug={slug} />;
}
