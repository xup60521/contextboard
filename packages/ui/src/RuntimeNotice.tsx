import type { ReactNode } from "react";

export type RuntimeNoticeProps = {
	title: string;
	description: string;
	action?: ReactNode;
};

export function RuntimeNotice({
	title,
	description,
	action,
}: RuntimeNoticeProps) {
	return (
		<section
			className="contextboard-runtime-notice"
			aria-labelledby="runtime-title"
		>
			<div aria-hidden="true" className="contextboard-runtime-notice__mark">
				CB
			</div>
			<div>
				<p className="contextboard-runtime-notice__eyebrow">Desktop preview</p>
				<h1 id="runtime-title">{title}</h1>
				<p>{description}</p>
				{action}
			</div>
		</section>
	);
}
