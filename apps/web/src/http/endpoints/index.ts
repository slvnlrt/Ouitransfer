/**
 * API endpoint functions.
 *
 * Convention: endpoint functions use concrete return types (e.g., Promise<LoginResult>),
 * NOT generic type parameters like <TData = LoginResult>. The generic pattern allowed
 * callers to override the return type to anything, defeating type safety.
 * See TD-1 for details.
 */

export * from "./admin";
export * from "./app";
export * from "./auth";
export * from "./auth/trusted-devices";
export * from "./config";
export * from "./files";
export * from "./folders";
export * from "./invite";
export * from "./reverse-shares";
export * from "./shares";
export * from "./users";
