import "fake-indexeddb/auto";

class BunFileReader {
	result: string | ArrayBuffer | null = null;
	error: DOMException | null = null;
	onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
	onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

	readAsDataURL(blob: Blob) {
		void blob.arrayBuffer().then(
			(bytes) => {
				this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(bytes).toString("base64")}`;
				this.onload?.({ target: this } as unknown as ProgressEvent<FileReader>);
			},
			(error: unknown) => {
				this.error =
					error instanceof DOMException
						? error
						: new DOMException(String(error));
				this.onerror?.({ target: this } as unknown as ProgressEvent<FileReader>);
			},
		);
	}
}

globalThis.FileReader = BunFileReader as unknown as typeof FileReader;
