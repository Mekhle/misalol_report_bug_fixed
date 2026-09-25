import type { BackgroundEffect, ProfileConfig } from "./types";
import { dashboardRequest, peekDashboardCache, setDashboardCache } from "./dashboard-cache";

export type ConstellationAssignmentMode = "owner" | "self";
export type ConstellationFrameMode = "member" | "framed" | "frameless";
export type ConstellationFrameOverride = "inherit" | "framed" | "frameless";

export interface ConstellationIdentity {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
}

export interface ConstellationAsset {
  url: string;
  key: string;
  name?: string;
  contentType?: string;
  title?: string;
}

export interface ConstellationBackground extends Partial<ConstellationAsset> {
  type: "color" | "image" | "video";
  color: string;
}

export interface ConstellationSharedAssets {
  cursor: ConstellationAsset | null;
  audio: ConstellationAsset | null;
  audioCover: ConstellationAsset | null;
  effectVideo: ConstellationAsset | null;
  effect: BackgroundEffect;
}

export interface ConstellationMember {
  userId?: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  role: "owner" | "member";
  slot: number;
  position: { x: number; y: number };
  scale: number;
  frameOverride: ConstellationFrameOverride;
  joinedAt?: string;
  active?: boolean;
  profile?: ProfileConfig;
}

export interface ConstellationInvitation {
  id: string;
  groupId: string;
  groupName?: string;
  capacity?: number;
  userId?: string | null;
  username?: string | null;
  inviterUsername?: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  token?: string;
  joinPath?: string;
}

export interface ConstellationGroup {
  id: string;
  ownerId?: string;
  ownerUsername?: string | null;
  name: string;
  slug: string;
  description: string;
  capacity: number;
  assignmentMode: ConstellationAssignmentMode;
  globalFont: string;
  allowMemberFonts: boolean;
  allowMemberMove: boolean;
  allowMemberResize: boolean;
  frameMode: ConstellationFrameMode;
  background: ConstellationBackground;
  sharedAssets: ConstellationSharedAssets;
  status: "draft" | "published" | "suspended";
  published: boolean;
  publicPath: string;
  members: ConstellationMember[];
  invitations: ConstellationInvitation[];
  availableSlots: number[];
  canPublish: boolean;
  hasUnpublishedChanges: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
}

export type PublicConstellation = Omit<ConstellationGroup, "ownerId" | "invitations" | "availableSlots">;

export interface ConstellationList {
  groups: ConstellationGroup[];
  invitations: ConstellationInvitation[];
}

export interface ConstellationBootstrap {
  me: ConstellationIdentity;
}

export interface ConstellationMutation {
  group?: ConstellationGroup;
  invitation?: ConstellationInvitation;
  accepted?: boolean;
  deleted?: boolean;
  left?: boolean;
}

export type ConstellationDashboardData = ConstellationBootstrap & ConstellationList;

const CONSTELLATION_BOOTSTRAP_KEY = "constellations:bootstrap";
const CONSTELLATION_LIST_KEY = "constellations:list";

export function peekConstellationDashboard(): ConstellationDashboardData | undefined {
  const boot = peekDashboardCache<ConstellationBootstrap>(CONSTELLATION_BOOTSTRAP_KEY);
  const list = peekDashboardCache<ConstellationList>(CONSTELLATION_LIST_KEY);
  return boot && list ? { ...boot, ...list } : undefined;
}

export function cacheConstellationDashboard(data: ConstellationDashboardData) {
  setDashboardCache(CONSTELLATION_BOOTSTRAP_KEY, { me: data.me });
  setDashboardCache(CONSTELLATION_LIST_KEY, { groups: data.groups, invitations: data.invitations });
}

export async function loadConstellationDashboard(force = false): Promise<ConstellationDashboardData> {
  const [boot, list] = await Promise.all([
    dashboardRequest(CONSTELLATION_BOOTSTRAP_KEY, () => constellationApi.bootstrap(), { maxAge: 2 * 60_000, force }),
    dashboardRequest(CONSTELLATION_LIST_KEY, () => constellationApi.list(), { maxAge: 2 * 60_000, force }),
  ]);
  return { ...boot, ...list };
}
async function request<T>(path = "", method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const form = typeof FormData !== "undefined" && body instanceof FormData;
  const response = await fetch(`/api/constellations${path}`, {
    method,
    credentials: "include",
    cache: "no-store",
    signal,
    headers: body === undefined || form ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null) as T & { detail?: string | { msg: string }[] } | null;
  if (!response.ok || !data) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((item) => item.msg).join(". ") : `Constellation request failed (${response.status}).`);
  }
  return data;
}

const segment = encodeURIComponent;
export const constellationApi = {
  bootstrap: (signal?: AbortSignal) => request<ConstellationBootstrap>("/bootstrap", "GET", undefined, signal),
  list: (signal?: AbortSignal) => request<ConstellationList>("", "GET", undefined, signal),
  publicGroup: (slug: string, signal?: AbortSignal) => request<{ group: PublicConstellation }>(`/public/${segment(slug)}`, "GET", undefined, signal),
  create: (body: { name: string; slug: string; capacity: number; assignmentMode: ConstellationAssignmentMode }) => request<ConstellationMutation>("", "POST", body),
  update: (id: string, body: Partial<Pick<ConstellationGroup, "name" | "slug" | "description" | "capacity" | "assignmentMode" | "globalFont" | "allowMemberFonts" | "allowMemberMove" | "allowMemberResize" | "frameMode">>) => request<ConstellationMutation>(`/${segment(id)}`, "PATCH", body),
  createInvite: (id: string, username?: string) => request<ConstellationMutation>(`/${segment(id)}/invite`, "POST", { username: username || null }),
  join: (token: string) => request<ConstellationMutation>(`/join/${segment(token)}`, "POST"),
  respond: (invitation: ConstellationInvitation, accept: boolean) => request<ConstellationMutation>(`/${segment(invitation.groupId)}/invitations/${segment(invitation.id)}/respond`, "POST", { accept }),
  revokeInvite: (id: string, invitationId: string) => request<ConstellationMutation>(`/${segment(id)}/invitations/${segment(invitationId)}`, "DELETE"),
  updateMember: (id: string, memberId: string, body: Partial<Pick<ConstellationMember, "slot" | "position" | "scale" | "frameOverride">>) => request<ConstellationMutation>(`/${segment(id)}/members/${segment(memberId)}`, "PATCH", body),
  updateProfile: (id: string, profile: ProfileConfig) => request<ConstellationMutation>(`/${segment(id)}/profile`, "PUT", profile),
  removeMember: (id: string, userId: string) => request<ConstellationMutation>(`/${segment(id)}/members/${segment(userId)}`, "DELETE"),
  transfer: (id: string, userId: string) => request<ConstellationMutation>(`/${segment(id)}/transfer`, "POST", { userId }),
  publish: (id: string) => request<ConstellationMutation>(`/${segment(id)}/publish`, "POST"),
  unpublish: (id: string) => request<ConstellationMutation>(`/${segment(id)}/unpublish`, "POST"),
  uploadBackground: (id: string, kind: "image" | "video", color: string, file: File) => {
    const form = new FormData();
    form.set("kind", kind);
    form.set("color", color);
    form.set("file", file);
    return request<ConstellationMutation>(`/${segment(id)}/background`, "POST", form);
  },
  setBackgroundColor: (id: string, color: string) => request<ConstellationMutation>(`/${segment(id)}/background`, "PATCH", { color }),
  removeBackground: (id: string) => request<ConstellationMutation>(`/${segment(id)}/background`, "DELETE"),
  uploadSharedAsset: (id: string, kind: "cursor" | "audio" | "audioCover" | "effectVideo", file: File, title = "") => {
    const form = new FormData();
    form.set("file", file);
    if (kind === "audio" && title.trim()) form.set("title", title.trim());
    return request<ConstellationMutation>(`/${segment(id)}/shared/${kind}`, "POST", form);
  },
  removeSharedAsset: (id: string, kind: "cursor" | "audio" | "audioCover" | "effectVideo") => request<ConstellationMutation>(`/${segment(id)}/shared/${kind}`, "DELETE"),
  setSharedEffect: (id: string, effect: BackgroundEffect) => request<ConstellationMutation>("/" + segment(id) + "/shared/effect", "PATCH", { effect }),
  delete: (id: string) => request<ConstellationMutation>(`/${segment(id)}`, "DELETE"),
};

export function constellationError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function defaultConstellationPositions(count: number): Array<{ x: number; y: number }> {
  if (count === 2) return [{ x: 27, y: 50 }, { x: 73, y: 50 }];
  if (count === 3) return [{ x: 50, y: 27 }, { x: 25, y: 68 }, { x: 75, y: 68 }];
  if (count === 4) return [{ x: 28, y: 30 }, { x: 72, y: 30 }, { x: 28, y: 72 }, { x: 72, y: 72 }];
  throw new Error("Constellations support 2–4 profiles.");
}

export function defaultConstellationScale(count: number): number {
  if (count === 2) return .86;
  if (count === 3) return .76;
  if (count === 4) return .62;
  throw new Error("Constellations support 2–4 profiles.");
}

export const constellationExamples = [
  { count: 2, label: "Duo", description: "Two complete profiles side by side." },
  { count: 3, label: "Triangle", description: "One profile above two profiles." },
  { count: 4, label: "Grid", description: "Four profiles in a balanced two-by-two composition." },
] as const;
