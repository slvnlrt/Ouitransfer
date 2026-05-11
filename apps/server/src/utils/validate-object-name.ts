import { ValidationError } from "./app-error.js";

/**
 * Validates that an objectName is safe and belongs to the expected namespace.
 *
 * Checks:
 * 1. Rejects null bytes (path injection protection)
 * 2. Rejects `..` path traversal sequences
 * 3. Validates the objectName starts with `${expectedPrefix}/`
 *
 * @param objectName - The object name to validate
 * @param expectedPrefix - The expected namespace prefix (e.g. userId or `reverse-shares/${id}`)
 * @throws {ValidationError} if validation fails
 */
export function validateObjectName(objectName: string, expectedPrefix: string): void {
  // Reject null bytes (path injection protection)
  if (objectName.includes("\0")) {
    throw new ValidationError("Invalid object name: contains null bytes");
  }

  // Reject path traversal attempts
  if (objectName.includes("..")) {
    throw new ValidationError("Invalid object name: contains path traversal sequences");
  }

  // Validate that objectName starts with the expected namespace
  const prefix = `${expectedPrefix}/`;
  if (!objectName.startsWith(prefix)) {
    throw new ValidationError("Invalid object name: does not belong to this namespace");
  }
}
