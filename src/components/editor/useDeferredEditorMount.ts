import { useCallback, useEffect, useRef, useState } from "react";

export const DEFERRED_EDITOR_MOUNT_DELAY_MS = 200;

type DeferredEditorMountOptions = {
	delayMs?: number;
	onShellPaint?: (activeKey: string) => void;
	onMountStart?: (activeKey: string) => void;
};

type DeferredEditorMountResult = {
	shouldMountEditor: boolean;
	isPending: boolean;
	promoteMount: () => void;
};

export function useDeferredEditorMount(
	activeKey: string | null,
	enabled: boolean,
	options?: DeferredEditorMountOptions,
): DeferredEditorMountResult {
	const delayMs = options?.delayMs ?? DEFERRED_EDITOR_MOUNT_DELAY_MS;
	const frameRef = useRef<number | null>(null);
	const timerRef = useRef<number | null>(null);
	const onShellPaintRef = useRef(options?.onShellPaint);
	const onMountStartRef = useRef(options?.onMountStart);
	const [mountedKey, setMountedKey] = useState<string | null>(null);
	const [shouldMount, setShouldMount] = useState(false);
	const [isPending, setIsPending] = useState(false);

	onShellPaintRef.current = options?.onShellPaint;
	onMountStartRef.current = options?.onMountStart;

	const clearDeferredMount = useCallback(() => {
		if (frameRef.current !== null) {
			window.cancelAnimationFrame(frameRef.current);
			frameRef.current = null;
		}

		if (timerRef.current !== null) {
			window.clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	const mountNow = useCallback(
		(key: string) => {
			clearDeferredMount();
			onMountStartRef.current?.(key);
			setMountedKey(key);
			setShouldMount(true);
			setIsPending(false);
		},
		[clearDeferredMount],
	);

	useEffect(() => {
		clearDeferredMount();
		setShouldMount(false);
		setMountedKey(null);

		if (!enabled || !activeKey) {
			setIsPending(false);
			return;
		}

		setIsPending(true);
		frameRef.current = window.requestAnimationFrame(() => {
			frameRef.current = null;
			onShellPaintRef.current?.(activeKey);
			timerRef.current = window.setTimeout(() => {
				timerRef.current = null;
				mountNow(activeKey);
			}, delayMs);
		});

		return clearDeferredMount;
	}, [activeKey, clearDeferredMount, delayMs, enabled, mountNow]);

	const promoteMount = useCallback(() => {
		if (!enabled || !activeKey || shouldMount) {
			return;
		}

		mountNow(activeKey);
	}, [activeKey, enabled, mountNow, shouldMount]);

	return {
		shouldMountEditor: enabled && shouldMount && mountedKey === activeKey,
		isPending,
		promoteMount,
	};
}
