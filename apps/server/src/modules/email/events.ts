import { EventEmitter } from "node:events";

/**
 * Shared event emitter for the email queue system.
 *
 * Both the EmailService (producer) and the queue worker (consumer)
 * import from this module, avoiding a circular dependency between them.
 *
 * Events:
 * - `"wake"` — emitted when a priority-1 job is enqueued, so the
 *   queue worker can process it immediately instead of waiting for
 *   the next poll interval.
 */
export const emailQueueEvents = new EventEmitter();
