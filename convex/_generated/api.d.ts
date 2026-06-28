/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as canvas from "../canvas.js";
import type * as cards from "../cards.js";
import type * as fileLifecycle from "../fileLifecycle.js";
import type * as files from "../files.js";
import type * as migrations from "../migrations.js";
import type * as model_cardMetadata from "../model/cardMetadata.js";
import type * as model_cardPlacements from "../model/cardPlacements.js";
import type * as model_cardReferences from "../model/cardReferences.js";
import type * as model_cardSorting from "../model/cardSorting.js";
import type * as model_fileReferences from "../model/fileReferences.js";
import type * as model_shapeIds from "../model/shapeIds.js";
import type * as search from "../search.js";
import type * as tldrawDocuments from "../tldrawDocuments.js";
import type * as todos from "../todos.js";
import type * as whiteboards from "../whiteboards.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  canvas: typeof canvas;
  cards: typeof cards;
  fileLifecycle: typeof fileLifecycle;
  files: typeof files;
  migrations: typeof migrations;
  "model/cardMetadata": typeof model_cardMetadata;
  "model/cardPlacements": typeof model_cardPlacements;
  "model/cardReferences": typeof model_cardReferences;
  "model/cardSorting": typeof model_cardSorting;
  "model/fileReferences": typeof model_fileReferences;
  "model/shapeIds": typeof model_shapeIds;
  search: typeof search;
  tldrawDocuments: typeof tldrawDocuments;
  todos: typeof todos;
  whiteboards: typeof whiteboards;
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
