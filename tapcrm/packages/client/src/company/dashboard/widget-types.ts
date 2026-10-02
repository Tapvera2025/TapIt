import type { DashboardWidgetId } from '@tapcrm/contracts';
import type { CompanyIdentity } from '../api/companyApi.js';

/** Runtime info a widget component receives. */
export interface WidgetContext {
  readonly identity: CompanyIdentity;
  readonly userId: string;
  readonly onNavigate: (path: string) => void;
}

export type WidgetComponent = (props: { ctx: WidgetContext }) => React.JSX.Element;

/** Static declaration for a widget in the catalog. */
export interface WidgetDef {
  readonly id: DashboardWidgetId;
  readonly title: string;
  readonly description: string;
  /** Called with the identity; returns true when the widget should be available. */
  readonly available: (identity: CompanyIdentity) => boolean;
  /** Default grid placement — what the widget looks like when added. */
  readonly defaultLayout: { w: number; h: number; minW: number; minH: number };
  readonly component: WidgetComponent;
}
