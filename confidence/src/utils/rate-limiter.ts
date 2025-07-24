/*
 * Copyright 2025, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import makeDebug from 'debug';

const debug = makeDebug('confidence:rate-limiter');

type QueuedRequest<T extends Response> = {
  execute: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (error: unknown) => void;
};

/**
 * A rate limiter that controls the frequency of requests using a sliding window approach.
 *
 * This class implements a queue-based rate limiter that ensures no more than a specified
 * number of requests are executed within a given time window. Requests that exceed the
 * rate limit are queued and executed when the rate limit allows.
 *
 * @example
 * ```typescript
 * // Create a rate limiter that allows 10 requests per minute
 * const rateLimiter = new RateLimiter(10, 60_000);
 *
 * // Enqueue API calls
 * const result1 = await rateLimiter.enqueue(() => fetch('/api/data1'));
 * const result2 = await rateLimiter.enqueue(() => fetch('/api/data2'));
 *
 * // Check current status
 * const status = rateLimiter.getStatus();
 * console.log(`Queue length: ${status.queueLength}`);
 * console.log(`Requests in window: ${status.requestsInWindow}`);
 * ```
 */
export class RateLimiter {
  private static completed: number = 0;
  private static failed: number = 0;

  private readonly requestTimestamps: number[] = [];
  private readonly queue: Array<QueuedRequest<Response>> = [];
  private isProcessing = false;

  public constructor(private readonly maxRequests = 40, private readonly windowMs = 60_000) {}

  /**
   * Utility function to sleep for a given number of milliseconds
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Executes a single request and handles its completion
   */
  private static async executeRequest(request: QueuedRequest<Response>): Promise<void> {
    try {
      const result = await request.execute();
      this.completed++;
      request.resolve(result);
    } catch (error) {
      this.failed++;
      request.reject(error);
    }
  }

  /**
   * Enqueues a request to be executed when rate limit allows
   *
   * @param requestFn Function that returns a promise for the actual request
   * @returns Promise that resolves when the request is executed
   */
  public async enqueue(requestFn: () => Promise<Response>): Promise<Response> {
    debug('Enqueuing request: %O', this.getStatus());
    return new Promise<Response>((resolve, reject) => {
      this.queue.push({
        execute: requestFn,
        resolve,
        reject,
      });

      // Start processing if not already running
      if (!this.isProcessing) {
        void this.processQueue();
      }
    });
  }

  /**
   * Gets current queue status for monitoring/debugging
   */
  public getStatus(): {
    queueLength: number;
    requestsInWindow: number;
    maxRequests: number;
    canExecute: boolean;
    nextAvailableSlot?: number;
    isProcessing: boolean;
    completed: number;
    failed: number;
  } {
    const now = Date.now();
    this.cleanupOldTimestamps(now);

    return {
      queueLength: this.queue.length,
      requestsInWindow: this.requestTimestamps.length,
      maxRequests: this.maxRequests,
      canExecute: this.canExecuteRequest(),
      nextAvailableSlot: this.requestTimestamps.length > 0 ? this.requestTimestamps[0] + this.windowMs : undefined,
      isProcessing: this.isProcessing,
      completed: RateLimiter.completed,
      failed: RateLimiter.failed,
    };
  }

  /**
   * Processes the queue, executing requests when rate limit allows
   */
  private async processQueue(): Promise<void> {
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const now = Date.now();

      // Remove timestamps outside the current window
      this.cleanupOldTimestamps(now);

      if (this.canExecuteRequest()) {
        debug('Executing request: %O', this.getStatus());
        // Execute the next request without waiting for it to complete
        const request = this.queue.shift()!;
        this.recordRequest(now);

        // Execute the request asynchronously - don't await
        void RateLimiter.executeRequest(request);

        // Add a small delay to prevent burst requests from overwhelming the rate limit
        // This spreads out request initiation while still allowing parallelization
        // eslint-disable-next-line no-await-in-loop
        await RateLimiter.sleep(Math.ceil(this.windowMs / this.maxRequests));
      } else {
        // Wait until we can make the next request
        const delay = this.calculateDelay(now);
        // eslint-disable-next-line no-await-in-loop
        await RateLimiter.sleep(delay);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Checks if a request can be executed based on current rate limit
   */
  private canExecuteRequest(): boolean {
    return this.requestTimestamps.length < this.maxRequests;
  }

  /**
   * Records the timestamp of a request
   */
  private recordRequest(timestamp: number): void {
    this.requestTimestamps.push(timestamp);
  }

  /**
   * Removes timestamps that are outside the current window
   */
  private cleanupOldTimestamps(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.requestTimestamps.length > 0 && this.requestTimestamps[0] < cutoff) {
      this.requestTimestamps.shift();
    }
  }

  /**
   * Calculates how long to wait before the next request can be made
   */
  private calculateDelay(now: number): number {
    if (this.requestTimestamps.length === 0) {
      return 0;
    }

    // If we're at the limit, wait until the oldest request expires
    if (this.requestTimestamps.length >= this.maxRequests) {
      const oldestRequest = this.requestTimestamps[0];
      const timeUntilExpiry = oldestRequest + this.windowMs - now;
      return Math.max(0, timeUntilExpiry + 100); // Add 100ms buffer
    }

    return 0;
  }
}
