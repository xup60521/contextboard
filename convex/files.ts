import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const generateUploadUrl = mutation({
	handler: async (ctx) => {
		return await ctx.storage.generateUploadUrl();
	},
});

export const getImageUrl = query({
	args: { storageId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.storage.getUrl(args.storageId);
	},
});
