export interface TemplatePreview {
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  layout: string;
  backgroundEffect: string;
  profileFont: string;
  hasBackground: boolean;
  hasAudio: boolean;
  trackCount: number;
}

export interface ProfileTemplate {
  id: string;
  slug: string;
  name: string;
  description: string;
  preview: TemplatePreview;
  previewImageUrl?: string | null;
  published: boolean;
  tags: string[];
  visibility: "public" | "private" | "unlisted";
  is_favorite?: boolean;
  created_by?: string | null;
  creator_username?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/templates${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => ({})) as { detail?: string; error?: string };
  if (!response.ok) throw new Error(String(body.detail || body.error || "Template request failed."));
  return body as T;
}

export async function listTemplates(filters?: { q?: string; tag?: string; sort?: "latest" | "popular" | "week" | "month" | "all_time" }) {
  const params = new URLSearchParams();
  if (filters?.q?.trim()) params.set("q", filters.q.trim());
  if (filters?.tag?.trim()) params.set("tag", filters.tag.trim());
  if (filters?.sort) params.set("sort", filters.sort);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const result = await request<{ templates: ProfileTemplate[] }>(suffix);
  return result.templates || [];
}

export async function listMyTemplates() {
  const result = await request<{ templates: ProfileTemplate[] }>("/me");
  return result.templates || [];
}

export async function publishTemplate(name: string, description: string, tags: string[] = [], visibility: ProfileTemplate["visibility"] = "public", previewImageUrl?: string | null) {
  const result = await request<{ template: ProfileTemplate }>("", {
    method: "POST",
    body: JSON.stringify({ name, description, tags, visibility, preview_image_url: previewImageUrl || null }),
  });
  return result.template;
}

export async function applyTemplate(id: string) {
  return request<{ profile: unknown }>("/apply", { method: "POST", body: JSON.stringify({ id }) });
}

export async function refreshTemplate(id: string, previewImageUrl?: string | null) {
  const result = await request<{ template: ProfileTemplate }>(`/${id}/refresh`, { method: "POST", body: JSON.stringify({ preview_image_url: previewImageUrl || null }) });
  return result.template;
}

export async function updateTemplate(id: string, payload: { name?: string; description?: string; published?: boolean; tags?: string[]; visibility?: ProfileTemplate["visibility"] }) {
  const result = await request<{ template: ProfileTemplate }>(`/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return result.template;
}

export async function favoriteTemplate(id: string, favorite: boolean) {
  return request<{ favorite: boolean }>(`/${id}/favorite`, {
    method: "POST",
    body: JSON.stringify({ favorite }),
  });
}

export async function getTemplateBySlug(slug: string) {
  const result = await request<{ template: ProfileTemplate }>(`/slug/${encodeURIComponent(slug)}`);
  return result.template;
}

export async function deleteTemplate(id: string) {
  await request<{ ok: boolean }>(`/${id}`, { method: "DELETE" });
}
