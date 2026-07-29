import { useCallback, useEffect, useRef, useState } from "react";
import { RichTextEditor } from "@contextboard/editor";
import {
	useApplicationRuntime,
	useApplicationValue,
} from "../ApplicationRuntimeProvider";

const SAVE_DELAY_MS = 600;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const SAVE_LABEL: Record<SaveState, string> = {
	idle: "All changes saved",
	dirty: "Unsaved changes",
	saving: "Saving…",
	saved: "All changes saved",
	error: "Could not save",
};

export type CardDetailViewProps = {
	cardId: string;
};

export function CardDetailView({ cardId }: CardDetailViewProps) {
	const runtime = useApplicationRuntime();
	const card = useApplicationValue(
		() => runtime.cards.get(cardId),
		[runtime.cards, cardId],
	);

	const [draft, setDraft] = useState<unknown | null>(null);
	const [saveState, setSaveState] = useState<SaveState>("idle");
	const [saveError, setSaveError] = useState<string | null>(null);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const versionRef = useRef<number | null>(null);
	const loadedRef = useRef<string | null>(null);

	// Adopt server text only while the editor has no local edits in flight.
	useEffect(() => {
		if (card.status !== "ready" || !card.data) return;
		versionRef.current = card.data.version;
		const key = `${card.data.id}:${card.data.version}`;
		if (loadedRef.current === key) return;
		if (saveState === "dirty" || saveState === "saving") return;
		loadedRef.current = key;
		setDraft(card.data.content);
	}, [card, saveState]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `cardId` is the identity this editor resets on, even though the body does not read it.
	useEffect(() => {
		loadedRef.current = null;
		versionRef.current = null;
		setDraft(null);
		setSaveState("idle");
		setSaveError(null);
		setConfirmingDelete(false);
	}, [cardId]);

	const save = useCallback(
		async (content: unknown) => {
			setSaveState("saving");
			try {
				const version = await runtime.cards.updateContent({
					cardId,
					content,
					expectedVersion: versionRef.current ?? undefined,
				});
				versionRef.current = version;
				loadedRef.current = `${cardId}:${version}`;
				setSaveError(null);
				setSaveState("saved");
			} catch (error) {
				setSaveError(
					error instanceof Error
						? error.message
						: "The card could not be saved",
				);
				setSaveState("error");
			}
		},
		[cardId, runtime.cards],
	);

	useEffect(() => {
		if (saveState !== "dirty" || draft === null) return;
		const timer = setTimeout(() => void save(draft), SAVE_DELAY_MS);
		return () => clearTimeout(timer);
	}, [draft, saveState, save]);

	const deleteCard = useCallback(async () => {
		await runtime.cards.delete(cardId);
		runtime.navigation.navigate(runtime.navigation.cardsHref());
	}, [cardId, runtime]);

	if (card.status === "loading")
		return (
			<p aria-live="polite" className="cb-note">
				Loading card…
			</p>
		);

	if (card.status === "error")
		return (
			<div className="cb-note cb-note--error" role="alert">
				<p>This card could not be loaded.</p>
				<p className="cb-note__detail">{card.error.message}</p>
			</div>
		);

	if (!card.data)
		return (
			<div className="cb-note">
				<p>This card no longer exists.</p>
				<button
					className="cb-button"
					onClick={() =>
						runtime.navigation.navigate(runtime.navigation.cardsHref())
					}
					type="button"
				>
					Back to cards
				</button>
			</div>
		);

	return (
		<section className="cb-page" aria-labelledby="cb-card-heading">
			<header className="cb-page__header">
				<div>
					<a
						className="cb-back-link"
						href={runtime.navigation.cardsHref()}
						onClick={(event) => {
							event.preventDefault();
							runtime.navigation.navigate(runtime.navigation.cardsHref());
						}}
					>
						← All cards
					</a>
					<h1 className="cb-page__title" id="cb-card-heading">
						{card.data.title}
					</h1>
					<p className="cb-page__subtitle" data-testid="cb-save-state">
						{SAVE_LABEL[saveState]}
					</p>
				</div>
				{confirmingDelete ? (
					<fieldset className="cb-confirm">
						<legend className="cb-visually-hidden">Delete card</legend>
						<span>Delete this card?</span>
						<button
							className="cb-button cb-button--danger"
							onClick={() => void deleteCard()}
							type="button"
						>
							Delete
						</button>
						<button
							className="cb-button"
							onClick={() => setConfirmingDelete(false)}
							type="button"
						>
							Cancel
						</button>
					</fieldset>
				) : (
					<button
						className="cb-button"
						onClick={() => setConfirmingDelete(true)}
						type="button"
					>
						Delete card
					</button>
				)}
			</header>

			{saveError ? (
				<p className="cb-note cb-note--error" role="alert">
					{saveError}
				</p>
			) : null}

			<div className="cb-editor">
				<RichTextEditor
					ariaLabel="Card content"
					content={draft as never}
					contentClassName="min-h-[18rem]"
					onChange={(content) => {
					setDraft(content);
					setSaveState("dirty");
				}}
					syncContentOnPropChange
				/>
			</div>
		</section>
	);
}
