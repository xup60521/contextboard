export type TableNames = "whiteboards" | "cards" | "boardItems" | "tldrawDocuments" | "files" | "fileReferences" | "cardReferences" | "todos";
export type Id<TableName extends TableNames | "_storage"> = string & { readonly __tableName: TableName };
export type Doc<TableName extends TableNames> = Record<string, any> & { _id: Id<TableName>; _creationTime: number };
