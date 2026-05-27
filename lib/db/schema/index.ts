/**
 * Barrel re-export for all Drizzle schema definitions.
 *
 * Add new domain schema files here as the project grows:
 *   export * from "./posts";
 *   export * from "./media";
 *   export * from "./classifications";
 *
 * drizzle.config.ts points at this file so drizzle-kit introspects all
 * tables in one pass regardless of how many domain files exist.
 */
export * from "./users";
export * from "./vault";
