import { createContext, useContext } from "react";

export type CompleteCardHeightMeasurement = (
	shapeId: string,
	height: number,
) => Promise<boolean>;

export const CardHeightMeasurementContext =
	createContext<CompleteCardHeightMeasurement | null>(null);

export function useCompleteCardHeightMeasurement() {
	return useContext(CardHeightMeasurementContext);
}
