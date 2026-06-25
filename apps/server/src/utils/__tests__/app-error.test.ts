import { describe, expect, it } from "vitest";

import {
  AppError,
  ConflictError,
  ForbiddenError,
  GoneError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../app-error.js";

describe("AppError (5.16)", () => {
  it("creates a basic AppError", () => {
    const err = new AppError(409, "Already exists", "ALREADY_EXISTS");
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe("Already exists");
    expect(err.code).toBe("ALREADY_EXISTS");
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });

  it("NotFoundError defaults to 404", () => {
    const err = new NotFoundError("User not found");
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
  });

  it("ValidationError defaults to 400", () => {
    const err = new ValidationError("Invalid input");
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("ForbiddenError defaults to 403", () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("Access denied");
  });

  it("UnauthorizedError defaults to 401", () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("UNAUTHORIZED");
  });

  it("ConflictError defaults to 409", () => {
    const err = new ConflictError("Duplicate entry");
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe("CONFLICT");
  });

  it("GoneError defaults to 410", () => {
    const err = new GoneError("Resource expired");
    expect(err.statusCode).toBe(410);
    expect(err.code).toBe("GONE");
  });

  it("supports structured details", () => {
    const err = new ValidationError("Bad fields", { fields: ["email", "name"] });
    expect(err.details).toEqual({ fields: ["email", "name"] });
  });

  it("has correct name property", () => {
    const err = new AppError(400, "test", "TEST");
    expect(err.name).toBe("AppError");
  });

  it("subclasses preserve AppError name", () => {
    const err = new NotFoundError();
    expect(err.name).toBe("AppError");
    expect(err instanceof AppError).toBe(true);
  });
});
