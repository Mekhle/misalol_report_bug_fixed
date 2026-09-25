import { ConstellationExamplesView } from "@/components/constellations/ConstellationExamplesView";

export default async function ConstellationExamplesPage({ searchParams }: { searchParams: Promise<{ count?: string }> }) {
  const count = Number((await searchParams).count);
  const initialCount = count === 3 || count === 4 ? count : 2;
  return <ConstellationExamplesView initialCount={initialCount} />;
}
