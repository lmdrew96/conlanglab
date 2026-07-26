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
import type * as lexicon_content from "../lexicon/content.js";
import type * as lexicon_diff from "../lexicon/diff.js";
import type * as lexicon_generate from "../lexicon/generate.js";
import type * as lexicon_mutations from "../lexicon/mutations.js";
import type * as lexicon_queries from "../lexicon/queries.js";
import type * as lexicon_staleness from "../lexicon/staleness.js";
import type * as lexicon_types from "../lexicon/types.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_history from "../lib/history.js";
import type * as lib_rng from "../lib/rng.js";
import type * as morphology_content from "../morphology/content.js";
import type * as morphology_diff from "../morphology/diff.js";
import type * as morphology_generate from "../morphology/generate.js";
import type * as morphology_mutations from "../morphology/mutations.js";
import type * as morphology_queries from "../morphology/queries.js";
import type * as morphology_staleness from "../morphology/staleness.js";
import type * as morphology_types from "../morphology/types.js";
import type * as orthography_content from "../orthography/content.js";
import type * as orthography_diff from "../orthography/diff.js";
import type * as orthography_generate from "../orthography/generate.js";
import type * as orthography_mutations from "../orthography/mutations.js";
import type * as orthography_queries from "../orthography/queries.js";
import type * as orthography_render from "../orthography/render.js";
import type * as orthography_staleness from "../orthography/staleness.js";
import type * as orthography_types from "../orthography/types.js";
import type * as phonology_content from "../phonology/content.js";
import type * as phonology_diff from "../phonology/diff.js";
import type * as phonology_generate from "../phonology/generate.js";
import type * as phonology_mutations from "../phonology/mutations.js";
import type * as phonology_queries from "../phonology/queries.js";
import type * as phonology_sonority from "../phonology/sonority.js";
import type * as phonology_types from "../phonology/types.js";
import type * as syntax_content from "../syntax/content.js";
import type * as syntax_diff from "../syntax/diff.js";
import type * as syntax_generate from "../syntax/generate.js";
import type * as syntax_mutations from "../syntax/mutations.js";
import type * as syntax_queries from "../syntax/queries.js";
import type * as syntax_types from "../syntax/types.js";
import type * as translate_content from "../translate/content.js";
import type * as translate_translate from "../translate/translate.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  languages: typeof languages;
  "lexicon/content": typeof lexicon_content;
  "lexicon/diff": typeof lexicon_diff;
  "lexicon/generate": typeof lexicon_generate;
  "lexicon/mutations": typeof lexicon_mutations;
  "lexicon/queries": typeof lexicon_queries;
  "lexicon/staleness": typeof lexicon_staleness;
  "lexicon/types": typeof lexicon_types;
  "lib/auth": typeof lib_auth;
  "lib/history": typeof lib_history;
  "lib/rng": typeof lib_rng;
  "morphology/content": typeof morphology_content;
  "morphology/diff": typeof morphology_diff;
  "morphology/generate": typeof morphology_generate;
  "morphology/mutations": typeof morphology_mutations;
  "morphology/queries": typeof morphology_queries;
  "morphology/staleness": typeof morphology_staleness;
  "morphology/types": typeof morphology_types;
  "orthography/content": typeof orthography_content;
  "orthography/diff": typeof orthography_diff;
  "orthography/generate": typeof orthography_generate;
  "orthography/mutations": typeof orthography_mutations;
  "orthography/queries": typeof orthography_queries;
  "orthography/render": typeof orthography_render;
  "orthography/staleness": typeof orthography_staleness;
  "orthography/types": typeof orthography_types;
  "phonology/content": typeof phonology_content;
  "phonology/diff": typeof phonology_diff;
  "phonology/generate": typeof phonology_generate;
  "phonology/mutations": typeof phonology_mutations;
  "phonology/queries": typeof phonology_queries;
  "phonology/sonority": typeof phonology_sonority;
  "phonology/types": typeof phonology_types;
  "syntax/content": typeof syntax_content;
  "syntax/diff": typeof syntax_diff;
  "syntax/generate": typeof syntax_generate;
  "syntax/mutations": typeof syntax_mutations;
  "syntax/queries": typeof syntax_queries;
  "syntax/types": typeof syntax_types;
  "translate/content": typeof translate_content;
  "translate/translate": typeof translate_translate;
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
