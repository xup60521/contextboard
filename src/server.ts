type FetchHandler = (
	request: Request,
	env: unknown,
	ctx: unknown,
) => Response | Promise<Response>;

let cachedFetch: FetchHandler | null = null;

async function getFetchHandler() {
	if (cachedFetch) {
		return cachedFetch;
	}

	const startServer = await import("@tanstack/react-start/server");
	cachedFetch = startServer.createStartHandler(
		startServer.defaultStreamHandler,
	) as FetchHandler;

	return cachedFetch;
}

const hot = (
	import.meta as ImportMeta & {
		hot?: {
			accept: (callback?: () => void) => void;
		};
	}
).hot;

hot?.accept(() => {
	cachedFetch = null;
});

export default {
	async fetch(request: Request, env: unknown, ctx: unknown) {
		const fetchHandler = await getFetchHandler();
		return fetchHandler(request, env, ctx);
	},
};
