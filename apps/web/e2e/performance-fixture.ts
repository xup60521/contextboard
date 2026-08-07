import type { Page } from "@playwright/test";

export const PERF_FIXTURE = {
	workspaceId: "perf-workspace",
	deviceId: "perf-device",
	whiteboardId: "perf-board",
	cardCount: 200,
	arrowCount: 50,
	childBoardCount: 5,
} as const;

function metadata(index: number) {
	return {
		revision: 1,
		createdAt: 1_700_000_000_000 + index,
		updatedAt: 1_700_000_000_000 + index,
		updatedByDeviceId: PERF_FIXTURE.deviceId,
		deletedAt: null,
	};
}

function documentFor(index: number) {
	return {
		type: "doc",
		content: [
			{
				type: "heading",
				attrs: { level: 2 },
				content: [{ type: "text", text: `Performance card ${index + 1}` }],
			},
			{
				type: "paragraph",
				content: [
					{
						type: "text",
						text: `Representative TipTap body ${index + 1}: local-first notes, links, and enough text to exercise static rendering.`,
					},
				],
			},
			{
				type: "bulletList",
				content: [0, 1, 2].map((item) => ({
					type: "listItem",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: `Fixture item ${item + 1}` }],
						},
					],
				})),
			},
		],
	};
}

export function createPerformanceFixture(pendingChangeCount = 0) {
	const cards = Array.from({ length: PERF_FIXTURE.cardCount }, (_, index) => {
		const document = documentFor(index);
		return {
			id: `perf-card-${String(index).padStart(3, "0")}`,
			content: document,
			derivedTitle: `Performance card ${index + 1}`,
			plainText: `Performance card ${index + 1} representative fixture body`,
			preview: `Representative fixture body ${index + 1}`,
			contentVersion: 1,
			activePlacementCount: 1,
			archivedAt: null,
			...metadata(index),
		};
	});
	const cardContents = cards.map((card, index) => ({
		id: card.id,
		cardId: card.id,
		document: card.content,
		contentVersion: 1,
		clock: `${String(card.updatedAt).padStart(13, "0")}:000000:${PERF_FIXTURE.deviceId}`,
		...metadata(index),
	}));
	const whiteboards = [
		{
			id: PERF_FIXTURE.whiteboardId,
			title: "Performance reference board",
			parentWhiteboardId: null,
			ancestorIds: [],
			depth: 0,
			sortKey: "0000",
			pathKey: "0000",
			archivedAt: null,
			...metadata(0),
		},
		...Array.from({ length: PERF_FIXTURE.childBoardCount }, (_, index) => ({
			id: `perf-child-${index}`,
			title: `Child board ${index + 1}`,
			parentWhiteboardId: PERF_FIXTURE.whiteboardId,
			ancestorIds: [PERF_FIXTURE.whiteboardId],
			depth: 1,
			sortKey: `000${index + 1}`,
			pathKey: `0000/000${index + 1}`,
			archivedAt: null,
			...metadata(index + 1),
		})),
	];
	const boardItems = [
		...cards.map((card, index) => ({
			id: `perf-item-${String(index).padStart(3, "0")}`,
			whiteboardId: PERF_FIXTURE.whiteboardId,
			kind: "card",
			cardId: card.id,
			childWhiteboardId: null,
			shapeId: `shape:perf-card-${String(index).padStart(3, "0")}`,
			x: (index % 20) * 360,
			y: Math.floor(index / 20) * 280,
			w: 320,
			h: 220,
			rotation: 0,
			zIndex: index,
			archivedAt: null,
			...metadata(index),
		})),
		...Array.from({ length: PERF_FIXTURE.childBoardCount }, (_, index) => ({
			id: `perf-child-item-${index}`,
			whiteboardId: PERF_FIXTURE.whiteboardId,
			kind: "subwhiteboard",
			cardId: null,
			childWhiteboardId: `perf-child-${index}`,
			shapeId: `shape:perf-child-${index}`,
			x: index * 360,
			y: -360,
			w: 320,
			h: 220,
			rotation: 0,
			zIndex: cards.length + index,
			archivedAt: null,
			...metadata(cards.length + index),
		})),
	];
	const canvasRecords = Array.from(
		{ length: PERF_FIXTURE.arrowCount },
		(_, index) => {
			const recordId = `shape:perf-arrow-${index}`;
			return {
				id: `${PERF_FIXTURE.whiteboardId}:${recordId}`,
				whiteboardId: PERF_FIXTURE.whiteboardId,
				recordId,
				recordType: "shape",
				payload: {
					id: recordId,
					typeName: "shape",
					type: "arrow",
					x: (index % 10) * 720 + 320,
					y: Math.floor(index / 10) * 560 + 100,
					rotation: 0,
					index: `a${String(index).padStart(3, "0")}`,
					parentId: "page:page",
					isLocked: false,
					opacity: 1,
					meta: {},
					props: {
						kind: "arc", elbowMidPoint: 0.5, dash: "draw", size: "m", fill: "none", color: "black",
						labelColor: "black", bend: 0, start: { x: 0, y: 0 },
						end: { x: 180, y: 120 }, arrowheadStart: "none",
						arrowheadEnd: "arrow", text: "", labelPosition: 0.5,
						font: "draw", scale: 1,
					},
				},
				clock: `${String(1_700_000_100_000 + index).padStart(13, "0")}:000000:${PERF_FIXTURE.deviceId}`,
				...metadata(index),
			};
		},
	);
	const changeLog = Array.from({ length: pendingChangeCount }, (_, index) => ({
		protocolVersion: 1,
		schemaVersion: 2,
		changeId: `perf-change-${String(index).padStart(5, "0")}`,
		workspaceId: PERF_FIXTURE.workspaceId,
		deviceId: PERF_FIXTURE.deviceId,
		deviceSequence: index + 1,
		clock: `${String(1_700_001_000_000 + index).padStart(13, "0")}:000000:${PERF_FIXTURE.deviceId}`,
		command: "fixture.pending",
		createdAt: 1_700_001_000_000 + index,
		changes: [],
	}));
	return { cards, cardContents, whiteboards, boardItems, canvasRecords, changeLog };
}

/** Installs the deterministic fixture into Playwright's isolated browser DB. */
export async function installPerformanceFixture(
	page: Page,
	options: { pendingChangeCount?: number } = {},
) {
	await page.goto("/whiteboard?perf=1");
	await page.locator(".tl-canvas").waitFor({ state: "visible" });
	const fixture = createPerformanceFixture(options.pendingChangeCount ?? 0);
	await page.evaluate(
		async ({ fixture, identity }) => {
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open("contextboard");
				request.onerror = () => reject(request.error);
				request.onsuccess = () => resolve(request.result);
			});
			const stores = Object.keys(fixture).filter((name) =>
				database.objectStoreNames.contains(name),
			);
			const transaction = database.transaction([...stores, "settings"], "readwrite");
			for (const storeName of stores) {
				const store = transaction.objectStore(storeName);
				store.clear();
				for (const row of fixture[storeName as keyof typeof fixture]) store.put(row);
			}
			const settings = transaction.objectStore("settings");
			settings.put({ key: "workspaceId", value: identity.workspaceId });
			settings.put({ key: "deviceId", value: identity.deviceId });
			settings.put({ key: "changeLogFormatVersion", value: 2 });
			await new Promise<void>((resolve, reject) => {
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
			});
		},
		{ fixture, identity: PERF_FIXTURE },
	);
	await page.goto(`/whiteboard/${PERF_FIXTURE.whiteboardId}?perf=1`);
}
