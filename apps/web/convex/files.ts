import { v } from "convex/values";
import {
	internalMutation,
	mutation,
	query,
} from "./_generated/server";
import {
	deletePendingFile,
	ensureFileForStorageId,
	rebuildAllFileRefs,
} from "./fileLifecycle";

export const generateUploadUrl = mutation({
	handler: async (ctx) => {
		return await ctx.storage.generateUploadUrl();
	},
});

export const finalizeUpload = mutation({
	args: { storageId: v.id("_storage") },
	handler: async (ctx, args) => {
		const file = await ensureFileForStorageId(ctx, args.storageId);
		return {
			fileId: file._id,
			storageId: file.storageId,
			url: file.url,
		};
	},
});

export const getImageUrl = query({
	args: { storageId: v.id("_storage") },
	handler: async (ctx, args) => {
		return await ctx.storage.getUrl(args.storageId);
	},
});

export const gcFile = internalMutation({
	args: { fileId: v.id("files") },
	handler: async (ctx, args) => {
		await deletePendingFile(ctx, args.fileId);
	},
});

export const backfillLegacyFileRefs = internalMutation({
	args: {},
	handler: async (ctx) => {
		await rebuildAllFileRefs(ctx);
	},
});
