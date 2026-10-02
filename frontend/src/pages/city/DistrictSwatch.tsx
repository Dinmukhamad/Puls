import type { CSSProperties } from "react";
import { districtColour, districtNumber, preparedLand } from "../../city3d/world/estateGrid";

/**
 * A team district's colour as the map shows it: its border, the shade of its land and its label (world/estateGrid.ts).
 * A district without land (beyond the three of a city) has none.
 */
export function DistrictSwatch({ district }: { district: string }) {
  const number = districtNumber(district);
  return preparedLand(number) ? <i className="district-swatch" style={{ "--district": districtColour(number) } as CSSProperties} aria-hidden="true" /> : null;
}
