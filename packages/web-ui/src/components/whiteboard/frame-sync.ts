export type WhiteboardFrame = {
	x: number;
	y: number;
	w: number;
	h: number;
	rotation: number;
	zIndex: number;
};

export type SequencedFrame = {
	seq: number;
	frame: WhiteboardFrame;
};

export type WhiteboardFrameSource = WhiteboardFrame;

export type ShapeWithFrame = {
	x: number;
	y: number;
	rotation: number;
	props: {
		w: number;
		h: number;
	};
};

export function frameFromItem(item: WhiteboardFrameSource): WhiteboardFrame {
	return {
		x: item.x,
		y: item.y,
		w: item.w,
		h: item.h,
		rotation: item.rotation,
		zIndex: item.zIndex,
	};
}

export function framesEqual(
	left: WhiteboardFrame,
	right: WhiteboardFrame,
): boolean {
	return (
		left.x === right.x &&
		left.y === right.y &&
		left.w === right.w &&
		left.h === right.h &&
		left.rotation === right.rotation &&
		left.zIndex === right.zIndex
	);
}

export function applyFrameToShape<TShape extends ShapeWithFrame>(
	shape: TShape,
	frame: WhiteboardFrame,
): TShape {
	return {
		...shape,
		x: frame.x,
		y: frame.y,
		rotation: frame.rotation,
		props: {
			...shape.props,
			w: frame.w,
			h: frame.h,
		},
	};
}

export function resolveFrameForHydration(
	serverFrame: WhiteboardFrame,
	optimisticFrame: SequencedFrame | undefined,
) {
	if (!optimisticFrame) {
		return { frame: serverFrame, acknowledged: false };
	}

	if (framesEqual(serverFrame, optimisticFrame.frame)) {
		return { frame: serverFrame, acknowledged: true };
	}

	return { frame: optimisticFrame.frame, acknowledged: false };
}

export function shouldClearOptimisticFrame(
	currentFrame: SequencedFrame | undefined,
	failedSeq: number,
): boolean {
	return currentFrame?.seq === failedSeq;
}
