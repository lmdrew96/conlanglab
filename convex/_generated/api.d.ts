/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as languages from "../languages.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_history from "../lib/history.js";
import type * as lib_rng from "../lib/rng.js";
import type * as phonology_content from "../phonology/content.js";
import type * as phonology_diff from "../phonology/diff.js";
import type * as phonology_generate from "../phonology/generate.js";
import type * as phonology_mutations from "../phonology/mutations.js";
import type * as phonology_queries from "../phonology/queries.js";
import type * as phonology_sonority from "../phonology/sonority.js";
import type * as phonology_types from "../phonology/types.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  languages: typeof languages;
  "lib/auth": typeof lib_auth;
  "lib/history": typeof lib_history;
  "lib/rng": typeof lib_rng;
  "phonology/content": typeof phonology_content;
  "phonology/diff": typeof phonology_diff;
  "phonology/generate": typeof phonology_generate;
  "phonology/mutations": typeof phonology_mutations;
  "phonology/queries": typeof phonology_queries;
  "phonology/sonority": typeof phonology_sonority;
  "phonology/types": typeof phonology_types;
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

export declare const components: {};
