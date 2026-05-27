/**
 * Central type barrel. Import shared types from "@/types" rather than deep paths.
 *
 * Pattern:
 *   export type { Foo } from "./foo";
 *   export type { Bar, Baz } from "./bar";
 */

// ── Database entity types (inferred from Drizzle schema) ──────────────────────
export type { User, NewUser } from "@/lib/db/schema/users";
export type { VaultItem, NewVaultItem } from "@/lib/db/schema/vault";

// ── API response envelope ─────────────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  data: T | null;
  error: string | null;
}

// ── Pagination ────────────────────────────────────────────────────────────────
export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── Storage ───────────────────────────────────────────────────────────────────
export interface StorageUploadResult {
  key: string;
  publicUrl: string;
  contentType: string;
  size: number;
}
