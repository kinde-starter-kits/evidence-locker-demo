/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activityLog from "../activityLog.js";
import type * as agentActions from "../agentActions.js";
import type * as agentAuth from "../agentAuth.js";
import type * as authzMode from "../authzMode.js";
import type * as http from "../http.js";
import type * as provenance from "../provenance.js";
import type * as records from "../records.js";
import type * as runEvents from "../runEvents.js";
import type * as seed from "../seed.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activityLog: typeof activityLog;
  agentActions: typeof agentActions;
  agentAuth: typeof agentAuth;
  authzMode: typeof authzMode;
  http: typeof http;
  provenance: typeof provenance;
  records: typeof records;
  runEvents: typeof runEvents;
  seed: typeof seed;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agentAuth: import("@kinde-oss/kinde-convex-agent-auth/_generated/component.js").ComponentApi<"agentAuth">;
};
