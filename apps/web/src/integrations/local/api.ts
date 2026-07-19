const ref = <Name extends string>(name: Name) => name;
export const api = {
  cards: { get: ref("cards.get"), getContentsForWhiteboardItems: ref("cards.getContentsForWhiteboardItems"), updateContent: ref("cards.updateContent"), listByWhiteboard: ref("cards.listByWhiteboard"), listOrphans: ref("cards.listOrphans"), listAll: ref("cards.listAll"), archiveCard: ref("cards.archiveCard"), archiveCards: ref("cards.archiveCards"), appendToWhiteboard: ref("cards.appendToWhiteboard"), appendCardsToWhiteboard: ref("cards.appendCardsToWhiteboard") },
  canvas: { listItems: ref("canvas.listItems"), createCardItem: ref("canvas.createCardItem"), createSubwhiteboardItem: ref("canvas.createSubwhiteboardItem"), updateItemFrame: ref("canvas.updateItemFrame"), archiveItem: ref("canvas.archiveItem"), restoreOrAdoptCardItem: ref("canvas.restoreOrAdoptCardItem") },
  whiteboards: { get: ref("whiteboards.get"), getBreadcrumbs: ref("whiteboards.getBreadcrumbs"), listActive: ref("whiteboards.listActive"), updateTitle: ref("whiteboards.updateTitle") },
  search: { searchGlobal: ref("search.searchGlobal"), searchInWhiteboard: ref("search.searchInWhiteboard"), searchCardsForReference: ref("search.searchCardsForReference") },
  sidebar: { get: ref("sidebar.get") }, tldrawDocuments: { get: ref("tldrawDocuments.get"), save: ref("tldrawDocuments.save") },
  files: { generateUploadUrl: ref("files.generateUploadUrl"), finalizeUpload: ref("files.finalizeUpload"), getImageUrl: ref("files.getImageUrl") },
  todos: { list: ref("todos.list"), add: ref("todos.add"), toggle: ref("todos.toggle"), remove: ref("todos.remove") },
} as const;
