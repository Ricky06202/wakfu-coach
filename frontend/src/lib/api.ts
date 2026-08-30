export type Mode = "llm" | "extractive" | "strict";

export interface ChatSource {
  title: string;
  url: string | null;
  sourceType: string;
}

export interface ItemEffect {
  label: string;
  value: string;
}

export interface ItemEntity {
  kind: "item";
  id: number;
  name: string;
  level: number;
  type: string;
  category: string | null;
  rarity: string;
  description: string | null;
  effects: ItemEffect[];
  obtain: string | null;
  imageUrl: string | null;
  url: string | null;
}

export interface Ingredient {
  name: string;
  quantity: number;
  isResource?: boolean;
}

export interface RecipeEntity {
  kind: "recipe";
  id: number;
  itemName: string;
  profession: string;
  professionLevel: number;
  yields: number;
  ingredients: Ingredient[];
  cost: number | null;
  url: string | null;
}

export type Entity = ItemEntity | RecipeEntity;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
  mode?: Mode;
  entities?: Entity[];
}

export interface ChatResponse {
  answer: string;
  mode: Mode;
  sources: ChatSource[];
  retrievedCount: number;
  entities: Entity[];
}

export interface ProfileItem {
  key: string;
  value: string;
}

export const API_BASE: string = (import.meta.env.PUBLIC_API_BASE as string | undefined) ?? "";

export async function chatRequest(messages: ChatMessage[], images: string[] = [], profile: ProfileItem[] = []): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: messages.map(({ role, content }) => ({ role, content })),
      images,
      profile,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(body?.error?.message ?? `Error ${res.status}`);
  }
  return (await res.json()) as ChatResponse;
}
